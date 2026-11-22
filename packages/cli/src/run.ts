import { mkdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { detectProject } from "./detect.js";
import { readText } from "./files.js";
import { generateSequence } from "./generate.js";
import { spawnCommand } from "./install.js";
import type { SequenceManifest } from "@scrollframe/core";
import { HELP, UsageError, parseCommandLine, type GenerateOptions } from "./options.js";
import { formatPlan, framesOnlyPlan, planScaffold, setupHint, type ScaffoldPlan } from "./scaffold.js";

export interface CliIO {
  stdout: { write(chunk: string): unknown; isTTY?: boolean };
  stderr: { write(chunk: string): unknown };
  /** Read for the confirmation; without it (or without a TTY) the CLI never asks. */
  stdin?: NodeJS.ReadableStream & { isTTY?: boolean };
}

/** Everything runCli touches outside the process, so tests can replace it. */
export interface RunDeps {
  cwd: string;
  /** A person can answer the confirmation. */
  interactive: boolean;
  confirm(question: string): Promise<boolean>;
  generate: typeof generateSequence;
  detect: typeof detectProject;
  /** Runs a command in `cwd` with the output shown; rejects when it fails. */
  runCommand(command: string, args: string[], cwd: string): Promise<void>;
}

function defaultDeps(io: CliIO): RunDeps {
  return {
    cwd: process.cwd(),
    interactive: Boolean(io.stdin?.isTTY && io.stdout.isTTY),
    // Enter or "y" confirms. Ctrl+C, Ctrl+D or the end of input cancel: nothing is changed.
    confirm: (question) =>
      new Promise((resolve) => {
        const output = io.stdout as NodeJS.WritableStream;
        const rl = createInterface({ input: io.stdin!, output });
        let settled = false;
        const settle = (confirmed: boolean) => {
          if (settled) return;
          settled = true;
          rl.close();
          resolve(confirmed);
        };
        rl.on("close", () => settle(false));
        rl.on("SIGINT", () => {
          output.write("\n");
          settle(false);
        });
        rl.question(question, (answer) => {
          const normalized = answer.trim().toLowerCase();
          settle(normalized === "" || normalized === "y" || normalized === "yes");
        });
      }),
    generate: generateSequence,
    detect: detectProject,
    runCommand: spawnCommand,
  };
}

// Import specifiers always use "/", also on Windows where the manifest path uses "\\".
const reactSnippet = (manifestPath: string) =>
  `import manifest from "./${manifestPath.replace(/\\/g, "/")}";\n<ScrollSequence manifest={manifest} alt="Describe the scene" />\n`;

type GenerateOutcome = { ok: true; manifestPath: string; manifest: SequenceManifest } | { ok: false; exitCode: number };

/** Generates the frames, reporting a failure on stderr with its exit code. */
async function runGenerate(options: GenerateOptions, io: CliIO, deps: RunDeps): Promise<GenerateOutcome> {
  try {
    const { manifestPath, manifest } = await deps.generate(options, (line) => io.stdout.write(`${line}\n`));
    io.stdout.write(`\nDone: ${manifest.frameCount} frames -> ${manifestPath}\n\n`);
    return { ok: true, manifestPath, manifest };
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr.write(`${error.message}\n`);
      return { ok: false, exitCode: 2 };
    }
    io.stderr.write(`Unexpected error: ${(error as Error).message}\n`);
    return { ok: false, exitCode: 1 };
  }
}

