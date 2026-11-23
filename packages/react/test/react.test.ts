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

  it("keeps its exact server-rendered HTML (poster, canvas, overlay)", () => {
    expect(
      renderToString(
        createElement(ScrollSequence, { manifest, alt: 'Coffee "&" <pour>' }, createElement("h1", null, "Our story")),
      ),
    ).toBe(
      '<section style="position:relative;height:300vh;width:100vw;max-width:none;flex-shrink:0;box-sizing:border-box;margin-left:calc(50% - 50vw);margin-right:calc(50% - 50vw)"><div style="position:sticky;top:0;height:100svh;overflow:hidden"><picture><source media="(max-width: 767px)" srcSet="/sequence/mobile/poster.webp" width="720" height="405" type="image/webp"/><img src="/sequence/desktop/poster.webp" alt="Coffee &quot;&amp;&quot; &lt;pour&gt;" width="1920" height="1080" loading="eager" fetchPriority="high" decoding="async" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"/></picture><canvas aria-hidden="true" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none"></canvas><div style="position:absolute;inset:0"><h1>Our story</h1></div></div></section>',
    );
    expect(
      renderToString(
        createElement(ScrollSequence, { manifest, alt: "x", priority: false, baseUrl: "https://cdn.example.com/seq" }),
      ),
    ).toBe(
      '<section style="position:relative;height:300vh;width:100vw;max-width:none;flex-shrink:0;box-sizing:border-box;margin-left:calc(50% - 50vw);margin-right:calc(50% - 50vw)"><div style="position:sticky;top:0;height:100svh;overflow:hidden"><picture><source media="(max-width: 767px)" srcSet="https://cdn.example.com/seq/mobile/poster.webp" width="720" height="405" type="image/webp"/><img src="https://cdn.example.com/seq/desktop/poster.webp" alt="x" width="1920" height="1080" loading="lazy" fetchPriority="auto" decoding="async" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover"/></picture><canvas aria-hidden="true" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none"></canvas><div style="position:absolute;inset:0"></div></div></section>',
    );
  });

  it("takes the scroll length of the sequence unless told otherwise", () => {
    const timed = { ...manifest, scrollLength: "630vh" };
    expect(render({ manifest: timed })).toContain("height:630vh");
    expect(render({ manifest: timed, scrollLength: "200vh" })).toContain("height:200vh");
  });

  it("fullWidth={false} leaves the width to the page, as before", () => {
    expect(render({ fullWidth: false })).toContain('<section style="position:relative;height:300vh">');
  });

  it("throws a clear error for an invalid manifest", () => {
    expect(() => render({ manifest: { version: 9 } })).toThrow("Unsupported manifest version: 9.");
  });
});
