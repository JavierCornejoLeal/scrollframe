import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { fixStickyOverflow, planOverflowFixes, type ProjectInfo } from "../src/index.js";

const scratch = mkdtempSync(join(tmpdir(), "scrollframe-stylefix-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** The real app/globals.css written by create-next-app 16. */
const NEXT_16 = readFileSync(new URL("./fixtures/next16-globals.css", import.meta.url), "utf8");

describe("fixStickyOverflow", () => {
  it("changes overflow-x: hidden to clip in the html, body rule of the Next.js 16 stylesheet", () => {
    const fixed = fixStickyOverflow(NEXT_16)!;
    expect(fixed).toBe(NEXT_16.replace("overflow-x: hidden;", "overflow-x: clip;"));
  });

  it("only touches rules whose selector is html or body", () => {
    const css = ".menu { overflow-x: hidden; }\nbody { margin: 0; overflow-x:hidden }\nhtml body .x { overflow-x: hidden }\n";
    expect(fixStickyOverflow(css)).toBe(".menu { overflow-x: hidden; }\nbody { margin: 0; overflow-x:clip }\nhtml body .x { overflow-x: hidden }\n");
  });

  it("also fixes html/body rules nested in @media", () => {
    expect(fixStickyOverflow("@media (max-width: 600px) { html { overflow-x: hidden; } }")).toBe(
      "@media (max-width: 600px) { html { overflow-x: clip; } }",
    );
  });

  it("returns null when there is nothing to fix", () => {
    expect(fixStickyOverflow("html, body { overflow-x: clip; }")).toBeNull();
    expect(fixStickyOverflow("body { margin: 0 }")).toBeNull();
  });
});

const project = (files: Record<string, string>, info: Partial<ProjectInfo>): ProjectInfo => {
  const root = join(scratch, `p${Math.random().toString(36).slice(2)}`);
  for (const [path, contents] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), contents);
  }
  mkdirSync(root, { recursive: true });
  return {
    root,
    framework: "next",
    unsupported: null,
    router: "app",
    srcDir: false,
    typescript: true,
    packageManager: "npm",
    hasPackageJson: true,
    dependencies: [],
    publicDir: "public",
    ...info,
  };
};

describe("planOverflowFixes", () => {
  it.each([
    ["next", { router: "app" }, "app/globals.css"],
    ["next", { router: "app", srcDir: true }, "src/app/globals.css"],
    ["next", { router: "pages" }, "styles/globals.css"],
    ["react", { router: null, srcDir: true }, "src/index.css"],
    ["angular", { router: null, srcDir: true }, "src/styles.css"],
    ["vue", { router: null, srcDir: true }, "src/style.css"],
  ] as const)("%s %j: fixes %s", (framework, info, path) => {
    const p = project({ [path]: NEXT_16 }, { framework, ...info });
    expect(planOverflowFixes(p, framework)).toEqual([
      {
        path,
        before: NEXT_16,
        after: NEXT_16.replace("overflow-x: hidden;", "overflow-x: clip;"),
        description: `Change overflow-x: hidden to clip in ${path} (it stops the sequence from staying pinned)`,
        manual: "Change overflow-x: hidden to clip there yourself.",
      },
    ]);
  });

  it("plans nothing without a global stylesheet or for plain HTML", () => {
    expect(planOverflowFixes(project({}, {}), "next")).toEqual([]);
    expect(planOverflowFixes(project({ "styles.css": NEXT_16 }, { framework: "html" }), "html")).toEqual([]);
  });
});
