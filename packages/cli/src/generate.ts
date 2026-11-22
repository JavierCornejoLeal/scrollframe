import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import type { FrameSet, SequenceManifest } from "@scrollframe/core";
import sharp from "sharp";
import {
  UsageError,
  availableFrames,
  buildManifest,
  framesFor,
  parseDuration,
  parseFrameRate,
  planAdaptiveSets,
  planSets,
  samplingFps,
  scrollLengthFor,
  type GenerateOptions,
  type PlannedSet,
} from "./options.js";

export interface GenerateResult {
  manifest: SequenceManifest;
  manifestPath: string;
  bytesBySet: Record<string, number>;
}

type Log = (message: string) => void;

function run(bin: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stderr }));
  });
}

/**
 * Where ffmpeg-static says its binary is, or null when the package is missing or the platform
 * is unsupported. The path is returned even if its install script never downloaded the binary.
 */
function bundledFfmpegPath(): string | null {
  try {
    return (createRequire(import.meta.url)("ffmpeg-static") as string | null) ?? null;
  } catch {
    return null;
  }
}

/** --ffmpeg flag, then FFMPEG_PATH, then the bundled ffmpeg-static binary, then `ffmpeg` on PATH. */
export function resolveFfmpeg(explicit?: string): string {
  if (explicit) return explicit;
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  const bundled = bundledFfmpegPath();
  if (bundled && existsSync(bundled)) return bundled;
  return "ffmpeg";
}

/**
 * True when ffmpeg-static is installed without its binary: its install script did not run,
 * which npm 12+ does by default for every dependency not listed in `allowScripts`.
 */
function bundledBinaryMissing(): boolean {
  const bundled = bundledFfmpegPath();
  return bundled !== null && !existsSync(bundled);
}

export function ffmpegNotFoundMessage(ffmpeg: string, bundledBinaryBlocked: boolean): string {
  if (!bundledBinaryBlocked) return `ffmpeg not found ("${ffmpeg}"). Install ffmpeg or pass --ffmpeg <path>.`;
  return [
    "ffmpeg not found. The ffmpeg bundled with scrollframe (ffmpeg-static) was not downloaded, usually because",
    "its install script was blocked (npm 12+ blocks dependency install scripts by default). Fix it with one of:",
    "",
    // A second package gives npx another cache entry: the blocked run left one without the binary.
    '  npx --allow-scripts=ffmpeg-static -p "@scrollframe/cli" -p ffmpeg-static scrollframe <video>',
    "  npm install-scripts approve ffmpeg-static && npm rebuild ffmpeg-static   (installed in a project)",
    "  install ffmpeg on your system, or pass --ffmpeg <path>",
  ].join("\n");
}

const OWNED_ENTRIES = ["manifest.json", "mobile", "tablet", "desktop", "large"];

/** Validates the output folder and returns the scrollframe-owned entries it already contains. */
async function checkOutput(out: string, force: boolean): Promise<string[]> {
  if (existsSync(out) && !(await stat(out)).isDirectory()) {
    throw new UsageError(`Output path is not a folder: ${out}`);
  }
  const entries = existsSync(out) ? await readdir(out) : [];
  const owned = entries.filter((entry) => OWNED_ENTRIES.includes(entry));
  if (owned.length > 0 && !force) {
    throw new UsageError(`${out} already contains a sequence. Use --force to overwrite it.`);
  }
  return owned;
}

export interface SwapFs {
  rename: typeof rename;
  rm: typeof rm;
}

/**
 * Moves a fully generated staging folder into `out`. The previous sequence is first moved
 * aside (same filesystem, so renames are atomic) and restored if any step fails.
 * Only scrollframe-owned entries are touched; unrelated files in `out` are never removed.
 * The backup is deleted only once the swap or the full restore has succeeded; if the
 * restore itself fails (e.g. EBUSY/EPERM on Windows), it is kept and its path reported.
 */
