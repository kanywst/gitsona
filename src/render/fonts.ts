import { readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as hb from "harfbuzzjs";

/**
 * Text is shaped with HarfBuzz and drawn as glyph outlines. GitHub serves README images with a
 * `default-src 'none'` CSP, so a font embedded in the SVG may never load; outlines always render,
 * keep real kerning, and look the same in every viewer.
 */

export type FontId = "display" | "text" | "regular" | "medium" | "semibold";

/** One role: a font file and, for a variable font, where to pin its axes. */
export interface Face {
  /** File name inside the package's fonts/ directory, or an absolute path. */
  file: string;
  vars?: Record<string, number>;
  /** CSS stack for the rare string the file cannot draw (a name in kanji, say). */
  system: string;
  weight: number;
  /** Letter-spacing in em for large settings of this face. */
  tracking?: number;
  /** Optical size correction: a monospace reads larger than a sans at the same px. */
  scale?: number;
}

export interface Typeset {
  name: string;
  faces: Record<FontId, Face>;
}

const CJK = "'Hiragino Sans', 'Noto Sans CJK JP', sans-serif";

const SANS = `'Geist', 'Inter', 'Segoe UI', ${CJK}`;
const MONO = `'Geist Mono', 'SFMono-Regular', 'Menlo', 'Consolas', ${CJK}`;

const geistMono = (wght: number): Face => ({
  file: "GeistMono.ttf",
  vars: { wght },
  system: MONO,
  weight: wght,
  scale: 0.9,
});

/** Data roles shared by most presets: Geist Mono, slightly smaller because a monospace reads large. */
const MONO_DATA = { regular: geistMono(400), medium: geistMono(500), semibold: geistMono(600) };

/**
 * Bundled typesets, chosen with --font. Each pairs a face for the name and headlines with one for
 * body text and numbers. All are SIL OFL 1.1; licences sit next to the files in fonts/.
 */
export const TYPESETS = {
  pixel: {
    name: "pixel",
    faces: {
      display: { file: "PixelifySans.ttf", vars: { wght: 700 }, system: SANS, weight: 700 },
      text: { file: "PixelifySans.ttf", vars: { wght: 600 }, system: SANS, weight: 600, scale: 0.92 },
      ...MONO_DATA,
    },
  },
  geist: {
    name: "geist",
    faces: {
      display: { file: "GeistMono.ttf", vars: { wght: 400 }, system: MONO, weight: 400, tracking: 0.02 },
      text: { file: "Geist.ttf", vars: { wght: 500 }, system: SANS, weight: 500, tracking: -0.01 },
      ...MONO_DATA,
    },
  },
  mono: {
    name: "mono",
    faces: {
      display: { file: "GeistMono.ttf", vars: { wght: 700 }, system: MONO, weight: 700, tracking: -0.02 },
      text: { file: "GeistMono.ttf", vars: { wght: 600 }, system: MONO, weight: 600, scale: 0.92 },
      ...MONO_DATA,
    },
  },
  grotesk: {
    name: "grotesk",
    faces: {
      display: { file: "SpaceGrotesk.ttf", vars: { wght: 700 }, system: SANS, weight: 700, tracking: -0.03 },
      text: { file: "SpaceGrotesk.ttf", vars: { wght: 500 }, system: SANS, weight: 500 },
      regular: { file: "SpaceMono-Regular.ttf", system: MONO, weight: 400, scale: 0.88 },
      medium: { file: "SpaceMono-Regular.ttf", system: MONO, weight: 400, scale: 0.88 },
      semibold: { file: "SpaceMono-Bold.ttf", system: MONO, weight: 700, scale: 0.88 },
    },
  },
  rounded: {
    name: "rounded",
    faces: {
      display: { file: "Rubik.ttf", vars: { wght: 800 }, system: SANS, weight: 800, tracking: -0.02 },
      text: { file: "Rubik.ttf", vars: { wght: 500 }, system: SANS, weight: 500 },
      regular: { file: "Rubik.ttf", vars: { wght: 400 }, system: SANS, weight: 400 },
      medium: { file: "Rubik.ttf", vars: { wght: 500 }, system: SANS, weight: 500 },
      semibold: { file: "Rubik.ttf", vars: { wght: 600 }, system: SANS, weight: 600 },
    },
  },
  retro: {
    name: "retro",
    faces: {
      display: { file: "DepartureMono.otf", system: MONO, weight: 400 },
      text: { file: "DepartureMono.otf", system: MONO, weight: 400, scale: 0.9 },
      ...MONO_DATA,
    },
  },
} satisfies Record<string, Typeset>;

export type TypesetName = keyof typeof TYPESETS;
export const TYPESET_NAMES = Object.keys(TYPESETS) as TypesetName[];
export const DEFAULT_TYPESET: TypesetName = "pixel";

/** A preset with the name and headline faces swapped for a font file the user brings. */
export function withDisplayFont(base: Typeset, file: string): Typeset {
  // A wght axis, when the face has one, pins the weights the roles promise; static faces ignore it.
  const display: Face = { file, vars: { wght: 700 }, system: SANS, weight: 700 };
  const text: Face = { file, vars: { wght: 500 }, system: SANS, weight: 500 };
  return { name: `${base.name}+custom`, faces: { ...base.faces, display, text } };
}

/** Why a font file cannot be used, or null when HarfBuzz can shape Latin text with it. */
export function fontFileProblem(file: string): string | null {
  let bytes: Uint8Array;
  try {
    if (!statSync(file).isFile()) return "is not a file";
    bytes = new Uint8Array(readFileSync(file));
  } catch {
    return "cannot be read";
  }
  // WOFF and WOFF2 are compressed web formats HarfBuzz does not open.
  const tag = String.fromCharCode(...bytes.slice(0, 4));
  if (tag === "wOFF" || tag === "wOF2") return "is a web font (WOFF); use the .ttf or .otf";
  // sfnt magic: TrueType outlines, CFF outlines, Apple 'true', or a collection.
  if (!["\u0000\u0001\u0000\u0000", "OTTO", "true", "ttcf"].includes(tag)) return "is not a TrueType or OpenType font";
  const face = new hb.Face(new hb.Blob(bytes));
  const buf = new hb.Buffer();
  buf.addText("Ag");
  buf.guessSegmentProperties();
  hb.shape(new hb.Font(face), buf, []);
  if (buf.getGlyphInfos().some((g) => g.codepoint === 0)) return "has no Latin letters";
  return null;
}

let current: Typeset = TYPESETS[DEFAULT_TYPESET];

/** Switches the faces every later shape() and glyphPath() call uses. */
export function useTypeset(t: Typeset): void {
  current = t;
}

export function typeset(): Typeset {
  return current;
}

function fontsDir(): string {
  // Works from src/render (dev) and from dist/render (built): walk up until fonts/ is found.
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 4; i++) {
    try {
      readFileSync(join(dir, "fonts", "OFL-Geist.txt"));
      return join(dir, "fonts");
    } catch {
      dir = dirname(dir);
    }
  }
  throw new Error("gitsona: fonts directory not found next to the package");
}

