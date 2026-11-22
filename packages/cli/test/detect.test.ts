import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { detectProject } from "../src/index.js";

const scratch = mkdtempSync(join(tmpdir(), "scrollframe-detect-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let count = 0;
/** Creates a project folder from `{ path: contents }`; a path ending in "/" is a directory. */
function project(files: Record<string, string | object>): string {
  const root = join(scratch, `p${++count}`);
  mkdirSync(root);
  for (const [path, contents] of Object.entries(files)) {
    const full = join(root, path);
    if (path.endsWith("/")) {
      mkdirSync(full, { recursive: true });
      continue;
    }
    mkdirSync(dirname(full), { recursive: true });
    writeFileSync(full, typeof contents === "string" ? contents : JSON.stringify(contents));
  }
  return root;
}

const pkg = (dependencies: Record<string, string> = {}, extra: object = {}) => ({ name: "app", dependencies, ...extra });

describe("detectProject: framework", () => {
  it("detects Next.js with the App Router", () => {
    const root = project({ "package.json": pkg({ next: "16.0.0", react: "19.0.0" }), "app/": "" });
    expect(detectProject(root)).toMatchObject({ framework: "next", router: "app", srcDir: false });
  });

  it("detects Next.js with the App Router under src/", () => {
    const root = project({ "package.json": pkg({ next: "16.0.0", react: "19.0.0" }), "src/app/": "" });
    expect(detectProject(root)).toMatchObject({ framework: "next", router: "app", srcDir: true });
  });

  it("detects Next.js with the Pages Router", () => {
    const root = project({ "package.json": pkg({ next: "16.0.0", react: "19.0.0" }), "pages/": "" });
    expect(detectProject(root)).toMatchObject({ framework: "next", router: "pages", srcDir: false });
  });

  it("detects React (not Next.js), also from devDependencies", () => {
    const root = project({ "package.json": { name: "app", devDependencies: { react: "19.0.0", "react-dom": "19.0.0", vite: "8.0.0", "@vitejs/plugin-react": "5.0.0" } }, "index.html": "", "src/": "" });
    expect(detectProject(root)).toMatchObject({ framework: "react", router: null, srcDir: true });
  });

  it("detects Angular", () => {
    const root = project({ "package.json": pkg({ "@angular/core": "22.0.0" }), "angular.json": { projects: { app: { projectType: "application", root: "", architect: { build: { options: { assets: [{ glob: "**/*", input: "public" }] } } } } } }, "src/": "" });
    expect(detectProject(root)).toMatchObject({ framework: "angular" });
  });

  it("detects Vue", () => {
    const root = project({ "package.json": pkg({ vue: "3.5.0", vite: "8.0.0", "@vitejs/plugin-vue": "6.0.0" }), "index.html": "", "src/": "" });
    expect(detectProject(root)).toMatchObject({ framework: "vue" });
  });

  it("is plain HTML only with an index.html page and no package.json", () => {
    expect(detectProject(project({ "index.html": "<!doctype html>" }))).toMatchObject({ framework: "html", hasPackageJson: false });
    expect(detectProject(project({ "package.json": pkg({ lodash: "4.0.0" }) }))).toMatchObject({ framework: null, hasPackageJson: true });
  });

  it("names frameworks it does not support yet instead of guessing", () => {
    expect(detectProject(project({ "package.json": pkg({ svelte: "5.0.0" }) }))).toMatchObject({ framework: null, unsupported: "Svelte" });
    expect(detectProject(project({ "package.json": pkg({ astro: "5.0.0" }) }))).toMatchObject({ framework: null, unsupported: "Astro" });
    expect(detectProject(project({ "package.json": pkg({ nuxt: "4.0.0", vue: "3.5.0" }) }))).toMatchObject({ framework: null, unsupported: "Nuxt" });
    expect(detectProject(project({ "package.json": pkg({ "@remix-run/react": "2.0.0", react: "19.0.0" }) }))).toMatchObject({
      framework: null,
      unsupported: "Remix",
    });
  });
});

describe("detectProject: TypeScript", () => {
  it("is TypeScript with a tsconfig.json or a typescript dependency", () => {
    expect(detectProject(project({ "package.json": pkg({ react: "19" }), "tsconfig.json": {} })).typescript).toBe(true);
    expect(detectProject(project({ "package.json": { devDependencies: { react: "19", typescript: "5" } } })).typescript).toBe(true);
    expect(detectProject(project({ "package.json": pkg({ react: "19" }) })).typescript).toBe(false);
  });
});

describe("detectProject: package manager", () => {
  it("prefers the packageManager field", () => {
    const root = project({ "package.json": pkg({}, { packageManager: "pnpm@11.1.2" }), "package-lock.json": "{}" });
    expect(detectProject(root).packageManager).toBe("pnpm");
  });

  it.each([
    ["pnpm-lock.yaml", "pnpm"],
    ["yarn.lock", "yarn"],
    ["bun.lock", "bun"],
    ["bun.lockb", "bun"],
    ["package-lock.json", "npm"],
  ])("reads %s as %s", (lockfile, manager) => {
    expect(detectProject(project({ "package.json": pkg(), [lockfile]: "" })).packageManager).toBe(manager);
  });

  it("ignores a packageManager field that is not a string", () => {
    const root = project({ "package.json": pkg({}, { packageManager: { name: "pnpm" } }), "yarn.lock": "" });
    expect(detectProject(root).packageManager).toBe("yarn");
  });

  it("is null without a lockfile or packageManager field", () => {
    expect(detectProject(project({ "package.json": pkg() })).packageManager).toBeNull();
  });
});

describe("detectProject: public folder", () => {
  it("uses public/ when it exists, and is null otherwise", () => {
    expect(detectProject(project({ "package.json": pkg({ vue: "3" }), "public/": "" })).publicDir).toBe("public");
    expect(detectProject(project({ "index.html": "" })).publicDir).toBeNull();
  });
});

describe("detectProject: invalid package.json", () => {
  it("reports a clear error instead of crashing on invalid JSON", () => {
    const root = project({ "package.json": "{ not json" });
    expect(() => detectProject(root)).toThrow(/Could not read .*package\.json/);
  });
});
