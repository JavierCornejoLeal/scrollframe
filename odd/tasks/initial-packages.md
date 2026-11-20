# initial-packages

Objective: bootstrap the scrollframe monorepo (CLI + framework-agnostic core + React adapter) ready to develop and publish.
Branch: `feat/initial-packages` · Delivery: `ask-on-risk` · Test runner: vitest.

## Specs

- S1: Monorepo pnpm, open source on GitHub, publishable to npm (installable from npm/pnpm/yarn/bun). React/Next first: "Vamos con React/Next creame el repo o lo que tengas que crear, para poder trabajar directamente y sacar el paquete adelante".
- S2: CLI: "Le pasariamos un video, es decir con un comando pasariamos un video" → extracts optimized WebP frames for mobile, tablet and desktop into "su respectiva carpeta", plus a manifest and a poster.
- S3: Core: canvas scroll-scrubbed image sequence ("al ir moviendo el scroll basicamente haria el efecto del video") with performance-first loading (poster as LCP, lazy frames, viewport-matched set, reduced motion).
- S4: React adapter: component that accepts overlay children ("poner elementos encima del mismo, tipo textos y demas") and works with Next (client component).
- S5: SEO: frames decorative (`aria-hidden`); SEO lives in poster `alt` + semantic overlay HTML. (Assumption agreed in conversation; AI copy generation is out of scope for this feature.)

## Tasks

- [x] T1 (S1) Monorepo tooling: workspace, tsconfig, tsup, vitest, changesets, CI — inline — 8bbb3a3
- [x] T2 (S3) `@scrollframe/core` with tests — inline — c8bccb5
- [x] T3 (S4, S5) `@scrollframe/react` — inline — 6332631
- [x] T4 (S2) `scrollframe` CLI with tests — inline — 3db44fa

## Log

- L1 (2026-11-20): "Vamos con React/Next creame el repo o lo que tengas que crear, para poder trabajar directamente y sacar el paquete adelante, me ha parecido buena idea"
- L2: Package names: `scrollframe` (CLI, unscoped so `npx scrollframe` works), `@scrollframe/core`, `@scrollframe/react`. Both names were free on npm on 2026-11-20; the `@scrollframe` scope needs an npm org created by the owner.
- L3: Evidence: `pnpm test` 38/38 (incl. end-to-end with real ffmpeg-static), `pnpm typecheck` ok, `pnpm build` ok; built CLI smoke run on a 4s 1080p clip: mobile 0.7 MB, tablet 1.3 MB, desktop 2.1 MB for 120 frames; missing argument exits 2.
- L4: Decision: frames held as `HTMLImageElement`, not `ImageBitmap` (120 full-HD bitmaps would pin >1 GB RAM).
- L5: Next: Next.js example app, real Lighthouse run, `repository` field + absolute README links once the GitHub repo exists, create npm org `scrollframe`. Engram mirror: pending.
