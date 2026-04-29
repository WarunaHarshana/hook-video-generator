import {execFile} from "node:child_process";
import {existsSync} from "node:fs";
import {readFile, writeFile} from "node:fs/promises";
import path from "node:path";
import {promisify} from "node:util";
import ffmpegPath from "ffmpeg-static";
import {path as ffprobePath} from "ffprobe-static";

type HighlightSegment = {
  start: number;
  duration: number;
};

type ProjectJson = {
  src: string;
  width: number;
  height: number;
  fps: number;
  duration: number;
  highlights: HighlightSegment[];
};

type ShotChange = {
  time: number;
  score: number;
};

type AudioFeatures = {
  loudnessScore: number;
  spikeScore: number;
  dialogueScore: number;
  audioScore: number;
};

type HookCandidate = {
  start: number;
  duration: number;
  target: number;
  bucketIndex: number;
  sceneScore: number;
  shotDensityScore: number;
  targetScore: number;
  motionScore: number;
  loudnessScore: number;
  spikeScore: number;
  dialogueScore: number;
  faceScore: number;
  audioScore: number;
  endScore: number;
  score: number;
};

const execFileAsync = promisify(execFile);
const maxBuffer = 1024 * 1024 * 32;

const readFlag = (name: string) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};

const readNumberFlag = (name: string, fallback: number) => {
  const value = readFlag(name);
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const progress = (percent: number, message: string) => {
  console.log(`PROGRESS ${Math.round(percent)} ${message}`);
};

const clamp = (value: number, min: number, max: number) => {
  return Math.min(Math.max(value, min), max);
};

const percentile = (values: number[], amount: number) => {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = clamp(Math.round((sorted.length - 1) * amount), 0, sorted.length - 1);

  return sorted[index];
};

const remotionCli = path.resolve("node_modules/@remotion/cli/remotion-cli.js");

const runCommand = async (command: string, args: string[]) => {
  const {stdout, stderr} = await execFileAsync(command, args, {maxBuffer});

  return `${stdout ?? ""}${stderr ?? ""}`;
};

const isMissingBinaryError = (error: unknown) => {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
};

const isPresentString = (value: string | null | undefined): value is string => {
  return typeof value === "string" && value.length > 0;
};

const runRemotionTool = async (tool: "ffmpeg" | "ffprobe", args: string[]) => {
  return runCommand(process.execPath, [remotionCli, tool, ...args]);
};

const runFfprobe = async (args: string[]) => {
  const candidates = [ffprobePath, "ffprobe"].filter(isPresentString);

  for (const candidate of candidates) {
    try {
      return await runCommand(candidate, args);
    } catch (error) {
      if (!isMissingBinaryError(error)) {
        throw error;
      }
    }
  }

  try {
    return await runRemotionTool("ffprobe", args);
  } catch (error) {
    throw error;
  }
};

const runFfmpeg = async (args: string[]) => {
  const candidates = [ffmpegPath, "ffmpeg"].filter(isPresentString);

  for (const candidate of candidates) {
    try {
      return await runCommand(candidate, args);
    } catch (error) {
      if (!isMissingBinaryError(error)) {
        throw error;
      }
    }
  }

  throw new Error("Could not find an ffmpeg binary for scene detection.");
};

const parseRate = (rate: string | undefined) => {
  if (!rate || rate === "0/0") {
    return 30;
  }

  if (!rate.includes("/")) {
    const parsed = Number(rate);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 30;
  }

  const [num, den] = rate.split("/").map(Number);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) {
    return 30;
  }

  return num / den;
};

const probeVideo = async (input: string) => {
  const output = await runFfprobe([
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_streams",
    "-show_format",
    input,
  ]);
  const metadata = JSON.parse(output) as {
    streams?: Array<{
      codec_type?: string;
      width?: number;
      height?: number;
      avg_frame_rate?: string;
      r_frame_rate?: string;
      duration?: string;
    }>;
    format?: {
      duration?: string;
    };
  };
  const videoStream = metadata.streams?.find(
    (stream) => stream.codec_type === "video",
  );

  if (!videoStream?.width || !videoStream?.height) {
    throw new Error("Could not find a video stream with width and height.");
  }

  const duration = Number(videoStream.duration ?? metadata.format?.duration);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Could not determine video duration.");
  }

  return {
    width: videoStream.width,
    height: videoStream.height,
    fps: parseRate(videoStream.avg_frame_rate ?? videoStream.r_frame_rate),
    duration,
  };
};

