#!/usr/bin/env node
// Builds a throwaway consumer project that installs scrollframe the way a user would:
// from the packed tarballs, outside the pnpm workspace, with plain npm.
//
//   node e2e/scripts/prepare.mjs [--work <dir>] [--tarballs <dir>] [--run]
//
// --tarballs  folder with the *.tgz files to install (default: pack the workspace now;
//             run `pnpm build` first)
// --work      where the consumer project is created (default: <os tmp>/scrollframe-e2e)
// --run       also run every e2e suite locally (CLI, build, Playwright on Chromium)
import { execSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const fixture = join(root, "e2e/fixture");

const { values } = parseArgs({
  options: {
    work: { type: "string", default: join(tmpdir(), "scrollframe-e2e") },
    tarballs: { type: "string" },
    run: { type: "boolean", default: false },
  },
});
const work = resolve(values.work);

/** Runs a command, streaming its output. `shell` is needed for npm/pnpm/npx shims on Windows. */
function sh(cmd, args, cwd) {
  console.log(`\n$ ${cmd} ${args.join(" ")}`);
  const quoted = [cmd, ...args].map((a) => (/[\s"]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a));
  execSync(quoted.join(" "), { cwd, stdio: "inherit" });
}

rmSync(work, { recursive: true, force: true });
mkdirSync(work, { recursive: true });

/** Every publishable workspace package, so a new package is installed and tested without edits here. */
const packages = readdirSync(join(root, "packages"))
  .filter((dir) => existsSync(join(root, "packages", dir, "package.json")))
  .map((dir) => ({ dir, manifest: JSON.parse(readFileSync(join(root, "packages", dir, "package.json"), "utf8")) }))
  .filter(({ manifest }) => !manifest.private);

let tarballs = values.tarballs ? resolve(values.tarballs) : join(work, ".tarballs");
if (!values.tarballs) {
  for (const { dir } of packages) {
    if (!existsSync(join(root, "packages", dir, "dist"))) {
      throw new Error(`packages/${dir}/dist is missing. Run \`pnpm build\` first.`);
    }
  }
  sh("pnpm", ["-r", "pack", "--pack-destination", tarballs], root);
}
const tgz = readdirSync(tarballs).filter((f) => f.endsWith(".tgz")).map((f) => join(tarballs, f));
/** npm pack names `@scope/name` as `scope-name-<version>.tgz`; the digit check keeps `cli` from matching `cli-extra`. */
const isTarballOf = (name, file) => {
  const prefix = `${name.replace(/^@/, "").replace("/", "-")}-`;
  return file.startsWith(prefix) && /^\d/.test(file.slice(prefix.length));
};
const files = tgz.map((path) => basename(path));
const missing = packages.map(({ manifest }) => manifest.name).filter((name) => !files.some((file) => isTarballOf(name, file)));
if (missing.length > 0 || tgz.length !== packages.length) {
  throw new Error(
    `Expected one tarball per package (${packages.map(({ manifest }) => manifest.name).join(", ")}) in ${tarballs}, ` +
      `found ${tgz.length}${missing.length ? `; missing: ${missing.join(", ")}` : ""}.`,
  );
}

cpSync(fixture, work, {
  recursive: true,
  filter: (src) => !/[\\/](node_modules|test-results|playwright-report|dist|public)([\\/]|$)/.test(src.slice(fixture.length)),
});
sh("npm", ["install", "--no-audit", "--no-fund", ...tgz], work);

// Synthetic input: ffmpeg's test pattern has a running timestamp (2 decimals), so the recorded
// video shows at a glance that the frame on screen follows the scroll. 2 s at 30 fps = 60 frames.
// It uses the ffmpeg-static binary installed with scrollframe, so that dependency is exercised too.
const ffmpeg = createRequire(join(work, "package.json"))("ffmpeg-static");
if (!ffmpeg || !existsSync(ffmpeg)) throw new Error("ffmpeg-static did not install its binary.");
sh(ffmpeg, [
  "-hide_banner", "-loglevel", "error", "-y",
  "-f", "lavfi", "-i", "testsrc=size=960x540:rate=30:duration=2:decimals=2",
  "-c:v", "mpeg4", "-q:v", "2", "-pix_fmt", "yuv420p",
  "input.mp4",
], work);

console.log(`\nConsumer project ready: ${work}`);

if (values.run) {
  sh("npm", ["run", "test:cli"], work);
  sh("npm", ["run", "sequence"], work);
  sh("npm", ["run", "build"], work);
  sh("npx", ["playwright", "install", "chromium"], work);
  sh("npm", ["run", "test:browser", "--", "--project=chromium", "--project=demo"], work);
  console.log(`\nReport: ${join(work, "playwright-report")}  Videos: ${join(work, "test-results")}`);
}
