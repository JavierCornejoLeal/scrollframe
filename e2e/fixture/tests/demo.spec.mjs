// Not an assertion-heavy test: it scrolls through the whole sequence slowly so the
// recorded video (test-results/**/video.webm) shows the frame counter following the scroll.
import { test } from "@playwright/test";
import { expectCanvasShows, scrollToProgress, trackFrames, waitForAllFrames } from "./helpers.mjs";

test("scroll through the sequence (recorded)", async ({ page }, testInfo) => {
  const frames = trackFrames(page);
  await page.goto("/");
  await waitForAllFrames(frames, "desktop");
  await page.waitForTimeout(800);

  // Down, slowly, with the mouse wheel like a reader.
  const total = await page.evaluate(() => document.querySelector("section").offsetHeight - window.innerHeight);
  const steps = 60;
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, total / steps);
    await page.waitForTimeout(80);
  }
  await page.waitForTimeout(600);

  // Checkpoints, each verified against the real frame file and attached as a screenshot.
  for (const progress of [1, 0.5, 0]) {
    const index = await scrollToProgress(page, progress);
    await expectCanvasShows(page, "desktop", index);
    await testInfo.attach(`frame-${index}`, { body: await page.screenshot(), contentType: "image/png" });
    await page.waitForTimeout(500);
  }
});
