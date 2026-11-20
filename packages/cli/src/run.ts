import { generateSequence } from "./generate.js";
import { HELP, UsageError, parseCliArgs } from "./options.js";

export interface CliIO {
  stdout: { write(chunk: string): unknown };
  stderr: { write(chunk: string): unknown };
}

/** Runs the CLI and resolves with the exit code: 0 ok, 1 unexpected failure, 2 usage error. */
export async function runCli(argv: string[], io: CliIO): Promise<number> {
  let options;
  try {
    options = parseCliArgs(argv);
  } catch (error) {
    io.stderr.write(`${(error as Error).message}\n\n${HELP}`);
    return 2;
  }
  if (options === "help") {
    io.stdout.write(HELP);
    return 0;
  }
  if (options.lossless) {
    io.stderr.write("Warning: --lossless frames are several times heavier and will hurt LCP.\n");
  }

  try {
    const { manifestPath, manifest } = await generateSequence(options, (line) => io.stdout.write(`${line}\n`));
    io.stdout.write(`\nDone: ${manifest.frameCount} frames -> ${manifestPath}\n\n`);
    io.stdout.write(
      `import manifest from "./${manifestPath}";\n<ScrollSequence manifest={manifest} alt="Describe the scene" />\n`,
    );
    return 0;
  } catch (error) {
    if (error instanceof UsageError) {
      io.stderr.write(`${error.message}\n`);
      return 2;
    }
    io.stderr.write(`Unexpected error: ${(error as Error).message}\n`);
    return 1;
  }
}
