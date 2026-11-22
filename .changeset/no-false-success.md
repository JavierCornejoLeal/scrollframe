---
"@scrollframe/cli": minor
---

The CLI no longer decides how to set up a project: it suggests, and you confirm. It used to report success on WordPress, Django, Gatsby, Expo and other projects where the result could not work.

**Breaking:** `--yes` alone now only generates the frames. To set up without questions pass `--yes --framework <name> -o <folder> --base-url <url>`; `--yes` with only some of them, including just `-o` or `--base-url`, exits 2 and changes nothing.

- In a terminal you see the framework, the frames folder and its URL, and answer `y`, `e` (correct them) or `n` (frames only, which used to cancel: use Ctrl+C to cancel). Enter is a yes only for a standard project; anything unusual needs an explicit answer.
- The last line reports what happened, with the poster and frame URLs to open. An incomplete set-up exits 1, also when it leaves a step to you (the Angular stylesheet).
- A base URL used for a set-up (`--base-url` or typed) is now checked, because it is written into your code. Some values that 0.3.0 accepted exit 2 as `--base-url`, also if you only wanted the frames in a terminal:
  - with spaces (other than around it), commas, quotes, backslashes, backticks, control or invisible characters, or any of `< > { } | ^ ? #` (so no query string);
  - empty, only `/`, or starting with `//` without a host;
  - with a scheme other than lowercase `http:` or `https:`, or a relative path that has a `:` or starts with a dot other than `./` and `../` (write `./.frames`).
- Plain HTML loads the released version of `@scrollframe/element` from the CDN, also when the CLI version differs.
- `RunDeps.ask` replaces `RunDeps.confirm`, which still works but is deprecated: it can only confirm a standard suggestion, and otherwise confirms the frames alone.
