import { frameUrl, selectFrameSet, type FrameSet, type SequenceManifest } from "./manifest.js";
import { clamp, coarseToFineOrder, frameIndexFromProgress, nearestLoaded, progressFromRect } from "./math.js";

export interface ScrollSequenceOptions {
  /** Tall element that defines the scroll distance (its height = scroll length). */
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  manifest: SequenceManifest;
  /** Overrides `manifest.baseUrl` (useful with a CDN). */
  baseUrl?: string;
  /** Parallel image requests while preloading. Default 6. */
  concurrency?: number;
  /** Milliseconds the sequence takes to catch up with the scroll (easing); 0 follows it exactly. Default 80. */
  smoothing?: number;
  /** Stretch the container across the page, whatever the width of the element it is in. Default false. */
  fullWidth?: boolean;
  /** How far before the viewport preloading starts (IntersectionObserver rootMargin). Default "100% 0px". */
  preloadMargin?: string;
  onProgress?: (progress: number, frameIndex: number) => void;
  /** Called once the first sequence frame is painted on the canvas. */
  onReady?: () => void;
}

/** Automatic retries after failed frames: 1s, 2s, 4s. A later `online` event always retries. */
const RETRY_DELAYS_MS = [1000, 2000, 4000];

/** Up to this many frames are all downloaded; a longer sequence only a coarse pass and what is near. */
const EAGER_FRAMES = 300;
const COARSE_FRAMES = 60;
const NEAR_AHEAD = 180;
const NEAR_BEHIND = 60;
/** A long sequence lets go of downloaded frames further than this, except the coarse pass. */
const KEEP_DOWNLOADED = 600;

// Decoded frames are what costs memory (14 MB each at 2560px), so only a window of them is kept,
// aimed ahead of the scroll. Four at a time is what stayed fluid in Chromium, WebKit and Firefox.
const DECODE_SLOTS = 4;
const DECODE_AHEAD = 10;
const DECODE_BEHIND = 3;
const MAX_DECODED = 24;

type Frame = HTMLImageElement | ImageBitmap;

/**
 * Chromium decodes an ImageBitmap off the main thread, which kept a 1296x2160 sequence fluid on a
 * phone-speed CPU where <img> dropped frames. WebKit and Firefox did worse with it, and fetching
 * frames from another origin would need CORS, so they keep <img>.
 */
function decodesOffThread(url: string): boolean {
  const brands = (navigator as Navigator & { userAgentData?: { brands?: { brand: string }[] } }).userAgentData?.brands;
  if (!brands?.some(({ brand }) => brand === "Chromium")) return false;
  if (typeof fetch !== "function" || typeof createImageBitmap !== "function") return false;
  try {
    return new URL(url, location.href).origin === location.origin;
  } catch {
    return false;
  }
}

const release = (frame: Frame) => (frame as ImageBitmap).close?.();

/** Progress is exposed to CSS so overlays can animate without re-rendering any framework. */
export const PROGRESS_CSS_VAR = "--sf-progress";

function prefersStaticMedia(): boolean {
  if (typeof window === "undefined") return true;
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return reducedMotion || connection?.saveData === true;
}

const SCROLL_CONTAINER = new Set(["hidden", "auto", "scroll"]);

const describeElement = (el: Element) =>
  el.localName + (el.id ? `#${el.id}` : "") + (el.classList.length ? `.${[...el.classList].join(".")}` : "");

/**
 * The first ancestor whose overflow makes it a scroll container, which stops `position: sticky`
 * from pinning the sequence to the viewport. `body` only counts when `html` has an overflow too:
 * otherwise the browser applies body's overflow to the viewport and sticky still works.
 */
export function findStickyBlocker(container: Element): { element: Element; property: string; value: string } | null {
  const root = container.ownerDocument.documentElement;
  const rootStyle = getComputedStyle(root);
  // An unset value reads as "" in some environments (jsdom) and "visible" in browsers.
  const clips = (value: string) => value !== "" && value !== "visible";
  const rootClips = clips(rootStyle.overflowX) || clips(rootStyle.overflowY);
  for (let el = container.parentElement; el && el !== root; el = el.parentElement) {
    if (el === container.ownerDocument.body && !rootClips) continue;
    const style = getComputedStyle(el);
    const axes = (["overflow-x", "overflow-y"] as const).map((property) => ({ property, value: style.getPropertyValue(property) }));
    // A hidden axis makes the other compute to auto, so report the hidden one: that is what was written.
    const blocking = axes.find((axis) => axis.value === "hidden") ?? axes.find((axis) => SCROLL_CONTAINER.has(axis.value));
    if (blocking) return { element: el, ...blocking };
  }
  return null;
}

