// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROGRESS_CSS_VAR, ScrollSequence, parseManifest, type ScrollSequenceOptions } from "../src/index.js";

const manifest = parseManifest({
  version: 1,
  frameCount: 40,
  baseUrl: "/seq",
  pattern: "f-{index}.webp",
  padding: 2,
  poster: "poster.webp",
  sets: [
    { name: "mobile", maxViewportWidth: 767, width: 720, height: 405, dir: "m" },
    { name: "desktop", maxViewportWidth: null, width: 1920, height: 1080, dir: "d" },
  ],
});

/**
 * Fake <img>: setting src downloads (recorded once per url, like the browser's cache), decode()
 * waits for the download, and each test decides when and whether it arrives.
 */
class FakeImage {
  static requests: string[] = [];
  static pending = new Map<string, { resolve: () => void; reject: (e: Error) => void }>();
  static arrived = new Set<string>();
  static waiting = new Map<string, FakeImage[]>();
  static decoded: string[] = [];
  decoding = "";
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private url = "";
  private settle: ((ok: boolean) => void)[] = [];

  get src() {
    return this.url;
  }
  set src(url: string) {
    this.url = url;
    if (FakeImage.arrived.has(url)) {
      queueMicrotask(() => this.finish(true));
      return;
    }
    const waiting = FakeImage.waiting.get(url);
    if (waiting) {
      waiting.push(this);
      return;
    }
    const images: FakeImage[] = [this];
    FakeImage.waiting.set(url, images);
    FakeImage.requests.push(url);
    const end = (ok: boolean) => {
      FakeImage.waiting.delete(url);
      FakeImage.pending.delete(url);
      if (ok) FakeImage.arrived.add(url);
      for (const image of images) image.finish(ok);
    };
    FakeImage.pending.set(url, { resolve: () => end(true), reject: () => end(false) });
  }
  private finish(ok: boolean) {
    (ok ? this.onload : this.onerror)?.();
    for (const settle of this.settle.splice(0)) settle(ok);
  }
  decode(): Promise<void> {
    FakeImage.decoded.push(this.url);
    if (FakeImage.arrived.has(this.url)) return Promise.resolve();
    return new Promise((resolve, reject) => this.settle.push((ok) => (ok ? resolve() : reject(new Error("failed")))));
  }
}

class FakeObserver {
  static instances: FakeObserver[] = [];
  observed: Element[] = [];
  disconnected = false;
  constructor(
    readonly callback: (entries: { isIntersecting: boolean }[]) => void,
    readonly options: IntersectionObserverInit,
  ) {
    FakeObserver.instances.push(this);
  }
  observe(el: Element) {
    this.observed.push(el);
  }
  disconnect() {
    this.disconnected = true;
  }
  intersect() {
    this.callback([{ isIntersecting: true }]);
  }
}

let rafQueue: FrameRequestCallback[] = [];
/** Engines listen on the shared jsdom window, so every test destroys the ones it created. */
const live: ScrollSequence[] = [];
let drawImage: ReturnType<typeof vi.fn>;
let rect = { top: 0, height: 3000 };
let reducedMotion = false;

function setViewport(width: number, height = 1000) {
  Object.defineProperty(window, "innerWidth", { configurable: true, value: width });
  Object.defineProperty(window, "innerHeight", { configurable: true, value: height });
}

function flushFrames() {
  const queue = rafQueue;
  rafQueue = [];
  for (const cb of queue) cb(0);
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function load(url: string) {
  const entry = FakeImage.pending.get(url);
  if (!entry) throw new Error(`not requested: ${url}`);
  entry.resolve();
  await tick();
}

function create(extra: Partial<ScrollSequenceOptions> = {}) {
  const container = document.createElement("section");
  container.getBoundingClientRect = () => ({ top: rect.top, height: rect.height }) as DOMRect;
  const canvas = document.createElement("canvas");
  const engine = new ScrollSequence({ container, canvas, manifest, smoothing: 0, ...extra });
  live.push(engine);
  return { engine, container, canvas };
}

beforeEach(() => {
  FakeImage.requests = [];
  FakeImage.pending = new Map();
  FakeImage.arrived = new Set();
  FakeImage.waiting = new Map();
  FakeImage.decoded = [];
  FakeObserver.instances = [];
  rafQueue = [];
  rect = { top: 0, height: 3000 };
  reducedMotion = false;
  drawImage = vi.fn();
  setViewport(375);
  vi.stubGlobal("Image", FakeImage);
  vi.stubGlobal("IntersectionObserver", FakeObserver);
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => rafQueue.push(cb));
  vi.stubGlobal("cancelAnimationFrame", () => {});
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce") && reducedMotion }));
  HTMLCanvasElement.prototype.getContext = (() => ({ drawImage })) as never;
});

