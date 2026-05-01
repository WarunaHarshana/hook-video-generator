import {
  execFile,
  spawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import {createReadStream, existsSync, statSync} from "node:fs";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import http, {type IncomingMessage, type ServerResponse} from "node:http";
import path from "node:path";
import {promisify} from "node:util";
import {fileURLToPath} from "node:url";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

type HighlightSegment = {
  start: number;
  duration: number;
};

type OutputAspectRatio = "source" | "9:16" | "1:1" | "4:5" | "16:9";
type ReframeMode = "none" | "auto";
type BeatSyncIntensity = "loose" | "tight" | "fast";
type EffectPreset = "clean" | "beat-punch" | "flash-cuts" | "impact-shake";

type BeatSyncSettings = {
  enabled: boolean;
  intensity: BeatSyncIntensity;
};

type MusicSettings = {
  src: string;
  start: number;
  duration: number;
  volume: number;
  sourceVolume: number;
  fadeSeconds: number;
  loop: boolean;
  enabled: boolean;
  useEntireFile?: boolean;
  beats?: number[];
  beatSync?: BeatSyncSettings;
  detected?: {
    score?: number;
    audioDuration?: number;
    beatCount?: number;
    candidates?: Array<{
      start: number;
      duration: number;
      score: number;
      energy: number;
    }>;
  };
};

type ProjectJson = {
  src: string;
  width: number;
  height: number;
  fps: number;
  sourceWidth?: number;
  sourceHeight?: number;
  outputAspectRatio?: OutputAspectRatio;
  reframeMode?: ReframeMode;
  effectPreset?: EffectPreset;
  music?: MusicSettings;
  duration?: number;
  title?: string;
  highlights: HighlightSegment[];
};

type Thumbnail = {
  index: number;
  start: number;
  duration: number;
  time: number;
  path: string;
  url: string;
};

type JobStatus = "running" | "cancelling" | "cancelled" | "done" | "failed";

type Job = {
  id: string;
  kind: "analyze" | "render" | "music";
  status: JobStatus;
  progress: number;
  phase: string;
  logs: string;
  startedAt: string;
  finishedAt?: string;
  exitCode?: number | null;
  result?: unknown;
  cancelRequested?: boolean;
  child: ChildProcessWithoutNullStreams;
};

type ManifestKind = "project" | "upload" | "thumbnail";

type WorkspaceManifestEntry = {
  path: string;
  kind: ManifestKind;
  createdAt: string;
};

type WorkspaceManifest = {
  version: 1;
  files: WorkspaceManifestEntry[];
};

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const uiDir = path.join(rootDir, "ui");
const uploadsDir = path.join(rootDir, "uploads");
const thumbnailsDir = path.join(rootDir, ".hook-thumbnails");
const tempDir = path.join(rootDir, ".tmp");
const projectPath = path.join(rootDir, "project.json");
const manifestPath = path.join(rootDir, ".hook-workspace-manifest.json");
const defaultOutputPath = path.join(rootDir, "hook.mp4");
const tsxCli = path.join(rootDir, "node_modules", "tsx", "dist", "cli.mjs");
const jobs = new Map<string, Job>();
const jobClients = new Map<string, Set<ServerResponse>>();
const execFileAsync = promisify(execFile);

let activeJobId: string | null = null;
let lastOutputPath = defaultOutputPath;

const contentTypes = new Map<string, string>([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".png", "image/png"],
  [".webp", "image/webp"],
  [".mp4", "video/mp4"],
  [".mov", "video/quicktime"],
  [".webm", "video/webm"],
  [".mkv", "video/x-matroska"],
  [".mp3", "audio/mpeg"],
  [".wav", "audio/wav"],
  [".m4a", "audio/mp4"],
  [".aac", "audio/aac"],
  [".flac", "audio/flac"],
  [".ogg", "audio/ogg"],
]);

const sendJson = (
  res: ServerResponse,
  statusCode: number,
  payload: unknown,
) => {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
};

const sendText = (res: ServerResponse, statusCode: number, message: string) => {
  res.writeHead(statusCode, {"content-type": "text/plain; charset=utf-8"});
  res.end(message);
};

const parseBody = async <T>(req: IncomingMessage): Promise<T> => {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? (JSON.parse(raw) as T) : ({} as T);
};

const normalizeNumber = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const outputAspectRatios = new Set<OutputAspectRatio>([
  "source",
  "9:16",
  "1:1",
  "4:5",
  "16:9",
]);

const reframeModes = new Set<ReframeMode>(["none", "auto"]);
const effectPresets = new Set<EffectPreset>([
  "clean",
  "beat-punch",
  "flash-cuts",
  "impact-shake",
]);
const beatSyncIntensities = new Set<BeatSyncIntensity>([
  "loose",
  "tight",
  "fast",
]);

const normalizeOutputAspectRatio = (value: unknown): OutputAspectRatio => {
  return typeof value === "string" && outputAspectRatios.has(value as OutputAspectRatio)
    ? (value as OutputAspectRatio)
    : "source";
};

