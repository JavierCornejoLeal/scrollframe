---
"@scrollframe/cli": patch
"@scrollframe/core": patch
"@scrollframe/react": patch
---

Fix the npm release: `@scrollframe/react@0.1.0` shipped a `workspace:^` dependency and could not be installed, so 0.1.1 publishes it with a real `@scrollframe/core` range. The CLI is now published as `@scrollframe/cli` (npm rejects the unscoped `scrollframe` name as too similar to an existing package); the command is still `scrollframe`, run it with `npx @scrollframe/cli <video>`. Publishing with plain `npm publish` is now refused.
