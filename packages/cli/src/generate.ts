import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FrameSet, SequenceManifest } from "@scrollframe/core";
import sharp from "sharp";
import { availableFrames, buildManifest, parseDuration, parseFrameRate, planSets, samplingFps, UsageError, type GenerateOptions } from "./options.js";

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

/** --ffmpeg flag, then FFMPEG_PATH, then the bundled ffmpeg-static binary, then `ffmpeg` on PATH. */
export function resolveFfmpeg(explicit?: string): string {
  if (explicit) return explicit;
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    const bundled = createRequire(import.meta.url)("ffmpeg-static") as string | null;
    if (bundled && existsSync(bundled)) return bundled;
  } catch {
    // ffmpeg-static missing or its binary was not downloaded (e.g. blocked install scripts).
  }
  return "ffmpeg";
}

const OWNED_ENTRIES = ["manifest.json", "mobile", "tablet", "desktop"];

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

/**
 * Moves a fully generated staging folder into `out`. The previous sequence is first moved
 * aside (same filesystem, so renames are atomic) and restored if any step fails.
 * Only scrollframe-owned entries are touched; unrelated files in `out` are never removed.
 */
async function swapIntoPlace(out: string, staging: string, previous: string[]): Promise<void> {
  const backup = await mkdtemp(join(out, ".scrollframe-old-"));
  const movedAside: string[] = [];
  const movedIn: string[] = [];
  try {
    for (const entry of previous) {
      await rename(join(out, entry), join(backup, entry));
      movedAside.push(entry);
    }
    for (const entry of await readdir(staging)) {
      await rename(join(staging, entry), join(out, entry));
      movedIn.push(entry);
    }
  } catch (error) {
    for (const entry of movedIn) await rm(join(out, entry), { recursive: true, force: true });
    for (const entry of movedAside) await rename(join(backup, entry), join(out, entry));
    throw error;
  } finally {
    await rm(backup, { recursive: true, force: true });
  }
}

export async function generateSequence(options: GenerateOptions, log: Log = () => {}): Promise<GenerateResult> {
  if (!existsSync(options.input)) throw new UsageError(`Video not found: ${options.input}`);
  const ffmpeg = resolveFfmpeg(options.ffmpeg);

  let probe: { code: number; stderr: string };
  try {
    probe = await run(ffmpeg, ["-hide_banner", "-i", options.input]);
  } catch {
    throw new UsageError(`ffmpeg not found ("${ffmpeg}"). Install ffmpeg or pass --ffmpeg <path>.`);
  }
  const duration = parseDuration(probe.stderr);
  if (duration === null) throw new UsageError(`Could not read the video duration of ${options.input}.`);

  // Asking for more frames than the source has only duplicates frames (more bytes, no smoother motion).
  const rate = parseFrameRate(probe.stderr);
  const available = availableFrames(duration, rate);
  const frames = Math.min(options.frames, available);
  if (frames < 2) throw new UsageError("The video produced fewer than 2 frames.");
  if (frames < options.frames) {
    log(`The video only has ${frames} frames; extracting ${frames} instead of ${options.frames}.`);
  }

  const previous = await checkOutput(options.out, options.force);
  await mkdir(options.out, { recursive: true });
  const tmp = await mkdtemp(join(tmpdir(), "scrollframe-"));
  // Everything is written here first, so a failure never leaves a half-replaced sequence.
  const staging = await mkdtemp(join(options.out, ".scrollframe-new-"));

  try {
    const plan = planSets(options.widths);
    const largest = plan[plan.length - 1]!.width;
    const fps = samplingFps(frames, duration);
    log(`Extracting ${frames} frames from ${duration.toFixed(2)}s of video...`);
    const extract = await run(ffmpeg, [
      "-hide_banner",
      "-loglevel", "error",
      "-i", options.input,
      "-vf", `fps=${fps},scale='min(${largest},iw)':-2:flags=lanczos`,
      "-frames:v", String(frames),
      join(tmp, "%06d.png"),
    ]);
    if (extract.code !== 0) throw new Error(`ffmpeg failed:\n${extract.stderr}`);

    const sources = (await readdir(tmp)).filter((f) => f.endsWith(".png")).sort();
    if (sources.length < 2) throw new UsageError("The video produced fewer than 2 frames.");

    const manifestBase = buildManifest(options, sources.length, []);
    const sets: FrameSet[] = [];
    const bytesBySet: Record<string, number> = {};
    const webp = options.lossless
      ? { lossless: true, effort: 6 }
      : { quality: options.quality, effort: 6, smartSubsample: true };

    for (const set of plan) {
      const dir = join(staging, set.dir);
      await mkdir(dir, { recursive: true });
      let size = { width: set.width, height: 0 };
      let bytes = 0;
      for (const [index, source] of sources.entries()) {
        const file = manifestBase.pattern.replace("{index}", String(index).padStart(manifestBase.padding, "0"));
        const info = await sharp(join(tmp, source))
          .resize({ width: set.width, withoutEnlargement: true })
          .webp(webp)
          .toFile(join(dir, file));
        if (index === 0) {
          size = { width: info.width, height: info.height };
          await copyFile(join(dir, file), join(dir, manifestBase.poster));
        }
        bytes += info.size;
      }
      sets.push({ ...set, ...size });
      bytesBySet[set.name] = bytes;
      log(`  ${set.name.padEnd(8)} ${size.width}x${size.height}  ${(bytes / 1024 / 1024).toFixed(1)} MB`);
    }

    const manifest = buildManifest(options, sources.length, sets);
    await writeFile(join(staging, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    await swapIntoPlace(options.out, staging, previous);
    return { manifest, manifestPath: join(options.out, "manifest.json"), bytesBySet };
  } finally {
    await rm(tmp, { recursive: true, force: true });
    await rm(staging, { recursive: true, force: true });
  }
}
