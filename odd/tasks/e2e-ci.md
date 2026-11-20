# e2e-ci

Objective: a hard CI that proves the published packages work end to end (install, CLI, real browser) before anything reaches npm, plus a recorded video of the scroll.
Branch: `ci/e2e-pipeline` · Delivery: `ask-on-risk` · Test runners: vitest (unit), node:test (CLI e2e), Playwright (browser e2e).

## Specs

- S1: "hacer un duro Ci CD con diferentes tests, para que haga pruebas y que todo funcione correctamente": unit tests on a Node × OS matrix, package checks on the packed tarballs, CLI end to end on Linux/macOS/Windows, browser end to end on Chromium/Firefox/WebKit.
- S2: "podriamos incluso que haga una prueba con un video o algo para visualizar que funciona correctamente": input is a synthetic video generated with ffmpeg ("dale uno sintetico generado con ffmpeg"); the browser run records a video of the scroll, uploaded as a CI artifact.
- S3: "no tendriamos PRE, directaemntae todo iria a PRO, pero deberia de autorizarlo yo directamente": `npm` environment with the owner as required reviewer, limited to `main`; `main` protected so a red CI cannot merge.

## Tasks

- [x] T1 (S3) `npm` environment with required reviewer `JavierCornejoLeal`, deployment branch `main` — inline (gh api)
- [x] T2 (S1, S2) e2e fixture: synthetic video, CLI e2e (node:test), Vite+React app, Playwright specs + demo video — inline
- [x] T3 (S1, S2) CI workflow: unit matrix, package checks, CLI e2e matrix, browser e2e, `CI passed` gate — inline (pending first GitHub run)
- [x] T4 (S3) Branch protection on `main` requiring `CI passed` — inline (gh api)

## Log

- L1 (2026-11-20): "Vale, antes de directamente publicar el paquete en npm y toda la historia, lo que busco es simplemente, hacer un duro Ci CD con diferentes tests, para que haga pruebas y que todo funcione correctamente, podriamos incluso que haga una prueba con un video o algo para visualizar que funciona correctamente por decirlo de alguna manera"
- L2 (2026-11-20): "Si, dale uno sintetico generado con ffmpeg, esas pruebas cuanto tiempo tardarian, en este caso no tendriamos PRE, directaemntae todo iria a PRO, pero deberia de autorizarlo yo directamente"
- L3: Finding: the `npm` environment referenced by `release.yml` did not exist (GitHub auto-creates it without protection), and `main` had no branch protection. Owner authorized creating both ("Si dale").
- L4: T1 done: environment `npm` has a `required_reviewers` rule (owner) and a `branch_policy` (`main`).
- L5: Local evidence (macOS, Node 24, npm 12.2): CLI e2e 9/9 pass (~9 s); Playwright 34 pass + 6 skipped (CWV specs are Chromium-only) on Chromium/Firefox/WebKit (~12 s); demo video recorded, counter 0 -> 1.96 follows the scroll. publint and attw clean. vitest 75/75.
- L6: Finding A (product, open): npm 12 blocks dependency install scripts by default, so `ffmpeg-static` downloads no binary and `npx scrollframe hero.mp4` falls back to a system ffmpeg. The fixture approves it via `allowScripts`; CI on Node 22 (npm 10) would not show it.
- L7: Finding B (docs, open): Chromium excludes images covering the whole viewport from LCP, so the full-bleed poster is never the LCP (the overlay heading is). Proven with a probe: at 90% height the poster becomes LCP. Spec now asserts the sequence never becomes or delays LCP, plus the 90% case. README "The poster is the LCP" is inaccurate.
- L8: T4 done: `main` requires `CI passed`, enforce_admins on, no force pushes or deletions.
