import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ProjectInfo } from "./detect.js";
import type { FileEdit } from "./stylefix.js";

const STYLESHEET = "@scrollframe/element/style.css";
const MANUAL = `add "${STYLESHEET}" to "styles" yourself.`;

interface AngularJson {
  projects?: Record<string, { architect?: { build?: { options?: { styles?: unknown[] } } } }>;
}

/**
 * Adds the element stylesheet to the build styles of the first project in angular.json, so the
 * layout is right before the element's script runs. An angular.json that is not plain JSON is
 * left alone, with a note saying what to add.
 */
export function planAngularStyles(project: ProjectInfo): { edit: FileEdit | null; note: string | null } {
  const path = "angular.json";
  let before: string;
  let json: AngularJson;
  try {
    before = readFileSync(join(project.root, path), "utf8");
    json = JSON.parse(before) as AngularJson;
  } catch {
    return { edit: null, note: `Could not read ${path}: ${MANUAL}` };
  }
  const options = Object.values(json.projects ?? {})[0]?.architect?.build?.options;
  if (!options || (options.styles !== undefined && !Array.isArray(options.styles))) {
    return { edit: null, note: `Could not find the build styles in ${path}: ${MANUAL}` };
  }
  if (options.styles?.includes(STYLESHEET)) return { edit: null, note: null };
  options.styles = [...(options.styles ?? []), STYLESHEET];
  return {
    edit: {
      path,
      before,
      after: `${JSON.stringify(json, null, 2)}\n`,
      description: `Add ${STYLESHEET} to the styles in ${path}`,
      manual: `Add "${STYLESHEET}" to "styles" in ${path} yourself.`,
    },
    note: null,
  };
}
