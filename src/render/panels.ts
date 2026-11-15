import type { LangShare, Profile, UpstreamProject } from "../analyze.ts";
import type { Repo } from "../collect.ts";
import { contours, makeField, normalize } from "./contour.ts";
import { ellipsize, measure, wrap } from "./fonts.ts";
import { Doc, fmt, r1, rng } from "./svg.ts";
import { contrast, type Theme } from "./theme.ts";

const W = 1200;
const PAD = 56;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Four spectra, each with the evidence that placed the marker. */
export function traits(p: Profile, t: Theme): string {
  const cellW = (W - PAD * 2 - 72) / 2;
  const rowH = 120;
  const H = 48 + Math.ceil(p.traits.length / 2) * rowH + 8;
  const doc = new Doc(W, H, t, `How ${p.displayName} works`);
  const out: string[] = [];
  p.traits.forEach((tr, i) => {
    const x = PAD + (i % 2) * (cellW + 72);
    const y = 60 + Math.floor(i / 2) * rowH;
    const leanRight = tr.value >= 0.5;
    out.push(
      doc.text(x, y, tr.left, { font: "medium", size: 19, fill: leanRight ? t.muted : t.ink }),
      doc.text(x + cellW, y, tr.right, { font: "medium", size: 19, fill: leanRight ? t.ink : t.muted, anchor: "end" }),
    );
    const ty = y + 26;
    out.push(
      `<line x1="${x}" y1="${ty}" x2="${r1(x + cellW)}" y2="${ty}" stroke="${t.rule}" stroke-width="2" stroke-linecap="round"/>`,
    );
    for (let k = 0; k <= 10; k++) {
      const tx = x + (k / 10) * cellW;
      const h = k === 5 ? 7 : 3;
      out.push(
        `<line x1="${r1(tx)}" y1="${ty - h}" x2="${r1(tx)}" y2="${ty + h}" stroke="${k === 5 ? t.faint : t.contourMajor}" stroke-width="1.2"/>`,
      );
    }
    const mx = x + tr.value * cellW;
    const cx = x + cellW / 2;
    out.push(
      `<line x1="${r1(cx)}" y1="${ty}" x2="${r1(mx)}" y2="${ty}" stroke="${t.accent}" stroke-width="2.5" stroke-linecap="round"/>`,
      `<circle cx="${r1(mx)}" cy="${ty}" r="7" fill="${t.accent}" stroke="${t.bg}" stroke-width="3"/>`,
      doc.text(x, ty + 40, ellipsize(tr.evidence, "regular", 17, cellW), { font: "regular", size: 17, fill: t.muted }),
    );
  });
  return doc.render(out.join(""));
}