const normalizeReframeMode = (value: unknown): ReframeMode => {
  return typeof value === "string" && reframeModes.has(value as ReframeMode)
    ? (value as ReframeMode)
    : "none";
};

const normalizeEffectPreset = (value: unknown): EffectPreset => {
  return typeof value === "string" && effectPresets.has(value as EffectPreset)
    ? (value as EffectPreset)
    : "clean";
};

const normalizeBeatSyncIntensity = (value: unknown): BeatSyncIntensity => {
  return typeof value === "string" &&
    beatSyncIntensities.has(value as BeatSyncIntensity)
    ? (value as BeatSyncIntensity)
    : "tight";
};

const clampNumber = (value: unknown, min: number, max: number, fallback: number) => {
  const parsed = normalizeNumber(value, fallback);
  return Math.min(Math.max(parsed, min), max);
};

const normalizeMusicSettings = (value: unknown): MusicSettings | undefined => {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const input = value as Partial<MusicSettings>;
  if (!input.src?.trim()) {
    return undefined;
  }
  const beatSync = input.beatSync;
  const beats = Array.isArray(input.beats)
    ? input.beats
        .map((beat) => Number(beat))
        .filter((beat) => Number.isFinite(beat) && beat >= 0)
    : undefined;

  return {
    src: input.src.trim(),
    start: Math.max(0, normalizeNumber(input.start, 0)),
    duration: Math.max(0.1, normalizeNumber(input.duration, 15)),
    volume: clampNumber(input.volume, 0, 1, 0.35),
    sourceVolume: clampNumber(input.sourceVolume, 0, 1, 0.75),
    fadeSeconds: clampNumber(input.fadeSeconds, 0, 10, 1),
    loop: Boolean(input.loop),
    enabled: input.enabled !== false,
    useEntireFile: Boolean(input.useEntireFile),
    beats,
    beatSync: {
      enabled: Boolean(beatSync?.enabled),
      intensity: normalizeBeatSyncIntensity(beatSync?.intensity),
    },
    detected: input.detected,
  };
};

const isYoutubeUrl = (value: string) => {
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return (
      hostname === "youtube.com" ||
      hostname.endsWith(".youtube.com") ||
      hostname === "youtu.be" ||
      hostname.endsWith(".youtu.be")
    );
  } catch {
    return false;
  }
};

const assertSupportedMusicSource = (value: string) => {
  if (isYoutubeUrl(value)) {
    throw new Error(
      "YouTube links are not downloaded by this app. Use a local music file or a direct audio/video file URL.",
    );
  }
};

const probeMediaDuration = async (input: string) => {
  const ffprobe = ffprobeStatic.path || "ffprobe";
  try {
    const {stdout} = await execFileAsync(
      ffprobe,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        input,
      ],
      {maxBuffer: 1024 * 1024, windowsHide: true},
    );
    const duration = Number(String(stdout).trim());

    return Number.isFinite(duration) && duration > 0
      ? Number(duration.toFixed(3))
      : null;
  } catch {
    return null;
  }
};

const resolveWorkspacePath = (value: string | undefined, fallback: string) => {
  if (!value?.trim()) {
    return fallback;
  }

  return path.isAbsolute(value) ? value : path.resolve(rootDir, value);
};

const powershellString = (value: string) => {
  return `'${value.replace(/'/g, "''")}'`;
};

const dialogOwnerScript = `
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class HookDialogWindow {
  public static readonly IntPtr HWND_TOPMOST = new IntPtr(-1);
  public const UInt32 SWP_NOSIZE = 0x0001;
  public const UInt32 SWP_NOMOVE = 0x0002;
  public const UInt32 SWP_SHOWWINDOW = 0x0040;

  [DllImport("user32.dll")]
  public static extern bool SetForegroundWindow(IntPtr hWnd);

  [DllImport("user32.dll")]
  public static extern bool SetWindowPos(
    IntPtr hWnd,
    IntPtr hWndInsertAfter,
    int X,
    int Y,
    int cx,
    int cy,
    UInt32 uFlags
  );
}
"@
$owner = New-Object System.Windows.Forms.Form
$owner.Text = 'Hook Video Generator'
$owner.StartPosition = 'CenterScreen'
$owner.Width = 360
$owner.Height = 90
$owner.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::FixedSingle
$owner.MaximizeBox = $false
$owner.MinimizeBox = $false
$owner.ShowInTaskbar = $true
$owner.TopMost = $true
$label = New-Object System.Windows.Forms.Label
$label.Text = 'Opening file chooser...'
$label.Dock = [System.Windows.Forms.DockStyle]::Fill
$label.TextAlign = [System.Drawing.ContentAlignment]::MiddleCenter
$label.Font = New-Object System.Drawing.Font('Segoe UI', 10)
$owner.Controls.Add($label)
$owner.Show()
$owner.Activate()
$owner.BringToFront()
[HookDialogWindow]::SetWindowPos(
  $owner.Handle,
  [HookDialogWindow]::HWND_TOPMOST,
  0,
  0,
  0,
  0,
  [HookDialogWindow]::SWP_NOMOVE -bor [HookDialogWindow]::SWP_NOSIZE -bor [HookDialogWindow]::SWP_SHOWWINDOW
) | Out-Null
[HookDialogWindow]::SetForegroundWindow($owner.Handle) | Out-Null
[System.Windows.Forms.Application]::DoEvents()
Start-Sleep -Milliseconds 150
`;

