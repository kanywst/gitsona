import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { subsetFont } from "./subset.ts";

export type FontId = "display" | "text" | "regular" | "medium" | "semibold";

const FILES: Record<FontId, string> = {
  display: "bric-display",
  text: "bric-text",
  regular: "plexcond-Regular",
  medium: "plexcond-Medium",
  semibold: "plexcond-SemiBold",
};

/** CSS font stacks. Embedded faces first; system faces cover glyphs outside the Latin subset. */
export const FAMILY: Record<FontId, string> = {
  display: "'gs-display', 'Avenir Next Condensed', 'Arial Narrow', sans-serif",
  text: "'gs-text', 'Avenir Next', 'Segoe UI', sans-serif",
  regular: "'gs-plex', 'IBM Plex Sans Condensed', 'Roboto Condensed', 'Arial Narrow', sans-serif",
  medium: "'gs-plex', 'IBM Plex Sans Condensed', 'Roboto Condensed', 'Arial Narrow', sans-serif",
  semibold: "'gs-plex', 'IBM Plex Sans Condensed', 'Roboto Condensed', 'Arial Narrow', sans-serif",
};

const FACE: Record<FontId, { family: string; weight: number }> = {
  display: { family: "gs-display", weight: 700 },
  text: { family: "gs-text", weight: 500 },
  regular: { family: "gs-plex", weight: 400 },
  medium: { family: "gs-plex", weight: 500 },
  semibold: { family: "gs-plex", weight: 600 },
};

export const WEIGHT: Record<FontId, number> = {
  display: 700,
  text: 500,
  regular: 400,
  medium: 500,
  semibold: 600,
};

function fontsDir(): string {
  // Works from src/render (dev) and from dist/ (bundled): walk up until fonts/ is found.
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 4; i++) {
    try {
      readFileSync(join(dir, "fonts", "metrics.json"));
      return join(dir, "fonts");
    } catch {
      dir = dirname(dir);
    }
  }
  throw new Error("gitsona: fonts directory not found next to the package");
}

let metricsCache: Record<string, { widths: Record<string, number> }> | null = null;
const fontCache = new Map<FontId, Uint8Array>();

function metrics() {
  metricsCache ??= JSON.parse(readFileSync(join(fontsDir(), "metrics.json"), "utf8"));
  return metricsCache!;
}

/** @font-face rules embedding, per face, only the characters the document uses. */
export function fontFaceCss(used: Map<FontId, Set<string>>): string {
  return [...used.entries()]
    .map(([id, chars]) => {
      let font = fontCache.get(id);
      if (!font) {
        font = new Uint8Array(readFileSync(join(fontsDir(), `${FILES[id]}.ttf`)));
        fontCache.set(id, font);
      }
      // Space and the ellipsis/digits are cheap and keep later edits from missing glyphs.
      const sub = subsetFont(font, new Set([...chars, " "])) ?? font;
      const f = FACE[id];
      return `@font-face{font-family:'${f.family}';font-weight:${f.weight};src:url(data:font/ttf;base64,${Buffer.from(sub).toString("base64")}) format('truetype')}`;
    })
    .join("");
}

/** Advance width in px of `text` set in `font` at `size`. Glyphs outside the subset count as 0.6em. */
export function measure(text: string, font: FontId, size: number, letterSpacing = 0): number {
  const w = metrics()[FILES[font]]!.widths;
  let em = 0;
  for (const ch of text) {
    const cw = w[ch];
    em += cw ?? (ch.charCodeAt(0) > 0x2e80 ? 1 : 0.6);
  }
  return em * size + letterSpacing * Math.max(0, [...text].length - 1);
}

/** Greedy word wrap; the last allowed line ends with an ellipsis if text remains. */
export function wrap(text: string, font: FontId, size: number, maxWidth: number, maxLines = Infinity): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (let i = 0; i < words.length; i++) {
    const word = words[i]!;
    const next = line ? `${line} ${word}` : word;
    if (measure(next, font, size) <= maxWidth || !line) {
      line = next;
      continue;
    }
    lines.push(line);
    line = word;
    if (lines.length === maxLines) {
      line = "";
      const last = lines.pop()!;
      lines.push(ellipsize(`${last} ${words.slice(i).join(" ")}`, font, size, maxWidth));
      return lines;
    }
  }
  if (line) lines.push(lines.length + 1 > maxLines ? ellipsize(line, font, size, maxWidth) : line);
  return lines.map((l) => (measure(l, font, size) > maxWidth ? ellipsize(l, font, size, maxWidth) : l));
}

export function ellipsize(text: string, font: FontId, size: number, maxWidth: number): string {
  if (measure(text, font, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 1 && measure(`${t}…`, font, size) > maxWidth) t = t.slice(0, -1);
  return `${t.trimEnd().replace(/[,.;:\-–—]$/, "")}…`;
}

/** Largest size ≤ max at which `text` fits in one line of `maxWidth`. */
export function fitSize(text: string, font: FontId, max: number, maxWidth: number, min = 12): number {
  let s = max;
  while (s > min && measure(text, font, s) > maxWidth) s -= 1;
  return s;
}