/** When the commits land: weekday × hour in the author's own time zone, plus twelve months of volume. */
export function rhythm(p: Profile, t: Theme): string {
  const H = 332;
  const doc = new Doc(W, H, t, `When ${p.displayName} commits`);
  const r = p.rhythm;
  const gx = 104;
  const gy = 58;
  const cw = 26;
  const ch = 28;
  const max = Math.max(1, ...r.grid.flat());
  const inWindow = (h: number) => {
    const [a, b] = r.window;
    return a < b ? h >= a && h < b : h >= a || h < b;
  };
  const out: string[] = [];

  // Rotate the clock so the busiest window sits mid-grid instead of splitting at midnight.
  const startHour = r.samples ? (r.window[0] + 2 + 12) % 24 : 0;
  const col = (h: number) => (h - startHour + 24) % 24;
  if (r.samples) {
    const a = col(r.window[0]);
    out.push(
      `<rect x="${gx + a * cw}" y="${gy - 18}" width="${4 * cw}" height="${7 * ch + 8}" rx="8" fill="${t.accentSoft}" opacity="${t.mode === "dark" ? 0.55 : 0.7}"/>`,
    );
  }
  r.grid.forEach((row, d) => {
    const cy = gy + d * ch;
    out.push(doc.text(gx - 24, cy + 4.5, WEEKDAYS[d]!, { font: "regular", size: 15, fill: t.faint, anchor: "end" }));
    row.forEach((c, h) => {
      const cx = gx + col(h) * cw + cw / 2;
      if (!c) {
        out.push(`<circle cx="${r1(cx)}" cy="${cy}" r="1.3" fill="${t.contourMajor}"/>`);
        return;
      }
      const rad = 2.2 + 8.3 * Math.sqrt(c / max);
      out.push(
        `<circle cx="${r1(cx)}" cy="${cy}" r="${r1(rad)}" fill="${inWindow(h) ? t.accent : t.muted}" opacity="${inWindow(h) ? 1 : 0.6}"/>`,
      );
    });
  });
  for (let k = 0; k < 24; k += 3) {
    const h = (startHour + k) % 24;
    out.push(
      doc.text(gx + k * cw + cw / 2, gy + 7 * ch + 14, `${String(h).padStart(2, "0")}:00`, {
        font: "regular",
        size: 14,
        fill: h === 0 ? t.muted : t.faint,
        anchor: "middle",
        tnum: true,
      }),
    );
  }

  // Right column.
  const rx = gx + 24 * cw + 64;
  const rw = W - PAD - rx;
  out.push(
    doc.text(rx, 84, r.samples ? r.chronotype : "No sample yet", {
      font: "display",
      size: 52,
      fill: t.ink,
      tracking: -0.9,
    }),
  );
  let y = 122;
  for (const l of wrap(r.sentence, "regular", 18, rw, 3)) {
    out.push(doc.text(rx, y, l, { font: "regular", size: 18, fill: t.muted }));
    y += 25;
  }
  const months = r.monthly;
  if (months.length) {
    const mMax = Math.max(1, ...months.map((m) => m.commits));
    const bw = rw / months.length;
    const base = H - 52;
    const top = Math.max(y + 22, base - 70);
    months.forEach((m, i) => {
      const bh = Math.max(2, ((base - top) * m.commits) / mMax);
      const bx = rx + i * bw;
      const last = i === months.length - 1;
      out.push(
        `<rect x="${r1(bx + 3)}" y="${r1(base - bh)}" width="${r1(bw - 6)}" height="${r1(bh)}" rx="2" fill="${last ? t.accent : t.contourMajor}"/>`,
      );
      out.push(
        doc.text(bx + bw / 2, base + 20, MONTHS[+m.month.slice(5, 7) - 1]!.charAt(0), {
          font: "regular",
          size: 14,
          fill: t.faint,
          anchor: "middle",
        }),
      );
    });
    const peakM = months.reduce((a, b) => (b.commits > a.commits ? b : a));
    out.push(
      doc.text(
        rx,
        H - 16,
        `Public commits per month, peak ${fmt(peakM.commits)} in ${MONTHS[+peakM.month.slice(5, 7) - 1]} ${peakM.month.slice(0, 4)}`,
        {
          font: "regular",
          size: 14,
          fill: t.faint,
          tnum: true,
        },
      ),
    );
  }
  out.push(
    doc.text(
      gx - 24 - measure("Mon", "regular", 15),
      H - 16,
      `${fmt(r.samples)} commits sampled over 12 months, in each commit's own time zone`,
      { font: "regular", size: 14, fill: t.faint },
    ),
  );
  return doc.render(out.join(""));
}

function textOn(bg: string): string {
  return contrast(bg, "#ffffff") >= contrast(bg, "#0b141c") ? "#ffffff" : "#0b141c";
}

const OTHER = "Other";

function topParts(parts: LangShare[], keep: Set<string>, t: Theme): LangShare[] {
  const kept = parts.filter((p) => keep.has(p.name));
  const rest = parts.filter((p) => !keep.has(p.name));
  const other = rest.reduce((s, p) => s + p.share, 0);
  return other > 0.001 ? [...kept, { name: OTHER, color: t.faint, bytes: 0, share: other }] : kept;
}

