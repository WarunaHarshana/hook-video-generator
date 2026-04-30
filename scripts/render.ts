import {bundle} from "@remotion/bundler";
import {renderMedia, selectComposition} from "@remotion/renderer";
import {createReadStream, existsSync, statSync} from "node:fs";
import {readFile} from "node:fs/promises";
import http, {type IncomingMessage, type ServerResponse} from "node:http";
import path from "node:path";
import type {HookVideoInputProps} from "../src/HookVideo";

type ProjectJson = HookVideoInputProps & {
  duration?: number;
};

type LoadedProject = {
  inputProps: ProjectJson;
  publicDir: string | null;
  cleanup: () => Promise<void>;
};

type ServedLocalMedia = {
  src: string;
  cleanup: () => Promise<void>;
};

const COMPOSITION_ID = "HookVideo";
const allowedGlValues = ["angle", "vulkan", "egl", "swiftshader"] as const;
type AllowedGl = (typeof allowedGlValues)[number];
const allowedGl = new Set<string>(allowedGlValues);
const renderModeValues = ["auto", "gpu", "cpu"] as const;
type RenderMode = (typeof renderModeValues)[number];
type HardwareAcceleration = "disable" | "if-possible" | "required";
const renderModes = new Set<string>(renderModeValues);
const DEFAULT_RENDER_TIMEOUT_MS = 5 * 60 * 1000;

const readFlag = (name: string) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};