interface Loaded {
  font: hb.Font;
  upem: number;
  paths: Map<number, string>;
}

const loaded = new Map<string, Loaded>();
const blobs = new Map<string, hb.Face>();

function load(id: FontId): Loaded {
  const f = current.faces[id];
  const key = `${f.file}|${JSON.stringify(f.vars ?? {})}`;
  let l = loaded.get(key);
  if (!l) {
    const path = isAbsolute(f.file) ? f.file : join(fontsDir(), f.file);
    let face = blobs.get(path);
    if (!face) {
      face = new hb.Face(new hb.Blob(new Uint8Array(readFileSync(path))));
      blobs.set(path, face);
    }
    const font = new hb.Font(face);
    if (f.vars) font.setVariations(Object.entries(f.vars).map(([tag, v]) => new hb.Variation(tag, v)));
    l = { font, upem: face.upem, paths: new Map() };
    loaded.set(key, l);
  }
  return l;
}

export interface Glyph {
  gid: number;
  /** Pen position in font units. */
  x: number;
  y: number;
}

export interface Shaped {
  glyphs: Glyph[];
  /** Advance width in font units. */
  width: number;
  upem: number;
  /** False when some character has no glyph in the bundled face. */
  complete: boolean;
}

const shapeCache = new Map<string, Shaped>();

export function shape(text: string, id: FontId, tnum = false): Shaped {
  const f = current.faces[id];
  const key = `${f.file}|${JSON.stringify(f.vars ?? {})}\u0001${tnum ? 1 : 0}\u0001${text}`;
  const hit = shapeCache.get(key);
  if (hit) return hit;
  const { font, upem } = load(id);
  const buf = new hb.Buffer();
  buf.addText(text);
  buf.guessSegmentProperties();
  // Ligatures and contextual alternates off: a name or a flag like "--push" must keep its characters.
  const features = [new hb.Feature("liga", 0), new hb.Feature("calt", 0)];
  if (tnum) features.push(new hb.Feature("tnum"), new hb.Feature("lnum"));
  hb.shape(font, buf, features);
  const glyphs: Glyph[] = [];
  let x = 0;
  let complete = true;
  const chars = [...text];
  for (const g of buf.getGlyphInfosAndPositions()) {
    if (g.codepoint === 0 && !/\s/.test(chars[g.cluster] ?? text.charAt(g.cluster))) complete = false;
    glyphs.push({ gid: g.codepoint, x: x + (g.xOffset ?? 0), y: g.yOffset ?? 0 });
    x += g.xAdvance ?? 0;
  }
  const out = { glyphs, width: x, upem, complete };
  shapeCache.set(key, out);
  return out;
}

/** Outline of one glyph in font units, y up, numbers rounded to integers. */
export function glyphPath(id: FontId, gid: number): string {
  const l = load(id);
  let d = l.paths.get(gid);
  if (d === undefined) {
    d = l.font
      .glyphToPath(gid)
      .replace(/-?\d+\.\d+/g, (n) => String(Math.round(Number(n))))
      .replace(/,/g, " ");
    l.paths.set(gid, d);
  }
  return d;
}

/** Advance width in px of `text` set in `font` at `size`. */
export function measure(text: string, font: FontId, sizeIn: number, letterSpacing = 0): number {
  const size = sizeIn * (current.faces[font].scale ?? 1);
  const s = shape(text, font);
  if (!s.complete) {
    // Fallback text: estimate from the character count, wide characters counting as one em.
    let em = 0;
    for (const ch of text) em += ch.charCodeAt(0) > 0x2e80 ? 1 : 0.55;
    return em * size + letterSpacing * Math.max(0, [...text].length - 1);
  }
  return (s.width / s.upem) * size + letterSpacing * Math.max(0, s.glyphs.length - 1);
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
