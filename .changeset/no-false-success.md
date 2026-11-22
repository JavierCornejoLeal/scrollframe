---
"@scrollframe/cli": minor
---

The CLI no longer decides how to set up a project: it suggests, and you confirm. It used to report success on WordPress, Django, Gatsby, Expo and other projects where the result could not work.

**Breaking:** `--yes` alone now only generates the frames. To set up without questions pass `--yes --framework <name> -o <folder> --base-url <url>`.

- In a terminal you see the framework, the frames folder and its URL, and answer `y`, `e` (correct them) or `n` (frames only, which used to cancel: use Ctrl+C to cancel). Enter is a yes only for a standard project; anything unusual needs an explicit answer.
- The last line reports what happened, with the poster and frame URLs to open. An incomplete set-up exits 1.
- Plain HTML loads the released version of `@scrollframe/element` from the CDN, also when the CLI version differs.
- `RunDeps.ask` replaces `RunDeps.confirm`, which still works but is deprecated: it can only confirm a standard suggestion, and otherwise confirms the frames alone.
