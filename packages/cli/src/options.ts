import { parseArgs } from "node:util";
import { posix, sep } from "node:path";
import type { FrameSet, SequenceManifest } from "@scrollframe/core";
import type { Framework } from "./detect.js";

export const HELP = `Usage: scrollframe <video> [options]

Extracts optimized WebP frames (mobile, tablet, desktop) and a manifest.json.
In a terminal it also suggests how to set up your project (Next.js, React,
Angular, Vue or plain HTML): you confirm or correct the framework, the folder
and the URL, and it installs the package and writes the component.

Options:
  -o, --out <dir>         Output folder (default: public/sequence)
  -b, --base-url <url>    Public URL of the output folder (default: derived from --out)
  -f, --frames <n>        Frames, 2-20000, capped at the video's own (default: 15/s, at least 120)
  -q, --quality <0-100>   WebP quality (default: 82-84, or 80 with --widths)
  -w, --widths <m,t,d>    Three uncropped widths (default: up to 2560, portrait crops for phones)
      --lossless          Lossless WebP (much heavier, hurts LCP; not recommended)
      --ffmpeg <path>     ffmpeg binary (default: FFMPEG_PATH, bundled ffmpeg-static, then PATH)
      --force             Overwrite a non-empty output folder
  -y, --yes               Do not ask: only frames, or set up with --framework, -o and --base-url
      --framework <name>  next, react, angular, vue or html (instead of the suggestion)
      --name <Name>       Component name (default: from the video, e.g. HeroSequence)
      --no-install        Do not install the scrollframe package
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
  /**
   * What was left to follow the video; `frames`, `widths` and `quality` then only hold fallbacks.
   * Without it, those three are used as they are.
   */
  auto?: { frames: boolean; sets: boolean; quality: boolean };
}

/** How the project is set up after the frames. Absent flags mean "detect" / "ask". */
export interface ScaffoldFlags {
  yes: boolean;
  framework?: Framework;
  name?: string;
  install: boolean;
  /** `-o` / `--base-url` were given explicitly, so detection must not change them. */
  outGiven: boolean;
  baseUrlGiven: boolean;
}

export const FRAMEWORKS: readonly Framework[] = ["next", "react", "angular", "vue", "html"];

export class UsageError extends Error {
  override name = "UsageError";
}

const BREAKPOINTS = [
  { name: "mobile", maxViewportWidth: 767 },
  { name: "tablet", maxViewportWidth: 1279 },
  { name: "desktop", maxViewportWidth: null },
] as const;

const MAX_FRAMES = 20000;
export const FRAMES_PER_SECOND = 15;
/** What --frames, --quality and --widths fall back to when the video does not decide them. */
export const DEFAULT_FRAMES = 120;
export const DEFAULT_QUALITY = 80;
export const DEFAULT_WIDTHS = "720,1280,1920";
export const MIN_FRAMES = 120;

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
  const parsed = parseCommandLine(argv);
  return parsed === "help" ? parsed : parsed.generate;
}

/** Frame options plus the project set-up flags. */
export function parseCommandLine(argv: string[]): { generate: GenerateOptions; scaffold: ScaffoldFlags } | "help" {
  const { values, positionals, tokens } = parseArgs({
    args: argv,
    allowPositionals: true,
    tokens: true,
    options: {
      out: { type: "string", short: "o", default: "public/sequence" },
      "base-url": { type: "string", short: "b" },
      frames: { type: "string", short: "f" },
      quality: { type: "string", short: "q" },
      widths: { type: "string", short: "w" },
      lossless: { type: "boolean", default: false },
      ffmpeg: { type: "string" },
      force: { type: "boolean", default: false },
      yes: { type: "boolean", short: "y", default: false },
      framework: { type: "string" },
      name: { type: "string" },
      "no-install": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });

  if (values.help) return "help";
  const [input, ...extra] = positionals;
  if (!input) throw new UsageError("Missing <video>. Run `scrollframe --help`.");
  if (extra.length > 0) throw new UsageError(`Unexpected arguments: ${extra.join(" ")}`);

  const widths = (values.widths ?? DEFAULT_WIDTHS).split(",").map((w) => toInt(w.trim(), "--widths", 16, 7680));
  if (widths.length !== 3) throw new UsageError("--widths needs exactly three values: mobile,tablet,desktop.");
  if (!(widths[0]! < widths[1]! && widths[1]! < widths[2]!)) {
    throw new UsageError("--widths must be ascending: mobile < tablet < desktop.");
  }

  const framework = values.framework;
  if (framework !== undefined && !FRAMEWORKS.includes(framework as Framework)) {
    throw new UsageError(`--framework must be one of: ${FRAMEWORKS.join(", ")} (got "${framework}").`);
  }
  if (values.name !== undefined && !/^[A-Z][A-Za-z0-9]*$/.test(values.name)) {
    throw new UsageError(`--name must be a PascalCase component name such as HeroSequence (got "${values.name}").`);
  }

  return {
    generate: {
      input,
      out: values.out,
      baseUrl: values["base-url"] ?? deriveBaseUrl(values.out),
      frames: toInt(values.frames ?? String(DEFAULT_FRAMES), "--frames", 2, MAX_FRAMES),
      quality: toInt(values.quality ?? String(DEFAULT_QUALITY), "--quality", 0, 100),
      widths: widths as [number, number, number],
      lossless: values.lossless,
      ffmpeg: values.ffmpeg,
      force: values.force,
      auto: {
        frames: values.frames === undefined,
        sets: values.widths === undefined,
        quality: values.quality === undefined && values.widths === undefined,
      },
    },
    scaffold: {
      yes: values.yes,
      framework: framework as Framework | undefined,
      name: values.name,
      install: !values["no-install"],
      outGiven: tokens.some((token) => token.kind === "option" && token.name === "out"),
      baseUrlGiven: values["base-url"] !== undefined,
    },
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

/** Enough frames for the motion to read as video whatever the duration, never more than the video has. */
export function framesFor(duration: number, available: number): number {
  return Math.min(available, MAX_FRAMES, Math.max(MIN_FRAMES, Math.round(duration * FRAMES_PER_SECOND)));
}

/** 40vh of scroll per second of video, at least 300vh. */
export function scrollLengthFor(duration: number): string {
  return `${Math.max(300, Math.round(duration * 4) * 10)}vh`;
}

export interface PlannedSet extends FrameSet {
  quality: number;
}

const CROPS = [
  // 3:5 fills a phone also with the browser bars showing, 4:5 a tablet.
  { name: "mobile", maxViewportWidth: 767, aspect: 0.6, width: 1296, quality: 82 },
  { name: "tablet", maxViewportWidth: 1023, aspect: 0.8, width: 1440, quality: 84 },
] as const;

/**
 * The sets for a video of `width` x `height`: portrait crops only where the video is wider than
 * the screen (object-fit would hide those sides anyway), and full frames up to 2560. Never upscaled.
 */
export function planAdaptiveSets(width: number, height: number): PlannedSet[] {
  const sets: PlannedSet[] = [];
  const full = (name: string, maxViewportWidth: number | null, target: number, quality: number) => {
    const w = Math.min(target, width);
    sets.push({ name, dir: name, maxViewportWidth, width: w, height: Math.round((w * height) / width), quality });
  };
  for (const crop of CROPS) {
    if (width / height <= crop.aspect * 1.05) continue;
    const w = Math.min(crop.width, Math.round(height * crop.aspect));
    sets.push({
      name: crop.name,
      dir: crop.name,
      maxViewportWidth: crop.maxViewportWidth,
      maxAspectRatio: crop.aspect,
      width: w,
      height: Math.min(height, Math.round(w / crop.aspect)),
      quality: crop.quality,
    });
  }
  if (sets.length === 0 && width > 1080) full("mobile", 767, 1080, 82);
  const large = Math.min(2560, width);
  const hasLarge = large > 1920 * 1.1;
  full("desktop", hasLarge ? 1920 : null, 1920, 84);
  if (hasLarge) full("large", null, 2560, 84);
  return sets;
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
