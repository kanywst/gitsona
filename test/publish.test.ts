import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ensureCheckout, isEarlierDraw } from "../src/publish.ts";
import { END, START } from "../src/readme.ts";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A folder as `gitsona --preview --action --json` leaves it. */
function draw(): string {
  const dir = mkdtempSync(join(tmpdir(), "gitsona-"));
  dirs.push(dir);
  writeFileSync(join(dir, "README.md"), `${START}\n\nhello\n\n${END}\n`);
  writeFileSync(join(dir, "gitsona-preview.html"), "<html></html>");
  mkdirSync(join(dir, "gitsona"));
  for (const f of ["hero-dark.svg", "hero-light.svg", "project-dex-light.svg", "profile.json"])
    writeFileSync(join(dir, "gitsona", f), "");
  mkdirSync(join(dir, ".github", "workflows"), { recursive: true });
  writeFileSync(join(dir, ".github", "workflows", "gitsona.yml"), "");
  return dir;
}

describe("isEarlierDraw", () => {
  test("recognises a folder an earlier run wrote", () => {
    expect(isEarlierDraw(draw())).toBe(true);
  });

  test("is false for a missing or empty folder", () => {
    const dir = mkdtempSync(join(tmpdir(), "gitsona-"));
    dirs.push(dir);
    expect(isEarlierDraw(dir)).toBe(false);
    expect(isEarlierDraw(join(dir, "nope"))).toBe(false);
  });

  test("is false once a person has written outside the markers", () => {
    const dir = draw();
    writeFileSync(join(dir, "README.md"), `# Hi\n\n${START}\n\nhello\n\n${END}\n`);
    expect(isEarlierDraw(dir)).toBe(false);
  });

  test("is false for a README without markers", () => {
    const dir = draw();
    writeFileSync(join(dir, "README.md"), "# Hi\n");
    expect(isEarlierDraw(dir)).toBe(false);
  });

  test("is false with any file gitsona does not write", () => {
    for (const extra of ["notes.txt", "gitsona/avatar.png", ".github/workflows/ci.yml", ".github/FUNDING.yml"]) {
      const dir = draw();
      writeFileSync(join(dir, extra), "");
      expect(isEarlierDraw(dir)).toBe(false);
    }
  });
});

describe("ensureCheckout", () => {
  test("refuses a folder holding someone's own files and leaves it alone", () => {
    const dir = draw();
    writeFileSync(join(dir, "notes.txt"), "mine");
    expect(() => ensureCheckout("someone", dir)).toThrow("is not a git checkout");
    expect(existsSync(join(dir, "notes.txt"))).toBe(true);
    expect(existsSync(join(dir, "README.md"))).toBe(true);
  });
});
