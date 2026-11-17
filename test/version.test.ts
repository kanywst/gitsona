import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { WORKFLOW } from "../src/publish.ts";
import { VERSION } from "../src/version.ts";

describe("version", () => {
  test("matches package.json", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(VERSION).toBe(pkg.version);
  });

  test("pins the generated workflow to the npm release of this version", () => {
    expect(WORKFLOW).toContain(`npx -y gitsona@${VERSION} `);
    expect(WORKFLOW).not.toContain("github:kanywst/gitsona");
  });
});