const readNumberFlag = (name: string) => {
  const value = readFlag(name);
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

const readTimeoutInMilliseconds = () => {
  const milliseconds = readNumberFlag("--timeout-ms");
  if (milliseconds) {
    return Math.max(30000, Math.round(milliseconds));
  }

  const minutes = readNumberFlag("--timeout-minutes");
  if (minutes) {
    return Math.max(30000, Math.round(minutes * 60 * 1000));
  }

  return DEFAULT_RENDER_TIMEOUT_MS;
};

const readRenderMode = () => {
  const value = readFlag("--render-mode") ?? "auto";
  if (!renderModes.has(value)) {
    throw new Error("--render-mode must be one of: auto, gpu, cpu.");
  }

  return value as RenderMode;
};

const isRemoteSrc = (src: string) => {
  return /^(https?:|data:|blob:)/i.test(src);
};

const contentTypes = new Map<string, string>([
  [".mp4", "video/mp4"],
  [".mov", "video/quicktime"],
  [".webm", "video/webm"],
  [".mkv", "video/x-matroska"],
  [".avi", "video/x-msvideo"],
  [".m4v", "video/mp4"],
  [".mp3", "audio/mpeg"],
  [".wav", "audio/wav"],
  [".m4a", "audio/mp4"],
  [".aac", "audio/aac"],
  [".flac", "audio/flac"],
  [".ogg", "audio/ogg"],
]);

const writeResponseHeaders = (
  res: ServerResponse,
  statusCode: number,
  headers: http.OutgoingHttpHeaders = {},
) => {
  res.writeHead(statusCode, {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, HEAD, OPTIONS",
    "access-control-allow-headers": "Range, Content-Type",
    "cross-origin-resource-policy": "cross-origin",
    "cache-control": "no-store",
    ...headers,
  });
};

const serveVideoResponse = (
  req: IncomingMessage,
  res: ServerResponse,
  filePath: string,
) => {
  if (req.method === "OPTIONS") {
    writeResponseHeaders(res, 204);
    res.end();
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    writeResponseHeaders(res, 405);
    res.end("Method not allowed");
    return;
  }

  const stat = statSync(filePath);
  const range = req.headers.range;
  const type =
    contentTypes.get(path.extname(filePath).toLowerCase()) ??
    "application/octet-stream";

  if (!range) {
    writeResponseHeaders(res, 200, {
      "content-type": type,
      "content-length": stat.size,
      "accept-ranges": "bytes",
    });

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    createReadStream(filePath).pipe(res);
    return;
  }

  const match = /bytes=(\d+)-(\d*)/.exec(range);
  if (!match) {
    writeResponseHeaders(res, 416, {
      "content-range": `bytes */${stat.size}`,
    });
    res.end();
    return;
  }

  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : stat.size - 1;

  if (start >= stat.size || end >= stat.size || start > end) {
    writeResponseHeaders(res, 416, {
      "content-range": `bytes */${stat.size}`,
    });
    res.end();
    return;
  }

  writeResponseHeaders(res, 206, {
    "content-type": type,
    "content-length": end - start + 1,
    "content-range": `bytes ${start}-${end}/${stat.size}`,
    "accept-ranges": "bytes",
  });

  if (req.method === "HEAD") {
    res.end();
    return;
  }

  createReadStream(filePath, {start, end}).pipe(res);
};

const serveLocalMedia = async (
  src: string,
  projectPath: string,
  label: string,
): Promise<ServedLocalMedia> => {
  const mediaPath = path.isAbsolute(src)
    ? src
    : path.resolve(path.dirname(projectPath), src);

  if (!existsSync(mediaPath)) {
    throw new Error(`${label} file does not exist: ${mediaPath}`);
  }

  const token = Math.random().toString(36).slice(2);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (url.pathname !== "/media" || url.searchParams.get("token") !== token) {
      writeResponseHeaders(res, 404);
      res.end("Not found");
      return;
    }

    serveVideoResponse(req, res, mediaPath);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not start local source video server.");
  }

  const srcUrl = `http://127.0.0.1:${address.port}/media?token=${token}`;
  process.stdout.write(`Streaming ${label} directly from ${mediaPath}\n`);

  return {
    src: srcUrl,
    cleanup: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
};

const loadProject = async (projectPath: string): Promise<LoadedProject> => {
  const raw = await readFile(projectPath, "utf8");
  const parsed = JSON.parse(raw) as ProjectJson;

  if (!parsed.src) {
    throw new Error("project.json is missing src.");
  }

  if (!parsed.width || !parsed.height || !parsed.fps) {
    throw new Error("project.json must include width, height, and fps.");
  }

  if (!Array.isArray(parsed.highlights) || parsed.highlights.length === 0) {
    throw new Error("project.json must include at least one highlight.");
  }

  const servedSource = isRemoteSrc(parsed.src)
    ? null
    : await serveLocalMedia(parsed.src, projectPath, "source");
  const servedMusic =
    parsed.music?.src && !isRemoteSrc(parsed.music.src)
      ? await serveLocalMedia(parsed.music.src, projectPath, "music")
      : null;

  return {
    inputProps: {
      ...parsed,
      src: servedSource?.src ?? parsed.src,
      music: parsed.music
        ? {
            ...parsed.music,
            src: servedMusic?.src ?? parsed.music.src,
          }
        : undefined,
    },
    publicDir: null,
    cleanup: async () => {
      await servedSource?.cleanup();
      await servedMusic?.cleanup();
    },
  };
};

const renderSettingsForMode = (
  mode: RenderMode,
  chromiumGl: AllowedGl | undefined,
): {
  hardwareAcceleration: HardwareAcceleration;
  chromiumGl: AllowedGl | undefined;
} => {
  if (mode === "cpu") {
    return {
      hardwareAcceleration: "disable",
      chromiumGl: "swiftshader",
    };
  }

  if (mode === "gpu") {
    return {
      hardwareAcceleration: "required",
      chromiumGl: chromiumGl === "swiftshader" ? "angle" : chromiumGl,
    };
  }

  return {
    hardwareAcceleration: "if-possible",
    chromiumGl,
  };
};

const main = async () => {
  const projectPath = path.resolve(readFlag("--project") ?? "project.json");
  const outputLocation = path.resolve(readFlag("--out") ?? "hook.mp4");
  const gl = readFlag("--gl");
  const concurrency = readNumberFlag("--concurrency");
  const renderMode = readRenderMode();
  const timeoutInMilliseconds = readTimeoutInMilliseconds();

  if (gl && !allowedGl.has(gl)) {
    throw new Error("--gl must be one of: angle, vulkan, egl, swiftshader.");
  }
  const chromiumGl = gl as AllowedGl | undefined;
  const renderSettings = renderSettingsForMode(renderMode, chromiumGl);

  const {inputProps, publicDir, cleanup} = await loadProject(projectPath);

  try {
    process.stdout.write(
      `Render mode: ${renderMode}; hardware acceleration: ${
        renderSettings.hardwareAcceleration
      }; GL: ${
        renderSettings.chromiumGl ?? "default"
      }; timeout: ${Math.round(timeoutInMilliseconds / 1000)}s\n`,
    );
    const serveUrl = await bundle({
      entryPoint: path.resolve("src/index.ts"),
      publicDir,
    });
    const composition = await selectComposition({
      serveUrl,
      id: COMPOSITION_ID,
      inputProps,
      timeoutInMilliseconds,
    });

    await renderMedia({
      serveUrl,
      composition,
      codec: "h264",
      outputLocation,
      inputProps,
      hardwareAcceleration: renderSettings.hardwareAcceleration,
      timeoutInMilliseconds,
      concurrency,
      chromiumOptions: renderSettings.chromiumGl
        ? {gl: renderSettings.chromiumGl}
        : undefined,
      onProgress: ({progress}) => {
        process.stdout.write(`\rRendering ${Math.round(progress * 100)}%`);
      },
    });
  } finally {
    await cleanup();
  }

  process.stdout.write(`\nSaved ${outputLocation}\n`);
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
