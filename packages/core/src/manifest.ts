/** One resolution of the sequence (mobile, tablet, desktop...). */
export interface FrameSet {
  name: string;
  /** Largest viewport width (CSS px) this set is meant for. `null` means "no upper limit". */
  maxViewportWidth: number | null;
  width: number;
  height: number;
  /** Folder of this set, relative to the manifest `baseUrl`. */
  dir: string;
}

export interface SequenceManifest {
  version: 1;
  frameCount: number;
  /** Public URL where the sequence folders are served from, e.g. `/sequence`. */
  baseUrl: string;
  /** File name pattern; `{index}` is replaced by the zero-padded frame index. */
  pattern: string;
  padding: number;
  /** Poster file name inside every set folder (first frame, used as LCP image). */
  poster: string;
  /** Sorted from smallest to largest viewport. */
  sets: FrameSet[];
}

export class ManifestError extends Error {
  override name = "ManifestError";
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPositiveInt(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

/** Validates unknown JSON and returns a typed manifest with sets sorted by viewport. */
export function parseManifest(input: unknown): SequenceManifest {
  if (!isObject(input)) throw new ManifestError("Manifest must be an object.");
  if (input.version !== 1) throw new ManifestError(`Unsupported manifest version: ${String(input.version)}.`);
  if (!isPositiveInt(input.frameCount)) throw new ManifestError("`frameCount` must be a positive integer.");
  if (typeof input.baseUrl !== "string") throw new ManifestError("`baseUrl` must be a string.");
  if (typeof input.pattern !== "string" || !input.pattern.includes("{index}")) {
    throw new ManifestError("`pattern` must be a string containing `{index}`.");
  }
  if (typeof input.padding !== "number" || input.padding < 0) throw new ManifestError("`padding` must be >= 0.");
  if (typeof input.poster !== "string") throw new ManifestError("`poster` must be a string.");
  if (!Array.isArray(input.sets) || input.sets.length === 0) throw new ManifestError("`sets` must be a non-empty array.");

  const sets = input.sets.map((set, i): FrameSet => {
    if (!isObject(set)) throw new ManifestError(`sets[${i}] must be an object.`);
    const { name, maxViewportWidth, width, height, dir } = set;
    if (typeof name !== "string" || typeof dir !== "string") {
      throw new ManifestError(`sets[${i}] needs string \`name\` and \`dir\`.`);
    }
    if (!isPositiveInt(width) || !isPositiveInt(height)) {
      throw new ManifestError(`sets[${i}] needs positive integer \`width\` and \`height\`.`);
    }
    if (maxViewportWidth !== null && !isPositiveInt(maxViewportWidth)) {
      throw new ManifestError(`sets[${i}].maxViewportWidth must be a positive integer or null.`);
    }
    return { name, dir, width, height, maxViewportWidth };
  });

  return {
    version: 1,
    frameCount: input.frameCount,
    baseUrl: input.baseUrl,
    pattern: input.pattern,
    padding: input.padding,
    poster: input.poster,
    sets: sortSets(sets),
  };
}

export function sortSets(sets: FrameSet[]): FrameSet[] {
  return [...sets].sort((a, b) => (a.maxViewportWidth ?? Infinity) - (b.maxViewportWidth ?? Infinity));
}

/** Picks the first set whose `maxViewportWidth` covers the viewport; falls back to the largest. */
export function selectFrameSet(manifest: SequenceManifest, viewportWidth: number): FrameSet {
  const match = manifest.sets.find((set) => set.maxViewportWidth === null || viewportWidth <= set.maxViewportWidth);
  return match ?? (manifest.sets[manifest.sets.length - 1] as FrameSet);
}

function joinUrl(...parts: string[]): string {
  return parts
    .filter((part) => part.length > 0)
    .map((part, i) => (i === 0 ? part.replace(/\/+$/, "") : part.replace(/^\/+|\/+$/g, "")))
    .join("/");
}

export function frameUrl(manifest: SequenceManifest, set: FrameSet, index: number, baseUrl = manifest.baseUrl): string {
  const file = manifest.pattern.replace("{index}", String(index).padStart(manifest.padding, "0"));
  return joinUrl(baseUrl, set.dir, file);
}

export function posterUrl(manifest: SequenceManifest, set: FrameSet, baseUrl = manifest.baseUrl): string {
  return joinUrl(baseUrl, set.dir, manifest.poster);
}