const delay = (milliseconds: number) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });

const isInsideDirectory = (filePath: string, directory: string) => {
  const relative = path.relative(directory, filePath);
  return (
    Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
};

const samePath = (left: string, right: string) => {
  const resolvedLeft = path.resolve(left);
  const resolvedRight = path.resolve(right);
  return process.platform === "win32"
    ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase()
    : resolvedLeft === resolvedRight;
};

const isManagedWorkspacePath = (filePath: string) => {
  const resolved = path.resolve(filePath);
  return (
    samePath(resolved, projectPath) ||
    isInsideDirectory(resolved, uploadsDir) ||
    isInsideDirectory(resolved, thumbnailsDir)
  );
};

const isManifestKind = (kind: unknown): kind is ManifestKind => {
  return kind === "project" || kind === "upload" || kind === "thumbnail";
};

const readManifestEntry = (entry: unknown): WorkspaceManifestEntry | null => {
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const record = entry as Record<string, unknown>;
  if (typeof record.path !== "string" || !isManifestKind(record.kind)) {
    return null;
  }

  const resolved = path.resolve(record.path);
  if (!isManagedWorkspacePath(resolved)) {
    return null;
  }

  return {
    path: resolved,
    kind: record.kind,
    createdAt:
      typeof record.createdAt === "string"
        ? record.createdAt
        : new Date().toISOString(),
  };
};

const loadManifest = async (): Promise<WorkspaceManifest> => {
  if (!existsSync(manifestPath)) {
    return {version: 1, files: []};
  }

  try {
    const parsed = JSON.parse(await readFile(manifestPath, "utf8")) as {
      files?: unknown[];
    };
    return {
      version: 1,
      files: Array.isArray(parsed.files)
        ? parsed.files
            .map((entry) => readManifestEntry(entry))
            .filter((entry): entry is WorkspaceManifestEntry => Boolean(entry))
        : [],
    };
  } catch {
    return {version: 1, files: []};
  }
};

const saveManifest = async (manifest: WorkspaceManifest) => {
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
};

const registerCreatedFile = async (filePath: string, kind: ManifestKind) => {
  const resolved = path.resolve(filePath);
  if (!isManagedWorkspacePath(resolved)) {
    throw new Error(`Refusing to track unmanaged workspace path: ${resolved}`);
  }

  const manifest = await loadManifest();
  const existing = manifest.files.find((entry) => samePath(entry.path, resolved));

  if (existing) {
    existing.kind = kind;
  } else {
    manifest.files.push({
      path: resolved,
      kind,
      createdAt: new Date().toISOString(),
    });
  }

  await saveManifest(manifest);
};

const cleanupManifestFiles = async ({
  keepCurrentUpload = false,
  kinds = ["project", "upload"],
}: {
  keepCurrentUpload?: boolean;
  kinds?: ManifestKind[];
} = {}) => {
  const manifest = await loadManifest();
  const targetKinds = new Set(kinds);
  const project = keepCurrentUpload ? await loadProject() : null;
  const currentSource = project?.src ? path.resolve(project.src) : "";
  const keepCurrentSource =
    keepCurrentUpload && currentSource && isInsideDirectory(currentSource, uploadsDir)
      ? currentSource
      : "";
  const remaining: WorkspaceManifestEntry[] = [];

  let removed = 0;
  let bytes = 0;
  let skipped = 0;
  let keptCurrent = false;

  for (const entry of manifest.files) {
    if (!targetKinds.has(entry.kind)) {
      remaining.push(entry);
      continue;
    }

    const filePath = path.resolve(entry.path);
    if (!isManagedWorkspacePath(filePath)) {
      skipped += 1;
      continue;
    }

    if (keepCurrentSource && samePath(filePath, keepCurrentSource)) {
      keptCurrent = true;
      remaining.push(entry);
      continue;
    }

    if (!existsSync(filePath)) {
      continue;
    }

    let stat;
    try {
      stat = statSync(filePath);
    } catch {
      continue;
    }

    if (!stat.isFile()) {
      skipped += 1;
      continue;
    }

    bytes += stat.size;
    await rm(filePath, {force: true});
    removed += 1;
  }

  await saveManifest({version: 1, files: remaining});

  return {
    removed,
    bytes,
    skipped,
    keptCurrent,
  };
};

const killProcessTree = async (pid: number | undefined) => {
  if (!pid) {
    return;
  }

  if (process.platform === "win32") {
    try {
      await execFileAsync("taskkill.exe", ["/PID", String(pid), "/T"], {
        windowsHide: true,
      });
      return;
    } catch {
      await delay(1200);
      try {
        await execFileAsync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
          windowsHide: true,
        });
      } catch {
        // The process may already be gone by the time the fallback runs.
      }
    }
    return;
  }

  try {
    process.kill(-pid, "SIGTERM");
  } catch {
    return;
  }

  await delay(1200);
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // Already exited.
  }
};

