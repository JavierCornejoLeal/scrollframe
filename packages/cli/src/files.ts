import { readFileSync, statSync } from "node:fs";

/**
 * A file of the user's project, or null when it is missing, unreadable or not a regular file.
 * Reading a FIFO would wait for a writer forever.
 */
export function readText(path: string): string | null {
  try {
    return statSync(path).isFile() ? readFileSync(path, "utf8") : null;
  } catch {
    return null;
  }
}
