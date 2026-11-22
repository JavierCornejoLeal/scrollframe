# more-stacks

Objective: verify, and implement where missing, scrollframe in the well-known stacks beyond Next.js, React, Angular, Vue and static HTML. "Supported" means proven in a real project.
Branch: `feat/more-stacks` · Baseline: `9587ac1` (0.3.0, published) · Delivery: `auto-chain` candidate, one PR per task family · Runners: vitest, node:test (CLI e2e), Playwright, real scratch projects.

## Specs

- S1: "vamos a intentar confirmar y verfiicar que podamos trabajr y usar dentro de wordprees, PHP, astro, todos los frameworks conocidos que nos falten por implementar, paso a paso"
- S2 (assumption): a stack is listed as supported only after: real project, CLI end to end, production build or real server, frame URLs return 200, pinned sequence in three browser engines.
- S3 (assumption): an existing user file is never overwritten; build output folders are never used for frames.

## Tasks

- [ ] T0 (S2, S3) stop wrong successes in 0.3.0: set up only positively recognised projects (reopened, see L11)
- [ ] T1 (S1) PHP: document root and subfolder
- [ ] T2 (S1) WordPress: classic theme, block theme, install in a subfolder
- [ ] T3 (S1) Astro
- [ ] T4 (S1) Svelte, SvelteKit
- [ ] T5 (S1) Nuxt, VitePress
- [ ] T6 (S1) React Router / Remix, TanStack Start, Gatsby, Docusaurus
- [ ] T7 (S1) Preact, Solid, Qwik
- [ ] T8 (S1) Laravel (Blade, Inertia), Symfony
- [ ] T9 (S1) Django, Flask, Rails
- [ ] T10 (S1) Hugo, Eleventy, Jekyll
- [ ] T11 (S1) Spring Boot, ASP.NET
- [ ] T12 (S2) README lists proven stacks only, changeset

## Log

- L1 (2026-11-22): "No, vamos a intentar confirmar y verfiicar que podamos trabajr y usar dentro de wordprees, PHP, astro, todos los frameworks conocidos que nos falten por implementar, paso a paso"
- L2 (2026-11-22): State found: PR #20 and #21 were already merged and 0.3.0 published at 12:15 UTC; the assistant had reported both as pending without re-checking.
- L3 (2026-11-22): Baseline probe, 32 minimal project shapes through the built CLI (ffmpeg and installs faked): all exit 0. Gatsby, Docusaurus, React Router, TanStack, Expo are taken for React; VitePress and Inertia for React/Vue with other layouts; backends for plain HTML with URL /sequence whatever folder they serve. Shapes only: each still needs a real project.
- L4 (2026-11-22): T1/T2 RED with the published CLI 0.3.0, WordPress 7.1.5 + PHP 8.3.36 (Playground CLI 3.1.65): run inside a theme or a PHP subfolder it exits 0 and writes `/sequence/manifest.json`, which is a 404 (no poster, no frames) in Chromium, Firefox and WebKit. The same frames with the correct --base-url work in all three (frame 15/30 at 50%, stage pinned).
- L5 (2026-11-22): T2 throwaway prototype (not product code): a plugin with a shortcode that resolves its URL with plugins_url() and passes `base-url`. 9/9 runs pass: Twenty Twenty-Five, Twenty Twenty-One and WordPress under /blog, each in the three engines (poster, frames, pinned at top 0, full width, no 4xx, no warnings). Not checked yet: overlay hit test, block editor, Elementor, caching/optimizer plugins, real MySQL install, older WordPress/PHP.
- L6 (2026-11-22): open owner decision: WordPress output as a plugin (recommended: survives theme changes, any theme) or as a theme template part. T0 still needs real-project confirmation per stack.
- L7 (2026-11-22): "Si, dale con el plugin, vamos paso a paso". Decision for L6: WordPress output is a plugin with a shortcode. One task at a time with a check-in, starting with T0 on `fix/cli-false-success` (patch release).
- L8 (2026-11-22): T0 RED: published 0.3.0 on 21 real cases (official scaffolders, starter repositories, a WordPress download) exits 0, 18 of them setting the project up as React, Vue or plain HTML; 43 new tests failed. GREEN: `stacks.ts` names those stacks before React/Vue/HTML, the run ends with "Not set up: ...", Gatsby/Docusaurus/SvelteKit/Hugo frames go to static/, plain HTML warns that its URL assumes the site root, README no longer promises untested backends. Packed CLI: 21/21 end with "Not set up". Controls (Next, Vite React, Angular, Vue, static HTML): written files identical to 0.3.0, output identical except the new HTML note, non-interactive output identical. Seven mutations fail tests. vitest 271/271, typecheck ok, CLI e2e 15/15, publint 4/4. Windows not run yet (no CI until pushed).
- L9 (2026-11-22): T0 limits: Flask, Rails, Jekyll, Spring Boot, ASP.NET, VitePress, Qwik, Quasar, Vue CLI, CRA, Analog, Electron and legacy Angular are covered by fixtures only. Plain PHP in a subfolder only gets the note (fix is T1). Not detected: custom webpack React, Next `basePath`, Vite `base`.
- L10 (2026-11-22): the acknowledgement of the docs review of 77b344d (lineage review-d059868fdeb9bbef) was denied by the auto-mode classifier and left to the owner; not retried.
- L11 (2026-11-22): T0 reopened. af0707e is not releasable and L8 was wrong to call the supported projects intact. Codex (gpt-6.2-sol, read-only, clean export without odd/): fix first, 5 major + 3 minor, all reproduced. Same class, found while verifying: two more regressions (VitePress as a devDependency, react-native-web) and four remaining false successes (Flask factory, Bedrock, Hugo config.toml, a Laravel subfolder). Cause: a denylist, and dependency presence taken for app type.
- L12 (2026-11-22): "Si, dale rehazlo y pásalo otra vez por codex". Decision: set up only what is positively recognised; everything else gets frames only and says so; --framework forces it. A new Codex review runs before any PR is proposed.
- L13 (2026-11-22): T0 redone: `recognise.ts` sets up only positively recognised projects (Next with app/pages and no basePath; Vite + React or Vue plugin + root index.html with default base/root/publicDir; one Angular app serving public/ at /; static pages with no server code and no enclosing project); `stacks.ts` removed, names never decide. URLs come from the served folder; project files are read only when regular; exported API compatible with 0.3.0. RED 54 failures. vitest 320/320, typecheck, CLI e2e 15/15, publint 4/4, attw ok; 10 mutations caught (the FIFO one by hanging).
- L14 (2026-11-22): packed CLI: 21/21 real cases not set up; 5 controls write identical files (output identical except the HTML site-root note, non-interactive identical); the 14 review cases as expected (Quasar builds, -o media/hero 200, 0.3.0 type consumer compiles); holdout of 13 fresh official templates as expected (create-vite 9 no longer has react-swc-ts and produced vanilla; create-hono did not run); Next src/ JS, Next Pages Router, Vite React JS and SWC build for production. Windows not run. Awaiting the second Codex review: T0 stays open until it is triaged.
