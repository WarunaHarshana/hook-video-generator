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

export type HighlightMetadata = {
  motionScore?: number;
  shotDensityScore?: number;
  spikeScore?: number;
  dialogueScore?: number;
  faceScore?: number;
  sceneScore?: number;
  loudnessScore?: number;
  audioScore?: number;
  energyScore?: number;
  varietyKey?: string;
};

export type ReframeKeyframe = {
  time: number;
  x: number;
  y: number;
  confidence: number;
};

export type ReframePath = {
  tracking: "face" | "center";
  confidence: number;
  keyframes: ReframeKeyframe[];
};

export type HighlightSegment = {
  start: number;
  duration: number;
  metadata?: HighlightMetadata;
  reframe?: ReframePath;
};

export type OutputAspectRatio = "source" | "9:16" | "1:1" | "4:5" | "16:9";
export type ReframeMode = "none" | "auto";
export type ColorEnhancement = "off" | "hdr-natural" | "hdr-vivid";
export type BeatSyncIntensity = "loose" | "tight" | "fast";
export type EditEnergy = "calm" | "balanced" | "aggressive";
export type EffectPreset =
  | "clean"
  | "auto"
  | "smooth-velocity"
  | "velocity-ramp"
  | "beat-bounce"
  | "drop-whip"
  | "freeze-hit"
  | "match-push"
  | "snap-zoom"
  | "glitch-lite"
  | "slow-fast-builder"
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

export type BeatEvent = {
  time: number;
  strength: number;
};

export type MusicSectionType = "intro" | "verse" | "build" | "drop" | "outro";
export type MusicTempo = "slow" | "medium" | "fast";
export type MusicEnergyCurve = "steady" | "slow-to-fast" | "fast-to-slow" | "mixed";
export type MusicEffectEventType =
  | "pulse"
  | "flash"
  | "impact"
  | "whip"
  | "bounce"
  | "freeze"
  | "snap"
  | "ramp"
  | "push"
  | "glitch";
export type MusicCutRole = "beat" | "strong" | "drop" | "fill" | "transition";

export type MusicSection = {
  start: number;
  end: number;
  type: MusicSectionType;
  energy: number;
  density: number;
  transient?: number;
  confidence?: number;
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
  muteSourceAudio?: boolean;
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
type ResolvedEffectPreset =
  | "clean"
  | "smooth-velocity"
  | "velocity-ramp"
  | "beat-bounce"
  | "drop-whip"
  | "freeze-hit"
  | "match-push"
  | "snap-zoom"
  | "glitch-lite"
  | "slow-fast-builder";

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
  const section = sectionAt(music, timelineSeconds);
  const sectionEnergy = clamp(Number(section?.energy) || 0.5, 0.18, 1);
  const sectionTransient = clamp(Number(section?.transient) || 0.35, 0, 1);
  const eventStrength = Math.max(
    effectEventPulseAt(music, timelineSeconds, ["pulse"]),
    effectEventPulseAt(music, timelineSeconds, ["bounce", "snap", "ramp"]),
    effectEventPulseAt(music, timelineSeconds, ["impact"]),
    effectEventPulseAt(music, timelineSeconds, ["freeze", "push", "glitch"]),
  );

  return clamp(
    beatStrength * 0.36 +
      sectionEnergy * 0.28 +
      sectionTransient * 0.16 +
      eventStrength * 0.3,
    0.18,
    1,
  );
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
    return section.density >= 0.52 || Number(section.transient) >= 0.42 ? "fast" : "medium";
  }

  if (section?.type === "intro" || section?.type === "outro") {
    return "slow";
  }

  if (section?.density && section.density >= 0.62) {
    return "fast";
  }

  if (Number(section?.transient) >= 0.48) {
    return "fast";
  }

  if (section?.density && section.density <= 0.22) {
    return "slow";
  }

  return effectPaceAt(music, timelineSeconds);
};

