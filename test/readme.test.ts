import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { analyze } from "../src/analyze.ts";
import { END, mergeReadme, readmeBlock, START } from "../src/readme.ts";
import { SECTIONS } from "../src/render/index.ts";
import { fixture } from "./fixture.ts";

const p = analyze(fixture());
const block = readmeBlock(p, { sections: [...SECTIONS], dir: "./gitsona" });

describe("readme block", () => {
  test("is wrapped in markers and uses picture for both themes", () => {
    expect(block.startsWith(START)).toBe(true);
    expect(block.endsWith(END)).toBe(true);
    expect(block).toContain(`<source media="(prefers-color-scheme: dark)" srcset="./gitsona/hero-dark.svg">`);
    expect(block).toContain(`src="./gitsona/hero-light.svg"`);
  });

  test("escapes Markdown in user-supplied text", () => {
    expect(block).toContain("Builds \\<things\\> with \\*care\\*");
    expect(block).toContain("Fix \\[edge\\] case in");
  });

  test("alt text carries the facts the images show", () => {
    expect(block).toMatch(/alt="[^"]*Night owl/);
    expect(block).toMatch(/alt="[^"]*dexidp\/dex \(2\)/);
  });

  test("uses no inline HTML beyond picture, source and img", () => {
    const tags = new Set([...block.matchAll(/(?<!\\)<\/?([a-z]+)/g)].map((m) => m[1]));
    expect([...tags].sort()).toEqual(["img", "picture", "source"]);
  });

  test("brackets in alt text cannot end a project link early", () => {
    const raw = fixture();
    raw.repos[0]!.description = "Engine [beta] for policies";
    const b = readmeBlock(analyze(raw), { sections: ["projects"], dir: "." });
    expect(b).toContain("Engine &#91;beta&#93; for policies");
  });

  test("omits the bio when asked", () => {
    expect(readmeBlock(p, { sections: ["hero"], dir: ".", bio: null })).not.toContain("care");
  });
});

describe("mergeReadme", () => {
  test("replaces only the block between markers", () => {
    const existing = `# Hi\n\n${START}\nold\n${END}\n\nHand-written footer\n`;
    const merged = mergeReadme(existing, block);
    expect(merged.startsWith("# Hi")).toBe(true);
    expect(merged).toContain("Hand-written footer");
    expect(merged).not.toContain("\nold\n");
    expect(merged.split(START)).toHaveLength(2);
  });

  test("keeps an unmarked README below the new block", () => {
    const merged = mergeReadme("My old README\n", block);
    expect(merged.startsWith(START)).toBe(true);
    expect(merged.trimEnd().endsWith("My old README")).toBe(true);
  });

  test("replace overwrites", () => {
    expect(mergeReadme("My old README\n", block, true)).not.toContain("My old README");
  });

  test("is stable when run twice", () => {
    const once = mergeReadme(null, block);
    expect(mergeReadme(once, block)).toBe(once);
  });
});

describe("cli", () => {
  test("renders from saved raw data without the network", () => {
    const dir = mkdtempSync(join(tmpdir(), "gitsona-"));
    const raw = join(dir, "raw.json");
    writeFileSync(raw, JSON.stringify(fixture()));
    const out = join(dir, "out");
    const r = spawnSync("bun", ["src/cli.ts", "--from-raw", raw, "--out", out, "--preview", "--action", "-q"], {
      encoding: "utf8",
      env: { ...process.env, GITHUB_TOKEN: "" },
    });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(readFileSync(join(out, "README.md"), "utf8")).toContain(START);
    expect(readdirSync(join(out, "gitsona")).length).toBeGreaterThan(10);
    expect(existsSync(join(out, "gitsona-preview.html"))).toBe(true);
    expect(existsSync(join(out, ".github/workflows/gitsona.yml"))).toBe(true);
  });

  test("removes images an earlier run drew and this one does not", () => {
    const dir = mkdtempSync(join(tmpdir(), "gitsona-prune-"));
    const raw = join(dir, "raw.json");
    writeFileSync(raw, JSON.stringify(fixture()));
    mkdirSync(join(dir, "out", "gitsona"), { recursive: true });
    writeFileSync(join(dir, "out", "gitsona", "project-gone-dark.svg"), "<svg/>");
    writeFileSync(join(dir, "out", "gitsona", "my-photo.png"), "keep");
    const r = spawnSync("bun", ["src/cli.ts", "--from-raw", raw, "--out", join(dir, "out"), "-q"], {
      encoding: "utf8",
    });
    expect(r.status).toBe(0);
    const files = readdirSync(join(dir, "out", "gitsona"));
    expect(files).not.toContain("project-gone-dark.svg");
    expect(files).toContain("my-photo.png");
    expect(files).toContain("hero-dark.svg");
  });

  test("rejects an unknown typeface preset", () => {
    const r = spawnSync("bun", ["src/cli.ts", "--font", "comic", "--from-raw", "x"], { encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Unknown --font comic");
  });

  test("rejects a display font it cannot use before calling GitHub", () => {
    const dir = mkdtempSync(join(tmpdir(), "gitsona-font-"));
    const woff = join(dir, "x.woff2");
    writeFileSync(woff, "wOF2rest-of-file");
    for (const [arg, msg] of [
      [dir, "is not a file"],
      [woff, "is a web font"],
      [join(dir, "missing.ttf"), "cannot be read"],
      ["README.md", "is not a TrueType or OpenType font"],
    ] as const) {
      const r = spawnSync("bun", ["src/cli.ts", "--display-font", arg, "--from-raw", "x"], { encoding: "utf8" });
      expect(r.status, arg).toBe(2);
      expect(r.stderr, arg).toContain(msg);
    }
  });

  test("rejects unknown sections with a usage error", () => {
    const r = spawnSync("bun", ["src/cli.ts", "--sections", "hero,nope", "--from-raw", "x"], { encoding: "utf8" });
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("Unknown section: nope");
  });
});
