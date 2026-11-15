import type { Day, ExternalPR, RawData, Repo } from "./collect.ts";
import { DOMAINS, domainById, domainVotes, tokens } from "./taxonomy.ts";

export interface LangShare {
  name: string;
  color: string;
  bytes: number;
  share: number;
}

export interface Trait {
  id: string;
  left: string;
  right: string;
  /** 0 = fully left, 1 = fully right. */
  value: number;
  evidence: string;
}

export interface UpstreamProject {
  repo: string;
  owner: string;
  ownerAvatar: string;
  merged: number;
  open: number;
  stars: number;
  firstAt: string;
  lastAt: string;
}

export interface Profile {
  login: string;
  displayName: string;
  bio: string | null;
  website: string | null;
  twitter: string | null;
  avatarUrl: string;
  joined: string;
  accent: string;
  headline: string;
  summary: string;
  domains: { id: string; label: string; share: number }[];
  languages: LangShare[];
  strata: { year: number; bytes: number; repos: number; parts: LangShare[] }[];
  lastYear: {
    days: Day[];
    total: number;
    activeDays: number;
    longestStreak: number;
    currentStreak: number;
    peak: Day;
    busiestWeekday: number;
  };
  lifetime: {
    contributions: number;
    commits: number;
    prs: number;
    reviews: number;
    issues: number;
    longestStreak: number;
  };
  traits: Trait[];
  rhythm: {
    /** grid[weekday 0=Mon][hour 0..23] commit counts in the author's local time. */
    grid: number[][];
    samples: number;
    peakHour: number;
    window: [number, number];
    chronotype: string;
    sentence: string;
    monthly: { month: string; commits: number }[];
  };
  upstream: {
    merged: number;
    open: number;
    projects: UpstreamProject[];
    recentMerged: ExternalPR[];
    orgsRun: { org: string; merged: number }[];
    issues: number;
  };
  landmarks: Repo[];
  recent: Repo[];
  totals: { stars: number; repos: number; releases: number; followers: number };
  generatedAt: string;
}

const DAY = 86_400_000;
const FALLBACK_COLOR = "#8b949e";
// Generic domains are everywhere (most repos are a CLI or a web page); they only lead when nothing else does.
const DOMAIN_DAMPING: Record<string, number> = { devtools: 0.45, web: 0.6, knowledge: 0.8 };

