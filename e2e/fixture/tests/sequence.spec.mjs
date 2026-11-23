import { expect, test } from "@playwright/test";
import { FRAME_COUNT, expectCanvasShows, scrollToProgress, trackFrames, waitForAllFrames } from "./helpers.mjs";

test.describe("hero sequence", () => {
  test("the poster is a real, sized, high-priority <img> with alt text", async ({ page }) => {
    await page.goto("/");
    const poster = page.locator("section picture img");
    await expect(poster).toHaveAttribute("alt", "Synthetic test pattern with a running frame counter");
    await expect(poster).toHaveAttribute("width", "960");
    await expect(poster).toHaveAttribute("height", "540");
    await expect(poster).toHaveAttribute("fetchpriority", "high");
    await expect(poster).toHaveAttribute("loading", "eager");
    await expect.poll(() => poster.evaluate((img) => img.complete && img.naturalWidth)).toBe(960);
    await expect(page.locator("section canvas")).toHaveAttribute("aria-hidden", "true");
    await expect(page.getByRole("heading", { name: "scrollframe end-to-end" })).toBeVisible();
  });

  test("the canvas shows the frame that matches the scroll position", async ({ page }) => {
    const frames = trackFrames(page);
    await page.goto("/");
    await waitForAllFrames(frames, "desktop");

    const seen = [];
    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      const index = await scrollToProgress(page, progress);
      await expectCanvasShows(page, "desktop", index);
      seen.push(index);
    }
    expect(seen).toEqual([0, 15, 30, 44, 59]);

    // Scrolling back up scrubs backwards.
    await expectCanvasShows(page, "desktop", await scrollToProgress(page, 0.1));
  });

  test("exposes progress to CSS as --sf-progress", async ({ page }) => {
    const frames = trackFrames(page);
    await page.goto("/");
    await waitForAllFrames(frames, "desktop");
    await scrollToProgress(page, 0.5);
    const value = await page.locator("section").evaluate((el) => Number(el.style.getPropertyValue("--sf-progress")));
    expect(value).toBeCloseTo(0.5, 1);
  });

  test("each frame is downloaded once and only from the set for this viewport", async ({ page }) => {
    const frames = trackFrames(page);
    await page.goto("/");
    await waitForAllFrames(frames, "desktop");
    expect(new Set(frames.requests.map((r) => r.set))).toEqual(new Set(["desktop"]));
    expect(frames.requests).toHaveLength(FRAME_COUNT);
  });

  test("loads coarse-to-fine: every 16th frame and the last one come first", async ({ page }) => {
    const frames = trackFrames(page);
    await page.goto("/");
    await waitForAllFrames(frames, "desktop");
    expect(frames.requests.slice(0, 5).map((r) => r.index)).toEqual([0, 16, 32, 48, 59]);
  });
});

for (const { set, width } of [
  { set: "mobile", width: 390 },
  { set: "tablet", width: 1000 },
]) {
  test(`a ${width}px viewport uses only the ${set} frames`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 800 } });
    const page = await context.newPage();
    const frames = trackFrames(page);
    await page.goto("/");
    await waitForAllFrames(frames, set);
    expect(new Set(frames.requests.map((r) => r.set))).toEqual(new Set([set]));
    await expectCanvasShows(page, set, await scrollToProgress(page, 0.5));
    await context.close();
  });
}

for (const [parent, css] of [
  ["a centred column, as the Vite starter has", "width:700px;margin:0 auto;display:flex;flex-direction:column;border-inline:1px solid"],
  ["an off-centre column", "width:600px;margin-left:120px;padding:0 24px"],
  ["a column that centres its children", "width:700px;margin:0 auto;display:flex;flex-direction:column;align-items:center"],
]) {
  test(`spans the page inside ${parent}, with no sideways scroll`, async ({ page }) => {
    await page.route("**/", async (route) => {
      const response = await route.fetch();
      await route.fulfill({ response, body: (await response.text()).replace("</head>", `<style>main{${css}}</style></head>`) });
    });
    await page.goto("/");
    const box = () =>
      page.evaluate(() => {
        const root = document.documentElement;
        const { left, width } = document.querySelector("section").getBoundingClientRect();
        return { left: Math.round(left), gap: Math.round(width - root.clientWidth), sideways: root.scrollWidth - root.clientWidth };
      });
    await expect.poll(box).toEqual({ left: 0, gap: 0, sideways: 0 });
  });
}

