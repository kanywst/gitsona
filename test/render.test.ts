import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { analyze } from "../src/analyze.ts";
import { contours, makeField, normalize } from "../src/render/contour.ts";
import { ellipsize, measure, wrap } from "../src/render/fonts.ts";
import { render, SECTIONS } from "../src/render/index.ts";
import { subsetFont } from "../src/render/subset.ts";
import { contrast, hexToHsl, theme } from "../src/render/theme.ts";
import { fixture } from "./fixture.ts";

describe("contours", () => {
  test("a single hill gives closed rings, one per level", () => {
    const field = normalize(makeField(41, 41, 5, (x, y) => Math.exp(-((x - 100) ** 2 + (y - 100) ** 2) / 2000)));
    const lines = contours(field, [0.25, 0.5, 0.75]);
    expect(lines).toHaveLength(3);
    for (const l of lines) {
      expect(l.d.endsWith("Z")).toBe(true);
      expect(l.d).not.toContain("NaN");
    }
  });
});

describe("text metrics", () => {
  test("wrap never exceeds the width and respects the line cap", () => {
    const text = "Live, visual network-path diagnostic that pinpoints exactly where your connection dies";
    const lines = wrap(text, "regular", 15, 200, 2);
    expect(lines.length).toBeLessThanOrEqual(2);
    for (const l of lines) expect(measure(l, "regular", 15)).toBeLessThanOrEqual(200);
    expect(lines.at(-1)?.endsWith("…")).toBe(true);
  });

  test("ellipsize leaves short text alone", () => {
    expect(ellipsize("short", "regular", 14, 500)).toBe("short");
  });
});

describe("font subsetting", () => {
  test("produces a much smaller valid TrueType font", () => {
    const src = new Uint8Array(readFileSync(new URL("../fonts/plexcond-Regular.ttf", import.meta.url)));
    const out = subsetFont(src, "gitsona 123");
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThan(src.length / 3);
    expect([...out!.slice(0, 4)]).toEqual([0, 1, 0, 0]);
  });
});

describe("theme", () => {
  const colors = ["#00ADD8", "#f1e05a", "#dea584", "#3572A5", "#555555", "#e34c26", "#b07219", "#178600", "#ffffff"];
  for (const c of colors) {
    test(`accent from ${c} stays readable on both grounds`, () => {
      for (const mode of ["dark", "light"] as const) {
        const t = theme(mode, c);
        expect(contrast(t.accent, t.bg)).toBeGreaterThanOrEqual(3);
        expect(contrast(t.ink, t.bg)).toBeGreaterThanOrEqual(12);
        expect(contrast(t.muted, t.bg)).toBeGreaterThanOrEqual(4.5);
      }
    });
  }

  test("grey stays grey", () => {
    expect(hexToHsl(theme("dark", "#555555").accent)[1]).toBe(0);
  });
});

describe("render", () => {
  const p = analyze(fixture());
  const out = render(p, { sections: [...SECTIONS], motion: true }, new Map());

  test("draws every section in both modes", () => {
    expect(out.sections).toEqual([...SECTIONS]);
    for (const s of ["hero", "traits", "rhythm", "strata", "upstream"]) {
      expect(out.files.has(`${s}-dark.svg`)).toBe(true);
      expect(out.files.has(`${s}-light.svg`)).toBe(true);
    }
    expect([...out.files.keys()].filter((k) => k.startsWith("project-"))).toHaveLength(p.landmarks.length * 2);
  });

  test("every SVG is self-contained, titled and free of broken numbers", () => {
    for (const [name, svg] of out.files) {
      expect(svg.startsWith("<svg xmlns=")).toBe(true);
      expect(svg).toContain("<title>");
      expect(svg).not.toMatch(/NaN|undefined|Infinity/);
      expect(svg).not.toMatch(/(href|src)="https?:/);
      expect(name.endsWith(".svg")).toBe(true);
    }
  });

  test("user text is escaped", () => {
    const card = out.files.get("project-authz-engine-dark.svg")!;
    expect(card).toContain("&lt;fast&gt;");
    expect(card).not.toContain("<fast>");
  });

  test("is deterministic", () => {
    const again = render(p, { sections: [...SECTIONS], motion: true }, new Map());
    expect(again.files.get("hero-dark.svg")).toBe(out.files.get("hero-dark.svg"));
  });

  test("motion can be turned off", () => {
    const still = render(p, { sections: ["hero"], motion: false }, new Map());
    expect(still.files.get("hero-dark.svg")).not.toContain("@keyframes");
    expect(out.files.get("hero-dark.svg")).toContain("prefers-reduced-motion");
  });
});
