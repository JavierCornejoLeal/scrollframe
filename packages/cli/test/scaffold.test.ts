import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { PassThrough } from "node:stream";
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
  manifest: { frameCount } as GenerateResult["manifest"],
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
    ["...mp4", "ScrollSequenceHero"],
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

  it("stops with exit 2 on a broken package.json before changing anything", async () => {
    const { out, calls, run } = harness(project({ "package.json": "{ broken" }));
    expect(await run("hero.mp4")).toBe(2);
    expect(out.stderr).toMatch(/Could not read .*package\.json/);
    expect(calls.generate).toEqual([]);
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
