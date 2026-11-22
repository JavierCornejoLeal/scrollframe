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

/** The three values an unattended set-up needs. */
const setUp = (framework, out) => ["--yes", "--framework", framework, "-o", out, "--base-url", "/sequence"];

const read = (root, path) => readFileSync(join(root, path), "utf8");

test("without a terminal and without --yes it only generates the frames, plus a hint", () => {
  const root = project("plain-no-yes", { "index.html": "<!doctype html>" });
  const { code, stdout } = cli(root, []);
  assert.equal(code, 0);
  assert.ok(existsSync(join(root, "public/sequence/manifest.json")));
  assert.equal(existsSync(join(root, "hero-sequence.html")), false);
  assert.match(stdout, /Tip: run it in a terminal to also set up the component for this plain HTML site, or pass --yes with --framework, -o and --base-url\./);
});

test("--yes alone only generates frames, and the command it prints sets up as written", () => {
  const root = project("bare-yes", { "index.html": "<!doctype html>" });
  const first = cli(root, ["--yes"]);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(existsSync(join(root, "hero-sequence.html")), false);
  assert.match(first.stdout.trimEnd().split("\n").at(-1), /^Not set up: --yes alone only generates the frames\.$/);

  const line = first.stdout.split("\n").find((text) => text.startsWith("  npx @scrollframe/cli "));
  const args = line.slice("  npx @scrollframe/cli ".length).match(/"[^"]*"|\S+/g).map((word) => word.replace(/^"|"$/g, ""));
  const second = spawnSync(process.execPath, [CLI, ...args], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.equal(second.status, 0, second.stderr);
  assert.match(read(root, "hero-sequence.html"), /<scroll-sequence src="\/sequence\/manifest\.json"/);
});

test("plain HTML: frames in sequence/ and a snippet with the poster already rendered", () => {
  const root = project("plain", { "index.html": "<!doctype html>" });
  const { code, stdout, stderr } = cli(root, setUp("html", "sequence"));
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
  const { code, stdout, stderr } = cli(root, setUp("next", "public/sequence"));
  assert.equal(code, 0, stderr);
  assert.match(stdout, /Project: Next\.js \(App Router\) · TypeScript · npm/);
  assert.match(read(root, "components/HeroSequence.tsx"), /import manifest from "\.\.\/public\/sequence\/manifest\.json";/);
  assert.match(read(root, "app/globals.css"), /overflow-x: clip;/);
  assert.match(stdout, /import HeroSequence from "\.\.\/components\/HeroSequence";/);
});

test("Angular: component and the element stylesheet added to angular.json", () => {
  const angularJson = { projects: { app: { root: "", architect: { build: { options: { assets: [{ glob: "**/*", input: "public" }], styles: ["src/styles.css"] } } } } } };
  const root = project("angular", {
    "package.json": { dependencies: { "@angular/core": "22.0.0", "@scrollframe/element": "*" } },
    "angular.json": angularJson,
    "src/": "",
    "public/": "",
  });
  const { code, stderr } = cli(root, setUp("angular", "public/sequence"));
  assert.equal(code, 0, stderr);
  assert.match(read(root, "src/app/hero-sequence/hero-sequence.ts"), /<scroll-sequence src="\/sequence\/manifest\.json"/);
  assert.deepEqual(JSON.parse(read(root, "angular.json")).projects.app.architect.build.options.styles, [
    "src/styles.css",
    "@scrollframe/element/style.css",
  ]);
});

test("Vue: component, and the vite.config line printed instead of edited", () => {
  const root = project("vue", {
    "package.json": { dependencies: { vue: "3.5.0", "@scrollframe/element": "*" }, devDependencies: { vite: "*", "@vitejs/plugin-vue": "*" } },
    "index.html": "<!doctype html>",
    "vite.config.js": "export default {};\n",
    "src/": "",
    "public/": "",
  });
  const { code, stdout, stderr } = cli(root, setUp("vue", "public/sequence"));
  assert.equal(code, 0, stderr);
  assert.match(read(root, "src/components/HeroSequence.vue"), /<script setup>/);
  assert.match(stdout, /isCustomElement: \(tag\) => tag === "scroll-sequence"/);
  assert.equal(read(root, "vite.config.js"), "export default {};\n");
});

// Deliberately a real install from the public registry: it is the only CI check of the Windows
// shell path in spawnCommand. It installs the published package (not this build), so it checks
// the install mechanics, not the package contents, and needs network access.
test("React: installs @scrollframe/react for real with npm (the Windows shell path in CI)", () => {
  const root = project("react", {
    // Real dev dependencies, because npm install resolves every entry of package.json.
    "package.json": {
      name: "react-sample",
      private: true,
      dependencies: { react: "19.2.0", "react-dom": "19.2.0" },
      devDependencies: { vite: "8.3.8", "@vitejs/plugin-react": "6.3.0" },
    },
    "index.html": "<!doctype html>",
    "src/": "",
  });
  const { code, stdout, stderr } = cli(root, setUp("react", "public/sequence"));
  assert.equal(code, 0, stderr);
  assert.match(stdout, /Install @scrollframe\/react {2}\(npm install @scrollframe\/react\)/);
  assert.ok(JSON.parse(read(root, "package.json")).dependencies["@scrollframe/react"]);
  assert.ok(existsSync(join(root, "node_modules/@scrollframe/react/package.json")));
  assert.ok(existsSync(join(root, "src/components/HeroSequence.jsx")));
});

// A6: what the CLI prints at the end is true in a real build behind a real server.
for (const { name, option, out, url, wrong } of [
  { name: "standard", option: "", out: "public/sequence", url: "/sequence" },
  { name: "base", option: 'base: "/docs/",', out: "public/sequence", url: "/docs/sequence", wrong: "/sequence" },
  { name: "publicDir", option: 'publicDir: "static",', out: "static/sequence", url: "/sequence" },
]) {
  test(`React + Vite, ${name}: builds, and the printed poster and frame URLs return images`, { timeout: 120_000 }, async (t) => {
    // Inside the consumer project, so the build resolves the installed packages.
    const root = mkdtempSync(join(import.meta.dirname, ".scaffold-build-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    copyFileSync(VIDEO, join(root, "hero.mp4"));
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "package.json"), JSON.stringify({ private: true, type: "module", dependencies: { react: "*", "react-dom": "*", vite: "*", "@vitejs/plugin-react": "*", "@scrollframe/react": "*" } }));
    writeFileSync(join(root, "vite.config.js"), `import react from "@vitejs/plugin-react";\nexport default { plugins: [react()], ${option} };\n`);
    writeFileSync(join(root, "index.html"), '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>');
    writeFileSync(join(root, "src/main.jsx"), 'import { createRoot } from "react-dom/client";\nimport Hero from "./components/HeroSequence.jsx";\ncreateRoot(document.getElementById("root")).render(<Hero />);\n');

    const { code, stdout, stderr } = cli(root, ["--yes", "--framework", "react", "-o", out, "--base-url", url]);
    assert.equal(code, 0, stderr);
    const printed = stdout.trimEnd().split("\n").at(-1).match(/\/[^\s,]+\.webp/g);
    assert.equal(printed?.length, 2, stdout);

    const { build, preview } = await import("vite");
    await build({ root, logLevel: "silent" });
    const server = await preview({ root, logLevel: "silent", preview: { host: "127.0.0.1", port: 4300, strictPort: false } });
    t.after(() => new Promise((done) => server.httpServer.close(done)));
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    const isImage = async (path) => {
      // No keep-alive, so the server closes when the test ends.
      const response = await fetch(origin + path, { headers: { connection: "close" } });
      const body = Buffer.from(await response.arrayBuffer());
      return response.status === 200 && body.toString("latin1", 8, 12) === "WEBP";
    };
    for (const path of printed) assert.ok(await isImage(path), `${path} is not an image`);
    if (wrong) assert.equal(await isImage(`${wrong}/desktop/poster.webp`), false);
  });
}
