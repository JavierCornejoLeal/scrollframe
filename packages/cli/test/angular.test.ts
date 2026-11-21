import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { planAngularStyles, type ProjectInfo } from "../src/index.js";

const scratch = mkdtempSync(join(tmpdir(), "scrollframe-angular-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** The shape `ng new` writes (trimmed). */
const angularJson = (styles: string[]) =>
  JSON.stringify(
    {
      $schema: "./node_modules/@angular/cli/lib/config/schema.json",
      version: 1,
      projects: { app: { architect: { build: { options: { browser: "src/main.ts", styles } }, serve: {} } } },
    },
    null,
    2,
  ) + "\n";

let n = 0;
const project = (json: string | null): ProjectInfo => {
  const root = join(scratch, `p${++n}`);
  mkdirSync(root);
  if (json !== null) writeFileSync(join(root, "angular.json"), json);
  return {
    root,
    framework: "angular",
    unsupported: null,
    router: null,
    srcDir: true,
    typescript: true,
    packageManager: "npm",
    hasPackageJson: true,
    dependencies: [],
    publicDir: "public",
  };
};

describe("planAngularStyles", () => {
  it("adds the element stylesheet to the build styles, keeping the 2-space format", () => {
    const before = angularJson(["src/styles.css"]);
    expect(planAngularStyles(project(before))).toEqual({
      edit: {
        path: "angular.json",
        before,
        after: angularJson(["src/styles.css", "@scrollframe/element/style.css"]),
        description: "Add @scrollframe/element/style.css to the styles in angular.json",
        manual: 'Add "@scrollframe/element/style.css" to "styles" in angular.json yourself.',
      },
      note: null,
    });
  });

  it("does nothing when the stylesheet is already there", () => {
    expect(planAngularStyles(project(angularJson(["src/styles.css", "@scrollframe/element/style.css"])))).toEqual({ edit: null, note: null });
  });

  it("explains instead of editing an angular.json it cannot read", () => {
    expect(planAngularStyles(project("{ // comments are not JSON\n}"))).toEqual({
      edit: null,
      note: 'Could not read angular.json: add "@scrollframe/element/style.css" to "styles" yourself.',
    });
    expect(planAngularStyles(project(null)).note).toBe('Could not read angular.json: add "@scrollframe/element/style.css" to "styles" yourself.');
  });
});
