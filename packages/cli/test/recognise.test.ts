import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseManifest } from "@scrollframe/core";
import { afterAll, describe, expect, it } from "vitest";
import { detectProject, planScaffold, runCli, setupHint, type GenerateOptions, type ScaffoldPlan } from "../src/index.js";

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
const viteReact = (...extra: string[]): Files => ({
  ...pkg(["vite", "react", "react-dom", "@vitejs/plugin-react", ...extra]),
  "index.html": HTML,
});
const viteVue = (...extra: string[]): Files => ({ ...pkg(["vite", "vue", "@vitejs/plugin-vue", ...extra]), "index.html": HTML });
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

async function run(cwd: string, argv: string[] = ["--yes"]) {
  let stdout = "";
  let options: GenerateOptions | undefined;
  const commands: string[] = [];
  const code = await runCli(
    ["hero.mp4", ...argv],
    { stdout: { write: (chunk) => (stdout += chunk) }, stderr: { write: () => true } },
    {
      cwd,
      interactive: false,
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
  return { code, stdout, options: options!, commands, last: stdout.trimEnd().split("\n").at(-1) };
}

describe("set up: positively recognised projects", () => {
  it.each<[string, string, Files]>([
    ["Next, app", "next", next()],
    ["Next, src/pages", "next", { ...pkg(["next", "react"]), "src/pages/": "" }],
    ["Next with react-native-web", "next", next("react-native", "react-native-web")],
    ["Next with a Svelte library", "next", next("svelte")],
    ["Next with a commented basePath", "next", { ...next(), "next.config.mjs": "export default {\n  // basePath: '/docs',\n};\n" }],
    ["Vite React", "react", viteReact()],
    ["Vite React with swc", "react", { ...pkg(["vite", "react", "react-dom", "@vitejs/plugin-react-swc"]), "index.html": HTML }],
    ["Vite React with react-native-web", "react", viteReact("react-native", "react-native-web")],
    ["Vite React with react-router", "react", viteReact("react-router", "@tanstack/react-router", "preact")],
    ["Vite React, default base", "react", { ...viteReact(), "vite.config.ts": "export default defineConfig({ base: '/', plugins: [react()] })" }],
    ["Vite Vue", "vue", viteVue()],
    ["Vite Vue with Quasar as a library", "vue", viteVue("quasar", "@quasar/vite-plugin")],
    ["Vite Vue with VitePress for its docs", "vue", viteVue("vitepress")],
    ["Angular", "angular", angular()],
    ["Angular, explicit output /", "angular", angular({ assets: [{ ...PUBLIC, output: "/" }] })],
    ["Angular with src/assets as well", "angular", { ...angular({ assets: [PUBLIC, "src/assets"] }), "src/assets/": "" }],
    ["static site", "html", { "index.html": HTML, "style.css": "" }],
    ["static site starting with a comment", "html", { "index.html": `<!-- site -->\n${HTML}` }],
    ["static site at a repository top", "html", { "index.html": HTML, ".git/": "" }],
  ])("%s -> %s", (_name, framework, files) => {
    expect(detectProject(project(files))).toMatchObject({ framework, unsupported: null });
  });
});

describe("not set up: everything else", () => {
  it.each<[string, Files]>([
    ["empty folder", {}],
    ["React Router", { ...pkg(["react", "react-dom", "vite", "@react-router/dev"]), "app/root.tsx": "", "vite.config.ts": "" }],
    ["TanStack Start", { ...pkg(["react", "react-dom", "vite", "@vitejs/plugin-react", "@tanstack/react-start"]), "src/routes/": "" }],
    ["Gatsby", { ...pkg(["react", "gatsby"]), "src/pages/": "" }],
    ["Docusaurus", { ...pkg(["react", "@docusaurus/core"]), "src/pages/": "" }],
    ["VitePress site", { ...pkg(["vue", "vitepress"]), "docs/index.md": "" }],
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
    expect(detectProject(root).framework).toBeNull();
    const { code, stdout, commands, last } = await run(root);
    expect(code).toBe(0);
    expect(commands).toEqual([]);
    expect(stdout).not.toContain("Created");
    expect(stdout).not.toContain("Updated");
    expect(last).toMatch(/^Not set up: /);
  });

  it.each<[string, Files, string]>([
    ["Laravel views", { artisan: "", "composer.json": "{}", "resources/views/": "" }, "resources/views"],
    ["Django templates", { "manage.py": "", "templates/index.html": HTML }, "templates"],
    ["a WordPress theme with an index.html", { "wp-load.php": "", "index.php": "", "wp-content/themes/t/index.html": HTML }, "wp-content/themes/t"],
    ["a folder of a JavaScript project", { ...pkg([]), "site/index.html": HTML }, "site"],
    ["a subfolder of a static site", { "index.html": HTML, "promo/index.html": HTML }, "promo"],
  ])("a subfolder of another project: %s", (_name, files, folder) => {
    expect(detectProject(join(project(files), folder)).framework).toBeNull();
  });

  it("says why, and how to force it", async () => {
    const { stdout, last } = await run(project({ ...next(), "next.config.ts": 'export default { basePath: "/docs" };' }));
    expect(stdout).toContain("Project: not recognised");
    expect(stdout).toContain(
      "This project was not recognised (next.config.ts sets basePath): only the frames will be generated. " +
        "To force the set-up use --framework next|react|angular|vue|html, with -o and --base-url set to where the site serves the frames.",
    );
    expect(last).toBe("Not set up: this project was not recognised. Only the frames were generated.");
  });

  it.each<[string, Files]>([
    ["Gatsby", pkg(["react", "gatsby"])],
    ["Docusaurus", pkg(["react", "@docusaurus/core"])],
    ["SvelteKit", pkg(["svelte", "@sveltejs/kit"])],
    ["Hugo", { "hugo.toml": "" }],
    ["Hugo, config.toml", { "config.toml": "", "content/": "" }],
  ])("%s: with --yes the frames go to static/, not to the build folder", async (_name, files) => {
    const { options } = await run(project({ ...files, "public/": "" }));
    expect(options).toMatchObject({ out: "static/sequence", baseUrl: "/sequence" });
  });
});

describe("--framework forces the set-up", () => {
  it("sets up an unrecognised project and says it was not checked", async () => {
    const root = project({ "index.php": "<?php" });
    const { stdout, last } = await run(root, ["--yes", "--framework", "html"]);
    expect(readFileSync(join(root, "hero-sequence.html"), "utf8")).toContain("<scroll-sequence");
    expect(stdout).not.toContain("Not set up");
    expect(last).toBe(
      "Set up as plain HTML because of --framework, without checking the project: make sure sequence/ is served at /sequence, or run it again with --base-url.",
    );
  });

  it("does not repeat that when the detection agrees", async () => {
    const { stdout } = await run(project(next()), ["--yes", "--framework", "next"]);
    expect(stdout).not.toContain("without checking");
  });
});

describe("the URL of the frames", () => {
  it.each<[string, Files, string, string]>([
    ["HTML", { "index.html": HTML }, "media/hero", "/media/hero"],
    ["HTML with ./", { "index.html": HTML }, "./media/hero/", "/media/hero"],
    ["HTML with a space", { "index.html": HTML }, "media/my hero", "/media/my%20hero"],
    ["Vite", viteVue(), "public/media/hero", "/media/hero"],
    ["Vite with ..", viteVue(), "public/a/../hero", "/hero"],
  ])("%s: -o %s", async (_name, files, out, url) => {
    const { options } = await run(project(files), ["--yes", "-o", out]);
    expect(options).toMatchObject({ out, baseUrl: url });
  });

  it.each<[string, Files, string]>([
    ["outside public/", next(), "media/hero"],
    ["public/ itself", next(), "public"],
    ["outside the site", { "index.html": HTML }, "../hero"],
  ])("sets nothing up when -o is %s", async (_name, files, out) => {
    const { commands, stdout, last } = await run(project(files), ["--yes", "-o", out]);
    expect(commands).toEqual([]);
    expect(stdout).not.toContain("Created");
    expect(last).toMatch(/^Not set up: /);
  });

  it("trusts an explicit --base-url", async () => {
    const { options, stdout } = await run(project(next()), ["--yes", "-o", "cdn/hero", "--base-url", "https://cdn.example/hero"]);
    expect(options.baseUrl).toBe("https://cdn.example/hero");
    expect(stdout).toContain("Created");
  });

  it("imports the manifest relatively when -o is absolute", async () => {
    const root = project({ ...next() });
    await run(root, ["--yes", "-o", join(root, "public/hero")]);
    expect(readFileSync(join(root, "components/HeroSequence.jsx"), "utf8")).toContain('from "../public/hero/manifest.json"');
  });

  it("plain HTML keeps frames next to index.html even with a public/ folder", async () => {
    const { options } = await run(project({ "index.html": HTML, "public/": "" }));
    expect(options).toMatchObject({ out: "sequence", baseUrl: "/sequence" });
  });

  it("plain HTML repeats at the end that it assumes the site root, without guessing another URL", async () => {
    const { stdout, last } = await run(project({ "index.html": HTML }), ["--yes", "-o", "media/hero"]);
    const note =
      "The frames are loaded from /media/hero, which only works if this folder is the site root. Otherwise pass --base-url with the URL where media/hero/ is served; to redo a finished run, add --force and delete the file it created.";
    expect(stdout.split(note)).toHaveLength(3);
    expect(last).toBe(note);
  });

  it("plain HTML does not repeat it when --base-url is given", async () => {
    const { stdout } = await run(project({ "index.html": HTML }), ["--yes", "--base-url", "/shop/sequence"]);
    expect(stdout).not.toContain("site root");
  });
});

describe("without a terminal", () => {
  it("keeps the folder and says the example may not apply", async () => {
    const { code, options, stdout } = await run(project(pkg(["react", "gatsby"])), []);
    expect(code).toBe(0);
    expect(options.out).toBe("public/sequence");
    expect(stdout).toContain(
      "Note: Gatsby is not supported yet, so the example above may not work in this project. It serves static files from static/: use -o static/sequence.",
    );
  });

  it("says so for a project it does not recognise", async () => {
    const { stdout } = await run(project({ "index.php": "" }), []);
    expect(stdout).toContain("Note: this project was not recognised, so the example above may not work in it.");
  });

  it("resolves the -o before advising static/", async () => {
    const root = project({ ...pkg(["react", "gatsby"]), "static/": "" });
    expect((await run(root, ["-o", "static/../public/sequence"])).stdout).toContain("use -o static/sequence");
    expect((await run(root, ["-o", join(root, "static/sequence")])).stdout).not.toContain("use -o");
    expect((await run(root, ["-o", "static/sequence"])).stdout).not.toContain("use -o");
  });
});

describe("files that are not regular files", () => {
  const posixIt = it.skipIf(process.platform === "win32");
  posixIt.each<[string, Files]>([
    ["plugin.php", {}],
    ["index.html", {}],
    ["vite.config.ts", viteVue()],
    ["angular.json", pkg(["@angular/core"])],
    ["next.config.ts", next()],
    ["app/globals.css", next()],
    ["package.json", {}],
  ])("never waits on a FIFO named %s", async (name, files) => {
    const root = project(files);
    expect(spawnSync("mkfifo", [join(root, name)]).status).toBe(0);
    expect((await run(root)).code).toBe(0);
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
