import React from "react";
import {
  AbsoluteFill,
  Audio,
  Easing,
  interpolate,
  OffthreadVideo,
  Sequence,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export type HighlightSegment = {
  start: number;
  duration: number;
};

export type OutputAspectRatio = "source" | "9:16" | "1:1" | "4:5" | "16:9";
export type ReframeMode = "none" | "auto";
export type ColorEnhancement = "off" | "hdr-natural" | "hdr-vivid";
export type BeatSyncIntensity = "loose" | "tight" | "fast";
export type EditEnergy = "calm" | "balanced" | "aggressive";
export type EffectPreset =
  | "clean"
  | "auto"
  | "smooth-slow"
  | "fast-kinetic"
  | "slow-fast-mix"
  | "beat-punch"
  | "flash-cuts"
  | "impact-shake";

export type BeatEvent = {
  time: number;
  strength: number;
};

export type MusicSectionType = "intro" | "verse" | "build" | "drop" | "outro";
export type MusicTempo = "slow" | "medium" | "fast";
export type MusicEnergyCurve = "steady" | "slow-to-fast" | "fast-to-slow" | "mixed";
export type MusicEffectEventType = "pulse" | "flash" | "impact" | "whip";
export type MusicCutRole = "beat" | "strong" | "drop" | "fill" | "transition";

export type MusicSection = {
  start: number;
  end: number;
  type: MusicSectionType;
  energy: number;
  density: number;
};

export type MusicCutPoint = {
  time: number;
  strength: number;
  sectionType?: MusicSectionType;
  role?: MusicCutRole;
};

export type MusicEffectEvent = {
  time: number;
  type: MusicEffectEventType;
  strength: number;
  duration: number;
};

export type MusicEditPlan = {
  tempo: MusicTempo;
  energyCurve: MusicEnergyCurve;
  sections: MusicSection[];
  cutPoints: MusicCutPoint[];
  effectEvents: MusicEffectEvent[];
};

export type BeatSyncSettings = {
  enabled: boolean;
  intensity: BeatSyncIntensity;
  editEnergy?: EditEnergy;
};

export type MusicSettings = {
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
  beatEvents?: BeatEvent[];
  beatSync?: BeatSyncSettings;
  editPlan?: MusicEditPlan;
};

export type HookVideoInputProps = {
  src: string;
  width: number;
  height: number;
  fps: number;
  sourceWidth?: number;
  sourceHeight?: number;
  outputAspectRatio?: OutputAspectRatio;
  reframeMode?: ReframeMode;
  colorEnhancement?: ColorEnhancement;
  effectPreset?: EffectPreset;
  music?: MusicSettings;
  highlights: HighlightSegment[];
  title?: string;
};

type ClipWithTiming = HighlightSegment & {
  from: number;
  durationInFrames: number;
  effectStrength: number;
  effectPace: EffectPace;
};

type EffectPace = "slow" | "medium" | "fast";
type ResolvedEffectPreset = Exclude<EffectPreset, "auto" | "slow-fast-mix">;

const clamp = (value: number, min: number, max: number) => {
  return Math.min(Math.max(value, min), max);
};

const secondsToFrames = (seconds: number, fps: number) => {
  return Math.max(0, Math.round(seconds * fps));
};

const totalHighlightSeconds = (highlights: HighlightSegment[]) => {
  return highlights.reduce((sum, highlight) => {
    return sum + Math.max(0, Number(highlight.duration) || 0);
  }, 0);
};

const median = (values: number[]) => {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const midpoint = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? (sorted[midpoint - 1] + sorted[midpoint]) / 2
    : sorted[midpoint];
};

const resolveMediaSrc = (src: string) => {
  if (/^(https?:|data:|blob:|\/)/i.test(src)) {
    return src;
  }

  return staticFile(src);
};

const colorEnhancementFilter = (colorEnhancement: ColorEnhancement) => {
  if (colorEnhancement === "hdr-vivid") {
    return "brightness(1.05) contrast(1.2) saturate(1.32)";
  }

  if (colorEnhancement === "hdr-natural") {
    return "brightness(1.03) contrast(1.12) saturate(1.16)";
  }

  return "none";
};

const beatSyncConfig = (intensity: BeatSyncIntensity) => {
  if (intensity === "fast") {
    return {min: 0.28, max: 0.9, ideal: 0.55, beatsPerCut: 1};
  }

  if (intensity === "loose") {
    return {min: 0.8, max: 2.4, ideal: 1.55, beatsPerCut: 2};
  }

  return {min: 0.45, max: 1.35, ideal: 0.85, beatsPerCut: 1};
};

const editEnergyConfig = (energy: EditEnergy | undefined) => {
  if (energy === "aggressive") {
    return {
      recentWindow: 3,
      effectMultiplier: 1.18,
      keepFillCuts: true,
      keepEveryBeat: true,
      strongOnly: false,
    };
  }

  if (energy === "calm") {
    return {
      recentWindow: 1,
      effectMultiplier: 0.78,
      keepFillCuts: false,
      keepEveryBeat: false,
      strongOnly: false,
    };
  }

  return {
    recentWindow: 2,
    effectMultiplier: 1,
    keepFillCuts: false,
    keepEveryBeat: true,
    strongOnly: false,
  };
};

const beatStrengthAt = (music: MusicSettings | undefined, timelineSeconds: number) => {
  if (!music?.enabled || !music.src || !music.beatEvents?.length) {
    return 1;
  }

  const musicTime = Math.max(0, Number(music.start) || 0) + timelineSeconds;
  const closest = music.beatEvents.reduce(
    (best, beat) => {
      const distance = Math.abs(Number(beat.time) - musicTime);
      return distance < best.distance
        ? {distance, strength: Number(beat.strength)}
        : best;
    },
    {distance: Infinity, strength: 0.55},
  );

  if (closest.distance > 0.18 || !Number.isFinite(closest.strength)) {
    return 0.55;
  }

  return clamp(closest.strength, 0.18, 1);
};

const musicTimelineTime = (
  music: MusicSettings | undefined,
  timelineSeconds: number,
) => {
  if (!music?.enabled || !music.src) {
    return null;
  }

  const duration = Math.max(0.1, Number(music.duration) || 0.1);
  if (music.editPlan?.cutPoints?.length || music.editPlan?.effectEvents?.length) {
    return clamp(timelineSeconds, 0, duration);
  }

  return Math.max(0, Number(music.start) || 0) + timelineSeconds;
};

const sectionAt = (
  music: MusicSettings | undefined,
  timelineSeconds: number,
) => {
  const time = musicTimelineTime(music, timelineSeconds);
  if (time === null || !music?.editPlan?.sections?.length) {
    return undefined;
  }

  return music.editPlan.sections.find(
    (section) => time >= Number(section.start) && time < Number(section.end),
  ) ?? music.editPlan.sections.at(-1);
};

const sectionEnergyAt = (
  music: MusicSettings | undefined,
  timelineSeconds: number,
) => {
  return clamp(Number(sectionAt(music, timelineSeconds)?.energy) || 0.5, 0.18, 1);
};

const planStrengthAt = (
  music: MusicSettings | undefined,
  timelineSeconds: number,
) => {
  if (!music?.editPlan) {
    return beatStrengthAt(music, timelineSeconds);
  }

  const beatStrength = beatStrengthAt(music, timelineSeconds);
  const sectionEnergy = sectionEnergyAt(music, timelineSeconds);
  const eventStrength = Math.max(
    effectEventPulseAt(music, timelineSeconds, ["pulse"]),
    effectEventPulseAt(music, timelineSeconds, ["impact"]),
  );

  return clamp(beatStrength * 0.42 + sectionEnergy * 0.36 + eventStrength * 0.32, 0.18, 1);
};

const planPaceAt = (
  music: MusicSettings | undefined,
  timelineSeconds: number,
): EffectPace => {
  const section = sectionAt(music, timelineSeconds);

  if (section?.type === "drop") {
    return "fast";
  }

  if (section?.type === "build") {
    return section.density >= 0.52 ? "fast" : "medium";
  }

  if (section?.type === "intro" || section?.type === "outro") {
    return "slow";
  }

  if (section?.density && section.density >= 0.62) {
    return "fast";
  }

  if (section?.density && section.density <= 0.22) {
    return "slow";
  }

  return effectPaceAt(music, timelineSeconds);
};

const effectEventPulseAt = (
  music: MusicSettings | undefined,
  timelineSeconds: number,
  types: MusicEffectEventType[],
) => {
  const time = musicTimelineTime(music, timelineSeconds);
  if (time === null || !music?.editPlan?.effectEvents?.length) {
    return 0;
  }

  return music.editPlan.effectEvents.reduce((strongest, event) => {
    if (!types.includes(event.type)) {
      return strongest;
    }

    const duration = Math.max(0.08, Number(event.duration) || 0.18);
    const distance = Math.abs(time - Number(event.time));
    if (distance > duration) {
      return strongest;
    }

    const pulse = interpolate(distance, [0, duration], [1, 0], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.out(Easing.cubic),
    });

    const energy = editEnergyConfig(music.beatSync?.editEnergy);
    return Math.max(
      strongest,
      pulse * clamp((Number(event.strength) || 0) * energy.effectMultiplier, 0, 1),
    );
  }, 0);
};

