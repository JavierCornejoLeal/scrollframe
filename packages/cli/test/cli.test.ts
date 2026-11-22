import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterAll, describe, expect, it } from "vitest";
import { parseManifest } from "@scrollframe/core";
import {
  UsageError,
  deriveBaseUrl,
  type GenerateOptions,
  generateSequence,
  parseCliArgs,
  parseDuration,
  resolveFfmpeg,
  ffmpegNotFoundMessage,
  framesFor,
  planAdaptiveSets,
  samplingFps,
  scrollLengthFor,
} from "../src/index.js";

describe("parseCliArgs", () => {
  it("applies defaults", () => {
    expect(parseCliArgs(["intro.mp4"])).toEqual({
      input: "intro.mp4",
      out: "public/sequence",
      baseUrl: "/sequence",
      frames: 120,
      quality: 80,
      widths: [720, 1280, 1920],
      lossless: false,
      ffmpeg: undefined,
      force: false,
      // Nothing was given, so frames, sets and quality follow the video.
      auto: { frames: true, sets: true, quality: true },
    });
  });

  it("returns help", () => {
    expect(parseCliArgs(["--help"])).toBe("help");
  });

  it.each([
    [[], "Missing <video>. Run `scrollframe --help`."],
    [["a.mp4", "b.mp4"], "Unexpected arguments: b.mp4"],
    [["a.mp4", "-f", "1"], '--frames must be an integer between 2 and 20000 (got "1").'],
    [["a.mp4", "-q", "101"], '--quality must be an integer between 0 and 100 (got "101").'],
    [["a.mp4", "-w", "720,1280"], "--widths needs exactly three values: mobile,tablet,desktop."],
    [["a.mp4", "-w", "1920,1280,720"], "--widths must be ascending: mobile < tablet < desktop."],
  ])("rejects %j", (argv, message) => {
    expect(() => parseCliArgs(argv)).toThrowError(new UsageError(message));
  });
});

describe("helpers", () => {
  it.each([
    ["public/sequence", "/sequence"],
    ["./public/media/hero/", "/media/hero"],
    ["apps/web/public/hero", "/hero"],
    ["out/frames", "/frames"],
  ])("deriveBaseUrl(%s) = %s", (out, url) => {
    expect(deriveBaseUrl(out)).toBe(url);
  });

  it("parses the ffmpeg duration line", () => {
    expect(parseDuration("  Duration: 00:01:02.50, start: 0.000000")).toBe(62.5);
    expect(parseDuration("no duration here")).toBeNull();
  });

  it("computes the sampling frame rate", () => {
    expect(samplingFps(120, 4)).toBe(30);
    expect(() => samplingFps(120, 0)).toThrow(UsageError);
  });
});

function options(argv: string[]): GenerateOptions {
  const parsed = parseCliArgs(argv);
  if (parsed === "help") throw new Error("unexpected help");
  return parsed;
}

