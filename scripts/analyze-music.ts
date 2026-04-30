import {spawn} from "node:child_process";
import {writeFile} from "node:fs/promises";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

type Candidate = {
  start: number;
  duration: number;
  score: number;
  energy: number;
};

type AnalysisResult = {
  music: {
    src: string;
    start: number;
    duration: number;
    volume: number;
    sourceVolume: number;
    fadeSeconds: number;
    loop: boolean;
    enabled: boolean;
    detected: {
      score: number;
      audioDuration: number;
      candidates: Candidate[];
    };
  };
};

const SAMPLE_RATE = 11025;
const WINDOW_SECONDS = 0.5;
const WINDOW_SAMPLES = Math.round(SAMPLE_RATE * WINDOW_SECONDS);

const readFlag = (name: string) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};

const readNumberFlag = (name: string, fallback: number) => {
  const value = readFlag(name);
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const runBuffered = async (command: string, args: string[]) => {
  const child = spawn(command, args, {windowsHide: true});
  const chunks: Buffer[] = [];
  const errorChunks: Buffer[] = [];

  child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => errorChunks.push(chunk));

  const code = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });

  if (code !== 0) {
    throw new Error(
      Buffer.concat(errorChunks).toString("utf8").trim() ||
        `${path.basename(command)} failed with exit code ${code}`,
    );
  }

  return Buffer.concat(chunks);
};

const probeDuration = async (input: string) => {
  const ffprobe = ffprobeStatic.path || "ffprobe";
  const output = await runBuffered(ffprobe, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    input,
  ]);
  const duration = Number(output.toString("utf8").trim());
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error("Could not read music duration.");
  }

  return duration;
};

const decodeAudio = async (input: string) => {
  const ffmpeg = ffmpegPath || "ffmpeg";
  return runBuffered(ffmpeg, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-i",
    input,
    "-vn",
    "-ac",
    "1",
    "-ar",
    String(SAMPLE_RATE),
    "-f",
    "s16le",
    "pipe:1",
  ]);
};

const rmsWindows = (pcm: Buffer) => {
  const samples = Math.floor(pcm.length / 2);
  const windows: number[] = [];

  for (let offset = 0; offset < samples; offset += WINDOW_SAMPLES) {
    const end = Math.min(samples, offset + WINDOW_SAMPLES);
    let sum = 0;
    let count = 0;

    for (let sampleIndex = offset; sampleIndex < end; sampleIndex += 1) {
      const sample = pcm.readInt16LE(sampleIndex * 2) / 32768;
      sum += sample * sample;
      count += 1;
    }

    windows.push(count > 0 ? Math.sqrt(sum / count) : 0);
  }

  return windows;
};

const mean = (values: number[]) => {
  if (values.length === 0) {
    return 0;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const standardDeviation = (values: number[], average: number) => {
  if (values.length === 0) {
    return 0;
  }

  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) /
    values.length;
  return Math.sqrt(variance);
};

const rankCandidates = (
  windows: number[],
  audioDuration: number,
  targetDuration: number,
) => {
  const maxEnergy = Math.max(...windows, 0.0001);
  const windowCount = Math.max(1, Math.round(targetDuration / WINDOW_SECONDS));
  const candidates: Candidate[] = [];
  const maxStart = Math.max(0, windows.length - windowCount);

  for (let startIndex = 0; startIndex <= maxStart; startIndex += 1) {
    const start = startIndex * WINDOW_SECONDS;
    const end = start + targetDuration;
    const progress = audioDuration <= 0 ? 0 : start / audioDuration;

    if (start < 4 && audioDuration > 20) {
      continue;
    }

    if (audioDuration - end < Math.min(10, audioDuration * 0.08)) {
      continue;
    }

    const segment = windows.slice(startIndex, startIndex + windowCount);
    const avg = mean(segment);
    const peak = Math.max(...segment, 0);
    const std = standardDeviation(segment, avg);
    const movement =
      segment.length <= 1
        ? 0
        : mean(segment.slice(1).map((value, index) => Math.abs(value - segment[index])));
    const energy = avg / maxEnergy;
    const peakEnergy = peak / maxEnergy;
    const stability = avg <= 0 ? 0 : Math.max(0, 1 - std / avg);
    const movementScore = Math.min(1, movement / maxEnergy / 0.18);
    const positionBoost = Math.max(0, Math.sin(progress * Math.PI));
    const score =
      energy * 0.46 +
      peakEnergy * 0.18 +
      stability * 0.14 +
      movementScore * 0.1 +
      positionBoost * 0.12;

    candidates.push({
      start: Number(start.toFixed(3)),
      duration: Number(targetDuration.toFixed(3)),
      score: Number(score.toFixed(4)),
      energy: Number(energy.toFixed(4)),
    });
  }

  const selected: Candidate[] = [];
  for (const candidate of candidates.sort((a, b) => b.score - a.score)) {
    const overlaps = selected.some((item) => {
      const left = Math.max(item.start, candidate.start);
      const right = Math.min(
        item.start + item.duration,
        candidate.start + candidate.duration,
      );
      return Math.max(0, right - left) > targetDuration * 0.45;
    });

    if (!overlaps) {
      selected.push(candidate);
    }

    if (selected.length >= 5) {
      break;
    }
  }

  return selected;
};

const main = async () => {
  const input = readFlag("--input");
  const out = path.resolve(readFlag("--out") ?? ".tmp/music-analysis.json");
  const targetDuration = Math.max(
    3,
    Math.min(60, readNumberFlag("--target-duration", 18)),
  );

  if (!input) {
    throw new Error("--input is required.");
  }

  process.stdout.write("PROGRESS 10 Reading music metadata\n");
  const audioDuration = await probeDuration(input);
  const effectiveDuration = Math.max(3, Math.min(targetDuration, audioDuration));

  process.stdout.write("PROGRESS 25 Preparing audio decode\n");
  process.stdout.write("PROGRESS 40 Measuring music energy\n");
  const pcm = await decodeAudio(input);

  process.stdout.write("PROGRESS 75 Ranking the strongest music section\n");
  const candidates = rankCandidates(
    rmsWindows(pcm),
    audioDuration,
    effectiveDuration,
  );
  const best = candidates[0] ?? {
    start: 0,
    duration: Number(effectiveDuration.toFixed(3)),
    score: 0,
    energy: 0,
  };
  const result: AnalysisResult = {
    music: {
      src: path.resolve(input),
      start: best.start,
      duration: best.duration,
      volume: 0.35,
      sourceVolume: 0.75,
      fadeSeconds: 1,
      loop: true,
      enabled: true,
      detected: {
        score: best.score,
        audioDuration: Number(audioDuration.toFixed(3)),
        candidates,
      },
    },
  };

  process.stdout.write("PROGRESS 90 Saving music selection\n");
  await writeFile(out, `${JSON.stringify(result, null, 2)}\n`);
  process.stdout.write("PROGRESS 100 Music analysis complete\n");
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