const uniqueSortedBoundaries = (boundaries: number[]) => {
  return boundaries
    .filter((boundary) => Number.isFinite(boundary))
    .sort((a, b) => a - b)
    .reduce<number[]>((selected, boundary) => {
      const previous = selected.at(-1);
      if (previous === undefined || Math.abs(previous - boundary) > 0.05) {
        selected.push(boundary);
      }

      return selected;
    }, []);
};

type BeatDuration = {
  duration: number;
  role: MusicCutRole;
  strength: number;
  sectionType?: MusicSectionType;
};

type DirectorCut = {
  time: number;
  role: MusicCutRole;
  strength: number;
  sectionType?: MusicSectionType;
};

const shouldKeepDirectorCut = (
  cut: DirectorCut,
  index: number,
  energy: EditEnergy,
) => {
  if (cut.time <= 0.05 || cut.role === "transition" || cut.role === "drop") {
    return true;
  }

  if (cut.role === "strong") {
    return true;
  }

  const config = editEnergyConfig(energy);

  if (cut.role === "fill") {
    return config.keepFillCuts && index % 2 === 0;
  }

  if (energy === "calm") {
    return index % 2 === 0 || cut.strength >= 0.72;
  }

  return config.keepEveryBeat || cut.strength >= 0.62;
};