const ffmpeg = resolveFfmpeg();
const hasFfmpeg = spawnSync(ffmpeg, ["-version"]).status === 0;
const scratch = mkdtempSync(join(tmpdir(), "scrollframe-test-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe.skipIf(!hasFfmpeg)("generateSequence (end to end)", () => {
  const video = join(scratch, "clip.mp4");
  const out = join(scratch, "public", "sequence");

  it("writes webp frames, posters and a valid manifest per breakpoint", async () => {
    spawnSync(ffmpeg, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=30:duration=2", video]);
    const result = await generateSequence(options([video, "-o", out, "-f", "10", "-w", "720,1280,1920"]));

    const manifest = parseManifest(JSON.parse(readFileSync(join(out, "manifest.json"), "utf8")));
    expect(manifest).toEqual(result.manifest);
    expect(manifest.frameCount).toBe(10);
    expect(manifest.baseUrl).toBe("/sequence");
    expect(manifest.sets.map((s) => [s.name, s.width, s.height])).toEqual([
      ["mobile", 720, 405],
      ["tablet", 1280, 720],
      // Source is 1280 wide: frames are never upscaled.
      ["desktop", 1280, 720],
    ]);
    for (const set of manifest.sets) {
      const files = readdirSync(join(out, set.dir)).sort();
      expect(files).toHaveLength(11);
      expect(files).toContain("poster.webp");
      expect(files).toContain("frame-0009.webp");
    }
  }, 60_000);

  it("refuses to overwrite without --force and keeps unrelated files with --force", async () => {
    writeFileSync(join(out, "keep.txt"), "mine");
    await expect(generateSequence(options([video, "-o", out, "-f", "4", "-w", "720,1280,1920"]))).rejects.toThrow(
      `${out} already contains a sequence. Use --force to overwrite it.`,
    );
    await generateSequence(options([video, "-o", out, "-f", "4", "-w", "720,1280,1920", "--force"]));
    expect(existsSync(join(out, "keep.txt"))).toBe(true);
    expect(readdirSync(join(out, "mobile"))).toHaveLength(5);
  }, 60_000);

  it("fails clearly for a missing video", async () => {
    await expect(generateSequence(options(["nope.mp4"]))).rejects.toThrow("Video not found: nope.mp4");
  });
});

describe("following the video", () => {
  it.each([
    [15.68, 376, 235],
    [120, 3600, 1800],
    [600, 18000, 9000],
    [4, 120, 120],
    [2, 60, 60],
    [30, Infinity, 450],
  ])("%d s with %d frames gets %d", (duration, available, frames) => {
    expect(framesFor(duration, available)).toBe(frames);
  });

  it.each([
    [2, "300vh"],
    [15.68, "630vh"],
    [120, "4800vh"],
  ])("%d s scrolls over %s", (duration, length) => {
    expect(scrollLengthFor(duration)).toBe(length);
  });

  const sizes = (width: number, height: number) =>
    planAdaptiveSets(width, height).map((set) => [set.name, set.width, set.height, set.maxViewportWidth, set.maxAspectRatio]);

  it("4K landscape: two portrait crops and two full frames", () => {
    expect(sizes(3840, 2160)).toEqual([
      ["mobile", 1296, 2160, 767, 0.6],
      ["tablet", 1440, 1800, 1023, 0.8],
      ["desktop", 1920, 1080, 1920, undefined],
      ["large", 2560, 1440, null, undefined],
    ]);
  });

  it("720p: never upscaled, and no second copy of the same size", () => {
    expect(sizes(1280, 720)).toEqual([
      ["mobile", 432, 720, 767, 0.6],
      ["tablet", 576, 720, 1023, 0.8],
      ["desktop", 1280, 720, null, undefined],
    ]);
  });

  it("a vertical video is not cropped", () => {
    expect(sizes(2160, 3840)).toEqual([
      ["mobile", 1080, 1920, 767, undefined],
      ["desktop", 1920, 3413, 1920, undefined],
      ["large", 2160, 3840, null, undefined],
    ]);
  });

  it("explicit options are respected", () => {
    const parsed = parseCliArgs(["a.mp4", "-f", "1800", "-w", "720,1280,1920", "-q", "70"]);
    expect(parsed).toMatchObject({ frames: 1800, quality: 70, auto: { frames: false, sets: false, quality: false } });
  });

  it("the fix printed for a blocked ffmpeg works after a blocked npx run", () => {
    // Naming ffmpeg-static as a package gives npx a different cache entry from the blocked one.
    expect(ffmpegNotFoundMessage("ffmpeg", true)).toContain(
      '  npx --allow-scripts=ffmpeg-static -p "@scrollframe/cli" -p ffmpeg-static scrollframe <video>',
    );
  });
});

describe.skipIf(!hasFfmpeg)("generateSequence following the video", () => {
  it("writes the crops, the frames of the duration and the scroll length", async () => {
    const video = join(scratch, "long.mp4");
    const out = join(scratch, "public", "adaptive");
    spawnSync(ffmpeg, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=30:duration=10", video]);
    await generateSequence(options([video, "-o", out]));

    const manifest = parseManifest(JSON.parse(readFileSync(join(out, "manifest.json"), "utf8")));
    expect(manifest.frameCount).toBe(150);
    expect(manifest.scrollLength).toBe("400vh");
    expect(manifest.sets.map((set) => [set.name, set.width, set.height])).toEqual([
      ["mobile", 108, 180],
      ["tablet", 144, 180],
      ["desktop", 320, 180],
    ]);
    for (const set of manifest.sets) {
      const files = readdirSync(join(out, set.dir));
      expect(files).toHaveLength(151);
      const { width, height } = await sharp(join(out, set.dir, "frame-0149.webp")).metadata();
      expect([width, height]).toEqual([set.width, set.height]);
    }
  }, 60_000);

  it("--widths alone keeps frames and scroll length following the video", async () => {
    const out = join(scratch, "public", "widths");
    await generateSequence(options([join(scratch, "long.mp4"), "-o", out, "-w", "40,80,160"]));
    const manifest = parseManifest(JSON.parse(readFileSync(join(out, "manifest.json"), "utf8")));
    expect([manifest.frameCount, manifest.scrollLength]).toEqual([150, "400vh"]);
  }, 60_000);

  it("an API caller that sets no `auto` gets no scroll length, as before", async () => {
    const out = join(scratch, "public", "api");
    const { auto: _auto, ...classic } = options([join(scratch, "long.mp4"), "-o", out, "-f", "10", "-w", "40,80,160"]);
    const { manifest } = await generateSequence(classic);
    expect(manifest).not.toHaveProperty("scrollLength");
  }, 60_000);

  it("a folder named `large` is part of a sequence only next to its manifest", async () => {
    const video = join(scratch, "long.mp4");
    const mine = join(scratch, "public", "mine");
    mkdirSync(join(mine, "large"), { recursive: true });
    writeFileSync(join(mine, "large", "keep.txt"), "mine");
    await generateSequence(options([video, "-o", mine, "--force", "-w", "40,80,160"]));
    expect(readFileSync(join(mine, "large", "keep.txt"), "utf8")).toBe("mine");

    const ours = join(scratch, "public", "ours");
    await generateSequence(options([video, "-o", ours]));
    await expect(generateSequence(options([video, "-o", ours]))).rejects.toThrow("already contains a sequence");
    await generateSequence(options([video, "-o", ours, "--force", "-w", "40,80,160"]));
    expect(existsSync(join(ours, "large"))).toBe(false);
  }, 60_000);
});
