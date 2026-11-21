# web-component

Objective: a framework-agnostic `<scroll-sequence>` custom element so the storytelling works in any project (Angular, Vue, Svelte, plain HTML, server-rendered backends), as the base for CLI scaffolding later.
Branch: `feat/web-component` · Baseline: `84955e4` · Delivery: `ask-on-risk`, one task at a time with owner check-in between tasks · Runners: vitest (unit), Playwright (browser e2e).

## Specs

- S1: "la idea esque en cualquier proyecto da igual el lenguaje al aplicar eso, te cree el componente del storytelling": this feature delivers the runtime half (a custom element usable from any framework or plain HTML); the scaffolding half is a later feature.
- S2: Light DOM, no Shadow DOM (owner approved: "Si"): overlay children stay real, indexable, styleable HTML.
- S3: Poster markup is shared: core exposes the poster data and an HTML string renderer, so the element, React and the future CLI snippet produce the same `<picture>`; React's server-rendered HTML must not change.
- S4: "ves poco a poco anñadiendo poco a poco las funcionalidades, y revisando su funcionamiento, no vayamos muy rapdiso porque tendremos que ir comprovandolo todo": one task per step, verified and reported before starting the next.

## Tasks

- [x] T1 (S3) core `posterImage` (data) + `renderPosterMarkup` (HTML string, escaped); React uses `posterImage`; React SSR output pinned by a regression test — inline
- [x] T2 (S1, S2) `@scrollframe/element` package: lifecycle, `src` / `.manifest`, `base-url`, events `sf-progress` / `sf-ready`, idempotent SSR-safe define — inline
- [ ] T2b (S1, S3) progressive enhancement: reuse a server-rendered poster already inside the element, so `src` does not delay the LCP image — inline
- [ ] T3 (S1) global `<script>` bundle (IIFE, core included) — inline
- [ ] T4 (S1) CI and release wiring: 4 tarballs, changesets `linked`, publish guard, publint/attw — inline
- [ ] T5 (S1, S2) browser e2e on a plain HTML page — inline
- [ ] T6 (S1) README "Any framework / plain HTML" + minor changeset — inline

## Log

- L1 (2026-11-21): "la idea esque en cualquier proyecto da igual el lenguaje al aplicar eso, te cree el componente del storytelling, con esta idea que me comentas seria capaz o como?"
- L2 (2026-11-21): Plan accepted ("Si, dale porfavor"); light DOM approved.
- L3 (2026-11-21): "Si, ves poco a poco anñadiendo poco a poco las funcionalidades, y revisando su funcionamiento, no vayamos muy rapdiso porque tendremos que ir comprovandolo todo"
- L4: T1 RED: `posterImage` / `renderPosterMarkup` "is not a function" (8 tests). React SSR pinned first (exact HTML for default + `priority:false`/`baseUrl`), passing on the old code.
- L5: T1 GREEN: core `poster.ts`; React now renders from `posterImage`. vitest 86/86, typecheck ok, core dist exports the new API. Mutation check: changing React's `<source type>` fails the pin; restored.
- L6: Decision: `posterImage` keeps React's rule (one `<source>` per set with a viewport limit), so a single bounded set still emits a `<source>`; the single-set test uses the unbounded set to match that.
- L7: Design change (T2): children are NOT moved into an overlay wrapper. Angular/Vue insert nodes before anchor comments that must stay direct children, so moving them throws on later inserts. Instead a stage (poster + canvas) is prepended and a per-document stylesheet stacks the stage and every child in one grid cell, `position: sticky; top: 0`.
- L8: T2 RED: module missing (13 tests). GREEN: 13/13; full suite 99/99; typecheck ok; built dist imports in plain Node and `defineScrollSequence()` returns undefined there. Mutation checks: not dropping a late manifest (1 fail), not destroying on disconnect (2 fail), moving children into an overlay (2 fail); restored 13/13.
- L9: T2 real-browser smoke (Chromium, plain HTML + import map, real engine, 60 CLI frames): `sf-ready` fired; at 25% and 75% of the scroll the stage is sticky at top 0, the overlay `<h1>` stays a direct child, pinned and hit-testable on top; `--sf-progress` 0.2500/0.7500; frames 15/44 (video counter 0.50 s / 1.46 s); no console errors. Not committed as a test yet (T5 adds the browser e2e).
- L10: Gap found: with `src`, the poster appears only after the manifest fetch, so it can delay the LCP. Added T2b (reuse a pre-rendered poster).
