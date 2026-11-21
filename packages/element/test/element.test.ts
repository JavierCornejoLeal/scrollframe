// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseManifest, renderPosterMarkup, renderStageMarkup } from "@scrollframe/core";

// Hoisted with vi.mock, which runs before the static import of @scrollframe/core above.
const { engines, FakeEngine } = vi.hoisted(() => {
  const engines: InstanceType<typeof FakeEngine>[] = [];
  class FakeEngine {
    started = 0;
    destroyed = 0;
    constructor(readonly options: import("@scrollframe/core").ScrollSequenceOptions) {
      engines.push(this);
    }
    start() {
      this.started++;
      return this;
    }
    destroy() {
      this.destroyed++;
    }
  }
  return { engines, FakeEngine };
});

vi.mock("@scrollframe/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@scrollframe/core")>()),
  ScrollSequence: FakeEngine,
}));

const { ScrollSequenceElement, defineScrollSequence } = await import("../src/index.js");

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

type Fetch = typeof fetch;
const jsonResponse = (body: unknown, status = 200) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as Response;

function create(attrs: Record<string, string> = {}, children: Node[] = []) {
  const el = document.createElement("scroll-sequence") as InstanceType<typeof ScrollSequenceElement>;
  for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
  el.append(...children);
  return el;
}

const stageOf = (el: Element) => el.querySelector(":scope > [data-sf-stage]") as HTMLElement | null;

beforeEach(() => {
  engines.length = 0;
});

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("<scroll-sequence> registration", () => {
  it("is registered as scroll-sequence, and defining again is a no-op", () => {
    expect(customElements.get("scroll-sequence")).toBe(ScrollSequenceElement);
    expect(() => defineScrollSequence()).not.toThrow();
    expect(customElements.get("scroll-sequence")).toBe(ScrollSequenceElement);
  });
});

describe("<scroll-sequence> rendering", () => {
  it("prepends a stage with the poster and a decorative canvas, leaving the children in place", () => {
    const heading = document.createElement("h1");
    heading.textContent = "Our story";
    const el = create({ alt: "Coffee being poured" }, [heading]);
    el.manifest = manifest;
    document.body.append(el);

    const stage = stageOf(el)!;
    expect(el.firstElementChild).toBe(stage);
    expect(stage.querySelector("picture")!.outerHTML).toBe(
      renderPosterMarkup(parseManifest(manifest), { alt: "Coffee being poured" }),
    );
    expect(stage.querySelector("canvas")!.getAttribute("aria-hidden")).toBe("true");
    expect(heading.parentElement).toBe(el);
    expect([...el.children]).toEqual([stage, heading]);
  });

  it("applies scroll-length, base-url and priority", () => {
    const el = create({ alt: "x", "scroll-length": "500vh", "base-url": "https://cdn.example.com/seq", priority: "false" });
    el.manifest = manifest;
    document.body.append(el);

    expect(el.style.getPropertyValue("--sf-scroll-length")).toBe("500vh");
    const img = el.querySelector("img")!;
    expect(img.getAttribute("src")).toBe("https://cdn.example.com/seq/desktop/poster.webp");
    expect(img.getAttribute("loading")).toBe("lazy");
    expect(img.getAttribute("fetchpriority")).toBe("auto");
  });

  it("injects its stylesheet once per document", () => {
    for (let i = 0; i < 2; i++) {
      const el = create({ alt: "x" });
      el.manifest = manifest;
      document.body.append(el);
    }
    expect(document.head.querySelectorAll("style[data-scrollframe]")).toHaveLength(1);
  });

  it("keeps framework-inserted children working (nodes inserted before an anchor)", () => {
    const anchor = document.createComment("ngIf");
    const el = create({ alt: "x" }, [anchor]);
    el.manifest = manifest;
    document.body.append(el);

    const late = document.createElement("p");
    expect(() => el.insertBefore(late, anchor)).not.toThrow();
    expect(late.parentElement).toBe(el);
  });
});