/** Language strata: one layer per year of repositories, newest on top, width by volume of code. */
export function strata(p: Profile, t: Theme): string {
  const layers = [...p.strata].reverse().slice(0, 8);
  const rowH = 44;
  const top = 112;
  const H = top + layers.length * rowH + 40;
  const doc = new Doc(W, H, t, `Languages ${p.displayName} writes, by year`);
  const keep = new Set(p.languages.slice(0, 7).map((l) => l.name));
  const color = new Map(p.languages.map((l) => [l.name, l.color]));
  const out: string[] = [];

  // Legend: overall share of each language.
  let lx = PAD;
  let ly = 56;
  for (const l of topParts(p.languages, keep, t)) {
    const label = l.name;
    const share = `${l.share < 0.01 ? "<1" : Math.round(l.share * 100)}%`;
    const w = 20 + measure(label, "medium", 17) + 7 + measure(share, "regular", 17) + 30;
    if (lx + w > W - PAD) {
      lx = PAD;
      ly += 30;
    }
    out.push(
      `<rect x="${lx}" y="${ly - 12}" width="12" height="12" rx="3" fill="${l.name === OTHER ? t.faint : color.get(l.name)}"/>`,
      doc.text(lx + 20, ly, label, { font: "medium", size: 17, fill: t.ink }),
      doc.text(lx + 20 + measure(label, "medium", 17) + 7, ly, share, {
        font: "regular",
        size: 17,
        fill: t.muted,
        tnum: true,
      }),
    );
    lx += w;
  }

  const bx = PAD + 78;
  const bwMax = W - PAD - 110 - bx;
  const maxBytes = Math.max(1, ...layers.map((l) => l.bytes));
  const rand = rng(`${p.login}:strata`);
  const yTop = Math.max(top, ly + 34);
  layers.forEach((layer, i) => {
    const y = yTop + i * rowH;
    const h = rowH - 10;
    const width = bwMax * Math.max(0.1, Math.sqrt(layer.bytes / maxBytes));
    // A slightly uneven top and bottom edge: sediment, not a progress bar.
    const wave = (yy: number, amp: number) => {
      const ph = rand() * 6;
      const pts: string[] = [];
      const steps = Math.max(2, Math.round(width / 36));
      for (let k = 0; k <= steps; k++) {
        const xx = bx + (k / steps) * width;
        pts.push(`${r1(xx)} ${r1(yy + Math.sin(xx / 47 + ph) * amp)}`);
      }
      return pts;
    };
    const topEdge = wave(y, 1.6);
    const bottomEdge = wave(y + h, 1.6).reverse();
    doc.def(`<clipPath id="s${i}"><path d="M${topEdge.join("L")}L${bottomEdge.join("L")}Z"/></clipPath>`);
    let sx = bx;
    const segs: string[] = [];
    for (const part of topParts(layer.parts, keep, t)) {
      const sw = width * part.share;
      if (sw < 0.5) continue;
      const fill = part.name === OTHER ? t.contourMajor : (color.get(part.name) ?? t.faint);
      segs.push(`<rect x="${r1(sx)}" y="${y - 3}" width="${r1(sw + 0.6)}" height="${h + 6}" fill="${fill}"/>`);
      const label = part.name === OTHER ? "" : part.name;
      if (label && measure(label, "medium", 14) + 18 < sw) {
        segs.push(
          doc.text(sx + 9, y + h / 2 + 5, label, { font: "medium", size: 14, fill: textOn(fill), opacity: 0.92 }),
        );
      }
      sx += sw;
    }
    out.push(
      doc.text(PAD, y + h / 2 + 7, String(layer.year), {
        font: "text",
        size: 20,
        fill: i === 0 ? t.ink : t.muted,
        tnum: true,
      }),
      `<g clip-path="url(#s${i})">${segs.join("")}</g>`,
      doc.text(W - PAD, y + h / 2 + 6, `${layer.repos} ${layer.repos === 1 ? "repo" : "repos"}`, {
        font: "regular",
        size: 16,
        fill: t.faint,
        anchor: "end",
        tnum: true,
      }),
    );
  });
  out.push(
    doc.text(
      PAD,
      H - 18,
      "Each layer is the code in repositories created that year. Width grows with the amount of code.",
      { font: "regular", size: 14, fill: t.faint },
    ),
  );
  return doc.render(out.join(""));
}

