import { describe, expect, it } from "vitest";
import {
  ManifestError,
  coarseToFineOrder,
  frameIndexFromProgress,
  frameUrl,
  nearestLoaded,
  parseManifest,
  posterUrl,
  progressFromRect,
  selectFrameSet,
} from "../src/index.js";

const raw = {
  version: 1,
  frameCount: 120,
  baseUrl: "/sequence/",
  pattern: "frame-{index}.webp",
  padding: 4,
  poster: "poster.webp",
  sets: [
    { name: "desktop", maxViewportWidth: null, width: 1920, height: 1080, dir: "desktop" },
    { name: "mobile", maxViewportWidth: 767, width: 720, height: 405, dir: "mobile" },
    { name: "tablet", maxViewportWidth: 1279, width: 1280, height: 720, dir: "tablet" },
  ],
};

describe("parseManifest", () => {
  it("sorts sets from smallest to largest viewport", () => {
    expect(parseManifest(raw).sets.map((s) => s.name)).toEqual(["mobile", "tablet", "desktop"]);
  });

  it.each([
    [{ ...raw, version: 2 }, "Unsupported manifest version: 2."],
    [{ ...raw, frameCount: 0 }, "`frameCount` must be a positive integer."],
    [{ ...raw, pattern: "frame.webp" }, "`pattern` must be a string containing `{index}`."],
    [{ ...raw, sets: [] }, "`sets` must be a non-empty array."],
  ])("rejects invalid manifests with a clear message", (input, message) => {
    expect(() => parseManifest(input)).toThrowError(new ManifestError(message));
  });
});

describe("selectFrameSet", () => {
  const manifest = parseManifest(raw);
  it.each([
    [375, "mobile"],
    [767, "mobile"],
    [768, "tablet"],
    [1280, "desktop"],
    [3840, "desktop"],
  ])("viewport %i uses the %s set", (width, name) => {
    expect(selectFrameSet(manifest, width).name).toBe(name);
  });
});

describe("urls", () => {
  const manifest = parseManifest(raw);
  const mobile = selectFrameSet(manifest, 375);
  it("builds zero-padded frame urls without duplicated slashes", () => {
    expect(frameUrl(manifest, mobile, 7)).toBe("/sequence/mobile/frame-0007.webp");
    expect(frameUrl(manifest, mobile, 7, "https://cdn.example.com/seq/")).toBe(
      "https://cdn.example.com/seq/mobile/frame-0007.webp",
    );
  });
  it("builds the poster url", () => {
    expect(posterUrl(manifest, mobile)).toBe("/sequence/mobile/poster.webp");
  });
});

describe("scroll math", () => {
  it("maps section position to progress", () => {
    expect(progressFromRect(100, 3000, 1000)).toBe(0);
    expect(progressFromRect(-1000, 3000, 1000)).toBe(0.5);
    expect(progressFromRect(-5000, 3000, 1000)).toBe(1);
  });

  it("maps progress to the first and last frame at the edges", () => {
    expect(frameIndexFromProgress(0, 120)).toBe(0);
    expect(frameIndexFromProgress(1, 120)).toBe(119);
    expect(frameIndexFromProgress(0.5, 1)).toBe(0);
  });
});

describe("coarseToFineOrder", () => {
  it("loads every frame exactly once, keyframes and last frame first", () => {
    const order = coarseToFineOrder(40);
    expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: 40 }, (_, i) => i));
    expect(order.slice(0, 4)).toEqual([0, 16, 32, 39]);
  });
});

describe("nearestLoaded", () => {
  it("falls back to the closest loaded frame, or -1", () => {
    const loaded = new Set([0, 16]);
    expect(nearestLoaded(10, 40, (i) => loaded.has(i))).toBe(16);
    expect(nearestLoaded(5, 40, (i) => loaded.has(i))).toBe(0);
    expect(nearestLoaded(5, 40, () => false)).toBe(-1);
  });
});

const adaptive = {
  ...raw,
  scrollLength: "630vh",
  sets: [
    { name: "mobile", maxViewportWidth: 767, maxAspectRatio: 0.6, width: 1296, height: 2160, dir: "mobile" },
    { name: "tablet", maxViewportWidth: 1023, maxAspectRatio: 0.8, width: 1440, height: 1800, dir: "tablet" },
    { name: "desktop", maxViewportWidth: 1920, width: 1920, height: 1080, dir: "desktop" },
    { name: "large", maxViewportWidth: null, width: 2560, height: 1440, dir: "large" },
  ],
};

describe("adaptive manifests", () => {
  it("keeps the optional fields, and adds none to an older manifest", () => {
    expect(parseManifest(adaptive).scrollLength).toBe("630vh");
    expect(parseManifest(adaptive).sets[0]!.maxAspectRatio).toBe(0.6);
    expect(parseManifest(raw)).not.toHaveProperty("scrollLength");
    expect(parseManifest(raw).sets[0]).not.toHaveProperty("maxAspectRatio");
  });

  it.each([0, -1, "wide"])("refuses maxAspectRatio %j", (maxAspectRatio) => {
    expect(() => parseManifest({ ...adaptive, sets: [{ ...adaptive.sets[0], maxAspectRatio }] })).toThrow(
      "sets[0].maxAspectRatio must be a positive number.",
    );
  });

  it.each(["630", '1vh" onload="x', "calc(1px)", 5])("refuses scrollLength %j, which ends up in markup", (scrollLength) => {
    expect(() => parseManifest({ ...adaptive, scrollLength })).toThrow(ManifestError);
  });

  it.each([
    ["phone", 390, 844, 3, "mobile"],
    ["phone with browser bars", 390, 664, 3, "mobile"],
    ["tablet portrait", 820, 1180, 2, "tablet"],
    ["tablet portrait with browser bars", 820, 1106, 2, "tablet"],
    ["phone landscape", 844, 390, 3, "desktop"],
    ["1080p screen", 1920, 1080, 1, "desktop"],
    ["1080p browser window", 1906, 970, 1, "desktop"],
    ["QHD screen", 2560, 1440, 1, "large"],
    ["retina laptop", 1512, 982, 2, "large"],
    ["tablet landscape", 1180, 820, 2, "large"],
    ["tall desktop window", 1000, 1100, 1, "desktop"],
  ])("%s %ix%i@%i uses %s", (_name, width, height, dpr, name) => {
    expect(selectFrameSet(parseManifest(adaptive), width, height, dpr).name).toBe(name);
  });

  it("ignores height and pixel ratio for an older manifest", () => {
    expect(selectFrameSet(parseManifest(raw), 375, 812, 3).name).toBe("mobile");
  });
});
