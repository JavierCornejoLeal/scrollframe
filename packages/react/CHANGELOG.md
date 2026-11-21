# @scrollframe/react

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
