import type { Profile } from "../analyze.ts";
import { contours, makeField, normalize } from "./contour.ts";
import { ellipsize, fitSize, measure, wrap } from "./fonts.ts";
import { Doc, esc, fmt, r1, rng } from "./svg.ts";
import type { Theme } from "./theme.ts";

const W = 1200;
const H = 460;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function fmtDate(iso: string): string {
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00Z` : iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/**
 * The last twelve months of contributions as relief: every day is a hill whose height is its
 * contribution count, west to east is time, and the contour lines are drawn once when the image loads.
 */
export function hero(p: Profile, t: Theme, opts: { motion?: boolean } = {}): string {
  const doc = new Doc(W, H, t, `${p.displayName} (@${p.login}): ${p.headline}`);
  const days = p.lastYear.days;
  const max = Math.max(1, ...days.map((d) => d.count));

  // Terrain frame: days are laid out on a week × weekday lattice spread over the card.
  const x0 = 40;
  const x1 = W - 40;
  const y0 = 64;
  const y1 = H - 78;
  const first = days[0] ? new Date(`${days[0].date}T00:00:00Z`) : new Date();
  const offset = (first.getUTCDay() + 6) % 7;
  const weeks = Math.ceil((days.length + offset) / 7);
  const pos = (i: number): [number, number] => {
    const k = i + offset;
    const wk = Math.floor(k / 7);
    const wd = k % 7;
    return [x0 + (wk / Math.max(1, weeks - 1)) * (x1 - x0), y0 + (wd / 6) * (y1 - y0)];
  };
  const hills = days.map((d, i) => ({ xy: pos(i), h: Math.sqrt(d.count / max) })).filter((h) => h.h > 0);
  const rand = rng(p.login);
  const phase = [rand() * 6, rand() * 6, rand() * 6];
  const sx = 2 * 20 ** 2;
  const sy = 2 * 30 ** 2;
  const cell = 6;
  const field = normalize(
    makeField(Math.ceil(W / cell) + 1, Math.ceil(H / cell) + 1, cell, (x, y) => {
      let v = 0;
      for (const { xy, h } of hills) {
        const dx = x - xy[0];
        const dy = y - xy[1];
        if (dx > 70 || dx < -70) continue;
        v += h * Math.exp(-(dx * dx) / sx - (dy * dy) / sy);
      }
      // A faint swell so quiet stretches still read as land rather than an empty sheet.
      v += 0.05 * (Math.sin(x / 97 + phase[0]!) + Math.sin(y / 61 + phase[1]!) + Math.sin((x + y) / 143 + phase[2]!));
      return v;
    }),
  );
  const levels = Array.from({ length: 13 }, (_, i) => 0.1 + i * 0.068);
  const lines = contours(field, levels, 18);

  doc.def(
    `<linearGradient id="veil" x1="0" x2="1" y1="0" y2="0">` +
      `<stop offset="0" stop-color="${t.bg}" stop-opacity="0.94"/>` +
      `<stop offset="0.36" stop-color="${t.bg}" stop-opacity="0.86"/>` +
      `<stop offset="0.56" stop-color="${t.bg}" stop-opacity="0"/>` +
      `</linearGradient>` +
      `<clipPath id="card"><rect x="1" y="1" width="${W - 2}" height="${H - 2}" rx="13"/></clipPath>`,
  );
  if (opts.motion !== false)
    doc.style(
      `.c{animation:draw 2.6s cubic-bezier(.25,.6,.2,1) backwards}` +
        `@keyframes draw{from{stroke-dashoffset:var(--l)}}` +
        `.pk{animation:rise .8s ease-out 1.6s backwards}` +
        `@keyframes rise{from{opacity:0;transform:translateY(6px)}}` +
        `@media (prefers-reduced-motion:reduce){.c,.pk{animation:none}}`,
    );

  const terrain = lines
    .map((c) => {
      const major = c.index % 4 === 3;
      const top = c.index >= levels.length - 3;
      const stroke = top ? t.accent : major ? t.contourMajor : t.contour;
      const width = top ? 1.4 : major ? 1.3 : 0.9;
      const delay = c.index * 90;
      return `<path class="c" d="${c.d}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="${c.length + 2}" style="--l:${c.length + 2};animation-delay:${delay}ms"/>`;
    })
    .join("");

  // Month graticule along the bottom edge.
  const ticks: string[] = [];
  days.forEach((d, i) => {
    if (!d.date.endsWith("-01")) return;
    const [x] = pos(i);
    const label = MONTHS[+d.date.slice(5, 7) - 1]!;
    ticks.push(
      `<line x1="${r1(x)}" y1="${y0 - 18}" x2="${r1(x)}" y2="${H - 44}" stroke="${t.rule}" stroke-width="1" stroke-dasharray="2 5"/>`,
      doc.text(x, H - 26, d.date.endsWith("01-01") ? `${label} ${d.date.slice(0, 4)}` : label, {
        font: "regular",
        size: 12,
        fill: t.faint,
        anchor: "middle",
      }),
    );
  });

  // Peak marker.
  const peakIdx = days.findIndex((d) => d.date === p.lastYear.peak.date);
  let peak = "";
  if (peakIdx >= 0 && p.lastYear.peak.count > 0) {
    const [px, py] = pos(peakIdx);
    const label = `${fmt(p.lastYear.peak.count)} on ${fmtDate(p.lastYear.peak.date)}`;
    const lw = measure(label, "medium", 13);
    const right = px + 14 + lw < W - 24;
    const lx = right ? px + 12 : px - 12;
    peak =
      `<g class="pk">` +
      `<path d="M${r1(px)} ${r1(py - 7)}l6.5 11h-13z" fill="${t.accent}" stroke="${t.bg}" stroke-width="2" paint-order="stroke"/>` +
      doc.text(lx, py + 3, label, {
        font: "medium",
        size: 13,
        fill: t.ink,
        anchor: right ? "start" : "end",
        tnum: true,
        halo: { color: t.bg, width: 2.5 },
      }) +
      `</g>`;
  }

  // Left column: who, what, and a cartographic legend of the numbers that back it.
  const left = 56;
  const colW = 470;
  const joined = new Date(p.joined);
  const since = `@${p.login} on GitHub since ${MONTHS[joined.getUTCMonth()]} ${joined.getUTCFullYear()}`;
  const nameSize = fitSize(p.displayName, "display", 104, colW + 60, 48);
  const headline = wrap(p.headline, "text", 26, colW, 2);
  const summary = wrap(p.summary, "regular", 17, colW - 20, 3);
  let y = 76;
  const head: string[] = [];
  head.push(doc.text(left, y, ellipsize(since, "medium", 15, colW), { font: "medium", size: 15, fill: t.muted }));
  y += 22 + nameSize * 0.7;
  head.push(
    doc.text(left - nameSize * 0.04, y, p.displayName, {
      font: "display",
      size: nameSize,
      fill: t.ink,
      tracking: -nameSize * 0.02,
    }),
  );
  y += 44;
  for (const l of headline) {
    head.push(doc.text(left, y, l, { font: "text", size: 26, fill: t.ink, tracking: -0.3 }));
    y += 31;
  }
  y += 2;
  for (const l of summary) {
    head.push(doc.text(left, y, l, { font: "regular", size: 17, fill: t.muted }));
    y += 24;
  }

  const legend: [string, string][] = [
    ["Contributions, last 12 months", fmt(p.lastYear.total)],
    ["Longest daily run", `${p.lastYear.longestStreak} days`],
    ["PRs merged in others' projects", fmt(p.upstream.merged)],
    ["Stars on own repositories", fmt(p.totals.stars)],
  ];
  const ly0 = Math.max(y + 18, H - 26 - legend.length * 25);
  const lx1 = left + 360;
  const legendSvg = legend
    .map(([k, v], i) => {
      const ly = ly0 + i * 25;
      const kw = measure(k, "regular", 14);
      const vw = measure(v, "semibold", 14);
      return (
        doc.text(left, ly, k, { font: "regular", size: 14, fill: t.muted }) +
        `<line x1="${r1(left + kw + 8)}" y1="${ly - 4}" x2="${r1(lx1 - vw - 8)}" y2="${ly - 4}" stroke="${t.faint}" stroke-width="1.2" stroke-dasharray="0.1 5" stroke-linecap="round"/>` +
        doc.text(lx1, ly, v, { font: "semibold", size: 14, fill: t.ink, anchor: "end", tnum: true })
      );
    })
    .join("");

  const caption = doc.text(
    W - 40,
    40,
    `Daily contributions as relief, ${fmtDate(days[0]?.date ?? "")} to ${fmtDate(days.at(-1)?.date ?? "")}`,
    {
      font: "regular",
      size: 12,
      fill: t.faint,
      anchor: "end",
      halo: { color: t.bg, width: 3 },
    },
  );

  return doc.render(
    `<g clip-path="url(#card)">${ticks.filter((_, i) => i % 2 === 0).join("")}${terrain}` +
      `<rect x="0" y="0" width="${W}" height="${H}" fill="url(#veil)"/>` +
      `${ticks.filter((_, i) => i % 2 === 1).join("")}${peak}</g>` +
      caption +
      head.join("") +
      legendSvg,
  );
}

export { esc };