afterEach(() => {
  for (const engine of live.splice(0)) engine.destroy();
  vi.unstubAllGlobals();
});

describe("ScrollSequence engine", () => {
  it("sizes the canvas to the frame set of the current viewport", () => {
    expect(create().canvas).toMatchObject({ width: 720, height: 405 });
    setViewport(1440);
    expect(create().canvas).toMatchObject({ width: 1920, height: 1080 });
  });

  it("downloads nothing until the section approaches the viewport", async () => {
    create().engine.start();
    await tick();
    expect(FakeImage.requests).toEqual([]);
    expect(FakeObserver.instances[0]!.options.rootMargin).toBe("100% 0px");
  });

  it("then fetches only the matching set, coarse-to-fine, within the concurrency limit", async () => {
    create({ concurrency: 3 }).engine.start();
    FakeObserver.instances[0]!.intersect();
    await tick();
    expect(FakeImage.requests).toEqual(["/seq/m/f-00.webp", "/seq/m/f-16.webp", "/seq/m/f-32.webp"]);
    await load("/seq/m/f-00.webp");
    expect(FakeImage.requests[3]).toBe("/seq/m/f-39.webp");
    expect(FakeImage.requests.every((url) => url.startsWith("/seq/m/"))).toBe(true);
  });

  it("paints the nearest loaded frame and exposes progress to CSS and callbacks", async () => {
    const onProgress = vi.fn();
    const onReady = vi.fn();
    const { engine, container } = create({ onProgress, onReady });
    engine.start();
    FakeObserver.instances[0]!.intersect();
    await tick();
    await load("/seq/m/f-16.webp");

    rect.top = -1000; // halfway: (3000 - 1000) / 2
    window.dispatchEvent(new Event("scroll"));
    flushFrames();

    expect(container.style.getPropertyValue(PROGRESS_CSS_VAR)).toBe("0.5000");
    expect(onProgress).toHaveBeenLastCalledWith(0.5, 20);
    expect(drawImage).toHaveBeenCalledTimes(1);
    const [image, x, y, w, h] = drawImage.mock.calls[0]!;
    expect((image as FakeImage).src).toBe("/seq/m/f-16.webp");
    expect([x, y, w, h]).toEqual([0, 0, 720, 405]);
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it("does not repaint the same frame twice", async () => {
    const { engine } = create();
    engine.start();
    FakeObserver.instances[0]!.intersect();
    await tick();
    await load("/seq/m/f-00.webp");
    flushFrames();
    window.dispatchEvent(new Event("scroll"));
    flushFrames();
    expect(drawImage).toHaveBeenCalledTimes(1);
  });

  it("skips frames that fail to load and paints a neighbour", async () => {
    const { engine } = create({ concurrency: 1 });
    engine.start();
    FakeObserver.instances[0]!.intersect();
    await tick();
    FakeImage.pending.get("/seq/m/f-00.webp")!.reject(new Error("404"));
    await tick();
    await load("/seq/m/f-16.webp");
    flushFrames();
    expect((drawImage.mock.calls.at(-1)![0] as FakeImage).src).toBe("/seq/m/f-16.webp");
  });

  it.each([
    ["prefers-reduced-motion", () => (reducedMotion = true)],
    ["Save-Data", () => vi.stubGlobal("navigator", { connection: { saveData: true } })],
  ])("shows only the poster under %s", async (_, setup) => {
    setup();
    create().engine.start();
    await tick();
    expect(FakeObserver.instances).toHaveLength(0);
    expect(FakeImage.requests).toEqual([]);
  });

  it("switches frame set on resize across a breakpoint and ignores late frames of the old set", async () => {
    const { engine, canvas } = create({ concurrency: 1 });
    engine.start();
    FakeObserver.instances[0]!.intersect();
    await tick();

    setViewport(1440);
    window.dispatchEvent(new Event("resize"));
    await tick();
    expect(canvas).toMatchObject({ width: 1920, height: 1080 });
    expect(FakeImage.requests).toContain("/seq/d/f-00.webp");

    await load("/seq/m/f-00.webp"); // stale mobile frame arrives late
    flushFrames();
    expect(drawImage).not.toHaveBeenCalled();
  });

  it("does not start downloading on resize before the section was ever near", async () => {
    create().engine.start();
    setViewport(1440);
    window.dispatchEvent(new Event("resize"));
    await tick();
    expect(FakeImage.requests).toEqual([]);
  });

  it("start() is idempotent", async () => {
    const { engine } = create();
    engine.start();
    engine.start();
    expect(FakeObserver.instances).toHaveLength(1);
  });

  it("destroy() stops observing, listening and painting", async () => {
    const { engine } = create();
    engine.start();
    FakeObserver.instances[0]!.intersect();
    await tick();
    engine.destroy();
    expect(FakeObserver.instances[0]!.disconnected).toBe(true);

    await load("/seq/m/f-00.webp");
    window.dispatchEvent(new Event("scroll"));
    flushFrames();
    expect(drawImage).not.toHaveBeenCalled();
    expect(engine.start()).toBe(engine);
    expect(FakeObserver.instances).toHaveLength(1);
  });
});

describe("ScrollSequence recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const flush = () => vi.advanceTimersByTimeAsync(0);

  async function failEverything() {
    for (let i = 0; i < 100 && FakeImage.pending.size > 0; i++) {
      const entries = [...FakeImage.pending.values()];
      FakeImage.pending.clear();
      for (const entry of entries) entry.reject(new Error("offline"));
      await flush();
    }
  }

  async function startOffline() {
    const engine = create().engine.start();
    FakeObserver.instances[0]!.intersect();
    await flush();
    await failEverything();
    FakeImage.requests = [];
    return engine;
  }

  it("retries failed frames with backoff and paints once they arrive", async () => {
    await startOffline();
    await vi.advanceTimersByTimeAsync(999);
    expect(FakeImage.requests).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(FakeImage.requests[0]).toBe("/seq/m/f-00.webp");

    FakeImage.pending.get("/seq/m/f-00.webp")!.resolve();
    await flush();
    flushFrames();
    expect((drawImage.mock.calls.at(-1)![0] as FakeImage).src).toBe("/seq/m/f-00.webp");
  });

  it("retries immediately when the browser comes back online", async () => {
    await startOffline();
    window.dispatchEvent(new Event("online"));
    await flush();
    expect(FakeImage.requests).toHaveLength(6);
  });

  it("only re-requests frames that are still missing", async () => {
    create({ concurrency: 1 }).engine.start();
    FakeObserver.instances[0]!.intersect();
    await flush();
    FakeImage.pending.get("/seq/m/f-00.webp")!.resolve();
    await flush();
    await failEverything();
    FakeImage.requests = [];
    window.dispatchEvent(new Event("online"));
    await flush();
    expect(FakeImage.requests).toEqual(["/seq/m/f-16.webp"]);
  });

  it("gives up after a bounded number of automatic retries", async () => {
    await startOffline();
    for (let attempt = 0; attempt < 3; attempt++) {
      await vi.advanceTimersByTimeAsync(60_000);
      await failEverything();
    }
    FakeImage.requests = [];
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(FakeImage.requests).toEqual([]);
  });

  it("keeps the backoff while scrolling a long sequence that keeps failing", async () => {
    const timers = vi.spyOn(globalThis, "setTimeout");
    create({ manifest: parseManifest({ ...manifest, frameCount: 1800, padding: 4 }) }).engine.start();
    FakeObserver.instances[0]!.intersect();
    for (let step = 1; step <= 30; step++) {
      rect.top = -60 * step;
      window.dispatchEvent(new Event("scroll"));
      flushFrames();
      await failEverything();
      await vi.advanceTimersByTimeAsync(100);
    }
    const delays = timers.mock.calls.map(([, ms]) => ms ?? 0).filter((ms) => ms >= 1000);
    timers.mockRestore();
    // Three seconds of scrolling while offline: only the first retry has come due.
    expect(delays).toEqual([1000, 2000]);
  });

  it("a frame that failed to decode is tried again, not left as a hole", async () => {
    create({ concurrency: 1 }).engine.start();
    FakeObserver.instances[0]!.intersect();
    await flush();
    const decode = FakeImage.prototype.decode;
    let failures = 0;
    // Downloaded fine, but its first decode fails (memory pressure, an evicted cache entry).
    FakeImage.prototype.decode = function (this: FakeImage) {
      if (this.src.endsWith("f-00.webp") && failures++ === 0) return Promise.reject(new Error("decode"));
      return decode.call(this);
    };
    try {
      for (let i = 0; i < 400 && FakeImage.pending.size > 0; i++) {
        for (const entry of [...FakeImage.pending.values()]) entry.resolve();
        await flush();
      }
      flushFrames();
      await vi.advanceTimersByTimeAsync(1000);
      for (let i = 0; i < 20; i++) {
        for (const entry of [...FakeImage.pending.values()]) entry.resolve();
        await flush();
        flushFrames();
      }
      expect(failures).toBeGreaterThan(1);
      expect((drawImage.mock.calls.at(-1)![0] as FakeImage).src).toBe("/seq/m/f-00.webp");
    } finally {
      FakeImage.prototype.decode = decode;
    }
  });

  it("after an outage longer than the retries, what failed is asked again once downloads work", async () => {
    create({ manifest: parseManifest({ ...manifest, frameCount: 1800, padding: 4 }) }).engine.start();
    FakeObserver.instances[0]!.intersect();
    // A 10 s outage: every download fails and the three retries (1, 2 and 4 s) are spent.
    for (let i = 0; i < 12; i++) {
      await failEverything();
      await vi.advanceTimersByTimeAsync(1000);
    }
    await failEverything();
    FakeImage.requests = [];
    // The server is back: the reader scrolls on, and those new downloads work.
    rect.top = -400;
    window.dispatchEvent(new Event("scroll"));
    flushFrames();
    for (let i = 0; i < 40; i++) {
      for (const entry of [...FakeImage.pending.values()]) entry.resolve();
      await vi.advanceTimersByTimeAsync(200);
      flushFrames();
    }
    // 1799 belongs to the coarse pass and failed during the outage.
    expect(FakeImage.requests).toContain("/seq/m/f-1799.webp");
  });

  it("a frame that is never there is not asked for faster than the backoff while scrolling", async () => {
    create({ manifest: parseManifest({ ...manifest, frameCount: 1800, padding: 4 }) }).engine.start();
    FakeObserver.instances[0]!.intersect();
    const missing = "/seq/m/f-0000.webp";
    // A minute of reading: everything loads except one frame, which always answers 404.
    for (let second = 0; second < 60; second++) {
      rect.top = -30 * second;
      window.dispatchEvent(new Event("scroll"));
      for (let step = 0; step < 5; step++) {
        for (const [url, entry] of [...FakeImage.pending.entries()]) (url === missing ? entry.reject : entry.resolve)(new Error("404"));
        await vi.advanceTimersByTimeAsync(200);
        flushFrames();
      }
    }
    // The backoff (1, 2, 4 s, then again once downloads work) allows about 26 a minute; one a second would be 60.
    expect(FakeImage.requests.filter((url) => url === missing).length).toBeLessThan(35);
  });

  it("cancels pending retries on destroy", async () => {
    const engine = await startOffline();
    engine.destroy();
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeImage.requests).toEqual([]);
  });
});

