import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseManifest } from "@scrollframe/core";
import { afterAll, describe, expect, it } from "vitest";
import { detectProject, runCli, type GenerateOptions } from "../src/index.js";

const scratch = mkdtempSync(join(tmpdir(), "scrollframe-stacks-"));
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
const deps = (...names: string[]): Files => ({
  "package.json": JSON.stringify({ dependencies: Object.fromEntries(names.map((name) => [name, "*"])) }),
});

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
  return { code, stdout, options: options!, commands };
}

describe("detectProject: stacks that are not supported yet", () => {
  it.each<[string, Files]>([
    ["React Router", deps("react", "react-router", "@react-router/dev")],
    ["TanStack Start", deps("react", "@tanstack/react-start")],
    ["Gatsby", deps("react", "gatsby")],
    ["Docusaurus", deps("react", "@docusaurus/core")],
    ["VitePress", deps("vue", "vitepress")],
    ["Quasar", deps("vue", "quasar")],
    ["Vue CLI", deps("vue", "@vue/cli-service")],
    ["Create React App", deps("react", "react-scripts")],
    ["Analog", deps("@angular/core", "@analogjs/platform")],
    ["Expo", deps("react", "react-native", "expo")],
    ["React Native", deps("react", "react-native")],
    ["Electron", deps("react", "electron")],
    ["Preact", deps("preact")],
    ["Qwik", deps("@builder.io/qwik")],
    ["Eleventy", deps("@11ty/eleventy")],
    ["Angular without a public/ folder", { ...deps("@angular/core"), "src/assets/": "" }],
    ["Laravel", { artisan: "", "public/index.php": "" }],
    ["Laravel", { artisan: "", ...deps("react", "@inertiajs/react") }],
    ["Laravel", { artisan: "", ...deps("vue", "@inertiajs/vue3") }],
    ["Inertia", deps("react", "@inertiajs/react")],
    ["Symfony", { "composer.json": "{}", "bin/console": "" }],
    ["Django", { "manage.py": "#!/usr/bin/env python\nimport django\nos.environ['DJANGO_SETTINGS_MODULE']" }],
    ["Flask", { "app.py": "from flask import Flask\n" }],
    ["Rails", { "config/application.rb": "", Gemfile: "" }],
    ["Hugo", { "hugo.toml": "" }],
    ["Jekyll", { "_config.yml": "", Gemfile: "" }],
    ["Spring Boot", { "pom.xml": "<artifactId>spring-boot-starter-web</artifactId>" }],
    ["Spring Boot", { "build.gradle": "id 'org.springframework.boot'" }],
    ["ASP.NET", { "Site.csproj": "", "wwwroot/": "" }],
    ["WordPress", { "wp-load.php": "" }],
    ["WordPress", { "style.css": "/*\n * Theme Name: Story\n */" }],
    ["WordPress", { "story.php": "<?php\n/**\n * Plugin Name: Story\n */" }],
    ["WordPress", { "style.css": "/*\nTheme Name: Story\n*/", ...deps("react", "@wordpress/scripts") }],
  ])("names %s (%j)", (name, files) => {
    expect(detectProject(project(files))).toMatchObject({ framework: null, unsupported: name });
  });

  it("names WordPress from any folder inside an install or a wp-content", () => {
    const install = project({ "wp-load.php": "", "landing/": "" });
    const content = project({ "wp-content/themes/story/": "" });
    expect(detectProject(join(install, "landing")).unsupported).toBe("WordPress");
    expect(detectProject(join(content, "wp-content/themes/story")).unsupported).toBe("WordPress");
  });
});

describe("detectProject: supported projects that look similar stay supported", () => {
  it.each<[string, Files]>([
    ["react", deps("react", "react-router", "react-router-dom", "vite")],
    ["react", deps("react", "@tanstack/react-router", "vite")],
    ["next", deps("next", "react", "react-native", "react-native-web")],
    ["next", { ...deps("next", "react"), "manage.py": "import django" }],
    ["vue", deps("vue", "vue-router", "vite")],
    ["angular", { ...deps("@angular/core"), "public/": "", "src/assets/": "" }],
    ["react", deps("react", "preact")],
    ["html", { "index.php": "<?php echo 'hi';" }],
    ["html", { "style.css": "body { margin: 0 }", "index.html": "" }],
    ["html", { "manage.py": "print('not a web project')" }],
  ])("%s (%j)", (framework, files) => {
    expect(detectProject(project(files))).toMatchObject({ framework, unsupported: null });
  });
});