export function isRetired(r: Repo): boolean {
  const d = (r.description ?? "").toLowerCase();
  return (
    r.isArchived || /^\[(deprecated|merged into|moved|archived)/.test(d) || /^(moved to|pointer to|deprecated)/.test(d)
  );
}

export function analyze(raw: RawData, now = new Date(raw.fetchedAt)): Profile {
  const login = raw.user.login;
  const ownOrgs = new Set(raw.user.orgs.map((o) => o.toLowerCase()));
  const repos = raw.repos.filter((r) => !r.isFork && r.name.toLowerCase() !== login.toLowerCase());
  const live = repos.filter((r) => !isRetired(r));

  const languages = languageShares(repos);
  const domains = scoreDomains(live, now);
  const lastYear = lastYearStats(raw, now);
  const upstream = upstreamStats(raw.prs, ownOrgs, raw.externalIssues);
  const rhythm = rhythmStats(raw);
  const traits = buildTraits(raw, { languages, domains, lastYear, upstream, live, now });

  const accent = languages[0]?.color ?? "#5fb3a1";
  const headline = buildHeadline(domains);
  const summary = buildSummary(domains, languages, upstream);

  return {
    login,
    displayName: raw.user.name?.trim() || login,
    bio: raw.user.bio?.trim() || null,
    website: raw.user.websiteUrl,
    twitter: raw.user.twitter,
    avatarUrl: raw.user.avatarUrl,
    joined: raw.user.createdAt,
    accent,
    headline,
    summary,
    domains,
    languages,
    strata: strata(repos),
    lastYear,
    lifetime: lifetimeStats(raw),
    traits,
    rhythm,
    upstream,
    landmarks: pickLandmarks(raw, live, login),
    recent: live
      .filter((r) => r.pushedAt && now.getTime() - Date.parse(r.pushedAt) < 30 * DAY)
      .sort((a, b) => Date.parse(b.pushedAt!) - Date.parse(a.pushedAt!))
      .slice(0, 4),
    totals: {
      stars: repos.reduce((s, r) => s + r.stars, 0),
      repos: repos.length,
      releases: repos.reduce((s, r) => s + r.releases, 0),
      followers: raw.user.followers,
    },
    generatedAt: raw.fetchedAt,
  };
}

export function languageShares(repos: Repo[]): LangShare[] {
  const bytes = new Map<string, { color: string; bytes: number }>();
  for (const r of repos) {
    for (const l of r.languages) {
      const cur = bytes.get(l.name) ?? { color: l.color ?? FALLBACK_COLOR, bytes: 0 };
      cur.bytes += l.size;
      bytes.set(l.name, cur);
    }
  }
  const total = [...bytes.values()].reduce((s, v) => s + v.bytes, 0) || 1;
  return [...bytes.entries()]
    .map(([name, v]) => ({ name, color: v.color, bytes: v.bytes, share: v.bytes / total }))
    .sort((a, b) => b.bytes - a.bytes);
}

function scoreDomains(repos: Repo[], now: Date): { id: string; label: string; share: number }[] {
  const score = new Map<string, number>();
  for (const r of repos) {
    const votes = domainVotes(r.topics, tokens(`${r.name} ${r.description ?? ""}`));
    const sum = [...votes.values()].reduce((a, b) => a + b, 0);
    if (!sum) continue;
    const age = r.pushedAt ? (now.getTime() - Date.parse(r.pushedAt)) / DAY : 9999;
    const weight = (1 + Math.log2(1 + r.stars) * 0.5) * (age < 365 ? 1.5 : 1);
    for (const [id, v] of votes) {
      score.set(id, (score.get(id) ?? 0) + (v / sum) * weight * (DOMAIN_DAMPING[id] ?? 1));
    }
  }
  const total = [...score.values()].reduce((a, b) => a + b, 0) || 1;
  return [...score.entries()]
    .map(([id, s]) => ({ id, label: domainById(id).label, share: s / total }))
    .sort((a, b) => b.share - a.share);
}

function strata(repos: Repo[]): Profile["strata"] {
  const byYear = new Map<number, Repo[]>();
  for (const r of repos) {
    const y = new Date(r.createdAt).getUTCFullYear();
    byYear.set(y, [...(byYear.get(y) ?? []), r]);
  }
  return [...byYear.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([year, rs]) => {
      const parts = languageShares(rs);
      return { year, bytes: parts.reduce((s, p) => s + p.bytes, 0), repos: rs.length, parts };
    })
    .filter((s) => s.bytes > 0);
}

function allDays(raw: RawData): Day[] {
  const m = new Map<string, number>();
  for (const y of raw.years) for (const d of y.days) m.set(d.date, d.count);
  return [...m.entries()].map(([date, count]) => ({ date, count })).sort((a, b) => a.date.localeCompare(b.date));
}

function streaks(days: Day[]): { longest: number; current: number } {
  let longest = 0;
  let run = 0;
  for (const d of days) {
    run = d.count > 0 ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  // Today may still be empty without breaking the streak.
  let current = 0;
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i]!.count > 0) current++;
    else if (i === days.length - 1) continue;
    else break;
  }
  return { longest, current };
}

function lastYearStats(raw: RawData, now: Date): Profile["lastYear"] {
  const today = now.toISOString().slice(0, 10);
  const from = new Date(now.getTime() - 364 * DAY).toISOString().slice(0, 10);
  const days = allDays(raw).filter((d) => d.date >= from && d.date <= today);
  const { longest, current } = streaks(days);
  const wd = new Array(7).fill(0) as number[];
  for (const d of days) wd[(new Date(`${d.date}T00:00:00Z`).getUTCDay() + 6) % 7]! += d.count;
  const peak = days.reduce((p, d) => (d.count > p.count ? d : p), days[0] ?? { date: today, count: 0 });
  return {
    days,
    total: days.reduce((s, d) => s + d.count, 0),
    activeDays: days.filter((d) => d.count > 0).length,
    longestStreak: longest,
    currentStreak: current,
    peak,
    busiestWeekday: wd.indexOf(Math.max(...wd)),
  };
}

function lifetimeStats(raw: RawData): Profile["lifetime"] {
  const days = allDays(raw);
  return {
    contributions: days.reduce((s, d) => s + d.count, 0),
    commits: raw.years.reduce((s, y) => s + y.commits, 0),
    prs: raw.years.reduce((s, y) => s + y.pullRequests, 0),
    reviews: raw.years.reduce((s, y) => s + y.reviews, 0),
    issues: raw.years.reduce((s, y) => s + y.issues, 0),
    longestStreak: streaks(days).longest,
  };
}