const loadHighlightsJson = async (highlightsPath: string) => {
  if (!existsSync(highlightsPath)) {
    return undefined;
  }

  const raw = await readFile(highlightsPath, "utf8");
  const parsed = JSON.parse(raw) as HighlightSegment[];
  if (!Array.isArray(parsed)) {
    throw new Error(`${highlightsPath} must contain an array of highlights.`);
  }

  return parsed
    .map((highlight) => ({
      start: Number(highlight.start),
      duration: Number(highlight.duration),
    }))
    .filter(
      (highlight) =>
        Number.isFinite(highlight.start) &&
        highlight.start >= 0 &&
        Number.isFinite(highlight.duration) &&
        highlight.duration > 0,
    );
};

const detectScenes = async (input: string, threshold: number): Promise<ShotChange[]> => {
  const output = await runFfmpeg([
    "-hide_banner",
    "-i",
    input,
    "-vf",
    `select='gt(scene,${threshold})',metadata=print:file=-,showinfo`,
    "-an",
    "-f",
    "null",
    "-",
  ]);

  const changes = new Map<string, ShotChange>();
  let pendingTime: number | undefined;

  for (const line of output.split(/\r?\n/)) {
    const time = Number(/pts_time:([0-9.]+)/.exec(line)?.[1]);
    if (Number.isFinite(time) && time >= 0) {
      pendingTime = time;
    }

    const score = Number(/lavfi\.scene_score=([0-9.]+)/.exec(line)?.[1]);
    if (!Number.isFinite(score) || score < 0) {
      continue;
    }

    const keyTime = pendingTime;
    if (typeof keyTime !== "number" || !Number.isFinite(keyTime) || keyTime < 0) {
      continue;
    }

    const key = keyTime.toFixed(3);
    const current = changes.get(key);
    if (!current || score > current.score) {
      changes.set(key, {time: keyTime, score});
    }
  }

  if (changes.size > 0) {
    return [...changes.values()].sort((a, b) => a.time - b.time);
  }

  const fallback = new Set<number>();
  for (const match of output.matchAll(/pts_time:([0-9.]+)/g)) {
    const time = Number(match[1]);
    if (Number.isFinite(time) && time >= 0) {
      fallback.add(time);
    }
  }

  return [...fallback]
    .sort((a, b) => a - b)
    .map((time) => ({time, score: threshold}));
};

const parseSilentSeconds = (output: string, duration: number) => {
  let silentSeconds = 0;

  for (const match of output.matchAll(/silence_duration:\s*([0-9.]+)/g)) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0) {
      silentSeconds += value;
    }
  }

  const openSilenceStartMatches = [...output.matchAll(/silence_start:\s*([0-9.]+)/g)];
  const openSilenceEndMatches = [...output.matchAll(/silence_end:\s*([0-9.]+)/g)];
  if (openSilenceStartMatches.length > openSilenceEndMatches.length) {
    const lastStart = Number(openSilenceStartMatches.at(-1)?.[1]);
    if (Number.isFinite(lastStart) && lastStart < duration) {
      silentSeconds += duration - lastStart;
    }
  }

  return clamp(silentSeconds, 0, duration);
};

const probeAudioFeatures = async (
  input: string,
  start: number,
  duration: number,
): Promise<AudioFeatures> => {
  try {
    const output = await runFfmpeg([
      "-hide_banner",
      "-ss",
      String(Math.max(0, start)),
      "-t",
      String(duration),
      "-i",
      input,
      "-vn",
      "-af",
      "volumedetect,silencedetect=n=-34dB:d=0.16",
      "-f",
      "null",
      "-",
    ]);
    const mean = Number(/mean_volume:\s*(-?[0-9.]+)\s*dB/.exec(output)?.[1]);
    const max = Number(/max_volume:\s*(-?[0-9.]+)\s*dB/.exec(output)?.[1]);

    if (!Number.isFinite(mean) && !Number.isFinite(max)) {
      return {
        loudnessScore: 0.45,
        spikeScore: 0.35,
        dialogueScore: 0.45,
        audioScore: 0.45,
      };
    }

    const meanScore = Number.isFinite(mean) ? clamp((mean + 42) / 34, 0, 1) : 0.45;
    const peakScore = Number.isFinite(max) ? clamp((max + 24) / 24, 0, 1) : 0.45;
    const crest = Number.isFinite(mean) && Number.isFinite(max) ? max - mean : 8;
    const silentSeconds = parseSilentSeconds(output, duration);
    const audibleRatio = 1 - silentSeconds / Math.max(duration, 0.1);
    const loudnessScore = clamp(meanScore * 0.58 + peakScore * 0.42, 0, 1);
    const spikeScore = clamp(
      peakScore * 0.55 + clamp((crest - 8) / 16, 0, 1) * 0.45,
      0,
      1,
    );
    const dialogueScore = clamp(
      audibleRatio * 0.7 + meanScore * 0.25 + (1 - spikeScore) * 0.05,
      0,
      1,
    );

    return {
      loudnessScore,
      spikeScore,
      dialogueScore,
      audioScore: clamp(
        loudnessScore * 0.42 + spikeScore * 0.28 + dialogueScore * 0.3,
        0,
        1,
      ),
    };
  } catch {
    return {
      loudnessScore: 0.45,
      spikeScore: 0.35,
      dialogueScore: 0.45,
      audioScore: 0.45,
    };
  }
};

