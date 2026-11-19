import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
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

  test("is false, not a throw, for odd shapes", () => {
    const readmeDir = draw();
    rmSync(join(readmeDir, "README.md"));
    mkdirSync(join(readmeDir, "README.md"));
    expect(isEarlierDraw(readmeDir)).toBe(false);

    const assetsFile = draw();
    rmSync(join(assetsFile, "gitsona"), { recursive: true });
    writeFileSync(join(assetsFile, "gitsona"), "");
    expect(isEarlierDraw(assetsFile)).toBe(false);

    const linked = draw();
    rmSync(join(linked, "gitsona", "hero-light.svg"));
    symlinkSync(join(linked, "README.md"), join(linked, "gitsona", "hero-light.svg"));
    expect(isEarlierDraw(linked)).toBe(false);

    const file = draw();
    expect(isEarlierDraw(join(file, "README.md"))).toBe(false);

    const unreadable = draw();
    chmodSync(join(unreadable, "gitsona"), 0o000);
    try {
      expect(isEarlierDraw(unreadable)).toBe(false);
    } finally {
      chmodSync(join(unreadable, "gitsona"), 0o755);
    }
  });

  test("is false with any file gitsona does not write", () => {
    for (const extra of ["notes.txt", "gitsona/avatar.png", ".github/workflows/ci.yml", ".github/FUNDING.yml"]) {
      const dir = draw();
      writeFileSync(join(dir, extra), "");
      expect(isEarlierDraw(dir)).toBe(false);
    }
  });
});

/** Puts a fake `gh` first on PATH: `gh repo clone <slug> <dir>` makes a checkout, or fails. */
function fakeGh(ok: boolean): () => void {
  const bin = mkdtempSync(join(tmpdir(), "gitsona-bin-"));
  dirs.push(bin);
  const script = ok
    ? '#!/bin/sh\nmkdir -p "$4/.git" && echo "# remote" > "$4/README.md"\n'
    : "#!/bin/sh\necho 'Could not resolve to a Repository' >&2\nexit 1\n";
  writeFileSync(join(bin, "gh"), script);
  chmodSync(join(bin, "gh"), 0o755);
  const path = process.env.PATH;
  process.env.PATH = `${bin}:${path}`;
  return () => {
    process.env.PATH = path;
  };
}

describe("ensureCheckout", () => {
  test("swaps an earlier draw for a checkout, keeping the folder itself", () => {
    const dir = draw();
    const cwd = process.cwd();
    const restore = fakeGh(true);
    process.chdir(dir);
    try {
      ensureCheckout("someone", dir);
      // The working directory is still the same, live folder.
      expect(existsSync(".git")).toBe(true);
    } finally {
      process.chdir(cwd);
      restore();
    }
    expect(readdirSync(dir).sort()).toEqual([".git", "README.md"]);
    expect(readdirSync(join(dir, "..")).some((e) => e.startsWith(".gitsona-clone-"))).toBe(false);
  });

  test("keeps the earlier draw when the clone fails", () => {
    const dir = draw();
    const restore = fakeGh(false);
    try {
      expect(() => ensureCheckout("someone", dir)).toThrow("gh repo clone failed");
    } finally {
      restore();
    }
    expect(isEarlierDraw(dir)).toBe(true);
    expect(readdirSync(join(dir, "..")).some((e) => e.startsWith(".gitsona-clone-"))).toBe(false);
  });

  test("refuses a folder holding someone's own files and leaves it alone", () => {
    const dir = draw();
    writeFileSync(join(dir, "notes.txt"), "mine");
    expect(() => ensureCheckout("someone", dir)).toThrow("is not a git checkout");
    expect(existsSync(join(dir, "notes.txt"))).toBe(true);
    expect(existsSync(join(dir, "README.md"))).toBe(true);
  });
});