describe("sticky blockers", () => {
  /** Puts a fresh section inside `wrapper` (in the document) and starts an engine on it. */
  function startInside(wrapper: HTMLElement) {
    const container = document.createElement("section");
    container.getBoundingClientRect = () => ({ top: 0, height: 3000 }) as DOMRect;
    wrapper.append(container);
    const engine = new ScrollSequence({ container, canvas: document.createElement("canvas"), manifest }).start();
    live.push(engine);
    return engine;
  }

  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => {
    warn.mockRestore();
    document.documentElement.removeAttribute("style");
    document.body.removeAttribute("style");
    document.body.replaceChildren();
  });

  it("warns once when an ancestor's overflow stops the sequence from staying pinned", () => {
    const wrapper = document.createElement("div");
    wrapper.className = "page";
    wrapper.style.overflowX = "hidden";
    document.body.append(wrapper);
    startInside(wrapper);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toBe(
      'scrollframe: div.page has "overflow-x: hidden", so the sequence cannot stay pinned while scrolling. Use "overflow-x: clip" instead: it hides the overflow the same way without creating a scroll container.',
    );
  });

  it("warns for body when html also has overflow (the Next.js 16 default globals.css)", () => {
    document.documentElement.style.overflowX = "hidden";
    document.body.style.overflowX = "hidden";
    startInside(document.body);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/^scrollframe: body has "overflow-x: hidden"/);
  });

  it("does not warn when only body has overflow (it applies to the viewport) or with overflow: clip", () => {
    document.body.style.overflowX = "hidden";
    startInside(document.body);
    const wrapper = document.createElement("div");
    wrapper.style.overflowX = "clip";
    document.body.append(wrapper);
    startInside(wrapper);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("sticky blockers: scrolling containers", () => {
  it("does not recommend clip for a container that is meant to scroll", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const shell = document.createElement("div");
    shell.className = "shell";
    shell.style.overflowY = "auto";
    document.body.append(shell);
    const container = document.createElement("section");
    container.getBoundingClientRect = () => ({ top: 0, height: 3000 }) as DOMRect;
    shell.append(container);
    live.push(new ScrollSequence({ container, canvas: document.createElement("canvas"), manifest }).start());
    expect(warn.mock.calls[0]![0]).toBe(
      'scrollframe: div.shell scrolls its own content ("overflow-y: auto"), but the sequence follows the page scroll. Place the sequence outside that scrolling container.',
    );
    warn.mockRestore();
    shell.remove();
  });
});

describe("sticky blockers: one hidden axis", () => {
  it("recommends clip for the hidden axis even when the other one computes to auto", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const wrapper = document.createElement("div");
    wrapper.className = "page";
    // Browsers compute overflow-x: auto when only overflow-y is hidden.
    wrapper.style.overflowX = "auto";
    wrapper.style.overflowY = "hidden";
    document.body.append(wrapper);
    const container = document.createElement("section");
    container.getBoundingClientRect = () => ({ top: 0, height: 3000 }) as DOMRect;
    wrapper.append(container);
    live.push(new ScrollSequence({ container, canvas: document.createElement("canvas"), manifest }).start());
    expect(warn.mock.calls[0]![0]).toMatch(/^scrollframe: div\.page has "overflow-y: hidden".*Use "overflow-y: clip" instead/);
    warn.mockRestore();
    wrapper.remove();
  });
});

