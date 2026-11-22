import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, extname, join } from "node:path";
import type { Framework, PackageManager, ProjectInfo } from "./detect.js";
import { deriveBaseUrl, type GenerateOptions, type ScaffoldFlags } from "./options.js";
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
  closing: string[];
}

export function planScaffold(project: ProjectInfo, generate: GenerateOptions, flags: ScaffoldFlags): ScaffoldPlan {
  const framework = flags.framework ?? project.framework;
  const notes: string[] = [];
  const closing: string[] = [];
  if (framework === null) {
    const advice = project.advice ?? "Use --framework html for a plain HTML snippet.";
    notes.push(`${project.unsupported} is not supported yet: only the frames will be generated. ${advice}`);
    closing.push(`Not set up: ${project.unsupported} is not supported yet. Only the frames were generated.`);
  }

  let out: string | null = null;
  if (!flags.outGiven) {
    if (project.publicDir !== null && project.publicDir !== "public") out = `${project.publicDir}/sequence`;
    else if (framework === "html" && project.publicDir === null) out = "sequence";
  }
  const options =
    out === null ? generate : { ...generate, out, baseUrl: flags.baseUrlGiven ? generate.baseUrl : deriveBaseUrl(out) };

  if (framework === "html" && !flags.baseUrlGiven) {
    const root = project.publicDir === null ? "this folder" : `${project.publicDir}/`;
    const note =
      `The frames are loaded from ${options.baseUrl}, which only works if ${root} is the site root. ` +
      `In a subfolder, run it with --base-url, e.g. --base-url /my-folder${options.baseUrl}.`;
    notes.push(note);
    closing.push(note);
  }

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
      out: options.out,
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
  if (framework === null) return `Project: ${project.unsupported}`;
  if (framework === "html" && !project.hasPackageJson) return `Project: ${LABELS.html}`;
  const router = framework === "next" && project.router ? ` (${project.router === "app" ? "App" : "Pages"} Router)` : "";
  return `Project: ${LABELS[framework]}${router} · ${project.typescript ? "TypeScript" : "JavaScript"} · ${project.packageManager ?? "npm"}`;
}

/** Frames only, for a project that could not be read (e.g. a package.json in the middle of an edit). */
export function framesOnlyPlan(generate: GenerateOptions, reason: string): ScaffoldPlan {
  return { project: null, framework: null, generate, install: null, component: null, edits: [], closing: [], notes: [`${reason}\nOnly the frames will be generated.`] };
}

export function formatPlan(plan: ScaffoldPlan): string {
  const steps = [`Generate ${plan.generate.frames} frames in ${plan.generate.out.replace(/[\\/]+$/, "")}/`];
  if (plan.install) steps.push(`Install ${plan.install.pkg}  (${[plan.install.command, ...plan.install.args].join(" ")})`);
  if (plan.component) steps.push(`Create ${plan.component.path}`);
  for (const edit of plan.edits) steps.push(edit.description);
  const lines = [
    ...(plan.project ? [describeProject(plan.project, plan.framework), ""] : []),
    "Plan:",
    ...steps.map((step, i) => ` ${i + 1}. ${step}`),
  ];
  if (plan.notes.length > 0) lines.push("", ...plan.notes);
  return `${lines.join("\n")}\n\n`;
}

/** What the non-interactive output adds: how to set the project up, or why it cannot be. */
export function setupHint(project: ProjectInfo, out: string): string | null {
  if (project.framework === null) {
    if (project.unsupported === null) return null;
    const note = `Note: ${project.unsupported} is not supported yet, so the example above may not work in this project.`;
    const dir = project.publicDir;
    const inStaticDir = dir === null || dir === "public" || out.replace(/\\/g, "/").replace(/^\.\//, "").startsWith(`${dir}/`);
    return inStaticDir ? `${note}\n` : `${note} It serves static files from ${dir}/: use -o ${dir}/sequence.\n`;
  }
  return `Tip: run it in a terminal, or add --yes, to also set up the component for this ${HINT_LABELS[project.framework]}.\n`;
}