const probeMotionScore = async (
  input: string,
  start: number,
  duration: number,
) => {
  try {
    const output = await runFfmpeg([
      "-hide_banner",
      "-ss",
      String(Math.max(0, start)),
      "-t",
      String(duration),
      "-i",
      input,
      "-vf",
      "fps=4,scale=160:-2,signalstats,metadata=print:file=-",
      "-an",
      "-f",
      "null",
      "-",
    ]);
    const diffs = [...output.matchAll(/lavfi\.signalstats\.[YUV]DIF=([0-9.]+)/g)]
      .map((match) => Number(match[1]))
      .filter((value) => Number.isFinite(value) && value >= 0);

    if (diffs.length === 0) {
      return 0.45;
    }

    const p75 = percentile(diffs, 0.75);
    const p90 = percentile(diffs, 0.9);

    return clamp(p75 / 10, 0, 1) * 0.65 + clamp(p90 / 18, 0, 1) * 0.35;
  } catch {
    return 0.45;
  }
};

const detectFaceFilterSupport = async () => {
  try {
    const output = await runFfmpeg(["-hide_banner", "-filters"]);

    return /\bfacedetect\b/.test(output);
  } catch {
    return false;
  }
};

const probeFaceScore = async (
  input: string,
  start: number,
  clipDuration: number,
) => {
  try {
    const output = await runFfmpeg([
      "-hide_banner",
      "-ss",
      String(Math.max(0, start)),
      "-t",
      String(clipDuration),
      "-i",
      input,
      "-vf",
      "fps=1,scale=320:-2,facedetect=neighbors=4:scale_factor=1.1,metadata=print:file=-",
      "-an",
      "-f",
      "null",
      "-",
    ]);
    const frames = new Set<string>();
    const faceFrames = new Set<string>();
    let currentFrame = "";

    for (const line of output.split(/\r?\n/)) {
      const frame = /frame:\s*([0-9]+)/.exec(line)?.[1];
      if (frame) {
        currentFrame = frame;
        frames.add(frame);
      }

      if (currentFrame && /lavfi\.facedetect\./.test(line)) {
        faceFrames.add(currentFrame);
      }
    }

    if (frames.size === 0) {
      return 0.45;
    }

    return clamp(faceFrames.size / frames.size, 0, 1);
  } catch {
    return 0.45;
  }
};

const shotChangeFeatures = (
  start: number,
  changes: ShotChange[],
  clipDuration: number,
) => {
  const lookAround = Math.max(clipDuration * 1.5, 10);
  const nearby = changes.filter(
    (change) =>
      change.time >= start - lookAround * 0.35 &&
      change.time <= start + lookAround,
  );
  const inClip = changes.filter(
    (change) => change.time >= start && change.time <= start + clipDuration,
  );
  const strongest = Math.max(0, ...inClip.map((change) => change.score));
  const density = nearby.reduce(
    (sum, change) => sum + clamp(change.score / 0.55, 0, 1),
    0,
  );

  return {
    sceneScore: clamp(strongest / 0.55, 0, 1),
    shotDensityScore: clamp(density / 6, 0, 1),
  };
};

