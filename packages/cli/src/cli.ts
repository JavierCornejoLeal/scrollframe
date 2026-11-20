#!/usr/bin/env node
import { generateSequence } from "./generate.js";
import { HELP, UsageError, parseCliArgs } from "./options.js";

async function main(): Promise<number> {
  let options;
  try {
    options = parseCliArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n\n${HELP}`);
    return 2;
  }
  if (options === "help") {
    process.stdout.write(HELP);
    return 0;
  }
  if (options.lossless) {
    process.stderr.write("Warning: --lossless frames are several times heavier and will hurt LCP.\n");
  }

  try {
    const { manifestPath, manifest } = await generateSequence(options, (line) => process.stdout.write(`${line}\n`));
    process.stdout.write(`\nDone: ${manifest.frameCount} frames -> ${manifestPath}\n\n`);
    process.stdout.write(
      `import manifest from "./${manifestPath}";\n<ScrollSequence manifest={manifest} alt="Describe the scene" />\n`,
    );
    return 0;
  } catch (error) {
    process.stderr.write(`${error instanceof UsageError ? "" : "Unexpected error: "}${(error as Error).message}\n`);
    return error instanceof UsageError ? 2 : 1;
  }
}

main().then((code) => process.exit(code));
