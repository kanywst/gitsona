import type { Profile } from "../analyze.ts";
import type { GitHub } from "../github.ts";
import { hero } from "./hero.ts";
import { card, rhythm, strata, traits, upstream } from "./panels.ts";
import { type Mode, theme } from "./theme.ts";

export const SECTIONS = ["hero", "traits", "rhythm", "projects", "strata", "upstream"] as const;
export type Section = (typeof SECTIONS)[number];

export interface RenderOptions {
  sections: Section[];
  motion: boolean;
  accent?: string;
}

export interface Rendered {
  /** Path relative to the assets dir → SVG source. */
  files: Map<string, string>;
  /** Sections that produced output (an empty upstream list renders nothing). */
  sections: Section[];
}

export const MODES: Mode[] = ["dark", "light"];

export async function fetchAvatars(gh: GitHub, p: Profile): Promise<Map<string, string>> {
  const urls = [...new Set(p.upstream.projects.slice(0, 8).map((x) => x.ownerAvatar))];
  const out = new Map<string, string>();
  await Promise.all(
    urls.map(async (u) => {
      const sized = u.includes("?") ? `${u}&s=64` : `${u}?s=64`;
      const img = await gh.bytes(sized);
      if (img) out.set(u, `data:${img.type.split(";")[0]};base64,${Buffer.from(img.data).toString("base64")}`);
    }),
  );
  return out;
}

export function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
}

export function render(p: Profile, opts: RenderOptions, avatars: Map<string, string>): Rendered {
  const files = new Map<string, string>();
  const done: Section[] = [];
  for (const mode of MODES) {
    const t = theme(mode, opts.accent ?? p.accent);
    for (const s of opts.sections) {
      switch (s) {
        case "hero":
          files.set(`hero-${mode}.svg`, hero(p, t, { motion: opts.motion }));
          break;
        case "traits":
          if (p.traits.length) files.set(`traits-${mode}.svg`, traits(p, t));
          break;
        case "rhythm":
          if (p.rhythm.samples) files.set(`rhythm-${mode}.svg`, rhythm(p, t));
          break;
        case "strata":
          if (p.strata.length) files.set(`strata-${mode}.svg`, strata(p, t));
          break;
        case "upstream":
          if (p.upstream.projects.length) files.set(`upstream-${mode}.svg`, upstream(p, t, avatars));
          break;
        case "projects":
          for (const r of p.landmarks) files.set(`project-${slug(r.name)}-${mode}.svg`, card(r, t));
          break;
      }
    }
  }
  for (const s of opts.sections) {
    const has = s === "projects" ? p.landmarks.length > 0 : [...files.keys()].some((k) => k.startsWith(`${s}-`));
    if (has) done.push(s);
  }
  return { files, sections: done };
}
