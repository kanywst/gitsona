import type { Profile } from "../analyze.ts";
import { makeField, normalize } from "./contour.ts";
import { ellipsize, fitSize, measure, wrap } from "./fonts.ts";
import { Doc, esc, fmt, r1 } from "./svg.ts";
import type { Theme } from "./theme.ts";

const W = 1200;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Density ramp, lightest to heaviest: one character per cell of the terrain. */
export const RAMP = " .:-=+*#%@";

export function fmtDate(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * The last twelve months as ASCII terrain: days sit on a week × weekday lattice, each day raises a
 * hill as high as its contribution count, and every character cell takes the glyph for its height.
 * West to east is time. Returns one string per row.
 */
export function asciiTerrain(p: Profile, cols: number, rows: number): string[] {
  const days = p.lastYear.days;
  const max = Math.max(1, ...days.map((d) => d.count));
  const first = days[0] ? new Date(`${days[0].date}T00:00:00Z`) : new Date();
  const offset = (first.getUTCDay() + 6) % 7;
  const weeks = Math.ceil((days.length + offset) / 7);
  // Work in a field twice as fine as the character grid, with cells roughly as tall as a glyph.
  const fw = cols * 2;
  const fh = rows * 4;
  const pad = 1.5;
  const hills = days
    .map((d, i) => {
      const k = i + offset;
      const x = pad + (Math.floor(k / 7) / Math.max(1, weeks - 1)) * (fw - 2 * pad);
      const y = pad + ((k % 7) / 6) * (fh - 2 * pad);
      return { x, y, h: Math.sqrt(d.count / max) };
    })
    .filter((h) => h.h > 0);
  const sx = 2 * (fw / 60) ** 2;
  const sy = 2 * (fh / 10) ** 2;
  const field = normalize(
    makeField(fw + 1, fh + 1, 1, (x, y) => {
      let v = 0;
      for (const h of hills) {
        const dx = x - h.x;
        if (dx > fw / 10 || dx < -fw / 10) continue;
        const dy = y - h.y;
        v += h.h * Math.exp(-(dx * dx) / sx - (dy * dy) / sy);
      }
      return v;
    }),
  );
  const at = (i: number, j: number) => {
    const fx = Math.round((i / Math.max(1, cols - 1)) * fw);
    const fy = Math.round((j / Math.max(1, rows - 1)) * fh);
    return field.values[fy * field.cols + fx]!;
  };
  // Normalise over the cells actually drawn, so the highest cell always gets the heaviest glyph.
  const cells = Array.from({ length: rows }, (_, j) => Array.from({ length: cols }, (_, i) => at(i, j)));
  const top = Math.max(1e-9, ...cells.flat());
  return cells.map((row) =>
    row.map((v) => RAMP[Math.min(RAMP.length - 1, Math.floor((v / top) ** 0.8 * RAMP.length))]).join(""),
  );
}

const HANDLE_SIZE = 20;

/**
 * Fits the name and the @handle on one line `avail` wide. The name shrinks first; a handle that still
 * does not fit is shortened, and left out when too little room is left (the title bar names the login).
 * Offsets are relative to the start of the line.
 */
export function nameLine(
  name: string,
  login: string,
  avail: number,
): { name: string; size: number; handle: string | null; handleX: number } {
  const gap = 18;
  const handle = `@${login}`;
  const hw = measure(handle, "mono", HANDLE_SIZE);
  let size = fitSize(name, "display", 72, avail - gap - hw, 36);
  if (measure(name, "display", size) + gap + hw <= avail) {
    return { name, size, handle, handleX: measure(name, "display", size) + gap };
  }
  size = fitSize(name, "display", 72, avail, 36);
  const shown = ellipsize(name, "display", size, avail);
  const room = avail - measure(shown, "display", size) - gap;
  const short = room >= 90 ? ellipsize(handle, "mono", HANDLE_SIZE, room) : null;
  return { name: shown, size, handle: short, handleX: measure(shown, "display", size) + gap };
}

/** Keeps only the characters of `line` that fall in `set`; the rest become spaces, so tones stay aligned. */
function only(line: string, set: string): string {
  return [...line].map((c) => (set.includes(c) ? c : " ")).join("");
}

/**
 * A terminal running `gitsona <login>`: the year as ASCII terrain in the logo slot, and the facts as
 * fetch-style rows that type themselves in.
 */
export function hero(p: Profile, t: Theme, opts: { motion?: boolean; cursor?: boolean } = {}): string {
  const motion = opts.motion !== false;
  const L = 44;
  const top = 44; // title bar
  // Right column: the name, then the rows.
  const rx = 540;
  const fs = 22; // row size: large enough to survive a phone-width README
  const lh = 37;
  const joined = new Date(p.joined);
  const facts: [string, string][] = [
    ["Role", p.headline],
    ...p.badges.map((b): [string, string] => [b.label, b.fact]),
    ["Since", `${MONTHS[joined.getUTCMonth()]} ${joined.getUTCFullYear()}`],
  ];
  // Values line up one column after the longest key, as fetch tools do.
  const vx = rx + Math.max(...facts.map(([k]) => measure(`${k}:`, "mono", fs))) + measure("00", "mono", fs);
  const valueW = W - 44 - vx;
  const rows = facts.map(([k, v]): [string, string[]] => [k, wrap(v, "mono", fs, valueW, 2)]);
  const head = nameLine(p.displayName, p.login, W - 44 - rx);
  const nameSize = head.size;
  const nameY = top + 52 + nameSize * 0.72;
  const ruleY = nameY + 26;
  const rowsY = ruleY + 44;
  const lineCount = rows.reduce((n, [, v]) => n + v.length, 0);
  const paletteY = rowsY + (lineCount - 1) * lh + 30;
  const H = Math.max(500, Math.ceil(paletteY + 20 + 64));
  const doc = new Doc(W, H, t, `${p.displayName} (@${p.login}): ${p.headline}`);
  const parts: string[] = [];

  // Window chrome.
  const bar = mixHex(t.bg, t.contour, 0.75);
  parts.push(
    `<path d="M1 ${top}V14Q1 1 14 1H${W - 14}Q${W - 1} 1 ${W - 1} 14V${top}Z" fill="${bar}"/>`,
    `<line x1="1" x2="${W - 1}" y1="${top}" y2="${top}" stroke="${t.rule}"/>`,
    ...["#ff5f57", "#febc2e", "#28c840"].map((c, i) => `<circle cx="${28 + i * 20}" cy="22" r="6" fill="${c}"/>`),
    doc.text(W / 2, 28, `${p.login}@github: ~`, { font: "mono", size: 14, fill: t.faint, anchor: "middle" }),
  );

  // Prompt.
  const prompt = `$ gitsona ${p.login}`;
  parts.push(typed(doc, t, L, top + 42, prompt, { font: "mono", size: 17, fill: t.muted }, motion ? 150 : -1));

  // Logo slot: the year as ASCII terrain, in three tones.
  const artSize = 15;
  const adv = measure("0", "mono", artSize);
  const artTop = top + 86;
  const artRows = Math.max(10, Math.floor((paletteY - artTop) / 20) + 1);
  const cols = Math.floor((rx - L - 36) / adv);
  const art = asciiTerrain(p, cols, artRows);
  // Three tones: quiet ground, slopes, and the peaks in the accent colour.
  const tones: [string, string][] = [
    [".:-=", t.contourMajor],
    ["+*", t.muted],
    ["#%@", t.accent],
  ];
  art.forEach((line, j) => {
    const y = artTop + j * 20;
    const g = tones
      .map(([set, fill]) => doc.text(L, y, only(line, set), { font: "mono", size: artSize, fill }))
      .join("");
    parts.push(motion ? `<g class="ar" style="animation-delay:${450 + j * 45}ms">${g}</g>` : g);
  });
  parts.push(
    doc.text(
      L,
      H - 26,
      `${fmt(p.lastYear.total)} contributions · ${fmtDate(p.lastYear.days[0]?.date ?? p.generatedAt)} → today`,
      {
        font: "mono",
        size: 14,
        fill: t.faint,
      },
    ),
  );

  // Right column: name, rule, rows.
  parts.push(doc.text(rx - nameSize * 0.04, nameY, head.name, { font: "display", size: nameSize, fill: t.ink }));
  if (head.handle) {
    parts.push(doc.text(rx + head.handleX, nameY, head.handle, { font: "mono", size: HANDLE_SIZE, fill: t.accent }));
  }
  parts.push(
    `<line x1="${rx}" x2="${W - 44}" y1="${ruleY}" y2="${ruleY}" stroke="${t.faint}" stroke-width="1.5" stroke-dasharray="6 6"/>`,
  );
  let y = rowsY;
  let delay = 900;
  for (const [key, lines] of rows) {
    parts.push(doc.text(rx, y, `${key}:`, { font: "mono", size: fs, fill: t.accent }));
    for (const line of lines) {
      parts.push(typed(doc, t, vx, y, line, { font: "mono", size: fs, fill: t.ink }, motion ? delay : -1));
      delay += 220;
      y += lh;
    }
  }

  // Palette row, then the prompt again with a cursor.
  const pal = ["#e06c75", "#e5c07b", "#98c379", "#56b6c2", "#61afef", "#c678dd", t.accent, t.ink];
  for (const [i, c] of pal.entries()) {
    parts.push(`<rect x="${rx + i * 40}" y="${r1(paletteY)}" width="36" height="20" fill="${c}"/>`);
  }
  const py = H - 26;
  parts.push(doc.text(rx, py, "$", { font: "mono", size: 17, fill: t.muted }));
  if (opts.cursor !== false) {
    const cw = measure("0", "mono", 17);
    parts.push(
      `<rect class="cur" x="${r1(rx + cw * 2)}" y="${py - 16}" width="${r1(cw)}" height="20" fill="${t.accent}"/>`,
    );
  }

  if (motion) {
    doc.style(
      `.ar{animation:ar .35s ease-out backwards}@keyframes ar{from{opacity:0}}` +
        `.ty{animation:ty .5s forwards}@keyframes ty{99%{transform:translateX(var(--w));opacity:1}100%{transform:translateX(var(--w));opacity:0}}` +
        `.cur{animation:cur 1.1s steps(1) infinite}@keyframes cur{50%{opacity:0}}` +
        `@media (prefers-reduced-motion:reduce){.ar,.ty,.cur{animation:none}.ty{opacity:0}}`,
    );
  }
  return doc.render(parts.join(""));
}

/**
 * Text that types itself in: a cover the colour of the window slides off it in steps, one per few
 * characters. With delay < 0 the text is simply drawn.
 */
function typed(
  doc: Doc,
  t: Theme,
  x: number,
  y: number,
  s: string,
  o: { font: "mono"; size: number; fill: string },
  delay: number,
): string {
  const text = doc.text(x, y, s, o);
  if (delay < 0) return text;
  const w = Math.ceil(measure(s, o.font, o.size)) + 8;
  const steps = Math.max(3, Math.round(s.length / 2));
  return (
    text +
    `<rect class="ty" x="${r1(x - 2)}" y="${r1(y - o.size)}" width="${w}" height="${Math.round(o.size * 1.35)}" fill="${t.bg}" style="--w:${w}px;animation-delay:${delay}ms;animation-timing-function:steps(${steps})"/>`
  );
}

function mixHex(a: string, b: string, k: number): string {
  const pa = [1, 3, 5].map((i) => Number.parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => Number.parseInt(b.slice(i, i + 2), 16));
  return `#${pa
    .map((v, i) =>
      Math.round(v + (pb[i]! - v) * k)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

export { esc };
