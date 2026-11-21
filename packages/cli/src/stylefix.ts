import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Framework, ProjectInfo } from "./detect.js";

/** A planned change to a file of the user's project, applied only if the file is still `before`. */
export interface FileEdit {
  path: string;
  before: string;
  after: string;
  /** The plan step. */
  description: string;
  /** What to do by hand when the file changed after the plan was made. */
  manual: string;
}

/** The global stylesheet each framework's starter template creates. */
function globalStylesheet(project: ProjectInfo, framework: Framework): string | null {
  const src = project.srcDir ? "src/" : "";
  switch (framework) {
    case "next":
      return project.router === "pages" ? `${src}styles/globals.css` : `${src}app/globals.css`;
    case "react":
      return "src/index.css";
    case "angular":
      return "src/styles.css";
    case "vue":
      return "src/style.css";
    default:
      return null;
  }
}

const isHtmlOrBody = (selectors: string) => selectors.split(",").some((s) => /^(html|body)$/i.test(s.trim()));

/**
 * `overflow-x: hidden` on html/body makes body a scroll container, so `position: sticky` stops
 * pinning the sequence (the Next.js 16 starter does this). `clip` hides the overflow the same way
 * without a scroll container. Only rules whose selector is exactly html or body are changed.
 * Returns the fixed stylesheet, or null when there is nothing to change.
 */
export function fixStickyOverflow(css: string): string | null {
  // Innermost rules only: also matches html/body rules nested in @media.
  const fixed = css.replace(/([^{}]*)\{([^{}]*)\}/g, (rule, selectors: string, body: string) =>
    isHtmlOrBody(selectors.replace(/^[\s;]*/, "")) ? `${selectors}{${body.replace(/(overflow-x\s*:\s*)hidden\b/gi, "$1clip")}}` : rule,
  );
  return fixed === css ? null : fixed;
}

export function planOverflowFixes(project: ProjectInfo, framework: Framework): FileEdit[] {
  const path = globalStylesheet(project, framework);
  if (!path || !existsSync(join(project.root, path))) return [];
  const before = readFileSync(join(project.root, path), "utf8");
  const after = fixStickyOverflow(before);
  if (after === null) return [];
  return [
    {
      path,
      before,
      after,
      description: `Change overflow-x: hidden to clip in ${path} (it stops the sequence from staying pinned)`,
      manual: "Change overflow-x: hidden to clip there yourself.",
    },
  ];
}
