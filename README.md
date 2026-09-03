# YouTube Transcript Copier

Firefox extension that copies the current YouTube video’s captions to the clipboard as timestamped text:

```
[0:12] Hello everyone
[0:18] Today we are going to...
```

Use the toolbar icon or the **Copy transcript** button on watch pages and Shorts.

## Install as a temporary add-on

1. Open Firefox (128 or newer).
2. Go to `about:debugging#/runtime/this-firefox`.
3. Click **This Firefox** in the left sidebar if you are not already there.
4. Click **Load Temporary Add-on…**.
5. Select `manifest.json` in this folder.
6. Pin the toolbar icon: puzzle-piece menu → pin **YouTube Transcript Copier**.

Temporary add-ons are removed when Firefox restarts. Load `manifest.json` again after a restart.

If a YouTube tab was already open when you loaded the add-on, reload that tab (or use the toolbar icon, which can inject the scripts) so the on-page button appears.

## Use

1. Open a YouTube watch page or Short that has captions.
2. Click the toolbar icon, or **Copy transcript** under the video (watch) / on the Short.
3. Paste. Each cue is a line: `[m:ss]` or `[h:mm:ss]` plus the caption text.

The extension prefers manual captions over auto-generated ones, then the video’s default language, then English, then the first available track.

## Requirements

- Firefox 128+ (`content_scripts.world: "MAIN"` is used to read the player response)
- A video with captions (manual or auto-generated)

## Caveats

- Videos with no caption track cannot be copied. There is no speech-to-text fallback.
- Auto-generated captions follow YouTube’s wording and timing, including mistakes.
- Signed `timedtext` URLs can fail if the player data is stale; refresh the page and try again.
- The on-page button follows YouTube’s SPA navigations (`yt-navigate-finish` and URL changes). If the layout experiment hides `#actions`, the button may not appear until the actions row is in the DOM; the toolbar popup still works.
- This is a local temporary add-on only. It is not packaged for Chrome/Edge and is not listed on addons.mozilla.org.
