import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { spawnCommand } from "../src/index.js";

const scratch = mkdtempSync(join(tmpdir(), "scrollframe-install-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

// process.execPath is a real binary on every OS, so these run the same way everywhere.
const node = process.execPath;

describe("spawnCommand", () => {
  it("resolves when the command succeeds, running it in the given folder", async () => {
    await spawnCommand(node, ["-e", "require('fs').writeFileSync('ran.txt', process.cwd())"], scratch);
    // realpath: on macOS the temp folder is reached through the /var -> /private/var symlink.
    expect(readFileSync(join(scratch, "ran.txt"), "utf8")).toBe(realpathSync(scratch));
  });

  it("rejects with the exit code when the command fails", async () => {
    await expect(spawnCommand(node, ["-e", "process.exit(3)"], scratch)).rejects.toThrow("exit code 3");
  });

  it("rejects with the signal when the command is killed", async () => {
    await expect(spawnCommand(node, ["-e", "process.kill(process.pid, 'SIGTERM')"], scratch)).rejects.toThrow(
      process.platform === "win32" ? /exit code/ : "stopped by SIGTERM",
    );
  });

  it.skipIf(process.platform === "win32")("explains a package manager that is not installed", async () => {
    await expect(spawnCommand("scrollframe-no-such-pm", ["add", "x"], scratch)).rejects.toThrow(
      "scrollframe-no-such-pm is not installed or not on your PATH",
    );
  });
});
