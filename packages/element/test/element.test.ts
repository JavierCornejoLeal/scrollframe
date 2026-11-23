// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseManifest, renderPosterMarkup, renderStageMarkup } from "@scrollframe/core";

// Hoisted with vi.mock, which runs before the static import of @scrollframe/core above.
const { engines, FakeEngine } = vi.hoisted(() => {
  const engines: InstanceType<typeof FakeEngine>[] = [];
  class FakeEngine {
    /** Makes the next start() throw, like a real engine failing on a broken canvas. */
    static failNextStart = false;
    started = 0;
    destroyed = 0;
    constructor(readonly options: import("@scrollframe/core").ScrollSequenceOptions) {
      engines.push(this);
    }
    start() {
      if (FakeEngine.failNextStart) {
        FakeEngine.failNextStart = false;
        throw new Error("engine failed to start");
      }
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

describe("<scroll-sequence> upgrade (script loaded after the HTML, e.g. defer or a CDN)", () => {
  let tagCount = 0;
  /** A tag name that is not defined yet, so defining it upgrades elements already in the page. */
  const lateTag = () => `late-sequence-${++tagCount}`;

  it("requests the manifest once when an element already in the page is upgraded", async () => {
    const fetchMock = vi.fn<Fetch>(async () => jsonResponse(manifest));
    vi.stubGlobal("fetch", fetchMock);
    const tag = lateTag();
    document.body.innerHTML = `<${tag} src="/sequence/manifest.json" alt="Scene" scroll-length="400vh"></${tag}>`;

    defineScrollSequence(tag);
    await vi.waitFor(() => expect(engines).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(engines[0]!.destroyed).toBe(0);
  });

  it("uses a manifest assigned before the element was upgraded", () => {
    const fetchMock = vi.fn<Fetch>();
    vi.stubGlobal("fetch", fetchMock);
    const tag = lateTag();
    const el = document.createElement(tag) as InstanceType<typeof ScrollSequenceElement>;
    el.setAttribute("alt", "Scene");
    el.manifest = manifest; // plain property: the class is not defined yet
    document.body.append(el);

    defineScrollSequence(tag);
    expect(engines).toHaveLength(1);
    expect(engines[0]!.options.manifest.frameCount).toBe(10);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(el.manifest).toBe(manifest);
  });
});

describe("<scroll-sequence> failures after the manifest is valid", () => {
  it("reports an engine failure as sf-error instead of throwing", () => {
    const errors: string[] = [];
    document.body.addEventListener("sf-error", (e) => errors.push((e as CustomEvent).detail.error.message));
    FakeEngine.failNextStart = true;
    const el = create({ alt: "x" });
    el.manifest = manifest;

    expect(() => document.body.append(el)).not.toThrow();
    expect(errors).toEqual(["engine failed to start"]);
  });
});

describe("<scroll-sequence> poster state", () => {
  it("replaces an adopted poster that differs from its attributes on the next refresh", async () => {
    const el = create({ alt: "New alt" });
    el.innerHTML = renderStageMarkup(parseManifest(manifest), { alt: "Old alt" });
    const serverImg = el.querySelector("img")!;
    el.manifest = manifest;
    document.body.append(el);
    expect(el.querySelector("img")).toBe(serverImg); // first paint: the server poster is kept

    el.setAttribute("scroll-length", "400vh"); // any refresh
    await vi.waitFor(() => expect(engines).toHaveLength(2));
    expect(el.querySelector("img")!.getAttribute("alt")).toBe("New alt");
    expect(el.querySelectorAll("img")).toHaveLength(1);
  });
});

describe("<scroll-sequence> size", () => {
  it("is full width unless full-width is false", () => {
    for (const [attrs, expected] of [[{}, true], [{ "full-width": "false" }, false]] as const) {
      engines.length = 0;
      const el = create(attrs);
      el.manifest = manifest;
      document.body.append(el);
      expect(engines[0]!.options.fullWidth).toBe(expected);
    }
  });

  it("takes the scroll length of the sequence unless the attribute is set", () => {
    for (const [attrs, expected] of [[{}, "630vh"], [{ "scroll-length": "200vh" }, "200vh"]] as const) {
      const el = create(attrs);
      el.manifest = { ...manifest, scrollLength: "630vh" };
      document.body.append(el);
      expect(el.style.getPropertyValue("--sf-scroll-length")).toBe(expected);
    }
  });
});

describe("<scroll-sequence> scroll length from the page", () => {
  it("keeps the length written in the page while the manifest loads, then takes the manifest's", async () => {
    let answer: (response: Response) => void = () => {};
    vi.stubGlobal("fetch", (() => new Promise<Response>((resolve) => (answer = resolve))) as unknown as Fetch);
    const el = create({ src: "/sequence/manifest.json" });
    el.style.setProperty("--sf-scroll-length", "630vh");
    document.body.append(el);
    expect(el.style.getPropertyValue("--sf-scroll-length")).toBe("630vh");
    answer(jsonResponse({ ...manifest, scrollLength: "900vh" }));
    await vi.waitFor(() => expect(el.style.getPropertyValue("--sf-scroll-length")).toBe("900vh"));
  });

  it("goes back to the default for a manifest without a length", async () => {
    vi.stubGlobal("fetch", (async () => jsonResponse(manifest)) as unknown as Fetch);
    const el = create({ src: "/sequence/manifest.json" });
    el.style.setProperty("--sf-scroll-length", "630vh");
    document.body.append(el);
    await vi.waitFor(() => expect(engines).toHaveLength(1));
    expect(el.style.getPropertyValue("--sf-scroll-length")).toBe("");
  });
});

describe("<scroll-sequence> without its manifest", () => {
  it("still spans the page exactly, so 100vw leaves no sideways scroll", async () => {
    Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, value: 1265 });
    vi.stubGlobal("fetch", (async () => jsonResponse({}, 404)) as unknown as Fetch);
    const failed = vi.fn();
    const el = create({ src: "/missing/manifest.json" });
    el.addEventListener("sf-error", failed);
    document.body.append(el);
    await vi.waitFor(() => expect(failed).toHaveBeenCalled());
    expect(engines).toHaveLength(0);
    expect(el.style.width).toBe("1265px");
    el.remove();
    expect(el.style.width).toBe("");
    delete (document.documentElement as { clientWidth?: number }).clientWidth;
  });

  it("leaves the width alone when full-width is false", async () => {
    Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, value: 1265 });
    vi.stubGlobal("fetch", (async () => jsonResponse({}, 404)) as unknown as Fetch);
    const failed = vi.fn();
    const el = create({ src: "/missing/manifest.json", "full-width": "false" });
    el.addEventListener("sf-error", failed);
    document.body.append(el);
    await vi.waitFor(() => expect(failed).toHaveBeenCalled());
    expect(el.style.width).toBe("");
    delete (document.documentElement as { clientWidth?: number }).clientWidth;
  });
});
