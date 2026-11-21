import { describe, expect, it } from "vitest";
import { parseManifest, posterImage, renderPosterMarkup } from "../src/index.js";

const manifest = parseManifest({
  version: 1,
  frameCount: 10,
  baseUrl: "/sequence",
  pattern: "frame-{index}.webp",
  padding: 4,
  poster: "poster.webp",
  sets: [
    { name: "desktop", maxViewportWidth: null, width: 1920, height: 1080, dir: "desktop" },
    { name: "mobile", maxViewportWidth: 767, width: 720, height: 405, dir: "mobile" },
    { name: "tablet", maxViewportWidth: 1279, width: 1280, height: 720, dir: "tablet" },
  ],
});

const single = parseManifest({ ...manifest, sets: [manifest.sets[2]!] }); // desktop, no upper bound

describe("posterImage", () => {
  it("lists one <source> per bounded set, smallest first, and the largest set as <img>", () => {
    expect(posterImage(manifest)).toEqual({
      sources: [
        { media: "(max-width: 767px)", srcset: "/sequence/mobile/poster.webp", width: 720, height: 405, type: "image/webp" },
        { media: "(max-width: 1279px)", srcset: "/sequence/tablet/poster.webp", width: 1280, height: 720, type: "image/webp" },
      ],
      img: { src: "/sequence/desktop/poster.webp", width: 1920, height: 1080 },
    });
  });

  it("uses the base URL override for every URL", () => {
    const { sources, img } = posterImage(manifest, "https://cdn.example.com/seq/");
    expect(sources.map((s) => s.srcset)).toEqual([
      "https://cdn.example.com/seq/mobile/poster.webp",
      "https://cdn.example.com/seq/tablet/poster.webp",
    ]);
    expect(img.src).toBe("https://cdn.example.com/seq/desktop/poster.webp");
  });

  it("has no <source> when the only set has no viewport limit", () => {
    expect(posterImage(single)).toEqual({
      sources: [],
      img: { src: "/sequence/desktop/poster.webp", width: 1920, height: 1080 },
    });
  });
});

describe("renderPosterMarkup", () => {
  const FILL = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover";

  it("renders a self-contained, high-priority <picture> by default", () => {
    expect(renderPosterMarkup(manifest, { alt: "Coffee being poured" })).toBe(
      "<picture>" +
        '<source media="(max-width: 767px)" srcset="/sequence/mobile/poster.webp" width="720" height="405" type="image/webp">' +
        '<source media="(max-width: 1279px)" srcset="/sequence/tablet/poster.webp" width="1280" height="720" type="image/webp">' +
        '<img src="/sequence/desktop/poster.webp" alt="Coffee being poured" width="1920" height="1080" ' +
        `loading="eager" fetchpriority="high" decoding="async" style="${FILL}">` +
        "</picture>",
    );
  });

  it("loads lazily with normal priority when priority is false", () => {
    const html = renderPosterMarkup(manifest, { alt: "x", priority: false });
    expect(html).toContain('loading="lazy" fetchpriority="auto"');
  });

  it("applies the base URL override", () => {
    const html = renderPosterMarkup(manifest, { alt: "x", baseUrl: "https://cdn.example.com/seq" });
    expect(html).toContain('srcset="https://cdn.example.com/seq/mobile/poster.webp"');
    expect(html).toContain('src="https://cdn.example.com/seq/desktop/poster.webp"');
  });

  it("escapes attribute values so alt text and URLs cannot break out of the markup", () => {
    const html = renderPosterMarkup(manifest, {
      alt: `Tom & Jerry's "best" <scene>`,
      baseUrl: 'https://cdn.example.com/"><script>',
    });
    expect(html).toContain('alt="Tom &amp; Jerry&#39;s &quot;best&quot; &lt;scene&gt;"');
    expect(html).not.toContain("<script>");
    expect(html).toContain('src="https://cdn.example.com/&quot;&gt;&lt;script&gt;/desktop/poster.webp"');
  });

  it("renders only the <img> when the only set has no viewport limit", () => {
    const html = renderPosterMarkup(single, { alt: "x" });
    expect(html).not.toContain("<source");
    expect(html).toMatch(/^<picture><img src="\/sequence\/desktop\/poster\.webp"[^>]*><\/picture>$/);
  });
});
