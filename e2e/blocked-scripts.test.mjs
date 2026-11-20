// What a user with npm 12+ (dependency install scripts blocked by default) gets.
// Requires npm >= 12 on PATH and TARBALLS pointing at the packed *.tgz files:
//
//   TARBALLS=<dir> node --test e2e/blocked-scripts.test.mjs
import assert from "node:assert/strict";
import { execSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { after, before, test } from "node:test";

const tarballs = resolve(process.env.TARBALLS ?? "");
/** `scrollframe` must not match `scrollframe-core-*`: the name is followed by the version. */
const tgz = (name) => {
  const file = readdirSync(tarballs).find((f) => f.startsWith(`${name}-`) && /^\d/.test(f.slice(name.length + 1)));
  assert.ok(file, `no ${name} tarball in ${tarballs}`);
  return join(tarballs, file);
};

const FIXES = [
  "npx --allow-scripts=ffmpeg-static scrollframe <video>",
  "npm install-scripts approve ffmpeg-static && npm rebuild ffmpeg-static",
  "install ffmpeg on your system, or pass --ffmpeg <path>",
];

let root;
let project;
const npm = (args, cwd) => execSync(`npm ${args}`, { cwd, stdio: "pipe", encoding: "utf8" });

/** Runs the installed CLI with only Node on PATH, so no system ffmpeg can hide the problem. */
function cli(args) {
  const result = spawnSync(process.execPath, [join(project, "node_modules/scrollframe/dist/cli.js"), ...args], {
    cwd: project,
    encoding: "utf8",
    env: { PATH: dirname(process.execPath), NO_COLOR: "1" },
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

const bundledFfmpeg = () => createRequire(join(project, "package.json"))("ffmpeg-static");

before(() => {
  const major = Number(npm("--version").trim().split(".")[0]);
  assert.ok(major >= 12, `this suite needs npm >= 12, found ${major}`);
  root = mkdtempSync(join(tmpdir(), "scrollframe-blocked-"));
  project = join(root, "app");
  mkdirSync(project);
  npm("init -y", project);
  npm(`install --no-audit --no-fund "${tgz("scrollframe-core")}" "${tgz("scrollframe")}"`, project);
  writeFileSync(join(project, "clip.mp4"), "");
});
after(() => rmSync(root, { recursive: true, force: true }));

test("npm blocks ffmpeg-static's install script, so no binary is downloaded", () => {
  assert.equal(existsSync(bundledFfmpeg()), false);
});

test("the CLI explains the blocked install and lists the exact fixes (exit 2)", () => {
  const { code, stderr } = cli(["clip.mp4"]);
  assert.equal(code, 2, stderr);
  assert.match(stderr, /ffmpeg-static\) was not downloaded/);
  for (const fix of FIXES) assert.ok(stderr.includes(fix), `missing fix: ${fix}\n${stderr}`);
});

test("an explicit --ffmpeg keeps the short message", () => {
  const { code, stderr } = cli(["clip.mp4", "--ffmpeg", join(root, "nope")]);
  assert.equal(code, 2);
  assert.equal(stderr, `ffmpeg not found ("${join(root, "nope")}"). Install ffmpeg or pass --ffmpeg <path>.\n`);
});

test("the documented project fix downloads the binary and the CLI works", () => {
  npm("install-scripts approve ffmpeg-static", project);
  npm("rebuild ffmpeg-static", project);
  const ffmpeg = bundledFfmpeg();
  assert.ok(existsSync(ffmpeg), "binary still missing after approve + rebuild");

  execSync(`"${ffmpeg}" -hide_banner -loglevel error -y -f lavfi -i testsrc=size=320x180:rate=10:duration=1 -c:v mpeg4 clip.mp4`, {
    cwd: project,
  });
  const { code, stdout, stderr } = cli(["clip.mp4", "--frames", "5", "--widths", "80,160,320"]);
  assert.equal(code, 0, stderr);
  assert.match(stdout, /Done: 5 frames ->/);
});

test("the documented npx fix works in a project-less one-off run", () => {
  const scratch = join(root, "npx");
  mkdirSync(scratch);
  const video = join(project, "clip.mp4");
  const result = spawnSync(
    `npx -y --allow-scripts=ffmpeg-static -p "${tgz("scrollframe-core")}" -p "${tgz("scrollframe")}" scrollframe "${video}" --out out --frames 5 --widths 80,160,320`,
    {
      cwd: scratch,
      shell: true,
      encoding: "utf8",
      // A fresh cache, so a binary downloaded by an earlier test cannot be reused.
      env: { ...process.env, npm_config_cache: join(root, "npm-cache") },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Done: 5 frames ->/);
});