describe("fluid scrolling", () => {
  const long = parseManifest({ ...manifest, frameCount: 1800, padding: 4 });
  const at = (url: string) => Number(/f-(\d+)/.exec(url)![1]);

  async function downloadAll(limit = 5000) {
    for (let i = 0; i < limit && FakeImage.pending.size > 0; i++) {
      for (const entry of [...FakeImage.pending.values()]) entry.resolve();
      await tick();
    }
  }
  function scrollTo(progress: number) {
    rect.top = -2000 * progress;
    window.dispatchEvent(new Event("scroll"));
  }
  async function settle(times = 30) {
    for (let i = 0; i < times; i++) {
      flushFrames();
      await tick();
    }
  }

  it("eases towards the scroll position instead of jumping to it", async () => {
    const onProgress = vi.fn();
    const { engine } = create({ smoothing: 80, onProgress });
    engine.start();
    flushFrames();
    scrollTo(1);
    flushFrames();
    const [first] = onProgress.mock.calls.at(-1)!;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(0.5);
    await settle(80);
    expect(onProgress).toHaveBeenLastCalledWith(1, 39);
  });

  it("starts at the scroll position of a restored page without easing to it", () => {
    const onProgress = vi.fn();
    rect.top = -1000;
    create({ smoothing: 80, onProgress }).engine.start();
    flushFrames();
    expect(onProgress).toHaveBeenLastCalledWith(0.5, 20);
  });

  it("stops asking for animation frames once it has arrived", async () => {
    create({ smoothing: 80 }).engine.start();
    flushFrames();
    scrollTo(0.5);
    await settle(80);
    expect(rafQueue).toEqual([]);
  });

  it("decodes only a window of frames around the scroll position", async () => {
    create({ manifest: parseManifest({ ...manifest, frameCount: 240, padding: 4 }) }).engine.start();
    FakeObserver.instances[0]!.intersect();
    await downloadAll();
    await settle();
    expect(new Set(FakeImage.decoded).size).toBeLessThan(40);
    scrollTo(0.5);
    await settle();
    expect(at((drawImage.mock.calls.at(-1)![0] as FakeImage).src)).toBe(120);
  });

  it("a long sequence downloads a coarse pass and what is near, not every frame", async () => {
    create({ manifest: long }).engine.start();
    FakeObserver.instances[0]!.intersect();
    await downloadAll();
    await settle();
    const wanted = FakeImage.requests.map(at);
    expect(wanted.length).toBeLessThan(400);
    expect(wanted).toContain(1799); // the end is never blank
    expect(wanted).toContain(100); // near the start
    expect(wanted).not.toContain(901); // far, and not in the coarse pass
  });

  it("a long sequence downloads what the scroll reaches and shows that exact frame", async () => {
    create({ manifest: long }).engine.start();
    FakeObserver.instances[0]!.intersect();
    await downloadAll();
    scrollTo(901 / 1799);
    for (let i = 0; i < 4; i++) {
      await settle();
      await downloadAll();
    }
    await settle();
    expect(FakeImage.requests.map(at)).toContain(901);
    expect(at((drawImage.mock.calls.at(-1)![0] as FakeImage).src)).toBe(901);
  });
});

