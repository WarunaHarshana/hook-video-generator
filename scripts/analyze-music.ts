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
type EditEnergy = "calm" | "balanced" | "aggressive";
type MusicSectionType = "intro" | "verse" | "build" | "drop" | "outro";
type MusicTempo = "slow" | "medium" | "fast";
type MusicEnergyCurve = "steady" | "slow-to-fast" | "fast-to-slow" | "mixed";
type MusicEffectEventType = "pulse" | "flash" | "impact" | "whip";
type MusicCutRole = "beat" | "strong" | "drop" | "fill" | "transition";
type EffectPreset =
  | "clean"
  | "auto"
  | "smooth-documentary"
  | "whip-cut"
  | "drop-burst"
  | "cinematic-ramp"
  | "hard-beat-cuts"
  | "smooth-slow"
  | "fast-kinetic"
  | "slow-fast-mix"
  | "beat-punch"
  | "flash-cuts"
  | "impact-shake";

type MusicSection = {
  start: number;
  end: number;
  type: MusicSectionType;
  energy: number;
  density: number;
};

type MusicCutPoint = {
  time: number;
  strength: number;
  sectionType: MusicSectionType;
  role: MusicCutRole;
};

type MusicEffectEvent = {
  time: number;
  type: MusicEffectEventType;
  strength: number;
  duration: number;
};

type MusicEditPlan = {
  tempo: MusicTempo;
  energyCurve: MusicEnergyCurve;
  sections: MusicSection[];
  cutPoints: MusicCutPoint[];
  effectEvents: MusicEffectEvent[];
};