/** Runs the CLI and resolves with the exit code: 0 ok, 1 unexpected failure or cancelled, 2 usage error. */
export async function runCli(argv: string[], io: CliIO, overrides: Partial<RunDeps> = {}): Promise<number> {
  const deps = { ...defaultDeps(io), ...overrides };
  let parsed;
  try {
    parsed = parseCommandLine(argv);
  } catch (error) {
    io.stderr.write(`${(error as Error).message}\n\n${HELP}`);
    return 2;
  }
  if (parsed === "help") {
    io.stdout.write(HELP);
    return 0;
  }
  const { generate: options, scaffold: flags } = parsed;
  if (options.lossless) {
    io.stderr.write("Warning: --lossless frames are several times heavier and will hurt LCP.\n");
  }

  // Without a person to ask and without --yes: exactly what the CLI always did, plus a hint.
  if (!flags.yes && !deps.interactive) {
    // Set-up options cannot apply here; refuse them instead of silently ignoring them.
    const setupFlag = flags.framework ? "--framework" : flags.name ? "--name" : !flags.install ? "--no-install" : null;
    if (setupFlag) {
      io.stderr.write(`${setupFlag} sets up the project, which needs a terminal to confirm or --yes. Nothing was changed.\n`);
      return 2;
    }
    const result = await runGenerate(options, io, deps);
    if (!result.ok) return result.exitCode;
    io.stdout.write(reactSnippet(result.manifestPath));
    let hint: string | null = null;
    try {
      hint = setupHint(deps.detect(deps.cwd), options.out);
    } catch {
      // A broken package.json must not break generating frames.
    }
    if (hint) io.stdout.write(`\n${hint}`);
    return 0;
  }

  // Like the non-interactive path, an unreadable project must not block the frames: degrade to frames only.
  let plan: ScaffoldPlan;
  try {
    plan = planScaffold(deps.detect(deps.cwd), options, flags);
  } catch (error) {
    // Explicit set-up options cannot apply to a project that cannot be read: refuse, do not drop them.
    const setupFlag = flags.framework ? "--framework" : flags.name ? "--name" : !flags.install ? "--no-install" : null;
    if (setupFlag) {
      io.stderr.write(
        `${(error as Error).message}\n${setupFlag} needs a readable project; fix it or run without set-up options. Nothing was changed.\n`,
      );
      return 2;
    }
    plan = framesOnlyPlan(options, (error as Error).message);
  }
  io.stdout.write(formatPlan(plan));
  if (!flags.yes && !(await deps.confirm("Continue? (Y/n) "))) {
    io.stdout.write("Cancelled. Nothing was changed.\n");
    return 1;
  }

  const result = await runGenerate(plan.generate, io, deps);
  if (!result.ok) return result.exitCode;

  if (plan.install) {
    const { pkg, command, args } = plan.install;
    try {
      await deps.runCommand(command, args, deps.cwd);
    } catch (error) {
      io.stderr.write(
        `Could not install ${pkg} (${(error as Error).message}). The frames are ready; install it with:\n  ${[command, ...args].join(" ")}\n`,
      );
      return 1;
    }
  }

  let exitCode = 0;
  if (plan.component) {
    const { path, render, usage } = plan.component;
    const target = join(deps.cwd, path);
    try {
      mkdirSync(dirname(target), { recursive: true });
      // "wx" fails if the file appeared since the plan was made: never overwrite the user's code.
      writeFileSync(target, render(result.manifest), { flag: "wx" });
      io.stdout.write(`Created ${path}\n\n${usage.join("\n")}\n`);
    } catch (error) {
      // The remaining confirmed steps still run; the exit code reports the failure.
      io.stderr.write(`Could not create ${path}: ${(error as Error).message}\n`);
      exitCode = 1;
    }
  } else if (plan.framework === "next" || plan.framework === "react") {
    io.stdout.write(reactSnippet(result.manifestPath));
  }
  for (const edit of plan.edits) {
    const target = join(deps.cwd, edit.path);
    const current = readText(target); // null: deleted, unreadable or not a file since the plan
    // Only apply the change to the exact file content the user saw in the plan.
    if (current !== edit.before) {
      io.stderr.write(`${edit.path} changed after the plan was made; it was not modified. ${edit.manual}\n`);
      continue;
    }
    try {
      writeFileSync(target, edit.after);
      io.stdout.write(`Updated ${edit.path}\n`);
    } catch (error) {
      io.stderr.write(`Could not update ${edit.path}: ${(error as Error).message}. ${edit.manual}\n`);
      exitCode = 1;
    }
  }
  if (plan.closing?.length) io.stdout.write(`\n${plan.closing.join("\n")}\n`);
  return exitCode;
}
