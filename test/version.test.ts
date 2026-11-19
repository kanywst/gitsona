import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { workflow } from "../src/publish.ts";
import { VERSION } from "../src/version.ts";

describe("version", () => {
  test("matches package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(VERSION).toBe(pkg.version);
  });

  test("pins the generated workflow to the npm release of this version", () => {
    for (const wf of [workflow("daily"), workflow("weekly")]) {
      expect(wf).toContain(`npx -y gitsona@${VERSION} `);
      expect(wf).not.toContain("github:kanywst/gitsona");
    }
  });

  test("redraws daily by default, weekly when asked", () => {
    expect(workflow()).toContain('cron: "23 3 * * *"');
    expect(workflow("weekly")).toContain('cron: "23 3 * * 1"');
    expect(workflow()).not.toContain("__CRON__");
  });
});
