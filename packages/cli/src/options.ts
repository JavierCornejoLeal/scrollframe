import { parseArgs } from "node:util";
import { posix, sep } from "node:path";
import type { FrameSet, SequenceManifest } from "@scrollframe/core";

export const HELP = `Usage: scrollframe <video> [options]

Extracts optimized WebP frames (mobile, tablet, desktop) and a manifest.json
for the @scrollframe/react <ScrollSequence> component.

Options:
  -o, --out <dir>         Output folder (default: public/sequence)
  -b, --base-url <url>    Public URL of the output folder (default: derived from --out)
  -f, --frames <n>        Frames to extract, 2-600, capped at the video's own (default: 120)
  -q, --quality <0-100>   WebP quality (default: 80)
  -w, --widths <m,t,d>    Mobile, tablet and desktop widths (default: 720,1280,1920)
      --lossless          Lossless WebP (much heavier, hurts LCP; not recommended)
      --ffmpeg <path>     ffmpeg binary (default: FFMPEG_PATH, bundled ffmpeg-static, then PATH)
      --force             Overwrite a non-empty output folder
  -h, --help              Show this help
`;

export interface GenerateOptions {
  input: string;
  out: string;
  baseUrl: string;
  frames: number;
  quality: number;
  widths: [number, number, number];
  lossless: boolean;
  ffmpeg?: string;
  force: boolean;
}

export class UsageError extends Error {
  override name = "UsageError";
}

const BREAKPOINTS = [
  { name: "mobile", maxViewportWidth: 767 },
  { name: "tablet", maxViewportWidth: 1279 },
  { name: "desktop", maxViewportWidth: null },
] as const;

function toInt(value: string, flag: string, min: number, max: number): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new UsageError(`${flag} must be an integer between ${min} and ${max} (got "${value}").`);
  }
  return n;
}

/** `public/sequence` -> `/sequence`; any other folder -> `/<last segment>`. */
export function deriveBaseUrl(out: string): string {
  const normalized = out.split(sep).join("/").replace(/^\.\//, "").replace(/\/+$/, "");
  const match = normalized.match(/(?:^|\/)public\/(.+)$/);
  if (match?.[1]) return `/${match[1]}`;
  return `/${posix.basename(normalized)}`;
}

export function parseCliArgs(argv: string[]): GenerateOptions | "help" {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: "string", short: "o", default: "public/sequence" },
      "base-url": { type: "string", short: "b" },
      frames: { type: "string", short: "f", default: "120" },
      quality: { type: "string", short: "q", default: "80" },
      widths: { type: "string", short: "w", default: "720,1280,1920" },
      lossless: { type: "boolean", default: false },
      ffmpeg: { type: "string" },
      force: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) return "help";
  const [input, ...extra] = positionals;
  if (!input) throw new UsageError("Missing <video>. Run `scrollframe --help`.");
  if (extra.length > 0) throw new UsageError(`Unexpected arguments: ${extra.join(" ")}`);

  const widths = values.widths.split(",").map((w) => toInt(w.trim(), "--widths", 16, 7680));
  if (widths.length !== 3) throw new UsageError("--widths needs exactly three values: mobile,tablet,desktop.");
  if (!(widths[0]! < widths[1]! && widths[1]! < widths[2]!)) {
    throw new UsageError("--widths must be ascending: mobile < tablet < desktop.");
  }

  return {
    input,
    out: values.out,
    baseUrl: values["base-url"] ?? deriveBaseUrl(values.out),
    frames: toInt(values.frames, "--frames", 2, 600),
    quality: toInt(values.quality, "--quality", 0, 100),
    widths: widths as [number, number, number],
    lossless: values.lossless,
    ffmpeg: values.ffmpeg,
    force: values.force,
  };
}

/** Parses the `Duration: HH:MM:SS.xx` line of `ffmpeg -i` output, in seconds. */
export function parseDuration(ffmpegOutput: string): number | null {
  const match = ffmpegOutput.match(/Duration:\s*(\d+):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!match) return null;
  const [, h, m, s] = match;
  return Number(h) * 3600 + Number(m) * 60 + Number(s);
}

/** Parses the frame rate of the first video stream (`..., 30 fps, ...`), or null when absent. */
export function parseFrameRate(ffmpegOutput: string): number | null {
  const match = ffmpegOutput.match(/Video:.*?(\d+(?:\.\d+)?) fps/);
  return match ? Number(match[1]) : null;
}

/**
 * Frames the source can provide. ffmpeg prints rounded rates (29.97 for 30000/1001), so the
 * product is rounded rather than truncated: 4 s at "29.97 fps" is 120 frames, not 119.
 */
export function availableFrames(duration: number, rate: number | null): number {
  return rate === null ? Infinity : Math.round(duration * rate);
}

/** Frame rate that yields `frames` evenly spaced frames over `duration` seconds. */
export function samplingFps(frames: number, duration: number): number {
  if (duration <= 0) throw new UsageError("The video has no measurable duration.");
  return frames / duration;
}

export function planSets(widths: [number, number, number]): Omit<FrameSet, "height">[] {
  return BREAKPOINTS.map((bp, i) => ({ ...bp, width: widths[i]!, dir: bp.name }));
}

export function buildManifest(
  options: Pick<GenerateOptions, "baseUrl">,
  frameCount: number,
  sets: FrameSet[],
): SequenceManifest {
  return {
    version: 1,
    frameCount,
    baseUrl: options.baseUrl,
    pattern: "frame-{index}.webp",
    padding: Math.max(4, String(frameCount - 1).length),
    poster: "poster.webp",
    sets,
  };
}
