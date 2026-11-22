import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Framework, PackageManager, ProjectInfo } from "./detect.js";
import { FRAMES_PER_SECOND, MIN_FRAMES, deriveBaseUrl, type GenerateOptions, type ScaffoldFlags } from "./options.js";
// Inlined at build time, after versioning: the CLI and the element are not always released together.
import { version as ELEMENT_VERSION } from "../../element/package.json";
import { STYLESHEET, planAngularStyles } from "./angular.js";
import { planOverflowFixes, type FileEdit } from "./stylefix.js";
import { componentFor, type ComponentFile } from "./templates.js";

/** This CLI's version (package.json sits next to src/ and dist/). */
export const CLI_VERSION: string = (createRequire(import.meta.url)("../package.json") as { version: string }).version;

const LABELS: Record<Framework, string> = {
  next: "Next.js",
  react: "React",
  angular: "Angular",
  vue: "Vue",
  html: "Plain HTML",
};

/** How the hint names the project: "this Next.js project", "this plain HTML site". */
const HINT_LABELS: Record<Framework, string> = {
  next: "Next.js project",
  react: "React project",
  angular: "Angular project",
  vue: "Vue project",
  html: "plain HTML site",
};

/** The scrollframe package a framework renders with; plain HTML uses the CDN. */
export function runtimePackage(framework: Framework): string | null {
  if (framework === "next" || framework === "react") return "@scrollframe/react";
  if (framework === "angular" || framework === "vue") return "@scrollframe/element";
  return null;
}

export function installCommand(manager: PackageManager | null, pkg: string): { command: string; args: string[] } {
  if (manager === null || manager === "npm") return { command: "npm", args: ["install", pkg] };
  return { command: manager, args: ["add", pkg] };
}

/** `hero.mp4` -> `HeroSequence`; `my intro-video.mov` -> `MyIntroVideoSequence`; no usable letters -> `VideoSequence`. */
export function componentName(video: string): string {
  const words = basename(video, extname(video)).split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (words.length === 0) return "VideoSequence";
  const pascal = words.map((word) => word[0]!.toUpperCase() + word.slice(1)).join("");
  return `${/^\d/.test(pascal) ? "Video" : ""}${pascal}Sequence`;
}

export interface ScaffoldPlan {
  /** null when the project could not be read: only the frames are generated. */
  project: ProjectInfo | null;
  /** The framework to set up; null to only generate the frames. */
  framework: Framework | null;
  generate: GenerateOptions;
  /** Where the frames folder is served, or null when that is unknown and has to be typed. */
  url?: string | null;
  /** What to check before confirming. Enter is a yes only when this is empty. */
  doubts?: string[];
  install: { pkg: string; command: string; args: string[] } | null;
  component: ComponentFile | null;
  /** The component's path, when the user already has that file: it is left as it is. */
  existing?: string | null;
  /** Changes to the user's stylesheets that keep the sequence pinned (see stylefix.ts). */
  edits: FileEdit[];
  notes: string[];
  /** Steps only the person can take: until they are done the set-up is incomplete. */
  todo?: string[];
}

/** `out` relative to `dir` (both resolved in the project root) with "/", or null when it is not inside it. */
function pathInside(root: string, dir: string, out: string): string | null {
  const path = relative(resolve(root, dir), resolve(root, out));
  if (path === "" || isAbsolute(path) || path.split(sep)[0] === "..") return null;
  return path.split(sep).join("/");
}

const toUrl = (path: string) => `/${path.split("/").map(encodeURIComponent).join("/")}`;

/**
 * A URL safe in generated code, markup and srcset (no quotes, spaces or commas), without its final
 * slash: `/path`, `./path`, `../path`, `//host/path` or `http(s)://host/path`. null when it is not one.
 */
