# release-and-tests

Objective: fix the failures seen while shipping the first PRs, add the missing tests, and get an independent Codex review before opening the PR.
Branch: `fix/release-and-tests` · Delivery: `ask-on-risk` · Test runner: vitest.

## Specs

- S1: "consigamos revisar los fallos que ha estado dando": the Release workflow must never publish `0.0.0`; the first release goes through a reviewable "Version Packages" PR.
- S2: "haz mas test": cover the untested runtime code: the `ScrollSequence` engine (DOM), the CLI process behaviour (exit codes, output), and the React component lifecycle.
- S3: "revisa lo que haces con codex antes de lanzarlo": independent Codex review of the branch before the PR is opened; confirmed findings fixed.

## Tasks

- [ ] T1 (S1) Initial changeset + npm provenance in the release workflow — inline
- [ ] T2 (S2) Engine tests in jsdom, plus any defect they expose — inline
- [ ] T3 (S2) Extract `runCli` and test exit codes/output — inline
- [ ] T4 (S2) React lifecycle tests — inline
- [ ] T5 (S3) Codex review and fixes — delegated (user asked for Codex)

## Log

- L1 (2026-11-20): "porfavor, consigamos revisar los fallos que ha estado dando, haz mas test, revisa lo que haces con codex antes de lanzarlo"
- L2: Failures observed: (a) Release ran `changeset publish` with no pending changesets and tried to publish `scrollframe@0.0.0`, `@scrollframe/core@0.0.0`, `@scrollframe/react@0.0.0` (blocked only by the missing `NPM_TOKEN`); (b) Release failed on intermediate `main` states because `linked` packages did not exist yet (transient, gone); (c) CI did not trigger until workflows existed on `main` (GitHub behaviour); (d) PR #4 was closed when its base branch was deleted (chain process, recovered).
