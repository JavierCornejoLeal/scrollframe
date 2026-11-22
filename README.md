# scrollframe

Turn a video into a scroll-driven storytelling section with one command, without sacrificing Core Web Vitals, accessibility or SEO.

```bash
npx @scrollframe/cli hero.mp4
```

It turns the video into optimized frames, suggests how to set up your project and lets you confirm or correct it, then installs the right package and writes the component:

```
Project: Next.js (App Router) · TypeScript · pnpm
  Frames in:  public/sequence/
  Served at:  /sequence

Plan:
 1. Generate 120 frames in public/sequence/
 2. Install @scrollframe/react  (pnpm add @scrollframe/react)
 3. Create components/HeroSequence.tsx

Continue? (Y = yes / e = edit / n = frames only)
```

The component it writes for React looks like this:

```tsx
import { ScrollSequence } from "@scrollframe/react";
import manifest from "../public/sequence/manifest.json";

export default function Home() {
  return (
    <ScrollSequence manifest={manifest} alt="Barista pouring latte art in our Madrid coffee shop">
      <h1>Specialty coffee, roasted in Madrid</h1>
    </ScrollSequence>
  );
}
```

## Packages

| Package | Description |
| --- | --- |
| [`@scrollframe/cli`](packages/cli) | CLI (`scrollframe` command): video → optimized WebP frames for mobile, tablet and desktop + `manifest.json` |
| [`@scrollframe/core`](packages/core) | Framework-agnostic canvas engine |
| [`@scrollframe/react`](packages/react) | `<ScrollSequence>` component for React and Next.js |
| [`@scrollframe/element`](packages/element) | `<scroll-sequence>` custom element for any framework (Angular, Vue, Svelte, Astro) or plain HTML |

## How it stays fast

- **The poster is the LCP.** The first frame is server-rendered as a real `<img>` with fixed `width`/`height` (no CLS) and `fetchpriority="high"`.
- **Frames load late.** Nothing is fetched until the section is about one viewport away, and only the set that matches the viewport (mobile, tablet or desktop).
- **Coarse-to-fine loading.** Every 16th frame is loaded first, then the gaps are filled in, so scrubbing works before everything is downloaded.
- **Recovers from flaky networks.** Frames that fail are retried after 1s, 2s and 4s, and again when the browser comes back online; only missing frames are re-requested.
- **No layout work while scrolling.** Frames are painted on a `<canvas>` inside `requestAnimationFrame`; scroll listeners are passive.
- **Respects the user.** With `prefers-reduced-motion` or Save-Data, only the poster is shown.

## SEO and accessibility

Frames are decorative: the canvas is `aria-hidden` and frames have no alt text. Putting alt text or metadata on hundreds of frames would read as keyword stuffing to search engines and as noise to screen readers. Search engines index instead:

- the poster, with the `alt` you provide,
- the overlay `children`, which are real, semantic HTML.

## Overlays

Anything you pass as `children` is rendered on top of the sequence. The current progress (0 to 1) is exposed as the CSS variable `--sf-progress` on the section, so overlays can animate without React re-renders:

```css
.headline {
  opacity: clamp(0, calc(1 - var(--sf-progress) * 4), 1);
}
```

Use `onProgress={(progress, frame) => ...}` when you need it in JavaScript.

## What the CLI does in your project

Run it once with `npx @scrollframe/cli <video>` (or `pnpm dlx`), or install it (`npm i -D @scrollframe/cli`) and call the `scrollframe` command from your scripts. Nothing happens at install time: everything happens when the command runs, after you confirm.

Detection only suggests. The CLI cannot know for sure how your project serves files, so you confirm the framework, the frames folder and its URL:

| Template | Suggested for | Package installed | File written |
| --- | --- | --- | --- |
| Next.js (App or Pages Router) | projects with `next` | `@scrollframe/react` | `components/HeroSequence.tsx` (or `src/components/`, `.jsx` without TypeScript) |
| React | Vite with React and a root `index.html` | `@scrollframe/react` | `src/components/HeroSequence.tsx` |
| Angular | projects with `@angular/core` | `@scrollframe/element` | `src/app/hero-sequence/hero-sequence.ts`, and the stylesheet added to `angular.json` |
| Vue | Vite with Vue and a root `index.html` | `@scrollframe/element` | `src/components/HeroSequence.vue`; the `vite.config` line to add is printed |
| Plain HTML | a folder with an `index.html` page and no `package.json` | none (CDN) | `hero-sequence.html`: CDN lines and the block with the poster already rendered |

- **Standard project:** press Enter.
- **Anything unusual** (a base path, other plugins, server code, a subfolder): it says what to check and Enter is not enough. Answer `y`, or `e` to correct the framework, folder and URL. When the doubt is about where files are served, it suggests no URL: you type it.
- **Any other project** (WordPress, PHP, other backends and meta-frameworks have no template of their own yet): it asks which template to use, or generates only the frames.

