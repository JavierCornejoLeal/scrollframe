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

/** Fake <img>: records every requested url and lets each test decide when (and whether) it decodes. */
class FakeImage {
  static requests: string[] = [];
  static pending = new Map<string, { resolve: () => void; reject: (e: Error) => void; image: FakeImage }>();
  decoding = "";
  src = "";
  decode(): Promise<void> {
    FakeImage.requests.push(this.src);
    return new Promise((resolve, reject) => FakeImage.pending.set(this.src, { resolve, reject, image: this }));
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
  const engine = new ScrollSequence({ container, canvas, manifest, ...extra });
  live.push(engine);
  return { engine, container, canvas };
}

beforeEach(() => {
  FakeImage.requests = [];
  FakeImage.pending = new Map();
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
