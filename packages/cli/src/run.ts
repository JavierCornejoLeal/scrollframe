import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { checkDelivery, retryCommand } from "./closing.js";
import { decide } from "./decide.js";
import { detectProject, type ProjectInfo } from "./detect.js";
import { readText } from "./files.js";
import { generateSequence } from "./generate.js";
import { spawnCommand } from "./install.js";
import { createPrompter } from "./prompt.js";
import type { SequenceManifest } from "@scrollframe/core";
import { HELP, UsageError, parseCommandLine, type GenerateOptions, type ScaffoldFlags } from "./options.js";
import { formatPlan, framesOnlyPlan, planScaffold, servingUrl, setupHint, withoutSetup, type ScaffoldPlan } from "./scaffold.js";

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
  /**
   * @deprecated Use `ask`. A yes or no cannot correct or type values, so it only confirms a standard
   * suggestion; for anything else it confirms generating the frames.
   */
  confirm?(question: string): Promise<boolean>;
  /** The answer typed, or null when cancelled. */
  ask?(question: string): Promise<string | null>;
  generate: typeof generateSequence;
  detect: typeof detectProject;
  /** Runs a command in `cwd` with the output shown; rejects when it fails. */
  runCommand(command: string, args: string[], cwd: string): Promise<void>;
}

