import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.tsx"],
  format: ["esm", "cjs"],
  dts: true,
  clean: true,
  external: ["react"],
  // Next.js App Router: the component uses effects, so it must be a client component.
  banner: { js: '"use client";' },
});