describe("<scroll-sequence> engine", () => {
  it("starts one engine bound to the element, its canvas and the base-url override", () => {
    const el = create({ alt: "x", "base-url": "https://cdn.example.com/seq" });
    el.manifest = manifest;
    document.body.append(el);

    expect(engines).toHaveLength(1);
    const [engine] = engines;
    expect(engine!.started).toBe(1);
    expect(engine!.options.container).toBe(el);
    expect(engine!.options.canvas).toBe(stageOf(el)!.querySelector("canvas"));
    expect(engine!.options.baseUrl).toBe("https://cdn.example.com/seq");
  });

  it("re-dispatches progress as sf-progress and readiness as sf-ready (bubbling)", () => {
    const el = create({ alt: "x" });
    el.manifest = manifest;
    document.body.append(el);
    const progress = vi.fn();
    const ready = vi.fn();
    document.body.addEventListener("sf-progress", (e) => progress((e as CustomEvent).detail));
    document.body.addEventListener("sf-ready", ready);

    engines[0]!.options.onProgress!(0.5, 3);
    engines[0]!.options.onReady!();

    expect(progress).toHaveBeenCalledWith({ progress: 0.5, frame: 3 });
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it("destroys the engine when removed and starts a new one when re-attached", () => {
    const el = create({ alt: "x" });
    el.manifest = manifest;
    document.body.append(el);
    el.remove();
    expect(engines[0]!.destroyed).toBe(1);

    document.body.append(el);
    expect(engines).toHaveLength(2);
    expect(engines[1]!.started).toBe(1);
    expect(el.querySelectorAll(":scope > [data-sf-stage]")).toHaveLength(1);
  });
});

describe("<scroll-sequence> src", () => {
  it("loads the manifest from src", async () => {
    const fetchMock = vi.fn<Fetch>(async () => jsonResponse(manifest));
    vi.stubGlobal("fetch", fetchMock);
    const el = create({ alt: "x", src: "/sequence/manifest.json" });
    document.body.append(el);

    await vi.waitFor(() => expect(engines).toHaveLength(1));
    expect(fetchMock).toHaveBeenCalledWith("/sequence/manifest.json", expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(el.querySelector("img")!.getAttribute("src")).toBe("/sequence/desktop/poster.webp");
  });

  it("reloads when src changes", async () => {
    const fetchMock = vi.fn<Fetch>(async () => jsonResponse(manifest));
    vi.stubGlobal("fetch", fetchMock);
    const el = create({ alt: "x", src: "/a/manifest.json" });
    document.body.append(el);
    await vi.waitFor(() => expect(engines).toHaveLength(1));

    el.setAttribute("src", "/b/manifest.json");
    await vi.waitFor(() => expect(engines).toHaveLength(2));
    expect(fetchMock).toHaveBeenLastCalledWith("/b/manifest.json", expect.anything());
    expect(engines[0]!.destroyed).toBe(1);
  });

  it("ignores a manifest that arrives after the element was removed", async () => {
    let resolve!: (r: Response) => void;
    vi.stubGlobal("fetch", vi.fn<Fetch>(() => new Promise<Response>((r) => (resolve = r))));
    const el = create({ alt: "x", src: "/sequence/manifest.json" });
    document.body.append(el);
    el.remove();

    resolve(jsonResponse(manifest));
    await new Promise((r) => setTimeout(r, 0));
    expect(engines).toHaveLength(0);
    expect(el.querySelector("img")).toBeNull();
  });

  it("reports a failed request and an invalid manifest as sf-error without throwing", async () => {
    const errors: string[] = [];
    document.body.addEventListener("sf-error", (e) => errors.push(String((e as CustomEvent).detail.error.message)));

    vi.stubGlobal("fetch", vi.fn<Fetch>(async () => jsonResponse({}, 404)));
    document.body.append(create({ alt: "x", src: "/missing.json" }));
    await vi.waitFor(() => expect(errors).toHaveLength(1));
    expect(errors[0]).toBe("Could not load /missing.json (HTTP 404).");

    vi.stubGlobal("fetch", vi.fn<Fetch>(async () => jsonResponse({ version: 9 })));
    document.body.append(create({ alt: "x", src: "/bad.json" }));
    await vi.waitFor(() => expect(errors).toHaveLength(2));
    expect(errors[1]).toBe("Unsupported manifest version: 9.");
    expect(engines).toHaveLength(0);
  });
});

describe("<scroll-sequence> server-rendered poster", () => {
  /** What a server template or the CLI snippet outputs inside the element. */
  function serverRendered(src: string) {
    const el = create({ alt: "Scene", src });
    el.innerHTML = renderStageMarkup(parseManifest(manifest), { alt: "Scene" }) + "<h1>Our story</h1>";
    return el;
  }

  it("adopts the pre-rendered stage and keeps its poster image while and after the manifest loads", async () => {
    let resolve!: (r: Response) => void;
    vi.stubGlobal("fetch", vi.fn<Fetch>(() => new Promise<Response>((r) => (resolve = r))));
    const el = serverRendered("/sequence/manifest.json");
    const img = el.querySelector("img")!;
    document.body.append(el);
    expect(el.querySelector("img")).toBe(img); // visible before the manifest arrives

    resolve(jsonResponse(manifest));
    await vi.waitFor(() => expect(engines).toHaveLength(1));
    expect(el.querySelectorAll(":scope > [data-sf-stage]")).toHaveLength(1);
    expect(el.querySelector("img")).toBe(img);
    expect(engines[0]!.options.canvas).toBe(stageOf(el)!.querySelector("canvas"));
    expect(el.lastElementChild!.tagName).toBe("H1");
  });

  it("keeps the same poster image when the element is moved in the DOM", () => {
    const el = create({ alt: "x" });
    el.manifest = manifest;
    document.body.append(el);
    const img = el.querySelector("img")!;
    const canvas = el.querySelector("canvas")!;

    document.body.prepend(el); // disconnect + connect
    expect(el.querySelector("img")).toBe(img);
    expect(el.querySelector("canvas")).toBe(canvas);
    expect(el.querySelectorAll("canvas")).toHaveLength(1);
  });

  it("renders a new poster when the manifest source changes", async () => {
    const other = { ...manifest, baseUrl: "/other" };
    vi.stubGlobal("fetch", vi.fn<Fetch>(async (url) => jsonResponse(String(url).startsWith("/other") ? other : manifest)));
    const el = serverRendered("/sequence/manifest.json");
    document.body.append(el);
    await vi.waitFor(() => expect(engines).toHaveLength(1));

    el.setAttribute("src", "/other/manifest.json");
    await vi.waitFor(() => expect(engines).toHaveLength(2));
    expect(el.querySelectorAll("img")).toHaveLength(1);
    expect(el.querySelector("img")!.getAttribute("src")).toBe("/other/desktop/poster.webp");
  });
});
