import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ScrollSequence } from "../src/index.js";

const manifest = {
  version: 1,
  frameCount: 10,
  baseUrl: "/sequence",
  pattern: "frame-{index}.webp",
  padding: 4,
  poster: "poster.webp",
  sets: [
    { name: "mobile", maxViewportWidth: 767, width: 720, height: 405, dir: "mobile" },
    { name: "desktop", maxViewportWidth: null, width: 1920, height: 1080, dir: "desktop" },
  ],
};

function render(props: Partial<Parameters<typeof ScrollSequence>[0]> = {}) {
  return renderToString(
    createElement(ScrollSequence, { manifest, alt: "Coffee being poured", ...props }, createElement("h1", null, "Our story")),
  );
}

describe("ScrollSequence (SSR)", () => {
  it("server-renders an indexable poster with alt text and fixed dimensions", () => {
    const html = render();
    expect(html).toContain('alt="Coffee being poured"');
    expect(html).toContain('src="/sequence/desktop/poster.webp"');
    expect(html).toContain('width="1920"');
    expect(html).toContain('height="1080"');
    expect(html).toContain('media="(max-width: 767px)"');
    expect(html).toContain('srcSet="/sequence/mobile/poster.webp"');
  });

  it("marks the canvas as decorative and renders overlays as real HTML", () => {
    const html = render();
    expect(html).toMatch(/<canvas[^>]*aria-hidden="true"/);
    expect(html).toContain("<h1>Our story</h1>");
  });

  it("loads the poster eagerly with high priority by default, lazily otherwise", () => {
    expect(render()).toMatch(/loading="eager"[^>]*fetchPriority="high"|fetchPriority="high"[^>]*loading="eager"/);
    expect(render({ priority: false })).toContain('loading="lazy"');
  });

  it("uses the scroll length as section height", () => {
    expect(render({ scrollLength: "500vh" })).toContain("height:500vh");
  });

  it("throws a clear error for an invalid manifest", () => {
    expect(() => render({ manifest: { version: 9 } })).toThrow("Unsupported manifest version: 9.");
  });
});
