import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

// Next rejects a "use server" file that exports anything but async functions (types are erased),
// and it only fails at run time, so guard it here.
describe('"use server" files', () => {
  const files = sourceFiles("src").filter((file) => /^\s*["']use server["']/.test(readFileSync(file, "utf8")));

  it("finds the action files", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file} exports only async functions and types`, () => {
      const exports = readFileSync(file, "utf8")
        .split("\n")
        .filter((line) => /^export\s/.test(line))
        .filter((line) => !/^export\s+(async function|type|interface)\s/.test(line));
      expect(exports).toEqual([]);
    });
  }
});