The component is named after the video (`hero.mp4` → `HeroSequence`), and the CLI prints the exact import for your main page. It does not check that the frames are served: it ends with the poster and frame URLs for you to open.

Without questions (CI, scripts), `--yes` only generates the frames. To set up, give it the three values (only some of them, also just `-o` or `--base-url`, is an error and changes nothing):

```bash
npx @scrollframe/cli hero.mp4 --yes --framework react -o public/sequence --base-url /sequence
```

It is careful with your project:

- It shows the whole plan before changing anything. `n` keeps only the frames; Ctrl+C or Ctrl+D change nothing.
- It never overwrites an existing file, and only edits a file if it still matches what the plan showed.
- The package is installed with your package manager (pnpm, npm, yarn or bun, from the lockfile); `--no-install` skips it.
- Without a terminal and without `--yes`, it only generates the frames and prints a hint.
- **`overflow-x: hidden` on `html`/`body`** (the Next.js 16 starter stylesheet has it) stops the sequence from staying pinned while scrolling. The plan offers to change it to `overflow-x: clip`, which hides the overflow the same way. In the browser, the engine also warns in the console when an ancestor's overflow breaks pinning.

## CLI options

```
scrollframe <video> [options]

  -o, --out <dir>         Output folder (default: public/sequence)
  -b, --base-url <url>    Public URL of the output folder (default: derived from --out)
  -f, --frames <n>        Frames to extract, 2-600, capped at the video's own (default: 120)
  -q, --quality <0-100>   WebP quality (default: 80)
  -w, --widths <m,t,d>    Mobile, tablet and desktop widths (default: 720,1280,1920)
      --lossless          Lossless WebP (much heavier, hurts LCP; not recommended)
      --ffmpeg <path>     ffmpeg binary (default: FFMPEG_PATH, bundled ffmpeg-static, then PATH)
      --force             Overwrite a non-empty output folder
  -y, --yes               Do not ask: only frames, or set up with --framework, -o and --base-url
      --framework <name>  next, react, angular, vue or html (instead of the suggestion)
      --name <Name>       Component name (default: from the video, e.g. HeroSequence)
      --no-install        Do not install the scrollframe package
```

Breakpoints: mobile ≤ 767px, tablet ≤ 1279px, desktop above. Frames are never upscaled beyond the source video.

### ffmpeg

scrollframe bundles ffmpeg through [`ffmpeg-static`](https://github.com/eugeneware/ffmpeg-static), which downloads the binary in its install script. npm 12 and later block dependency install scripts by default, so the binary is missing and the CLI stops with the fix. Allow that one script:

```bash
# One-off run
npx --allow-scripts=ffmpeg-static @scrollframe/cli hero.mp4

# Installed in a project
npm install-scripts approve ffmpeg-static && npm rebuild ffmpeg-static
```

Or install ffmpeg on your system, or pass `--ffmpeg <path>` / set `FFMPEG_PATH`.

## Component props

| Prop | Default | Description |
| --- | --- | --- |
| `manifest` | required | Contents of the generated `manifest.json` |
| `alt` | required | Poster alt text: describe the scene |
| `scrollLength` | `"300vh"` | Scroll distance; longer is slower |
| `priority` | `true` | Eager, high-priority poster. Set `false` below the fold |
| `baseUrl` | manifest | Serve frames from a CDN |
| `onProgress` | — | `(progress, frameIndex) => void` |
| `className`, `style`, `overlayClassName` | — | Styling hooks |

## Any framework or plain HTML: `<scroll-sequence>`

`@scrollframe/element` is a standard custom element, so it can be used wherever you control the HTML. It is tested in Angular, Vue and static HTML; in other frameworks and server-rendered sites, make sure `src` points at the URL where your site serves `manifest.json`. It renders in the light DOM: overlay children stay real, indexable HTML, styled by your own CSS. Children are never moved, so framework-managed content keeps working.

### Plain HTML (no build step)

```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@scrollframe/element@0.2/dist/scroll-sequence.css" />
<script src="https://cdn.jsdelivr.net/npm/@scrollframe/element@0.2" defer></script>

<scroll-sequence src="/sequence/manifest.json" alt="Barista pouring latte art" scroll-length="400vh">
  <h1>Specialty coffee, roasted in Madrid</h1>
</scroll-sequence>
```

Load the stylesheet in `<head>`: it lays out the poster and the overlay before the script runs.

### Server-rendered poster (best LCP)

With only `src`, the poster appears once the manifest has been fetched. Render the stage on the server and the poster is painted with the HTML; the element adopts it instead of rendering its own:

```js
import { readFile } from "node:fs/promises";
import { parseManifest, renderStageMarkup } from "@scrollframe/core";

const alt = "Barista pouring latte art";
const manifest = parseManifest(JSON.parse(await readFile("public/sequence/manifest.json", "utf8")));
const html = `<scroll-sequence src="/sequence/manifest.json" alt="${alt}">
  ${renderStageMarkup(manifest, { alt })}
  <h1>Specialty coffee, roasted in Madrid</h1>
</scroll-sequence>`;
```

### With a bundler

```js
import "@scrollframe/element"; // registers <scroll-sequence>
import "@scrollframe/element/style.css";
```

The `manifest` property takes the imported JSON instead of fetching `src`.

**Angular** (standalone component; files in `public/` are served from the site root):

```ts
import { CUSTOM_ELEMENTS_SCHEMA, Component } from "@angular/core";
import "@scrollframe/element";

@Component({
  selector: "app-hero",
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <scroll-sequence src="/sequence/manifest.json" alt="Barista pouring latte art" (sf-progress)="onProgress($event)">
      <h1>Specialty coffee, roasted in Madrid</h1>
    </scroll-sequence>
  `,
})
export class HeroComponent {
  onProgress(event: Event) {
    const { progress, frame } = (event as CustomEvent<{ progress: number; frame: number }>).detail;
  }
}
```

Add `@scrollframe/element/style.css` to the `styles` array in `angular.json`. To pass the JSON instead of fetching `src`, import it with a path relative to the component (for `src/app/hero/hero.ts`: `import manifest from "../../../public/sequence/manifest.json"`) and bind `[manifest]="manifest"`.

**Vue** (tell the compiler the tag is a custom element):

```js
// vite.config.js
vue({ template: { compilerOptions: { isCustomElement: (tag) => tag === "scroll-sequence" } } });
```

```vue
<script setup>
import "@scrollframe/element";
import "@scrollframe/element/style.css";
import manifest from "../public/sequence/manifest.json";
</script>

