import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import type { Framework, PackageManager, ProjectInfo } from "./detect.js";
import { FRAMEWORKS, deriveBaseUrl, type GenerateOptions, type ScaffoldFlags } from "./options.js";
import { planAngularStyles } from "./angular.js";
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

const HINT_NAMES: Record<Framework, string> = { ...LABELS, html: "plain HTML" };

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
  /** null for an unsupported framework: only the frames are generated. */
  framework: Framework | null;
  generate: GenerateOptions;
  install: { pkg: string; command: string; args: string[] } | null;
  component: ComponentFile | null;
  /** Changes to the user's stylesheets that keep the sequence pinned (see stylefix.ts). */
  edits: FileEdit[];
  notes: string[];
  /** Printed last, so what was not set up is not lost above the progress output. */
  closing?: string[];
}

/** `out` relative to `dir` (both resolved in the project root) with "/", or null when it is not inside it. */
function pathInside(root: string, dir: string, out: string): string | null {
  const path = relative(resolve(root, dir), resolve(root, out));
  if (path === "" || isAbsolute(path) || path.split(sep)[0] === "..") return null;
  return path.split(sep).join("/");
}

const toUrl = (path: string) => `/${path.split("/").map(encodeURIComponent).join("/")}`;

const REDO = "to redo a finished run, add --force and delete the file it created";

export function planScaffold(project: ProjectInfo, generate: GenerateOptions, flags: ScaffoldFlags): ScaffoldPlan {
  let framework = flags.framework ?? project.framework;
  const forced = framework !== project.framework;
  const notes: string[] = [];
  const closing: string[] = [];

  let out = generate.out;
  if (!flags.outGiven) {
    if (framework === "html" && (!forced || project.publicDir === null)) out = "sequence";
    else if (project.framework === null && project.publicDir !== null) out = `${project.publicDir}/sequence`;
  }
  let baseUrl = flags.baseUrlGiven || out === generate.out ? generate.baseUrl : deriveBaseUrl(out);

  if (framework === null) {
    if (project.unsupported !== null) {
      notes.push(
        `${project.unsupported} is not supported yet: only the frames will be generated. Use --framework html for a plain HTML snippet.`,
      );
      closing.push(`Not set up: ${project.unsupported} is not supported yet. Only the frames were generated.`);
    } else {
      notes.push(
        `This project was not recognised${project.reason ? ` (${project.reason})` : ""}: only the frames will be generated. ` +
          `To force the set-up use --framework ${FRAMEWORKS.join("|")}, with -o and --base-url set to where the site serves the frames.`,
      );
      closing.push("Not set up: this project was not recognised. Only the frames were generated.");
    }
  } else if (!flags.baseUrlGiven) {
    // The folder each framework serves at the site root; a forced HTML page may have a public/ one.
    let served = framework === "html" ? "." : "public";
    if (forced && framework === "html" && pathInside(project.root, "public", out) !== null) served = "public";
    const path = pathInside(project.root, served, out);
    if (path !== null) {
      baseUrl = toUrl(path);
    } else if (!forced) {
      const folder = served === "." ? "this folder" : `${served}/`;
      notes.push(`-o ${out} is not inside ${folder}, so its URL is unknown: pass --base-url to set the project up.`);
      closing.push(`Not set up: -o ${out} is not inside ${folder} and no --base-url was given. Only the frames were generated.`);
      framework = null;
    }
  }

  if (framework !== null) {
    const folder = `${out.replace(/[\\/]+$/, "")}/`;
    let note: string | null = null;
    if (forced) {
      note =
        `Set up as ${HINT_NAMES[framework]} because of --framework, without checking the project: ` +
        `make sure ${folder} is served at ${baseUrl}, or run it again with --base-url.`;
    } else if (framework === "html" && !flags.baseUrlGiven) {
      note =
        `The frames are loaded from ${baseUrl}, which only works if this folder is the site root. ` +
        `Otherwise pass --base-url with the URL where ${folder} is served; ${REDO}.`;
    }
    if (note) {
      notes.push(note);
      closing.push(note);
    }
  }
  const options = { ...generate, out, baseUrl };

  const pkg = framework === null ? null : runtimePackage(framework);
  const install =
    pkg !== null && flags.install && !project.dependencies.includes(pkg)
      ? { pkg, ...installCommand(project.packageManager, pkg) }
      : null;

  let component: ComponentFile | null = null;
  if (framework !== null) {
    const name = flags.name ?? componentName(generate.input);
    component = componentFor(framework, {
      project,
      name,
      video: generate.input,
      // Templates write import paths, so they need it relative to the root whatever -o looked like.
      out: relative(project.root, resolve(project.root, options.out)),
      baseUrl: options.baseUrl,
      version: CLI_VERSION,
    });
    if (component && existsSync(join(project.root, component.path))) {
      notes.push(`${component.path} already exists and will not be changed (use --name to create another one).`);
      component = null;
    }
  }
  const edits = framework === null ? [] : planOverflowFixes(project, framework);
  if (framework === "angular") {
    const { edit, note } = planAngularStyles(project);
    if (edit) edits.unshift(edit);
    if (note) notes.push(note);
  }
  return { project, framework, generate: options, install, component, edits, notes, closing };
}

export function describeProject(project: ProjectInfo, framework: Framework | null): string {
  if (framework === null) return `Project: ${project.unsupported ?? "not recognised"}`;
  if (framework === "html" && !project.hasPackageJson) return `Project: ${LABELS.html}`;
  const router = framework === "next" && project.router ? ` (${project.router === "app" ? "App" : "Pages"} Router)` : "";
  return `Project: ${LABELS[framework]}${router} · ${project.typescript ? "TypeScript" : "JavaScript"} · ${project.packageManager ?? "npm"}`;
}

/** Frames only, for a project that could not be read (e.g. a package.json in the middle of an edit). */
export function framesOnlyPlan(generate: GenerateOptions, reason: string): ScaffoldPlan {
  return { project: null, framework: null, generate, install: null, component: null, edits: [], closing: ["Not set up: the project could not be read. Only the frames were generated."], notes: [`${reason}\nOnly the frames will be generated.`] };
}

export function formatPlan(plan: ScaffoldPlan): string {
  const steps = [`Generate ${plan.generate.frames} frames in ${plan.generate.out.replace(/[\\/]+$/, "")}/`];
  if (plan.install) steps.push(`Install ${plan.install.pkg}  (${[plan.install.command, ...plan.install.args].join(" ")})`);
  if (plan.component) steps.push(`Create ${plan.component.path}`);
  for (const edit of plan.edits) steps.push(edit.description);
  const lines = [
    ...(plan.project ? [describeProject(plan.project, plan.framework ?? plan.project.framework), ""] : []),
    "Plan:",
    ...steps.map((step, i) => ` ${i + 1}. ${step}`),
  ];
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
  return `Tip: run it in a terminal, or add --yes, to also set up the component for this ${HINT_LABELS[project.framework]}.\n`;
}
