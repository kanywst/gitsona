import { FAMILY, type FontId, glyphPath, shape, WEIGHT } from "./fonts.ts";
import type { Theme } from "./theme.ts";

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export const r1 = (n: number) => Math.round(n * 10) / 10;
const r3 = (n: number) => Math.round(n * 10000) / 10000;

export function fmt(n: number): string {
  if (n >= 100_000) return `${Math.round(n / 1000)}k`;
  if (n >= 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return n.toLocaleString("en-US");
}

export interface TextOpts {
  font: FontId;
  size: number;
  fill: string;
  anchor?: "start" | "middle" | "end";
  tracking?: number;
  opacity?: number;
  cls?: string;
  /** Tabular, lining figures: numbers that line up. */
  tnum?: boolean;
  /** Draw a background-coloured outline under the text so it reads over busy art. */
  halo?: { color: string; width: number };
}

const FONT_KEY: Record<FontId, string> = { display: "d", text: "t", regular: "r", medium: "m", semibold: "s" };

export class Doc {
  /** Glyph outlines referenced by text(), emitted once each in <defs>. */
  private glyphs = new Map<string, string>();
  private defs: string[] = [];
  private css: string[] = [];
  constructor(
    public width: number,
    public height: number,
    public t: Theme,
    public title: string,
  ) {}

  text(x: number, y: number, s: string, o: TextOpts): string {
    const shaped = shape(s, o.font, o.tnum);
    if (!shaped.complete) return this.systemText(x, y, s, o);
    const scale = o.size / shaped.upem;
    const track = (o.tracking ?? 0) / scale;
    const width = shaped.width + track * Math.max(0, shaped.glyphs.length - 1);
    const dx = o.anchor === "middle" ? -width / 2 : o.anchor === "end" ? -width : 0;
    const uses: string[] = [];
    shaped.glyphs.forEach((g, i) => {
      const d = glyphPath(o.font, g.gid);
      if (!d) return;
      const id = `${FONT_KEY[o.font]}${g.gid}`;
      if (!this.glyphs.has(id)) this.glyphs.set(id, d);
      const gx = Math.round(g.x + dx + track * i);
      uses.push(`<use href="#${id}"${gx ? ` x="${gx}"` : ""}${g.y ? ` y="${Math.round(g.y)}"` : ""}/>`);
    });
    if (!uses.length) return "";
    const tr = `translate(${r1(x)} ${r1(y)}) scale(${r3(scale)} ${r3(-scale)})`;
    const cls = o.cls ? ` class="${o.cls}"` : "";
    const op = o.opacity !== undefined ? ` opacity="${o.opacity}"` : "";
    const body = uses.join("");
    const halo = o.halo
      ? `<g fill="${o.halo.color}" stroke="${o.halo.color}" stroke-width="${Math.round((o.halo.width * 2) / scale)}" stroke-linejoin="round">${body}</g>`
      : "";
    return `<g transform="${tr}"${cls}${op}>${halo}<g fill="${o.fill}">${body}</g></g>`;
  }

  /** Real <text> for strings outside the bundled faces; the viewer's fonts fill in. */
  private systemText(x: number, y: number, s: string, o: TextOpts): string {
    const attrs = [
      `x="${r1(x)}"`,
      `y="${r1(y)}"`,
      `font-family="${FAMILY[o.font]}"`,
      `font-weight="${WEIGHT[o.font]}"`,
      `font-size="${o.size}"`,
      `fill="${o.fill}"`,
    ];
    if (o.anchor && o.anchor !== "start") attrs.push(`text-anchor="${o.anchor}"`);
    if (o.opacity !== undefined) attrs.push(`opacity="${o.opacity}"`);
    if (o.cls) attrs.push(`class="${o.cls}"`);
    if (o.halo)
      attrs.push(
        `stroke="${o.halo.color}" stroke-width="${o.halo.width * 2}" paint-order="stroke" stroke-linejoin="round"`,
      );
    return `<text ${attrs.join(" ")}>${esc(s)}</text>`;
  }

  def(s: string) {
    this.defs.push(s);
  }

  style(s: string) {
    this.css.push(s);
  }

  render(body: string, opts: { frame?: boolean } = {}): string {
    const { width: w, height: h, t } = this;
    const frame = opts.frame !== false;
    const glyphs = [...this.glyphs].map(([id, d]) => `<path id="${id}" d="${d}"/>`).join("");
    const defs = glyphs + this.defs.join("");
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(this.title)}">`,
      `<title>${esc(this.title)}</title>`,
      this.css.length ? `<style>${this.css.join("")}</style>` : "",
      defs ? `<defs>${defs}</defs>` : "",
      frame
        ? `<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="14" fill="${t.bg}" stroke="${t.rule}"/>`
        : "",
      body,
      `</svg>`,
    ].join("");
  }
}

/** Deterministic PRNG so the same profile always draws the same picture. */
export function rng(seed: string): () => number {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
