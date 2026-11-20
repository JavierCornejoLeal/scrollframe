// @vitest-environment jsdom
import { StrictMode, act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScrollSequenceOptions } from "@scrollframe/core";

const engines: FakeEngine[] = [];

class FakeEngine {
  started = 0;
  destroyed = 0;
  constructor(readonly options: ScrollSequenceOptions) {
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

vi.mock("@scrollframe/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@scrollframe/core")>()),
  ScrollSequence: FakeEngine,
}));

const { ScrollSequence } = await import("../src/index.js");

const manifest = {
  version: 1,
  frameCount: 10,
  baseUrl: "/sequence",
  pattern: "frame-{index}.webp",
  padding: 4,
  poster: "poster.webp",
  sets: [{ name: "desktop", maxViewportWidth: null, width: 1920, height: 1080, dir: "desktop" }],
};

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  engines.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function render(props: Record<string, unknown> = {}, strict = false) {
  const element = createElement(ScrollSequence, { manifest, alt: "Scene", ...props });
  act(() => root.render(strict ? createElement(StrictMode, null, element) : element));
}

describe("ScrollSequence lifecycle", () => {
  it("starts one engine bound to the rendered section and canvas", () => {
    render({ baseUrl: "https://cdn.example.com/seq" });
    expect(engines).toHaveLength(1);
    const [engine] = engines;
    expect(engine!.started).toBe(1);
    expect(engine!.options.container).toBe(host.querySelector("section"));
    expect(engine!.options.canvas).toBe(host.querySelector("canvas"));
    expect(engine!.options.baseUrl).toBe("https://cdn.example.com/seq");
  });

  it("destroys the engine on unmount", () => {
    render();
    act(() => root.unmount());
    expect(engines[0]!.destroyed).toBe(1);
    root = createRoot(host); // afterEach unmounts again
  });

  it("leaves exactly one live engine under StrictMode double effects", () => {
    render({}, true);
    const live = engines.filter((engine) => engine.started > engine.destroyed);
    expect(live).toHaveLength(1);
  });

  it("keeps the engine when only onProgress changes, and calls the latest callback", () => {
    const first = vi.fn();
    const second = vi.fn();
    render({ onProgress: first });
    render({ onProgress: second });
    expect(engines).toHaveLength(1);
    engines[0]!.options.onProgress!(0.5, 4);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith(0.5, 4);
  });

  it("recreates the engine when baseUrl changes", () => {
    render({ baseUrl: "/a" });
    render({ baseUrl: "/b" });
    expect(engines).toHaveLength(2);
    expect(engines[0]!.destroyed).toBe(1);
    expect(engines[1]!.options.baseUrl).toBe("/b");
  });

  it("does not recreate the engine when re-rendered with the same manifest object", () => {
    render();
    render({ className: "hero" });
    expect(engines).toHaveLength(1);
  });
});
