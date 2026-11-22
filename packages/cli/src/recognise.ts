import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, extname, join, resolve } from "node:path";
import type { Framework } from "./detect.js";
import { readText } from "./files.js";

// The CLI sets up only what it positively recognises. Having a dependency is not enough: the
// files that decide where the frames are served must be there and say what the templates assume.
// Anything else gets frames only, with the reason; --framework forces the set-up.

export type Recognition =
  | { framework: Framework; router: "app" | "pages" | null }
  | { framework: null; reason: string };

export interface Manifest {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  scripts?: Record<string, unknown>;
}

const no = (reason: string): Recognition => ({ framework: null, reason });
const yes = (framework: Framework, router: "app" | "pages" | null = null): Recognition => ({ framework, router });

const isDir = (path: string) => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** Config source without block comments that start a line and without whole-line `//` comments. */
const withoutComments = (code: string) => code.replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, "").replace(/^[ \t]*\/\/.*$/gm, "");

function scriptWith(pkg: Manifest, flag: RegExp): string | null {
  const found = Object.entries(pkg.scripts ?? {}).find(([, script]) => typeof script === "string" && flag.test(script));
  return found?.[0] ?? null;
}

function recogniseNext(root: string): Recognition {
  for (const file of ["next.config.js", "next.config.mjs", "next.config.cjs", "next.config.ts", "next.config.mts"]) {
    const path = join(root, file);
    if (!existsSync(path)) continue;
    const config = readText(path);
    if (config === null) return no(`${file} cannot be read`);
    if (/\bbasePath\b/.test(withoutComments(config))) return no(`${file} sets basePath`);
  }
  if (isDir(join(root, "app")) || isDir(join(root, "src/app"))) return yes("next", "app");
  if (isDir(join(root, "pages")) || isDir(join(root, "src/pages"))) return yes("next", "pages");
  return no("Next.js without an app/ or pages/ folder here");
}

function recogniseVite(root: string, pkg: Manifest, deps: Record<string, string>): Recognition {
  if (!existsSync(join(root, "index.html"))) return no("Vite without an index.html here");

  const vue = "vue" in deps && "@vitejs/plugin-vue" in deps;
  const react =
    "react" in deps && "react-dom" in deps && ("@vitejs/plugin-react" in deps || "@vitejs/plugin-react-swc" in deps);
  if (vue && react) return no("Vite with both the React and the Vue plugin");
  if (!vue && !react) return no("Vite without the React or Vue plugin");

  for (const ext of ["js", "mjs", "cjs", "ts", "mts", "cts"]) {
    const file = `vite.config.${ext}`;
    if (!existsSync(join(root, file))) continue;
    const config = readText(join(root, file));
    if (config === null) return no(`${file} cannot be read`);
    const code = withoutComments(config).replace(/\bbase\s*:\s*(["'])\/\1/g, "");
    const option = /(?:^|[{,\s])["']?(base|root|publicDir)["']?[ \t]*[:,}]/m.exec(code)?.[1];
    if (option) return no(`${file} sets ${option}`);
  }
  const script = scriptWith(pkg, /--base(?=[=\s]|$)/);
  if (script) return no(`the "${script}" script sets --base`);
  return yes(vue ? "vue" : "react");
}

interface AngularAsset {
  glob?: string;
  input?: string;
  output?: string;
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
      (asset.input === "public" || asset.input === "public/") &&
      ["", "/", ".", undefined].includes(asset.output),
  );

function recogniseAngular(root: string, pkg: Manifest): Recognition {
  try {
    const workspace = JSON.parse(readText(join(root, "angular.json")) ?? "") as { projects?: Record<string, AngularProject> };
    const projects = Object.values(workspace.projects ?? {});
    if (projects.length !== 1) return no("angular.json does not have exactly one project");
    const app = projects[0]!;
    if (app.root || (app.sourceRoot && app.sourceRoot !== "src")) return no("the Angular app is not in src/");

    const build = app.architect?.build;
    const configurations = Object.values(build?.configurations ?? {});
    const assets = [build?.options?.assets, ...configurations.filter((c) => c.assets).map((c) => c.assets)];
    if (!assets.every(servesPublic)) return no("angular.json does not serve public/ at the site root");

    if ([build?.options, ...configurations].some((options) => options?.baseHref && options.baseHref !== "/")) {
      return no("angular.json sets baseHref");
    }
    if (Object.keys(app.i18n?.locales ?? {}).length > 0) return no("angular.json builds one folder per language");
  } catch {
    return no("angular.json cannot be read");
  }
  const base = /<base\s[^>]*href\s*=\s*["']?([^"'\s>]+)/i.exec(readText(join(root, "src/index.html")) ?? "")?.[1];
  if (base && base !== "/") return no("src/index.html sets another base href");
  const script = scriptWith(pkg, /--(?:base-href|baseHref)(?=[=\s]|$)/);
  if (script) return no(`the "${script}" script sets --base-href`);
  return yes("angular");
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

/** Starts like a page (after comments) and has no template syntax. */
function isStaticPage(html: string): boolean {
  let text = html.trimStart();
  while (text.startsWith("<!--")) {
    const end = text.indexOf("-->");
    if (end === -1) return false;
    text = text.slice(end + 3).trimStart();
  }
  return /^(?:<!doctype html|<html[\s>])/i.test(text) && !/\{%|<%|<\?php/.test(text);
}

function recogniseHtml(root: string): Recognition {
  const page = readText(join(root, "index.html"));
  if (page === null) return no("no index.html page or supported framework here");
  if (!isStaticPage(page)) return no("index.html is not a static page");
  let files: string[];
  try {
    files = readdirSync(root);
  } catch {
    return no("this folder cannot be read");
  }
  const program = files.find((file) => PROGRAM_FILES.includes(file) || SERVER_SOURCES.has(extname(file).toLowerCase()));
  if (program) return no(`${program} means it is not only static pages`);
  const parent = enclosingProject(root);
  if (parent) return no(`it is inside another project, which has ${parent}`);
  return yes("html");
}

/** What the project in `root` is, when that is certain. */
export function recognise(root: string, pkg: Manifest | null): Recognition {
  if (pkg === null) return recogniseHtml(root);
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  // file:// pages cannot load /sequence, whatever builds them.
  if ("electron" in deps) return no("Electron apps do not serve files at /");
  if (existsSync(join(root, "artisan"))) return no("Laravel serves the front end");
  if ("next" in deps) return recogniseNext(root);
  if ("@angular/core" in deps) return recogniseAngular(root, pkg);
  if ("vite" in deps) return recogniseVite(root, pkg, deps);
  return no("package.json without Next.js, Angular, or Vite with React or Vue");
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