const cleanupUploads = async (keepCurrent: boolean) => {
  return cleanupManifestFiles({keepCurrentUpload: keepCurrent, kinds: ["upload"]});
};

const cleanupThumbnails = async () => {
  return cleanupManifestFiles({
    keepCurrentUpload: false,
    kinds: ["thumbnail"],
  });
};

const clearWorkspace = async () => {
  if (activeJobId) {
    throw new Error("Wait for the current job to finish before clearing.");
  }

  const hadProject = existsSync(projectPath);
  if (hadProject) {
    await registerCreatedFile(projectPath, "project");
  }

  const cleanup = await cleanupManifestFiles({
    keepCurrentUpload: false,
    kinds: ["project", "upload", "thumbnail"],
  });

  return {
    ...cleanup,
    projectRemoved: hadProject && !existsSync(projectPath),
    outputPath: lastOutputPath,
    outputExists: existsSync(lastOutputPath),
  };
};

const thumbnailFileName = (highlight: HighlightSegment, index: number) => {
  const start = String(highlight.start).replace(/[^0-9a-z.-]/gi, "_");
  const duration = String(highlight.duration).replace(/[^0-9a-z.-]/gi, "_");
  return `hook-${String(index + 1).padStart(2, "0")}-${start}-${duration}.jpg`;
};

const thumbnailUrl = (filePath: string) => {
  return `/api/thumbnail?path=${encodeURIComponent(filePath)}&t=${
    existsSync(filePath) ? statSync(filePath).mtimeMs : Date.now()
  }`;
};

const generateThumbnail = async (
  project: ProjectJson,
  highlight: HighlightSegment,
  index: number,
): Promise<Thumbnail> => {
  const ffmpeg = ffmpegPath || "ffmpeg";
  const time = Math.max(0, highlight.start + highlight.duration / 2);
  const outputPath = path.join(thumbnailsDir, thumbnailFileName(highlight, index));

  if (!existsSync(outputPath)) {
    await execFileAsync(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        String(time),
        "-i",
        project.src,
        "-frames:v",
        "1",
        "-vf",
        "scale='min(320,iw)':-2",
        "-q:v",
        "4",
        "-y",
        outputPath,
      ],
      {maxBuffer: 1024 * 1024 * 4, windowsHide: true},
    );
  }

  await registerCreatedFile(outputPath, "thumbnail");

  return {
    index,
    start: highlight.start,
    duration: highlight.duration,
    time,
    path: outputPath,
    url: thumbnailUrl(outputPath),
  };
};

const generateThumbnails = async () => {
  const project = await loadProject();
  if (!project) {
    throw new Error("Run analysis before generating thumbnails.");
  }

  await mkdir(thumbnailsDir, {recursive: true});
  await cleanupThumbnails();

  const thumbnails: Thumbnail[] = [];
  for (const [index, highlight] of project.highlights.entries()) {
    thumbnails.push(await generateThumbnail(project, highlight, index));
  }

  return {
    thumbnails,
    count: thumbnails.length,
  };
};

const currentThumbnails = async () => {
  const project = await loadProject();
  if (!project) {
    return [];
  }

  return project.highlights.map((highlight, index) => {
    const filePath = path.join(thumbnailsDir, thumbnailFileName(highlight, index));
    return {
      index,
      start: highlight.start,
      duration: highlight.duration,
      time: Math.max(0, highlight.start + highlight.duration / 2),
      path: filePath,
      url: existsSync(filePath) ? thumbnailUrl(filePath) : "",
    };
  });
};

const chooseOutputPath = async (currentPath: string | undefined) => {
  const resolved = resolveWorkspacePath(currentPath, defaultOutputPath);
  const initialDirectory = path.dirname(resolved);
  const fileName = path.basename(resolved) || "hook.mp4";
  const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
${dialogOwnerScript}
$dialog = New-Object System.Windows.Forms.SaveFileDialog
$dialog.Title = 'Choose hook output file'
$dialog.Filter = 'MP4 video (*.mp4)|*.mp4|All files (*.*)|*.*'
$dialog.DefaultExt = 'mp4'
$dialog.AddExtension = $true
$dialog.OverwritePrompt = $false
$dialog.InitialDirectory = ${powershellString(initialDirectory)}
$dialog.FileName = ${powershellString(fileName)}
try {
  if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
    Write-Output $dialog.FileName
  }
} finally {
  $dialog.Dispose()
  $owner.Close()
  $owner.Dispose()
}
`;

  const {stdout} = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script],
    {maxBuffer: 1024 * 1024, windowsHide: true},
  );

  return String(stdout).trim();
};

const chooseSourcePath = async (currentPath: string | undefined) => {
  const current = currentPath?.trim();
  const resolved =
    current && path.isAbsolute(current) ? current : path.join(rootDir, "");
  const initialDirectory =
    current && existsSync(resolved) ? path.dirname(resolved) : rootDir;
  const fileName = current && existsSync(resolved) ? path.basename(resolved) : "";
  const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
${dialogOwnerScript}
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = 'Choose source video file'
$dialog.Filter = 'Video files (*.mp4;*.mov;*.mkv;*.webm;*.avi;*.m4v)|*.mp4;*.mov;*.mkv;*.webm;*.avi;*.m4v|All files (*.*)|*.*'
$dialog.Multiselect = $false
$dialog.CheckFileExists = $true
$dialog.InitialDirectory = ${powershellString(initialDirectory)}
$dialog.FileName = ${powershellString(fileName)}
try {
  if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
    Write-Output $dialog.FileName
  }
} finally {
  $dialog.Dispose()
  $owner.Close()
  $owner.Dispose()
}
`;

  const {stdout} = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script],
    {maxBuffer: 1024 * 1024, windowsHide: true},
  );

  return String(stdout).trim();
};

