---
"@scrollframe/cli": minor
"@scrollframe/core": minor
---

`npx @scrollframe/cli hero.mp4` now sets up your project: in a terminal it detects Next.js, React, Angular, Vue or plain HTML, shows a plan and, after one confirmation, installs the matching scrollframe package with your package manager and writes a ready-to-use component (or a plain HTML snippet with the poster already rendered). It fixes `overflow-x: hidden` on `html`/`body` (as in the Next.js 16 starter), which stops the sequence from staying pinned. New flags: `--yes`, `--framework`, `--name`, `--no-install`. Without a terminal and without `--yes` it only generates the frames, as before.

`@scrollframe/core` warns in the console when an ancestor's overflow stops the sequence from staying pinned, and exports `findStickyBlocker`.
