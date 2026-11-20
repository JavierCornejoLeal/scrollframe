import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  samplingFps,
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
    });
  });

  it("returns help", () => {
    expect(parseCliArgs(["--help"])).toBe("help");
  });

  it.each([
    [[], "Missing <video>. Run `scrollframe --help`."],
    [["a.mp4", "b.mp4"], "Unexpected arguments: b.mp4"],
    [["a.mp4", "-f", "1"], '--frames must be an integer between 2 and 600 (got "1").'],
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
    const result = await generateSequence(options([video, "-o", out, "-f", "10"]));

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
    await expect(generateSequence(options([video, "-o", out, "-f", "4"]))).rejects.toThrow(
      `${out} already contains a sequence. Use --force to overwrite it.`,
    );
    await generateSequence(options([video, "-o", out, "-f", "4", "--force"]));
    expect(existsSync(join(out, "keep.txt"))).toBe(true);
    expect(readdirSync(join(out, "mobile"))).toHaveLength(5);
  }, 60_000);

  it("fails clearly for a missing video", async () => {
    await expect(generateSequence(options(["nope.mp4"]))).rejects.toThrow("Video not found: nope.mp4");
  });
});
