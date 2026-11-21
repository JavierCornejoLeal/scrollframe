# scrollframe

Turn a video into a scroll-driven storytelling section with one command, without sacrificing Core Web Vitals, accessibility or SEO.

```bash
npx @scrollframe/cli hero.mp4
```

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

## CLI options

Run it once with `npx @scrollframe/cli <video>`, or install it (`npm i -D @scrollframe/cli`) and call the `scrollframe` command from your scripts.

```
scrollframe <video> [options]

  -o, --out <dir>         Output folder (default: public/sequence)
  -b, --base-url <url>    Public URL of the output folder (default: derived from --out)
  -f, --frames <n>        Frames to extract, 2-600, capped at the video's own (default: 120)
  -q, --quality <0-100>   WebP quality (default: 80)
  -w, --widths <m,t,d>    Mobile, tablet and desktop widths (default: 720,1280,1920)
      --lossless          Lossless WebP (much heavier, hurts LCP; not recommended)
      --ffmpeg <path>     ffmpeg binary (default: FFMPEG_PATH, bundled ffmpeg-static, then PATH)
      --force             Overwrite an existing sequence in the output folder
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