const buildDirectorDurations = ({
  cuts,
  config,
  targetDuration,
  exactCuts,
  editEnergy,
}: {
  cuts: DirectorCut[];
  config: ReturnType<typeof beatSyncConfig>;
  targetDuration: number;
  exactCuts: boolean;
  editEnergy: EditEnergy;
}): BeatDuration[] => {
  const selectedCuts = uniqueSortedBoundaries(
    cuts
      .filter((cut, index) => shouldKeepDirectorCut(cut, index, editEnergy))
      .map((cut) => cut.time),
  ).map((time) => {
    const cut = cuts.find((item) => Math.abs(item.time - time) <= 0.05);
    return {
      time,
      role: cut?.role ?? "beat",
      strength: cut?.strength ?? 0.5,
      sectionType: cut?.sectionType,
    };
  });
  const boundaries = uniqueSortedBoundaries([
    0,
    ...selectedCuts.map((cut) => cut.time),
    targetDuration,
  ]);
  const cutByTime = (time: number) =>
    selectedCuts.find((cut) => Math.abs(cut.time - time) <= 0.05);
  const durations: BeatDuration[] = [];

  if (exactCuts) {
    for (let index = 1; index < boundaries.length; index += 1) {
      const duration = boundaries[index] - boundaries[index - 1];
      if (duration >= 0.08) {
        const cut = cutByTime(boundaries[index - 1]);
        durations.push({
          duration: Number(duration.toFixed(3)),
          role: cut?.role ?? "beat",
          strength: cut?.strength ?? 0.5,
          sectionType: cut?.sectionType,
        });
      }
    }

    return durations;
  }

  let cursor = 0;
  const maxClips = 180;

  const nextBeatBoundary = () => {
    const maxDuration = Math.min(config.max, targetDuration - cursor);
    const minDuration = Math.min(config.min, maxDuration);
    const minCut = cursor + minDuration;
    const maxCut = cursor + maxDuration;
    const candidateBoundaries = boundaries.filter(
      (boundary) => boundary >= minCut && boundary <= maxCut,
    );
    const preferredBoundary =
      candidateBoundaries[Math.min(config.beatsPerCut - 1, candidateBoundaries.length - 1)];

    if (typeof preferredBoundary !== "number") {
      return Math.min(targetDuration, cursor + Math.min(config.ideal, maxDuration));
    }

    return candidateBoundaries.reduce((best, boundary) => {
      const current = Math.abs(boundary - (cursor + config.ideal));
      const previous = Math.abs(best - (cursor + config.ideal));
      return current < previous ? boundary : best;
    }, preferredBoundary);
  };

  while (cursor < targetDuration - 0.05 && durations.length < maxClips) {
    const nextBoundary = nextBeatBoundary();
    const duration = Math.min(
      Math.max(0.08, nextBoundary - cursor),
      targetDuration - cursor,
    );

    if (duration < 0.08) {
      break;
    }

    const cut = cutByTime(cursor);
    durations.push({
      duration: Number(duration.toFixed(3)),
      role: cut?.role ?? "beat",
      strength: cut?.strength ?? 0.5,
      sectionType: cut?.sectionType,
    });
    cursor += duration;
  }

  return durations;
};

const assignBeatDurationsToHighlights = (
  highlights: HighlightSegment[],
  durations: BeatDuration[],
  targetDuration: number,
  editEnergy: EditEnergy,
) => {
  const sources = highlights.map((highlight) => ({
    highlight,
    cursor: 0,
  }));
  const synced: HighlightSegment[] = [];
  let outputCursor = 0;
  let sourcePointer = 0;
  let previousSource = -1;
  let previousStart = -1;
  const recentSources: number[] = [];
  const config = editEnergyConfig(editEnergy);

  const remainingFor = (index: number) => {
    return Math.max(0, sources[index].highlight.duration - sources[index].cursor);
  };

  const chooseSource = (beat: BeatDuration) => {
    const candidates = sources
      .map((source, index) => {
        const remaining = remainingFor(index);
        if (remaining < 0.08) {
          return null;
        }

        const canFit = remaining >= beat.duration - 0.015;
        const start = source.highlight.start + source.cursor;
        const timestampDistance =
          previousStart < 0 ? 1 : clamp(Math.abs(start - previousStart) / 18, 0, 1);
        const recentPenalty = recentSources.includes(index) ? 1 : 0;
        const previousPenalty = index === previousSource ? 1 : 0;
        const rotationDistance =
          (index - sourcePointer + sources.length) % sources.length;
        const dropBoost = beat.role === "drop" || beat.role === "strong" ? 0.3 : 0;
        const fitPenalty = canFit ? 0 : 0.45;
        const score =
          timestampDistance * 1.35 +
          (sources.length - rotationDistance) * 0.03 +
          dropBoost -
          recentPenalty * (beat.role === "drop" ? 1.4 : 0.85) -
          previousPenalty * 1.1 -
          fitPenalty;

        return {index, score};
      })
      .filter((candidate): candidate is {index: number; score: number} => Boolean(candidate))
      .sort((a, b) => b.score - a.score);

    return candidates[0]?.index ?? -1;
  };

  for (const beat of durations) {
    if (outputCursor >= targetDuration - 0.05 || synced.length >= 180) {
      break;
    }

    const sourceIndex = chooseSource(beat);
    if (sourceIndex < 0) {
      break;
    }

    const source = sources[sourceIndex];
    const duration = Math.min(
      beat.duration,
      remainingFor(sourceIndex),
      targetDuration - outputCursor,
    );

    if (duration < 0.08) {
      source.cursor = source.highlight.duration;
      continue;
    }

    synced.push({
      start: Number((source.highlight.start + source.cursor).toFixed(3)),
      duration: Number(duration.toFixed(3)),
    });

    previousStart = source.highlight.start + source.cursor;
    source.cursor += duration;
    outputCursor += duration;
    previousSource = sourceIndex;
    recentSources.push(sourceIndex);
    const maxRecent = Math.min(config.recentWindow, Math.max(0, sources.length - 1));
    while (recentSources.length > maxRecent) {
      recentSources.shift();
    }
    sourcePointer = (sourceIndex + 1) % sources.length;
  }

  return synced;
};

