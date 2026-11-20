# release-and-tests

Objective: fix the failures seen while shipping the first PRs, add the missing tests, and get an independent Codex review before opening the PR.
Branch: `fix/release-and-tests` · Delivery: `ask-on-risk` · Test runner: vitest.

## Specs

- S1: "consigamos revisar los fallos que ha estado dando": the Release workflow must never publish `0.0.0`; the first release goes through a reviewable "Version Packages" PR.
- S2: "haz mas test": cover the untested runtime code: the `ScrollSequence` engine (DOM), the CLI process behaviour (exit codes, output), and the React component lifecycle.
- S3: "revisa lo que haces con codex antes de lanzarlo": independent Codex review of the branch before the PR is opened; confirmed findings fixed.

## Tasks

- [x] T1 (S1) Initial changeset + npm provenance in the release workflow — inline
- [x] T2 (S2) Engine tests in jsdom, plus any defect they expose — inline
- [x] T3 (S2) Extract `runCli` and test exit codes/output — inline
- [x] T4 (S2) React lifecycle tests — inline
- [x] T5 (S3) Codex review — delegated to Codex CLI (user asked for Codex)
- [x] T6 (S3) Engine retries failed frames (Codex M3) — inline
- [x] T7 (S3) CLI `--force` stages output and swaps atomically; round frame cap (Codex M4, m1) — inline
- [x] T8 (S1, S3) Release: approval-gated environment, SHA-pinned actions, Dependabot (Codex M1, M2) — inline

## Log

- L1 (2026-11-20): "porfavor, consigamos revisar los fallos que ha estado dando, haz mas test, revisa lo que haces con codex antes de lanzarlo"
- L2: Failures observed: (a) Release ran `changeset publish` with no pending changesets and tried to publish `scrollframe@0.0.0`, `@scrollframe/core@0.0.0`, `@scrollframe/react@0.0.0` (blocked only by the missing `NPM_TOKEN`); (b) Release failed on intermediate `main` states because `linked` packages did not exist yet (transient, gone); (c) CI did not trigger until workflows existed on `main` (GitHub behaviour); (d) PR #4 was closed when its base branch was deleted (chain process, recovered).
- L3: Codex review verdicts: M1 release publishes any version bump on main (confirmed, comment was misleading); M2 mutable action tags with publish credentials (confirmed); M3 engine never retries failed frames (confirmed); M4 `--force` deletes old sequence before success (confirmed); m1 `floor(4.00*29.97)=119` undercounts (confirmed, introduced in this branch); m2 canvas lacks object-fit (false positive: canvas spreads `fill` with `objectFit: "cover"`).
- L4: Fixes: T6 bounded retry (1s/2s/4s) + `online` retry, only missing frames re-requested; T7 output generated in `.scrollframe-new-*` staging inside `--out` and swapped in with rollback, frame cap rounded; T8 release split into `version` (never publishes) and `publish` (only on the version-PR merge commit, `environment: npm`), all actions SHA-pinned, Dependabot for actions. 72 tests green.
- L5: Open, owner decisions: enable "Allow GitHub Actions to create and approve pull requests" (needed by the `version` job); add required reviewers to the `npm` environment; create the npm org and `NPM_TOKEN`.