/**
 * Scroll-scrubbed image sequence painted on a canvas.
 * Nothing is downloaded until the container gets close to the viewport, and only the
 * frame set that matches the current viewport is fetched.
 */
export class ScrollSequence {
  private readonly options: Required<Pick<ScrollSequenceOptions, "concurrency" | "preloadMargin" | "smoothing">> &
    ScrollSequenceOptions;
  private readonly ctx: CanvasRenderingContext2D | null;
  private set: FrameSet;
  /** Downloaded, still compressed. */
  private frames: (HTMLImageElement | Blob | null)[] = [];
  private offThread = false;
  private downloaded = 0;
  private queue: number[] = [];
  private coarse = new Set<number>();
  private requested = new Set<number>();
  private failed = new Set<number>();
  private decoded = new Map<number, Frame>();
  private decoding = new Set<number>();
  /** Downloaded but undecodable: never tried again. */
  private broken = new Set<number>();
  private decodeCost = 20;
  private generation = 0;
  private observer: IntersectionObserver | null = null;
  private rafId = 0;
  private drawnIndex = -1;
  /** Where the sequence is (0..1), easing towards the scroll. null until the first render. */
  private position: number | null = null;
  private renderedAt = 0;
  private target = 0;
  private direction = 1;
  /** Frames per millisecond. */
  private velocity = 0;
  private trimmedAt = 0;
  /** What the container had before the engine stretched it. */
  private ownLayout: { width: string; marginLeft: string; marginRight: string } | null = null;
  /** The width the engine set, to tell whether the page has changed it since. */
  private appliedWidth = "";
  private ready = false;
  private destroyed = false;
  private started = false;
  /** The section has been near the viewport at least once, so frames are wanted. */
  private near = false;
  private retries = 0;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(options: ScrollSequenceOptions) {
    this.options = {
      ...options,
      // `??`, so that a wrapper passing undefined gets the default.
      concurrency: options.concurrency ?? 6,
      preloadMargin: options.preloadMargin ?? "100% 0px",
      smoothing: options.smoothing ?? 80,
    };
    this.ctx = options.canvas.getContext("2d");
    this.set = this.pickSet();
    this.applyCanvasSize();
    this.offThread = decodesOffThread(frameUrl(options.manifest, this.set, 0, options.baseUrl));
  }

