// The <scroll-sequence> custom element on a plain HTML page (public/plain.html, written by
// plain.mjs): CDN bundle in a classic deferred <script>, static stylesheet, server-rendered poster.
import { expect, test } from "@playwright/test";
import { FRAME_COUNT, expectCanvasShows, scrollToProgress, trackFrames, waitForAllFrames } from "./helpers.mjs";

const ROOT = "scroll-sequence";
const ALT = "Synthetic test pattern with a running frame counter";

/** Holds the element's script until `release()`, to observe the page before any script runs. */
async function holdScript(page) {
  let release;
  const released = new Promise((resolve) => (release = resolve));
  await page.route("**/vendor/index.global.js", async (route) => {
    await released;
    await route.continue();
  });
  return release;
}

test.describe("plain HTML page with <scroll-sequence>", () => {
  test("before its script runs, the poster is painted and the overlay sits on it", async ({ page }) => {
    const release = await holdScript(page);
    // Not "domcontentloaded": deferred scripts run before it, so it would wait for the held script.
    await page.goto("/plain.html", { waitUntil: "commit" });
    await page.locator("scroll-sequence picture img").waitFor({ state: "attached" });

    const poster = page.locator(`${ROOT} picture img`);
    await expect.poll(() => poster.evaluate((img) => img.complete && img.naturalWidth)).toBe(960);
    await expect(poster).toHaveAttribute("alt", ALT);
    await expect(poster).toHaveAttribute("fetchpriority", "high");
    expect(await page.evaluate(() => customElements.get("scroll-sequence"))).toBeUndefined();

    const heading = page.getByRole("heading", { name: "scrollframe plain HTML" });
    const onTop = await heading.evaluate((h1) => {
      const r = h1.getBoundingClientRect();
      const img = h1.parentElement.querySelector("img").getBoundingClientRect();
      return r.top >= img.top && r.bottom <= img.bottom && document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === h1;
    });
    expect(onTop).toBe(true);
    release();
  });

  test("after the script runs it keeps the server poster and requests the manifest and poster once", async ({ page }) => {
    const requests = { manifest: 0, poster: 0 };
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (path === "/sequence/manifest.json") requests.manifest++;
      if (path.endsWith("/poster.webp")) requests.poster++;
    });
    const release = await holdScript(page);
    // Not "domcontentloaded": deferred scripts run before it, so it would wait for the held script.
    await page.goto("/plain.html", { waitUntil: "commit" });
    await page.locator("scroll-sequence picture img").waitFor({ state: "attached" });
    await page.evaluate(() => (window.__serverPoster = document.querySelector("scroll-sequence img")));
    const ready = page.evaluate(() => new Promise((resolve) => addEventListener("sf-ready", resolve, { once: true })));
    release();
    await ready;

    expect(await page.evaluate(() => document.querySelector("scroll-sequence img") === window.__serverPoster)).toBe(true);
    await expect(page.locator(`${ROOT} > [data-sf-stage]`)).toHaveCount(1);
    await expect(page.locator(`${ROOT} canvas`)).toHaveCount(1);
    await expect(page.locator(`${ROOT} canvas`)).toHaveAttribute("aria-hidden", "true");
    await page.waitForLoadState("networkidle");
    expect(requests).toEqual({ manifest: 1, poster: 1 });
  });

  test("the canvas shows the frame that matches the scroll position", async ({ page }) => {
    const frames = trackFrames(page);
    await page.goto("/plain.html");
    await waitForAllFrames(frames, "desktop");

    const seen = [];
    for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
      const index = await scrollToProgress(page, progress, ROOT);
      await expectCanvasShows(page, "desktop", index, ROOT);
      seen.push(index);
    }
    expect(seen).toEqual([0, 15, 30, 44, 59]);
    expect(FRAME_COUNT).toBe(60);
  });

  test("the overlay stays pinned on the sequence while scrolling, and --sf-progress follows", async ({ page }) => {
    const frames = trackFrames(page);
    await page.goto("/plain.html");
    await waitForAllFrames(frames, "desktop");
    await scrollToProgress(page, 0.5, ROOT);

    const state = await page.evaluate(() => {
      const el = document.querySelector("scroll-sequence");
      const stage = el.querySelector("[data-sf-stage]").getBoundingClientRect();
      const h1 = el.querySelector("h1");
      const r = h1.getBoundingClientRect();
      return {
        stageTop: Math.round(stage.top),
        headingIsDirectChild: h1.parentElement === el,
        headingOnTop: document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2) === h1,
        progress: Number(el.style.getPropertyValue("--sf-progress")),
      };
    });
    expect(state).toEqual({ stageTop: 0, headingIsDirectChild: true, headingOnTop: true, progress: expect.closeTo(0.5, 2) });
  });
});
