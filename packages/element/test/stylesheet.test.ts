import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { scrollSequenceStyles } from "../src/index.js";

const staticCss = readFileSync(new URL("../src/scroll-sequence.css", import.meta.url), "utf8");

describe("static stylesheet", () => {
  it("is exactly what the element injects for <scroll-sequence>, so it can be loaded before any script", () => {
    expect(staticCss.trim()).toBe(scrollSequenceStyles("scroll-sequence"));
  });

  it("pins the stage and the children of a not-yet-upgraded element", () => {
    expect(scrollSequenceStyles("scroll-sequence")).toContain(
      "scroll-sequence{display:grid;position:relative;height:var(--sf-scroll-length,300vh)}",
    );
    expect(scrollSequenceStyles("scroll-sequence")).toContain(
      "scroll-sequence>*{grid-area:1/1;align-self:start;position:sticky;top:0}",
    );
  });

  it("spans the page before any script, unless full-width is false", () => {
    expect(scrollSequenceStyles("scroll-sequence")).toContain(
      'scroll-sequence:not([full-width="false"]){width:100vw;max-width:none;flex-shrink:0;box-sizing:border-box;left:calc(50% - 50vw)}',
    );
  });

  it("scopes the rules to a custom tag name", () => {
    expect(scrollSequenceStyles("my-story")).toMatch(/^my-story\{/);
    expect(scrollSequenceStyles("my-story")).not.toContain("scroll-sequence");
  });
});
