import { frameUrl, posterUrl, type SequenceManifest } from "@scrollframe/core";
import type { Framework } from "./detect.js";
import type { GenerateOptions, ScaffoldFlags } from "./options.js";

/** One argument that reads the same in sh, zsh, cmd and PowerShell, or null when none would. */
function quote(value: string): string | null {
  if (/^[A-Za-z0-9_./:+=-]+$/.test(value) || /^\d+(?:,\d+)+$/.test(value)) return value;
  return /^[A-Za-z0-9_./:@+,=~ \\-]+$/.test(value) && !value.endsWith("\\") ? `"${value}"` : null;
}

/**
 * The command that runs this again, with --force because the frames now exist. With `setUp` it
 * sets the project up unattended; without, it asks in a terminal. null when it cannot be quoted.
 */
export function retryCommand(
  options: GenerateOptions,
  flags: ScaffoldFlags,
  setUp: { framework: Framework; url: string } | null,
): string | null {
  const args = [options.input.startsWith("-") ? `./${options.input}` : options.input, "--force"];
  const { auto } = options;
  // With `auto`, what was given is repeated even when it equals a fallback: it changes the result.
  if (auto ? !auto.frames : options.frames !== 120) args.push("--frames", String(options.frames));
  if (auto ? !auto.quality && (auto.sets || options.quality !== 80) : options.quality !== 80) {
    args.push("--quality", String(options.quality));
  }
  if (auto ? !auto.sets : options.widths.join() !== "720,1280,1920") args.push("--widths", options.widths.join(","));
  if (options.lossless) args.push("--lossless");
  if (options.ffmpeg) args.push("--ffmpeg", options.ffmpeg);
  if (flags.name) args.push("--name", flags.name);
  if (!flags.install) args.push("--no-install");
  if (setUp) args.push("--yes", "--framework", setUp.framework);
  else if (flags.framework) args.push("--framework", flags.framework);
  // A value that starts with "-" would be read as an option.
  if (options.out.startsWith("-")) args.push(`--out=${options.out}`);
  else args.push("-o", options.out);
  if (setUp) args.push("--base-url", setUp.url);
  else if (flags.baseUrlGiven) args.push("--base-url", options.baseUrl);

  const quoted = args.map(quote);
  return quoted.includes(null) ? null : `npx @scrollframe/cli ${quoted.join(" ")}`;
}

/** The URLs that show whether the frames are served: what the engine really requests. */
export function checkDelivery(manifest: SequenceManifest): string {
  const largest = manifest.sets[manifest.sets.length - 1]!;
  return (
    "Set-up written. Delivery was not checked: with your site running, open " +
    `${posterUrl(manifest, largest)} and ${frameUrl(manifest, largest, 0)}, both must show an image.`
  );
}
