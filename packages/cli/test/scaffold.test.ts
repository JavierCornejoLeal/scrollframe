import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { parseManifest } from "@scrollframe/core";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { componentName, installCommand, runCli, type GenerateOptions, type GenerateResult, type RunDeps } from "../src/index.js";

const scratch = mkdtempSync(join(tmpdir(), "scrollframe-scaffold-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let count = 0;
function project(files: Record<string, string | object>): string {
  const root = join(scratch, `p${++count}`);
  mkdirSync(root);
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    if (path.endsWith("/")) mkdirSync(full, { recursive: true });
    else writeFileSync(full, typeof contents === "string" ? contents : JSON.stringify(contents));
  }
  return root;
}

/** What generateSequence resolves with, without running ffmpeg. */
const fakeResult = (options: GenerateOptions, frameCount = options.frames): GenerateResult => ({
  manifestPath: join(options.out, "manifest.json"),
  manifest: parseManifest({
    version: 1,
    frameCount,
    baseUrl: options.baseUrl,
    pattern: "frame-{index}.webp",
    padding: 4,
    poster: "poster.webp",
    sets: [{ name: "desktop", maxViewportWidth: null, width: 960, height: 540, dir: "desktop" }],
  }),
  bytesBySet: {},
});

const nextApp = () =>
  project({ "package.json": { dependencies: { next: "16", react: "19" } }, "pnpm-lock.yaml": "", "app/": "", "public/": "" });

function harness(cwd: string, overrides: Partial<RunDeps> = {}) {
  const out = { stdout: "", stderr: "" };
  const calls: { generate: GenerateOptions[]; commands: string[]; questions: string[] } = { generate: [], commands: [], questions: [] };
  const deps: Partial<RunDeps> = {
    cwd,
    interactive: true,
    confirm: async (question) => {
      calls.questions.push(question);
      return true;
    },
    generate: async (options) => {
      calls.generate.push(options);
      return fakeResult(options);
    },
    runCommand: async (command, args) => {
      calls.commands.push([command, ...args].join(" "));
    },
    ...overrides,
  };
  const io = {
    stdout: { write: (chunk: string) => (out.stdout += chunk) },
    stderr: { write: (chunk: string) => (out.stderr += chunk) },
  };
  return { out, calls, run: (...argv: string[]) => runCli(argv, io, deps) };
}

describe("componentName", () => {
  it.each([
    ["hero.mp4", "HeroSequence"],
    ["videos/my intro-video.mov", "MyIntroVideoSequence"],
    ["2024_launch.webm", "Video2024LaunchSequence"],
    ["...mp4", "VideoSequence"],
  ])("%s -> %s", (video, name) => {
    expect(componentName(video)).toBe(name);
  });
});

describe("installCommand", () => {
  it.each([
    ["pnpm", "pnpm add @scrollframe/react"],
    ["yarn", "yarn add @scrollframe/react"],
    ["bun", "bun add @scrollframe/react"],
    ["npm", "npm install @scrollframe/react"],
    [null, "npm install @scrollframe/react"],
  ] as const)("%s -> %s", (manager, command) => {
    const { command: cmd, args } = installCommand(manager, "@scrollframe/react");
    expect([cmd, ...args].join(" ")).toBe(command);
  });
});

describe("runCli scaffold: non-interactive keeps today's behaviour", () => {
  it("only generates the frames, never asks or installs, and adds a hint", async () => {
    const { out, calls, run } = harness(nextApp(), { interactive: false });
    expect(await run("hero.mp4")).toBe(0);
    expect(calls.generate).toHaveLength(1);
    expect(calls.generate[0]!.out).toBe("public/sequence");
    expect(calls.questions).toEqual([]);
    expect(calls.commands).toEqual([]);
    expect(out.stdout).toContain('import manifest from "./public/sequence/manifest.json";');
    expect(out.stdout).toContain("Tip: run it in a terminal, or add --yes, to also set up the component for this Next.js project.");
  });

  it.each([
    [["--framework", "vue"], "--framework"],
    [["--name", "Intro"], "--name"],
    [["--no-install"], "--no-install"],
  ])("refuses %j without a terminal or --yes instead of ignoring it, before generating", async (flags, flag) => {
    const { out, calls, run } = harness(nextApp(), { interactive: false });
    expect(await run("hero.mp4", ...flags)).toBe(2);
    expect(out.stderr).toBe(`${flag} sets up the project, which needs a terminal to confirm or --yes. Nothing was changed.\n`);
    expect(calls.generate).toEqual([]);
  });

  it("does not let a broken package.json break the frames", async () => {
    const { out, calls, run } = harness(project({ "package.json": "{ broken" }), { interactive: false });
    expect(await run("hero.mp4")).toBe(0);
    expect(calls.generate).toHaveLength(1);
    expect(out.stdout).not.toContain("Tip:");
  });
});

describe("runCli scaffold: plan and confirmation", () => {
  it("shows the whole plan, asks once, then generates and installs in that order", async () => {
    const order: string[] = [];
    const { out, calls, run } = harness(nextApp(), {
      generate: async (options) => {
        order.push("generate");
        return fakeResult(options, 120);
      },
      runCommand: async (command, args) => {
        order.push([command, ...args].join(" "));
      },
    });
    expect(await run("hero.mp4")).toBe(0);
    expect(out.stdout).toContain("Project: Next.js (App Router) · JavaScript · pnpm");
    expect(out.stdout).toContain("1. Generate 120 frames in public/sequence/");
    expect(out.stdout).toContain("2. Install @scrollframe/react  (pnpm add @scrollframe/react)");
    expect(calls.questions).toEqual(["Continue? (Y/n) "]);
    expect(order).toEqual(["generate", "pnpm add @scrollframe/react"]);
  });

  it("changes nothing and exits 1 when the answer is no", async () => {
    const { out, calls, run } = harness(nextApp(), { confirm: async () => false });
    expect(await run("hero.mp4")).toBe(1);
    expect(calls.generate).toEqual([]);
    expect(calls.commands).toEqual([]);
    expect(out.stdout).toContain("Cancelled. Nothing was changed.");
  });

  it("--yes runs without asking, even without a terminal", async () => {
    const { calls, run } = harness(nextApp(), { interactive: false });
    expect(await run("hero.mp4", "--yes")).toBe(0);
    expect(calls.questions).toEqual([]);
    expect(calls.commands).toEqual(["pnpm add @scrollframe/react"]);
  });

  it("does not generate or install anything else when the frames fail", async () => {
    const { calls, run } = harness(nextApp(), {
      generate: async () => {
        throw new Error("ffmpeg failed");
      },
    });
    expect(await run("hero.mp4")).toBe(1);
    expect(calls.commands).toEqual([]);
  });

  it("reports a failed install with the command to run by hand, keeping the frames", async () => {
    const { out, run } = harness(nextApp(), {
      runCommand: async () => {
        throw new Error("exit code 1");
      },
    });
    expect(await run("hero.mp4")).toBe(1);
    expect(out.stderr).toContain("Could not install @scrollframe/react (exit code 1). The frames are ready; install it with:\n  pnpm add @scrollframe/react");
  });
});

describe("runCli scaffold: flags and detection", () => {
  it("--no-install leaves the dependencies alone", async () => {
    const { out, calls, run } = harness(nextApp());
    expect(await run("hero.mp4", "--no-install")).toBe(0);
    expect(calls.commands).toEqual([]);
    expect(out.stdout).not.toContain("Install @scrollframe/react");
  });

  it("skips the install when the package is already a dependency", async () => {
    const root = project({ "package.json": { dependencies: { next: "16", react: "19", "@scrollframe/react": "^0.2.0" } }, "app/": "" });
    const { calls, run } = harness(root);
    expect(await run("hero.mp4")).toBe(0);
    expect(calls.commands).toEqual([]);
  });

  it("--framework overrides the detection", async () => {
    const { out, calls, run } = harness(nextApp());
    expect(await run("hero.mp4", "--framework", "vue")).toBe(0);
    expect(out.stdout).toContain("Project: Vue");
    expect(calls.commands).toEqual(["pnpm add @scrollframe/element"]);
  });

  it("rejects an unknown --framework or an invalid --name with exit 2", async () => {
    const a = harness(nextApp());
    expect(await a.run("hero.mp4", "--framework", "svelte")).toBe(2);
    expect(a.out.stderr).toContain("--framework must be one of: next, react, angular, vue, html (got \"svelte\").");
    const b = harness(nextApp());
    expect(await b.run("hero.mp4", "--name", "hero-section")).toBe(2);
    expect(b.out.stderr).toContain('--name must be a PascalCase component name such as HeroSequence (got "hero-section").');
  });

  it("only generates the frames for an unsupported framework, and says why", async () => {
    const root = project({ "package.json": { dependencies: { svelte: "5" } }, "public/": "" });
    const { out, calls, run } = harness(root);
    expect(await run("hero.mp4")).toBe(0);
    expect(out.stdout).toContain("Svelte is not supported yet: only the frames will be generated. Use --framework html for a plain HTML snippet.");
    expect(calls.generate).toHaveLength(1);
    expect(calls.commands).toEqual([]);
  });

  it("puts the frames in sequence/ for a plain HTML site without a public folder", async () => {
    const { calls, run } = harness(project({ "index.html": "" }));
    expect(await run("hero.mp4")).toBe(0);
    expect(calls.generate[0]).toMatchObject({ out: "sequence", baseUrl: "/sequence" });
  });

  it("keeps an explicit -o and --base-url", async () => {
    const { calls, run } = harness(project({ "index.html": "" }));
    expect(await run("hero.mp4", "-o", "static/seq", "--base-url", "/assets/seq")).toBe(0);
    expect(calls.generate[0]).toMatchObject({ out: "static/seq", baseUrl: "/assets/seq" });
  });

  it("still generates the frames with a broken package.json, and says why it skips the set-up", async () => {
    const { out, calls, run } = harness(project({ "package.json": "{ broken" }));
    expect(await run("hero.mp4")).toBe(0);
    expect(out.stdout).toMatch(/Could not read .*package\.json: .*\nOnly the frames will be generated\./);
    expect(calls.generate).toHaveLength(1);
    expect(calls.commands).toEqual([]);
  });
});

describe("runCli scaffold: the real prompt", () => {
  /** A stdin/stdout pair that reports a TTY, so runCli uses its own readline prompt. */
  function tty() {
    const stdin = Object.assign(new PassThrough(), { isTTY: true });
    let written = "";
    const stdout = Object.assign(new PassThrough(), { isTTY: true });
    stdout.on("data", (chunk) => (written += String(chunk)));
    return { stdin, stdout, output: () => written };
  }

  it("treats the end of input (Ctrl+D) as a cancel instead of crashing", async () => {
    const { stdin, stdout, output } = tty();
    const generate = vi.fn();
    const result = runCli(["hero.mp4"], { stdin, stdout, stderr: { write: () => true } }, { cwd: nextApp(), generate });
    setTimeout(() => stdin.end(), 20);
    expect(await result).toBe(1);
    expect(generate).not.toHaveBeenCalled();
    expect(output()).toContain("Cancelled. Nothing was changed.");
  });

  it.each([
    ["\n", 0],
    ["y\n", 0],
    ["n\n", 1],
  ])("answers %j with exit %i", async (answer, code) => {
    const { stdin, stdout } = tty();
    const generate = vi.fn(async (options: GenerateOptions) => fakeResult(options, 6));
    const result = runCli(["hero.mp4", "--no-install"], { stdin, stdout, stderr: { write: () => true } }, { cwd: nextApp(), generate });
    setTimeout(() => stdin.write(answer), 20);
    expect(await result).toBe(code);
    expect(generate).toHaveBeenCalledTimes(code === 0 ? 1 : 0);
  });
});

describe("runCli scaffold: writing the component", () => {
  it("creates the planned component and prints how to use it", async () => {
    const root = nextApp();
    const { out, run } = harness(root);
    expect(await run("hero.mp4")).toBe(0);
    expect(out.stdout).toContain(" 3. Create components/HeroSequence.jsx");
    expect(readFileSync(join(root, "components/HeroSequence.jsx"), "utf8")).toContain("export default function HeroSequence()");
    expect(out.stdout).toContain("Created components/HeroSequence.jsx");
    expect(out.stdout).toContain('  import HeroSequence from "../components/HeroSequence";');
    expect(out.stdout).not.toContain("<ScrollSequence manifest={manifest}");
  });

  it("never overwrites an existing component and says so in the plan", async () => {
    const root = nextApp();
    mkdirSync(join(root, "components"));
    writeFileSync(join(root, "components/HeroSequence.jsx"), "// mine");
    const { out, run } = harness(root);
    expect(await run("hero.mp4")).toBe(0);
    expect(out.stdout).toContain("components/HeroSequence.jsx already exists and will not be changed (use --name to create another one).");
    expect(readFileSync(join(root, "components/HeroSequence.jsx"), "utf8")).toBe("// mine");
  });

  it("does not write the component when the install fails", async () => {
    const root = nextApp();
    const { run } = harness(root, {
      runCommand: async () => {
        throw new Error("exit code 1");
      },
    });
    expect(await run("hero.mp4")).toBe(1);
    expect(existsSync(join(root, "components/HeroSequence.jsx"))).toBe(false);
  });
});

describe("runCli scaffold: fixing a stylesheet that breaks the pinned sequence", () => {
  const HIDDEN = "html,\nbody {\n  max-width: 100vw;\n  overflow-x: hidden;\n}\n";
  const withGlobals = () => {
    const root = nextApp();
    mkdirSync(join(root, "app"), { recursive: true });
    writeFileSync(join(root, "app/globals.css"), HIDDEN);
    return root;
  };

  it("lists the change in the plan and applies it after confirmation", async () => {
    const root = withGlobals();
    const { out, run } = harness(root);
    expect(await run("hero.mp4")).toBe(0);
    expect(out.stdout).toContain(" 4. Change overflow-x: hidden to clip in app/globals.css (it stops the sequence from staying pinned)");
    expect(readFileSync(join(root, "app/globals.css"), "utf8")).toBe(HIDDEN.replace("hidden", "clip"));
    expect(out.stdout).toContain("Updated app/globals.css");
  });

  it("leaves the stylesheet alone when the plan is cancelled", async () => {
    const root = withGlobals();
    const { run } = harness(root, { confirm: async () => false });
    expect(await run("hero.mp4")).toBe(1);
    expect(readFileSync(join(root, "app/globals.css"), "utf8")).toBe(HIDDEN);
  });

  it("does not overwrite a stylesheet that changed after the plan was shown", async () => {
    const root = withGlobals();
    const { out, run } = harness(root, {
      confirm: async () => {
        writeFileSync(join(root, "app/globals.css"), "/* edited meanwhile */\n" + HIDDEN);
        return true;
      },
    });
    expect(await run("hero.mp4")).toBe(0);
    expect(readFileSync(join(root, "app/globals.css"), "utf8")).toBe("/* edited meanwhile */\n" + HIDDEN);
    expect(out.stderr).toContain("app/globals.css changed after the plan was made; it was not modified. Change overflow-x: hidden to clip there yourself.");
  });
});

describe("runCli scaffold: plain HTML", () => {
  it("writes the snippet with the poster of the frames it just generated", async () => {
    const root = project({ "index.html": "<!doctype html>" });
    const { out, run } = harness(root);
    expect(await run("hero.mp4")).toBe(0);
    expect(out.stdout).toContain(" 2. Create hero-sequence.html");
    const snippet = readFileSync(join(root, "hero-sequence.html"), "utf8");
    expect(snippet).toContain('<scroll-sequence src="/sequence/manifest.json"');
    expect(snippet).toContain('src="/sequence/desktop/poster.webp"');
    expect(out.stdout).toContain("Paste the two <head> lines and the <scroll-sequence> block from hero-sequence.html into your page.");
  });
});

describe("runCli scaffold: files that change or fail between the plan and the end", () => {
  const HIDDEN = "html,\nbody {\n  overflow-x: hidden;\n}\n";

  it("notes, instead of crashing, a planned stylesheet that was deleted before it was applied", async () => {
    const root = nextApp();
    writeFileSync(join(root, "app/globals.css"), HIDDEN);
    const { out, run } = harness(root, {
      confirm: async () => {
        rmSync(join(root, "app/globals.css"));
        return true;
      },
    });
    expect(await run("hero.mp4")).toBe(0);
    expect(out.stderr).toContain("app/globals.css changed after the plan was made; it was not modified. Change overflow-x: hidden to clip there yourself.");
  });

  it("plans without the stylesheet step when the stylesheet cannot be read", async () => {
    const root = nextApp();
    mkdirSync(join(root, "app/globals.css")); // a folder where a file is expected
    const { out, run } = harness(root);
    expect(await run("hero.mp4")).toBe(0);
    expect(out.stdout).not.toContain("Change overflow-x");
  });

  it("still applies the stylesheet fix and reports it when the component cannot be created", async () => {
    const root = nextApp();
    writeFileSync(join(root, "app/globals.css"), HIDDEN);
    const { out, run } = harness(root, {
      confirm: async () => {
        mkdirSync(join(root, "components"));
        writeFileSync(join(root, "components/HeroSequence.jsx"), "// appeared meanwhile");
        return true;
      },
    });
    expect(await run("hero.mp4")).toBe(1);
    expect(out.stderr).toMatch(/Could not create components\/HeroSequence\.jsx: /);
    expect(readFileSync(join(root, "app/globals.css"), "utf8")).toContain("overflow-x: clip");
    expect(readFileSync(join(root, "components/HeroSequence.jsx"), "utf8")).toBe("// appeared meanwhile");
  });
});

describe("runCli scaffold: Angular and Vue end to end", () => {
  it("Angular: installs the element, writes the component and adds the stylesheet to angular.json", async () => {
    const angularJson = JSON.stringify({ projects: { app: { architect: { build: { options: { styles: ["src/styles.css"] } } } } } }, null, 2) + "\n";
    const root = project({ "package.json": { dependencies: { "@angular/core": "22" } }, "angular.json": angularJson, "src/": "", "public/": "" });
    const { out, calls, run } = harness(root);
    expect(await run("hero.mp4")).toBe(0);
    expect(calls.commands).toEqual(["npm install @scrollframe/element"]);
    expect(out.stdout).toContain(" 4. Add @scrollframe/element/style.css to the styles in angular.json");
    expect(readFileSync(join(root, "src/app/hero-sequence/hero-sequence.ts"), "utf8")).toContain('selector: "app-hero-sequence"');
    expect(JSON.parse(readFileSync(join(root, "angular.json"), "utf8")).projects.app.architect.build.options.styles).toEqual([
      "src/styles.css",
      "@scrollframe/element/style.css",
    ]);
  });

  it("Vue: writes the component and prints the vite.config line", async () => {
    const root = project({ "package.json": { dependencies: { vue: "3" } }, "src/": "", "public/": "" });
    const { out, run } = harness(root);
    expect(await run("hero.mp4")).toBe(0);
    expect(readFileSync(join(root, "src/components/HeroSequence.vue"), "utf8")).toContain("<scroll-sequence src=");
    expect(out.stdout).toContain("Tell Vue that <scroll-sequence> is a custom element, in vite.config:");
  });
});

describe("runCli scaffold: explicit flags when the project cannot be read", () => {
  it("refuses --framework with an unreadable package.json instead of dropping it", async () => {
    const { out, calls, run } = harness(project({ "package.json": "{ broken" }));
    expect(await run("hero.mp4", "--framework", "vue")).toBe(2);
    expect(out.stderr).toMatch(/^Could not read .*package\.json: .*\n--framework needs a readable project; fix it or run without set-up options\. Nothing was changed\.\n$/);
    expect(calls.generate).toEqual([]);
  });
});
