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

export type MusicSettings = {
  src: string;
  start: number;
  duration: number;
  volume: number;
  sourceVolume: number;
  fadeSeconds: number;
  loop: boolean;
  enabled: boolean;
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
  music?: MusicSettings;
  highlights: HighlightSegment[];
  title?: string;
};

type ClipWithTiming = HighlightSegment & {
  from: number;
  durationInFrames: number;
};

const clamp = (value: number, min: number, max: number) => {
  return Math.min(Math.max(value, min), max);
};

const secondsToFrames = (seconds: number, fps: number) => {
  return Math.max(0, Math.round(seconds * fps));
};

const resolveMediaSrc = (src: string) => {
  if (/^(https?:|data:|blob:|\/)/i.test(src)) {
    return src;
  }

  return staticFile(src);
};

const buildTimeline = (
  highlights: HighlightSegment[],
  fps: number,
): ClipWithTiming[] => {
  let cursor = 0;

  return highlights
    .map((highlight) => {
      const durationInFrames = Math.max(
        1,
        secondsToFrames(highlight.duration, fps),
      );
      const clip = {
        ...highlight,
        from: cursor,
        durationInFrames,
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

const SourceClip: React.FC<{
  clip: ClipWithTiming;
  src: string;
  index: number;
  reframeMode: ReframeMode;
  sourceVolume: number;
}> = ({clip, src, index, reframeMode, sourceVolume}) => {
  const frame = useCurrentFrame();
  const {fps, width, height} = useVideoConfig();
  const videoSrc = resolveMediaSrc(src);
  const visualOpacity = clipFade(frame, clip.durationInFrames);
  const trimBefore = secondsToFrames(clip.start, fps);
  const trimAfter = secondsToFrames(clip.start + clip.duration, fps);
  const autoReframe = reframeMode === "auto";
  const portraitFrame = width < height;
  const panOffset = index % 3 === 0 ? -8 : index % 3 === 1 ? 0 : 8;
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
  const scale = interpolate(frame, [0, clip.durationInFrames], [1.015, 1.045], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.out(Easing.cubic),
  });

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
          transform: autoReframe ? `scale(${scale})` : undefined,
        }}
      />
      <AbsoluteFill
        style={{
          background:
            "linear-gradient(180deg, rgba(0,0,0,0.12) 0%, rgba(0,0,0,0) 34%, rgba(0,0,0,0.36) 100%)",
          pointerEvents: "none",
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
  outputAspectRatio = "source",
  reframeMode,
  music,
}) => {
  const {fps, durationInFrames} = useVideoConfig();
  const timeline = buildTimeline(highlights, fps);
  const cleanTitle = title.trim();
  const titleFrames = cleanTitle
    ? Math.min(durationInFrames, Math.round(fps * 2))
    : 0;
  const resolvedReframeMode =
    reframeMode ?? (outputAspectRatio === "source" ? "none" : "auto");
  const activeMusic = music?.enabled && music.src ? music : null;
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
