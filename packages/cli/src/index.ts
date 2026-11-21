export { runCli, type CliIO, type RunDeps } from "./run.js";
export { componentName, describeProject, formatPlan, framesOnlyPlan, installCommand, planScaffold, runtimePackage, setupHint, type ScaffoldPlan } from "./scaffold.js";
export { componentFor, type ComponentFile, type TemplateContext } from "./templates.js";
export { spawnCommand } from "./install.js";
export { fixStickyOverflow, planOverflowFixes, type FileEdit } from "./stylefix.js";
export { detectProject, type Framework, type PackageManager, type ProjectInfo } from "./detect.js";
export { ffmpegNotFoundMessage, generateSequence, resolveFfmpeg, swapIntoPlace, type GenerateResult, type SwapFs } from "./generate.js";
export {
  FRAMEWORKS,
  HELP,
  UsageError,
  availableFrames,
  buildManifest,
  deriveBaseUrl,
  parseCliArgs,
  parseCommandLine,
  parseDuration,
  parseFrameRate,
  planSets,
  samplingFps,
  type GenerateOptions,
  type ScaffoldFlags,
} from "./options.js";
