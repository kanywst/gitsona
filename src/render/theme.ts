export type Mode = "dark" | "light";

export interface Theme {
  mode: Mode;
  bg: string;
  ink: string;
  muted: string;
  faint: string;
  contour: string;
  contourMajor: string;
  rule: string;
  accent: string;
  accentSoft: string;
}

/**
 * Survey-map palette: a cool slate night chart and a pale sage day chart. The accent is the person's
 * own top language colour, pulled into a lightness band that stays readable on either ground.
 */
export function theme(mode: Mode, accentHex: string): Theme {
  const [h, s] = hexToHsl(accentHex);
  // Grey language colours (C, Markdown) stay grey instead of picking up a hue they never had.
  const sat = s < 0.08 ? 0 : Math.min(Math.max(s, 0.35), 0.78);
  if (mode === "dark") {
    return {
      mode,
      bg: "#0d1620",
      ink: "#e3ebee",
      muted: "#93a3ac",
      faint: "#5d6e79",
      contour: "#1d2c38",
      contourMajor: "#2c4050",
      rule: "#1f2f3c",
      accent: readable(h, sat, 0.62, "#0d1620", +1),
      accentSoft: hslToHex(h, sat * 0.6, 0.3),
    };
  }
  return {
    mode,
    bg: "#f1f5f2",
    ink: "#12202a",
    muted: "#4f5f68",
    faint: "#8a989f",
    contour: "#d2dcd6",
    contourMajor: "#adbdb5",
    rule: "#d9e2dd",
    accent: readable(h, sat, 0.36, "#f1f5f2", -1),
    accentSoft: hslToHex(h, sat * 0.5, 0.85),
  };
}

/** Walks lightness away from the ground until the accent clears 3.2:1 (WCAG non-text contrast, with margin). */
function readable(h: number, s: number, l: number, bg: string, dir: 1 | -1): string {
  let light = l;
  let hex = hslToHex(h, s, light);
  while (contrast(hex, bg) < 3.2 && light > 0.05 && light < 0.95) {
    light += dir * 0.01;
    hex = hslToHex(h, s, light);
  }
  return hex;
}

export function hexToHsl(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1]!, 16) : 0x5fb3a1;
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  return [h, s, l];
}

export function hslToHex(h: number, s: number, l: number): string {
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const c = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** WCAG relative-luminance contrast ratio. */
export function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