const buildCandidatePool = ({
  shotChanges,
  clipDuration,
  maxClips,
  sourceDuration,
}: {
  shotChanges: ShotChange[];
  clipDuration: number;
  maxClips: number;
  sourceDuration: number;
}) => {
  const maxStart = Math.max(0, sourceDuration - clipDuration);
  const endAvoidSeconds = Math.min(
    45,
    Math.max(clipDuration * 2.5, sourceDuration * 0.08),
  );
  const preferredMaxStart =
    sourceDuration > clipDuration + endAvoidSeconds + 1
      ? Math.max(0, sourceDuration - clipDuration - endAvoidSeconds)
      : maxStart;
  const bucketStep = maxClips > 1 ? preferredMaxStart / (maxClips - 1) : 0;
  const timelineAnchors = Array.from({length: Math.max(maxClips * 3, 6)}, (_, index) => {
    const denominator = Math.max(maxClips * 3 - 1, 1);
    return preferredMaxStart * (index / denominator);
  });
  const candidates = [
    ...shotChanges.flatMap((change) => [
      change.time - Math.min(0.6, clipDuration * 0.2),
      change.time,
      change.time + Math.min(0.8, clipDuration * 0.25),
    ]),
    ...timelineAnchors,
  ]
    .map((timestamp) => Math.max(0, Math.min(timestamp, maxStart)))
    .filter((timestamp) => timestamp <= preferredMaxStart || preferredMaxStart === maxStart)
    .map((timestamp) => Number(timestamp.toFixed(3)));
  const uniqueCandidates = [...new Set(candidates)]
    .sort((a, b) => a - b);
  const pool: HookCandidate[] = [];
  const perBucketLimit = 6;

  for (let index = 0; index < maxClips; index += 1) {
    const target = bucketStep * index;
    const bucketStart = Math.max(0, target - bucketStep / 2);
    const bucketEnd = Math.min(preferredMaxStart, target + bucketStep / 2);
    const bucketCandidates = uniqueCandidates.filter(
      (candidate) => candidate >= bucketStart && candidate <= bucketEnd,
    );
    const starts = bucketCandidates.length > 0 ? bucketCandidates : [target];
    const ranked = starts
      .map((start) => {
        const targetScore =
          bucketStep === 0
            ? 1
            : 1 - clamp(Math.abs(start - target) / Math.max(bucketStep / 2, 1), 0, 1);
        const {sceneScore, shotDensityScore} = shotChangeFeatures(
          start,
          shotChanges,
          clipDuration,
        );
        const endScore =
          maxStart === 0
            ? 1
            : 1 - clamp(
                (start - preferredMaxStart) / Math.max(maxStart - preferredMaxStart, 1),
                0,
                0.7,
              );
        const earlyRevealScore = 1 - clamp(start / Math.max(sourceDuration * 0.72, 1), 0, 0.25);

        return {
          start,
          duration: Math.min(clipDuration, sourceDuration - start),
          target,
          bucketIndex: index,
          sceneScore,
          shotDensityScore,
          targetScore,
          motionScore: 0.45,
          loudnessScore: 0.45,
          spikeScore: 0.35,
          dialogueScore: 0.45,
          faceScore: 0.45,
          audioScore: 0.45,
          endScore,
          score:
            (sceneScore * 0.28 +
              shotDensityScore * 0.3 +
              targetScore * 0.22 +
              earlyRevealScore * 0.2) *
            endScore,
        };
      })
      .filter((candidate) => candidate.duration > 0.25)
      .sort((a, b) => b.score - a.score)
      .slice(0, perBucketLimit);

    pool.push(...ranked);
  }

  return pool;
};

const scoreCandidates = async ({
  input,
  candidates,
  clipDuration,
  useFaceDetection,
}: {
  input: string;
  candidates: HookCandidate[];
  clipDuration: number;
  useFaceDetection: boolean;
}) => {
  const scored: HookCandidate[] = [];
  const total = candidates.length || 1;

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const [audio, motionScore, faceScore] = await Promise.all([
      probeAudioFeatures(input, candidate.start, clipDuration),
      probeMotionScore(input, candidate.start, clipDuration),
      useFaceDetection
        ? probeFaceScore(input, candidate.start, clipDuration)
        : Promise.resolve(0.45),
    ]);
    const faceDialogueScore = useFaceDetection
      ? audio.dialogueScore * 0.62 + faceScore * 0.38
      : audio.dialogueScore;
    const openingPenalty = candidate.start < clipDuration * 0.7 ? 0.72 : 1;
    const score =
      candidate.sceneScore * 0.1 +
      candidate.shotDensityScore * 0.12 +
      motionScore * 0.2 +
      audio.loudnessScore * 0.15 +
      audio.spikeScore * 0.13 +
      faceDialogueScore * 0.19 +
      candidate.targetScore * 0.11;

    scored.push({
      ...candidate,
      motionScore,
      loudnessScore: audio.loudnessScore,
      spikeScore: audio.spikeScore,
      dialogueScore: audio.dialogueScore,
      faceScore,
      audioScore: audio.audioScore,
      score: score * candidate.endScore * openingPenalty,
    });

    progress(
      48 + (index / total) * 32,
      `Scoring hooks: ${index + 1}/${candidates.length} audio, motion, dialogue`,
    );
  }

  return scored;
};

