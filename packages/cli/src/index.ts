export { runCli, type CliIO } from "./run.js";
export { generateSequence, resolveFfmpeg, type GenerateResult } from "./generate.js";
export {
  HELP,
  UsageError,
  buildManifest,
  deriveBaseUrl,
  parseCliArgs,
  parseDuration,
  parseFrameRate,
  planSets,
  samplingFps,
  type GenerateOptions,
} from "./options.js";
