import { closeSync, existsSync, openSync, readSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/** A stack the CLI recognises so that it does not set it up as something it is not. */
export interface UnsupportedStack {
  name: string;
  /** Its static folder, when that is not `public/` (which may be its build output). */
  staticDir?: string;
  /** What to do instead, when a plain HTML snippet is not enough. */
  advice?: string;
}

const STATIC_URL_ADVICE =
  "For a plain HTML snippet use --framework html, with -o and --base-url set to where the site serves the frames.";
const NATIVE_ADVICE = "scrollframe needs a web page (DOM and canvas).";

type DependencyRule = [dependency: string, stack: UnsupportedStack];

/** Meta-frameworks: they also depend on React, Vue, Svelte or Angular but lay files out differently. */
const META_FRAMEWORKS: DependencyRule[] = [
  ["nuxt", { name: "Nuxt" }],
  ["@remix-run/react", { name: "Remix" }],
  ["@sveltejs/kit", { name: "SvelteKit", staticDir: "static" }],
  ["svelte", { name: "Svelte" }],
  ["astro", { name: "Astro" }],
  ["solid-js", { name: "Solid" }],
  // The dev package marks framework mode; react-router alone is a library in a normal React app.
  ["@react-router/dev", { name: "React Router" }],
  ["@tanstack/react-start", { name: "TanStack Start" }],
  ["gatsby", { name: "Gatsby", staticDir: "static" }],
  ["@docusaurus/core", { name: "Docusaurus", staticDir: "static" }],
  ["vitepress", { name: "VitePress", advice: STATIC_URL_ADVICE }],
  ["quasar", { name: "Quasar" }],
  ["@vue/cli-service", { name: "Vue CLI" }],
  // Cannot import manifest.json from public/: imports outside src/ are refused.
  ["react-scripts", { name: "Create React App" }],
  ["@analogjs/platform", { name: "Analog" }],
];

/** Checked after Next.js, which can depend on these too (react-native-web, desktop shells). */
const OTHER_PLATFORMS: DependencyRule[] = [
  ["expo", { name: "Expo", advice: NATIVE_ADVICE }],
  ["react-native", { name: "React Native", advice: NATIVE_ADVICE }],
  // file:// pages cannot load /sequence.
  ["electron", { name: "Electron", advice: STATIC_URL_ADVICE }],
  ["@inertiajs/react", { name: "Inertia", advice: STATIC_URL_ADVICE }],
  ["@inertiajs/vue3", { name: "Inertia", advice: STATIC_URL_ADVICE }],
  ["@11ty/eleventy", { name: "Eleventy", advice: STATIC_URL_ADVICE }],
];

/** Only when the project is not React, Vue or Angular, which can use these as libraries. */
const OTHER_LIBRARIES: DependencyRule[] = [
  ["preact", { name: "Preact" }],
  ["@builder.io/qwik", { name: "Qwik" }],
];

const HEAD_BYTES = 8192;

/** The start of a file, or "" when it is missing or unreadable. */
function head(path: string): string {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const buffer = Buffer.alloc(HEAD_BYTES);
    return buffer.toString("utf8", 0, readSync(fd, buffer, 0, HEAD_BYTES, 0));
  } catch {
    return "";
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function filesIn(root: string): string[] {
  try {
    return readdirSync(root);
  } catch {
    return [];
  }
}

/** Inside a WordPress install or wp-content, or the root of a theme or plugin. */
function isWordPress(root: string, files: string[]): boolean {
  for (let dir = resolve(root); ; dir = dirname(dir)) {
    if (basename(dir) === "wp-content" || existsSync(join(dir, "wp-load.php"))) return true;
    if (dirname(dir) === dir) break;
  }
  // WordPress itself reads these headers from the start of the file to find themes and plugins.
  if (files.includes("style.css") && /^[ \t/*#@]*Theme Name:/im.test(head(join(root, "style.css")))) return true;
  return files.some((file) => file.endsWith(".php") && /^[ \t/*#@]*Plugin Name:/im.test(head(join(root, file))));
}

/** Backends and site generators, recognised by their own files: each serves static files its own way. */
function detectSite(root: string): UnsupportedStack | null {
  const files = filesIn(root);
  const has = (path: string) => existsSync(join(root, path));
  const site = (name: string): UnsupportedStack => ({ name, advice: STATIC_URL_ADVICE });

  if (isWordPress(root, files)) return site("WordPress");
  if (has("artisan")) return site("Laravel");
  if (has("bin/console") && has("composer.json")) return site("Symfony");
  if (/django/i.test(head(join(root, "manage.py")))) return site("Django");
  if (["app.py", "wsgi.py"].some((file) => /^\s*from flask\b/m.test(head(join(root, file))))) return site("Flask");
  if (has("config/application.rb")) return site("Rails");
  if (["hugo.toml", "hugo.yaml", "hugo.json"].some(has)) return { name: "Hugo", staticDir: "static", advice: STATIC_URL_ADVICE };
  if (has("_config.yml") && has("Gemfile")) return site("Jekyll");
  if (["pom.xml", "build.gradle", "build.gradle.kts"].some((file) => /spring-boot|org\.springframework\.boot/.test(head(join(root, file))))) {
    return site("Spring Boot");
  }
  if (has("wwwroot") && files.some((file) => file.endsWith(".csproj"))) return site("ASP.NET");
  return null;
}

/** The stack in `root` the CLI cannot set up yet, or null when it is one it supports. */
export function detectUnsupported(root: string, deps: Record<string, string>): UnsupportedStack | null {
  const byDependency = (rules: DependencyRule[]) => rules.find(([dependency]) => dependency in deps)?.[1] ?? null;

  const meta = byDependency(META_FRAMEWORKS);
  if (meta) return meta;
  if ("next" in deps) return null;

  const other = detectSite(root) ?? byDependency(OTHER_PLATFORMS);
  if (other) return other;

  if ("@angular/core" in deps) {
    // Before Angular 18 static files live in src/assets, so /sequence would be a 404.
    return !existsSync(join(root, "public")) && existsSync(join(root, "src/assets"))
      ? { name: "Angular without a public/ folder", advice: STATIC_URL_ADVICE }
      : null;
  }
  return "react" in deps || "vue" in deps ? null : byDependency(OTHER_LIBRARIES);
}