const selectDiverseHighlights = ({
  candidates,
  clipDuration,
  maxClips,
}: {
  candidates: HookCandidate[];
  clipDuration: number;
  maxClips: number;
}) => {
  const bestByBucket = new Map<number, HookCandidate>();

  for (const candidate of candidates) {
    const current = bestByBucket.get(candidate.bucketIndex);
    if (!current || candidate.score > current.score) {
      bestByBucket.set(candidate.bucketIndex, candidate);
    }
  }

  const selected: HookCandidate[] = [...bestByBucket.values()].sort(
    (a, b) => a.bucketIndex - b.bucketIndex,
  );
  const minDistance = Math.max(clipDuration * 1.35, 12);

  for (const candidate of [...candidates].sort((a, b) => b.score - a.score)) {
    if (selected.length >= maxClips) {
      break;
    }

    const alreadySelected = selected.some(
      (item) => item.bucketIndex === candidate.bucketIndex,
    );
    if (alreadySelected) {
      continue;
    }

    const tooClose = selected.some(
      (item) => Math.abs(item.start - candidate.start) < minDistance,
    );

    if (tooClose) {
      continue;
    }

    selected.push(candidate);
  }

  if (selected.length < maxClips) {
    for (const candidate of [...candidates].sort((a, b) => a.target - b.target)) {
      const alreadySelected = selected.some((item) => item.start === candidate.start);
      if (!alreadySelected) {
        selected.push(candidate);
      }

      if (selected.length >= maxClips) {
        break;
      }
    }
  }

  return selected
    .slice(0, maxClips)
    .sort((a, b) => a.start - b.start)
    .map((candidate) => ({
      start: Number(candidate.start.toFixed(3)),
      duration: Number(candidate.duration.toFixed(3)),
    }));
};

const sceneTimestampsToHighlights = async ({
  input,
  shotChanges,
  clipDuration,
  maxClips,
  sourceDuration,
}: {
  input: string;
  shotChanges: ShotChange[];
  clipDuration: number;
  maxClips: number;
  sourceDuration: number;
}) => {
  const pool = buildCandidatePool({
    shotChanges,
    clipDuration,
    maxClips,
    sourceDuration,
  });

  progress(45, `Built ${pool.length} hook candidates away from the ending`);

  const useFaceDetection = await detectFaceFilterSupport();
  progress(
    47,
    useFaceDetection
      ? "Face detection available; adding face/dialogue signal"
      : "Face detection unavailable; using dialogue signal",
  );

  const scored = await scoreCandidates({
    input,
    candidates: pool,
    clipDuration,
    useFaceDetection,
  });

  progress(84, "Selecting strongest diverse hook moments");

  return selectDiverseHighlights({
    candidates: scored,
    clipDuration,
    maxClips,
  });
};

const main = async () => {
  const input = readFlag("--input");
  if (!input) {
    throw new Error(
      "Usage: npm run analyze -- --input path/to/source.mp4 [--highlights highlights.json] [--out project.json]",
    );
  }

  const inputPath = path.resolve(input);
  const outputPath = path.resolve(readFlag("--out") ?? "project.json");
  const highlightsPath = path.resolve(readFlag("--highlights") ?? "highlights.json");
  const maxClips = Math.max(1, Math.round(readNumberFlag("--max-clips", 8)));
  const clipDuration = readNumberFlag("--clip-duration", 3);
  const sceneThreshold = readNumberFlag("--scene-threshold", 0.32);

  progress(5, "Reading source metadata");
  const metadata = await probeVideo(inputPath);
  progress(16, "Checking highlights file");
  const highlightsFromFile = await loadHighlightsJson(highlightsPath);
  progress(24, "Detecting shot changes and scene strength");
  const shotChanges =
    highlightsFromFile && highlightsFromFile.length > 0
      ? []
      : await detectScenes(inputPath, sceneThreshold);
  progress(
    42,
    shotChanges.length > 0
      ? `Found ${shotChanges.length} shot-change candidates`
      : "No shot changes found, using timeline anchors",
  );
  const highlights =
    highlightsFromFile && highlightsFromFile.length > 0
      ? highlightsFromFile
      : await sceneTimestampsToHighlights({
          input: inputPath,
          shotChanges,
          clipDuration,
          maxClips,
          sourceDuration: metadata.duration,
        });

  const project: ProjectJson = {
    src: inputPath,
    width: metadata.width,
    height: metadata.height,
    fps: metadata.fps,
    duration: metadata.duration,
    highlights,
  };

  await writeFile(outputPath, `${JSON.stringify(project, null, 2)}\n`);
  progress(100, "Saved hook project");
  console.log(`Saved ${outputPath}`);
  console.log(
    `Detected ${metadata.width}x${metadata.height} at ${metadata.fps.toFixed(
      3,
    )} fps with ${highlights.length} highlight(s).`,
  );
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
