// End-to-end tests of the CLI set-up flow (`--yes`) on sample projects, with the installed CLI.
// Run inside the consumer project created by e2e/scripts/prepare.mjs, on every OS in CI.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, test } from "node:test";

const CLI = join(import.meta.dirname, "node_modules/@scrollframe/cli/dist/cli.js");
const VIDEO = join(import.meta.dirname, "input.mp4");
const FAST = ["--frames", "6", "--widths", "80,160,320"];

let scratch;
before(() => {
  scratch = mkdtempSync(join(tmpdir(), "scrollframe-scaffold-"));
});
after(() => rmSync(scratch, { recursive: true, force: true }));

/** Creates a sample project with a hero.mp4 from `{ path: contents }` (objects are JSON). */
function project(name, files) {
  const root = join(scratch, name);
  mkdirSync(root, { recursive: true });
  copyFileSync(VIDEO, join(root, "hero.mp4"));
  for (const [path, contents] of Object.entries(files)) {
    // "src/" is a folder; dirname("src/") would be the project root, so create it directly.
    if (path.endsWith("/")) {
      mkdirSync(join(root, path), { recursive: true });
      continue;
    }
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), typeof contents === "string" ? contents : JSON.stringify(contents, null, 2) + "\n");
  }
  return root;
}

/** Runs the installed CLI in `cwd` with stdin closed (no terminal), like CI or a script. */
function cli(cwd, args) {
  const result = spawnSync(process.execPath, [CLI, "hero.mp4", ...FAST, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, NO_COLOR: "1" },
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

const read = (root, path) => readFileSync(join(root, path), "utf8");

test("without a terminal and without --yes it only generates the frames, plus a hint", () => {
  const root = project("plain-no-yes", { "index.html": "<!doctype html>" });
  const { code, stdout } = cli(root, []);
  assert.equal(code, 0);
  assert.ok(existsSync(join(root, "public/sequence/manifest.json")));
  assert.equal(existsSync(join(root, "hero-sequence.html")), false);
  assert.match(stdout, /Tip: run it in a terminal, or add --yes, to also set up the component for this plain HTML site\./);
});

test("plain HTML: frames in sequence/ and a snippet with the poster already rendered", () => {
  const root = project("plain", { "index.html": "<!doctype html>" });
  const { code, stdout, stderr } = cli(root, ["--yes"]);
  assert.equal(code, 0, stderr);
  assert.match(stdout, /Project: Plain HTML/);
  assert.ok(existsSync(join(root, "sequence/manifest.json")));
  const snippet = read(root, "hero-sequence.html");
  assert.match(snippet, /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@scrollframe\/element@\d+\.\d+" defer><\/script>/);
  assert.match(snippet, /<scroll-sequence src="\/sequence\/manifest\.json"[^>]*>\s*<div data-sf-stage=""/);
  assert.match(snippet, /src="\/sequence\/desktop\/poster\.webp"/);
});

test("Next.js App Router: component, and the Next.js 16 overflow-x: hidden fixed to clip", () => {
  const root = project("next", {
    "package.json": { dependencies: { next: "16.0.0", react: "19.0.0", "@scrollframe/react": "*" } },
    "tsconfig.json": {},
    "app/globals.css": "html,\nbody {\n  max-width: 100vw;\n  overflow-x: hidden;\n}\n",
    "public/": "",
  });
  const { code, stdout, stderr } = cli(root, ["--yes"]);
  assert.equal(code, 0, stderr);
  assert.match(stdout, /Project: Next\.js \(App Router\) · TypeScript · npm/);
  assert.match(read(root, "components/HeroSequence.tsx"), /import manifest from "\.\.\/public\/sequence\/manifest\.json";/);
  assert.match(read(root, "app/globals.css"), /overflow-x: clip;/);
  assert.match(stdout, /import HeroSequence from "\.\.\/components\/HeroSequence";/);
});

test("Angular: component and the element stylesheet added to angular.json", () => {
  const angularJson = { projects: { app: { architect: { build: { options: { styles: ["src/styles.css"] } } } } } };
  const root = project("angular", {
    "package.json": { dependencies: { "@angular/core": "22.0.0", "@scrollframe/element": "*" } },
    "angular.json": angularJson,
    "src/": "",
    "public/": "",
  });
  const { code, stderr } = cli(root, ["--yes"]);
  assert.equal(code, 0, stderr);
  assert.match(read(root, "src/app/hero-sequence/hero-sequence.ts"), /<scroll-sequence src="\/sequence\/manifest\.json"/);
  assert.deepEqual(JSON.parse(read(root, "angular.json")).projects.app.architect.build.options.styles, [
    "src/styles.css",
    "@scrollframe/element/style.css",
  ]);
});

test("Vue: component, and the vite.config line printed instead of edited", () => {
  const root = project("vue", {
    "package.json": { dependencies: { vue: "3.5.0", "@scrollframe/element": "*" } },
    "vite.config.js": "export default {};\n",
    "src/": "",
    "public/": "",
  });
  const { code, stdout, stderr } = cli(root, ["--yes"]);
  assert.equal(code, 0, stderr);
  assert.match(read(root, "src/components/HeroSequence.vue"), /<script setup>/);
  assert.match(stdout, /isCustomElement: \(tag\) => tag === "scroll-sequence"/);
  assert.equal(read(root, "vite.config.js"), "export default {};\n");
});

// Deliberately a real install from the public registry: it is the only CI check of the Windows
// shell path in spawnCommand. It installs the published package (not this build), so it checks
// the install mechanics, not the package contents, and needs network access.
test("React: installs @scrollframe/react for real with npm (the Windows shell path in CI)", () => {
  const root = project("react", { "package.json": { name: "react-sample", private: true, dependencies: { react: "19.2.0" } }, "src/": "" });
  const { code, stdout, stderr } = cli(root, ["--yes"]);
  assert.equal(code, 0, stderr);
  assert.match(stdout, /Install @scrollframe\/react {2}\(npm install @scrollframe\/react\)/);
  assert.ok(JSON.parse(read(root, "package.json")).dependencies["@scrollframe/react"]);
  assert.ok(existsSync(join(root, "node_modules/@scrollframe/react/package.json")));
  assert.ok(existsSync(join(root, "src/components/HeroSequence.jsx")));
});