const effectPaceAt = (
  music: MusicSettings | undefined,
  timelineSeconds: number,
): EffectPace => {
  if (!music?.enabled || !music.src || !Array.isArray(music.beats) || music.beats.length < 2) {
    return "medium";
  }

  const musicTime = Math.max(0, Number(music.start) || 0) + timelineSeconds;
  const beats = music.beats
    .map((beat) => Number(beat))
    .filter((beat) => Number.isFinite(beat) && beat >= 0)
    .sort((a, b) => a - b);
  const localGaps: number[] = [];

  for (let index = 1; index < beats.length; index += 1) {
    const previous = beats[index - 1];
    const current = beats[index];
    const gap = current - previous;
    const midpoint = previous + gap / 2;

    if (gap > 0.12 && gap < 3 && Math.abs(midpoint - musicTime) <= 3.2) {
      localGaps.push(gap);
    }
  }

  const gap = median(localGaps);

  if (!gap) {
    return "medium";
  }

  if (gap <= 0.58) {
    return "fast";
  }

  if (gap >= 1.05) {
    return "slow";
  }

  return "medium";
};

export const buildBeatSyncedHighlights = (
  highlights: HighlightSegment[],
  music?: MusicSettings,
): HighlightSegment[] => {
  const hasEditPlan = Boolean(music?.editPlan?.cutPoints?.length);
  const hasBeats = Boolean(Array.isArray(music?.beats) && music.beats.length >= 2);
  const enabled = Boolean(music?.enabled && music.src && music.beatSync?.enabled && (hasEditPlan || hasBeats));

  if (!enabled || !music) {
    return highlights;
  }

  const totalSeconds = Math.max(0.1, totalHighlightSeconds(highlights));
  const musicStart = Math.max(0, Number(music.start) || 0);
  const musicDuration = Math.max(0.1, Number(music.duration) || totalSeconds);
  const targetDuration = Math.min(totalSeconds, musicDuration);
  const config = beatSyncConfig(music.beatSync?.intensity ?? "tight");
  const editEnergy = music.beatSync?.editEnergy ?? "balanced";
  const beats = music.beats ?? [];
  const plannedCuts = (music.editPlan?.cutPoints ?? [])
    .map((cut) => ({
      time: Number(cut.time),
      strength: clamp(Number(cut.strength) || 0.5, 0, 1),
      role: cut.role ?? "beat",
      sectionType: cut.sectionType,
    }))
    .filter((cut) => Number.isFinite(cut.time) && cut.time > 0.08 && cut.time < targetDuration - 0.08);
  const fallbackCuts = beats
    .map((beat) => Number(beat) - musicStart)
    .filter((beat) => Number.isFinite(beat) && beat > 0.08 && beat < targetDuration - 0.08)
    .sort((a, b) => a - b)
    .map((time) => ({
      time,
      strength: beatStrengthAt(music, time),
      role: "beat" as MusicCutRole,
    }));
  const directorCuts = plannedCuts.length >= 2 ? plannedCuts : fallbackCuts;

  if (directorCuts.length < 1 || highlights.length === 0) {
    return highlights;
  }

  const durations = buildDirectorDurations({
    cuts: directorCuts,
    config,
    targetDuration,
    editEnergy,
    exactCuts: plannedCuts.length >= 1,
  });
  const synced = assignBeatDurationsToHighlights(
    highlights,
    durations,
    targetDuration,
    editEnergy,
  );

  return synced.length > 0 ? synced : highlights;
};

export const getHookDurationSeconds = (props: Pick<HookVideoInputProps, "highlights" | "music">) => {
  return totalHighlightSeconds(buildBeatSyncedHighlights(props.highlights, props.music));
};

const buildTimeline = (
  highlights: HighlightSegment[],
  fps: number,
  music?: MusicSettings,
): ClipWithTiming[] => {
  const syncedHighlights = buildBeatSyncedHighlights(highlights, music);
  const hasTempoMap = Boolean(
    music?.enabled &&
      music.src &&
      ((Array.isArray(music.beats) && music.beats.length >= 2) ||
        music.editPlan?.sections?.length),
  );
  const totalFrames = syncedHighlights.reduce((sum, highlight) => {
    return sum + Math.max(1, secondsToFrames(highlight.duration, fps));
  }, 0);
  let cursor = 0;

  return syncedHighlights
    .map((highlight) => {
      const durationInFrames = Math.max(
        1,
        secondsToFrames(highlight.duration, fps),
      );
      const timelineSeconds = cursor / fps;
      const progress = totalFrames <= 0 ? 0 : cursor / totalFrames;
      const fallbackPace: EffectPace =
        progress < 0.34 ? "slow" : progress < 0.68 ? "medium" : "fast";
      const clip = {
        ...highlight,
        from: cursor,
        durationInFrames,
        effectStrength: hasTempoMap
          ? planStrengthAt(music, timelineSeconds)
          : fallbackPace === "fast"
            ? 0.62
            : fallbackPace === "medium"
              ? 0.44
              : 0.28,
        effectPace: hasTempoMap
          ? planPaceAt(music, timelineSeconds)
          : fallbackPace,
      };

      cursor += durationInFrames;
      return clip;
    })
    .filter((clip) => clip.durationInFrames > 0);
};

