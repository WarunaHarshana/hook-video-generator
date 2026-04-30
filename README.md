# Hook Video Generator

Create short hook videos from one source video.

The app finds strong highlight moments, shows preview thumbnails, lets you adjust the clips, and renders a final hook video. By default it keeps the original source aspect ratio and resolution. You can also export common social formats like vertical, square, portrait, and landscape with auto reframe.

## Features

- Choose one source video from your computer.
- Automatically find hook-worthy highlight moments.
- Review each hook with a thumbnail preview.
- Preview any hook before rendering.
- Edit start time and duration for each hook.
- Remove weak hooks before export.
- Add a background music file or direct media URL and auto-detect a strong music section.
- Control music volume and original source volume.
- Export in source original, 9:16, 1:1, 4:5, or 16:9.
- Auto reframe when exporting to a different aspect ratio.
- Keep the original source audio.
- Choose CPU or GPU rendering.
- Cancel long analyze or render jobs.

## Install

```bash
npm install
```

## Start The App

```bash
npm run ui
```

Open:

```text
http://127.0.0.1:3210
```

If port `3210` is already in use, the app will show the next available URL in the terminal.

## Workflow

1. Click `Choose` beside `Source video path`.
2. Select your source video.
3. Adjust `Clip seconds`, `Max clips`, and `Scene threshold` if needed.
4. Click `Analyze Hooks`.
5. Review the generated hook thumbnails.
6. Click a thumbnail to preview that moment.
7. Edit `Start` or `Duration`, or remove clips you do not want.
8. Choose a music file if you want background music.
9. Click `Analyze Music` to find a strong music section automatically.
10. Adjust the music start, duration, and volumes if needed.
11. Choose the final aspect ratio.
12. Click `Save` if you changed the hook list.
13. Click `Render Final Hook`.

The rendered video is saved to the selected output path. The default output is `hook.mp4`.

## Output Options

- `Source original`: keeps the source video's original size and aspect ratio.
- `9:16 vertical`: good for TikTok, Shorts, and Reels.
- `1:1 square`: good for square social posts.
- `4:5 portrait`: good for feed-style vertical posts.
- `16:9 landscape`: good for YouTube-style landscape videos.
- `Auto reframe`: fills the selected aspect ratio by reframing the video.

## Music Options

- `Choose`: select a local audio or video file to use as background music.
- `Music URL`: use a direct audio or video file URL.
- `Analyze Music`: finds a high-energy section that fits the hook video length.
- `Music start`: where the music section begins.
- `Music seconds`: how long the selected music section should play.
- `Music volume`: background music volume in the final render.
- `Source volume`: original video audio volume in the final render.
- `Use music in final render`: turn the music layer on or off.

## Render Options

- `Auto GPU`: tries hardware acceleration when available.
- `Force GPU`: requires hardware acceleration.
- `CPU only`: renders without GPU acceleration.
- `Concurrency`: controls how many render workers run at once. Lower it if your computer feels overloaded.
- `Timeout min`: increase this for very large or slow videos.

## Requirements

- Node.js
- npm
- A computer that can run Chromium-based video rendering
