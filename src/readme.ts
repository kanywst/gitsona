import type { Profile } from "./analyze.ts";
import { fmtDate } from "./render/hero.ts";
import { type Section, slug } from "./render/index.ts";

export const START = "<!-- gitsona:start -->";
export const END = "<!-- gitsona:end -->";

/** Attribute-safe, and safe inside Markdown link text: brackets would end the link early. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/\[/g, "&#91;")
    .replace(/\]/g, "&#93;");
}

/** Markdown link text: brackets and backticks would break the link. */
function mdText(s: string): string {
  return s.replace(/([\\[\]`*_<>])/g, "\\$1");
}

function picture(dir: string, base: string, alt: string, width?: string): string {
  const w = width ? ` width="${width}"` : ` width="100%"`;
  return [
    `<picture>`,
    `  <source media="(prefers-color-scheme: dark)" srcset="${dir}/${base}-dark.svg">`,
    `  <img alt="${esc(alt)}" src="${dir}/${base}-light.svg"${w}>`,
    `</picture>`,
  ].join("\n");
}

export interface ReadmeOptions {
  sections: Section[];
  /** Assets directory relative to the README, without a trailing slash. */
  dir: string;
  /** Text to repeat under the hero; left out by default because the sidebar shows the bio. */
  bio?: string | null;
}

/** The generated block, markers included. */
export function readmeBlock(p: Profile, opts: ReadmeOptions): string {
  const { dir, sections } = opts;
  const out: string[] = [START, ""];
  const has = (s: Section) => sections.includes(s);

  if (has("hero")) {
    const badges = p.badges.map((b) => `${b.label}: ${b.fact}`).join(". ");
    out.push(picture(dir, "hero", `${p.displayName} (@${p.login}). ${p.headline}. ${p.summary} ${badges}.`), "");
  }

  // GitHub's sidebar already shows the bio, website and X handle, so only what it can't show goes here.
  const bio = opts.bio ?? null;
  if (bio) out.push(mdText(bio), "");
  const lines: string[] = [];
  if (p.recent.length) {
    const links = p.recent.slice(0, 3).map((r) => `[${mdText(r.name)}](${r.url})`);
    lines.push(`**Lately** ${links.join(" · ")}`);
  }
  const last = p.upstream.recentMerged[0];
  if (last && !has("upstream")) {
    lines.push(`**Last merged upstream** [${mdText(last.title)}](${last.url}) in \`${last.repo}\``);
  }
  // Two short lines read as one block; a trailing backslash is a hard line break in GFM.
  if (lines.length) out.push(lines.join("\\\n"), "");

  if (has("traits")) {
    out.push(`### Working style`, "", picture(dir, "traits", workingStyleAlt(p)), "");
  }
  if (has("rhythm")) {
    out.push(`### Rhythm`, "", picture(dir, "rhythm", `${p.rhythm.chronotype}. ${p.rhythm.sentence}`), "");
  }
  if (has("projects") && p.landmarks.length) {
    out.push(`### Projects`, "");
    out.push(
      p.landmarks
        .map(
          (r) =>
            // A Markdown link around a one-line <picture> keeps the card clickable without <a>.
            `[${picture(dir, `project-${slug(r.name)}`, `${r.name}: ${r.description ?? ""}`, "49%").replace(/\n\s*/g, "")}](${r.url})`,
        )
        .join("\n"),
      "",
    );
  }
  if (has("strata")) {
    const top = p.languages
      .slice(0, 5)
      .map((l) => `${l.name} ${Math.round(l.share * 100)}%`)
      .join(", ");
    out.push(`### Languages over time`, "", picture(dir, "strata", `Languages by share of code: ${top}.`), "");
  }
  if (has("upstream")) {
    out.push(`### Upstream`, "", picture(dir, "upstream", upstreamAlt(p)), "");
    const recent = p.upstream.recentMerged.slice(0, 5);
    if (recent.length) {
      out.push(
        "Recently merged:",
        "",
        ...recent.map((pr) => `- [${mdText(pr.title)}](${pr.url}) in \`${pr.repo}\`, ${fmtDate(pr.mergedAt!)}`),
        "",
      );
    }
  }

  out.push(
    `Drawn by [gitsona](https://github.com/kanywst/gitsona) from public GitHub activity on ${fmtDate(p.generatedAt)}.`,
    "",
    END,
  );
  return out.join("\n");
}

function workingStyleAlt(p: Profile): string {
  return p.traits
    .map((t) => `${t.value >= 0.5 ? t.right : t.left} (${t.left} to ${t.right}): ${t.evidence}`)
    .join(". ");
}

function upstreamAlt(p: Profile): string {
  const top = p.upstream.projects
    .slice(0, 5)
    .map((x) => `${x.repo} (${x.merged})`)
    .join(", ");
  return `${p.upstream.merged} pull requests merged in projects owned by others. Most in ${top}.`;
}

/**
 * Puts the block into an existing README. Hand-written text outside the markers is kept; a README
 * without markers keeps its content below the new block unless `replace` is set.
 */
export function mergeReadme(existing: string | null, block: string, replace = false): string {
  if (!existing || replace) return `${block}\n`;
  const s = existing.indexOf(START);
  const e = existing.indexOf(END);
  if (s >= 0 && e > s) return existing.slice(0, s) + block + existing.slice(e + END.length);
  return `${block}\n\n${existing.replace(/^\s+/, "")}`;
}
