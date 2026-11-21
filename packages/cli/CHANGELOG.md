# @scrollframe/cli

## 0.2.0

### Patch Changes

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

- 7bbf7ed: Explain a missing bundled ffmpeg: when npm blocked ffmpeg-static's install script (npm 12+ default), the CLI now says so and prints the exact fixes (`npx --allow-scripts=ffmpeg-static scrollframe <video>`, or `npm install-scripts approve ffmpeg-static && npm rebuild ffmpeg-static`).
- Updated dependencies [1261515]
  - @scrollframe/core@0.1.0
