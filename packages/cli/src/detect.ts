import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { UsageError } from "./options.js";
import { readText } from "./files.js";
import { nameUnrecognised, suggest, type Manifest } from "./recognise.js";

/** Frameworks the CLI writes a component for. `html` is a folder of static pages. */
export type Framework = "next" | "react" | "angular" | "vue" | "html";
export type PackageManager = "pnpm" | "yarn" | "bun" | "npm";

export interface ProjectInfo {
  root: string;
  /** What the project looks like: a suggestion to confirm. null when there is none. */
  framework: Framework | null;
  /** Display name of a framework without a template, e.g. "Svelte"; null otherwise. */
  unsupported: string | null;
  /** What to check before confirming the suggestion; empty for a standard project. */
  doubts?: string[];
  /** A doubt is about where files are served: no URL is suggested. */
  urlUnknown?: boolean;
  /** Next.js only: which router the project uses. */
  router: "app" | "pages" | null;
  /** The project keeps its sources under `src/`. */
  srcDir: boolean;
  typescript: boolean;
  /** null when nothing says which one: the caller falls back to npm. */
  packageManager: PackageManager | null;
  hasPackageJson: boolean;
  /** Names of every dependency and devDependency. */
  dependencies: string[];
  /** Folder served at the site root (`public`, or `static` for some stacks), or null when there is none. */
  publicDir: string | null;
}

const LOCKFILES: [file: string, manager: PackageManager][] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
];

interface PackageJson extends Manifest {
  packageManager?: unknown;
}

const isDir = (path: string) => existsSync(path) && statSync(path).isDirectory();

function readPackageJson(root: string): PackageJson | null {
  const path = join(root, "package.json");
  if (!existsSync(path)) return null;
  const text = readText(path);
  if (text === null) throw new UsageError(`Could not read ${path}: it is not a readable file.`);
  try {
    const json: unknown = JSON.parse(text);
    if (typeof json !== "object" || json === null) throw new Error("not a JSON object");
    return json as PackageJson;
  } catch (error) {
    throw new UsageError(`Could not read ${path}: ${(error as Error).message}`);
  }
}

function detectPackageManager(root: string, pkg: PackageJson | null): PackageManager | null {
  const declared = typeof pkg?.packageManager === "string" ? pkg.packageManager.split("@")[0] : undefined;
  if (declared === "pnpm" || declared === "yarn" || declared === "bun" || declared === "npm") return declared;
  return LOCKFILES.find(([file]) => existsSync(join(root, file)))?.[1] ?? null;
}

/** Reads the project in `root`: which framework, TypeScript or not, and which package manager. */
export function detectProject(root: string): ProjectInfo {
  const pkg = readPackageJson(root);
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  const found = suggest(root, pkg);
  const named = found.framework === null ? nameUnrecognised(root, deps) : null;
  return {
    root,
    framework: found.framework,
    unsupported: named?.name ?? null,
    doubts: found.doubts,
    urlUnknown: found.urlUnknown,
    router: found.router,
    srcDir: isDir(join(root, "src")),
    typescript: existsSync(join(root, "tsconfig.json")) || "typescript" in deps,
    packageManager: detectPackageManager(root, pkg),
    hasPackageJson: pkg !== null,
    dependencies: Object.keys(deps),
    publicDir: named?.staticDir ?? (isDir(join(root, "public")) ? "public" : null),
  };
}