describe("full width", () => {
  it.each([
    ["the parent", "block"],
    ["an inline host, as Angular writes", "inline"],
  ])("spans the page from %s without moving it out of the flow", (_name, display) => {
    Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, value: 1200 });
    const parent = document.createElement("div");
    parent.style.padding = "0 10px";
    Object.defineProperty(parent, "clientWidth", { value: 1000 });
    parent.getBoundingClientRect = () => ({ left: 40 }) as DOMRect;
    const host = document.createElement("app-hero");
    host.style.display = display;
    const container = document.createElement("section");
    // Content box of the parent: from 50 to 1030.
    container.getBoundingClientRect = () =>
      ({ top: 0, height: 3000, left: 50 + (parseFloat(container.style.marginLeft) || 0) }) as DOMRect;
    if (display === "inline") parent.append(host), host.append(container);
    else parent.append(container);
    document.body.append(parent);
    const engine = new ScrollSequence({ container, canvas: document.createElement("canvas"), manifest, fullWidth: true }).start();
    live.push(engine);

    const { width, left, marginLeft, marginRight } = container.style;
    // Width and margins add up to the parent's 980, so Firefox sees nothing sticking out.
    expect([width, left, marginLeft, marginRight]).toEqual(["1200px", "", "-50px", "-170px"]);
    engine.destroy();
    expect([container.style.width, container.style.marginLeft]).toEqual(["", ""]);
    parent.remove();
    delete (document.documentElement as { clientWidth?: number }).clientWidth;
  });

  it("follows the page when its width changes without a window resize (a scrollbar appears)", () => {
    const observers: { callback: () => void; targets: Element[] }[] = [];
    vi.stubGlobal(
      "ResizeObserver",
      class {
        targets: Element[] = [];
        constructor(callback: () => void) {
          observers.push({ callback, targets: this.targets });
        }
        observe(target: Element) {
          this.targets.push(target);
        }
        disconnect() {
          this.targets.length = 0;
        }
      },
    );
    let pageWidth = 1280;
    Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, get: () => pageWidth });
    const container = document.createElement("section");
    container.getBoundingClientRect = () => ({ top: 0, height: 3000, left: parseFloat(container.style.marginLeft) || 0 }) as DOMRect;
    document.body.append(container);
    const engine = new ScrollSequence({ container, canvas: document.createElement("canvas"), manifest, fullWidth: true }).start();
    expect(container.style.width).toBe("1280px");
    expect(observers.flatMap((o) => o.targets)).toContain(document.documentElement);

    pageWidth = 1265; // the content grew and a 15 px scrollbar appeared
    for (const observer of observers) observer.callback();
    expect(container.style.width).toBe("1265px");

    engine.destroy();
    expect(observers.flatMap((o) => o.targets)).toEqual([]);
    container.remove();
    delete (document.documentElement as { clientWidth?: number }).clientWidth;
  });

  it("is off unless asked", () => {
    const { engine, container } = create();
    engine.start();
    expect([container.style.width, container.style.marginLeft]).toEqual(["", ""]);
  });
});

