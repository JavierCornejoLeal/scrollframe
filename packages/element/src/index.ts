import {
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

const OBSERVED = ["src", "alt", "base-url", "priority", "scroll-length"] as const;

/** Lets the module load where there is no DOM (SSR); the class is only usable in a browser. */
const Base = (typeof HTMLElement === "undefined" ? class {} : HTMLElement) as typeof HTMLElement;

/**
 * The stylesheet is shared by every instance in a document (or shadow root).
 * Children are never moved: frameworks (Angular, Vue...) insert nodes relative to anchors
 * that must stay direct children. Instead, the stage and every child share one grid cell
 * and stick to the top of the viewport while the element scrolls past.
 */
function stylesFor(tag: string): string {
  return (
    `${tag}{display:grid;position:relative;height:var(--sf-scroll-length,300vh)}` +
    `${tag}>*{grid-area:1/1;align-self:start;position:sticky;top:0}` +
    `${tag}>[data-sf-stage]{height:100svh;overflow:hidden}` +
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
  style.textContent = stylesFor(tag);
  (root instanceof Document ? root.head : root).append(style);
}

export class ScrollSequenceElement extends Base {
  static get observedAttributes(): readonly string[] {
    return OBSERVED;
  }

  #manifest: unknown = undefined;
  #engine: Engine | null = null;
  #stage: HTMLElement | null = null;
  #abort: AbortController | null = null;
  /** Bumped on every (re)load and disconnect, so stale async loads are dropped. */
  #generation = 0;
  #refreshQueued = false;

  /** The manifest object (e.g. an imported `manifest.json`). Takes precedence over `src`. */
  get manifest(): unknown {
    return this.#manifest;
  }

  set manifest(value: unknown) {
    this.#manifest = value;
    this.#queueRefresh();
  }

  connectedCallback(): void {
    const root = this.getRootNode();
    ensureStyles(root instanceof ShadowRoot ? root : document, this.localName);
    this.#load();
  }

  disconnectedCallback(): void {
    this.#teardown();
  }

  attributeChangedCallback(_name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue !== newValue) this.#queueRefresh();
  }

  /** Coalesces several attribute/property changes made in the same task into one reload. */
  #queueRefresh(): void {
    if (!this.isConnected || this.#refreshQueued) return;
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

  #mountSafely(read: () => unknown): void {
    let manifest: SequenceManifest;
    try {
      manifest = parseManifest(read());
    } catch (error) {
      this.#fail(error);
      return;
    }
    this.#mount(manifest);
  }

  #mount(manifest: SequenceManifest): void {
    const baseUrl = this.getAttribute("base-url") ?? undefined;
    const stage = this.#ensureStage();
    stage.innerHTML =
      renderPosterMarkup(manifest, {
        alt: this.getAttribute("alt") ?? "",
        priority: this.getAttribute("priority") !== "false",
        baseUrl,
      }) + '<canvas aria-hidden="true"></canvas>';
    this.#engine = new Engine({
      container: this,
      canvas: stage.querySelector("canvas")!,
      manifest,
      baseUrl,
      onProgress: (progress, frame) => this.#emit<ScrollSequenceProgressDetail>("sf-progress", { progress, frame }),
      onReady: () => this.#emit("sf-ready", undefined),
    }).start();
  }

  #ensureStage(): HTMLElement {
    if (!this.#stage) {
      this.#stage = document.createElement("div");
      this.#stage.dataset.sfStage = "";
    }
    if (this.#stage.parentNode !== this) this.prepend(this.#stage);
    return this.#stage;
  }

  #applyScrollLength(): void {
    const length = this.getAttribute("scroll-length");
    if (length) this.style.setProperty("--sf-scroll-length", length);
    else this.style.removeProperty("--sf-scroll-length");
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
