export { runCli, type CliIO } from "./run.js";
export { detectProject, type Framework, type PackageManager, type ProjectInfo } from "./detect.js";
export { ffmpegNotFoundMessage, generateSequence, resolveFfmpeg, swapIntoPlace, type GenerateResult, type SwapFs } from "./generate.js";
export {
  HELP,
  UsageError,
  availableFrames,
  buildManifest,
  deriveBaseUrl,
  parseCliArgs,
  parseDuration,
  parseFrameRate,
  planSets,
  samplingFps,
  type GenerateOptions,
} from "./options.js";
