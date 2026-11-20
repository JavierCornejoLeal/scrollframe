import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { HELP, parseFrameRate, resolveFfmpeg, runCli } from "../src/index.js";

function io() {
  const out = { stdout: "", stderr: "" };
  return {
    out,
    io: {
      stdout: { write: (chunk: string) => (out.stdout += chunk) },
      stderr: { write: (chunk: string) => (out.stderr += chunk) },
    },
  };
}

const scratch = mkdtempSync(join(tmpdir(), "scrollframe-run-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

describe("runCli", () => {
  it("prints help on stdout and exits 0", async () => {
    const { out, io: cli } = io();
    expect(await runCli(["--help"], cli)).toBe(0);
    expect(out.stdout).toBe(HELP);
    expect(out.stderr).toBe("");
  });

  it("exits 2 with the reason and the help on stderr for bad usage", async () => {
    const { out, io: cli } = io();
    expect(await runCli([], cli)).toBe(2);
    expect(out.stderr).toBe(`Missing <video>. Run \`scrollframe --help\`.\n\n${HELP}`);
    expect(out.stdout).toBe("");
  });

  it("exits 2 for a missing video without printing the help", async () => {
    const { out, io: cli } = io();
    expect(await runCli(["missing.mp4"], cli)).toBe(2);
    expect(out.stderr).toBe("Video not found: missing.mp4\n");
  });

  it("exits 2 when the output path is a file, not a folder", async () => {
    const video = join(scratch, "fake.mp4");
    const file = join(scratch, "not-a-dir");
    writeFileSync(video, "");
    writeFileSync(file, "");
    const ffmpeg = join(scratch, "fake-ffmpeg-ok");
    writeFileSync(ffmpeg, '#!/bin/sh\necho "  Duration: 00:00:02.00, start: 0" >&2\nexit 1\n');
    chmodSync(ffmpeg, 0o755);
    const { out, io: cli } = io();
    expect(await runCli([video, "-o", file, "--ffmpeg", ffmpeg], cli)).toBe(2);
    expect(out.stderr).toBe(`Output path is not a folder: ${file}\n`);
  });

  it("exits 1 with 'Unexpected error' when ffmpeg fails while extracting", async () => {
    const video = join(scratch, "fake.mp4");
    writeFileSync(video, "");
    // Reports a duration on probe, then fails like a corrupt input would.
    const ffmpeg = join(scratch, "fake-ffmpeg");
    writeFileSync(ffmpeg, '#!/bin/sh\necho "  Duration: 00:00:02.00, start: 0" >&2\necho "boom" >&2\nexit 1\n');
    chmodSync(ffmpeg, 0o755);
    const { out, io: cli } = io();
    expect(await runCli([video, "-o", join(scratch, "out-fail"), "--ffmpeg", ffmpeg], cli)).toBe(1);
    expect(out.stderr).toMatch(/^Unexpected error: ffmpeg failed:\n/);
  });

  it("exits 2 with a clear message when the ffmpeg binary does not exist", async () => {
    const video = join(scratch, "fake.mp4");
    writeFileSync(video, "");
    const { out, io: cli } = io();
    expect(await runCli([video, "--ffmpeg", join(scratch, "nope")], cli)).toBe(2);
    expect(out.stderr).toBe(`ffmpeg not found ("${join(scratch, "nope")}"). Install ffmpeg or pass --ffmpeg <path>.\n`);
  });
});

describe("parseFrameRate", () => {
  it("reads the video stream frame rate", () => {
    expect(parseFrameRate("Stream #0:0: Video: h264, yuv420p, 1280x720, 30 fps, 30 tbr")).toBe(30);
    expect(parseFrameRate("Video: h264, 1920x1080, 23.98 fps, 23.98 tbr")).toBe(23.98);
    expect(parseFrameRate("Audio: aac, 44100 Hz")).toBeNull();
  });
});

const ffmpeg = resolveFfmpeg();
const hasFfmpeg = spawnSync(ffmpeg, ["-version"]).status === 0;

describe.skipIf(!hasFfmpeg)("runCli (end to end)", () => {
  it("succeeds, prints the per-set summary and usage snippet", async () => {
    const video = join(scratch, "clip.mp4");
    spawnSync(ffmpeg, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=640x360:rate=30:duration=1", video]);
    const outDir = join(scratch, "public", "seq");
    const { out, io: cli } = io();
    expect(await runCli([video, "-o", outDir, "-f", "6", "--lossless"], cli)).toBe(0);
    expect(out.stderr).toBe("Warning: --lossless frames are several times heavier and will hurt LCP.\n");
    expect(out.stdout).toContain("Extracting 6 frames from 1.00s of video...");
    expect(out.stdout).toMatch(/mobile\s+640x360/);
    expect(out.stdout).toContain(`Done: 6 frames -> ${join(outDir, "manifest.json")}`);
    expect(out.stdout).toContain("<ScrollSequence manifest={manifest}");
  }, 60_000);

  it("never asks for more frames than the video has, and says so", async () => {
    const video = join(scratch, "short.mp4");
    spawnSync(ffmpeg, ["-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=320x180:rate=10:duration=1", video]);
    const outDir = join(scratch, "short-out");
    const { out, io: cli } = io();
    expect(await runCli([video, "-o", outDir, "-f", "30"], cli)).toBe(0);
    expect(out.stdout).toContain("The video only has 10 frames; extracting 10 instead of 30.");
    expect(JSON.parse(readFileSync(join(outDir, "manifest.json"), "utf8")).frameCount).toBe(10);
  }, 60_000);
});
