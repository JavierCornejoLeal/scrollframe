# cli-scaffold

Objective: one command (`npx @scrollframe/cli hero.mp4`) generates the frames, detects the project, installs the right runtime package and writes a ready-to-use component, asking once before changing anything.
Branch: `feat/cli-scaffold` · Baseline: `554812a` · Delivery: `ask-on-risk`, tasks done one after another without check-in, verified each · Runners: vitest (unit), node:test (CLI e2e), Playwright (browser), real scratch projects per framework.

## Specs

- S1: "mi idea basicametne era que la gente hicera tipo pnpm install scrollframe, entonces ya directamente cogiera leyera el package.json o lo que sea detecte su lenguaje o arquitectura y ya tuvieras como tal preparado todo, luego despues de instalarlo o algo asi, poner simplemente el comando de pnpm scrollfram hero.mp4, y hiciera directamente los frames como te dije, y aparte como tipo el componente ya creado basado en su lenguaje": detection of framework, TypeScript and package manager; frames + install + component in one command. Nothing happens at install time (no postinstall).
- S2: "la idea que sea intuitivo, que no tengan que pensar los usuarios apenas nada."
- S3: "preguntar antes de hacer nada basicametne me parece la mejor idea": the CLI shows the full plan and asks once; `--yes` skips the question.
- S4: Backward compatibility: without an interactive terminal and without `--yes`, the CLI behaves as today (frames only) plus a hint. Existing scripts and CI must not hang or change.
- S5: Scope: Next.js (App/Pages Router), React (Vite), Angular, Vue, plain HTML. Flags `--framework`, `--name`, `--no-install`. Existing files are never overwritten without asking. JSON config may be edited (shown in the plan); code config (`vite.config`) is printed, not edited. No new runtime dependencies.
- S6: "vamos una a una, cuando las vayas acabando pasa a las siguientes directamente".

## Tasks

- [x] T1 (S1, S5) project detection: framework (+ Next router), TypeScript, package manager, public dir, unsupported frameworks named — inline
- [ ] T2 (S3, S4, S5) plan + single confirmation, `--yes`, `--framework`, `--name`, `--no-install`, non-interactive keeps today's behaviour — inline
- [ ] T3 (S1, S3) install the runtime package with the detected package manager — inline
- [ ] T4 (S1, S5) React / Next.js component templates (TS/JS, App/Pages Router) — inline
- [ ] T5 (S1, S5) plain HTML snippet (server-rendered stage + CDN) — inline
- [ ] T6 (S1, S5) Angular component + `angular.json` stylesheet — inline
- [ ] T7 (S1, S5) Vue component + printed `vite.config` instruction — inline
- [ ] T8 (S1) CI e2e of the full flow on sample projects — inline
- [ ] T9 (S2) README + changeset — inline

## Log

- L1 (2026-11-21): "Mi pregunta es, nose podria hacer todo en un comando directo como tal, osea mi idea basicametne era que la gente hicera tipo pnpm install scrollframe, entonces ya directamente cogiera leyera el package.json o lo que sea detecte su lenguaje o arquitectura y ya tuvieras como tal preparado todo, luego despues de instalarlo o algo asi, poner simplemente el comando de pnpm scrollfram hero.mp4, y hiciera directamente los frames como te dije, y aparte como tipo el componente ya creado basado en su lenguaje Nose si es algo descavellado, la idea que sea intuitivo, que no tengan que pensar los usuarios apenas nada."
- L2 (2026-11-21): "Si, preguntar antes de hacer nada basicametne me parece la mejor idea." Decision: no postinstall (npm 12 / pnpm block install scripts; installing must not touch user files); everything happens when the command runs. The unscoped name `scrollframe` stays blocked on npm, the command name `scrollframe` is kept.
- L3 (2026-11-21): Plan accepted: "Si, dale me parece la mejor opcion actualmente la que comentas".
- L4 (2026-11-21): "Si, dale vamos una a una, cuando las vayas acabando pasa a las siguientes directamente,"
- L5: T1 RED: `detectProject` is not a function (18 tests). GREEN: `src/detect.ts` reads package.json (dependencies + devDependencies): Nuxt/Remix/SvelteKit/Svelte/Astro/Solid are named as unsupported before React/Vue are checked; Next (App Router if `app/` or `src/app/`, else Pages), Angular, Vue, React, else `html`; TypeScript from tsconfig.json or a typescript dependency; package manager from the `packageManager` field, then lockfiles; `public/` when present; invalid package.json -> UsageError. Mutation checks (unsupported ignored, React missed, packageManager ignored, src/app missed) each fail 1 test.
- L6: T1 on real projects (built dist): Angular 22 app -> angular/TS/npm; Vite+Vue -> vue/JS; Vite+React e2e fixture -> react; plain HTML folder -> html, no package.json; this repo -> html/TS/pnpm (packageManager field). Next.js is checked with create-next-app in T4.
