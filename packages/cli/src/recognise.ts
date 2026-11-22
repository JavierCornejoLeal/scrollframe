import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import type { Framework } from "./detect.js";
import { readText } from "./files.js";
import { printable } from "./printable.js";

// Detection suggests, it never authorizes: the person confirms or corrects the suggestion, and
// unattended runs need explicit values. `doubts` are what to check before confirming: Enter is a
// yes only without doubts, so a doubt costs one typed "y" and can afford to be strict. Nothing
// here proves where the frames are served.

export interface Suggestion {
  framework: Framework | null;
  router: "app" | "pages" | null;
  doubts: string[];
  /** A doubt is about where the site serves files, so a URL cannot be suggested: it has to be typed. */
  urlUnknown?: boolean;
}

export interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, unknown>;
}

const baseHref = (html: string) => /<base\s[^>]*href\s*=\s*["']?([^"'\s>]+)/i.exec(html)?.[1];

const isDir = (path: string) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** Every module a config imports, re-exports or requires; null for one that is computed. */
function importsOf(source: string): (string | null)[] {
  // A JSDoc type such as `@type {import('next').NextConfig}` loads nothing; starters ship it.
  const code = source.replace(/@(?:type|satisfies|param|returns?|typedef)\s*\{\s*import\(\s*["'][^"']+["']\s*\)(?:\.\w+)+\s*\}/g, "");
  const found = [...code.matchAll(/(?:\bfrom|^\s*import)\s*["']([^"']+)["']/gm)].map((match) => match[1]!);
  return /\brequire\s*\(|\bimport\s*\(/.test(code) ? [...found, null] : found;
}

/** What makes a config's effective values unknowable from its text. */
function configDoubts(file: string, code: string, knownImport: (from: string) => boolean): string[] {
  const doubts: string[] = [];
  for (const from of new Set(importsOf(code))) {
    if (from === null) doubts.push(`${file} loads modules dynamically`);
    else if (!knownImport(from)) doubts.push(`${file} imports ${printable(from)}`);
  }
  if (/\.\.\.|Object\.assign|mergeConfig|[{,]\s*\[[^\]\n]+\]\s*:/.test(code)) doubts.push(`${file} builds options dynamically`);
  if (/process\.env|import\.meta\.env|\bloadEnv\b/.test(code)) doubts.push(`${file} reads the environment`);
  return doubts;
}

function scriptWith(pkg: Manifest, flag: RegExp): string | null {
  const found = Object.entries(pkg.scripts ?? {}).find(([, script]) => typeof script === "string" && flag.test(script));
  return found?.[0] ?? null;
}

function suggestNext(root: string): Suggestion {
  const doubts: string[] = [];
  let urlUnknown = false;
  for (const file of ["next.config.js", "next.config.mjs", "next.config.cjs", "next.config.ts", "next.config.mts"]) {
    if (!existsSync(join(root, file))) continue;
    const config = readText(join(root, file));
    if (config === null) {
      doubts.push(`${file} cannot be read`);
      urlUnknown = true; // It may set basePath.
      continue;
    }
    if (/\bbasePath\b/.test(config)) {
      doubts.push(`${file} mentions basePath`);
      urlUnknown = true;
    }
    doubts.push(...configDoubts(file, config, (from) => from === "next"));
  }
  let router: Suggestion["router"] = null;
  if (isDir(join(root, "app")) || isDir(join(root, "src/app"))) router = "app";
  else if (isDir(join(root, "pages")) || isDir(join(root, "src/pages"))) router = "pages";
  else doubts.push("there is no app/ or pages/ folder here");
  return { framework: "next", router, doubts, urlUnknown };
}

const REACT_PLUGINS = ["@vitejs/plugin-react", "@vitejs/plugin-react-swc"];
const VUE_PLUGIN = "@vitejs/plugin-vue";
/** Imports of the official starters. Another one can change what is served, so it is a doubt. */
const STARTER_IMPORTS = new Set([
  ...REACT_PLUGINS, VUE_PLUGIN, "vite", "vitest/config", "url", "path",
  "@vitejs/plugin-vue-jsx", "vite-plugin-vue-devtools", "@tailwindcss/vite", "@rolldown/plugin-babel",
]);

function suggestVite(root: string, pkg: Manifest, deps: Record<string, string>): Suggestion | null {
  if (!existsSync(join(root, "index.html"))) return null;
  const react = "react" in deps;
  const vue = "vue" in deps;
  if (!react && !vue) return null;

  const doubts: string[] = [];
  let urlUnknown = false;
  // In the order Vite looks for them: it loads only the first.
  const files = ["js", "mjs", "ts", "cjs", "mts", "cts"].map((ext) => `vite.config.${ext}`).filter((name) => existsSync(join(root, name)));
  const file = files[0];
  if (files.length > 1) doubts.push(`there are several Vite configs (${files.join(", ")})`);
  if (REACT_PLUGINS.some((plugin) => plugin in deps) && VUE_PLUGIN in deps) doubts.push("both the React and the Vue plugin are installed");
  const config = file ? readText(join(root, file)) : null;
  let usesReact = false;
  let usesVue = false;
  if (!file) doubts.push("there is no vite.config, so nothing shows the React or Vue plugin");
  else if (config === null) {
    doubts.push(`${file} cannot be read`);
    urlUnknown = true; // It may set base, root or publicDir.
  } else {
    const imports = importsOf(config);
    usesReact = react && REACT_PLUGINS.some((plugin) => imports.includes(plugin));
    usesVue = vue && imports.includes(VUE_PLUGIN);
    if (usesReact === usesVue) doubts.push(`${file} does not show one React or Vue plugin`);
    doubts.push(...configDoubts(file, config, (from) => STARTER_IMPORTS.has(from) || from.startsWith("node:")));
    // Also in comments and nested options: asking costs a "y", guessing costs a broken page.
    for (const option of ["base", "root", "publicDir"]) {
      if (new RegExp(`\\b${option}\\b`).test(config)) {
        doubts.push(`${file} mentions ${option}`);
        urlUnknown = true;
      }
    }
  }
  const script = scriptWith(pkg, /\bvite\b.*\s(?:--(?:base|root|config)(?=[=\s]|$)|-c\s)/);
  if (script) {
    doubts.push(`the "${printable(script)}" script passes options that can move the site`);
    urlUnknown = true;
  }

  const framework = usesVue || (!usesReact && vue) ? "vue" : "react";
  return { framework, router: null, doubts, urlUnknown };
}

interface AngularAsset {
  glob?: string;
  input?: string;
  output?: string;
  ignore?: string[];
}
interface AngularOptions {
  assets?: (string | AngularAsset)[];
  baseHref?: string;
}
interface AngularProject {
  root?: string;
  sourceRoot?: string;
  i18n?: { locales?: object };
  architect?: { build?: { options?: AngularOptions; configurations?: Record<string, AngularOptions> } };
}

/** public/, whole, copied to the site root. */
const servesPublic = (assets: unknown) =>
  Array.isArray(assets) &&
  (assets as (string | AngularAsset | null)[]).some(
    (asset) =>
      typeof asset === "object" &&
      asset !== null &&
      asset.glob === "**/*" &&
      !asset.ignore?.length &&
      (asset.input === "public" || asset.input === "public/") &&
      ["", "/", ".", undefined].includes(asset.output),
  );

function suggestAngular(root: string, pkg: Manifest): Suggestion {
  const doubts: string[] = [];
  try {
    const workspace = JSON.parse(readText(join(root, "angular.json")) ?? "") as { projects?: Record<string, AngularProject> };
    const projects = Object.values(workspace.projects ?? {});
    if (projects.length !== 1) doubts.push("angular.json does not have exactly one project");
    const app = projects[0];
    if (app?.root || (app?.sourceRoot && app.sourceRoot !== "src")) doubts.push("the Angular app is not in src/");

    const build = app?.architect?.build;
    const configurations = Object.values(build?.configurations ?? {});
    const assets = [build?.options?.assets, ...configurations.filter((c) => c.assets).map((c) => c.assets)];
    if (!assets.every(servesPublic)) doubts.push("angular.json does not copy all of public/ to the site root");
    if ([build?.options, ...configurations].some((options) => options?.baseHref && options.baseHref !== "/")) {
      doubts.push("angular.json sets baseHref");
    }
    if (Object.keys(app?.i18n?.locales ?? {}).length > 0) doubts.push("angular.json builds one folder per language");
  } catch {
    doubts.push("angular.json cannot be read");
  }
  const base = baseHref(readText(join(root, "src/index.html")) ?? "");
  if (base && base !== "/") doubts.push("src/index.html sets another base href");
  const script = scriptWith(pkg, /--(?:base-href|baseHref)(?=[=\s]|$)/);
  if (script) doubts.push(`the "${printable(script)}" script sets --base-href`);
  // Every Angular doubt is about what is copied or where it is served.
  return { framework: "angular", router: null, doubts, urlUnknown: doubts.length > 0 };
}

/** Files that make a folder a program or a generated site, not a folder of static pages. */
const PROGRAM_FILES = [
  "composer.json", "artisan", "manage.py", "pyproject.toml", "requirements.txt",
  "Gemfile", "go.mod", "pom.xml", "build.gradle", "build.gradle.kts",
];
const SERVER_SOURCES = new Set([".php", ".py", ".rb", ".csproj"]);
const PARENT_PROJECT_FILES = [...PROGRAM_FILES, "package.json", "index.html", "index.php", "wp-load.php"];

function realPath(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/** The file that shows `root` is inside another project, looking up to the repository top or the home folder. */
function enclosingProject(root: string): string | null {
  const outside = new Set([realPath(homedir()), realPath(tmpdir())]);
  for (let dir = realPath(root); ; ) {
    if (existsSync(join(dir, ".git"))) return null;
    const parent = dirname(dir);
    if (parent === dir || outside.has(parent)) return null;
    const file = PARENT_PROJECT_FILES.find((name) => existsSync(join(parent, name)));
    if (file) return file;
    dir = parent;
  }
}

/** Starts like a page, after comments. */
function isPage(html: string): boolean {
  let text = html.trimStart();
  while (text.startsWith("<!--")) {
    const end = text.indexOf("-->");
    if (end === -1) return false;
    text = text.slice(end + 3).trimStart();
  }
  return /^(?:<!doctype html|<html[\s>])/i.test(text);
}

function suggestHtml(root: string): Suggestion | null {
  const page = readText(join(root, "index.html"));
  if (page === null || !isPage(page)) return null;
  const doubts: string[] = [];
  if (/\{%|<%|<\?php/.test(page)) doubts.push("index.html looks like a template");
  const base = baseHref(page);
  let urlUnknown = Boolean(base && base !== "/");
  if (urlUnknown) doubts.push("index.html sets another base href");
  const generator = nameUnrecognised(root, {});
  if (generator) doubts.push(`this looks like a ${generator.name} site`);
  try {
    const program = readdirSync(root).find(
      (file) => PROGRAM_FILES.includes(file) || SERVER_SOURCES.has(extname(file).toLowerCase()),
    );
    if (program) doubts.push(`${printable(program)} means it is not only static pages`);
  } catch {
    doubts.push("this folder cannot be read");
  }
  const parent = enclosingProject(root);
  if (parent) doubts.push(`it is inside another project, which has ${parent}`);
  if (parent) urlUnknown = true;
  return { framework: "html", router: null, doubts, urlUnknown };
}

/** What the project in `root` looks like, and what to check before trusting that. */
export function suggest(root: string, pkg: Manifest | null): Suggestion {
  const none: Suggestion = { framework: null, router: null, doubts: [] };
  if (pkg === null) return suggestHtml(root) ?? none;

  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  let found: Suggestion | null = null;
  if ("next" in deps) found = suggestNext(root);
  else if ("@angular/core" in deps) found = suggestAngular(root, pkg);
  else if ("vite" in deps) found = suggestVite(root, pkg, deps);
  if (!found) return none;

  if ("electron" in deps) {
    found.doubts.push("Electron pages are usually loaded from files, where /sequence does not exist");
    found.urlUnknown = true;
  }
  if (existsSync(join(root, "artisan"))) found.doubts.push("Laravel serves the front end");
  return found;
}

/** A name for a project that was not recognised. It never decides whether a project is set up. */
export function nameUnrecognised(root: string, deps: Record<string, string>): { name: string; staticDir?: string } | null {
  if ("gatsby" in deps) return { name: "Gatsby", staticDir: "static" };
  if ("@docusaurus/core" in deps) return { name: "Docusaurus", staticDir: "static" };
  if ("@sveltejs/kit" in deps) return { name: "SvelteKit", staticDir: "static" };
  if ("nuxt" in deps) return { name: "Nuxt" };
  if ("@remix-run/react" in deps) return { name: "Remix" };
  if ("astro" in deps) return { name: "Astro" };
  if ("svelte" in deps) return { name: "Svelte" };
  if ("solid-js" in deps) return { name: "Solid" };
  const hugo =
    ["hugo.toml", "hugo.yaml", "hugo.json"].some((file) => existsSync(join(root, file))) ||
    (existsSync(join(root, "config.toml")) && isDir(join(root, "content")));
  return hugo ? { name: "Hugo", staticDir: "static" } : null;
}
