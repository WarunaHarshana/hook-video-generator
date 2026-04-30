# Hook Video Generator

A local Remotion app for turning one source video into a short hook compilation. By default it preserves the source video's original aspect ratio and resolution, with optional final aspect presets for reframed exports.

The app analyzes a source video, chooses candidate hook moments, generates small preview thumbnails for review, and renders the final hook video from the original source file. Source-original output does not crop, stretch, letterbox, or force vertical output. Reframed outputs intentionally use cover-style framing to fill the selected final aspect.

## Features

- Preserves the source video's original width, height, fps, and aspect ratio.
- Can export source-original, 9:16, 1:1, 4:5, or 16:9 final videos.
- Auto-reframes clips when the final aspect differs from the source.
- Uses Remotion, React, `Sequence`, and `OffthreadVideo`.
- Keeps the original source audio.
- Selects hook candidates from shot changes, motion, audio/loudness, and other ranking signals.
- Lets you review generated hooks with thumbnail previews.
- Click a hook thumbnail to preview that source segment.
- Edit hook start times and durations manually.
- Render only after review using `Render Final Hook`.
- Supports CPU/GPU rendering modes.
- Streams progress to the UI with server-sent events.
- Supports cancelling analyze/render jobs.
- Avoids copying large source videos into temp storage during render.
- Tracks generated workspace files in a manifest and only cleans those files.

## Install

```bash
npm install
```

## Run The UI

```bash
npm run ui
```

Open:

```text
http://127.0.0.1:3210
```

If port `3210` is busy, the server will try the next available port.

## Workflow

1. Click `Choose` beside `Source video path`.
2. Select one source video file.
3. Adjust `Clip seconds`, `Max clips`, and `Scene threshold` if needed.
4. Click `Analyze Hooks`.
5. Review the generated hook thumbnails.
6. Click a thumbnail to preview that moment in the Source player.
7. Edit `Start` or `Duration`, or remove weak hooks.
8. Choose `Final aspect`. Keep `Source original` for no crop/reframe, or choose a social aspect and leave `Auto reframe` enabled.
9. Click `Save` if you want to persist edits.
10. Click `Render Final Hook`.

The rendered file is saved to the selected output path, defaulting to `hook.mp4`.

## Render Settings

- `Final aspect`
  - `Source original`: keeps the source video width, height, and aspect ratio.
  - `9:16`, `1:1`, `4:5`, `16:9`: renders to the selected final format.
- `Auto reframe`
  - When enabled for non-source formats, fills the output frame with simple animated reframing.
  - When disabled, the source is contained inside the selected output frame.
- `Render engine`
  - `Auto GPU`: use hardware acceleration if available.
  - `Force GPU`: require hardware acceleration.
  - `CPU only`: render with software mode.
- `GL`
  - Chromium GL backend for GPU rendering.
- `Concurrency`
  - Number of render workers. Lower it for very large 4K files or limited memory.
- `Timeout min`
  - Remotion media-loading timeout. Increase this for very large or slow-to-decode videos.

## Project Files

Main files:

- `src/Root.tsx` - Remotion composition registration.
- `src/HookVideo.tsx` - hook compilation component.
- `src/index.ts` - Remotion entrypoint.
- `scripts/analyze.ts` - source metadata and hook detection.
- `scripts/render.ts` - Remotion render script.
- `scripts/ui-server.ts` - local UI/API server.
- `ui/` - browser UI.
- `remotion.config.ts` - Remotion config.

## Example Project JSON

See `project.example.json`.

Real generated projects are written to `project.json`, which is ignored by Git because it contains local source paths.

## Local Generated Files

These are intentionally ignored:

- `project.json`
- `.hook-workspace-manifest.json`
- `.hook-thumbnails/`
- `uploads/`
- `.tmp/`
- `hook.mp4`
- source/rendered video files
- UI server logs

## Scripts

```bash
npm run ui
npm run studio
npm run analyze -- --input path/to/source.mp4
npm run render
npm run typecheck
```

## Requirements

- Node.js
- npm
- A system that can run Remotion/Chromium

FFmpeg and FFprobe are provided through project dependencies and Remotion tooling.
