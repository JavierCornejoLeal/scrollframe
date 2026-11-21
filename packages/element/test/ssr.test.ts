// Runs in plain Node (no DOM), like an SSR build of Angular, Astro or Next.js.
import { describe, expect, it } from "vitest";

describe("@scrollframe/element without a DOM", () => {
  it("can be imported and defineScrollSequence is a no-op", async () => {
    const { defineScrollSequence, ScrollSequenceElement } = await import("../src/index.js");
    expect(typeof ScrollSequenceElement).toBe("function");
    expect(defineScrollSequence()).toBeUndefined();
  });
});
