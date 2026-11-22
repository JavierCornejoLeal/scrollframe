import { createInterface, type Interface } from "node:readline";

export interface Prompter {
  /** The next line typed, or null on Ctrl+C, Ctrl+D or the end of input. */
  ask(question: string): Promise<string | null>;
  /** Gives stdin and Ctrl+C back; call it before long work. */
  close(): void;
}

/** One readline for all the questions: a new one per question would lose lines typed or pasted ahead. */
export function createPrompter(input: NodeJS.ReadableStream | undefined, output: NodeJS.WritableStream): Prompter {
  let rl: Interface | null = null;
  let ended = false;
  const typed: string[] = [];
  let waiting: ((line: string | null) => void) | null = null;

  const answer = (line: string | null) => {
    const resolve = waiting;
    waiting = null;
    resolve?.(line);
  };

  return {
    ask(question) {
      if (ended || !input) return Promise.resolve(null);
      if (!rl) {
        if ((input as { readableEnded?: boolean }).readableEnded) return Promise.resolve(null);
        rl = createInterface({ input, output });
        rl.on("line", (line) => (waiting ? answer(line) : typed.push(line)));
        rl.on("close", () => {
          ended = true;
          if (waiting) output.write("\n"); // Ctrl+C and Ctrl+D leave the cursor after the question.
          answer(null);
        });
        rl.on("SIGINT", () => rl?.close());
      }
      if (typed.length > 0) {
        output.write(question);
        return Promise.resolve(typed.shift()!);
      }
      const line = new Promise<string | null>((resolve) => (waiting = resolve));
      rl.setPrompt(question);
      rl.prompt();
      return line;
    },
    close() {
      rl?.close();
    },
  };
}
