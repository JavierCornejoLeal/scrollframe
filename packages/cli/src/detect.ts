import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { UsageError } from "./options.js";

/** Frameworks the CLI writes a component for. `html` is any page without a supported framework. */
export type Framework = "next" | "react" | "angular" | "vue" | "html";
export type PackageManager = "pnpm" | "yarn" | "bun" | "npm";

export interface ProjectInfo {
  root: string;
  /** null when the project uses a framework the CLI does not support yet (see `unsupported`). */
  framework: Framework | null;
  /** Display name of a recognised but unsupported framework, e.g. "Svelte". */
  unsupported: string | null;
  /** Next.js only: which router the project uses. */
  router: "app" | "pages" | null;
  /** The project keeps its sources under `src/`. */
  srcDir: boolean;
  typescript: boolean;
  /** null when nothing says which one: the caller falls back to npm. */
  packageManager: PackageManager | null;
  hasPackageJson: boolean;
  /** Folder served at the site root (`public`), or null when there is none. */
  publicDir: string | null;
}

/** Checked before React and Vue: these meta-frameworks also depend on them but lay files out differently. */
const UNSUPPORTED: [dependency: string, name: string][] = [
  ["nuxt", "Nuxt"],
  ["@remix-run/react", "Remix"],
  ["@sveltejs/kit", "SvelteKit"],
  ["svelte", "Svelte"],
  ["astro", "Astro"],
  ["solid-js", "Solid"],
];

const LOCKFILES: [file: string, manager: PackageManager][] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
];

interface PackageJson {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  packageManager?: string;
}

const isDir = (path: string) => existsSync(path) && statSync(path).isDirectory();

function readPackageJson(root: string): PackageJson | null {
  const path = join(root, "package.json");
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PackageJson;
  } catch (error) {
    throw new UsageError(`Could not read ${path}: ${(error as Error).message}`);
  }
}

function detectFramework(root: string, deps: Record<string, string>): Pick<ProjectInfo, "framework" | "unsupported" | "router"> {
  const unsupported = UNSUPPORTED.find(([dependency]) => dependency in deps);
  if (unsupported) return { framework: null, unsupported: unsupported[1], router: null };
  if ("next" in deps) {
    const app = isDir(join(root, "app")) || isDir(join(root, "src/app"));
    return { framework: "next", unsupported: null, router: app ? "app" : "pages" };
  }
  if ("@angular/core" in deps) return { framework: "angular", unsupported: null, router: null };
  if ("vue" in deps) return { framework: "vue", unsupported: null, router: null };
  if ("react" in deps) return { framework: "react", unsupported: null, router: null };
  return { framework: "html", unsupported: null, router: null };
}

function detectPackageManager(root: string, pkg: PackageJson | null): PackageManager | null {
  const declared = pkg?.packageManager?.split("@")[0];
  if (declared === "pnpm" || declared === "yarn" || declared === "bun" || declared === "npm") return declared;
  return LOCKFILES.find(([file]) => existsSync(join(root, file)))?.[1] ?? null;
}

/** Reads the project in `root`: which framework, TypeScript or not, and which package manager. */
export function detectProject(root: string): ProjectInfo {
  const pkg = readPackageJson(root);
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  return {
    root,
    ...detectFramework(root, deps),
    srcDir: isDir(join(root, "src")),
    typescript: existsSync(join(root, "tsconfig.json")) || "typescript" in deps,
    packageManager: detectPackageManager(root, pkg),
    hasPackageJson: pkg !== null,
    publicDir: isDir(join(root, "public")) ? "public" : null,
  };
}
