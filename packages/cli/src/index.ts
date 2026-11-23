export { runCli, type CliIO, type RunDeps } from "./run.js";
export { CLI_VERSION, componentName, describeProject, formatPlan, framesOnlyPlan, installCommand, planScaffold, runtimePackage, setupHint, type ScaffoldPlan } from "./scaffold.js";
export { componentFor, type ComponentFile, type TemplateContext } from "./templates.js";
export { spawnCommand } from "./install.js";
export { planAngularStyles } from "./angular.js";
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
  framesFor,
  planAdaptiveSets,
  planSets,
  samplingFps,
  scrollLengthFor,
  type GenerateOptions,
  type ScaffoldFlags,
} from "./options.js";
