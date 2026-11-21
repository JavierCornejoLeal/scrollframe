# @scrollframe/core

## 0.3.0

### Minor Changes

- 889b2ea: `npx @scrollframe/cli hero.mp4` now sets up your project: in a terminal it detects Next.js, React, Angular, Vue or plain HTML, shows a plan and, after one confirmation, installs the matching scrollframe package with your package manager and writes a ready-to-use component (or a plain HTML snippet with the poster already rendered). It fixes `overflow-x: hidden` on `html`/`body` (as in the Next.js 16 starter), which stops the sequence from staying pinned. New flags: `--yes`, `--framework`, `--name`, `--no-install`. Without a terminal and without `--yes` it only generates the frames, as before.

  `@scrollframe/core` warns in the console when an ancestor's overflow stops the sequence from staying pinned, and exports `findStickyBlocker`.

## 0.2.0

### Minor Changes

- 6ca8263: New `@scrollframe/element` package: the `<scroll-sequence>` custom element brings scroll storytelling to any framework (Angular, Vue, Svelte, Astro) and to plain HTML, with a CDN bundle and a static stylesheet. `@scrollframe/core` adds `posterImage`, `renderPosterMarkup` and `renderStageMarkup` so servers can render the poster before any script runs. `@scrollframe/react` renders its poster from the shared `posterImage`; its HTML is unchanged.

## 0.1.1

### Patch Changes

- d97500a: Fix the npm release: `@scrollframe/react@0.1.0` shipped a `workspace:^` dependency and could not be installed, so 0.1.1 publishes it with a real `@scrollframe/core` range. The CLI is now published as `@scrollframe/cli` (npm rejects the unscoped `scrollframe` name as too similar to an existing package); the command is still `scrollframe`, run it with `npx @scrollframe/cli <video>`. Publishing with plain `npm publish` is now refused.

## 0.1.0

### Minor Changes

- 1261515: Initial release: `scrollframe` CLI (video to responsive WebP frames + manifest), `@scrollframe/core` canvas engine and `@scrollframe/react` `<ScrollSequence>` component.