const chooseMusicPath = async (currentPath: string | undefined) => {
  const current = currentPath?.trim();
  const resolved =
    current && path.isAbsolute(current) ? current : path.join(rootDir, "");
  const initialDirectory =
    current && existsSync(resolved) ? path.dirname(resolved) : rootDir;
  const fileName = current && existsSync(resolved) ? path.basename(resolved) : "";
  const script = `
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
${dialogOwnerScript}
$dialog = New-Object System.Windows.Forms.OpenFileDialog
$dialog.Title = 'Choose music file'
$dialog.Filter = 'Audio and video files (*.mp3;*.wav;*.m4a;*.aac;*.flac;*.ogg;*.mp4;*.mov;*.mkv;*.webm)|*.mp3;*.wav;*.m4a;*.aac;*.flac;*.ogg;*.mp4;*.mov;*.mkv;*.webm|All files (*.*)|*.*'
$dialog.Multiselect = $false
$dialog.CheckFileExists = $true
$dialog.InitialDirectory = ${powershellString(initialDirectory)}
$dialog.FileName = ${powershellString(fileName)}
try {
  if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) {
    Write-Output $dialog.FileName
  }
} finally {
  $dialog.Dispose()
  $owner.Close()
  $owner.Dispose()
}
`;

  const {stdout} = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script],
    {maxBuffer: 1024 * 1024, windowsHide: true},
  );

  return String(stdout).trim();
};

const loadProject = async () => {
  if (!existsSync(projectPath)) {
    return null;
  }

  const input = JSON.parse(await readFile(projectPath, "utf8")) as ProjectJson;
  const outputAspectRatio = normalizeOutputAspectRatio(input.outputAspectRatio);

  return {
    ...input,
    sourceWidth: Math.max(
      1,
      Math.round(normalizeNumber(input.sourceWidth, input.width || 1920)),
    ),
    sourceHeight: Math.max(
      1,
      Math.round(normalizeNumber(input.sourceHeight, input.height || 1080)),
    ),
    outputAspectRatio,
    reframeMode:
      outputAspectRatio === "source" ? "none" : normalizeReframeMode(input.reframeMode),
    effectPreset: normalizeEffectPreset(input.effectPreset),
    music: normalizeMusicSettings(input.music),
  };
};

const validateProject = (input: ProjectJson): ProjectJson => {
  const highlights = Array.isArray(input.highlights)
    ? input.highlights
        .map((highlight) => ({
          start: normalizeNumber(highlight.start),
          duration: normalizeNumber(highlight.duration),
        }))
        .filter((highlight) => highlight.start >= 0 && highlight.duration > 0)
    : [];

  if (!input.src?.trim()) {
    throw new Error("Project is missing a source video path.");
  }

  if (highlights.length === 0) {
    throw new Error("Project needs at least one highlight.");
  }

  const outputAspectRatio = normalizeOutputAspectRatio(input.outputAspectRatio);

  return {
    ...input,
    src: input.src.trim(),
    width: Math.max(1, Math.round(normalizeNumber(input.width, 1920))),
    height: Math.max(1, Math.round(normalizeNumber(input.height, 1080))),
    fps: Math.max(1, normalizeNumber(input.fps, 30)),
    sourceWidth: Math.max(
      1,
      Math.round(normalizeNumber(input.sourceWidth, input.width || 1920)),
    ),
    sourceHeight: Math.max(
      1,
      Math.round(normalizeNumber(input.sourceHeight, input.height || 1080)),
    ),
    outputAspectRatio,
    reframeMode:
      outputAspectRatio === "source" ? "none" : normalizeReframeMode(input.reframeMode),
    effectPreset: normalizeEffectPreset(input.effectPreset),
    music: normalizeMusicSettings(input.music),
    duration: normalizeNumber(input.duration, 0) || undefined,
    title: input.title?.trim() || undefined,
    highlights,
  };
};

const publicJob = (job: Job) => ({
  id: job.id,
  kind: job.kind,
  status: job.status,
  progress: job.progress,
  phase: job.phase,
  logs: job.logs,
  startedAt: job.startedAt,
  finishedAt: job.finishedAt,
  exitCode: job.exitCode,
  result: job.result,
});

const isTerminalJob = (job: Job) => {
  return job.status === "done" || job.status === "failed" || job.status === "cancelled";
};

