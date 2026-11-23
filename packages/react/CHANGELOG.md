# @scrollframe/react

## 0.5.0

### Minor Changes

- 7e7e813: Sharper and more fluid sequences, whatever the length of the video.

  **Changed defaults:**

  - The sequence spans the page. Pass `fullWidth={false}` or `full-width="false"` to keep the width of its parent.
  - Frames follow the duration (15 per second, at least 120), and so does the scroll length, also with `--frames` or `--widths`.
  - Frames go up to 2560 px at higher quality, with portrait crops for phones and tablets, so a sequence weighs more. `--frames`, `--widths` and `--quality` still override this.
  - The generated components no longer write an `<h1>` over the video.

  **Engine:**

  - The scroll is eased, and progress (`--sf-progress`, `onProgress`) follows the eased position.
  - Only frames near the scroll are decoded, and a long sequence only downloads what is near plus a coarse pass.

  Manifests from earlier versions keep working. New sequences need this version of `@scrollframe/react` or `@scrollframe/element`: when a project has an older one, the CLI updates it (or, with `--no-install`, says so). With `--force`, a folder named `large` is only replaced next to a sequence's `manifest.json`.

  The fix the CLI prints when npm 12 blocked ffmpeg now works after a blocked `npx` run.

### Patch Changes

- Updated dependencies [7e7e813]
  - @scrollframe/core@0.5.0

## 0.3.0

### Patch Changes

- Updated dependencies [889b2ea]
  - @scrollframe/core@0.3.0

## 0.2.0

### Patch Changes

- 6ca8263: New `@scrollframe/element` package: the `<scroll-sequence>` custom element brings scroll storytelling to any framework (Angular, Vue, Svelte, Astro) and to plain HTML, with a CDN bundle and a static stylesheet. `@scrollframe/core` adds `posterImage`, `renderPosterMarkup` and `renderStageMarkup` so servers can render the poster before any script runs. `@scrollframe/react` renders its poster from the shared `posterImage`; its HTML is unchanged.
- Updated dependencies [6ca8263]
  - @scrollframe/core@0.2.0

## 0.1.1

### Patch Changes

- d97500a: Fix the npm release: `@scrollframe/react@0.1.0` shipped a `workspace:^` dependency and could not be installed, so 0.1.1 publishes it with a real `@scrollframe/core` range. The CLI is now published as `@scrollframe/cli` (npm rejects the unscoped `scrollframe` name as too similar to an existing package); the command is still `scrollframe`, run it with `npx @scrollframe/cli <video>`. Publishing with plain `npm publish` is now refused.
- Updated dependencies [d97500a]
  - @scrollframe/core@0.1.1

## 0.1.0

### Minor Changes

- 1261515: Initial release: `scrollframe` CLI (video to responsive WebP frames + manifest), `@scrollframe/core` canvas engine and `@scrollframe/react` `<ScrollSequence>` component.

### Patch Changes

- Updated dependencies [1261515]
  - @scrollframe/core@0.1.0
