import { spawn } from "node:child_process";

/** Quotes one argument for cmd.exe; package names and flags never need more than this. */
const quoteForCmd = (arg: string) => (/[\s"&|<>^]/.test(arg) ? `"${arg.replace(/"/g, '""')}"` : arg);

/**
 * Runs a command in `cwd`, showing its output, and resolves when it exits with 0.
 * Windows needs a shell for the npm/pnpm/yarn `.cmd` shims; the command line is built here
 * because passing an args array together with `shell: true` is deprecated (DEP0190).
 */
export function spawnCommand(command: string, args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child =
      process.platform === "win32"
        ? spawn([command, ...args].map(quoteForCmd).join(" "), { cwd, stdio: "inherit", shell: true })
        : spawn(command, args, { cwd, stdio: "inherit" });
    child.on("error", (error: NodeJS.ErrnoException) => {
      reject(new Error(error.code === "ENOENT" ? `${command} is not installed or not on your PATH` : error.message));
    });
    child.on("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(signal ? `stopped by ${signal}` : `exit code ${code}`));
    });
  });
}