test("a sequence below the fold downloads nothing until the reader gets close", async ({ page }) => {
  const frames = trackFrames(page);
  await page.goto("/?below");
  await expect(page.locator("section picture img")).toHaveAttribute("loading", "lazy");
  await page.waitForTimeout(1500);
  expect(frames.requests).toEqual([]);

  await page.evaluate(() => window.scrollTo(0, window.innerHeight * 2.2));
  await waitForAllFrames(frames, "desktop");
});

test("frames that fail are retried and end up on screen", async ({ page }) => {
  let attempts = 0;
  await page.route("**/sequence/desktop/frame-0010.webp", (route) => {
    attempts++;
    return attempts === 1 ? route.abort("failed") : route.continue();
  });
  const frames = trackFrames(page);
  await page.goto("/");
  await waitForAllFrames(frames, "desktop");
  expect(attempts).toBe(2);
  await expectCanvasShows(page, "desktop", await scrollToProgress(page, 10 / (FRAME_COUNT - 1)));
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("keeps the poster and downloads no frames", async ({ page }) => {
    const frames = trackFrames(page);
    await page.goto("/");
    const poster = page.locator("section picture img");
    await expect.poll(() => poster.evaluate((img) => img.complete && img.naturalWidth)).toBe(960);
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 2));
    await page.waitForTimeout(1500);
    expect(frames.requests).toEqual([]);
    expect(await page.evaluate(() => window.__scrollframe.frame)).toBeNull();
  });
});

test.describe("Core Web Vitals (Chromium APIs)", () => {
  test.skip(({ browserName }) => browserName !== "chromium", "LCP and layout-shift entries are Chromium-only");

  // Chromium ignores images that cover the whole viewport as LCP candidates (it treats them
  // as backgrounds), so a full-bleed poster is never the LCP: the overlay text is. What must
  // hold is that the sequence never becomes, or delays, the LCP.
  test("the sequence never becomes or delays the LCP", async ({ page }) => {
    await page.goto("/");
    await page.waitForTimeout(1000);
    const lcp = await page.evaluate(
      () =>
        new Promise((resolve) => {
          new PerformanceObserver((list) => {
            const entries = list.getEntries();
            const last = entries[entries.length - 1];
            resolve({ tag: last.element?.tagName, url: last.url, time: last.startTime });
          }).observe({ type: "largest-contentful-paint", buffered: true });
        }),
    );
    expect(["IMG", "H1"]).toContain(lcp.tag);
    expect(lcp.url).not.toMatch(/frame-\d+\.webp/);
    if (lcp.tag === "IMG") expect(lcp.url).toMatch(/\/sequence\/desktop\/poster\.webp$/);
    expect(lcp.time).toBeLessThan(2500);
  });

  test("a poster smaller than the viewport is the LCP element", async ({ page }) => {
    await page.route("**/", async (route) => {
      const response = await route.fetch();
      const html = (await response.text()).replace(
        "</head>",
        "<style>section picture img { height: 90% !important }</style></head>",
      );
      await route.fulfill({ response, body: html });
    });
    await page.goto("/");
    // The heading paints first; the poster only becomes the LCP once it has loaded, so the
    // latest candidate is polled instead of reading the first observer callback.
    const latestLcp = () =>
      page.evaluate(
        () =>
          new Promise((resolve) => {
            new PerformanceObserver((list) => {
              const entries = list.getEntries();
              const last = entries[entries.length - 1];
              resolve({ tag: last.element?.tagName, url: last.url });
            }).observe({ type: "largest-contentful-paint", buffered: true });
          }),
      );
    await expect.poll(async () => (await latestLcp()).tag).toBe("IMG");
    const lcp = await latestLcp();
    expect(lcp.url).toMatch(/\/sequence\/desktop\/poster\.webp$/);
  });

  test("no layout shift while frames load and the user scrolls", async ({ page }) => {
    const frames = trackFrames(page);
    await page.goto("/");
    await waitForAllFrames(frames, "desktop");
    for (const progress of [0.3, 0.6, 1]) await scrollToProgress(page, progress);
    const cls = await page.evaluate(
      () =>
        new Promise((resolve) => {
          new PerformanceObserver((list) => {
            resolve(list.getEntries().reduce((sum, e) => (e.hadRecentInput ? sum : sum + e.value), 0));
          }).observe({ type: "layout-shift", buffered: true });
          // No entries at all means no shift: the observer never fires.
          setTimeout(() => resolve(0), 500);
        }),
    );
    expect(cls).toBeLessThan(0.01);
  });
});