const fadeInOut = (frame: number, durationInFrames: number, maxFade = 8) => {
  const fadeFrames = Math.max(
    1,
    Math.min(maxFade, Math.max(1, Math.floor(durationInFrames / 2))),
  );
  const fadeIn = interpolate(frame, [0, fadeFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const fadeOut = interpolate(
    frame,
    [durationInFrames - fadeFrames, durationInFrames],
    [1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );

  return Math.min(fadeIn, fadeOut);
};

const resolveEffectPreset = (
  preset: EffectPreset,
  effectStrength: number,
  effectPace: EffectPace,
): ResolvedEffectPreset => {
  if (preset === "slow-fast-mix") {
    if (effectPace === "slow") {
      return "smooth-slow";
    }

    if (effectPace === "fast") {
      return "fast-kinetic";
    }

    return "beat-punch";
  }

  if (preset !== "auto") {
    return preset;
  }

  if (effectPace === "slow") {
    return "smooth-slow";
  }

  if (effectPace === "fast") {
    return effectStrength >= 0.54 ? "fast-kinetic" : "beat-punch";
  }

  if (effectStrength >= 0.72) {
    return "beat-punch";
  }

  return "smooth-slow";
};

const effectPlaybackRate = (
  requestedPreset: EffectPreset,
  resolvedPreset: ResolvedEffectPreset,
  effectPace: EffectPace,
  effectStrength: number,
) => {
  if (requestedPreset === "slow-fast-mix") {
    if (effectPace === "slow") {
      return 0.66;
    }

    if (effectPace === "fast") {
      return 1.12;
    }

    return 0.82;
  }

  if (resolvedPreset === "smooth-slow") {
    return 0.66;
  }

  if (resolvedPreset === "fast-kinetic") {
    return 1.12 + clamp(effectStrength, 0, 1) * 0.1;
  }

  if (resolvedPreset === "beat-punch") {
    return 1;
  }

  if (resolvedPreset === "impact-shake") {
    return 0.7;
  }

  if (resolvedPreset === "flash-cuts") {
    return 1.03;
  }

  return 1;
};

const cutPulse = (
  frame: number,
  durationInFrames: number,
  preset: ResolvedEffectPreset,
  effectStrength: number,
) => {
  if (preset === "clean") {
    return 0;
  }

  const maxFrames =
    preset === "smooth-slow"
      ? 24
      : preset === "impact-shake"
        ? 10
        : preset === "fast-kinetic"
          ? 5
          : 7;
  const pulseFrames = Math.max(
    1,
    Math.min(maxFrames, Math.max(1, Math.floor(durationInFrames / 3))),
  );

  const pulse = interpolate(frame, [0, pulseFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  const presetStrength =
    preset === "smooth-slow"
      ? 0.18
      : preset === "fast-kinetic"
        ? 0.78
        : preset === "beat-punch"
          ? 0.72
        : 1;

  return pulse * clamp(effectStrength, 0.18, 1) * presetStrength;
};

const clipVisualOpacity = (
  frame: number,
  durationInFrames: number,
  requestedPreset: EffectPreset,
  resolvedPreset: ResolvedEffectPreset,
) => {
  if (requestedPreset === "slow-fast-mix" || resolvedPreset === "fast-kinetic") {
    return 1;
  }

  const fadeFrames =
    resolvedPreset === "smooth-slow"
      ? 4
      : resolvedPreset === "clean"
        ? 2
        : 3;
  const edge = Math.min(fadeFrames, Math.floor(durationInFrames / 3));

  if (edge <= 0) {
    return 1;
  }

  const fadeIn = interpolate(frame, [0, edge], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const fadeOut = interpolate(frame, [durationInFrames - edge, durationInFrames], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.in(Easing.cubic),
  });

  return Math.min(fadeIn, fadeOut);
};

const flashOpacity = (
  pulse: number,
  preset: ResolvedEffectPreset,
  effectStrength: number,
  requestedPreset: EffectPreset,
) => {
  if (requestedPreset === "slow-fast-mix") {
    return 0;
  }

  if (preset === "smooth-slow") {
    return 0;
  }

  if (preset === "fast-kinetic") {
    return pulse * (0.008 + effectStrength * 0.012);
  }

  if (preset === "flash-cuts") {
    return pulse * (0.055 + effectStrength * 0.08);
  }

  if (preset === "beat-punch") {
    return pulse * (0.035 + effectStrength * 0.05);
  }

  if (preset === "impact-shake") {
    return pulse * (0.04 + effectStrength * 0.055);
  }

  return 0;
};

const effectVideoFilter = (
  colorEnhancement: ColorEnhancement,
  preset: ResolvedEffectPreset,
  pulse: number,
) => {
  const color = colorEnhancementFilter(colorEnhancement);
  const effect =
    preset === "smooth-slow"
      ? "saturate(0.92) contrast(1.04)"
      : preset === "fast-kinetic"
        ? `contrast(1.1) saturate(1.08) blur(${(pulse * 0.65).toFixed(2)}px)`
        : preset === "beat-punch"
          ? `contrast(1.12) saturate(1.08) brightness(${(1 + pulse * 0.035).toFixed(3)})`
          : preset === "impact-shake"
            ? `contrast(1.18) saturate(1.12) blur(${(pulse * 0.45).toFixed(2)}px)`
            : preset === "flash-cuts"
              ? `contrast(1.16) saturate(1.06) brightness(${(1 + pulse * 0.02).toFixed(3)})`
            : "none";

  return [color, effect].filter((filter) => filter !== "none").join(" ") || "none";
};

const EffectOverlay: React.FC<{
  frame: number;
  pulse: number;
  preset: ResolvedEffectPreset;
  requestedPreset: EffectPreset;
  effectStrength: number;
}> = ({frame, pulse, preset, requestedPreset, effectStrength}) => {
  const whiteFlash = flashOpacity(pulse, preset, effectStrength, requestedPreset);

  if (preset === "smooth-slow") {
    const drift = interpolate(frame, [0, 90], [-8, 8], {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.inOut(Easing.cubic),
    });

    return (
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(circle at 50% 44%, rgba(255,255,255,0.06) 0%, rgba(255,255,255,0.015) 34%, rgba(0,0,0,0.32) 100%)",
          opacity: 0.42,
          pointerEvents: "none",
          transform: `translate3d(${drift}px, 0, 0)`,
        }}
      />
    );
  }

  if (preset === "fast-kinetic") {
    const isSlowFastMix = requestedPreset === "slow-fast-mix";
    const lineOpacity = pulse * (isSlowFastMix ? 0.14 : 0.34);
    const lineAlpha = isSlowFastMix ? 0.14 : 0.24;
    const travel = isSlowFastMix ? [-18, 10] : [-36, 24];

    return (
      <>
        <AbsoluteFill
          style={{
            background:
              `repeating-linear-gradient(105deg, rgba(255,255,255,0) 0 18px, rgba(255,255,255,${lineAlpha}) 18px 20px)`,
            mixBlendMode: "screen",
            opacity: lineOpacity,
            pointerEvents: "none",
            transform: `translate3d(${interpolate(frame, [0, 8], travel, {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
              easing: Easing.out(Easing.cubic),
            })}px, 0, 0)`,
          }}
        />
        <AbsoluteFill
          style={{
            background:
              "linear-gradient(90deg, rgba(0,0,0,0.34) 0%, rgba(0,0,0,0) 22%, rgba(0,0,0,0) 78%, rgba(0,0,0,0.34) 100%)",
            opacity: 0.55,
            pointerEvents: "none",
          }}
        />
      </>
    );
  }

  if (preset === "beat-punch") {
    return (
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(circle at 50% 52%, rgba(255,255,255,0.12) 0%, rgba(255,255,255,0.02) 24%, rgba(0,0,0,0.42) 78%, rgba(0,0,0,0.58) 100%)",
          opacity: pulse * 0.7,
          pointerEvents: "none",
        }}
      />
    );
  }

  if (preset === "impact-shake") {
    return (
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(circle at 50% 50%, rgba(255,255,255,0.08) 0%, rgba(0,0,0,0.12) 30%, rgba(0,0,0,0.68) 100%)",
          opacity: 0.2 + pulse * 0.42,
          pointerEvents: "none",
        }}
      />
    );
  }

  if (whiteFlash > 0) {
    return (
      <AbsoluteFill
        style={{
          backgroundColor: "#fff",
          opacity: whiteFlash,
          pointerEvents: "none",
        }}
      />
    );
  }

  return null;
};