function defaultDeps(io: CliIO): Omit<RunDeps, "ask"> {
  return {
    cwd: process.cwd(),
    interactive: Boolean(io.stdin?.isTTY && io.stdout.isTTY),
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
  const prompter = createPrompter(io.stdin, io.stdout as NodeJS.WritableStream);
  const deps: RunDeps = { ...defaultDeps(io), ...overrides };
  const ask = overrides.ask ?? prompter.ask;
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
  const setupFlag = flags.framework ? "--framework" : flags.name ? "--name" : !flags.install ? "--no-install" : null;
  if (options.lossless) {
    io.stderr.write("Warning: --lossless frames are several times heavier and will hurt LCP.\n");
  }

  // Without a person to ask and without --yes: exactly what the CLI always did, plus a hint.
  if (!flags.yes && !deps.interactive) {
    // Set-up options cannot apply here; refuse them instead of silently ignoring them.
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

  const write = (text: string) => io.stdout.write(text);

  // --yes sets up only with the three values: a guess is not a consent.
  if (flags.yes && setupFlag) {
    const missing: string[] = [];
    if (!flags.framework) missing.push("--framework");
    if (!flags.outGiven) missing.push("-o");
    if (!flags.baseUrlGiven) missing.push("--base-url");
    if (missing.length > 0) {
      const list = missing.length === 1 ? missing[0] : `${missing.slice(0, -1).join(", ")} and ${missing.at(-1)}`;
      io.stderr.write(`Setting up with --yes also needs ${list}. Nothing was changed.\n`);
      return 2;
    }
  }
  const mightSetUp = flags.yes ? flags.framework !== undefined : true;
  if (mightSetUp && flags.baseUrlGiven && servingUrl(options.baseUrl) === null) {
    io.stderr.write(
      `--base-url must be /path or https://host/path, without spaces, commas or quotes, to set up the project (got "${options.baseUrl}"). Nothing was changed.\n`,
    );
    return 2;
  }

  let project: ProjectInfo | null = null;
  let unreadable = "";
  try {
    project = deps.detect(deps.cwd);
  } catch (error) {
    unreadable = (error as Error).message;
    // Explicit set-up options cannot apply to a project that cannot be read: refuse, do not drop them.
    if (setupFlag) {
      io.stderr.write(
        `${unreadable}\n${setupFlag} needs a readable project; fix it or run without set-up options. Nothing was changed.\n`,
      );
      return 2;
    }
  }

  let chosen: ScaffoldPlan | null = null;
  try {
    if (project === null) {
      // An unreadable project must not block the frames.
      const plan = framesOnlyPlan(options, unreadable);
      write(formatPlan(plan));
      let answer: string | null = flags.yes ? "" : await ask("Generate only the frames? (Y/n) ");
      answer = answer?.trim().toLowerCase() ?? null;
      if (answer === "" || answer === "y" || answer === "yes") chosen = plan;
    } else if (!flags.yes && deps.confirm && !overrides.ask) {
      const suggested = planScaffold(project, options, flags);
      const standard = suggested.framework !== null && !suggested.doubts?.length;
      const plan = standard ? suggested : withoutSetup(suggested);
      write(formatPlan(plan));
      if (await deps.confirm("Continue? (Y/n) ")) chosen = plan;
    } else if (!flags.yes) {
      chosen = await decide(project, options, flags, ask, write);
    } else {
      const plan = planScaffold(project, options, flags);
      chosen = flags.framework ? plan : withoutSetup(plan);
      write(formatPlan(chosen));
    }
  } finally {
    prompter.close();
  }
  if (chosen === null) {
    write("Cancelled. Nothing was changed.\n");
    return 1;
  }
  return execute(chosen, { options, flags, io, deps });
}

interface Invocation {
  options: GenerateOptions;
  flags: ScaffoldFlags;
  io: CliIO;
  deps: RunDeps;
}

/** How to set up later, for a run that only generated the frames. */
function setUpLater(plan: ScaffoldPlan, { options, flags }: Invocation): string {
  if (plan.project === null) return "";
  const suggested = planScaffold(plan.project, options, flags);
  // A complete command only for a standard suggestion; anything else has to be asked.
  const complete =
    flags.yes && suggested.framework !== null && suggested.url && !suggested.doubts?.length
      ? { framework: suggested.framework, url: suggested.url }
      : null;
  const command = retryCommand(plan.generate, flags, complete);
  if (!command) return "To set it up, run the same command again in a terminal, without --yes and with --force.\n";
  const how = complete ? "check that these values are right, then run" : "run this in a terminal, where it asks";
  return `To set it up, ${how}:\n  ${command}\n`;
}

/** Runs the confirmed plan. The last line it prints comes from what happened, not from the plan. */
async function execute(plan: ScaffoldPlan, invocation: Invocation): Promise<number> {
  const { flags, io, deps } = invocation;
  const write = (text: string) => io.stdout.write(text);

  const result = await runGenerate(plan.generate, io, deps);
  if (!result.ok) return result.exitCode;

  if (plan.framework === null) {
    write(setUpLater(plan, invocation));
    if (plan.project === null) write("Not set up: the project could not be read. Only the frames were generated.\n");
    else if (flags.yes) write("Not set up: --yes alone only generates the frames.\n");
    else write("Not set up: only the frames were generated.\n");
    return 0;
  }

  if (plan.install) {
    const { pkg, command, args } = plan.install;
    try {
      await deps.runCommand(command, args, deps.cwd);
    } catch (error) {
      io.stderr.write(
        `Could not install ${pkg} (${(error as Error).message}). The frames are ready; install it with:\n  ${[command, ...args].join(" ")}\n`,
      );
      const retry = retryCommand(plan.generate, flags, { framework: plan.framework, url: plan.generate.baseUrl });
      write(retry ? `Once it is installed, finish with:\n  ${retry}\n` : "Once it is installed, run the same command again with --force.\n");
      write(`Set-up incomplete: ${pkg} was not installed, so nothing else was written.\n`);
      return 1;
    }
  }

  const failed: string[] = [];
  if (plan.component) {
    const { path, render, usage } = plan.component;
    const target = join(deps.cwd, path);
    try {
      mkdirSync(dirname(target), { recursive: true });
      // "wx" fails if the file appeared since the plan was made: never overwrite the user's code.
      writeFileSync(target, render(result.manifest), { flag: "wx" });
      write(`Created ${path}\n\n${usage.join("\n")}\n`);
    } catch (error) {
      // The remaining confirmed steps still run; the exit code reports the failure.
      io.stderr.write(`Could not create ${path}: ${(error as Error).message}\n`);
      failed.push(`${path} was not written`);
    }
  }

  for (const edit of plan.edits) {
    const target = join(deps.cwd, edit.path);
    const current = readText(target); // null: deleted, unreadable or not a file since the plan
    // Only apply the change to the exact file content the user saw in the plan.
    if (current !== edit.before) {
      io.stderr.write(`${edit.path} changed after the plan was made; it was not modified. ${edit.manual}\n`);
      failed.push(`${edit.path} was not updated`);
      continue;
    }
    try {
      writeFileSync(target, edit.after);
      write(`Updated ${edit.path}\n`);
    } catch (error) {
      io.stderr.write(`Could not update ${edit.path}: ${(error as Error).message}. ${edit.manual}\n`);
      failed.push(`${edit.path} was not updated`);
    }
  }

  write("\n");
  if (failed.length > 0) {
    write(`Set-up incomplete: ${failed.join(", ")}.\n`);
    return 1;
  }
  if (plan.existing) {
    write(`Frames written; ${plan.existing} already existed and was left as it was: check that it loads them from ${plan.generate.baseUrl}.\n`);
  } else {
    write(`${checkDelivery(result.manifest)}\n`);
  }
  return 0;
}
