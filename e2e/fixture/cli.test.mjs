// End-to-end tests of the installed `scrollframe` CLI against a real video.
// Run inside the consumer project created by e2e/scripts/prepare.mjs.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { parseManifest } from "@scrollframe/core";
import sharp from "sharp";

// libvips keeps recently read files open; on Windows an open file blocks renaming its
// folder, which would make this test process break the CLI's own `--force` swap.
sharp.cache(false);

const VIDEO = join(import.meta.dirname, "input.mp4");
const SOURCE_FRAMES = 60; // 2 s at 30 fps, see prepare.mjs

/** Runs the installed bin through npx, the way users run it (exercises the bin shim). */
function cli(args) {
  const quoted = args.map((a) => (/[\s"]/.test(a) ? `"${a}"` : a));
  const result = spawnSync(["npx", "--no-install", "scrollframe", ...quoted].join(" "), {
    cwd: import.meta.dirname,
    encoding: "utf8",
    shell: true,
    env: { ...process.env, NO_COLOR: "1" },
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

function isWebp(file) {
  const bytes = readFileSync(file);
  return bytes.subarray(0, 4).toString("latin1") === "RIFF" && bytes.subarray(8, 12).toString("latin1") === "WEBP";
}

let scratch;
before(() => {
  scratch = mkdtempSync(join(tmpdir(), "scrollframe-cli-"));
});
after(() => rmSync(scratch, { recursive: true, force: true }));

test("--help prints the usage and exits 0", () => {
  const { code, stdout } = cli(["--help"]);
  assert.equal(code, 0);
  assert.match(stdout, /Usage: scrollframe <video> \[options\]/);
});

test("a missing video is a usage error (exit 2)", () => {
  const { code, stderr } = cli([join(scratch, "nope.mp4"), "--out", join(scratch, "nope")]);
  assert.equal(code, 2);
  assert.match(stderr, /Video not found/);
});

describe("generating a sequence", () => {
  let out;
  let manifest;
  let run;

  before(() => {
    out = join(scratch, "public", "sequence");
    run = cli([VIDEO, "--out", out, "--frames", "40", "--widths", "320,640,960"]);
    manifest = parseManifest(JSON.parse(readFileSync(join(out, "manifest.json"), "utf8")));
  });

  test("exits 0 and reports the manifest path", () => {
    assert.equal(run.code, 0, run.stderr);
    assert.match(run.stdout, /Done: 40 frames ->/);
  });

  test("writes a valid manifest", () => {
    assert.equal(manifest.frameCount, 40);
    assert.equal(manifest.baseUrl, "/sequence");
    assert.equal(manifest.pattern, "frame-{index}.webp");
    assert.equal(manifest.padding, 4);
    assert.deepEqual(
      manifest.sets.map(({ name, width, height, maxViewportWidth }) => ({ name, width, height, maxViewportWidth })),
      [
        { name: "mobile", width: 320, height: 180, maxViewportWidth: 767 },
        { name: "tablet", width: 640, height: 360, maxViewportWidth: 1279 },
        { name: "desktop", width: 960, height: 540, maxViewportWidth: null },
      ],
    );
  });

  test("every set has all frames plus the poster, as real WebP of the declared size", async () => {
    for (const set of manifest.sets) {
      const dir = join(out, set.dir);
      const files = readdirSync(dir).sort();
      const expected = Array.from({ length: 40 }, (_, i) => `frame-${String(i).padStart(4, "0")}.webp`);
      assert.deepEqual(files, [...expected, "poster.webp"].sort(), `${set.name} files`);
      for (const file of files) assert.ok(isWebp(join(dir, file)), `${set.name}/${file} is not WebP`);

      for (const file of [expected[0], expected[39], "poster.webp"]) {
        const meta = await sharp(join(dir, file)).metadata();
        assert.equal(meta.format, "webp");
        assert.equal(meta.width, set.width, `${set.name}/${file} width`);
        assert.equal(meta.height, set.height, `${set.name}/${file} height`);
      }
      assert.deepEqual(readFileSync(join(dir, "poster.webp")), readFileSync(join(dir, expected[0])), "poster is frame 0");
    }
  });

  test("frames actually differ (the video is not frozen)", () => {
    const dir = join(out, "desktop");
    assert.notDeepEqual(readFileSync(join(dir, "frame-0000.webp")), readFileSync(join(dir, "frame-0039.webp")));
  });

  test("refuses to overwrite without --force and leaves the sequence untouched", () => {
    const before = statSync(join(out, "manifest.json")).mtimeMs;
    const again = cli([VIDEO, "--out", out, "--frames", "20", "--widths", "320,640,960"]);
    assert.equal(again.code, 2);
    assert.match(again.stderr, /--force/);
    assert.equal(statSync(join(out, "manifest.json")).mtimeMs, before);
    assert.equal(parseManifest(JSON.parse(readFileSync(join(out, "manifest.json"), "utf8"))).frameCount, 40);
  });

  test("--force replaces the sequence completely, leaving no stale frames or staging folders", () => {
    const forced = cli([VIDEO, "--out", out, "--frames", "20", "--widths", "320,640,960", "--force"]);
    assert.equal(forced.code, 0, forced.stderr);
    const replaced = parseManifest(JSON.parse(readFileSync(join(out, "manifest.json"), "utf8")));
    assert.equal(replaced.frameCount, 20);
    assert.ok(!existsSync(join(out, "desktop", "frame-0039.webp")), "stale frame left behind");
    assert.equal(readdirSync(join(out, "desktop")).length, 21);
    assert.deepEqual(readdirSync(out).filter((e) => e.startsWith(".scrollframe-")), []);
  });
});

test("asking for more frames than the video has extracts only the real ones", () => {
  const out = join(scratch, "capped");
  const { code, stdout, stderr } = cli([VIDEO, "--out", out, "--frames", "100", "--widths", "320,640,960"]);
  assert.equal(code, 0, stderr);
  assert.match(stdout, new RegExp(`only has ${SOURCE_FRAMES} frames`));
  const manifest = parseManifest(JSON.parse(readFileSync(join(out, "manifest.json"), "utf8")));
  assert.equal(manifest.frameCount, SOURCE_FRAMES);
});
