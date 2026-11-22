import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseManifest } from "@scrollframe/core";
import { afterAll, describe, expect, it } from "vitest";
import { detectProject, parseCommandLine, planScaffold, runCli, setupHint, type GenerateOptions, type ScaffoldPlan } from "../src/index.js";

const scratch = mkdtempSync(join(tmpdir(), "scrollframe-recognise-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

type Files = Record<string, string>;
let count = 0;
function project(files: Files): string {
  const root = join(scratch, `p${++count}`);
  mkdirSync(root);
  for (const [path, contents] of Object.entries(files)) {
    if (path.endsWith("/")) {
      mkdirSync(join(root, path), { recursive: true });
      continue;
    }
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
  return root;
}

const HTML = "<!doctype html><html><body></body></html>";
const pkg = (names: string[], scripts: Record<string, string> = {}): Files => ({
  "package.json": JSON.stringify({ scripts, dependencies: Object.fromEntries(names.map((name) => [name, "*"])) }),
});
const REACT_CONFIG = `import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
})
`;
const viteReact = (...extra: string[]): Files => ({
  ...pkg(["vite", "react", "react-dom", "@vitejs/plugin-react", ...extra]),
  "index.html": HTML,
  "vite.config.ts": REACT_CONFIG,
});
const viteVue = (...extra: string[]): Files => ({
  ...pkg(["vite", "vue", "@vitejs/plugin-vue", ...extra]),
  "index.html": HTML,
  "vite.config.ts": REACT_CONFIG.replace("react from '@vitejs/plugin-react'", "vue from '@vitejs/plugin-vue'").replace("react()", "vue()"),
});
/** A Vite React app whose config is `options` next to the plugin. */
const viteWith = (options: string, top = ""): Files => ({
  ...viteReact(),
  "vite.config.ts": `import react from "@vitejs/plugin-react";\n${top}export default { plugins: [react()], ${options} };\n`,
});
const next = (...extra: string[]): Files => ({ ...pkg(["next", "react", "react-dom", ...extra]), "app/": "" });

const PUBLIC = { glob: "**/*", input: "public" };
function angular(options: object = {}, more: { project?: object; build?: object; workspace?: object } = {}): Files {
  const build = { options: { assets: [PUBLIC], styles: [], ...options }, ...more.build };
  const app = { projectType: "application", root: "", sourceRoot: "src", architect: { build }, ...more.project };
  return {
    ...pkg(["@angular/core"]),
    "angular.json": JSON.stringify({ projects: { app, ...more.workspace } }, null, 2) + "\n",
    "src/": "",
  };
}

/** Runs the CLI: `answers` typed in a terminal (then Ctrl+D), or null for no terminal. */
async function run(cwd: string, answers: string[] | null, argv: string[] = []) {
  let stdout = "";
  let stderr = "";
  let options: GenerateOptions | undefined;
  const commands: string[] = [];
  const questions: string[] = [];
  const left = [...(answers ?? [])];
  const code = await runCli(
    ["hero.mp4", ...argv],
    { stdout: { write: (chunk) => (stdout += chunk) }, stderr: { write: (chunk) => (stderr += chunk) } },
    {
      cwd,
      interactive: answers !== null,
      ask: async (question) => {
        questions.push(question);
        return left.shift() ?? null;
      },
      generate: async (given) => {
        options = given;
        return {
          manifestPath: `${given.out}/manifest.json`,
          bytesBySet: {},
          manifest: parseManifest({
            version: 1,
            frameCount: 2,
            baseUrl: given.baseUrl,
            pattern: "frame-{index}.webp",
            padding: 4,
            poster: "poster.webp",
            sets: [{ name: "desktop", maxViewportWidth: null, width: 96, height: 54, dir: "desktop" }],
          }),
        };
      },
      runCommand: async (command, args) => {
        commands.push([command, ...args].join(" "));
      },
    },
  );
  return { code, stdout, stderr, options, commands, questions, last: stdout.trimEnd().split("\n").at(-1) };
}

const CHECK = (url: string) =>
  `Set-up written. Delivery was not checked: with your site running, open ${url}/desktop/poster.webp and ${url}/desktop/frame-0000.webp, both must show an image.`;
const ASK_STANDARD = "Continue? (Y = yes / e = edit / n = frames only) ";
const ASK_DOUBT = "Set it up like this? (y = yes / e = edit / n = frames only) ";
const ASK_FRAMEWORK = "Framework? (next / react / angular / vue / html, or n = frames only) ";
const EXPLICIT = (framework: string, out = "public/sequence", url = "/sequence") => ["--yes", "--framework", framework, "-o", out, "--base-url", url];

describe("A2: Enter is yes only for a standard project without doubts", () => {
  it.each<[string, string, Files]>([
    ["Next, app", "next", next()],
    ["Next, src/pages", "next", { ...pkg(["next", "react"]), "src/pages/": "" }],
    ["Next, template config", "next", { ...next(), "next.config.ts": 'import type { NextConfig } from "next";\n\nconst nextConfig: NextConfig = {\n  reactStrictMode: true,\n};\n\nexport default nextConfig;\n' }],
    ["Next with react-native-web", "next", next("react-native", "react-native-web")],
    ["Next with a Svelte library", "next", next("svelte")],
    ["Vite React", "react", viteReact()],
    ["Vite React with swc", "react", { ...viteReact("@vitejs/plugin-react-swc"), "vite.config.ts": REACT_CONFIG.replace("plugin-react'", "plugin-react-swc'") }],
    ["Vite React with react-native-web", "react", viteReact("react-native", "react-native-web")],
    ["Vite React with router libraries", "react", viteReact("react-router", "@tanstack/react-router", "preact")],
    ["Vite Vue", "vue", viteVue()],
    ["Vite Vue with Quasar as a library", "vue", viteVue("quasar")],
    ["Vite Vue with VitePress for its docs", "vue", viteVue("vitepress")],
    ["Angular", "angular", angular()],
    ["Angular with src/assets as well", "angular", { ...angular({ assets: [PUBLIC, "src/assets"] }), "src/assets/": "" }],
    ["Angular, explicit output /", "angular", angular({ assets: [{ ...PUBLIC, output: "/" }] })],
    ["static site starting with a comment", "html", { "index.html": `<!-- site -->\n${HTML}` }],
    ["static site", "html", { "index.html": HTML, "style.css": "" }],
    ["static site at a repository top", "html", { "index.html": HTML, ".git/": "" }],
  ])("%s", async (_name, framework, files) => {
    const root = project(files);
    expect(detectProject(root)).toMatchObject({ framework, doubts: [] });
    const { code, stdout, questions, last } = await run(root, [""]);
    expect(questions).toEqual([ASK_STANDARD]);
    expect(code).toBe(0);
    expect(stdout).toContain("Served at:  /sequence");
    expect(stdout).toContain("Created");
    expect(last).toBe(CHECK("/sequence"));
  });
});

describe("A2: everything else needs an explicit answer", () => {
  it.each<[string, Files]>([
    ["empty folder", {}],
    ["React Router", { ...pkg(["react", "react-dom", "vite", "@react-router/dev"]), "app/root.tsx": "", "vite.config.ts": "" }],
    ["TanStack Start", { ...pkg(["react", "react-dom", "vite", "@vitejs/plugin-react", "@tanstack/react-start"]), "src/routes/": "" }],
    ["Gatsby", { ...pkg(["react", "gatsby"]), "src/pages/": "" }],
    ["Docusaurus", { ...pkg(["react", "@docusaurus/core"]), "src/pages/": "" }],
    ["VitePress site", { ...pkg(["vue", "vitepress"]), "docs/index.md": "" }],
    ["SvelteKit with React islands and index.html", { ...viteReact("svelte", "@sveltejs/kit"), "vite.config.ts": "import { sveltekit } from '@sveltejs/kit/vite';\nexport default { plugins: [sveltekit()] };" }],
    ["SvelteKit importing an unused React plugin", { ...viteReact("svelte", "@sveltejs/kit"), "vite.config.ts": "import react from '@vitejs/plugin-react';\nimport { sveltekit } from '@sveltejs/kit/vite';\nexport default { plugins: [sveltekit()] };" }],
    ["React Router with index.html, unused React plugin", { ...viteReact("@react-router/dev"), "vite.config.ts": "import react from '@vitejs/plugin-react';\nimport { reactRouter } from '@react-router/dev/vite';\nexport default { plugins: [reactRouter()] };" }],
    ["working app with a re-exported config", { ...viteReact(), "vite.config.ts": 'export { default } from "./build/vite-config";' }],
    ["Vite without a config", { ...pkg(["vite", "react", "react-dom"]), "index.html": HTML }],
    ["Vite base, concatenated", viteWith('base: "/" + "docs/"')],
    ["Vite base, default", viteWith('base: "/"')],
    ["Vite publicDir in the config it loads", viteWith('publicDir: "static"')],
    ["Next with a commented basePath", { ...next(), "next.config.mjs": "export default {\n  // basePath: '/docs',\n};\n" }],
    ["Vite React, default base", { ...viteReact(), "vite.config.ts": "export default defineConfig({ base: '/', plugins: [react()] })" }],
    ["Vite root, default", viteWith('root: "."')],
    ["Vite base from a spread", viteWith("...shared", 'const shared = { ["ba" + "se"]: "/docs/" };\n')],
    ["Vite base from a computed key", viteWith('["ba" + "se"]: "/docs/"')],
    ["Vite base from the environment", viteWith("build: { outDir: process.env.OUT }")],
    ["Vitest test.root", viteWith('test: { root: "./src" }')],
    ["a comment about base", { ...viteReact(), "vite.config.ts": `${REACT_CONFIG}// set base: "/x/" for staging\n` }],
    ["Vite with another plugin", { ...viteReact(), "vite.config.ts": `import other from "vite-plugin-other";\n${REACT_CONFIG}` }],
    ["Vite with another config file in a script", { ...viteReact(), ...pkg(["vite", "react", "react-dom", "@vitejs/plugin-react"], { build: "vite build --config docs.config.ts" }) }],
    ["Next with a wrapped config", { ...next(), "next.config.mjs": 'import withDocs from "./with-docs.mjs";\nexport default withDocs({});' }],
    ["Angular, ignore", angular({ assets: [{ ...PUBLIC, ignore: ["sequence/**"] }] })],
    ["Hugo with index.html", { "hugo.toml": "", "index.html": HTML, ".git/": "" }],
    ["static site with a <base>", { "index.html": '<!doctype html><base href="/shop/">' }],
    ["Quasar CLI", { ...pkg(["vue", "quasar", "@quasar/app-vite"]), "index.html": HTML }],
    ["Expo", pkg(["react", "react-native", "expo"])],
    ["Electron", viteReact("electron")],
    ["Create React App", { ...pkg(["react", "react-dom", "react-scripts"]), "public/index.html": HTML }],
    ["React with webpack", { ...pkg(["react", "react-dom", "webpack"]), "index.html": HTML }],
    ["Preact", { ...pkg(["vite", "preact"]), "index.html": HTML }],
    ["React and Vue plugins together", viteReact("vue", "@vitejs/plugin-vue")],
    ["Next without app or pages", pkg(["next", "react"])],
    ["Next with basePath", { ...next(), "next.config.ts": 'export default { basePath: "/docs" };' }],
    ["Vite with a base", { ...viteReact(), "vite.config.ts": 'export default defineConfig({ base: "/app/" })' }],
    ["Vite with a root", { ...viteReact(), "vite.config.js": "export default { root: 'client' }" }],
    ["Vite with a publicDir", { ...viteVue(), "vite.config.mts": "export default { publicDir: 'static' }" }],
    ["Vite with a shorthand base", { ...viteVue(), "vite.config.ts": "const base = x;\nexport default defineConfig({ base, plugins: [] })" }],
    ["Vite with --base in a script", { ...pkg(["vite", "vue", "@vitejs/plugin-vue"], { build: "vite build --base=/app/" }), "index.html": HTML }],
    ["Angular, src/assets not created yet", angular({ assets: ["src/favicon.ico", "src/assets"] })],
    ["Angular, another folder at /", { ...angular({ assets: [{ glob: "**/*", input: "web-assets", output: "/" }] }), "src/assets/": "" }],
    ["Angular, public/ under another URL", angular({ assets: [{ ...PUBLIC, output: "/static" }] })],
    ["Angular, only some of public/", angular({ assets: [{ ...PUBLIC, glob: "*.ico" }] })],
    ["Angular with a baseHref", angular({ baseHref: "/app/" })],
    ["Angular, baseHref in a configuration", angular({}, { build: { configurations: { production: { baseHref: "/app/" } } } })],
    ["Angular with <base href=/app/>", { ...angular(), "src/index.html": '<!doctype html><base href="/app/">' }],
    ["Angular with translated builds", angular({}, { project: { i18n: { locales: { fr: "fr.xlf" } } } })],
    ["Angular workspace with two projects", angular({}, { workspace: { lib: { projectType: "library" } } })],
    ["Angular, unreadable angular.json", { ...pkg(["@angular/core"]), "angular.json": "{ // comment\n}" }],
    ["Laravel", { artisan: "", "composer.json": "{}", "public/index.php": "" }],
    ["Laravel with Inertia", { artisan: "", ...pkg(["vite", "react", "react-dom", "@vitejs/plugin-react"]), "public/index.php": "" }],
    ["Laravel with Inertia and a stray index.html", { artisan: "", ...viteReact() }],
    ["Symfony", { "composer.json": "{}", "bin/console": "", "public/index.php": "" }],
    ["Django", { "manage.py": "import django" }],
    ["Flask, import flask", { "app.py": "import flask\napp = flask.Flask(__name__)\n" }],
    ["Flask factory", { "flaskr/__init__.py": "from flask import Flask", "pyproject.toml": "" }],
    ["Flask with a stray index.html", { "app.py": "", "index.html": HTML }],
    ["Rails", { Gemfile: "", "config/application.rb": "", "public/404.html": HTML }],
    ["Hugo", { "config.toml": "", "content/": "", "layouts/": "" }],
    ["Jekyll", { Gemfile: "", "index.html": "---\nlayout: home\n---\n" }],
    ["template with a doctype", { "index.html": "<!doctype html>{% block body %}{% endblock %}" }],
    ["WordPress", { "wp-load.php": "", "index.php": "" }],
    ["WordPress with a stray index.html", { "wp-load.php": "", "index.php": "", "index.html": HTML }],
    ["WordPress theme", { "style.css": "/* Theme Name: Story */", "functions.php": "", "index.php": "" }],
    ["WordPress with Bedrock", { "composer.json": "{}", "web/wp/wp-load.php": "" }],
    ["PHP", { "index.php": "<?php" }],
    ["Spring Boot", { "pom.xml": "", "src/main/resources/static/index.html": HTML }],
    ["ASP.NET", { "Site.csproj": "", "index.html": HTML }],
    ["an index.html that is not a page", { "index.html": "hello" }],
  ])("%s", async (_name, files) => {
    const root = project(files);
    const info = detectProject(root);
    expect(info.framework === null || info.doubts!.length > 0).toBe(true);

    const { code, questions, options, commands, stdout } = await run(root, ["", ""]);
    const question = info.framework === null ? ASK_FRAMEWORK : ASK_DOUBT;
    expect(questions).toEqual([question, question, question]);
    expect(code).toBe(1);
    expect(options).toBeUndefined();
    expect(commands).toEqual([]);
    expect(stdout).toContain("Cancelled. Nothing was changed.");
  });

  it.each<[string, Files, string]>([
    ["Laravel views", { artisan: "", "composer.json": "{}", "resources/views/": "" }, "resources/views"],
    ["Django templates", { "manage.py": "", "templates/index.html": HTML }, "templates"],
    ["a WordPress theme with an index.html", { "wp-load.php": "", "index.php": "", "wp-content/themes/t/index.html": HTML }, "wp-content/themes/t"],
    ["a folder of a JavaScript project", { ...pkg([]), "site/index.html": HTML }, "site"],
    ["a subfolder of a static site", { "index.html": HTML, "promo/index.html": HTML }, "promo"],
  ])("a subfolder of another project: %s", (_name, files, folder) => {
    const info = detectProject(join(project(files), folder));
    expect(info.framework === null || info.doubts!.length > 0).toBe(true);
  });

  it("says what to check", async () => {
    const { stdout } = await run(project({ ...next(), "next.config.ts": 'export default { basePath: "/docs" };' }), []);
    expect(stdout).toContain("Check before answering:\n  - next.config.ts mentions basePath");
  });
});

describe("A1: correct or decline the suggestion", () => {
  it("n generates only the frames and says how to set up later", async () => {
    const root = project(next());
    const { code, stdout, commands, last } = await run(root, ["n"]);
    expect(code).toBe(0);
    expect(commands).toEqual([]);
    expect(stdout).not.toContain("Created");
    expect(last).toBe("Not set up: only the frames were generated.");
  });

  it("e corrects framework, folder and URL, then needs an explicit yes", async () => {
    const root = project(viteReact());
    const { questions, options, stdout, commands, last } = await run(root, ["e", "vue", "static/hero", "/media/hero/", "", "y"]);
    expect(questions).toEqual([
      ASK_STANDARD,
      "Framework (next / react / angular / vue / html) [react]: ",
      "Frames folder [public/sequence]: ",
      "URL where that folder is served: ",
      ASK_DOUBT,
      ASK_DOUBT,
    ]);
    expect(options).toMatchObject({ out: "static/hero", baseUrl: "/media/hero" });
    expect(commands).toEqual(["npm install @scrollframe/element"]);
    expect(stdout).toContain("Created src/components/HeroSequence.vue");
    expect(last).toBe(CHECK("/media/hero"));
  });

  it("keeps the values that are left empty when editing", async () => {
    const { options, questions } = await run(project(next()), ["e", "", "", "", "y"]);
    expect(questions[3]).toBe("URL where that folder is served [/sequence]: ");
    expect(options).toMatchObject({ out: "public/sequence", baseUrl: "/sequence" });
  });

  it("asks an unknown project for its framework, then for confirmation", async () => {
    const { questions, stdout } = await run(project({ "index.php": "<?php" }), ["wordpress", "html", "y"]);
    expect(questions).toEqual([ASK_FRAMEWORK, ASK_FRAMEWORK, ASK_DOUBT]);
    expect(stdout).toContain("Created hero-sequence.html");
  });

  it("needs the URL to be typed when it cannot be derived", async () => {
    const root = project(next());
    const { questions, options } = await run(root, ["y", "", "/assets", "y"], ["-o", "assets"]);
    const url = "URL where that folder is served: ";
    expect(questions).toEqual([ASK_DOUBT, url, url, ASK_DOUBT]);
    expect(options!.baseUrl).toBe("/assets");
  });

  it("asks again for a URL that cannot go into code or markup", async () => {
    const bad = ['/x"><script>', "//host/x", "relative", "/", "/a b", "/a,b"];
    const { questions, options } = await run(project(next()), ["y", ...bad, "/ok", "y"], ["-o", "assets"]);
    expect(questions).toHaveLength(bad.length + 3);
    expect(options!.baseUrl).toBe("/ok");
  });

  it.each([
    ["at the confirmation", []],
    ["while editing the framework", ["e"]],
    ["while editing the URL", ["e", "", ""]],
  ])("the end of input %s changes nothing", async (_when, answers) => {
    const { code, options } = await run(project(next()), answers);
    expect(code).toBe(1);
    expect(options).toBeUndefined();
  });

  it("an explicit --framework is kept, also when detection agrees (F4)", async () => {
    const { options, stdout } = await run(project(next()), ["y", "/assets", "y"], ["--framework", "next", "-o", "assets"]);
    expect(options!.baseUrl).toBe("/assets");
    expect(stdout).toContain("Created");
  });

  it("a framework that was not detected needs an explicit yes", async () => {
    const { questions } = await run(project(next()), ["y"], ["--framework", "vue"]);
    expect(questions).toEqual([ASK_DOUBT]);
  });
});

describe("A3: --yes", () => {
  it.each<[string, Files]>([
    ["standard", next()],
    ["doubtful", viteWith('base: "/docs/"')],
    ["unknown", { "index.php": "" }],
  ])("alone only generates frames: %s", async (_name, files) => {
    const { code, stdout, commands, questions, last } = await run(project(files), null, ["--yes"]);
    expect(code).toBe(0);
    expect(questions).toEqual([]);
    expect(commands).toEqual([]);
    expect(stdout).not.toContain("Created");
    expect(last).toBe("Not set up: --yes alone only generates the frames.");
  });

  it("alone does not ask in a terminal either", async () => {
    const { questions, commands } = await run(project(next()), [], ["--yes"]);
    expect(questions).toEqual([]);
    expect(commands).toEqual([]);
  });

  it.each([
    [["--framework", "next"], "-o and --base-url"],
    [["--framework", "next", "-o", "public/s"], "--base-url"],
    [["--framework", "next", "--base-url", "/s"], "-o"],
    [["--name", "Intro"], "--framework, -o and --base-url"],
    [["--no-install"], "--framework, -o and --base-url"],
  ])("%j is incomplete: exit 2 before any change", async (flags, missing) => {
    const { code, stderr, options } = await run(project(next()), null, ["--yes", ...flags]);
    expect(code).toBe(2);
    expect(stderr).toBe(`Setting up with --yes also needs ${missing}. Nothing was changed.\n`);
    expect(options).toBeUndefined();
  });

  it.each<[string, Files, string]>([
    ["standard", next(), "next"],
    ["doubtful", viteWith('base: "/docs/"'), "react"],
    ["unknown", { "index.php": "" }, "html"],
  ])("with the three values sets up: %s", async (_name, files, framework) => {
    const { code, stdout, questions, last } = await run(project(files), null, EXPLICIT(framework, "public/s", "/docs/s"));
    expect(code).toBe(0);
    expect(questions).toEqual([]);
    expect(stdout).toContain("Created");
    expect(last).toBe(CHECK("/docs/s"));
  });

  it("refuses a URL that cannot go into code or markup", async () => {
    const { code, stderr, options } = await run(project(next()), null, EXPLICIT("next", "public/s", '/x"><script>'));
    expect(code).toBe(2);
    expect(stderr).toContain("--base-url must be");
    expect(options).toBeUndefined();
  });
});

describe("the URL and the import", () => {
  it.each<[string, Files, string, string]>([
    ["HTML", { "index.html": HTML }, "media/hero", "/media/hero"],
    ["HTML with ./", { "index.html": HTML }, "./media/hero/", "/media/hero"],
    ["HTML with a space", { "index.html": HTML }, "media/my hero", "/media/my%20hero"],
    ["Vite", viteVue(), "public/media/hero", "/media/hero"],
    ["Vite with ..", viteVue(), "public/a/../hero", "/hero"],
  ])("%s: -o %s", async (_name, files, out, url) => {
    const { options, last } = await run(project(files), [""], ["-o", out]);
    expect(options).toMatchObject({ out, baseUrl: url });
    expect(last).toBe(CHECK(url));
  });

  it.each<[string, Files, string]>([
    ["outside public/", next(), "media/hero"],
    ["public/ itself", next(), "public"],
    ["outside the site", { "index.html": HTML }, "../hero"],
  ])("has no default when -o is %s", async (_name, files, out) => {
    const { questions, stdout } = await run(project(files), [], ["-o", out]);
    expect(questions).toEqual([ASK_DOUBT]);
    expect(stdout).toContain("Served at:  unknown");
  });

  it("trusts an explicit --base-url", async () => {
    const { options, stdout } = await run(project(next()), null, EXPLICIT("next", "cdn/hero", "https://cdn.example/hero"));
    expect(options!.baseUrl).toBe("https://cdn.example/hero");
    expect(stdout).toContain("Created");
  });

  it("plain HTML says that its URL assumes the site root", async () => {
    expect((await run(project({ "index.html": HTML }), [""])).stdout).toContain("That URL assumes this folder is the site root");
  });

  it("plain HTML does not say it when --base-url is given", async () => {
    expect((await run(project({ "index.html": HTML }), ["y"], ["--base-url", "/shop/sequence"])).stdout).not.toContain("site root");
  });

  it("plain HTML keeps frames next to index.html even with a public/ folder", async () => {
    const { options } = await run(project({ "index.html": HTML, "public/": "" }), [""]);
    expect(options).toMatchObject({ out: "sequence", baseUrl: "/sequence" });
  });

  it.each([
    [".", "../manifest.json"],
    ["./", "../manifest.json"],
    ["public/hero", "../public/hero/manifest.json"],
    ['public/it"s', '../public/it\\"s/manifest.json'],
  ])("-o %s imports %s (F5)", async (out, specifier) => {
    const root = project(next());
    await run(root, null, EXPLICIT("next", out, "https://cdn.example/frames"));
    expect(readFileSync(join(root, "components/HeroSequence.jsx"), "utf8")).toContain(`import manifest from "${specifier}";`);
  });

  it("imports relatively when -o is absolute", async () => {
    const root = project(next());
    await run(root, null, EXPLICIT("next", join(root, "public/hero"), "/hero"));
    expect(readFileSync(join(root, "components/HeroSequence.jsx"), "utf8")).toContain('from "../public/hero/manifest.json"');
  });

  it.each<[string, Files]>([
    ["Gatsby", pkg(["react", "gatsby"])],
    ["Docusaurus", pkg(["react", "@docusaurus/core"])],
    ["SvelteKit", pkg(["svelte", "@sveltejs/kit"])],
    ["Hugo", { "hugo.toml": "" }],
    ["Hugo, config.toml", { "config.toml": "", "content/": "" }],
  ])("%s: the frames go to static/, not to the build folder", async (_name, files) => {
    expect((await run(project({ ...files, "public/": "" }), ["n"])).options!.out).toBe("static/sequence");
    expect((await run(project({ ...files, "public/": "" }), null, ["--yes"])).options!.out).toBe("static/sequence");
  });
});

describe("A4: the last line is the outcome", () => {
  it("a component that could not be written is not a set-up (F7)", async () => {
    const root = project({ ...pkg(["react"]), components: "a file" });
    const { code, last } = await run(root, null, EXPLICIT("react"));
    expect(code).toBe(1);
    expect(last).toBe("Set-up incomplete: components/HeroSequence.jsx was not written.");
  });

  it("a component that already existed is not claimed as written", async () => {
    const root = project({ ...next(), "components/HeroSequence.jsx": "// mine" });
    const { code, last } = await run(root, [""]);
    expect(code).toBe(0);
    expect(last).toBe("Frames written; components/HeroSequence.jsx already existed and was left as it was: check that it loads them from /sequence.");
  });
});

describe("A5: the printed retry works as written", () => {
  /** The argv of the printed command. */
  function retry(stdout: string): string[] {
    const line = stdout.split("\n").find((text) => text.startsWith("  npx @scrollframe/cli "))!;
    const words = line.slice("  npx @scrollframe/cli ".length).match(/"[^"]*"|\S+/g)!;
    return words.map((word) => word.replace(/^"|"$/g, ""));
  }

  it("a standard project gets the complete command, with its own options", async () => {
    const root = project(next());
    const first = await run(root, null, ["--yes", "--frames", "6", "--widths", "80,160,320"]);
    const [video, ...argv] = retry(first.stdout);
    expect(video).toBe("hero.mp4");
    const parsed = parseCommandLine([video!, ...argv]);
    if (parsed === "help") throw new Error("help");
    expect(parsed.generate).toMatchObject({ force: true, frames: 6, widths: [80, 160, 320], out: "public/sequence", baseUrl: "/sequence" });
    const second = await run(root, null, argv);
    expect(second.code).toBe(0);
    expect(second.last).toBe(CHECK("/sequence"));
  });

  it("a doubtful project gets a command that asks, never a guessed consent", async () => {
    const root = project({ "index.php": "" });
    const first = await run(root, null, ["--yes"]);
    const [, ...argv] = retry(first.stdout);
    expect(argv).toContain("--force");
    expect(argv).not.toContain("--yes");
    expect((await run(root, ["html", "y"], argv)).stdout).toContain("Created");
  });

  it("a recognised project with a doubt gets no complete command either", async () => {
    const root = project({ ...next(), "next.config.ts": 'export default { basePath: "/docs" };' });
    const [, ...argv] = retry((await run(root, null, ["--yes"])).stdout);
    expect(argv).toContain("--force");
    expect(argv).not.toContain("--yes");
  });

  it("does not print a command it cannot quote", async () => {
    const { stdout } = await run(project(next()), null, ["--yes", "-o", "public/$HOME"]);
    expect(stdout).not.toContain("  npx @scrollframe/cli ");
    expect(stdout).toContain("run the same command again in a terminal, without --yes and with --force");
  });
});

describe("without a terminal", () => {
  it("keeps the folder and says the example may not apply", async () => {
    const { code, options, stdout } = await run(project(pkg(["react", "gatsby"])), null);
    expect(code).toBe(0);
    expect(options!.out).toBe("public/sequence");
    expect(stdout).toContain(
      "Note: Gatsby is not supported yet, so the example above may not work in this project. It serves static files from static/: use -o static/sequence.",
    );
  });

  it("says so for a project it does not recognise", async () => {
    const { stdout } = await run(project({ "index.php": "" }), null);
    expect(stdout).toContain("Note: this project was not recognised, so the example above may not work in it.");
  });

  it("resolves the -o before advising static/", async () => {
    const root = project({ ...pkg(["react", "gatsby"]), "static/": "" });
    expect((await run(root, null, ["-o", "static/../public/sequence"])).stdout).toContain("use -o static/sequence");
    expect((await run(root, null, ["-o", join(root, "static/sequence")])).stdout).not.toContain("use -o");
  });
});

describe("files that are not regular files", () => {
  const posixIt = it.skipIf(process.platform === "win32");
  posixIt.each<[string, Files]>([
    ["plugin.php", {}],
    ["index.html", {}],
    ["vite.config.ts", { ...pkg(["vite", "vue", "@vitejs/plugin-vue"]), "index.html": HTML }],
    ["angular.json", pkg(["@angular/core"])],
    ["next.config.ts", next()],
    ["app/globals.css", next()],
    ["package.json", {}],
  ])("never waits on a FIFO named %s", async (name, files) => {
    const root = project(files);
    expect(spawnSync("mkfifo", [join(root, name)]).status).toBe(0);
    expect((await run(root, null, ["--yes"])).code).toBe(0);
  });
});

describe("plain HTML loads an element version that exists", () => {
  it("uses the version of @scrollframe/element, not of the CLI", async () => {
    const element = JSON.parse(readFileSync(new URL("../../element/package.json", import.meta.url), "utf8")) as { version: string };
    const root = project({ "index.html": HTML });
    await run(root, [""]);
    const minor = element.version.split(".").slice(0, 2).join(".");
    expect(readFileSync(join(root, "hero-sequence.html"), "utf8")).toContain(`@scrollframe/element@${minor}/dist/scroll-sequence.css`);
  });
});

describe("exported API stays compatible with 0.3.0", () => {
  it("setupHint still takes just a project, and a plan needs no closing lines", () => {
    const info = detectProject(project(next()));
    expect(setupHint(info)).toContain("Tip:");
    const generate = { input: "hero.mp4", out: "public/sequence", baseUrl: "/sequence", frames: 2, quality: 80, widths: [1, 2, 3], lossless: false, force: false } as GenerateOptions;
    const plan: ScaffoldPlan = { project: info, framework: null, generate, install: null, component: null, edits: [], notes: [] };
    expect(plan.notes).toEqual([]);
    expect(planScaffold(info, generate, { yes: true, install: true, outGiven: false, baseUrlGiven: false }).framework).toBe("next");
  });
});

describe("RunDeps.confirm from 0.3.0 still works, without authorizing a guess", () => {
  it.each<[string, Files, boolean, number, boolean]>([
    ["standard, yes", next(), true, 0, true],
    ["standard, no", next(), false, 1, false],
    ["doubtful, yes", { ...next(), "next.config.ts": 'export default { basePath: "/docs" };' }, true, 0, false],
    ["unknown, yes", { "index.php": "" }, true, 0, false],
  ])("%s", async (_name, files, answer, expected, installs) => {
    const commands: string[] = [];
    const questions: string[] = [];
    let generated = false;
    const silent = { write: () => true };
    const code = await runCli(["hero.mp4"], { stdout: silent, stderr: silent }, {
      cwd: project(files),
      interactive: true,
      confirm: async (question) => {
        questions.push(question);
        return answer;
      },
      generate: async (given) => {
        generated = true;
        const manifest = parseManifest({ version: 1, frameCount: 2, baseUrl: given.baseUrl, pattern: "frame-{index}.webp", padding: 4, poster: "poster.webp", sets: [{ name: "desktop", maxViewportWidth: null, width: 96, height: 54, dir: "desktop" }] });
        return { manifestPath: `${given.out}/manifest.json`, bytesBySet: {}, manifest };
      },
      runCommand: async (command) => {
        commands.push(command);
      },
    });
    expect(questions).toEqual(["Continue? (Y/n) "]);
    expect(code).toBe(expected);
    expect(generated).toBe(answer);
    expect(commands.length > 0).toBe(installs);
  });
});