function upstreamStats(prs: ExternalPR[], ownOrgs: Set<string>, issues: number): Profile["upstream"] {
  const external = prs.filter((p) => !ownOrgs.has(p.owner.toLowerCase()));
  const byRepo = new Map<string, UpstreamProject>();
  for (const p of external) {
    if (p.state === "CLOSED") continue;
    const cur = byRepo.get(p.repo) ?? {
      repo: p.repo,
      owner: p.owner,
      ownerAvatar: p.ownerAvatar,
      merged: 0,
      open: 0,
      stars: p.repoStars,
      firstAt: p.createdAt,
      lastAt: p.createdAt,
    };
    if (p.state === "MERGED") cur.merged++;
    else cur.open++;
    if (p.createdAt < cur.firstAt) cur.firstAt = p.createdAt;
    if (p.createdAt > cur.lastAt) cur.lastAt = p.createdAt;
    byRepo.set(p.repo, cur);
  }
  const orgs = new Map<string, number>();
  for (const p of prs) {
    if (ownOrgs.has(p.owner.toLowerCase()) && p.state === "MERGED") orgs.set(p.owner, (orgs.get(p.owner) ?? 0) + 1);
  }
  return {
    merged: external.filter((p) => p.state === "MERGED").length,
    open: external.filter((p) => p.state === "OPEN").length,
    projects: [...byRepo.values()].filter((p) => p.merged > 0).sort((a, b) => b.merged - a.merged || b.stars - a.stars),
    recentMerged: external
      .filter((p) => p.state === "MERGED" && p.mergedAt)
      .sort((a, b) => b.mergedAt!.localeCompare(a.mergedAt!)),
    orgsRun: [...orgs.entries()].map(([org, merged]) => ({ org, merged })).sort((a, b) => b.merged - a.merged),
    issues,
  };
}

/** Parses "2026-11-16T00:55:35.000+09:00" into local weekday/hour as the author saw them. */
export function localTime(iso: string): { weekday: number; hour: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):/.exec(iso);
  if (!m) return null;
  // A "Z" suffix means the offset was lost; the wall-clock fields are still the best we have.
  const date = new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!));
  return { weekday: (date.getUTCDay() + 6) % 7, hour: +m[4]! };
}

const fmtHour = (h: number) => `${String(((h % 24) + 24) % 24).padStart(2, "0")}:00`;

function rhythmStats(raw: RawData): Profile["rhythm"] {
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0) as number[]);
  const hours = new Array(24).fill(0) as number[];
  let samples = 0;
  for (const c of raw.commitTimes) {
    const t = localTime(c.date);
    if (!t) continue;
    grid[t.weekday]![t.hour]!++;
    hours[t.hour]!++;
    samples++;
  }
  // Busiest 4-hour window, wrapping past midnight.
  let best = 0;
  let bestStart = 0;
  for (let s = 0; s < 24; s++) {
    let v = 0;
    for (let k = 0; k < 4; k++) v += hours[(s + k) % 24]!;
    if (v > best) {
      best = v;
      bestStart = s;
    }
  }
  const peakHour = hours.indexOf(Math.max(...hours));
  const mid = (bestStart + 2) % 24;
  const chronotype =
    mid >= 22 || mid < 4
      ? "Night owl"
      : mid < 9
        ? "Early riser"
        : mid < 13
          ? "Morning worker"
          : mid < 18
            ? "Daytime worker"
            : "Evening worker";
  const share = samples ? Math.round((best / samples) * 100) : 0;
  const sentence = samples
    ? `${share}% of sampled commits land between ${fmtHour(bestStart)} and ${fmtHour(bestStart + 4)}, local time.`
    : "No public commits to sample yet.";
  return {
    grid,
    samples,
    peakHour,
    window: [bestStart, (bestStart + 4) % 24],
    chronotype,
    sentence,
    monthly: raw.monthlyCommits,
  };
}

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const pct = (v: number) => `${Math.round(v * 100)}%`;

