/**
 * Marching squares over a scalar grid, then segments joined into polylines and smoothed into paths.
 * Used for the hero terrain and the small fingerprints on project cards.
 */

export interface Field {
  cols: number;
  rows: number;
  /** Grid spacing in px. */
  cell: number;
  values: Float64Array;
}

type Pt = [number, number];

export function makeField(cols: number, rows: number, cell: number, f: (x: number, y: number) => number): Field {
  const values = new Float64Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) values[j * cols + i] = f(i * cell, j * cell);
  return { cols, rows, cell, values };
}

export function normalize(field: Field): Field {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of field.values) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi - lo || 1;
  const values = field.values.map((v) => (v - lo) / span);
  return { ...field, values };
}

/** Segments for one iso level. */
function segments(field: Field, level: number): [Pt, Pt][] {
  const { cols, rows, cell, values } = field;
  const out: [Pt, Pt][] = [];
  const v = (i: number, j: number) => values[j * cols + i]!;
  const lerp = (a: number, b: number) => (a === b ? 0.5 : (level - a) / (b - a));
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) {
      const tl = v(i, j);
      const tr = v(i + 1, j);
      const br = v(i + 1, j + 1);
      const bl = v(i, j + 1);
      const idx = (tl >= level ? 8 : 0) | (tr >= level ? 4 : 0) | (br >= level ? 2 : 0) | (bl >= level ? 1 : 0);
      if (idx === 0 || idx === 15) continue;
      const x = i * cell;
      const y = j * cell;
      const top: Pt = [x + lerp(tl, tr) * cell, y];
      const right: Pt = [x + cell, y + lerp(tr, br) * cell];
      const bottom: Pt = [x + lerp(bl, br) * cell, y + cell];
      const left: Pt = [x, y + lerp(tl, bl) * cell];
      const center = (tl + tr + br + bl) / 4;
      switch (idx) {
        case 1: case 14: out.push([left, bottom]); break;
        case 2: case 13: out.push([bottom, right]); break;
        case 3: case 12: out.push([left, right]); break;
        case 4: case 11: out.push([top, right]); break;
        case 6: case 9: out.push([top, bottom]); break;
        case 7: case 8: out.push([left, top]); break;
        case 5:
          if (center >= level) { out.push([left, top]); out.push([bottom, right]); }
          else { out.push([left, bottom]); out.push([top, right]); }
          break;
        case 10:
          if (center >= level) { out.push([top, right]); out.push([left, bottom]); }
          else { out.push([left, top]); out.push([bottom, right]); }
          break;
      }
    }
  }
  return out;
}

const key = (p: Pt) => `${Math.round(p[0] * 100)},${Math.round(p[1] * 100)}`;

/** Chains segments that share endpoints into polylines. */
function chain(segs: [Pt, Pt][]): Pt[][] {
  const byEnd = new Map<string, number[]>();
  segs.forEach((s, i) => {
    for (const p of s) {
      const k = key(p);
      const list = byEnd.get(k);
      if (list) list.push(i);
      else byEnd.set(k, [i]);
    }
  });
  const used = new Uint8Array(segs.length);
  const lines: Pt[][] = [];
  const nextFrom = (p: Pt): Pt | null => {
    for (const i of byEnd.get(key(p)) ?? []) {
      if (used[i]) continue;
      used[i] = 1;
      const [a, b] = segs[i]!;
      return key(a) === key(p) ? b : a;
    }
    return null;
  };
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    used[i] = 1;
    const line: Pt[] = [segs[i]![0], segs[i]![1]];
    for (let p = nextFrom(line[line.length - 1]!); p; p = nextFrom(line[line.length - 1]!)) line.push(p);
    for (let p = nextFrom(line[0]!); p; p = nextFrom(line[0]!)) line.unshift(p);
    lines.push(line);
  }
  return lines;
}

/** Catmull-Rom through the points, written as cubic Béziers. */
export function smoothPath(pts: Pt[], closed: boolean): string {
  if (pts.length < 2) return "";
  const p = closed ? pts.slice(0, -1) : pts;
  const n = p.length;
  const at = (i: number) => (closed ? p[(i + n) % n]! : p[Math.max(0, Math.min(n - 1, i))]!);
  const f = (v: number) => Math.round(v);
  let d = `M${f(p[0]![0])} ${f(p[0]![1])}`;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += `C${f(c1[0])} ${f(c1[1])} ${f(c2[0])} ${f(c2[1])} ${f(p2[0])} ${f(p2[1])}`;
  }
  return closed ? `${d}Z` : d;
}

export interface Contour {
  level: number;
  /** Index in the level list, for styling major lines. */
  index: number;
  d: string;
  length: number;
}

function polyLength(pts: Pt[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
  return l;
}

/** Thin points so the smoothing works on shape, not on grid noise. */
function decimate(pts: Pt[], minDist: number): Pt[] {
  if (pts.length < 4) return pts;
  const out: Pt[] = [pts[0]!];
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = out[out.length - 1]!;
    if (Math.hypot(pts[i]![0] - prev[0], pts[i]![1] - prev[1]) >= minDist) out.push(pts[i]!);
  }
  out.push(pts[pts.length - 1]!);
  return out;
}

export function contours(field: Field, levels: number[], minLength = 12): Contour[] {
  const out: Contour[] = [];
  levels.forEach((level, index) => {
    for (const line of chain(segments(field, level))) {
      const length = polyLength(line);
      if (length < minLength) continue;
      const first = line[0]!;
      const last = line[line.length - 1]!;
      const closed = key(first) === key(last);
      const pts = decimate(line, field.cell * 1.5);
      out.push({ level, index, d: smoothPath(pts, closed), length: Math.round(length) });
    }
  });
  return out;
}
