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
export type BeatSyncIntensity = "loose" | "tight" | "fast";
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

export type BeatSyncSettings = {
  enabled: boolean;
  intensity: BeatSyncIntensity;
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

const beatSyncConfig = (intensity: BeatSyncIntensity) => {
  if (intensity === "fast") {
    return {min: 0.28, max: 0.9, ideal: 0.55, beatsPerCut: 1};
  }

  if (intensity === "loose") {
    return {min: 0.8, max: 2.4, ideal: 1.55, beatsPerCut: 2};
  }

  return {min: 0.45, max: 1.35, ideal: 0.85, beatsPerCut: 1};
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
  const enabled = Boolean(
    music?.enabled &&
      music.src &&
      music.beatSync?.enabled &&
      Array.isArray(music.beats) &&
      music.beats.length >= 2,
  );

  if (!enabled || !music) {
    return highlights;
  }

  const totalSeconds = Math.max(0.1, totalHighlightSeconds(highlights));
  const musicStart = Math.max(0, Number(music.start) || 0);
  const musicDuration = Math.max(0.1, Number(music.duration) || totalSeconds);
  const targetDuration = Math.min(totalSeconds, musicDuration);
  const config = beatSyncConfig(music.beatSync?.intensity ?? "tight");
  const beats = music.beats ?? [];
  const relativeBeats = beats
    .map((beat) => Number(beat) - musicStart)
    .filter((beat) => Number.isFinite(beat) && beat > 0.08 && beat < targetDuration - 0.08)
    .sort((a, b) => a - b);

  if (relativeBeats.length < 2 || highlights.length === 0) {
    return highlights;
  }

  const boundaries = [0, ...relativeBeats, targetDuration];
  const synced: HighlightSegment[] = [];
  let cursor = 0;
  let boundaryIndex = 1;
  const maxClips = 180;

  const nextBeatBoundary = (remainingSource: number) => {
    const maxDuration = Math.min(config.max, remainingSource, targetDuration - cursor);
    const minDuration = Math.min(config.min, maxDuration);
    const minCut = cursor + minDuration;
    const maxCut = cursor + maxDuration;

    while (boundaryIndex < boundaries.length && boundaries[boundaryIndex] <= cursor + 0.05) {
      boundaryIndex += 1;
    }

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

  for (const source of highlights) {
    let sourceCursor = 0;

    while (
      sourceCursor < source.duration - 0.05 &&
      cursor < targetDuration - 0.05 &&
      synced.length < maxClips
    ) {
      const remainingSource = source.duration - sourceCursor;
      const nextBoundary = nextBeatBoundary(remainingSource);
      const duration = Math.min(
        Math.max(0.08, nextBoundary - cursor),
        remainingSource,
        targetDuration - cursor,
      );

      if (duration < 0.08) {
        break;
      }

      synced.push({
        start: Number((source.start + sourceCursor).toFixed(3)),
        duration: Number(duration.toFixed(3)),
      });

      cursor += duration;
      sourceCursor += duration;
      if (Math.abs(cursor - nextBoundary) < 0.04) {
        boundaryIndex += 1;
      }
    }

    if (cursor >= targetDuration - 0.05 || synced.length >= maxClips) {
      break;
    }
  }

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
  let cursor = 0;

  return buildBeatSyncedHighlights(highlights, music)
    .map((highlight) => {
      const durationInFrames = Math.max(
        1,
        secondsToFrames(highlight.duration, fps),
      );
      const clip = {
        ...highlight,
        from: cursor,
        durationInFrames,
        effectStrength: beatStrengthAt(music, cursor / fps),
        effectPace: effectPaceAt(music, cursor / fps),
      };

      cursor += durationInFrames;
      return clip;
    })
    .filter((clip) => clip.durationInFrames > 0);
};

const clipFade = (frame: number, durationInFrames: number) => {
  const fadeFrames = Math.max(
    1,
    Math.min(
      Math.max(1, Math.floor(durationInFrames / 2)),
      clamp(Math.round(durationInFrames * 0.16), 3, 10),
    ),
  );
  const fadeIn = interpolate(frame, [0, fadeFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });
  const fadeOut = interpolate(
    frame,
    [durationInFrames - fadeFrames, durationInFrames],
    [1, 0],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
      easing: Easing.in(Easing.cubic),
    },
  );

  return Math.min(fadeIn, fadeOut);
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
    preset === "smooth-slow" ? 15 : preset === "impact-shake" ? 8 : 6;
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
      ? 0.34
      : preset === "fast-kinetic"
        ? 0.82
        : 1;

  return pulse * clamp(effectStrength, 0.18, 1) * presetStrength;
};

const flashOpacity = (
  pulse: number,
  preset: ResolvedEffectPreset,
  effectStrength: number,
) => {
  if (preset === "smooth-slow") {
    return pulse * 0.025;
  }

  if (preset === "fast-kinetic") {
    return pulse * (0.035 + effectStrength * 0.04);
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

const SourceClip: React.FC<{
  clip: ClipWithTiming;
  src: string;
  index: number;
  reframeMode: ReframeMode;
  sourceVolume: number;
  effectPreset: EffectPreset;
}> = ({clip, src, index, reframeMode, sourceVolume, effectPreset}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const videoSrc = resolveMediaSrc(src);
  const visualOpacity = clipFade(frame, clip.durationInFrames);
  const resolvedPreset = resolveEffectPreset(
    effectPreset,
    clip.effectStrength,
    clip.effectPace,
  );
  const pulse = cutPulse(
    frame,
    clip.durationInFrames,
    resolvedPreset,
    clip.effectStrength,
  );
  const trimBefore = secondsToFrames(clip.start, fps);
  const trimAfter = secondsToFrames(clip.start + clip.duration, fps);
  const autoReframe = reframeMode === "auto";
  const portraitFrame = width < height;
  const panDistance =
    resolvedPreset === "smooth-slow"
      ? 4
      : resolvedPreset === "fast-kinetic"
        ? 9
        : 7;
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
      ? 1.022
      : resolvedPreset === "fast-kinetic"
        ? 1.038
        : 1.045;
  const scale = interpolate(frame, [0, clip.durationInFrames], [1.006, endScale], {
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
      ? pulse *
        (resolvedPreset === "smooth-slow"
          ? 0.006
          : resolvedPreset === "fast-kinetic"
            ? 0.022
            : resolvedPreset === "impact-shake"
              ? 0.018
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
        pulse *
        Math.max(2, width * 0.0038) *
        (0.5 + clip.effectStrength * 0.55) *
        shakePreset
      : 0;
  const transform = autoReframe
    ? `translate3d(${shakeAmount}px, 0, 0) scale(${scale + effectScale})`
    : undefined;
  const overlayOpacity = flashOpacity(pulse, resolvedPreset, clip.effectStrength);

  return (
    <AbsoluteFill style={{backgroundColor: "#000", overflow: "hidden"}}>
      <OffthreadVideo
        src={videoSrc}
        trimBefore={trimBefore}
        trimAfter={trimAfter}
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
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.12) 0%, rgba(0,0,0,0) 34%, rgba(0,0,0,0.36) 100%)",
          pointerEvents: "none",
        }}
      />
      {overlayOpacity > 0 ? (
        <AbsoluteFill
          style={{
            backgroundColor: "#fff",
            opacity: overlayOpacity,
            pointerEvents: "none",
          }}
        />
      ) : null}
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