export async function swapIntoPlace(
  out: string,
  staging: string,
  previous: string[],
  fs: SwapFs = { rename, rm },
): Promise<void> {
  const backup = await mkdtemp(join(out, ".scrollframe-old-"));
  const movedAside: string[] = [];
  const movedIn: string[] = [];
  try {
    for (const entry of previous) {
      await fs.rename(join(out, entry), join(backup, entry));
      movedAside.push(entry);
    }
    for (const entry of (await readdir(staging)).sort()) {
      await fs.rename(join(staging, entry), join(out, entry));
      movedIn.push(entry);
    }
  } catch (error) {
    let restored = true;
    for (const entry of movedIn) {
      try {
        await fs.rm(join(out, entry), { recursive: true, force: true });
      } catch {
        restored = false;
      }
    }
    for (const entry of movedAside) {
      try {
        await fs.rename(join(backup, entry), join(out, entry));
      } catch {
        restored = false;
      }
    }
    if (!restored) {
      throw new Error(
        `Could not replace the sequence (${(error as Error).message}). The previous sequence is kept in ${backup}.`,
      );
    }
    await rm(backup, { recursive: true, force: true });
    throw error;
  }
  await rm(backup, { recursive: true, force: true });
}

interface RawFrame {
  data: Buffer;
  width: number;
  height: number;
}

/** Splits ffmpeg's stream of PPM images: each is `P6 <width> <height> 255` and then its RGB bytes. */
const INTERRUPTS = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

