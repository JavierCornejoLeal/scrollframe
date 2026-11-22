# @scrollframe/cli

## 0.4.0

### Minor Changes

- af0707e: The CLI no longer decides how to set up a project: it suggests, and you confirm. It used to report success on WordPress, Django, Gatsby, Expo and other projects where the result could not work.

  **Breaking:** `--yes` alone now only generates the frames. To set up without questions pass `--yes --framework <name> -o <folder> --base-url <url>`; `--yes` with only some of them, including just `-o` or `--base-url`, exits 2 and changes nothing.

  - In a terminal you see the framework, the frames folder and its URL, and answer `y`, `e` (correct them) or `n` (frames only, which used to cancel: use Ctrl+C to cancel). Enter is a yes only for a standard project; anything unusual needs an explicit answer.
  - The last line reports what happened, with the poster and frame URLs to open. An incomplete set-up exits 1, also when it leaves a step to you (the Angular stylesheet).
  - A base URL used for a set-up (`--base-url` or typed) is now checked, because it is written into your code. Some values that 0.3.0 accepted exit 2 as `--base-url`, also if you only wanted the frames in a terminal:
    - with spaces (other than around it), commas, quotes, backslashes, backticks, control or invisible characters, or any of `< > { } | ^ ? #` (so no query string);
    - empty, only `/`, or starting with `//` without a host;
    - with a scheme other than lowercase `http:` or `https:`, or a relative path that has a `:` or starts with a dot other than `./` and `../` (write `./.frames`).
  - Plain HTML loads the released version of `@scrollframe/element` from the CDN, also when the CLI version differs.
  - `RunDeps.ask` replaces `RunDeps.confirm`, which still works but is deprecated: it can only confirm a standard suggestion, and otherwise confirms the frames alone.

## 0.3.0

### Minor Changes

- 889b2ea: `npx @scrollframe/cli hero.mp4` now sets up your project: in a terminal it detects Next.js, React, Angular, Vue or plain HTML, shows a plan and, after one confirmation, installs the matching scrollframe package with your package manager and writes a ready-to-use component (or a plain HTML snippet with the poster already rendered). It fixes `overflow-x: hidden` on `html`/`body` (as in the Next.js 16 starter), which stops the sequence from staying pinned. New flags: `--yes`, `--framework`, `--name`, `--no-install`. Without a terminal and without `--yes` it only generates the frames, as before.

  `@scrollframe/core` warns in the console when an ancestor's overflow stops the sequence from staying pinned, and exports `findStickyBlocker`.

### Patch Changes

- Updated dependencies [889b2ea]
  - @scrollframe/core@0.3.0

## 0.2.0

### Patch Changes

- Updated dependencies [6ca8263]
  - @scrollframe/core@0.2.0

## 0.1.1

### Patch Changes

- d97500a: Fix the npm release: `@scrollframe/react@0.1.0` shipped a `workspace:^` dependency and could not be installed, so 0.1.1 publishes it with a real `@scrollframe/core` range. The CLI is now published as `@scrollframe/cli` (npm rejects the unscoped `scrollframe` name as too similar to an existing package); the command is still `scrollframe`, run it with `npx @scrollframe/cli <video>`. Publishing with plain `npm publish` is now refused.
- Updated dependencies [d97500a]
  - @scrollframe/core@0.1.1

## 0.1.0

### Minor Changes

- 1261515: Initial release: `scrollframe` CLI (video to responsive WebP frames + manifest), `@scrollframe/core` canvas engine and `@scrollframe/react` `<ScrollSequence>` component.

### Patch Changes

- 7bbf7ed: Explain a missing bundled ffmpeg: when npm blocked ffmpeg-static's install script (npm 12+ default), the CLI now says so and prints the exact fixes (`npx --allow-scripts=ffmpeg-static scrollframe <video>`, or `npm install-scripts approve ffmpeg-static && npm rebuild ffmpeg-static`).
- Updated dependencies [1261515]
  - @scrollframe/core@0.1.0
