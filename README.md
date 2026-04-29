# Hook Video Generator

A local Remotion app for turning one source video into a short hook compilation while preserving the source video's original aspect ratio and resolution.

The app analyzes a source video, chooses candidate hook moments, generates small preview thumbnails for review, and renders the final hook video from the original source file. It does not crop, stretch, letterbox, or force vertical output.

## Features

- Preserves the source video's original width, height, fps, and aspect ratio.
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
8. Click `Save` if you want to persist edits.
9. Click `Render Final Hook`.

The rendered file is saved to the selected output path, defaulting to `hook.mp4`.

## Render Settings

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

## Privacy Notes

This app is designed for local use. Source video paths stay on your machine, thumbnails are generated locally, and renders are written to your local output path.

Do not commit source videos, generated hook videos, thumbnails, or local `project.json` files to GitHub.

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