export function servingUrl(value: string): string | null {
  const url = value.trim().replace(/\/+$/, "");
  // Anything else a URL can hold is accepted, e.g. /imágenes or /hero(1); `&` is escaped in markup.
  const safe = /^[^\s\p{Cc}\p{Cf}"'`<>{}\\,?#|^]+$/u.test(url);
  return safe && /^(?:\/(?!\/)|(?:https?:)?\/\/[^/]|\.\.?(?:\/|$))/.test(url) ? url : null;
}

/** The same for --base-url, where `sequence` is also a path, as in 0.3.0. (Typed, it would be a typo.) */
export function flagUrl(given: string): string | null {
  const value = given.trim(); // Blank is no URL: " " would become ".".
  return servingUrl(value) ?? (/^[^/:.][^:]*$/.test(value) ? servingUrl(`./${value}`) : null);
}

/** The plan for what is known so far: the suggestion, replaced by whatever the flags (or answers) set. */
export function planScaffold(project: ProjectInfo, generate: GenerateOptions, flags: ScaffoldFlags): ScaffoldPlan {
  const framework = flags.framework ?? project.framework;
  const detected = framework === project.framework;
  const notes: string[] = [];

  let out = generate.out;
  if (!flags.outGiven) {
    if (framework === "html" && (detected || project.publicDir === null)) out = "sequence";
    else if (project.framework === null && project.publicDir !== null) out = `${project.publicDir}/sequence`;
  }

  let url: string | null = null;
  if (flags.baseUrlGiven) {
    url = flagUrl(generate.baseUrl);
  } else if (framework !== null && !project.urlUnknown) {
    // The folder each template expects at the site root; an HTML page that was not detected may have a public/.
    let served = framework === "html" ? "." : "public";
    if (!detected && framework === "html" && pathInside(project.root, "public", out) !== null) served = "public";
    const path = pathInside(project.root, served, out);
    if (path !== null) url = toUrl(path);
  }
  const baseUrl = url ?? (flags.baseUrlGiven || out === generate.out ? generate.baseUrl : deriveBaseUrl(out));
  const options = { ...generate, out, baseUrl };

  if (framework === null) {
    if (project.unsupported !== null) notes.push(`${project.unsupported} is not supported yet, so there is nothing to suggest.`);
    else notes.push("This project was not recognised, so there is nothing to suggest.");
    return { project, framework, generate: options, url, doubts: [], install: null, component: null, existing: null, edits: [], notes };
  }

  const doubts = detected
    ? [...(project.doubts ?? [])]
    : [`${LABELS[framework]} was not detected here, so the files and URL assume a standard project`];
  if (url === null) doubts.push(`the URL where ${out} is served is unknown`);
  if (framework === "html" && detected && !flags.baseUrlGiven) {
    notes.push("That URL assumes this folder is the site root: answer e to correct it if it is served from a subfolder.");
  }

  const pkg = runtimePackage(framework);
  const install =
    pkg !== null && flags.install && !project.dependencies.includes(pkg)
      ? { pkg, ...installCommand(project.packageManager, pkg) }
      : null;

  let component = componentFor(framework, {
    project,
    name: flags.name ?? componentName(generate.input),
    video: generate.input,
    // Templates write import paths, so they need it relative to the root whatever -o looked like.
    out: relative(project.root, resolve(project.root, out)),
    baseUrl,
    version: ELEMENT_VERSION,
  });
  let existing: string | null = null;
  if (component && existsSync(join(project.root, component.path))) {
    notes.push(`${component.path} already exists and will not be changed (use --name to create another one).`);
    existing = component.path;
    component = null;
  }

  const edits = planOverflowFixes(project, framework);
  const todo: string[] = [];
  if (framework === "angular") {
    const { edit, note } = planAngularStyles(project);
    if (edit) edits.unshift(edit);
    if (note) {
      notes.push(note);
      todo.push(`angular.json still needs "${STYLESHEET}" in "styles"`);
    }
  }
  return { project, framework, generate: options, url, doubts, install, component, existing, edits, notes, todo };
}

/** The same plan without the set-up. */
export function withoutSetup(plan: ScaffoldPlan): ScaffoldPlan {
  return { ...plan, framework: null, install: null, component: null, existing: null, edits: [], notes: [], doubts: [], todo: [] };
}

export function describeProject(project: ProjectInfo, framework: Framework | null): string {
  if (framework === null) return `Project: ${project.unsupported ?? "not recognised"}`;
  if (framework === "html" && !project.hasPackageJson) return `Project: ${LABELS.html}`;
  const router = framework === "next" && project.router ? ` (${project.router === "app" ? "App" : "Pages"} Router)` : "";
  return `Project: ${LABELS[framework]}${router} · ${project.typescript ? "TypeScript" : "JavaScript"} · ${project.packageManager ?? "npm"}`;
}

/** Frames only, for a project that could not be read (e.g. a package.json in the middle of an edit). */
export function framesOnlyPlan(generate: GenerateOptions, reason: string): ScaffoldPlan {
  return {
    project: null,
    framework: null,
    generate,
    url: null,
    doubts: [],
    install: null,
    component: null,
    existing: null,
    edits: [],
    notes: [`${reason}\nOnly the frames will be generated.`],
  };
}

export function formatPlan(plan: ScaffoldPlan): string {
  const { project, framework } = plan;
  const folder = `${plan.generate.out.replace(/[\\/]+$/, "")}/`;
  const lines: string[] = [];
  if (project) lines.push(describeProject(project, framework ?? project.framework));
  // An unknown project has no suggested URL, so one that is there was given.
  if (framework || (plan.url && !project?.framework)) lines.push(`  Frames in:  ${folder}`, `  Served at:  ${plan.url ?? "unknown"}`);
  if (project) lines.push("");

  const { auto, frames } = plan.generate;
  const amount = auto?.frames
    ? `${FRAMES_PER_SECOND} frames per second of video (at least ${MIN_FRAMES})`
    : `${frames} frames`;
  const steps = [`Generate ${amount} in ${folder}`];
  if (plan.install) steps.push(`Install ${plan.install.pkg}  (${[plan.install.command, ...plan.install.args].join(" ")})`);
  if (plan.component) steps.push(`Create ${plan.component.path}`);
  for (const edit of plan.edits) steps.push(edit.description);
  lines.push("Plan:", ...steps.map((step, i) => ` ${i + 1}. ${step}`));

  if (plan.doubts?.length) lines.push("", "Check before answering:", ...plan.doubts.map((doubt) => `  - ${doubt}`));
  if (plan.notes.length > 0) lines.push("", ...plan.notes);
  return `${lines.join("\n")}\n\n`;
}

/** What the non-interactive output adds: how to set the project up, or why it cannot be. */
export function setupHint(project: ProjectInfo, out?: string): string | null {
  if (project.framework === null) {
    if (project.unsupported === null) {
      return "Note: this project was not recognised, so the example above may not work in it.\n";
    }
    const note = `Note: ${project.unsupported} is not supported yet, so the example above may not work in this project.`;
    const dir = project.publicDir;
    if (out === undefined || dir === null || dir === "public" || pathInside(project.root, dir, out) !== null) return `${note}\n`;
    return `${note} It serves static files from ${dir}/: use -o ${dir}/sequence.\n`;
  }
  return `Tip: run it in a terminal to also set up the component for this ${HINT_LABELS[project.framework]}, or pass --yes with --framework, -o and --base-url.\n`;
}