type AnalysisResult = {
  music: {
    src: string;
    start: number;
    duration: number;
    volume: number;
    sourceVolume: number;
    muteSourceAudio?: boolean;
    fadeSeconds: number;
    loop: boolean;
    enabled: boolean;
    useEntireFile: boolean;
    beats: number[];
    beatEvents: BeatEvent[];
    beatSync: {
      enabled: boolean;
      intensity: BeatSyncIntensity;
      editEnergy: EditEnergy;
    };
    editPlan: MusicEditPlan;
    detected: {
      score: number;
      audioDuration: number;
      beatCount: number;
      averageBeatGap: number;
      suggestedBeatStyle: BeatSyncIntensity;
      suggestedEditEnergy: EditEnergy;
      paceShift: number;
      suggestedEffectPreset: EffectPreset;
      effectReason: string;
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

const selectedBeatGaps = (
  beats: number[],
  selectedStart: number,
  selectedDuration: number,
) => {
  const selectedBeats = beats.filter(
    (beat) => beat >= selectedStart && beat <= selectedStart + selectedDuration,
  );

  return selectedBeats
    .slice(1)
    .map((beat, index) => ({
      gap: beat - selectedBeats[index],
      midpoint: selectedBeats[index] + (beat - selectedBeats[index]) / 2,
    }))
    .filter((item) => Number.isFinite(item.gap) && item.gap > 0.08);
};

const windowsForRange = (
  windows: number[],
  absoluteStart: number,
  absoluteEnd: number,
) => {
  const startIndex = Math.max(0, Math.floor(absoluteStart / WINDOW_SECONDS));
  const endIndex = Math.min(
    windows.length,
    Math.max(startIndex + 1, Math.ceil(absoluteEnd / WINDOW_SECONDS)),
  );

  return windows.slice(startIndex, endIndex);
};

const localBeatEvents = (
  beatEvents: BeatEvent[],
  selectedStart: number,
  selectedDuration: number,
) => {
  const end = selectedStart + selectedDuration;

  return beatEvents
    .filter((beat) => beat.time >= selectedStart && beat.time <= end)
    .map((beat) => ({
      time: Number((beat.time - selectedStart).toFixed(3)),
      strength: clamp(beat.strength, 0.18, 1),
    }))
    .filter((beat) => beat.time >= 0 && beat.time <= selectedDuration)
    .sort((a, b) => a.time - b.time);
};

const sectionTypeForBin = ({
  index,
  count,
  energy,
  previousEnergy,
  maxEnergy,
}: {
  index: number;
  count: number;
  energy: number;
  previousEnergy: number;
  maxEnergy: number;
}): MusicSectionType => {
  if (index === count - 1 && energy < maxEnergy * 0.72) {
    return "outro";
  }

  if (energy >= maxEnergy * 0.9 && index > 0) {
    return "drop";
  }

  if (index > 0 && energy - previousEnergy >= 0.12) {
    return "build";
  }

  if (index === 0 && energy < 0.48) {
    return "intro";
  }

  return "verse";
};

const energyCurveForSections = (sections: MusicSection[]): MusicEnergyCurve => {
  if (sections.length < 2) {
    return "steady";
  }

  const first = mean(sections.slice(0, Math.ceil(sections.length / 3)).map((section) => section.energy));
  const last = mean(sections.slice(-Math.ceil(sections.length / 3)).map((section) => section.energy));
  const energies = sections.map((section) => section.energy);
  const deviation = standardDeviation(energies, mean(energies));
  const hasBuildDrop = sections.some((section) => section.type === "build") &&
    sections.some((section) => section.type === "drop");

  if (last - first >= 0.16 || hasBuildDrop) {
    return "slow-to-fast";
  }

  if (first - last >= 0.16) {
    return "fast-to-slow";
  }

  if (deviation >= 0.16) {
    return "mixed";
  }

  return "steady";
};

const tempoFromBeatStyle = (beatStyle: BeatSyncIntensity): MusicTempo => {
  if (beatStyle === "fast") {
    return "fast";
  }

  if (beatStyle === "loose") {
    return "slow";
  }

  return "medium";
};

const sectionAtTime = (sections: MusicSection[], time: number) => {
  return sections.find((section) => time >= section.start && time < section.end) ??
    sections.at(-1);
};

const minCutGapForSection = (
  section: MusicSection | undefined,
  tempo: MusicTempo,
) => {
  if (!section) {
    return tempo === "fast" ? 0.48 : tempo === "slow" ? 1.15 : 0.72;
  }

  if (section.type === "drop") {
    return tempo === "fast" ? 0.34 : 0.48;
  }

  if (section.type === "build") {
    return tempo === "fast" ? 0.42 : 0.62;
  }

  if (section.type === "intro" || section.type === "outro") {
    return tempo === "fast" ? 0.9 : 1.35;
  }

  return tempo === "fast" ? 0.58 : tempo === "slow" ? 1.2 : 0.82;
};

const roleForCutPoint = ({
  time,
  strength,
  section,
  lastCut,
}: {
  time: number;
  strength: number;
  section: MusicSection | undefined;
  lastCut: number;
}): MusicCutRole => {
  if (time <= 0.08 || section?.type === "intro") {
    return "transition";
  }

  if (section?.type === "drop") {
    return strength >= 0.72 ? "drop" : "strong";
  }

  if (section?.type === "build") {
    return strength >= 0.7 ? "strong" : "fill";
  }

  if (time - lastCut <= 0.42) {
    return "fill";
  }

  if (strength >= 0.74) {
    return "strong";
  }

  return "beat";
};

const addEffectEvent = (
  events: MusicEffectEvent[],
  next: MusicEffectEvent,
  cooldown: number,
) => {
  const previousSameType = [...events]
    .reverse()
    .find((event) => event.type === next.type);

  if (previousSameType && next.time - previousSameType.time < cooldown) {
    if (next.strength > previousSameType.strength) {
      previousSameType.time = next.time;
      previousSameType.strength = next.strength;
      previousSameType.duration = next.duration;
    }
    return;
  }

  events.push(next);
};

const buildMusicEditPlan = ({
  windows,
  beatEvents,
  selectedStart,
  selectedDuration,
  beatStyle,
}: {
  windows: number[];
  beatEvents: BeatEvent[];
  selectedStart: number;
  selectedDuration: number;
  beatStyle: BeatSyncIntensity;
}): MusicEditPlan => {
  const tempo = tempoFromBeatStyle(beatStyle);
  const localBeats = localBeatEvents(beatEvents, selectedStart, selectedDuration);
  const sectionCount = clamp(Math.round(selectedDuration / 8), 3, 7);
  const sectionLength = selectedDuration / sectionCount;
  const maxWindowEnergy = Math.max(...windows, 0.0001);
  const sections: MusicSection[] = [];

  for (let index = 0; index < sectionCount; index += 1) {
    const start = index * sectionLength;
    const end = index === sectionCount - 1 ? selectedDuration : (index + 1) * sectionLength;
    const segment = windowsForRange(
      windows,
      selectedStart + start,
      selectedStart + end,
    );
    const energy = clamp(mean(segment) / maxWindowEnergy, 0, 1);
    const density = clamp(
      localBeats.filter((beat) => beat.time >= start && beat.time < end).length /
        Math.max(0.1, end - start) /
        2.2,
      0,
      1,
    );
    const previousEnergy = sections.at(-1)?.energy ?? energy;
    const maxEnergy = Math.max(energy, ...sections.map((section) => section.energy), 0.0001);

    sections.push({
      start: Number(start.toFixed(3)),
      end: Number(end.toFixed(3)),
      type: sectionTypeForBin({
        index,
        count: sectionCount,
        energy,
        previousEnergy,
        maxEnergy,
      }),
      energy: Number(energy.toFixed(3)),
      density: Number(density.toFixed(3)),
    });
  }

  const energyCurve = energyCurveForSections(sections);
  const cutPoints: MusicCutPoint[] = [{
    time: 0,
    strength: 1,
    sectionType: sections[0]?.type ?? "intro",
    role: "transition",
  }];
  let lastCut = 0;

  for (const beat of localBeats) {
    if (beat.time <= 0.08 || beat.time >= selectedDuration - 0.08) {
      continue;
    }

    const section = sectionAtTime(sections, beat.time);
    const minGap = minCutGapForSection(section, tempo);
    const sectionBoost =
      section?.type === "drop"
        ? 0.16
        : section?.type === "build"
          ? 0.08
          : section?.type === "intro" || section?.type === "outro"
            ? -0.08
            : 0;
    const strength = clamp(beat.strength * 0.72 + (section?.energy ?? 0.5) * 0.28 + sectionBoost, 0, 1);

    if (beat.time - lastCut < minGap && strength < 0.82) {
      continue;
    }

    cutPoints.push({
      time: Number(beat.time.toFixed(3)),
      strength: Number(strength.toFixed(3)),
      sectionType: section?.type ?? "verse",
      role: roleForCutPoint({
        time: beat.time,
        strength,
        section,
        lastCut,
      }),
    });
    lastCut = beat.time;
  }

  const effectEvents: MusicEffectEvent[] = [];
  for (const beat of localBeats) {
    const section = sectionAtTime(sections, beat.time);
    const sectionEnergy = section?.energy ?? 0.5;
    const strength = clamp(beat.strength * 0.7 + sectionEnergy * 0.3, 0, 1);

    if (strength >= 0.34) {
      addEffectEvent(
        effectEvents,
        {
          time: Number(beat.time.toFixed(3)),
          type: "pulse",
          strength: Number(strength.toFixed(3)),
          duration: section?.type === "intro" ? 0.5 : 0.34,
        },
        tempo === "fast" ? 0.25 : 0.34,
      );
    }

    if ((section?.type === "build" || section?.type === "drop") && strength >= 0.58) {
      addEffectEvent(
        effectEvents,
        {
          time: Number(beat.time.toFixed(3)),
          type: "whip",
          strength: Number(strength.toFixed(3)),
          duration: 0.22,
        },
        tempo === "fast" ? 0.55 : 0.78,
      );
    }

    if (strength >= 0.72 || section?.type === "drop") {
      addEffectEvent(
        effectEvents,
        {
          time: Number(beat.time.toFixed(3)),
          type: "impact",
          strength: Number(strength.toFixed(3)),
          duration: 0.32,
        },
        1.15,
      );
    }

    if (section?.type === "drop" && strength >= 0.78) {
      addEffectEvent(
        effectEvents,
        {
          time: Number(beat.time.toFixed(3)),
          type: "flash",
          strength: Number((strength * 0.7).toFixed(3)),
          duration: 0.16,
        },
        1.6,
      );
    }
  }

  return {
    tempo,
    energyCurve,
    sections,
    cutPoints: cutPoints.slice(0, 120),
    effectEvents: effectEvents
      .sort((a, b) => a.time - b.time)
      .slice(0, 240),
  };
};

const suggestEditEnergy = ({
  beatStyle,
  selectedDuration,
  editPlan,
}: {
  beatStyle: BeatSyncIntensity;
  selectedDuration: number;
  editPlan: MusicEditPlan;
}): EditEnergy => {
  const cutRate = editPlan.cutPoints.length / Math.max(1, selectedDuration);
  const effectRate = editPlan.effectEvents.length / Math.max(1, selectedDuration);
  const dropSections = editPlan.sections.filter((section) => section.type === "drop");
  const buildSections = editPlan.sections.filter((section) => section.type === "build");
  const averageDensity = mean(editPlan.sections.map((section) => section.density));
  const averageEnergy = mean(editPlan.sections.map((section) => section.energy));
  const strongCutRatio =
    editPlan.cutPoints.length === 0
      ? 0
      : editPlan.cutPoints.filter((cut) =>
          cut.role === "strong" || cut.role === "drop" || cut.strength >= 0.76,
        ).length / editPlan.cutPoints.length;
  const hasDropBuild = dropSections.length > 0 || buildSections.length > 1;
  const intensityScore =
    (beatStyle === "fast" ? 0.28 : beatStyle === "loose" ? -0.18 : 0) +
    clamp(cutRate / 1.4, 0, 1) * 0.24 +
    clamp(effectRate / 2.2, 0, 1) * 0.16 +
    clamp(averageDensity, 0, 1) * 0.14 +
    clamp(averageEnergy, 0, 1) * 0.1 +
    strongCutRatio * 0.16 +
    (hasDropBuild ? 0.12 : 0) +
    (editPlan.energyCurve === "slow-to-fast" ? 0.08 : 0);

  if (intensityScore >= 0.72) {
    return "aggressive";
  }

  if (
    intensityScore <= 0.38 ||
    beatStyle === "loose" ||
    (cutRate < 0.75 && strongCutRatio < 0.3)
  ) {
    return "calm";
  }

  return "balanced";
};

const suggestEffectPreset = ({
  beats,
  selectedStart,
  selectedDuration,
  beatStyle,
  energy,
}: {
  beats: number[];
  selectedStart: number;
  selectedDuration: number;
  beatStyle: BeatSyncIntensity;
  energy: number;
}): {preset: EffectPreset; paceShift: number; reason: string} => {
  const gaps = selectedBeatGaps(beats, selectedStart, selectedDuration);
  const midpoint = selectedStart + selectedDuration / 2;
  const firstHalfGap = median(
    gaps.filter((item) => item.midpoint < midpoint).map((item) => item.gap),
  );
  const secondHalfGap = median(
    gaps.filter((item) => item.midpoint >= midpoint).map((item) => item.gap),
  );
  const paceShift =
    firstHalfGap > 0 && secondHalfGap > 0
      ? Number((firstHalfGap - secondHalfGap).toFixed(3))
      : 0;

  if (paceShift >= 0.18 && secondHalfGap > 0 && secondHalfGap <= 0.82) {
    return {
      preset: "cinematic-ramp",
      paceShift,
      reason: "music starts slower and gets denser later",
    };
  }

  if (beatStyle === "fast") {
    return {
      preset: energy >= 0.55 ? "drop-burst" : "whip-cut",
      paceShift,
      reason: "music has dense, fast beats",
    };
  }

  if (beatStyle === "loose") {
    return {
      preset: "smooth-documentary",
      paceShift,
      reason: "music has slower spacing between beats",
    };
  }

  if (energy >= 0.42) {
    return {
      preset: "beat-punch",
      paceShift,
      reason: "music has enough energy for punchy cut accents",
    };
  }

  return {
    preset: "auto",
    paceShift,
    reason: "music pacing is balanced, so Auto director can adapt per clip",
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
  const windows = rmsWindows(pcm);
  const beatEvents = detectBeatEvents(pcm, audioDuration);
  const beats = beatEvents.map((beat) => beat.time);

  process.stdout.write("PROGRESS 70 Ranking the strongest music section\n");
  const candidates = rankCandidates(
    windows,
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
  const effect = suggestEffectPreset({
    beats,
    selectedStart,
    selectedDuration,
    beatStyle: beatStyle.intensity,
    energy: best.energy,
  });
  process.stdout.write("PROGRESS 82 Building music edit plan\n");
  const editPlan = buildMusicEditPlan({
    windows,
    beatEvents,
    selectedStart,
    selectedDuration,
    beatStyle: beatStyle.intensity,
  });
  const suggestedEditEnergy = suggestEditEnergy({
    beatStyle: beatStyle.intensity,
    selectedDuration,
    editPlan,
  });
  const result: AnalysisResult = {
    music: {
      src: path.resolve(input),
      start: selectedStart,
      duration: selectedDuration,
      volume: 0.35,
      sourceVolume: 0.75,
      muteSourceAudio: false,
      fadeSeconds: 1,
      loop: true,
      enabled: true,
      useEntireFile,
      beats,
      beatEvents,
      beatSync: {
        enabled: true,
        intensity: beatStyle.intensity,
        editEnergy: suggestedEditEnergy,
      },
      editPlan,
      detected: {
        score: best.score,
        audioDuration: Number(audioDuration.toFixed(3)),
        beatCount: beatStyle.beatCount,
        averageBeatGap: beatStyle.averageGap,
        suggestedBeatStyle: beatStyle.intensity,
        suggestedEditEnergy,
        paceShift: effect.paceShift,
        suggestedEffectPreset: effect.preset,
        effectReason: effect.reason,
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
