import { frameUrl, selectFrameSet, type FrameSet, type SequenceManifest } from "./manifest.js";
import { coarseToFineOrder, frameIndexFromProgress, nearestLoaded, progressFromRect } from "./math.js";

export interface ScrollSequenceOptions {
  /** Tall element that defines the scroll distance (its height = scroll length). */
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  manifest: SequenceManifest;
  /** Overrides `manifest.baseUrl` (useful with a CDN). */
  baseUrl?: string;
  /** Parallel image requests while preloading. Default 6. */
  concurrency?: number;
  /** How far before the viewport preloading starts (IntersectionObserver rootMargin). Default "100% 0px". */
  preloadMargin?: string;
  onProgress?: (progress: number, frameIndex: number) => void;
  /** Called once the first sequence frame is painted on the canvas. */
  onReady?: () => void;
}

/** Progress is exposed to CSS so overlays can animate without re-rendering any framework. */
export const PROGRESS_CSS_VAR = "--sf-progress";

function prefersStaticMedia(): boolean {
  if (typeof window === "undefined") return true;
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const connection = (navigator as Navigator & { connection?: { saveData?: boolean } }).connection;
  return reducedMotion || connection?.saveData === true;
}

/**
 * Scroll-scrubbed image sequence painted on a canvas.
 * Nothing is downloaded until the container gets close to the viewport, and only the
 * frame set that matches the current viewport is fetched.
 */
export class ScrollSequence {
  private readonly options: Required<Pick<ScrollSequenceOptions, "concurrency" | "preloadMargin">> & ScrollSequenceOptions;
  private readonly ctx: CanvasRenderingContext2D | null;
  private set: FrameSet;
  private frames: (HTMLImageElement | null)[] = [];
  private generation = 0;
  private observer: IntersectionObserver | null = null;
  private rafId = 0;
  private drawnIndex = -1;
  private ready = false;
  private destroyed = false;
  private preloading = false;
  private started = false;

  constructor(options: ScrollSequenceOptions) {
    this.options = { concurrency: 6, preloadMargin: "100% 0px", ...options };
    this.ctx = options.canvas.getContext("2d");
    this.set = selectFrameSet(options.manifest, window.innerWidth);
    this.applyCanvasSize();
  }

  /** Starts observing. Returns `this` for chaining. Idempotent; no-op under reduced motion / Save-Data. */
  start(): this {
    if (this.started || this.destroyed || prefersStaticMedia()) return this;
    this.started = true;
    this.observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) this.preload();
      },
      { rootMargin: this.options.preloadMargin },
    );
    this.observer.observe(this.options.container);
    window.addEventListener("scroll", this.schedule, { passive: true });
    window.addEventListener("resize", this.handleResize, { passive: true });
    this.schedule();
    return this;
  }

  destroy(): void {
    this.destroyed = true;
    this.generation++;
    this.observer?.disconnect();
    window.removeEventListener("scroll", this.schedule);
    window.removeEventListener("resize", this.handleResize);
    cancelAnimationFrame(this.rafId);
    this.releaseFrames();
  }

  get progress(): number {
    const rect = this.options.container.getBoundingClientRect();
    return progressFromRect(rect.top, rect.height, window.innerHeight);
  }

  private applyCanvasSize(): void {
    this.options.canvas.width = this.set.width;
    this.options.canvas.height = this.set.height;
  }

  private releaseFrames(): void {
    this.frames = [];
  }

  private readonly schedule = (): void => {
    if (this.rafId || this.destroyed) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      this.render();
    });
  };

  private readonly handleResize = (): void => {
    const next = selectFrameSet(this.options.manifest, window.innerWidth);
    if (next.name !== this.set.name) {
      const wasPreloading = this.preloading;
      this.generation++;
      this.releaseFrames();
      this.set = next;
      this.drawnIndex = -1;
      this.preloading = false;
      this.applyCanvasSize();
      if (wasPreloading) this.preload();
    }
    this.schedule();
  };

  private render(): void {
    const progress = this.progress;
    const { manifest, container, onProgress } = this.options;
    const target = frameIndexFromProgress(progress, manifest.frameCount);
    container.style.setProperty(PROGRESS_CSS_VAR, progress.toFixed(4));
    onProgress?.(progress, target);

    const index = nearestLoaded(target, manifest.frameCount, (i) => this.frames[i] != null);
    if (index === -1 || index === this.drawnIndex || !this.ctx) return;
    const frame = this.frames[index];
    if (!frame) return;
    this.ctx.drawImage(frame, 0, 0, this.set.width, this.set.height);
    this.drawnIndex = index;
    if (!this.ready) {
      this.ready = true;
      this.options.onReady?.();
    }
  }

  private preload(): void {
    if (this.preloading || this.destroyed) return;
    this.preloading = true;
    const generation = this.generation;
    const { manifest, baseUrl, concurrency } = this.options;
    const queue = coarseToFineOrder(manifest.frameCount);
    this.frames = new Array(manifest.frameCount).fill(null);

    const worker = async (): Promise<void> => {
      for (let index = queue.shift(); index !== undefined; index = queue.shift()) {
        const url = frameUrl(manifest, this.set, index, baseUrl);
        try {
          const frame = await loadFrame(url);
          if (generation !== this.generation) return;
          this.frames[index] = frame;
          this.schedule();
        } catch {
          // A missing frame is skipped; `nearestLoaded` paints its neighbour instead.
        }
      }
    };

    for (let i = 0; i < concurrency; i++) void worker();
  }
}

/**
 * Plain <img> elements (not ImageBitmap): the browser may evict their decoded pixels under
 * memory pressure, whereas 150 full-HD bitmaps would pin more than 1 GB of RAM.
 */
async function loadFrame(url: string): Promise<HTMLImageElement> {
  const image = new Image();
  image.decoding = "async";
  image.src = url;
  await image.decode();
  return image;
}