  /** Starts observing. Returns `this` for chaining. Idempotent; no-op under reduced motion / Save-Data. */
  start(): this {
    if (this.started || this.destroyed) return this;
    this.applyFullWidth();
    if (prefersStaticMedia()) {
      // Only the poster, which still spans the page.
      if (this.options.fullWidth && typeof window !== "undefined") window.addEventListener("resize", this.applyFullWidth);
      return this;
    }
    this.started = true;
    const blocker = findStickyBlocker(this.options.container);
    if (blocker) {
      const { element, property, value } = blocker;
      const name = describeElement(element);
      console.warn(
        value === "hidden"
          ? `scrollframe: ${name} has "${property}: hidden", so the sequence cannot stay pinned while scrolling. ` +
              `Use "${property}: clip" instead: it hides the overflow the same way without creating a scroll container.`
          : `scrollframe: ${name} scrolls its own content ("${property}: ${value}"), but the sequence follows the page scroll. ` +
              "Place the sequence outside that scrolling container.",
      );
    }
    this.observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          if (!this.near) this.planDownloads();
          this.near = true;
          this.pump();
        }
      },
      { rootMargin: this.options.preloadMargin },
    );
    this.observer.observe(this.options.container);
    window.addEventListener("scroll", this.schedule, { passive: true });
    window.addEventListener("resize", this.handleResize, { passive: true });
    window.addEventListener("online", this.handleOnline);
    this.schedule();
    return this;
  }

  destroy(): void {
    this.destroyed = true;
    this.generation++;
    this.observer?.disconnect();
    window.removeEventListener("scroll", this.schedule);
    window.removeEventListener("resize", this.handleResize);
    window.removeEventListener("resize", this.applyFullWidth);
    window.removeEventListener("online", this.handleOnline);
    this.cancelRetry();
    cancelAnimationFrame(this.rafId);
    this.releaseFrames();
    // Only if the width is still the engine's: React may already have set what comes next.
    const { style } = this.options.container;
    if (this.ownLayout && style.width === this.appliedWidth) Object.assign(style, this.ownLayout);
  }

  get progress(): number {
    const rect = this.options.container.getBoundingClientRect();
    return progressFromRect(rect.top, rect.height, window.innerHeight);
  }

  private pickSet(): FrameSet {
    return selectFrameSet(this.options.manifest, window.innerWidth, window.innerHeight, window.devicePixelRatio);
  }

  private applyCanvasSize(): void {
    this.options.canvas.width = this.set.width;
    this.options.canvas.height = this.set.height;
  }

  /**
   * CSS alone cannot span the page: 100vw counts the scrollbar, and the parent may be off-centre.
   * Width and margins add up to the parent's own width, so nothing depends on how it aligns children.
   * (Moving it with `left` left its original box scrollable sideways in Firefox.)
   */
  private readonly applyFullWidth = (): void => {
    if (!this.options.fullWidth) return;
    const pageWidth = document.documentElement.clientWidth;
    if (!pageWidth) return;
    const { container } = this.options;
    const { style } = container;
    this.ownLayout ??= { width: style.width, marginLeft: style.marginLeft, marginRight: style.marginRight };

    // An inline host (Angular's component tag) has no width of its own.
    let parent = container.parentElement;
    while (parent && ["inline", "contents"].includes(getComputedStyle(parent).display)) parent = parent.parentElement;
    let start = 0;
    let room = pageWidth;
    if (parent) {
      const { paddingLeft, paddingRight } = getComputedStyle(parent);
      const padding = parseFloat(paddingLeft) || 0;
      start = parent.getBoundingClientRect().left + (window.scrollX || 0) + (parent.clientLeft || 0) + padding;
      room = parent.clientWidth - padding - (parseFloat(paddingRight) || 0);
    }
    const place = (marginLeft: number): void => {
      style.marginLeft = `${-marginLeft}px`;
      style.marginRight = `${room - pageWidth + marginLeft}px`;
    };
    style.width = `${pageWidth}px`;
    this.appliedWidth = style.width;
    place(start);
    // What the parent's box does not explain, e.g. a later grid column.
    const off = container.getBoundingClientRect().left + (window.scrollX || 0);
    if (Math.abs(off) >= 0.5) place(start + off);
  };

  private releaseFrames(): void {
    this.frames = [];
    this.downloaded = 0;
    this.queue = [];
    this.requested.clear();
    this.failed.clear();
    this.decoded.forEach(release);
    this.decoded.clear();
    this.decoding.clear();
    this.broken.clear();
  }

  private readonly schedule = (): void => {
    if (this.rafId || this.destroyed) return;
    this.rafId = requestAnimationFrame((now) => {
      this.rafId = 0;
      this.render(now);
    });
  };

  private readonly handleResize = (): void => {
    this.applyFullWidth();
    const next = this.pickSet();
    if (next.name !== this.set.name) {
      this.generation++;
      this.releaseFrames();
      this.set = next;
      this.drawnIndex = -1;
      this.retries = 0;
      this.cancelRetry();
      this.applyCanvasSize();
      if (this.near) {
        this.planDownloads();
        this.pump();
      }
    }
    this.schedule();
  };

  private readonly handleOnline = (): void => {
    if (!this.near) return;
    this.cancelRetry();
    this.retries = 0;
    this.retryFailed();
  };

  /** One retry at a time: a long sequence keeps starting downloads, and each batch would ask for one. */
  private scheduleRetry(): void {
    const delay = RETRY_DELAYS_MS[this.retries];
    if (delay === undefined || this.destroyed || this.retryTimer !== undefined) return;
    this.retries++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      this.retryFailed();
    }, delay);
  }

  private cancelRetry(): void {
    clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }

  /** Only what is still missing, in the order it was first wanted. */
  private retryFailed(): void {
    this.failed.clear();
    this.planDownloads();
    this.pump();
  }

  private render(now: number): void {
    const scrolled = this.progress;
    const { manifest, container, onProgress, smoothing } = this.options;
    const elapsed = now > this.renderedAt ? Math.min(now - this.renderedAt, 100) : 1000 / 60;
    this.renderedAt = now;
    if (this.position === null || smoothing <= 0) {
      this.position = scrolled; // also a page restored halfway down: nothing to ease from
    } else {
      this.position += (scrolled - this.position) * (1 - Math.exp(-elapsed / smoothing));
      if (Math.abs(scrolled - this.position) < 0.25 / manifest.frameCount) this.position = scrolled;
    }
    const settled = this.position === scrolled;

    const target = frameIndexFromProgress(this.position, manifest.frameCount);
    const moved = target - this.target;
    if (moved !== 0) this.direction = Math.sign(moved);
    this.velocity = settled ? 0 : this.velocity * 0.6 + (moved / elapsed) * 0.4;
    this.target = target;
    container.style.setProperty(PROGRESS_CSS_VAR, this.position.toFixed(4));
    onProgress?.(this.position, target);

    this.draw();
    this.pump();
    if (!settled) this.schedule();
  }

  private draw(): void {
    let index = -1;
    let distance = Infinity;
    for (const candidate of this.decoded.keys()) {
      const away = Math.abs(candidate - this.target);
      // A tie goes to the earlier frame, as in `nearestLoaded`.
      if (away < distance || (away === distance && candidate < index)) {
        index = candidate;
        distance = away;
      }
    }
    if (index === -1 || index === this.drawnIndex || !this.ctx) return;
    this.ctx.drawImage(this.decoded.get(index)!, 0, 0, this.set.width, this.set.height);
    this.drawnIndex = index;
    if (!this.ready) {
      this.ready = true;
      this.options.onReady?.();
    }
  }

  private pump(): void {
    if (!this.near || this.destroyed) return;
    this.download();
    this.decodeWindow();
    this.trimDownloads();
  }

  /** Every frame, coarse to fine; of a long sequence only a coarse pass, the rest as the scroll gets near. */
  private planDownloads(): void {
    const { frameCount } = this.options.manifest;
    let order: number[];
    if (frameCount <= EAGER_FRAMES) {
      order = coarseToFineOrder(frameCount);
    } else {
      const step = Math.ceil(frameCount / COARSE_FRAMES);
      order = [];
      for (let i = 0; i < frameCount; i += step) order.push(i);
      if (order[order.length - 1] !== frameCount - 1) order.push(frameCount - 1);
      this.coarse = new Set(order);
    }
    if (this.frames.length !== frameCount) this.frames = new Array(frameCount).fill(null);
    this.queue = order.filter((index) => this.frames[index] == null && !this.requested.has(index));
  }

  private nextDownload(): number | undefined {
    const queued = this.queue.shift();
    if (queued !== undefined) return queued;
    const { frameCount } = this.options.manifest;
    if (frameCount <= EAGER_FRAMES) return undefined;
    const missing = (i: number) =>
      i >= 0 && i < frameCount && this.frames[i] == null && !this.requested.has(i) && !this.failed.has(i);
    for (let offset = 0; offset <= NEAR_AHEAD; offset++) {
      const ahead = this.target + offset * this.direction;
      if (missing(ahead)) return ahead;
      const behind = this.target - offset * this.direction;
      if (offset <= NEAR_BEHIND && missing(behind)) return behind;
    }
    return undefined;
  }

  private download(): void {
    while (this.requested.size < this.options.concurrency) {
      const index = this.nextDownload();
      if (index === undefined) return;
      this.requested.add(index);
      const generation = this.generation;
      const finish = (frame: HTMLImageElement | Blob | null): void => {
        if (generation !== this.generation) return;
        this.requested.delete(index);
        if (frame) {
          this.frames[index] = frame;
          this.downloaded++;
        } else {
          this.failed.add(index); // a neighbour is painted meanwhile; retried below
        }
        this.pump();
        if (this.requested.size > 0) return;
        if (this.failed.size > 0) this.scheduleRetry();
        else this.retries = 0;
      };
      const url = frameUrl(this.options.manifest, this.set, index, this.options.baseUrl);
      if (this.offThread) {
        fetch(url)
          .then((response) => (response.ok ? response.blob() : Promise.reject(new Error(`HTTP ${response.status}`))))
          .then(finish, () => finish(null));
      } else {
        const image = new Image();
        image.onload = () => finish(image);
        image.onerror = () => finish(null);
        image.decoding = "async";
        image.src = url;
      }
    }
  }

  private decodeWindow(): void {
    if (this.downloaded === 0 || this.decoding.size >= DECODE_SLOTS) return;
    const { frameCount } = this.options.manifest;
    // When the scroll outruns decoding, aim where it will be and skip frames on the way.
    const speed = Math.abs(this.velocity);
    let stride = 1;
    while (stride < 64 && speed * this.decodeCost > DECODE_SLOTS * 0.6 * stride) stride *= 2;
    const head = this.target + this.velocity * this.decodeCost;
    const base = stride === 1 ? Math.round(head) : Math.round(head / stride) * stride;
    const wanted: number[] = [];
    for (let k = 0; k < DECODE_AHEAD; k++) wanted.push(base + k * stride * this.direction);
    for (let k = 1; k <= DECODE_BEHIND; k++) wanted.push(this.target - k * this.direction);

    const available = (i: number) => this.frames[i] != null && !this.broken.has(i);
    for (const [order, raw] of wanted.entries()) {
      if (this.decoding.size >= DECODE_SLOTS) break;
      // The first one always has a frame to show, even past either end of the sequence.
      if (order > 0 && (raw < 0 || raw >= frameCount)) continue;
      const index = nearestLoaded(clamp(raw, 0, frameCount - 1), frameCount, available);
      if (index === -1) return;
      if (!this.decoded.has(index) && !this.decoding.has(index)) this.decode(index);
    }
  }

  /**
   * A second <img> of the downloaded url (the browser serves it from memory): dropping it lets go
   * of the pixels while the compressed frame stays.
   */
  private decode(index: number): void {
    this.decoding.add(index);
    const generation = this.generation;
    const startedAt = performance.now();
    const source = this.frames[index]!;
    (this.offThread ? createImageBitmap(source as Blob) : loadFrame((source as HTMLImageElement).src)).then(
      (frame) => {
        if (generation !== this.generation) return release(frame);
        this.decoding.delete(index);
        this.decodeCost = this.decodeCost * 0.8 + Math.min(performance.now() - startedAt, 200) * 0.2;
        this.decoded.set(index, frame);
        this.trimDecoded();
        this.schedule();
      },
      () => {
        if (generation !== this.generation) return;
        this.decoding.delete(index);
        this.broken.add(index);
        this.schedule();
      },
    );
  }

  private trimDecoded(): void {
    if (this.decoded.size <= MAX_DECODED) return;
    const head = this.target + this.velocity * this.decodeCost;
    let furthest = -1;
    for (const index of this.decoded.keys()) {
      if (index !== this.drawnIndex && (furthest === -1 || Math.abs(index - head) > Math.abs(furthest - head))) {
        furthest = index;
      }
    }
    release(this.decoded.get(furthest)!);
    this.decoded.delete(furthest);
  }

  private trimDownloads(): void {
    if (this.frames.length <= EAGER_FRAMES || Math.abs(this.target - this.trimmedAt) < NEAR_BEHIND) return;
    this.trimmedAt = this.target;
    this.frames.forEach((frame, index) => {
      if (!frame || this.coarse.has(index) || Math.abs(index - this.target) <= KEEP_DOWNLOADED) return;
      this.frames[index] = null;
      this.downloaded--;
    });
  }
}

/**
 * Plain <img> and decode(), not ImageBitmap: that dropped frames in WebKit and Firefox, and needs
 * CORS when the frames are on another origin.
 */
async function loadFrame(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  await image.decode();
  return image;
}
