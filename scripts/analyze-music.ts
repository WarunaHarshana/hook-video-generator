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

type BeatEvent = {
  time: number;
  strength: number;
};

type BeatSyncIntensity = "loose" | "tight" | "fast";

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
    useEntireFile: boolean;
    beats: number[];
    beatEvents: BeatEvent[];
    beatSync: {
      enabled: boolean;
      intensity: BeatSyncIntensity;
    };
    detected: {
      score: number;
      audioDuration: number;
      beatCount: number;
      averageBeatGap: number;
      suggestedBeatStyle: BeatSyncIntensity;
      candidates: Candidate[];
    };
  };
};

const SAMPLE_RATE = 11025;
const WINDOW_SECONDS = 0.5;
const WINDOW_SAMPLES = Math.round(SAMPLE_RATE * WINDOW_SECONDS);
const BEAT_WINDOW_SECONDS = 0.05;
const BEAT_WINDOW_SAMPLES = Math.round(SAMPLE_RATE * BEAT_WINDOW_SECONDS);

const readFlag = (name: string) => {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
};

const readNumberFlag = (name: string, fallback: number) => {
  const value = readFlag(name);
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const readBooleanFlag = (name: string) => {
  return process.argv.includes(name);
};

const clamp = (value: number, min: number, max: number) => {
  return Math.min(Math.max(value, min), max);
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

const rmsWindows = (pcm: Buffer, windowSamples = WINDOW_SAMPLES) => {
  const samples = Math.floor(pcm.length / 2);
  const windows: number[] = [];

  for (let offset = 0; offset < samples; offset += windowSamples) {
    const end = Math.min(samples, offset + windowSamples);
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

const median = (values: number[]) => {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1] + sorted[middle]) / 2
    : sorted[middle];
};

const normalizeBeatEvents = (
  events: Array<{time: number; rawStrength: number}>,
) => {
  const maxStrength = Math.max(
    ...events.map((event) => event.rawStrength),
    0.0001,
  );

  return events.map((event) => ({
    time: Number(event.time.toFixed(3)),
    strength: Number(clamp(event.rawStrength / maxStrength, 0.18, 1).toFixed(3)),
  }));
};

const detectBeatEvents = (pcm: Buffer, audioDuration: number): BeatEvent[] => {
  const energy = rmsWindows(pcm, BEAT_WINDOW_SAMPLES);
  if (energy.length < 8) {
    return [];
  }

  const maxEnergy = Math.max(...energy, 0.0001);
  const novelty = energy.map((value, index) => {
    const previous = energy.slice(Math.max(0, index - 6), index);
    const localAverage = previous.length > 0 ? mean(previous) : value;
    return Math.max(0, value - localAverage);
  });
  const average = mean(novelty);
  const deviation = standardDeviation(novelty, average);
  const threshold = average + deviation * 0.72;
  const beats: Array<{time: number; rawStrength: number}> = [];
  const minGap = 0.24;

  for (let index = 1; index < novelty.length - 1; index += 1) {
    const current = novelty[index];
    const isPeak = current >= novelty[index - 1] && current > novelty[index + 1];
    const isAudible = energy[index] / maxEnergy > 0.06;
    const time = index * BEAT_WINDOW_SECONDS;

    if (!isPeak || !isAudible || current < threshold || time > audioDuration) {
      continue;
    }

    const rawStrength = current + (energy[index] / maxEnergy) * 0.35;
    const previousBeat = beats.at(-1);
    if (previousBeat && time - previousBeat.time < minGap) {
      if (rawStrength > previousBeat.rawStrength) {
        beats[beats.length - 1] = {time, rawStrength};
      }
      continue;
    }

    beats.push({time, rawStrength});
  }

  if (beats.length >= 4) {
    return normalizeBeatEvents(beats);
  }

  const fallback = energy
    .map((value, index) => ({
      time: index * BEAT_WINDOW_SECONDS,
      value,
    }))
    .filter((item, index, items) => {
      const previous = items[index - 1]?.value ?? 0;
      const next = items[index + 1]?.value ?? 0;
      return item.value >= previous && item.value > next && item.value / maxEnergy > 0.24;
    })
    .sort((a, b) => b.value - a.value)
    .reduce<Array<{time: number; rawStrength: number}>>((selected, item) => {
      if (selected.every((beat) => Math.abs(beat.time - item.time) >= minGap)) {
        selected.push({time: item.time, rawStrength: item.value});
      }

      return selected;
    }, [])
    .sort((a, b) => a.time - b.time);

  return normalizeBeatEvents(fallback);
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

const suggestBeatStyle = (
  beats: number[],
  selectedStart: number,
  selectedDuration: number,
): {intensity: BeatSyncIntensity; averageGap: number; beatCount: number} => {
  const selectedBeats = beats.filter(
    (beat) => beat >= selectedStart && beat <= selectedStart + selectedDuration,
  );

  if (selectedBeats.length < 2) {
    return {intensity: "tight", averageGap: 0, beatCount: selectedBeats.length};
  }

  const gaps = selectedBeats
    .slice(1)
    .map((beat, index) => beat - selectedBeats[index])
    .filter((gap) => Number.isFinite(gap) && gap > 0);
  const averageGap = median(gaps);
  const beatsPerSecond =
    selectedDuration > 0 ? selectedBeats.length / selectedDuration : 0;

  if (averageGap <= 0.58 || beatsPerSecond >= 1.85) {
    return {
      intensity: "fast",
      averageGap: Number(averageGap.toFixed(3)),
      beatCount: selectedBeats.length,
    };
  }

  if (averageGap >= 1.05 || beatsPerSecond <= 0.9) {
    return {
      intensity: "loose",
      averageGap: Number(averageGap.toFixed(3)),
      beatCount: selectedBeats.length,
    };
  }

  return {
    intensity: "tight",
    averageGap: Number(averageGap.toFixed(3)),
    beatCount: selectedBeats.length,
  };
};

const main = async () => {
  const input = readFlag("--input");
  const out = path.resolve(readFlag("--out") ?? ".tmp/music-analysis.json");
  const targetDuration = Math.max(
    3,
    Math.min(60, readNumberFlag("--target-duration", 18)),
  );
  const useEntireFile = readBooleanFlag("--use-entire-file");

  if (!input) {
    throw new Error("--input is required.");
  }

  process.stdout.write("PROGRESS 10 Reading music metadata\n");
  const audioDuration = await probeDuration(input);
  const effectiveDuration = useEntireFile
    ? audioDuration
    : Math.max(3, Math.min(targetDuration, audioDuration));

  process.stdout.write("PROGRESS 25 Preparing audio decode\n");
  process.stdout.write("PROGRESS 40 Measuring music energy\n");
  const pcm = await decodeAudio(input);
  const beatEvents = detectBeatEvents(pcm, audioDuration);
  const beats = beatEvents.map((beat) => beat.time);

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
  const selectedStart = useEntireFile ? 0 : best.start;
  const selectedDuration = useEntireFile
    ? Number(audioDuration.toFixed(3))
    : best.duration;
  const beatStyle = suggestBeatStyle(beats, selectedStart, selectedDuration);
  const result: AnalysisResult = {
    music: {
      src: path.resolve(input),
      start: selectedStart,
      duration: selectedDuration,
      volume: 0.35,
      sourceVolume: 0.75,
      fadeSeconds: 1,
      loop: true,
      enabled: true,
      useEntireFile,
      beats,
      beatEvents,
      beatSync: {
        enabled: false,
        intensity: beatStyle.intensity,
      },
      detected: {
        score: best.score,
        audioDuration: Number(audioDuration.toFixed(3)),
        beatCount: beatStyle.beatCount,
        averageBeatGap: beatStyle.averageGap,
        suggestedBeatStyle: beatStyle.intensity,
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
