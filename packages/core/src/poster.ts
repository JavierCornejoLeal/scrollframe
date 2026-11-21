import { posterUrl, type SequenceManifest } from "./manifest.js";

/** One `<source>` of the poster `<picture>`, for a set with a viewport limit. */
export interface PosterSource {
  media: string;
  srcset: string;
  width: number;
  height: number;
  type: "image/webp";
}

/** Everything needed to render the poster `<picture>`: the LCP image search engines index. */
export interface PosterImage {
  /** Smallest viewport first, so the browser picks the first matching media query. */
  sources: PosterSource[];
  /** The largest set, used when no `<source>` matches. */
  img: { src: string; width: number; height: number };
}

export interface PosterMarkupOptions {
  /** Describes the scene; the poster's alt text. */
  alt: string;
  /** Above-the-fold hero: load eagerly with high priority. Default true. */
  priority?: boolean;
  /** Overrides `manifest.baseUrl` (e.g. a CDN). */
  baseUrl?: string;
}

/** Fills the sticky frame; matches the canvas painted on top of it. */
export const POSTER_FILL_STYLE = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover";

/** Poster data shared by every renderer (React, the custom element, generated snippets). */
export function posterImage(manifest: SequenceManifest, baseUrl?: string): PosterImage {
  const largest = manifest.sets[manifest.sets.length - 1]!;
  return {
    sources: manifest.sets
      .filter((set) => set.maxViewportWidth !== null)
      .map((set) => ({
        media: `(max-width: ${set.maxViewportWidth}px)`,
        srcset: posterUrl(manifest, set, baseUrl),
        width: set.width,
        height: set.height,
        type: "image/webp",
      })),
    img: { src: posterUrl(manifest, largest, baseUrl), width: largest.width, height: largest.height },
  };
}

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

function escapeAttr(value: string | number): string {
  return String(value).replace(/[&<>"']/g, (char) => ESCAPES[char]!);
}

function attrs(entries: [string, string | number][]): string {
  return entries.map(([name, value]) => `${name}="${escapeAttr(value)}"`).join(" ");
}

/**
 * The poster `<picture>` as an HTML string, for server templates and plain HTML pages.
 * Self-contained: it carries its own fill style, so no stylesheet is needed.
 */
export function renderPosterMarkup(manifest: SequenceManifest, options: PosterMarkupOptions): string {
  const { sources, img } = posterImage(manifest, options.baseUrl);
  const priority = options.priority ?? true;
  const sourceTags = sources.map(
    (s) =>
      `<source ${attrs([
        ["media", s.media],
        ["srcset", s.srcset],
        ["width", s.width],
        ["height", s.height],
        ["type", s.type],
      ])}>`,
  );
  const imgTag = `<img ${attrs([
    ["src", img.src],
    ["alt", options.alt],
    ["width", img.width],
    ["height", img.height],
    ["loading", priority ? "eager" : "lazy"],
    ["fetchpriority", priority ? "high" : "auto"],
    ["decoding", "async"],
    ["style", POSTER_FILL_STYLE],
  ])}>`;
  return `<picture>${sourceTags.join("")}${imgTag}</picture>`;
}

/** Pins the poster to the viewport while the section scrolls; inline so it works before any script runs. */
export const STAGE_STYLE = "position:sticky;top:0;height:100svh;overflow:hidden";

/**
 * The stage (sticky frame + poster) as an HTML string. Server templates and generated snippets put it
 * inside `<scroll-sequence>` so the poster is painted before the element's script loads; the element
 * adopts it instead of rendering its own.
 */
export function renderStageMarkup(manifest: SequenceManifest, options: PosterMarkupOptions): string {
  return `<div data-sf-stage="" style="${STAGE_STYLE}">${renderPosterMarkup(manifest, options)}</div>`;
}