<template>
  <scroll-sequence :manifest.prop="manifest" alt="Barista pouring latte art" @sf-progress="(e) => console.log(e.detail)">
    <h1>Specialty coffee, roasted in Madrid</h1>
  </scroll-sequence>
</template>
```

### Attributes, property and events

| Name | Description |
| --- | --- |
| `src` | URL of `manifest.json`. Ignored when the `manifest` property is set. |
| `manifest` (property) | The manifest object, e.g. an imported `manifest.json`. |
| `alt` | Describes the scene: the poster's alt text, the image search engines index. |
| `scroll-length` | Scroll distance of the section (default `300vh`). Longer = slower playback. |
| `base-url` | Overrides the manifest `baseUrl` (e.g. a CDN). |
| `priority="false"` | For a sequence below the fold: the poster loads lazily. |
| `sf-progress` event | `detail: { progress, frame }` while scrolling. `--sf-progress` is also set for CSS. |
| `sf-ready` event | The first frame is painted on the canvas. |
| `sf-error` event | `detail: { error }`: the manifest could not be loaded or is invalid. |

## Development

```bash
pnpm install
pnpm test        # vitest, including an end-to-end run with real ffmpeg
pnpm typecheck
pnpm build
pnpm e2e         # packs the tarballs, installs them in a throwaway app and runs the CLI + Playwright (Chromium) suites
```

`pnpm e2e` builds the consumer project in your temp folder (`--work <dir>` to change it) and prints where the Playwright report and the recorded scroll video are.

### CI

Every pull request and push to `main` runs:

| Job | What it proves |
| --- | --- |
| `unit` | Unit tests, typecheck and build on Node 22/24 (Linux) and Node 22 (macOS, Windows) |
| `package` | The packed tarballs pass `publint` and `arethetypeswrong` |
| `cli e2e` | The tarballs install with plain npm on Linux (Node 20/22/24), macOS and Windows, and the CLI turns a synthetic ffmpeg video into a valid sequence |
| `cli e2e (npm 12, …)` | With install scripts blocked and no ffmpeg on PATH, the CLI explains the missing binary, and both documented fixes work |
| `browser e2e` | A React app built from the tarballs scrubs the right frame for each scroll position in Chromium, Firefox and WebKit, loads only the set for the viewport, loads late, retries failed frames, respects reduced motion and causes no layout shift |
| `CI passed` | Green only when all of the above are; it is the required check on `main` |

The `scroll-demo-video` artifact of each run is a recording of the scroll through the test sequence.

Releases use [Changesets](https://github.com/changesets/changesets): run `pnpm changeset` and merge to `main`. The release workflow opens a "chore: version packages" PR; merging it starts the publish job, which waits for the owner's approval on the protected `npm` environment before publishing to npm (requires the `NPM_TOKEN` secret).

## License

MIT
