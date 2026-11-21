// Writes public/plain.html: the <scroll-sequence> custom element on a plain HTML page, the way a
// server-rendered site (PHP, Django, Rails, static HTML) uses it: the CDN bundle in a classic
// <script>, the static stylesheet in <head>, and the poster stage rendered on the "server".
// Runs after `scrollframe` has generated public/sequence. Vite copies public/ verbatim.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { parseManifest, renderStageMarkup } from "@scrollframe/core";

const require = createRequire(import.meta.url);
const elementDist = dirname(require.resolve("@scrollframe/element/style.css"));
mkdirSync("public/vendor", { recursive: true });
for (const file of ["index.global.js", "scroll-sequence.css"]) {
  copyFileSync(join(elementDist, file), join("public/vendor", file));
}

const alt = "Synthetic test pattern with a running frame counter";
const manifest = parseManifest(JSON.parse(readFileSync("public/sequence/manifest.json", "utf8")));

writeFileSync(
  "public/plain.html",
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>scrollframe plain HTML e2e</title>
    <link rel="stylesheet" href="/vendor/scroll-sequence.css" />
    <script src="/vendor/index.global.js" defer></script>
    <script>
      // Read by the Playwright specs, like the React fixture's onProgress.
      window.__scrollframe = { progress: null, frame: null };
      addEventListener("sf-progress", (e) => (window.__scrollframe = e.detail));
    </script>
    <style>
      html, body { margin: 0; background: #111; color: #fff; font-family: system-ui, sans-serif; }
      .note { display: grid; place-items: center; height: 100vh; font-size: 2rem; }
      scroll-sequence h1 { margin: 2rem; font-size: 2rem; text-shadow: 0 2px 8px #000; }
    </style>
  </head>
  <body>
    <scroll-sequence src="/sequence/manifest.json" alt="${alt}" scroll-length="400vh">${renderStageMarkup(manifest, { alt })}<h1>scrollframe plain HTML</h1></scroll-sequence>
    <footer class="note">The end</footer>
  </body>
</html>
`,
);
console.log("Wrote public/plain.html");
