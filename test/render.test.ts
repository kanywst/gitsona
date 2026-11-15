import { describe, expect, test } from "bun:test";
import { analyze } from "../src/analyze.ts";
import { contours, makeField, normalize } from "../src/render/contour.ts";
import { ellipsize, measure, shape, TYPESET_NAMES, TYPESETS, withDisplayFont, wrap } from "../src/render/fonts.ts";
import { render, SECTIONS } from "../src/render/index.ts";
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

describe("outlined text", () => {
  test("tabular figures share one width", () => {
    expect(shape("1111", "regular", true).width).toBe(shape("8888", "regular", true).width);
  });

  test("text becomes glyph outlines with each glyph defined once", () => {
    const p = analyze(fixture());
    const svg = render(p, { sections: ["traits"], motion: false }, new Map()).files.get("traits-dark.svg")!;
    expect(svg).not.toContain("<text");
    expect(svg).not.toContain("@font-face");
    const ids = [...svg.matchAll(/<path id="([a-z]\d+)"/g)].map((m) => m[1]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const m of svg.matchAll(/href="#([a-z]\d+)"/g)) expect(ids).toContain(m[1]);
  });

  test("characters outside the bundled faces fall back to system text", () => {
    const raw = fixture();
    raw.user.name = "丹羽 Ada";
    const svg = render(analyze(raw), { sections: ["hero"], motion: false }, new Map()).files.get("hero-dark.svg")!;
    expect(svg).toContain(">丹羽 Ada</text>");
    expect(shape("丹羽", "display").complete).toBe(false);
  });
});

describe("typeface presets", () => {
  const p = analyze(fixture());
  for (const name of TYPESET_NAMES) {
    test(`${name} draws every section with its own outlines`, () => {
      const out = render(p, { sections: [...SECTIONS], motion: false, typeset: TYPESETS[name] }, new Map());
      for (const [file, svg] of out.files) {
        expect(svg, file).not.toContain("<text");
        expect(svg, file).not.toMatch(/NaN|undefined/);
      }
    });
  }

  test("the hero legend never runs into the month labels", () => {
    // Long enough to wrap both blocks, so the card has to grow.
    const long = {
      ...p,
      headline: "Security, authorization, identity and AI agents",
      summary:
        "Builds security tools and authorization engines in Go, TypeScript and Rust, and lands fixes upstream in dex and spire.",
    };
    for (const name of TYPESET_NAMES) {
      const svg = render(long, { sections: ["hero"], motion: false, typeset: TYPESETS[name] }, new Map()).files.get(
        "hero-dark.svg",
      )!;
      const h = Number(/height="(\d+)"/.exec(svg)![1]);
      const ys = [...svg.matchAll(/translate\([\d.]+ ([\d.]+)\)/g)].map((m) => Number(m[1]));
      const months = h - 26;
      const legend = ys.filter((y) => y < months - 1);
      expect(Math.max(...legend), name).toBeLessThanOrEqual(months - 24);
    }
  });

  test("presets draw differently", () => {
    const a = render(p, { sections: ["hero"], motion: false, typeset: TYPESETS.pixel }, new Map()).files.get(
      "hero-dark.svg",
    );
    const b = render(p, { sections: ["hero"], motion: false, typeset: TYPESETS.geist }, new Map()).files.get(
      "hero-dark.svg",
    );
    expect(a).not.toBe(b);
  });

  test("a display font from disk replaces the name and headline faces only", () => {
    const file = new URL("../fonts/SpaceGrotesk.ttf", import.meta.url).pathname;
    const t = withDisplayFont(TYPESETS.pixel, file);
    expect(t.faces.display.file).toBe(file);
    expect(t.faces.text.file).toBe(file);
    expect(t.faces.regular).toEqual(TYPESETS.pixel.faces.regular);
    const svg = render(p, { sections: ["hero"], motion: false, typeset: t }, new Map()).files.get("hero-dark.svg")!;
    expect(svg).not.toContain("<text");
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
