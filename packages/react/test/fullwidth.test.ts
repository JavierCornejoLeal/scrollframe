// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it } from "vitest";
import { ScrollSequence } from "../src/index.js";

const manifest = {
  version: 1,
  frameCount: 10,
  baseUrl: "/sequence",
  pattern: "frame-{index}.webp",
  padding: 4,
  poster: "poster.webp",
  sets: [{ name: "desktop", maxViewportWidth: null, width: 1920, height: 1080, dir: "desktop" }],
};

afterEach(() => {
  delete (document.documentElement as { clientWidth?: number }).clientWidth;
  document.body.replaceChildren();
});

it("follows fullWidth when it is switched off on a mounted component", () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(document.documentElement, "clientWidth", { configurable: true, value: 1200 });
  window.IntersectionObserver = class {
    observe() {}
    disconnect() {}
  } as never;
  HTMLCanvasElement.prototype.getContext = (() => ({ drawImage() {} })) as never;
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);

  act(() => root.render(createElement(ScrollSequence, { manifest, alt: "x" })));
  const { style } = host.querySelector("section")!;
  expect(style.width).toBe("1200px");
  act(() => root.render(createElement(ScrollSequence, { manifest, alt: "x", fullWidth: false })));
  expect([style.width, style.marginLeft, style.marginRight]).toEqual(["", "", ""]);
  act(() => root.unmount());
});
