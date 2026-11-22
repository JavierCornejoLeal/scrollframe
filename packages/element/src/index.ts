import {
  STAGE_STYLE,
  ScrollSequence as Engine,
  parseManifest,
  renderPosterMarkup,
  type SequenceManifest,
} from "@scrollframe/core";

export { PROGRESS_CSS_VAR, type SequenceManifest } from "@scrollframe/core";

export const DEFAULT_TAG_NAME = "scroll-sequence";

/** `detail` of the `sf-progress` event. */
export interface ScrollSequenceProgressDetail {
  /** 0 to 1 across the scroll length. */
  progress: number;
  /** Index of the frame on screen. */
  frame: number;
}

/** `detail` of the `sf-error` event: the manifest could not be loaded or is invalid. */
export interface ScrollSequenceErrorDetail {
  error: Error;
}

const OBSERVED = ["src", "alt", "base-url", "priority", "scroll-length", "full-width"] as const;

/** Lets the module load where there is no DOM (SSR); the class is only usable in a browser. */
const Base = (typeof HTMLElement === "undefined" ? class {} : HTMLElement) as typeof HTMLElement;

/**
 * The element's stylesheet. Injected once per document (or shadow root) and also shipped as
 * `dist/scroll-sequence.css`, which can be loaded in <head> so the layout is right before any script runs.
 * Children are never moved: frameworks (Angular, Vue...) insert nodes relative to anchors
 * that must stay direct children. Instead, the stage and every child share one grid cell
 * and stick to the top of the viewport while the element scrolls past.
 */
export function scrollSequenceStyles(tag: string = DEFAULT_TAG_NAME): string {
  return (
    `${tag}{display:grid;position:relative;height:var(--sf-scroll-length,300vh)}` +
    `${tag}:not([full-width="false"]){width:100vw;max-width:none;flex-shrink:0;box-sizing:border-box;margin-left:calc(50% - 50vw);margin-right:calc(50% - 50vw)}` +
    `${tag}>*{grid-area:1/1;align-self:start;position:sticky;top:0}` +
    `${tag}>[data-sf-stage]>canvas{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none}`
  );
}

const styledRoots = new WeakMap<Document | ShadowRoot, Set<string>>();

function ensureStyles(root: Document | ShadowRoot, tag: string): void {
  const tags = styledRoots.get(root) ?? new Set<string>();
  if (tags.has(tag)) return;
  tags.add(tag);
  styledRoots.set(root, tags);
  const style = document.createElement("style");
  style.dataset.scrollframe = tag;
  style.textContent = scrollSequenceStyles(tag);
  (root instanceof Document ? root.head : root).append(style);
}

export class ScrollSequenceElement extends Base {
  static get observedAttributes(): readonly string[] {
    return OBSERVED;
  }

  #manifest: unknown = undefined;
  #engine: Engine | null = null;
  #stage: HTMLElement | null = null;
  /** False until the first mount: a server-rendered poster found then is kept as it is. */
  #posterSettled = false;
  #abort: AbortController | null = null;
  /** Bumped on every (re)load and disconnect, so stale async loads are dropped. */
  #generation = 0;
  #refreshQueued = false;
  /** True between connectedCallback and disconnectedCallback. */
  #connected = false;

  constructor() {
    super();
    // `el.manifest = ...` before the class was defined (deferred script, lazy import) created a
    // plain own property that would shadow the accessor; move it into the private field.
    if (Object.prototype.hasOwnProperty.call(this, "manifest")) {
      const value = (this as { manifest?: unknown }).manifest;
      delete (this as { manifest?: unknown }).manifest;
      this.#manifest = value;
    }
  }

  /** The manifest object (e.g. an imported `manifest.json`). Takes precedence over `src`. */
  get manifest(): unknown {
    return this.#manifest;
  }

  set manifest(value: unknown) {
    this.#manifest = value;
    this.#queueRefresh();
  }

  connectedCallback(): void {
    this.#connected = true;
    const root = this.getRootNode();
    ensureStyles(root instanceof ShadowRoot ? root : document, this.localName);
    this.#load();
  }

  disconnectedCallback(): void {
    this.#connected = false;
    this.#teardown();
  }

  attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue !== newValue) this.#queueRefresh();
  }

  /**
   * Coalesces several attribute/property changes made in the same task into one reload.
   * Ignored before connectedCallback: when an element already in the page is upgraded, the browser
   * reports every existing attribute as a change first, and connectedCallback loads right after.
   */
  #queueRefresh(): void {
    if (!this.#connected || this.#refreshQueued) return;
    this.#refreshQueued = true;
    queueMicrotask(() => {
      this.#refreshQueued = false;
      if (!this.isConnected) return;
      this.#teardown();
      this.#load();
    });
  }

  #teardown(): void {
    this.#generation++;
    this.#abort?.abort();
    this.#abort = null;
    this.#engine?.destroy();
    this.#engine = null;
  }

  #load(): void {
    const generation = ++this.#generation;
    this.#applyScrollLength();
    if (this.#manifest !== undefined) {
      this.#mountSafely(() => this.#manifest);
      return;
    }
    const src = this.getAttribute("src");
    if (!src) return;
    this.#abort = new AbortController();
    fetch(src, { signal: this.#abort.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Could not load ${src} (HTTP ${response.status}).`);
        return response.json() as Promise<unknown>;
      })
      .then(
        (raw) => {
          if (generation === this.#generation) this.#mountSafely(() => raw);
        },
        (error: unknown) => {
          if (generation === this.#generation) this.#fail(error);
        },
      );
  }

  /** Any failure (invalid manifest, engine, DOM) is reported as `sf-error`, never thrown. */
  #mountSafely(read: () => unknown): void {
    try {
      this.#mount(parseManifest(read()));
    } catch (error) {
      this.#engine?.destroy();
      this.#engine = null;
      this.#fail(error);
    }
  }

  #mount(manifest: SequenceManifest): void {
    const baseUrl = this.getAttribute("base-url") ?? undefined;
    if (!this.getAttribute("scroll-length")) {
      // The manifest's length, or the default for a sequence without one.
      if (manifest.scrollLength) this.style.setProperty("--sf-scroll-length", manifest.scrollLength);
      else this.style.removeProperty("--sf-scroll-length");
    }
    const stage = this.#ensureStage();
    this.#renderPoster(
      stage,
      renderPosterMarkup(manifest, {
        alt: this.getAttribute("alt") ?? "",
        priority: this.getAttribute("priority") !== "false",
        baseUrl,
      }),
    );
    this.#engine = new Engine({
      container: this,
      canvas: this.#ensureCanvas(stage),
      manifest,
      baseUrl,
      fullWidth: this.getAttribute("full-width") !== "false",
      onProgress: (progress, frame) => this.#emit<ScrollSequenceProgressDetail>("sf-progress", { progress, frame }),
      onReady: () => this.#emit("sf-ready", undefined),
    }).start();
  }

  /** Adopts a server-rendered stage (`renderStageMarkup`) if there is one, otherwise creates it. */
  #ensureStage(): HTMLElement {
    if (!this.#stage) {
      const rendered = this.querySelector<HTMLElement>(":scope > [data-sf-stage]");
      if (rendered) {
        this.#stage = rendered;
      } else {
        this.#stage = document.createElement("div");
        this.#stage.dataset.sfStage = "";
        this.#stage.style.cssText = STAGE_STYLE;
      }
    }
    if (this.#stage.parentNode !== this) this.prepend(this.#stage);
    return this.#stage;
  }

  /**
   * Keeps the poster on screen when it already matches (no re-download, no flash). On the first
   * mount a server-rendered poster is kept as is: it is already painted and may be the LCP image.
   * Later refreshes replace it if it differs from what the attributes describe.
   */
  #renderPoster(stage: HTMLElement, markup: string): void {
    const current = stage.querySelector(":scope > picture");
    const keep = current !== null && (!this.#posterSettled || current.outerHTML === markup);
    this.#posterSettled = true;
    if (keep) return;
    current?.remove();
    stage.insertAdjacentHTML("afterbegin", markup);
  }

  #ensureCanvas(stage: HTMLElement): HTMLCanvasElement {
    let canvas = stage.querySelector<HTMLCanvasElement>(":scope > canvas");
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.setAttribute("aria-hidden", "true");
      stage.append(canvas);
    }
    return canvas;
  }

  /**
   * The attribute wins. Without it, the length the page wrote (the generated snippets do) stays
   * until the manifest arrives, so the page does not jump while it loads.
   */
  #applyScrollLength(): void {
    const length = this.getAttribute("scroll-length");
    if (length) this.style.setProperty("--sf-scroll-length", length);
  }

  #fail(error: unknown): void {
    const detail: ScrollSequenceErrorDetail = { error: error instanceof Error ? error : new Error(String(error)) };
    this.#emit("sf-error", detail);
  }

  #emit<T>(type: string, detail: T): void {
    this.dispatchEvent(new CustomEvent<T>(type, { detail, bubbles: true }));
  }
}

/**
 * Registers the element (as `<scroll-sequence>` by default). Safe to call more than once and
 * a no-op without a DOM (SSR). Returns the registered class, or undefined without a DOM.
 */
export function defineScrollSequence(tagName: string = DEFAULT_TAG_NAME): typeof ScrollSequenceElement | undefined {
  if (typeof customElements === "undefined") return undefined;
  const existing = customElements.get(tagName) as typeof ScrollSequenceElement | undefined;
  if (existing) return existing;
  // A class can back only one tag name, so custom names get their own subclass.
  const ctor = tagName === DEFAULT_TAG_NAME ? ScrollSequenceElement : class extends ScrollSequenceElement {};
  customElements.define(tagName, ctor);
  return ctor;
}

defineScrollSequence();

declare global {
  interface HTMLElementTagNameMap {
    "scroll-sequence": ScrollSequenceElement;
  }
  interface HTMLElementEventMap {
    "sf-progress": CustomEvent<ScrollSequenceProgressDetail>;
    "sf-ready": CustomEvent<undefined>;
    "sf-error": CustomEvent<ScrollSequenceErrorDetail>;
  }
}