const MusicReactiveOverlay: React.FC<{
  flashPulse: number;
  impactPulse: number;
  whipPulse: number;
  sectionEnergy: number;
}> = ({flashPulse, impactPulse, whipPulse, sectionEnergy}) => {
  const visiblePulse = Math.max(flashPulse, impactPulse, whipPulse);

  if (visiblePulse <= 0.01) {
    return null;
  }

  return (
    <>
      <AbsoluteFill
        style={{
          backgroundColor: "#fff",
          opacity: flashPulse * 0.075,
          pointerEvents: "none",
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(circle at 50% 52%, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.02) 26%, rgba(0,0,0,0.48) 100%)",
          opacity: impactPulse * (0.2 + sectionEnergy * 0.32),
          pointerEvents: "none",
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "repeating-linear-gradient(100deg, rgba(255,255,255,0) 0 22px, rgba(255,255,255,0.16) 22px 24px)",
          mixBlendMode: "screen",
          opacity: whipPulse * 0.18,
          pointerEvents: "none",
        }}
      />
    </>
  );
};

const SourceClip: React.FC<{
  clip: ClipWithTiming;
  src: string;
  index: number;
  reframeMode: ReframeMode;
  sourceVolume: number;
  effectPreset: EffectPreset;
  colorEnhancement: ColorEnhancement;
  music?: MusicSettings;
}> = ({
  clip,
  src,
  index,
  reframeMode,
  sourceVolume,
  effectPreset,
  colorEnhancement,
  music,
}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const videoSrc = resolveMediaSrc(src);
  const resolvedPreset = resolveEffectPreset(
    effectPreset,
    clip.effectStrength,
    clip.effectPace,
  );
  const visualOpacity = clipVisualOpacity(
    frame,
    clip.durationInFrames,
    effectPreset,
    resolvedPreset,
  );
  const pulse = cutPulse(
    frame,
    clip.durationInFrames,
    resolvedPreset,
    clip.effectStrength,
  );
  const timelineSeconds = (clip.from + frame) / fps;
  const musicPulse = effectEventPulseAt(music, timelineSeconds, ["pulse"]);
  const flashPulse = effectEventPulseAt(music, timelineSeconds, ["flash"]);
  const impactPulse = effectEventPulseAt(music, timelineSeconds, ["impact"]);
  const whipPulse = effectEventPulseAt(music, timelineSeconds, ["whip"]);
  const sectionEnergy = sectionEnergyAt(music, timelineSeconds);
  const reactivePulse = Math.max(
    pulse,
    musicPulse * 0.68,
    flashPulse * 0.7,
    impactPulse,
    whipPulse * 0.82,
  );
  const styledPulse = effectPreset === "slow-fast-mix" ? reactivePulse * 0.45 : reactivePulse;
  const playbackRate = effectPlaybackRate(
    effectPreset,
    resolvedPreset,
    clip.effectPace,
    clip.effectStrength,
  );
  const trimBefore = secondsToFrames(clip.start, fps);
  const trimAfter = secondsToFrames(
    clip.start + clip.duration * Math.max(1, playbackRate) + 0.2,
    fps,
  );
  const autoReframe = reframeMode === "auto";
  const portraitFrame = width < height;
  const panDistance =
    resolvedPreset === "smooth-slow"
      ? 12
      : resolvedPreset === "fast-kinetic"
        ? 18
        : resolvedPreset === "beat-punch"
          ? 5
          : 8;
  const panOffset =
    index % 3 === 0 ? -panDistance : index % 3 === 1 ? 0 : panDistance;
  const pan = autoReframe
    ? interpolate(
        frame,
        [0, Math.max(1, clip.durationInFrames - 1)],
        [50 - panOffset, 50 + panOffset],
        {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
          easing: Easing.inOut(Easing.cubic),
        },
      )
    : 50;
  const endScale =
    resolvedPreset === "smooth-slow"
      ? 1.07
      : resolvedPreset === "fast-kinetic"
        ? 1.018
        : resolvedPreset === "beat-punch"
          ? 1.02
          : 1.045;
  const scale = interpolate(frame, [0, clip.durationInFrames], [1.002, endScale], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing:
      resolvedPreset === "smooth-slow"
        ? Easing.inOut(Easing.cubic)
        : Easing.out(Easing.cubic),
  });
  const effectScale =
    autoReframe &&
    (resolvedPreset === "smooth-slow" ||
      resolvedPreset === "fast-kinetic" ||
      resolvedPreset === "beat-punch" ||
      resolvedPreset === "impact-shake" ||
      resolvedPreset === "flash-cuts")
      ? styledPulse *
        (resolvedPreset === "smooth-slow"
          ? 0.006
          : resolvedPreset === "fast-kinetic"
            ? 0.036
            : resolvedPreset === "beat-punch"
              ? 0.044
            : resolvedPreset === "impact-shake"
              ? 0.038
              : 0.02)
      : 0;
  const shakePreset =
    resolvedPreset === "impact-shake"
      ? 1
      : resolvedPreset === "fast-kinetic"
        ? 0.44
        : 0;
  const shakeAmount =
    autoReframe && shakePreset > 0
      ? Math.sin(frame * 2.1 + index) *
        Math.max(styledPulse, impactPulse * 1.15, whipPulse * 0.72) *
        Math.max(2, width * 0.0038) *
        (0.5 + clip.effectStrength * 0.55) *
        shakePreset
      : 0;
  const rotation =
    autoReframe && (resolvedPreset === "fast-kinetic" || resolvedPreset === "impact-shake")
      ? Math.sin(frame * (resolvedPreset === "impact-shake" ? 2.8 : 1.4) + index) *
        styledPulse *
        (resolvedPreset === "impact-shake" ? 0.75 : 0.32)
      : 0;
  const transform = autoReframe
    ? `translate3d(${shakeAmount}px, 0, 0) scale(${
        scale + effectScale * (effectPreset === "slow-fast-mix" ? 0.55 : 1)
      }) rotate(${rotation}deg)`
    : undefined;

  return (
    <AbsoluteFill style={{backgroundColor: "#000", overflow: "hidden"}}>
      <OffthreadVideo
        src={videoSrc}
        trimBefore={trimBefore}
        trimAfter={trimAfter}
        playbackRate={playbackRate}
        toneFrequency={playbackRate < 0.98 ? clamp(1 / playbackRate, 0.7, 1.5) : undefined}
        volume={sourceVolume}
        style={{
          width: "100%",
          height: "100%",
          objectFit: autoReframe ? "cover" : "contain",
          objectPosition: autoReframe
            ? portraitFrame
              ? `${clamp(pan, 35, 65)}% 50%`
              : `50% ${clamp(pan, 35, 65)}%`
            : "50% 50%",
          opacity: visualOpacity,
          transform,
          filter: effectVideoFilter(colorEnhancement, resolvedPreset, styledPulse),
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.12) 0%, rgba(0,0,0,0) 34%, rgba(0,0,0,0.36) 100%)",
          pointerEvents: "none",
        }}
      />
      <EffectOverlay
        frame={frame}
        pulse={styledPulse}
        preset={resolvedPreset}
        requestedPreset={effectPreset}
        effectStrength={clip.effectStrength}
      />
      <MusicReactiveOverlay
        flashPulse={flashPulse}
        impactPulse={impactPulse}
        whipPulse={whipPulse}
        sectionEnergy={sectionEnergy}
      />
    </AbsoluteFill>
  );
};

