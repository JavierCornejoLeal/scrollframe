# scrollframe

## 0.1.0

### Minor Changes

- 1261515: Initial release: `scrollframe` CLI (video to responsive WebP frames + manifest), `@scrollframe/core` canvas engine and `@scrollframe/react` `<ScrollSequence>` component.

### Patch Changes

- 7bbf7ed: Explain a missing bundled ffmpeg: when npm blocked ffmpeg-static's install script (npm 12+ default), the CLI now says so and prints the exact fixes (`npx --allow-scripts=ffmpeg-static scrollframe <video>`, or `npm install-scripts approve ffmpeg-static && npm rebuild ffmpeg-static`).
- Updated dependencies [1261515]
  - @scrollframe/core@0.1.0