/** A `finally` does not run on a signal: this removes what was half-done, then lets the signal act. */
function cleanUpOnInterrupt(staging: string, child: () => ChildProcess | null): () => void {
  const stop = () => {
    for (const signal of INTERRUPTS) process.off(signal, interrupt);
  };
  const interrupt = (signal: NodeJS.Signals) => {
    stop();
    child()?.kill();
    try {
      rmSync(staging, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    } finally {
      process.kill(process.pid, signal);
    }
  };
  for (const signal of INTERRUPTS) process.on(signal, interrupt);
  return stop;
}

async function* readPpm(stream: AsyncIterable<Buffer>): AsyncGenerator<RawFrame> {
  let header = Buffer.alloc(0);
  let frame: RawFrame | null = null;
  let filled = 0;
  for await (let chunk of stream) {
    while (chunk.length > 0) {
      if (!frame) {
        const before = header.length;
        header = Buffer.concat([header, chunk.subarray(0, 64)]);
        const match = /^P6\s+(\d+)\s+(\d+)\s+255\s/.exec(header.toString("latin1"));
        if (!match) {
          if (header.length >= 64) throw new Error("ffmpeg returned an unexpected image format.");
          chunk = chunk.subarray(header.length - before);
          continue;
        }
        const [width, height] = [Number(match[1]), Number(match[2])];
        frame = { width, height, data: Buffer.allocUnsafe(width * height * 3) };
        filled = 0;
        chunk = chunk.subarray(match[0].length - before);
        header = Buffer.alloc(0);
      }
      const take = Math.min(chunk.length, frame.data.length - filled);
      chunk.copy(frame.data, filled, 0, take);
      filled += take;
      chunk = chunk.subarray(take);
      if (filled === frame.data.length) {
        yield frame;
        frame = null;
      }
    }
  }
}

export async function generateSequence(options: GenerateOptions, log: Log = () => {}): Promise<GenerateResult> {
  if (!existsSync(options.input)) throw new UsageError(`Video not found: ${options.input}`);
  const ffmpeg = resolveFfmpeg(options.ffmpeg);

  let probe: { code: number; stderr: string };
  try {
    probe = await run(ffmpeg, ["-hide_banner", "-i", options.input]);
  } catch {
    // Only the automatic fallback can be explained by a blocked ffmpeg-static install.
    const fellBack = !options.ffmpeg && !process.env.FFMPEG_PATH;
    throw new UsageError(ffmpegNotFoundMessage(ffmpeg, fellBack && bundledBinaryMissing()));
  }
  const duration = parseDuration(probe.stderr);
  if (duration === null) throw new UsageError(`Could not read the video duration of ${options.input}.`);

  // Asking for more frames than the source has only duplicates frames (more bytes, no smoother motion).
  const rate = parseFrameRate(probe.stderr);
  const available = availableFrames(duration, rate);
  const autoFrames = options.auto?.frames === true;
  const frames = autoFrames ? framesFor(duration, available) : Math.min(options.frames, available);
  if (frames < 2) throw new UsageError("The video produced fewer than 2 frames.");
  if (!autoFrames && frames < options.frames) {
    log(`The video only has ${frames} frames; extracting ${frames} instead of ${options.frames}.`);
  }

  const previous = await checkOutput(options.out, options.force);
  await mkdir(options.out, { recursive: true });
  // Everything is written here first, so a failure never leaves a half-replaced sequence.
  const staging = await mkdtemp(join(options.out, ".scrollframe-new-"));
  let extracting: ChildProcess | null = null;
  const stopCleanUp = cleanUpOnInterrupt(staging, () => extracting);

  try {
    const adaptive = options.auto?.sets === true;
    const fps = samplingFps(frames, duration);
    const largest = adaptive ? 3840 : options.widths[2];
    log(`Extracting ${frames} frames from ${duration.toFixed(2)}s of video...`);
    // Streamed, not saved first: two minutes of 4K as PNG files would be gigabytes of temp files.
    const child = spawn(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel", "error",
        "-i", options.input,
        "-vf", `fps=${fps},scale='min(${largest},iw)':-2:flags=lanczos`,
        "-frames:v", String(frames),
        "-f", "image2pipe",
        "-c:v", "ppm",
        "-pix_fmt", "rgb24",
        "pipe:1",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    extracting = child;
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString()));
    const exited = new Promise<number>((resolve) => {
      child.on("error", (error) => {
        stderr += error.message;
        resolve(1);
      });
      child.on("close", (code) => resolve(code ?? 1));
    });

    const base = buildManifest(options, frames, []);
    let sets: PlannedSet[] = [];
    const bytesBySet: Record<string, number> = {};
    const encode = async ({ data, width, height }: RawFrame, index: number): Promise<void> => {
      const file = base.pattern.replace("{index}", String(index).padStart(base.padding, "0"));
      // One set after another: the frames themselves are what runs in parallel.
      for (const set of sets) {
        let image = sharp(data, { raw: { width, height, channels: 3 } });
        if (set.maxAspectRatio !== undefined) {
          const kept = Math.min(width, Math.round((height * set.width) / set.height));
          image = image.extract({ left: Math.floor((width - kept) / 2), top: 0, width: kept, height });
        }
        const target = join(staging, set.dir, file);
        const info = await image
          .resize({ width: set.width, height: set.height, fit: "fill" })
          .webp(
            options.lossless
              ? { lossless: true, effort: 6 }
              : { quality: set.quality, effort: adaptive ? 4 : 6, smartSubsample: true },
          )
          .toFile(target);
        if (index === 0) await copyFile(target, join(staging, set.dir, base.poster));
        bytesBySet[set.name] = (bytesBySet[set.name] ?? 0) + info.size;
      }
    };

    const parallel = Math.max(2, Math.min(6, availableParallelism() - 1));
    const working = new Set<Promise<void>>();
    let failure: unknown;
    let count = 0;
    try {
      for await (const frame of readPpm(child.stdout)) {
        if (count === 0) {
          const planned = adaptive
            ? planAdaptiveSets(frame.width, frame.height)
            : planSets(options.widths).map((set): PlannedSet => {
                const width = Math.min(set.width, frame.width);
                return { ...set, width, height: Math.round((width * frame.height) / frame.width), quality: options.quality };
              });
          sets = options.auto?.quality ? planned : planned.map((set) => ({ ...set, quality: options.quality }));
          for (const set of sets) await mkdir(join(staging, set.dir), { recursive: true });
        }
        const work = encode(frame, count++)
          .catch((error: unknown) => {
            failure ??= error;
          })
          .finally(() => working.delete(work));
        working.add(work);
        if (working.size >= parallel) await Promise.race(working);
        if (failure) break;
        if (frames > 300 && count < frames && count % Math.ceil(frames / 4) === 0) log(`  ${count} of ${frames} frames...`);
      }
    } finally {
      await Promise.all(working); // nothing may still write into staging when it is removed
      if (failure) child.kill();
    }
    if (failure) throw failure;
    if ((await exited) !== 0) throw new Error(`ffmpeg failed:\n${stderr}`);
    if (count < 2) throw new UsageError("The video produced fewer than 2 frames.");

    for (const set of sets) {
      log(`  ${set.name.padEnd(8)} ${set.width}x${set.height}  ${((bytesBySet[set.name] ?? 0) / 1024 / 1024).toFixed(1)} MB`);
    }
    const manifest: SequenceManifest = {
      ...buildManifest(options, count, sets.map(({ quality: _quality, ...set }): FrameSet => set)),
      padding: base.padding, // the one the files were named with
      ...(adaptive ? { scrollLength: scrollLengthFor(duration) } : {}),
    };
    await writeFile(join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    stopCleanUp(); // the swap restores on its own, and needs staging until it ends
    await swapIntoPlace(options.out, staging, previous);
    return { manifest, manifestPath: join(options.out, "manifest.json"), bytesBySet };
  } finally {
    stopCleanUp();
    await rm(staging, { recursive: true, force: true });
  }
}