const focusAt = (reframe: ReframePath | undefined, time: number) => {
  const keyframes = reframe?.keyframes
    ?.map((keyframe) => ({
      time: Number(keyframe.time),
      x: clamp(Number(keyframe.x), 0, 1),
      y: clamp(Number(keyframe.y), 0, 1),
    }))
    .filter((keyframe) => Number.isFinite(keyframe.time))
    .sort((a, b) => a.time - b.time);

  if (!keyframes?.length) {
    return {x: 0.5, y: 0.5};
  }

  if (time <= keyframes[0].time) {
    return {x: keyframes[0].x, y: keyframes[0].y};
  }

  for (let index = 1; index < keyframes.length; index += 1) {
    const previous = keyframes[index - 1];
    const next = keyframes[index];
    if (time <= next.time) {
      const progress = clamp(
        (time - previous.time) / Math.max(0.001, next.time - previous.time),
        0,
        1,
      );
      const eased = Easing.inOut(Easing.cubic)(progress);
      return {
        x: interpolate(eased, [0, 1], [previous.x, next.x]),
        y: interpolate(eased, [0, 1], [previous.y, next.y]),
      };
    }
  }

  const last = keyframes.at(-1);
  return {x: last?.x ?? 0.5, y: last?.y ?? 0.5};
};

