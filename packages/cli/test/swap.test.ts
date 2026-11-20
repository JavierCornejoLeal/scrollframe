import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { rename, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { swapIntoPlace } from "../src/index.js";

let root: string;
let out: string;
let staging: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "scrollframe-swap-"));
  out = join(root, "out");
  staging = join(out, ".scrollframe-new-test");
  for (const dir of ["mobile", "desktop"]) {
    mkdirSync(join(out, dir), { recursive: true });
    writeFileSync(join(out, dir, "frame.webp"), `old ${dir}`);
    mkdirSync(join(staging, dir), { recursive: true });
    writeFileSync(join(staging, dir, "frame.webp"), `new ${dir}`);
  }
  writeFileSync(join(out, "manifest.json"), "old");
  writeFileSync(join(staging, "manifest.json"), "new");
  writeFileSync(join(out, "keep.txt"), "user file");
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

const previous = ["desktop", "manifest.json", "mobile"];
const read = (...parts: string[]) => readFileSync(join(out, ...parts), "utf8");
const leftovers = () => readdirSync(out).filter((entry) => entry.startsWith(".scrollframe-old-"));

/** rename() that throws the way Windows does when a file is locked by another process. */
function failingRename(shouldFail: (from: string, to: string) => boolean): typeof rename {
  return (async (from: string, to: string) => {
    if (shouldFail(String(from), String(to))) throw Object.assign(new Error("EBUSY: resource busy"), { code: "EBUSY" });
    return rename(from, to);
  }) as typeof rename;
}

describe("swapIntoPlace", () => {
  it("replaces owned entries, keeps unrelated files and removes the backup", async () => {
    await swapIntoPlace(out, staging, previous);
    expect(read("manifest.json")).toBe("new");
    expect(read("mobile", "frame.webp")).toBe("new mobile");
    expect(read("keep.txt")).toBe("user file");
    expect(leftovers()).toEqual([]);
  });

  it("restores the previous sequence when moving the new one in fails", async () => {
    const ops = { rename: failingRename((from) => from === join(staging, "mobile")), rm };
    await expect(swapIntoPlace(out, staging, previous, ops)).rejects.toThrow("EBUSY: resource busy");
    expect(read("manifest.json")).toBe("old");
    expect(read("mobile", "frame.webp")).toBe("old mobile");
    expect(read("desktop", "frame.webp")).toBe("old desktop");
    expect(leftovers()).toEqual([]);
  });

  it("keeps the backup and names it when the rollback itself fails", async () => {
    const ops = {
      rename: failingRename(
        (from, to) => from === join(staging, "mobile") || (from.includes(".scrollframe-old-") && to === join(out, "desktop")),
      ),
      rm,
    };
    const error = await swapIntoPlace(out, staging, previous, ops).catch((e: Error) => e);
    const [backup] = leftovers();
    expect(backup).toBeDefined();
    expect((error as Error).message).toBe(
      `Could not replace the sequence (EBUSY: resource busy). The previous sequence is kept in ${join(out, backup!)}.`,
    );
    expect(readFileSync(join(out, backup!, "desktop", "frame.webp"), "utf8")).toBe("old desktop");
    // Everything that could be restored was restored.
    expect(read("manifest.json")).toBe("old");
    expect(existsSync(join(out, "desktop"))).toBe(false);
  });
});
