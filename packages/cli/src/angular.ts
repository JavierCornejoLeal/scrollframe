import { join } from "node:path";
import type { ProjectInfo } from "./detect.js";
import { readText } from "./files.js";
import type { FileEdit } from "./stylefix.js";

const STYLESHEET = "@scrollframe/element/style.css";
const ADD_BY_HAND = `add "${STYLESHEET}" to "styles" yourself.`;

interface AngularJson {
  projects?: Record<string, { architect?: { build?: { options?: { styles?: unknown[] } } } }>;
}

/** Serializes like `text` is written (indentation, line endings, final newline), or null if that is not possible. */
function formatLike(text: string, json: unknown): ((value: unknown) => string) | null {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const indent = /^([ \t]+)\S/m.exec(text)?.[1] ?? "  ";
  const finalNewline = text.endsWith(eol) ? eol : "";
  const format = (value: unknown) => JSON.stringify(value, null, indent).replace(/\n/g, eol) + finalNewline;
  return format(json) === text ? format : null;
}

/**
 * Adds the element stylesheet to the build styles of the first project in angular.json, so the
 * layout is right before the element's script runs. Only a file the CLI can rewrite byte for byte
 * (plain JSON, consistent indentation) is edited; anything else gets a note saying what to add.
 */
export function planAngularStyles(project: ProjectInfo): { edit: FileEdit | null; note: string | null } {
  const path = "angular.json";
  let before: string;
  let json: AngularJson;
  try {
    before = readText(join(project.root, path)) ?? "";
    json = JSON.parse(before) as AngularJson;
  } catch {
    return { edit: null, note: `Could not read ${path}: ${ADD_BY_HAND}` };
  }
  const options = Object.values(json.projects ?? {})[0]?.architect?.build?.options;
  if (!options || (options.styles !== undefined && !Array.isArray(options.styles))) {
    return { edit: null, note: `Could not find the build styles in ${path}: ${ADD_BY_HAND}` };
  }
  if (options.styles?.includes(STYLESHEET)) return { edit: null, note: null };
  const format = formatLike(before, json);
  if (!format) {
    return { edit: null, note: `${path} is not formatted like \`ng new\` writes it, so it is left as is: ${ADD_BY_HAND}` };
  }
  options.styles = [...(options.styles ?? []), STYLESHEET];
  return {
    edit: {
      path,
      before,
      after: format(json),
      description: `Add ${STYLESHEET} to the styles in ${path}`,
      manual: `Add "${STYLESHEET}" to "styles" in ${path} yourself.`,
    },
    note: null,
  };
}