describe("off-thread decoding in Chromium", () => {
  const fetched: string[] = [];
  const bitmaps: { url: string; closed: boolean }[] = [];
  beforeEach(() => {
    fetched.length = 0;
    bitmaps.length = 0;
    vi.stubGlobal("navigator", { userAgentData: { brands: [{ brand: "Chromium", version: "142" }] } });
    vi.stubGlobal("fetch", async (url: string) => {
      fetched.push(url);
      return { ok: true, blob: async () => ({ url }) };
    });
    vi.stubGlobal("createImageBitmap", async (blob: { url: string }) => {
      const bitmap = { url: blob.url, closed: false, close() { this.closed = true; } };
      bitmaps.push(bitmap);
      return bitmap;
    });
  });

  it("fetches same-origin frames and paints ImageBitmaps, without <img>", async () => {
    create().engine.start();
    FakeObserver.instances[0]!.intersect();
    for (let i = 0; i < 20; i++) await tick();
    flushFrames();
    expect(FakeImage.requests).toEqual([]);
    expect(fetched[0]).toBe("/seq/m/f-00.webp");
    expect((drawImage.mock.calls.at(-1)![0] as { url: string }).url).toBe("/seq/m/f-00.webp");
  });

  it("frees the bitmaps it lets go of", async () => {
    const { engine } = create({ manifest: parseManifest({ ...manifest, frameCount: 240, padding: 4 }) });
    engine.start();
    FakeObserver.instances[0]!.intersect();
    for (let i = 0; i < 200; i++) await tick();
    for (let k = 1; k <= 10; k++) {
      rect.top = -200 * k;
      window.dispatchEvent(new Event("scroll"));
      for (let i = 0; i < 6; i++) {
        flushFrames();
        await tick();
      }
    }
    const open = bitmaps.filter((bitmap) => !bitmap.closed).length;
    expect(bitmaps.length).toBeGreaterThan(30);
    expect(open).toBeLessThanOrEqual(24);
    engine.destroy();
    expect(bitmaps.every((bitmap) => bitmap.closed)).toBe(true);
  });

  it("uses <img> for frames on another origin, which need no CORS that way", async () => {
    create({ baseUrl: "https://cdn.example.com/seq" }).engine.start();
    FakeObserver.instances[0]!.intersect();
    await tick();
    expect(fetched).toEqual([]);
    expect(FakeImage.requests[0]).toBe("https://cdn.example.com/seq/m/f-00.webp");
  });

  it("retries a frame whose download failed", async () => {
    let fail = true;
    vi.stubGlobal("fetch", async (url: string) => {
      fetched.push(url);
      if (fail && url.endsWith("f-00.webp")) throw new TypeError("network");
      return { ok: true, blob: async () => ({ url }) };
    });
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      create().engine.start();
      FakeObserver.instances[0]!.intersect();
      for (let i = 0; i < 100; i++) await vi.advanceTimersByTimeAsync(0);
      fail = false;
      await vi.advanceTimersByTimeAsync(1000);
      for (let i = 0; i < 20; i++) await vi.advanceTimersByTimeAsync(0);
      expect(fetched.filter((url) => url.endsWith("f-00.webp"))).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