const reframeObjectPosition = ({
  autoReframe,
  clip,
  localSeconds,
  outputWidth,
  outputHeight,
  sourceWidth,
  sourceHeight,
}: {
  autoReframe: boolean;
  clip: ClipWithTiming;
  localSeconds: number;
  outputWidth: number;
  outputHeight: number;
  sourceWidth: number;
  sourceHeight: number;
}) => {
  if (!autoReframe) {
    return "50% 50%";
  }

  const outputRatio = outputWidth / Math.max(outputHeight, 1);
  const sourceRatio = sourceWidth / Math.max(sourceHeight, 1);
  const focus = focusAt(clip.reframe, localSeconds);
  const reframeConfidence = clamp(Number(clip.reframe?.confidence) || 0.35, 0, 1);
  const follow = interpolate(reframeConfidence, [0.35, 0.85], [0.55, 0.92], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const x = 0.5 + (focus.x - 0.5) * follow;
  const y = 0.5 + (focus.y - 0.5) * follow;

  if (outputRatio < sourceRatio) {
    return `${clamp(x * 100, 12, 88).toFixed(2)}% 50%`;
  }

  if (outputRatio > sourceRatio) {
    return `50% ${clamp(y * 100, 16, 84).toFixed(2)}%`;
  }

  return "50% 50%";
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

type SourceCandidate = {
  highlight: HighlightSegment;
  cursor: number;
  sourceIndex: number;
  sourcePosition: number;
};

type DirectorCut = {
  time: number;
  role: MusicCutRole;
  strength: number;
  sectionType?: MusicSectionType;
};

const metadataScore = (
  metadata: HighlightMetadata | undefined,
  key: keyof HighlightMetadata,
  fallback: number,
) => {
  const value = Number(metadata?.[key]);
  return Number.isFinite(value) ? clamp(value, 0, 1) : fallback;
};

const sectionPrefersStory = (sectionType: MusicSectionType | undefined) => {
  return sectionType === "intro" || sectionType === "verse" || sectionType === "outro";
};

const roleFitScore = (
  metadata: HighlightMetadata | undefined,
  beat: BeatDuration,
) => {
  const motion = metadataScore(metadata, "motionScore", 0.45);
  const shotDensity = metadataScore(metadata, "shotDensityScore", 0.45);
  const spike = metadataScore(metadata, "spikeScore", 0.35);
  const dialogue = metadataScore(metadata, "dialogueScore", 0.45);
  const face = metadataScore(metadata, "faceScore", 0.45);
  const scene = metadataScore(metadata, "sceneScore", 0.45);
  const loudness = metadataScore(metadata, "loudnessScore", 0.45);
  const energy = metadataScore(
    metadata,
    "energyScore",
    clamp(
      motion * 0.34 +
        shotDensity * 0.22 +
        scene * 0.16 +
        spike * 0.16 +
        loudness * 0.06 +
        (1 - dialogue) * 0.06,
      0,
      1,
    ),
  );
  const story = clamp(dialogue * 0.62 + face * 0.38, 0, 1);

  if (beat.role === "drop") {
    return energy * 0.34 + motion * 0.28 + scene * 0.18 + spike * 0.14 + shotDensity * 0.06;
  }

  if (beat.role === "strong") {
    return energy * 0.3 + spike * 0.24 + scene * 0.2 + motion * 0.18 + loudness * 0.08;
  }

  if (beat.role === "fill") {
    return motion * 0.34 + shotDensity * 0.28 + scene * 0.16 + energy * 0.16 + spike * 0.06;
  }

  if (beat.role === "transition") {
    return scene * 0.38 + shotDensity * 0.22 + energy * 0.2 + story * 0.2;
  }

  if (sectionPrefersStory(beat.sectionType)) {
    return story * 0.4 + scene * 0.18 + energy * 0.18 + loudness * 0.14 + motion * 0.1;
  }

  if (beat.sectionType === "build") {
    return energy * 0.3 + motion * 0.24 + shotDensity * 0.2 + scene * 0.16 + spike * 0.1;
  }

  return energy * 0.28 + scene * 0.22 + motion * 0.2 + story * 0.18 + spike * 0.12;
};

const metadataSimilarity = (
  current: HighlightMetadata | undefined,
  previous: HighlightMetadata | undefined,
) => {
  if (!current || !previous) {
    return 0;
  }

  const features: Array<keyof HighlightMetadata> = [
    "motionScore",
    "shotDensityScore",
    "spikeScore",
    "dialogueScore",
    "faceScore",
    "sceneScore",
    "energyScore",
  ];
  const distance =
    features.reduce((sum, key) => {
      return sum + Math.abs(metadataScore(current, key, 0.45) - metadataScore(previous, key, 0.45));
    }, 0) / features.length;
  const keyPenalty =
    current.varietyKey && previous.varietyKey && current.varietyKey === previous.varietyKey
      ? 0.28
      : 0;

  return clamp(1 - distance + keyPenalty, 0, 1);
};

const reframeForSegment = (
  reframe: ReframePath | undefined,
  offset: number,
  duration: number,
): ReframePath | undefined => {
  if (!reframe?.keyframes?.length) {
    return undefined;
  }

  const windowStart = Math.max(0, offset - 0.35);
  const windowEnd = offset + duration + 0.35;
  const keyframes = reframe.keyframes
    .filter((keyframe) => keyframe.time >= windowStart && keyframe.time <= windowEnd)
    .map((keyframe) => ({
      ...keyframe,
      time: clamp(keyframe.time - offset, 0, duration),
    }));

  if (keyframes.length === 0) {
    const closest = reframe.keyframes.reduce((best, keyframe) => {
      return Math.abs(keyframe.time - offset) < Math.abs(best.time - offset)
        ? keyframe
        : best;
    }, reframe.keyframes[0]);

    return {
      ...reframe,
      keyframes: [{...closest, time: 0}],
    };
  }

  return {
    ...reframe,
    keyframes,
  };
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

const mergeBeatDurationsForClipVariety = (
  durations: BeatDuration[],
  sourceCount: number,
  targetDuration: number,
) => {
  if (sourceCount <= 0 || durations.length <= sourceCount) {
    return durations;
  }

  const maxSegments = Math.max(1, Math.min(sourceCount, durations.length));
  const idealDuration = targetDuration / maxSegments;
  const merged: BeatDuration[] = [];
  let current: BeatDuration | null = null;

  const strongerRole = (left: MusicCutRole, right: MusicCutRole) => {
    const priority: Record<MusicCutRole, number> = {
      transition: 1,
      beat: 2,
      fill: 3,
      strong: 4,
      drop: 5,
    };

    return priority[right] > priority[left] ? right : left;
  };

  const pushCurrent = () => {
    if (current && current.duration >= 0.08) {
      merged.push({
        ...current,
        duration: Number(current.duration.toFixed(3)),
        strength: Number(current.strength.toFixed(3)),
      });
    }
    current = null;
  };

  for (const duration of durations) {
    if (!current) {
      current = {...duration};
    } else {
      current = {
        duration: current.duration + duration.duration,
        role: strongerRole(current.role, duration.role),
        strength: Math.max(current.strength, duration.strength),
        sectionType:
          duration.role === "drop" || duration.role === "strong"
            ? duration.sectionType ?? current.sectionType
            : current.sectionType ?? duration.sectionType,
      };
    }

    const remainingInput = durations.length - durations.indexOf(duration) - 1;
    const remainingSlots = maxSegments - merged.length - 1;
    const shouldClose =
      current.duration >= idealDuration &&
      remainingSlots > 0 &&
      remainingInput >= remainingSlots;

    if (shouldClose) {
      pushCurrent();
    }
  }

  pushCurrent();

  return merged.length > 0 ? merged.slice(0, maxSegments) : durations;
};

const assignBeatDurationsToHighlights = (
  highlights: HighlightSegment[],
  durations: BeatDuration[],
  targetDuration: number,
  editEnergy: EditEnergy,
) => {
  const chronologicalHighlights = [...highlights].sort(
    (a, b) => (Number(a.start) || 0) - (Number(b.start) || 0),
  );
  const minStart = Math.min(...chronologicalHighlights.map((highlight) => Number(highlight.start) || 0));
  const maxStart = Math.max(...chronologicalHighlights.map((highlight) => Number(highlight.start) || 0));
  const sourceSpan = Math.max(1, maxStart - minStart);
  const sources: SourceCandidate[] = chronologicalHighlights.map((highlight, sourceIndex) => ({
    highlight,
    cursor: 0,
    sourceIndex,
    sourcePosition: clamp(((Number(highlight.start) || 0) - minStart) / sourceSpan, 0, 1),
  }));
  const synced: HighlightSegment[] = [];
  let outputCursor = 0;
  let sourcePointer = 0;
  let previousSource = -1;
  let previousStart = -1;
  let previousMetadata: HighlightMetadata | undefined;
  const recentSources: number[] = [];
  const sourceUseCount = new Map<number, number>();
  const config = editEnergyConfig(editEnergy);

  const remainingFor = (index: number) => {
    return Math.max(0, sources[index].highlight.duration - sources[index].cursor);
  };

  const minimumRecentWindow = Math.min(
    sources.length > 4 ? 3 : sources.length > 2 ? 2 : 1,
    Math.max(0, sources.length - 1),
  );

  const hasFreshAlternative = (blockedIndex: number, beat: BeatDuration) => {
    return sources.some((source, index) => {
      if (index === blockedIndex || recentSources.includes(index)) {
        return false;
      }

      return remainingFor(index) >= Math.min(beat.duration, 0.08);
    });
  };

  const chooseSource = (beat: BeatDuration) => {
    const dropMoment = beat.role === "drop" || beat.sectionType === "drop";
    const buildMoment = beat.role === "strong" || beat.sectionType === "build";
    const useCounts = sources.map((_, index) => sourceUseCount.get(index) ?? 0);
    const minUseCount = Math.min(...useCounts);
    const maxRotationDistance = Math.max(1, sources.length - 1);
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
        const roleScore = roleFitScore(source.highlight.metadata, beat);
        const similarityPenalty = metadataSimilarity(
          source.highlight.metadata,
          previousMetadata,
        );
        const sameVarietyPenalty =
          source.highlight.metadata?.varietyKey &&
          previousMetadata?.varietyKey &&
          source.highlight.metadata.varietyKey === previousMetadata.varietyKey
            ? 0.32
            : 0;
        const roleWeight =
          beat.role === "drop"
            ? 1.45
            : beat.role === "strong"
              ? 1.2
              : beat.role === "fill"
                ? 1.05
                : sectionPrefersStory(beat.sectionType)
                  ? 0.9
                  : 1;
        const sourceUses = sourceUseCount.get(index) ?? 0;
        const usePenalty = clamp(sourceUses - minUseCount, 0, 4) * 1.25;
        const freshRoundBoost = sourceUses === minUseCount ? 1.15 : 0;
        const chronologicalScore = 1 - clamp(rotationDistance / maxRotationDistance, 0, 1);
        const timelinePosition = clamp(outputCursor / Math.max(0.1, targetDuration), 0, 1);
        const storyPositionScore = 1 - Math.abs(source.sourcePosition - timelinePosition);
        const dropLateBoost = dropMoment ? source.sourcePosition * 0.18 : 0;
        const buildVarietyBoost = buildMoment ? timestampDistance * 0.42 : 0;
        const hardRecentPenalty =
          sources.length > 2 && recentSources.includes(index) && hasFreshAlternative(index, beat)
            ? 3.8
            : 0;
        const hardPreviousPenalty =
          sources.length > 1 && index === previousSource && hasFreshAlternative(index, beat)
            ? 4.6
            : 0;
        const fitPenalty = canFit ? 0 : 0.45;
        const score =
          timestampDistance * 0.9 +
          chronologicalScore * 2.45 +
          storyPositionScore * 0.65 +
          roleScore * roleWeight +
          freshRoundBoost +
          dropLateBoost +
          buildVarietyBoost +
          -recentPenalty * 1.35 -
          previousPenalty * 1.85 -
          hardRecentPenalty -
          hardPreviousPenalty -
          similarityPenalty * 0.86 -
          sameVarietyPenalty * 1.25 -
          usePenalty -
          fitPenalty;

        return {index, score};
      })
      .filter((candidate): candidate is {index: number; score: number} => Boolean(candidate))
      .sort((a, b) => b.score - a.score);

    return candidates[0]?.index ?? -1;
  };

  for (let beatIndex = 0; beatIndex < durations.length; beatIndex += 1) {
    const beat = durations[beatIndex];
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
      metadata: source.highlight.metadata,
      reframe: reframeForSegment(source.highlight.reframe, source.cursor, duration),
    });

    previousStart = source.highlight.start + source.cursor;
    previousMetadata = source.highlight.metadata;
    source.cursor += duration;
    outputCursor += duration;
    previousSource = sourceIndex;
    sourceUseCount.set(sourceIndex, (sourceUseCount.get(sourceIndex) ?? 0) + 1);
    recentSources.push(sourceIndex);
    const maxRecent = Math.max(
      minimumRecentWindow,
      Math.min(config.recentWindow + (editEnergy === "aggressive" ? 1 : 0), Math.max(0, sources.length - 1)),
    );
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
  const varietyDurations = mergeBeatDurationsForClipVariety(
    durations,
    highlights.length,
    targetDuration,
  );
  const synced = assignBeatDurationsToHighlights(
    highlights,
    varietyDurations,
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
  if (preset === "smooth-slow" || preset === "smooth-documentary") {
    return "smooth-velocity";
  }

  if (preset === "fast-kinetic" || preset === "whip-cut" || preset === "drop-burst") {
    return "drop-whip";
  }

  if (preset === "flash-cuts" || preset === "hard-beat-cuts") {
    return "match-push";
  }

  if (preset === "impact-shake") {
    return "freeze-hit";
  }

  if (preset === "beat-punch") {
    return "beat-bounce";
  }

  if (
    preset === "slow-fast-mix" ||
    preset === "cinematic-ramp" ||
    preset === "slow-fast-builder"
  ) {
    return "slow-fast-builder";
  }

  if (preset !== "auto") {
    return preset;
  }

  if (effectPace === "slow") {
    return "smooth-velocity";
  }

  if (effectPace === "fast") {
    return effectStrength >= 0.72 ? "drop-whip" : "velocity-ramp";
  }

  if (effectStrength >= 0.72) {
    return "beat-bounce";
  }

  return "smooth-velocity";
};

const effectPlaybackRate = (
  requestedPreset: EffectPreset,
  resolvedPreset: ResolvedEffectPreset,
  effectPace: EffectPace,
  effectStrength: number,
) => {
  if (resolvedPreset === "slow-fast-builder") {
    if (effectPace === "slow") {
      return 0.78;
    }

    if (effectPace === "fast") {
      return 1.08;
    }

    return 0.94;
  }

  if (resolvedPreset === "smooth-velocity") {
    return 0.84;
  }

  if (resolvedPreset === "velocity-ramp") {
    return 0.96 + clamp(effectStrength, 0, 1) * 0.16;
  }

  if (resolvedPreset === "drop-whip") {
    return 1.08 + clamp(effectStrength, 0, 1) * 0.1;
  }

  if (resolvedPreset === "beat-bounce" || resolvedPreset === "snap-zoom") {
    return 1;
  }

  if (resolvedPreset === "freeze-hit") {
    return 0.86;
  }

  if (resolvedPreset === "match-push") {
    return 1.03;
  }

  if (resolvedPreset === "glitch-lite") {
    return 1.08;
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
    preset === "smooth-velocity"
      ? 28
      : preset === "freeze-hit"
        ? 10
        : preset === "drop-whip" || preset === "match-push" || preset === "glitch-lite"
          ? 5
          : preset === "snap-zoom"
            ? 4
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
    preset === "smooth-velocity"
      ? 0.1
      : preset === "drop-whip"
        ? 0.92
        : preset === "snap-zoom"
          ? 1
        : preset === "beat-bounce"
          ? 0.72
          : preset === "freeze-hit"
            ? 0.74
            : preset === "match-push"
              ? 0.82
              : preset === "glitch-lite"
                ? 0.9
                : 1;

  return pulse * clamp(effectStrength, 0.18, 1) * presetStrength;
};

const clipVisualOpacity = (
  frame: number,
  durationInFrames: number,
  requestedPreset: EffectPreset,
  resolvedPreset: ResolvedEffectPreset,
) => {
  if (
    requestedPreset === "slow-fast-mix" ||
    requestedPreset === "cinematic-ramp" ||
    requestedPreset === "slow-fast-builder" ||
    resolvedPreset === "drop-whip" ||
    resolvedPreset === "match-push" ||
    resolvedPreset === "glitch-lite"
  ) {
    return 1;
  }

  const fadeFrames =
    resolvedPreset === "smooth-velocity"
      ? 5
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

const effectVideoFilter = (
  colorEnhancement: ColorEnhancement,
  preset: ResolvedEffectPreset,
  pulse: number,
) => {
  const color = colorEnhancementFilter(colorEnhancement);
  const blur =
    preset === "drop-whip"
      ? pulse * 0.78
      : preset === "velocity-ramp" || preset === "match-push"
        ? pulse * 0.46
        : preset === "freeze-hit" || preset === "glitch-lite"
          ? pulse * 0.28
          : 0;
  const effect = blur > 0.01 ? `blur(${blur.toFixed(2)}px)` : "none";

  return [color, effect].filter((filter) => filter !== "none").join(" ") || "none";
};

const SourceClip: React.FC<{
  clip: ClipWithTiming;
  src: string;
  index: number;
  reframeMode: ReframeMode;
  sourceVolume: number;
  sourceWidth: number;
  sourceHeight: number;
  effectPreset: EffectPreset;
  colorEnhancement: ColorEnhancement;
  music?: MusicSettings;
}> = ({
  clip,
  src,
  index,
  reframeMode,
  sourceVolume,
  sourceWidth,
  sourceHeight,
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
  const bouncePulse = effectEventPulseAt(music, timelineSeconds, ["bounce", "pulse"]);
  const snapPulse = effectEventPulseAt(music, timelineSeconds, ["snap", "flash"]);
  const rampPulse = effectEventPulseAt(music, timelineSeconds, ["ramp"]);
  const impactPulse = effectEventPulseAt(music, timelineSeconds, ["impact", "freeze"]);
  const whipPulse = effectEventPulseAt(music, timelineSeconds, ["whip"]);
  const pushPulse = effectEventPulseAt(music, timelineSeconds, ["push"]);
  const glitchPulse = effectEventPulseAt(music, timelineSeconds, ["glitch"]);
  const reactivePulse = Math.max(
    pulse,
    musicPulse * 0.68,
    bouncePulse * 0.64,
    snapPulse * 0.88,
    rampPulse * 0.72,
    impactPulse,
    whipPulse * 0.82,
    pushPulse * 0.78,
    glitchPulse * 0.84,
  );
  const isBuilderPreset =
    effectPreset === "slow-fast-mix" ||
    effectPreset === "cinematic-ramp" ||
    effectPreset === "slow-fast-builder";
  const styledPulse = isBuilderPreset ? reactivePulse * 0.58 : reactivePulse;
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
  const objectPosition = reframeObjectPosition({
    autoReframe,
    clip,
    localSeconds: frame / fps,
    outputWidth: width,
    outputHeight: height,
    sourceWidth,
    sourceHeight,
  });
  const movementEnabled = resolvedPreset !== "clean";
  const motionScale = autoReframe ? 1 : 0.42;
  const endScale =
    !movementEnabled || resolvedPreset === "match-push"
      ? 1
      : resolvedPreset === "smooth-velocity"
        ? 1.038
        : resolvedPreset === "velocity-ramp"
          ? 1.028
          : resolvedPreset === "drop-whip" || resolvedPreset === "slow-fast-builder"
            ? 1.018
            : resolvedPreset === "beat-bounce" || resolvedPreset === "snap-zoom"
              ? 1.014
              : 1.018;
  const scale = interpolate(frame, [0, clip.durationInFrames], [1.002, endScale], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing:
      resolvedPreset === "smooth-velocity"
        ? Easing.inOut(Easing.cubic)
        : Easing.out(Easing.cubic),
  });
  const rampScale = rampPulse * 0.018 * motionScale;
  const bounceScale = bouncePulse * 0.026 * motionScale;
  const snapScale = snapPulse * 0.052 * motionScale;
  const freezeScale = impactPulse * (resolvedPreset === "freeze-hit" ? 0.02 : 0.012) * motionScale;
  const effectScale =
    movementEnabled &&
    (resolvedPreset === "velocity-ramp" ||
      resolvedPreset === "drop-whip" ||
      resolvedPreset === "beat-bounce" ||
      resolvedPreset === "freeze-hit" ||
      resolvedPreset === "snap-zoom" ||
      resolvedPreset === "slow-fast-builder" ||
      resolvedPreset === "glitch-lite")
      ? styledPulse *
        (resolvedPreset === "velocity-ramp"
          ? 0.03
          : resolvedPreset === "drop-whip"
            ? 0.052
            : resolvedPreset === "beat-bounce"
              ? 0.032
              : resolvedPreset === "snap-zoom"
                ? 0.048
                : resolvedPreset === "slow-fast-builder"
                  ? 0.024
                  : resolvedPreset === "glitch-lite"
                    ? 0.018
                    : 0.028) *
        motionScale
      : 0;
  const shakePreset =
    resolvedPreset === "freeze-hit"
      ? 0.45
      : resolvedPreset === "glitch-lite"
        ? 0.5
        : resolvedPreset === "drop-whip"
        ? 0.28
        : resolvedPreset === "velocity-ramp"
          ? 0.16
        : 0;
  const shakeAmount =
    movementEnabled && shakePreset > 0
      ? Math.sin(frame * (resolvedPreset === "glitch-lite" ? 3.7 : 2.1) + index) *
        Math.max(styledPulse, impactPulse * 1.15, whipPulse * 0.72, glitchPulse) *
        Math.max(1.5, width * 0.0026) *
        (0.35 + clip.effectStrength * 0.42) *
        shakePreset *
        motionScale
      : 0;
  const direction = index % 2 === 0 ? 1 : -1;
  const slideAmount =
    movementEnabled &&
    (resolvedPreset === "velocity-ramp" ||
      resolvedPreset === "drop-whip" ||
      resolvedPreset === "match-push" ||
      resolvedPreset === "slow-fast-builder")
      ? direction *
        Math.max(styledPulse, pushPulse * 0.95, whipPulse * 0.8, rampPulse * 0.6) *
        Math.max(
          3,
          width *
            (resolvedPreset === "match-push"
              ? 0.03
              : resolvedPreset === "drop-whip"
                ? 0.02
                : 0.014),
        ) *
        motionScale
      : 0;
  const rotation =
    movementEnabled &&
    (resolvedPreset === "velocity-ramp" ||
      resolvedPreset === "drop-whip" ||
      resolvedPreset === "freeze-hit" ||
      resolvedPreset === "glitch-lite")
      ? Math.sin(frame * (resolvedPreset === "freeze-hit" ? 2.6 : 1.35) + index) *
        Math.max(styledPulse, glitchPulse * 0.85) *
        (resolvedPreset === "freeze-hit"
          ? 0.26
          : resolvedPreset === "drop-whip"
            ? 0.28
            : resolvedPreset === "glitch-lite"
              ? 0.18
              : 0.2) *
        motionScale
      : 0;
  const bounceY =
    movementEnabled && resolvedPreset === "beat-bounce"
      ? -Math.sin(Math.min(1, bouncePulse) * Math.PI) * Math.max(2, height * 0.006) * motionScale
      : 0;
  const smoothDrift =
    movementEnabled && resolvedPreset === "smooth-velocity"
      ? Math.sin((frame / Math.max(1, clip.durationInFrames)) * Math.PI * 2 + index) *
        Math.max(1, width * 0.002) *
        motionScale
      : 0;
  const matchPushY =
    movementEnabled && resolvedPreset === "match-push"
      ? -pushPulse * Math.max(2, height * 0.008) * motionScale
      : 0;
  const freezeNudge =
    movementEnabled && resolvedPreset === "freeze-hit"
      ? Math.round(Math.sin(frame * Math.PI) * impactPulse * 2 * motionScale)
      : 0;
  const glitchNudge =
    movementEnabled && resolvedPreset === "glitch-lite"
      ? Math.round(Math.sin(frame * 4.6 + index) * glitchPulse * Math.max(2, width * 0.003) * motionScale)
      : 0;
  const cinematicRampScaleFactor = isBuilderPreset ? 0.55 : 1;
  const totalScale =
    scale +
    effectScale * cinematicRampScaleFactor +
    (movementEnabled ? rampScale + bounceScale + snapScale + freezeScale : 0);
  const transform = movementEnabled
    ? `translate3d(${shakeAmount + slideAmount + smoothDrift + freezeNudge + glitchNudge}px, ${bounceY + matchPushY}px, 0) scale(${totalScale}) rotate(${rotation}deg)`
    : undefined;
  const clipPath =
    movementEnabled && resolvedPreset === "glitch-lite" && glitchPulse > 0.05
      ? `inset(${(glitchPulse * 1.8).toFixed(2)}% 0 ${(glitchPulse * 1.2).toFixed(2)}% 0)`
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
          objectPosition,
          opacity: visualOpacity,
          transform,
          clipPath,
          filter: effectVideoFilter(colorEnhancement, resolvedPreset, styledPulse),
        }}
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
  sourceWidth,
  sourceHeight,
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
    ? activeMusic.muteSourceAudio
      ? 0
      : clamp(Number(activeMusic.sourceVolume), 0, 1)
    : 1;
  const originalWidth = Math.max(1, Number(sourceWidth) || 1920);
  const originalHeight = Math.max(1, Number(sourceHeight) || 1080);

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
            sourceWidth={originalWidth}
            sourceHeight={originalHeight}
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