const writeSse = (
  res: ServerResponse,
  eventName: string,
  payload: unknown,
) => {
  if (res.writableEnded || res.destroyed) {
    return;
  }

  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
};

const broadcastJob = (job: Job) => {
  const clients = jobClients.get(job.id);
  if (!clients) {
    return;
  }

  const payload = publicJob(job);
  for (const client of clients) {
    writeSse(client, "job", payload);
  }
};

const closeJobStreams = (job: Job) => {
  const clients = jobClients.get(job.id);
  if (!clients) {
    return;
  }

  broadcastJob(job);
  setTimeout(() => {
    for (const client of clients) {
      if (!client.writableEnded && !client.destroyed) {
        client.end();
      }
    }
    jobClients.delete(job.id);
  }, 50);
};

const streamJob = (req: IncomingMessage, res: ServerResponse, job: Job) => {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.flushHeaders();

  let clients = jobClients.get(job.id);
  if (!clients) {
    clients = new Set<ServerResponse>();
    jobClients.set(job.id, clients);
  }

  clients.add(res);
  writeSse(res, "job", publicJob(job));

  const heartbeat = setInterval(() => {
    if (res.writableEnded || res.destroyed) {
      clearInterval(heartbeat);
      return;
    }

    res.write(": keep-alive\n\n");
  }, 15000);

  req.on("close", () => {
    clearInterval(heartbeat);
    clients?.delete(res);
    if (clients?.size === 0) {
      jobClients.delete(job.id);
    }
  });

  if (isTerminalJob(job)) {
    setTimeout(() => {
      if (!res.writableEnded && !res.destroyed) {
        res.end();
      }
    }, 50);
  }
};

const updateJobProgress = (job: Job, text: string) => {
  for (const match of text.matchAll(/PROGRESS\s+(\d+)\s+([^\r\n]+)/g)) {
    job.progress = Math.max(job.progress, Math.min(Number(match[1]), 100));
    job.phase = match[2].trim();
  }

  const renderMatches = [...text.matchAll(/Rendering\s+(\d+)%/g)];
  if (renderMatches.length > 0) {
    const latest = renderMatches[renderMatches.length - 1];
    job.progress = Math.max(job.progress, Math.min(Number(latest[1]), 100));
    job.phase = "Rendering frames";
  }
};

const appendLog = (job: Job, chunk: Buffer) => {
  const text = chunk.toString("utf8");
  job.logs = `${job.logs}${text}`.slice(-32000);
  updateJobProgress(job, text);
  broadcastJob(job);
};

const cancelActiveJob = async () => {
  if (!activeJobId) {
    return null;
  }

  const job = jobs.get(activeJobId);
  if (!job) {
    activeJobId = null;
    return null;
  }

  if (job.status !== "running" && job.status !== "cancelling") {
    return job;
  }

  job.cancelRequested = true;
  job.status = "cancelling";
  job.phase = `Cancelling ${job.kind}`;
  job.logs = `${job.logs}\nCancellation requested.`.trim();
  broadcastJob(job);

  await killProcessTree(job.child.pid);

  return job;
};

