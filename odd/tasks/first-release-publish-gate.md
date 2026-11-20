# First release: publish gate

Branch: `fix/release-ci-gate` · Baseline: `4071adc` · Delivery: first independent PR to `main` (<100 authored lines) · Runner: local workflow-structure check and Vitest; GitHub Actions for integration.

## Specs

- **S1.** Gate npm publication in the first slice: “exigí CI verde para el SHA que se publica”. Retain the version-PR and environment gates and the existing standalone CI checks. No npm publication or credential change in this slice.
- **S2.** Deliver “PRs commits pequenos” and “poco a poco”: keep the CI gate in one focused work unit. Manifest limits, CLI hardening, and the storytelling demo follow separately.

## Tasks

- [x] T1 · S1–S2 · inline + independent verifier · local checks passed · Risk: item 5 (release workflow). Native review and remote delivery tracked below.

## Log

- L1: “Vale, metele canña, parte por parte ves subiendo PRs commits pequenos ves poco a poco haciendo cada parte y demas”
- Local implementation authorized; remote authentication is not yet specified. Preserve the pre-existing `.gitignore` modification.
- CI now supports a read-only call from the release workflow at the same commit; native PR and main push CI retain their jobs. A release candidate runs a second CI suite to avoid polling a parallel run.
- RED: existing YAML had no reusable CI dependency on publish. GREEN: local YAML assertions passed; Vitest 77/77; independent baseline comparison and aggregate failure/skip/cancel probes passed. Hosted Actions remains unverified.
- Rollback boundary: the reusable CI trigger/concurrency key and the `verify-release` dependency in the two workflow files. The npm environment and credentials are unchanged.
