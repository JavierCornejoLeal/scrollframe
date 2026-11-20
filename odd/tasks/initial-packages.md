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

- [x] T1 (S1) Monorepo tooling: workspace, tsconfig, tsup, vitest, changesets, CI — inline
- [x] T2 (S3) `@scrollframe/core` with tests — inline
- [x] T3 (S4, S5) `@scrollframe/react` — inline
- [x] T4 (S2) `scrollframe` CLI with tests — inline

## Log

- L1 (2026-11-20): "Vamos con React/Next creame el repo o lo que tengas que crear, para poder trabajar directamente y sacar el paquete adelante, me ha parecido buena idea"
- L2: Package names: `scrollframe` (CLI, unscoped so `npx scrollframe` works), `@scrollframe/core`, `@scrollframe/react`. Both names were free on npm on 2026-11-20; the `@scrollframe` scope needs an npm org created by the owner.
