import { FAMILY, type FontId, fontFaceCss, WEIGHT } from "./fonts.ts";
import type { Theme } from "./theme.ts";

export function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export const r1 = (n: number) => Math.round(n * 10) / 10;

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
}

/** Fonts used by text() calls, so the document embeds only what it needs. */
export class Doc {
  private fonts = new Map<FontId, Set<string>>();
  private defs: string[] = [];
  private css: string[] = [];
  constructor(
    public width: number,
    public height: number,
    public t: Theme,
    public title: string,
  ) {}

  text(x: number, y: number, s: string, o: TextOpts): string {
    const chars = this.fonts.get(o.font) ?? new Set<string>();
    this.fonts.set(o.font, chars);
    for (const ch of s) chars.add(ch);
    const attrs = [
      `x="${r1(x)}"`,
      `y="${r1(y)}"`,
      `font-family="${FAMILY[o.font]}"`,
      `font-weight="${WEIGHT[o.font]}"`,
      `font-size="${o.size}"`,
      `fill="${o.fill}"`,
    ];
    if (o.anchor && o.anchor !== "start") attrs.push(`text-anchor="${o.anchor}"`);
    if (o.tracking) attrs.push(`letter-spacing="${o.tracking}"`);
    if (o.opacity !== undefined) attrs.push(`opacity="${o.opacity}"`);
    if (o.cls) attrs.push(`class="${o.cls}"`);
    if (o.tnum) attrs.push(`style="font-variant-numeric:tabular-nums lining-nums"`);
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
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(this.title)}">`,
      `<title>${esc(this.title)}</title>`,
      `<style>${fontFaceCss(this.fonts)}text{font-kerning:normal;font-feature-settings:'kern','liga'}${this.css.join("")}</style>`,
      this.defs.length ? `<defs>${this.defs.join("")}</defs>` : "",
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