/** Projects owned by others where the person's pull requests were merged. */
export function upstream(p: Profile, t: Theme, avatars: Map<string, string>): string {
  const rows = p.upstream.projects.slice(0, 8);
  const rowH = 54;
  const H = 104 + rows.length * rowH + 56;
  const doc = new Doc(W, H, t, `Where ${p.displayName} contributes upstream`);
  const u = p.upstream;
  const out: string[] = [];
  const head = `${fmt(u.merged)} pull requests merged in ${u.projects.length} ${u.projects.length === 1 ? "project" : "projects"} owned by others${u.open ? `, ${u.open} still open` : ""}.`;
  out.push(
    doc.text(PAD, 62, ellipsize(head, "text", 26, W - PAD * 2), {
      font: "text",
      size: 26,
      fill: t.ink,
      tracking: -0.2,
    }),
  );

  const dotX = 700;
  const maxDots = Math.floor((W - PAD - 110 - dotX) / 14);
  rows.forEach((proj, i) => {
    const y = 104 + i * rowH;
    const cy = y + rowH / 2;
    out.push(`<line x1="${PAD}" y1="${y}" x2="${W - PAD}" y2="${y}" stroke="${t.rule}" stroke-width="1"/>`);
    const av = avatars.get(proj.ownerAvatar);
    const clip = `a${i}`;
    if (av) {
      doc.def(`<clipPath id="${clip}"><circle cx="${PAD + 14}" cy="${cy}" r="14"/></clipPath>`);
      out.push(
        `<image href="${av}" x="${PAD}" y="${cy - 14}" width="28" height="28" clip-path="url(#${clip})"/>`,
        `<circle cx="${PAD + 14}" cy="${cy}" r="14" fill="none" stroke="${t.rule}"/>`,
      );
    } else {
      out.push(`<circle cx="${PAD + 14}" cy="${cy}" r="14" fill="${t.contour}"/>`);
    }
    const [owner, name] = proj.repo.split("/") as [string, string];
    const ownerTxt = `${owner}/`;
    const ow = measure(ownerTxt, "regular", 20);
    out.push(
      doc.text(PAD + 46, cy + 7, ownerTxt, { font: "regular", size: 20, fill: t.muted }),
      doc.text(
        PAD + 46 + ow,
        cy + 7,
        ellipsize(name, "semibold", 20, dotX - 24 - measure(sinceLabel(proj), "regular", 15) - 24 - (PAD + 46 + ow)),
        {
          font: "semibold",
          size: 20,
          fill: t.ink,
        },
      ),
      doc.text(dotX - 24, cy + 6, sinceLabel(proj), { font: "regular", size: 15, fill: t.faint, anchor: "end" }),
    );
    const total = proj.merged + proj.open;
    for (let k = 0; k < Math.min(total, maxDots); k++) {
      const x = dotX + k * 14;
      out.push(
        k < proj.merged
          ? `<rect x="${x}" y="${cy - 5}" width="10" height="10" rx="2.5" fill="${t.accent}"/>`
          : `<rect x="${x + 0.75}" y="${cy - 4.25}" width="8.5" height="8.5" rx="2" fill="none" stroke="${t.accent}" stroke-width="1.5"/>`,
      );
    }
    if (total > maxDots)
      out.push(
        doc.text(dotX + maxDots * 14 + 4, cy + 5, `+${total - maxDots}`, { font: "medium", size: 13, fill: t.muted }),
      );
    out.push(
      doc.text(W - PAD, cy + 6, `★ ${fmt(proj.stars)}`, {
        font: "regular",
        size: 16,
        fill: t.muted,
        anchor: "end",
        tnum: true,
      }),
    );
  });
  const ly = 104 + rows.length * rowH;
  out.push(
    `<line x1="${PAD}" y1="${ly}" x2="${W - PAD}" y2="${ly}" stroke="${t.rule}" stroke-width="1"/>`,
    `<rect x="${PAD}" y="${H - 29}" width="10" height="10" rx="2.5" fill="${t.accent}"/>`,
    doc.text(PAD + 16, H - 20, "merged", { font: "regular", size: 14, fill: t.faint }),
    `<rect x="${PAD + 82.75}" y="${H - 28.25}" width="8.5" height="8.5" rx="2" fill="none" stroke="${t.accent}" stroke-width="1.5"/>`,
    doc.text(PAD + 98, H - 20, "open", { font: "regular", size: 14, fill: t.faint }),
    doc.text(W - PAD, H - 20, "Stars are the project's, not the contributor's.", {
      font: "regular",
      size: 14,
      fill: t.faint,
      anchor: "end",
    }),
  );
  return doc.render(out.join(""));
}

