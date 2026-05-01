import {Composition, type CalculateMetadataFunction} from "remotion";
import {
  HookVideo,
  getHookDurationSeconds,
  type HookVideoInputProps,
} from "./HookVideo";

const DEFAULT_FPS = 30;
const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;

const defaultProps: HookVideoInputProps = {
  src: "",
  width: DEFAULT_WIDTH,
  height: DEFAULT_HEIGHT,
  fps: DEFAULT_FPS,
  sourceWidth: DEFAULT_WIDTH,
  sourceHeight: DEFAULT_HEIGHT,
  outputAspectRatio: "source",
  reframeMode: "none",
  effectPreset: "clean",
  music: undefined,
  title: "",
  highlights: [
    {
      start: 0,
      duration: 5,
    },
  ],
};

const finitePositive = (value: number, fallback: number) => {
  return Number.isFinite(value) && value > 0 ? value : fallback;
};

const normalizeHighlights = (highlights: HookVideoInputProps["highlights"]) => {
  return highlights
    .map((highlight) => ({
      start: finitePositive(highlight.start, 0),
      duration: finitePositive(highlight.duration, 0),
    }))
    .filter((highlight) => highlight.duration > 0);
};

const durationInFramesFromProps = (props: HookVideoInputProps) => {
  const fps = finitePositive(props.fps, DEFAULT_FPS);
  const seconds = getHookDurationSeconds({
    highlights: normalizeHighlights(props.highlights),
    music: props.music,
  });

  return Math.max(1, Math.round(seconds * fps));
};

const calculateMetadata: CalculateMetadataFunction<HookVideoInputProps> = ({
  props,
}) => {
  const width = Math.round(finitePositive(props.width, DEFAULT_WIDTH));
  const height = Math.round(finitePositive(props.height, DEFAULT_HEIGHT));
  const fps = finitePositive(props.fps, DEFAULT_FPS);
  const highlights = normalizeHighlights(props.highlights);

  return {
    width,
    height,
    fps,
    durationInFrames: durationInFramesFromProps({...props, fps, highlights}),
    props: {
      ...props,
      width,
      height,
      fps,
      highlights,
    },
  };
};

export const RemotionRoot = () => {
  return (
    <Composition
      id="HookVideo"
      component={HookVideo}
      durationInFrames={durationInFramesFromProps(defaultProps)}
      fps={DEFAULT_FPS}
      width={DEFAULT_WIDTH}
      height={DEFAULT_HEIGHT}
      defaultProps={defaultProps}
      calculateMetadata={calculateMetadata}
    />
  );
};
