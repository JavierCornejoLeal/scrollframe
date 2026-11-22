# more-stacks

Objective: verify, and implement where missing, scrollframe in the well-known stacks beyond Next.js, React, Angular, Vue and static HTML. "Supported" means proven in a real project.
Branch: `feat/more-stacks` · Baseline: `9587ac1` (0.3.0, published) · Delivery: `auto-chain` candidate, one PR per task family · Runners: vitest, node:test (CLI e2e), Playwright, real scratch projects.

## Specs

- S1: "vamos a intentar confirmar y verfiicar que podamos trabajr y usar dentro de wordprees, PHP, astro, todos los frameworks conocidos que nos falten por implementar, paso a paso"
- S2 (assumption): a stack is listed as supported only after: real project, CLI end to end, production build or real server, frame URLs return 200, pinned sequence in three browser engines.
- S3 (assumption): an existing user file is never overwritten; build output folders are never used for frames.

## Tasks

- [ ] T0 (S2, S3) stop wrong successes in 0.3.0: meta-frameworks taken for React/Vue, native apps, build-output folders
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
