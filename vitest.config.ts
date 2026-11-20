import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Tests run against sources, so no build step is needed first.
    alias: { "@scrollframe/core": fileURLToPath(new URL("./packages/core/src/index.ts", import.meta.url)) },
  },
  test: {
    include: ["packages/*/test/**/*.test.ts", "packages/*/test/**/*.test.tsx"],
  },
});
