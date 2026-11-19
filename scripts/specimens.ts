// Draws the typeface preset sheet used in the README: bun scripts/specimens.ts
// Output: docs/fonts/presets-light.svg and docs/fonts/presets-dark.svg
import { writeFileSync } from "node:fs";
import { measure, TYPESET_NAMES, TYPESETS, useTypeset } from "../src/render/fonts.ts";
import { Doc } from "../src/render/svg.ts";
import { type Mode, theme } from "../src/render/theme.ts";

const FACES: Record<string, string> = {
  pixel: "Pixelify Sans + Geist Mono",
  geist: "Geist Mono",
  mono: "Geist Mono",
  grotesk: "Space Grotesk + Space Mono",
  rounded: "Rubik + Geist Mono",
  retro: "Departure Mono + Geist Mono",
};

const COLS = 3;
const GAP = 20;
const TW = 386;
const TH = 172;
const W = COLS * TW + (COLS - 1) * GAP;
const H = Math.ceil(TYPESET_NAMES.length / COLS) * (TH + GAP) - GAP;
const ACCENT = "#00add8";

function tile(name: (typeof TYPESET_NAMES)[number], mode: Mode): string {
  useTypeset(TYPESETS[name]);
  const t = theme(mode, ACCENT);
  const doc = new Doc(TW, TH, t, `--font ${name}`);
  const x = 28;
  const parts = [
    doc.text(x, 42, `--font ${name}`, { font: "regular", size: 15, fill: t.accent }),
    doc.text(x, 100, "Night owl", { font: "display", size: 48, fill: t.ink }),
    doc.text(x + measure("Night owl", "display", 48) + 2, 100, "_", { font: "display", size: 48, fill: t.accent }),
    doc.text(x, 132, "Night owl:", { font: "mono", size: 17, fill: t.accent }) +
      doc.text(x + measure("Night owl: ", "mono", 17), 132, "56% of commits", { font: "mono", size: 17, fill: t.ink }),
    doc.text(x, 156, FACES[name] ?? "", { font: "regular", size: 13, fill: t.faint }),
  ];
  // Each tile carries its own glyph defs; prefix the ids so faces don't collide in one file.
  return doc
    .render(parts.join(""))
    .replace(/id="([^"]+)"/g, `id="${name}-$1"`)
    .replace(/href="#/g, `href="#${name}-`)
    .replace(/url\(#/g, `url(#${name}-`);
}

for (const mode of ["light", "dark"] as const) {
  const tiles = TYPESET_NAMES.map((name, i) => {
    const tx = (i % COLS) * (TW + GAP);
    const ty = Math.floor(i / COLS) * (TH + GAP);
    return tile(name, mode).replace("<svg ", `<svg x="${tx}" y="${ty}" `);
  });
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="The six --font presets: ${TYPESET_NAMES.join(", ")}"><title>gitsona typeface presets</title>${tiles.join("")}</svg>`;
  writeFileSync(`docs/fonts/presets-${mode}.svg`, svg);
}