function buildTraits(
  raw: RawData,
  ctx: {
    languages: LangShare[];
    domains: Profile["domains"];
    lastYear: Profile["lastYear"];
    upstream: Profile["upstream"];
    live: Repo[];
    now: Date;
  },
): Trait[] {
  const { languages, domains, lastYear, upstream, live, now } = ctx;
  const traits: Trait[] = [];

  // Upstream: merged PRs in projects the person doesn't own, on a log scale.
  const projects = upstream.projects.length;
  traits.push({
    id: "upstream",
    left: "Own repos",
    right: "Upstream",
    value: clamp((Math.log10(1 + upstream.merged) / 2) * 0.6 + Math.min(projects / 15, 1) * 0.4),
    evidence:
      upstream.merged > 0
        ? `${upstream.merged} merged PRs across ${projects} ${projects === 1 ? "project" : "projects"} owned by others`
        : "No merged PRs in projects owned by others yet",
  });

  // Breadth: how many languages it takes to cover 80% of the code, plus how spread the domains are.
  let acc = 0;
  let l80 = 0;
  for (const l of languages) {
    if (acc >= 0.8) break;
    acc += l.share;
    l80++;
  }
  const entropy =
    domains.length > 1 ? -domains.reduce((s, d) => s + d.share * Math.log(d.share), 0) / Math.log(domains.length) : 0;
  const topDomain = domains[0];
  traits.push({
    id: "breadth",
    left: "Specialist",
    right: "Generalist",
    value: clamp(clamp((l80 - 1) / 5) * 0.5 + entropy * 0.5),
    evidence: `${l80} ${l80 === 1 ? "language covers" : "languages cover"} 80% of the code${topDomain ? `; ${pct(topDomain.share)} of the work is ${topDomain.label}` : ""}`,
  });

  // Cadence: active days and how even the weeks are.
  const ratio = lastYear.days.length ? lastYear.activeDays / lastYear.days.length : 0;
  const weeks: number[] = [];
  for (let i = 0; i < lastYear.days.length; i += 7) {
    weeks.push(lastYear.days.slice(i, i + 7).reduce((s, d) => s + d.count, 0));
  }
  const mean = weeks.reduce((a, b) => a + b, 0) / (weeks.length || 1);
  const sd = Math.sqrt(weeks.reduce((s, w) => s + (w - mean) ** 2, 0) / (weeks.length || 1));
  const cv = mean ? sd / mean : 2;
  traits.push({
    id: "cadence",
    left: "In bursts",
    right: "Every day",
    value: clamp(ratio * 0.7 + (1 - Math.min(cv, 2) / 2) * 0.3),
    evidence: `Active on ${lastYear.activeDays} of the last ${lastYear.days.length} days; longest run ${lastYear.longestStreak} days`,
  });

  // Focus: many new repositories, or commits concentrated in a few.
  const newRepos = live.filter((r) => now.getTime() - Date.parse(r.createdAt) < 365 * DAY).length;
  const thisYear = raw.years.filter((y) => y.year >= now.getUTCFullYear() - 1).flatMap((y) => y.commitsByRepo);
  const perRepo = new Map<string, number>();
  for (const c of thisYear) perRepo.set(c.repo, (perRepo.get(c.repo) ?? 0) + c.count);
  const counts = [...perRepo.values()].sort((a, b) => b - a);
  const totalCommits = counts.reduce((a, b) => a + b, 0) || 1;
  const top3 = counts.slice(0, 3).reduce((a, b) => a + b, 0) / totalCommits;
  traits.push({
    id: "focus",
    left: "Few projects",
    right: "Many projects",
    value: clamp((1 - top3) * 0.6 + Math.min(newRepos / 20, 1) * 0.4),
    evidence: `${newRepos} new public ${newRepos === 1 ? "repository" : "repositories"} this year; the top 3 take ${pct(top3)} of commits`,
  });

  return traits;
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** Specific domains first: "developer tools" or "web" only name someone when nothing else does. */
function characteristic(domains: Profile["domains"]): Profile["domains"] {
  const specific = domains.filter((d) => !(d.id in DOMAIN_DAMPING));
  return specific.length >= 2 ? specific : domains;
}

export function buildHeadline(domains: Profile["domains"]): string {
  const top = characteristic(domains)
    .filter((d, i) => i === 0 || d.share >= 0.08)
    .slice(0, 3)
    .map((d) => d.label);
  if (!top.length) return "Software on GitHub";
  const s = joinList(top);
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function buildSummary(
  domains: Profile["domains"],
  languages: LangShare[],
  upstream: Profile["upstream"],
): string {
  const nouns = characteristic(domains)
    .slice(0, 2)
    .map((d) => domainById(d.id).noun);
  const langs = languages
    .filter((l, i) => i === 0 || l.share >= 0.1)
    .slice(0, 3)
    .map((l) => l.name);
  let s = nouns.length ? `Builds ${joinList(nouns)}` : "Builds software";
  if (langs.length) s += ` in ${joinList(langs)}`;
  const named = upstream.projects.slice(0, 2).map((p) => p.repo.split("/")[1]!);
  if (upstream.merged >= 3 && named.length) s += `, and lands fixes upstream in ${joinList(named)}`;
  return `${s}.`;
}

function pickLandmarks(raw: RawData, live: Repo[], login: string): Repo[] {
  const pinned = raw.pinned.filter(
    (r) => r.name.toLowerCase() !== login.toLowerCase() && !isRetired(r) && !r.isPrivate,
  );
  const chosen = [...pinned];
  const seen = new Set(chosen.map((r) => r.nameWithOwner));
  const rest = live
    .filter((r) => !seen.has(r.nameWithOwner) && !r.isPrivate && r.description)
    .sort((a, b) => b.stars - a.stars || Date.parse(b.pushedAt ?? "0") - Date.parse(a.pushedAt ?? "0"));
  for (const r of rest) {
    if (chosen.length >= 6) break;
    chosen.push(r);
  }
  return chosen.slice(0, 6);
}

export { DOMAINS };
