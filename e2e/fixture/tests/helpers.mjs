import { expect } from "@playwright/test";

export const FRAME_COUNT = 60;
const FRAME_RE = /\/sequence\/(mobile|tablet|desktop)\/frame-(\d+)\.webp$/;

function parseFrame(url) {
  const match = new URL(url).pathname.match(FRAME_RE);
  return match ? { set: match[1], index: Number(match[2]), url } : null;
}

/**
 * Records the frames the page requests and the ones it received successfully.
 * Attach it before `page.goto`.
 */
export function trackFrames(page) {
  const tracker = { requests: [], loaded: new Set() };
  page.on("request", (request) => {
    const frame = parseFrame(request.url());
    if (frame) tracker.requests.push(frame);
  });
  page.on("response", (response) => {
    const frame = parseFrame(response.url());
    if (frame && response.ok()) tracker.loaded.add(`${frame.set}/${frame.index}`);
  });
  return tracker;
}

/** Waits until every frame of `set` has been downloaded at least once. */
export async function waitForAllFrames(tracker, set) {
  await expect
    .poll(() => [...tracker.loaded].filter((key) => key.startsWith(`${set}/`)).length, { timeout: 30_000 })
    .toBe(FRAME_COUNT);
}

/**
 * Scrolls so the sequence sits at `progress` (0..1) and waits for the engine to report it.
 * `root` is the sequence element: the React `<section>` or the `<scroll-sequence>` element.
 */
export async function scrollToProgress(page, progress, root = "section") {
  await page.evaluate(({ progress, root }) => {
    const section = document.querySelector(root);
    const top = section.getBoundingClientRect().top + window.scrollY;
    const distance = section.offsetHeight - window.innerHeight;
    window.scrollTo(0, Math.round(top + progress * distance));
  }, { progress, root });
  const expected = Math.round(progress * (FRAME_COUNT - 1));
  await expect.poll(() => page.evaluate(() => window.__scrollframe.frame)).toBe(expected);
  return expected;
}

/**
 * Mean absolute difference (0..255) between what the canvas shows and frame `index` of
 * `set` drawn the same way. ~0 means the canvas is showing exactly that frame.
 */
export async function canvasDiff(page, set, index, root = "section") {
  return page.evaluate(
    async ({ set, index, root }) => {
      const canvas = document.querySelector(`${root} canvas`);
      const { width, height } = canvas;
      const image = new Image();
      image.src = `/sequence/${set}/frame-${String(index).padStart(4, "0")}.webp`;
      await image.decode();
      const reference = document.createElement("canvas");
      reference.width = width;
      reference.height = height;
      const refCtx = reference.getContext("2d", { willReadFrequently: true });
      refCtx.drawImage(image, 0, 0, width, height);
      const a = canvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, width, height).data;
      const b = refCtx.getImageData(0, 0, width, height).data;
      let sum = 0;
      for (let i = 0; i < a.length; i += 4) {
        sum += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
      }
      return sum / ((a.length / 4) * 3);
    },
    { set, index, root },
  );
}

/** Waits until the canvas shows exactly frame `index`. */
export async function expectCanvasShows(page, set, index, root = "section") {
  await expect.poll(() => canvasDiff(page, set, index, root), { message: `canvas shows frame ${index}` }).toBeLessThan(1);
}