const startJob = ({
  kind,
  script,
  args,
  result,
}: {
  kind: Job["kind"];
  script: string;
  args: string[];
  result: () => Promise<unknown>;
}) => {
  if (activeJobId) {
    throw new Error("Another job is already running.");
  }

  const id = `${Date.now().toString(36)}-${kind}`;
  const child = spawn(process.execPath, [tsxCli, script, ...args], {
    cwd: rootDir,
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  const job: Job = {
    id,
    kind,
    status: "running",
    progress: 0,
    phase:
      kind === "analyze"
        ? "Preparing analysis"
        : kind === "music"
          ? "Preparing music analysis"
          : "Preparing render",
    logs: "",
    startedAt: new Date().toISOString(),
    child,
  };

  activeJobId = id;
  jobs.set(id, job);
  child.stdout.on("data", (chunk: Buffer) => appendLog(job, chunk));
  child.stderr.on("data", (chunk: Buffer) => appendLog(job, chunk));
  child.on("close", async (code) => {
    job.exitCode = code;
    job.finishedAt = new Date().toISOString();
    activeJobId = activeJobId === id ? null : activeJobId;

    if (job.cancelRequested) {
      job.status = "cancelled";
      job.phase = "Cancelled";
      job.logs = `${job.logs}\nCancelled.`.trim();
    } else if (code === 0) {
      job.status = "done";
      job.progress = 100;
      job.phase =
        kind === "analyze"
          ? "Analysis complete"
          : kind === "music"
            ? "Music analysis complete"
            : "Render complete";
      try {
        job.result = await result();
      } catch (error) {
        job.result = {
          warning: error instanceof Error ? error.message : String(error),
        };
      }
    } else {
      job.status = "failed";
      job.phase = "Failed";
    }

    closeJobStreams(job);
  });
  child.on("error", (error) => {
    job.status = job.cancelRequested ? "cancelled" : "failed";
    job.finishedAt = new Date().toISOString();
    job.phase = job.cancelRequested ? "Cancelled" : "Failed";
    job.logs = `${job.logs}\n${error.message}`.trim();
    activeJobId = activeJobId === id ? null : activeJobId;
    closeJobStreams(job);
  });

  return publicJob(job);
};

const staticResponse = (res: ServerResponse, filePath: string) => {
  if (!existsSync(filePath)) {
    sendText(res, 404, "Not found");
    return;
  }

  const stat = statSync(filePath);
  const type =
    contentTypes.get(path.extname(filePath).toLowerCase()) ??
    "application/octet-stream";

  res.writeHead(200, {
    "content-type": type,
    "content-length": stat.size,
    "cache-control": "no-store",
  });
  createReadStream(filePath).pipe(res);
};

const videoResponse = (
  req: IncomingMessage,
  res: ServerResponse,
  filePath: string,
) => {
  if (!existsSync(filePath)) {
    sendText(res, 404, "Video not found");
    return;
  }

  const stat = statSync(filePath);
  const range = req.headers.range;
  const type =
    contentTypes.get(path.extname(filePath).toLowerCase()) ??
    "application/octet-stream";

  if (!range) {
    res.writeHead(200, {
      "content-type": type,
      "content-length": stat.size,
      "accept-ranges": "bytes",
      "cache-control": "no-store",
    });
    createReadStream(filePath).pipe(res);
    return;
  }

  const match = /bytes=(\d+)-(\d*)/.exec(range);
  if (!match) {
    res.writeHead(416, {"content-range": `bytes */${stat.size}`});
    res.end();
    return;
  }

  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : stat.size - 1;

  if (start >= stat.size || end >= stat.size) {
    res.writeHead(416, {"content-range": `bytes */${stat.size}`});
    res.end();
    return;
  }

  res.writeHead(206, {
    "content-type": type,
    "content-length": end - start + 1,
    "content-range": `bytes ${start}-${end}/${stat.size}`,
    "accept-ranges": "bytes",
    "cache-control": "no-store",
  });
  createReadStream(filePath, {start, end}).pipe(res);
};

const routeApi = async (
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
) => {
  if (req.method === "GET" && url.pathname === "/api/state") {
    const project = await loadProject();
    sendJson(res, 200, {
      project,
      thumbnails: await currentThumbnails(),
      projectPath,
      outputPath: lastOutputPath,
      outputExists: existsSync(lastOutputPath),
      activeJobId,
      activeJob: activeJobId ? publicJob(jobs.get(activeJobId)!) : null,
    });
    return;
  }

  if (req.method === "GET" && /^\/api\/jobs\/[^/]+\/events$/.test(url.pathname)) {
    const id = url.pathname.split("/").at(-2) ?? "";
    const job = jobs.get(id);
    if (!job) {
      sendJson(res, 404, {error: "Not found"});
      return;
    }

    streamJob(req, res, job);
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/jobs/")) {
    const id = url.pathname.split("/").pop() ?? "";
    const job = jobs.get(id);
    sendJson(res, job ? 200 : 404, job ? publicJob(job) : {error: "Not found"});
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/project") {
    const body = await parseBody<ProjectJson>(req);
    if (body.music?.src) {
      assertSupportedMusicSource(body.music.src);
    }
    const project = validateProject(body);
    await writeFile(projectPath, `${JSON.stringify(project, null, 2)}\n`);
    await registerCreatedFile(projectPath, "project");
    sendJson(res, 200, {project, projectPath, thumbnails: await currentThumbnails()});
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/thumbnails") {
    const result = await generateThumbnails();
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/cleanup") {
    const result = await cleanupUploads(true);
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/clear-workspace") {
    const result = await clearWorkspace();
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/choose-output") {
    const body = await parseBody<{current?: string}>(req);
    const outputPath = await chooseOutputPath(body.current);

    if (!outputPath) {
      sendJson(res, 200, {cancelled: true});
      return;
    }

    lastOutputPath = outputPath;
    sendJson(res, 200, {
      cancelled: false,
      outputPath,
      outputExists: existsSync(outputPath),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/choose-source") {
    const body = await parseBody<{current?: string}>(req);
    const src = await chooseSourcePath(body.current);

    if (!src) {
      sendJson(res, 200, {cancelled: true});
      return;
    }

    sendJson(res, 200, {
      cancelled: false,
      src,
      name: path.basename(src),
      size: existsSync(src) ? statSync(src).size : 0,
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/choose-music") {
    const body = await parseBody<{current?: string}>(req);
    const src = await chooseMusicPath(body.current);

    if (!src) {
      sendJson(res, 200, {cancelled: true});
      return;
    }

    sendJson(res, 200, {
      cancelled: false,
      src,
      name: path.basename(src),
      size: existsSync(src) ? statSync(src).size : 0,
      duration: await probeMediaDuration(src),
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/cancel-job") {
    const job = await cancelActiveJob();
    if (!job) {
      sendJson(res, 200, {cancelled: false, activeJob: null});
      return;
    }

    sendJson(res, 200, {cancelled: true, activeJob: publicJob(job)});
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/analyze") {
    const body = await parseBody<{
      input?: string;
      clipDuration?: number;
      maxClips?: number;
      sceneThreshold?: number;
      highlightsPath?: string;
    }>(req);
    const input = body.input?.trim();

    if (!input) {
      sendJson(res, 400, {error: "Source video path is required."});
      return;
    }

    const args = [
      "--input",
      input,
      "--out",
      projectPath,
      "--clip-duration",
      String(normalizeNumber(body.clipDuration, 3)),
      "--max-clips",
      String(Math.max(1, Math.round(normalizeNumber(body.maxClips, 8)))),
      "--scene-threshold",
      String(normalizeNumber(body.sceneThreshold, 0.32)),
    ];

    if (body.highlightsPath?.trim()) {
      args.push("--highlights", body.highlightsPath.trim());
    }

    sendJson(
      res,
      202,
      startJob({
        kind: "analyze",
        script: "scripts/analyze.ts",
        args,
        result: async () => {
          if (existsSync(projectPath)) {
            await registerCreatedFile(projectPath, "project");
          }

          return {project: await loadProject(), projectPath};
        },
      }),
    );
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/analyze-music") {
    const body = await parseBody<{input?: string; useEntireFile?: boolean}>(req);
    const input = body.input?.trim();
    const project = await loadProject();

    if (!input) {
      sendJson(res, 400, {error: "Music file path is required."});
      return;
    }

    assertSupportedMusicSource(input);

    if (!project) {
      sendJson(res, 400, {error: "Analyze hooks before analyzing music."});
      return;
    }

    const targetDuration = project.highlights.reduce(
      (sum, highlight) => sum + Number(highlight.duration || 0),
      0,
    );
    await mkdir(tempDir, {recursive: true});
    const resultPath = path.join(tempDir, "music-analysis.json");
    const args = [
      "--input",
      input,
      "--out",
      resultPath,
      "--target-duration",
      String(Math.max(3, targetDuration)),
    ];
    if (body.useEntireFile) {
      args.push("--use-entire-file");
    }

    sendJson(
      res,
      202,
      startJob({
        kind: "music",
        script: "scripts/analyze-music.ts",
        args,
        result: async () => {
          const result = JSON.parse(await readFile(resultPath, "utf8")) as {
            music?: MusicSettings;
          };
          const currentProject = await loadProject();
          const analyzedMusic = normalizeMusicSettings(result.music);

          if (!currentProject || !analyzedMusic) {
            throw new Error("Music analysis finished but no result was found.");
          }
          const music = {
            ...analyzedMusic,
            beatSync: currentProject.music?.beatSync ?? analyzedMusic.beatSync,
          };

          const nextProject = validateProject({
            ...currentProject,
            music,
          });
          await writeFile(projectPath, `${JSON.stringify(nextProject, null, 2)}\n`);
          await registerCreatedFile(projectPath, "project");

          return {project: nextProject, music};
        },
      }),
    );
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/render") {
    const body = await parseBody<{
      out?: string;
      gl?: string;
      concurrency?: number;
      renderMode?: string;
      renderTimeoutMinutes?: number;
    }>(req);
    const outputPath = resolveWorkspacePath(body.out, defaultOutputPath);
    lastOutputPath = outputPath;
    const args = [
      "--project",
      projectPath,
      "--out",
      outputPath,
      "--render-mode",
      body.renderMode?.trim() || "auto",
    ];

    if (body.gl?.trim()) {
      args.push("--gl", body.gl.trim());
    }

    if (body.concurrency) {
      args.push("--concurrency", String(body.concurrency));
    }

    if (body.renderTimeoutMinutes) {
      args.push(
        "--timeout-minutes",
        String(normalizeNumber(body.renderTimeoutMinutes, 5)),
      );
    }

    sendJson(
      res,
      202,
      startJob({
        kind: "render",
        script: "scripts/render.ts",
        args,
        result: async () => ({
          outputPath,
          outputExists: existsSync(outputPath),
        }),
      }),
    );
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/video") {
    const requestedPath = url.searchParams.get("path") ?? "";
    const filePath = resolveWorkspacePath(requestedPath, defaultOutputPath);
    videoResponse(req, res, filePath);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/thumbnail") {
    const requestedPath = url.searchParams.get("path") ?? "";
    const filePath = path.resolve(requestedPath);
    if (!isInsideDirectory(filePath, thumbnailsDir)) {
      sendText(res, 403, "Forbidden");
      return;
    }

    staticResponse(res, filePath);
    return;
  }

  sendJson(res, 404, {error: "Not found"});
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (url.pathname.startsWith("/api/")) {
      await routeApi(req, res, url);
      return;
    }

    const safePath =
      url.pathname === "/"
        ? path.join(uiDir, "index.html")
        : path.resolve(uiDir, `.${decodeURIComponent(url.pathname)}`);

    if (!safePath.startsWith(uiDir)) {
      sendText(res, 403, "Forbidden");
      return;
    }

    staticResponse(res, safePath);
  } catch (error) {
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

const listen = (port: number) => {
  server.once("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE" && port < 3299) {
      listen(port + 1);
      return;
    }

    throw error;
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`Hook Video UI: http://127.0.0.1:${port}`);
  });
};

listen(Number(process.env.PORT) || 3210);
