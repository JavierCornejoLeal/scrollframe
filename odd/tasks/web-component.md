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
- [ ] T2 (S1, S2) `@scrollframe/element` package: lifecycle, `src` / `.manifest`, `base-url`, events `sf-progress` / `sf-ready`, idempotent SSR-safe define — inline
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
