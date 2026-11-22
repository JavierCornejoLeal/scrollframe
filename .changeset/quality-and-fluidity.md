---
"@scrollframe/core": minor
"@scrollframe/react": minor
"@scrollframe/element": minor
"@scrollframe/cli": minor
---

Sharper and more fluid sequences, whatever the length of the video.

**Changed defaults:**

- The sequence spans the page. Pass `fullWidth={false}` or `full-width="false"` to keep the width of its parent.
- Frames follow the duration (15 per second, at least 120) and so does the scroll length.
- Frames go up to 2560 px at higher quality, with portrait crops for phones and tablets, so a sequence weighs more. `--frames`, `--widths` and `--quality` still override this.
- The generated components no longer write an `<h1>` over the video.

**Engine:**

- The scroll is eased, and progress (`--sf-progress`, `onProgress`) follows the eased position.
- Only frames near the scroll are decoded, and a long sequence only downloads what is near plus a coarse pass.

Manifests from earlier versions keep working. New sequences need this version of `@scrollframe/react` or `@scrollframe/element`: when a project has an older one, the CLI updates it (or, with `--no-install`, says so). With `--force`, a folder named `large` is only replaced next to a sequence's `manifest.json`.

The fix the CLI prints when npm 12 blocked ffmpeg now works after a blocked `npx` run.
