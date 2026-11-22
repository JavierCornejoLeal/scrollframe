import type { ProjectInfo } from "./detect.js";
import { FRAMEWORKS, type GenerateOptions, type ScaffoldFlags } from "./options.js";
import { formatPlan, planScaffold, servingUrl, withoutSetup, type ScaffoldPlan } from "./scaffold.js";

type Ask = (question: string) => Promise<string | null>;

const CHOICES = FRAMEWORKS.join(" / ");
const URL_RULE = "Use /path, ./path or https://host/path, without spaces, commas or quotes.\n";

/** The plan to run (it holds the folder and URL answered), with the flags as the answers left them. */
export interface Decision {
  plan: ScaffoldPlan;
  flags: ScaffoldFlags;
}

/**
 * Shows the suggestion and lets the person confirm it (y), correct it (e) or keep only the frames
 * (n). Enter is a yes only for a standard project that was not edited. Resolves with the
 * decision, or null when cancelled (Ctrl+C, Ctrl+D or the end of input).
 */
export async function decide(
  project: ProjectInfo,
  initialOptions: GenerateOptions,
  initialFlags: ScaffoldFlags,
  ask: Ask,
  write: (text: string) => unknown,
): Promise<Decision | null> {
  let options = initialOptions;
  let flags = initialFlags;
  let edited = false;
  const replan = () => planScaffold(project, options, flags);

  /** Asks for the URL until it is usable; Enter keeps `current` when there is one. */
  async function askUrl(current: string | null): Promise<boolean> {
    for (;;) {
      const answer = await ask(`URL where that folder is served${current ? ` [${current}]` : ""}: `);
      if (answer === null) return false;
      if (answer.trim() === "" && current) return true;
      const url = servingUrl(answer);
      if (url) {
        options = { ...options, baseUrl: url };
        flags = { ...flags, baseUrlGiven: true };
        return true;
      }
      write(URL_RULE);
    }
  }

  async function edit(): Promise<boolean> {
    for (;;) {
      const answer = await ask(`Framework (${CHOICES}) [${replan().framework}]: `);
      if (answer === null) return false;
      const value = answer.trim().toLowerCase();
      if (value === "") break;
      const framework = FRAMEWORKS.find((name) => name === value);
      if (framework) {
        flags = { ...flags, framework };
        break;
      }
    }
    const folder = await ask(`Frames folder [${replan().generate.out}]: `);
    if (folder === null) return false;
    if (folder.trim() !== "") {
      options = { ...options, out: folder.trim() };
      flags = { ...flags, outGiven: true };
    }
    return askUrl(replan().url ?? null);
  }

  for (;;) {
    const plan = replan();
    write(formatPlan(plan));

    if (plan.framework === null) {
      for (;;) {
        const answer = await ask(`Framework? (${CHOICES}, or n = frames only) `);
        if (answer === null) return null;
        const value = answer.trim().toLowerCase();
        if (value === "n" || value === "no") return { plan: withoutSetup(plan), flags };
        const framework = FRAMEWORKS.find((name) => name === value);
        if (framework) {
          flags = { ...flags, framework };
          break;
        }
      }
      continue;
    }

    const standard = !plan.doubts?.length && !edited;
    const question = standard
      ? "Continue? (Y = yes / e = edit / n = frames only) "
      : "Set it up like this? (y = yes / e = edit / n = frames only) ";
    for (;;) {
      const answer = await ask(question);
      if (answer === null) return null;
      const value = answer.trim().toLowerCase();
      if (value === "n" || value === "no") return { plan: withoutSetup(plan), flags };
      if (value === "e" || value === "edit") {
        if (!(await edit())) return null;
        edited = true;
        break;
      }
      if (value === "y" || value === "yes" || (value === "" && standard)) {
        if (plan.url) return { plan, flags };
        // Nothing is confirmed without a URL: ask for it and show the plan again.
        if (!(await askUrl(null))) return null;
        edited = true;
        break;
      }
    }
  }
}