function sinceLabel(p: UpstreamProject): string {
  const a = new Date(p.firstAt);
  const b = new Date(p.lastAt);
  const fa = `${MONTHS[a.getUTCMonth()]} ${a.getUTCFullYear()}`;
  const fb = `${MONTHS[b.getUTCMonth()]} ${b.getUTCFullYear()}`;
  return fa === fb ? fa : `${fa} to ${fb}`;
}

export const CARD_W = 580;
export const CARD_H = 180;

/** One project card. Its corner carries a small contour fingerprint drawn from the repo name. */
export function card(repo: Repo, t: Theme): string {
  const doc = new Doc(CARD_W, CARD_H, t, `${repo.nameWithOwner}: ${repo.description ?? ""}`);
  const rand = rng(repo.nameWithOwner);
  const peaks = Array.from({ length: 4 }, () => ({
    x: 380 + rand() * 200,
    y: rand() * CARD_H,
    s: 30 + rand() * 40,
    h: 0.5 + rand(),
  }));
  const cell = 6;
  const field = normalize(
    makeField(Math.ceil(CARD_W / cell) + 1, Math.ceil(CARD_H / cell) + 1, cell, (x, y) =>
      peaks.reduce((v, pk) => v + pk.h * Math.exp(-((x - pk.x) ** 2 + (y - pk.y) ** 2) / (2 * pk.s ** 2)), 0),
    ),
  );
  const lines = contours(field, [0.2, 0.32, 0.44, 0.56, 0.68, 0.8, 0.92], 10);
  doc.def(
    `<linearGradient id="fv" x1="0" x2="1"><stop offset="0.45" stop-color="${t.bg}" stop-opacity="1"/><stop offset="0.85" stop-color="${t.bg}" stop-opacity="0.2"/></linearGradient>` +
      `<clipPath id="cc"><rect x="1" y="1" width="${CARD_W - 2}" height="${CARD_H - 2}" rx="13"/></clipPath>`,
  );
  const fp = lines
    .map((c) => `<path d="${c.d}" fill="none" stroke="${c.index >= 5 ? t.contourMajor : t.contour}" stroke-width="1"/>`)
    .join("");

  const out: string[] = [];
  out.push(`<g clip-path="url(#cc)">${fp}<rect width="${CARD_W}" height="${CARD_H}" fill="url(#fv)"/></g>`);
  out.push(
    doc.text(30, 54, ellipsize(repo.name, "text", 29, CARD_W - 60), {
      font: "text",
      size: 29,
      fill: t.ink,
      tracking: -0.3,
    }),
  );
  let y = 88;
  for (const l of wrap(repo.description ?? "", "regular", 18, CARD_W - 90, 2)) {
    out.push(doc.text(30, y, l, { font: "regular", size: 18, fill: t.muted }));
    y += 25;
  }
  let fx = 30;
  const fy = CARD_H - 24;
  if (repo.primaryLanguage) {
    out.push(`<circle cx="${fx + 6}" cy="${fy - 5.5}" r="6" fill="${repo.primaryLanguage.color ?? t.faint}"/>`);
    out.push(doc.text(fx + 19, fy, repo.primaryLanguage.name, { font: "medium", size: 16, fill: t.muted }));
    fx += 19 + measure(repo.primaryLanguage.name, "medium", 16) + 24;
  }
  if (repo.stars > 0) {
    const s = `★ ${fmt(repo.stars)}`;
    out.push(doc.text(fx, fy, s, { font: "medium", size: 16, fill: t.muted, tnum: true }));
    fx += measure(s, "medium", 16) + 24;
  }
  if (repo.latestRelease) {
    out.push(
      doc.text(fx, fy, ellipsize(repo.latestRelease.tag, "medium", 16, 160), {
        font: "medium",
        size: 16,
        fill: t.muted,
      }),
    );
  }
  return doc.render(out.join(""));
}
