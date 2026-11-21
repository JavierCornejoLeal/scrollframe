import { copyFile } from "node:fs/promises";
import { defineConfig } from "tsup";

// dist is cleaned once by the build script: the two configs run in parallel, so a per-config
// `clean` could delete the other config's output.
export default defineConfig([
  // npm consumers (bundlers, Node SSR): core stays an external dependency.
  {
    entry: ["src/index.ts"],
    format: ["esm", "cjs"],
    dts: true,
  },
  // <script src> from a CDN, no bundler: one self-contained file exposing `window.ScrollFrame`.
  {
    entry: ["src/index.ts"],
    format: ["iife"],
    globalName: "ScrollFrame",
    noExternal: ["@scrollframe/core"],
    minify: true,
    target: "es2020",
    async onSuccess() {
      await copyFile("src/scroll-sequence.css", "dist/scroll-sequence.css");
    },
  },
]);