describe("runCli: no false success", () => {
  it("installs and writes nothing for an unsupported stack, and ends saying it was not set up", async () => {
    const root = project(deps("react", "@react-router/dev"));
    const { code, stdout, commands } = await run(root);
    expect(code).toBe(0);
    expect(commands).toEqual([]);
    expect(stdout).not.toContain("Created");
    expect(stdout.trimEnd().split("\n").at(-1)).toBe("Not set up: React Router is not supported yet. Only the frames were generated.");
  });

  it.each<[string, Files]>([
    ["Gatsby", deps("react", "gatsby")],
    ["Docusaurus", deps("react", "@docusaurus/core")],
    ["SvelteKit", deps("svelte", "@sveltejs/kit")],
    ["Hugo", { "hugo.toml": "" }],
  ])("%s: frames go to static/, never to its build folder", async (_name, files) => {
    const { options } = await run(project({ ...files, "public/": "" }));
    expect(options).toMatchObject({ out: "static/sequence", baseUrl: "/sequence" });
  });

  it("keeps an explicit -o on those stacks", async () => {
    const { options } = await run(project(deps("react", "gatsby")), ["--yes", "-o", "assets/seq"]);
    expect(options.out).toBe("assets/seq");
  });

  it("keeps --framework as an explicit override", async () => {
    const root = project({ artisan: "", "public/": "" });
    const { stdout } = await run(root, ["--yes", "--framework", "html"]);
    expect(stdout).toContain("Created hero-sequence.html");
    expect(readFileSync(join(root, "hero-sequence.html"), "utf8")).toContain("<scroll-sequence");
    expect(stdout).not.toContain("Not set up");
  });

  it("does not suggest an HTML snippet for a native app", async () => {
    const { stdout } = await run(project(deps("react", "react-native", "expo")));
    expect(stdout).toContain("Expo is not supported yet: only the frames will be generated. scrollframe needs a web page (DOM and canvas).");
    expect(stdout).not.toContain("--framework html");
  });

  it("asks for -o and --base-url where the site decides the URL of static files", async () => {
    const { stdout } = await run(project({ "wp-load.php": "" }));
    expect(stdout).toContain(
      "WordPress is not supported yet: only the frames will be generated. For a plain HTML snippet use --framework html, with -o and --base-url set to where the site serves the frames.",
    );
  });

  it("repeats at the end that plain HTML assumes the site root", async () => {
    const { stdout } = await run(project({ "index.php": "<?php" }));
    const note =
      "The frames are loaded from /sequence, which only works if this folder is the site root. In a subfolder, run it with --base-url, e.g. --base-url /my-folder/sequence.";
    expect(stdout.split(note)).toHaveLength(3);
    expect(stdout.trimEnd().endsWith(note)).toBe(true);
  });

  it("does not warn about the site root when --base-url is given", async () => {
    const { stdout } = await run(project({ "index.php": "<?php" }), ["--yes", "--base-url", "/shop/sequence"]);
    expect(stdout).not.toContain("site root");
  });

  it("without a terminal keeps the folder, and says the React example does not apply", async () => {
    const { code, options, stdout } = await run(project(deps("react", "gatsby")), []);
    expect(code).toBe(0);
    expect(options.out).toBe("public/sequence");
    expect(stdout).toContain(
      "Note: Gatsby is not supported yet, so the example above may not work in this project. It serves static files from static/: use -o static/sequence.",
    );
  });

  it("without a terminal does not repeat -o advice that was followed", async () => {
    const { stdout } = await run(project(deps("react", "gatsby")), ["-o", "static/sequence"]);
    expect(stdout).not.toContain("use -o");
  });
});
