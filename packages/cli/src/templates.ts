import type { Framework, ProjectInfo } from "./detect.js";

/** A component file the CLI writes into the user's project. */
export interface ComponentFile {
  /** Relative to the project root, with forward slashes. */
  path: string;
  contents: string;
  /** Lines printed at the end: how to use the component. */
  usage: string[];
}

export interface TemplateContext {
  project: ProjectInfo;
  name: string;
  /** Output folder of the frames, relative to the project root (e.g. `public/sequence`). */
  out: string;
  /** Public URL of that folder (e.g. `/sequence`). */
  baseUrl: string;
}

/** The component for `framework`, or null when there is no template for it yet. */
export function componentFor(_framework: Framework, _context: TemplateContext): ComponentFile | null {
  return null;
}