const OpeningTitle: React.FC<{
  title: string;
}> = ({title}) => {
  const frame = useCurrentFrame();
  const {fps, height} = useVideoConfig();
  const holdFrames = Math.round(fps * 2);
  const opacity = fadeInOut(frame, holdFrames);
  const scale = interpolate(frame, [0, holdFrames], [0.94, 1.04], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

  return (
    <AbsoluteFill
      style={{
        alignItems: "center",
        justifyContent: "center",
        opacity,
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          maxWidth: "86%",
          color: "#fff",
          fontFamily:
            "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif",
          fontSize: Math.max(28, Math.min(74, height * 0.09)),
          fontWeight: 900,
          lineHeight: 0.92,
          letterSpacing: 0,
          textAlign: "center",
          textShadow: "0 5px 28px rgba(0,0,0,0.85)",
          textTransform: "uppercase",
          transform: `scale(${scale})`,
        }}
      >
        {title}
      </div>
    </AbsoluteFill>
  );
};

const ProgressBar: React.FC = () => {
  const frame = useCurrentFrame();
  const {durationInFrames, height} = useVideoConfig();
  const progress = durationInFrames <= 1 ? 1 : frame / (durationInFrames - 1);

  return (
    <div
      style={{
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: Math.max(3, Math.round(height * 0.006)),
        backgroundColor: "rgba(255,255,255,0.22)",
      }}
    >
      <div
        style={{
          width: `${clamp(progress, 0, 1) * 100}%`,
          height: "100%",
          backgroundColor: "#fff",
        }}
      />
    </div>
  );
};

const BackgroundMusic: React.FC<{
  music: MusicSettings;
}> = ({music}) => {
  const {fps, durationInFrames} = useVideoConfig();
  const trimBefore = secondsToFrames(Math.max(0, music.start), fps);
  const trimAfter = secondsToFrames(
    Math.max(0, music.start) + Math.max(0.01, music.duration),
    fps,
  );
  const fadeFrames = Math.max(1, secondsToFrames(music.fadeSeconds || 0.7, fps));
  const musicSrc = resolveMediaSrc(music.src);

  return (
    <Audio
      src={musicSrc}
      trimBefore={trimBefore}
      trimAfter={trimAfter}
      loop={music.loop}
      volume={(frame) => {
        const fadeIn = interpolate(frame, [0, fadeFrames], [0, 1], {
          extrapolateLeft: "clamp",
          extrapolateRight: "clamp",
        });
        const fadeOut = interpolate(
          frame,
          [durationInFrames - fadeFrames, durationInFrames],
          [1, 0],
          {
            extrapolateLeft: "clamp",
            extrapolateRight: "clamp",
          },
        );

        return Math.max(0, music.volume) * Math.min(fadeIn, fadeOut);
      }}
    />
  );
};

export const HookVideo: React.FC<HookVideoInputProps> = ({
  src,
  highlights,
  title = "",
  outputAspectRatio = "source",
  reframeMode,
  colorEnhancement = "off",
  effectPreset = "clean",
  music,
}) => {
  const {fps, durationInFrames} = useVideoConfig();
  const activeMusic = music?.enabled && music.src ? music : null;
  const timeline = buildTimeline(highlights, fps, activeMusic || undefined);
  const cleanTitle = title.trim();
  const titleFrames = cleanTitle
    ? Math.min(durationInFrames, Math.round(fps * 2))
    : 0;
  const resolvedReframeMode =
    reframeMode ?? (outputAspectRatio === "source" ? "none" : "auto");
  const sourceVolume = activeMusic
    ? clamp(Number(activeMusic.sourceVolume), 0, 1)
    : 1;

  if (!src) {
    return (
      <AbsoluteFill style={{backgroundColor: "#000", overflow: "hidden"}}>
        {titleFrames > 0 ? (
          <Sequence from={0} durationInFrames={titleFrames}>
            <OpeningTitle title={cleanTitle} />
          </Sequence>
        ) : null}
        <ProgressBar />
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{backgroundColor: "#000", overflow: "hidden"}}>
      {timeline.map((clip, index) => (
        <Sequence
          key={`${clip.start}-${clip.duration}-${index}`}
          from={clip.from}
          durationInFrames={clip.durationInFrames}
          premountFor={Math.min(Math.round(fps), clip.from)}
        >
          <SourceClip
            clip={clip}
            src={src}
            index={index}
            reframeMode={resolvedReframeMode}
            sourceVolume={sourceVolume}
            effectPreset={effectPreset}
            colorEnhancement={colorEnhancement}
            music={activeMusic || undefined}
          />
        </Sequence>
      ))}
      {activeMusic ? <BackgroundMusic music={activeMusic} /> : null}
      {titleFrames > 0 ? (
        <Sequence from={0} durationInFrames={titleFrames}>
          <OpeningTitle title={cleanTitle} />
        </Sequence>
      ) : null}
      <ProgressBar />
    </AbsoluteFill>
  );
};
