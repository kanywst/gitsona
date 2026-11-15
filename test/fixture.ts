import type { Day, ExternalPR, RawData, Repo } from "../src/collect.ts";

/** A small, fully synthetic account. Deterministic so snapshots of numbers stay stable. */
export const NOW = "2026-11-15T12:00:00.000Z";

function repo(name: string, over: Partial<Repo> = {}): Repo {
  return {
    name,
    nameWithOwner: `ada/${name}`,
    owner: "ada",
    description: `${name} description`,
    url: `https://github.com/ada/${name}`,
    homepageUrl: null,
    stars: 0,
    forks: 0,
    isArchived: false,
    isPrivate: false,
    isFork: false,
    createdAt: "2026-02-01T00:00:00Z",
    pushedAt: "2026-11-01T00:00:00Z",
    primaryLanguage: { name: "Go", color: "#00ADD8" },
    languages: [{ name: "Go", color: "#00ADD8", size: 10_000 }],
    topics: [],
    releases: 0,
    latestRelease: null,
    ...over,
  };
}

function days(): Day[] {
  const out: Day[] = [];
  const end = new Date(NOW);
  for (let i = 400; i >= 0; i--) {
    const d = new Date(end.getTime() - i * 86_400_000);
    // Busy on weekends, quiet on Mondays, a gap in the middle of the year.
    const wd = d.getUTCDay();
    const gap = i > 180 && i < 200;
    out.push({ date: d.toISOString().slice(0, 10), count: gap ? 0 : wd === 1 ? 0 : wd === 0 || wd === 6 ? 9 : 3 });
  }
  return out;
}

function pr(repoName: string, owner: string, state: ExternalPR["state"], createdAt: string): ExternalPR {
  return {
    title: `Fix [edge] case in ${repoName}`,
    url: `https://github.com/${owner}/${repoName}/pull/1`,
    state,
    createdAt,
    mergedAt: state === "MERGED" ? createdAt : null,
    repo: `${owner}/${repoName}`,
    owner,
    ownerAvatar: `https://avatars.githubusercontent.com/${owner}`,
    repoStars: 5000,
    repoLanguage: { name: "Go", color: "#00ADD8" },
  };
}

export function fixture(): RawData {
  const all = days();
  const byYear = new Map<number, Day[]>();
  for (const d of all) {
    const y = +d.date.slice(0, 4);
    byYear.set(y, [...(byYear.get(y) ?? []), d]);
  }
  return {
    fetchedAt: NOW,
    user: {
      login: "ada",
      name: "Ada Example",
      bio: "Builds <things> with *care*",
      websiteUrl: "https://example.dev/",
      twitter: null,
      avatarUrl: "https://avatars.githubusercontent.com/u/1",
      createdAt: "2019-03-04T00:00:00Z",
      followers: 12,
      following: 3,
      orgs: ["ada-labs"],
    },
    repos: [
      repo("authz-engine", {
        stars: 120,
        topics: ["authorization", "opa", "rego", "policy-engine"],
        description: "Policy engine for <fast> authorization",
        releases: 4,
        latestRelease: { tag: "v1.2.0", publishedAt: "2026-10-01T00:00:00Z" },
      }),
      repo("oidc-kit", { stars: 30, topics: ["oidc", "oauth2", "identity"], createdAt: "2025-05-01T00:00:00Z" }),
      repo("cli-thing", {
        topics: ["cli", "tui"],
        languages: [
          { name: "Rust", color: "#dea584", size: 6_000 },
          { name: "Shell", color: "#89e051", size: 500 },
        ],
        primaryLanguage: { name: "Rust", color: "#dea584" },
        createdAt: "2023-01-01T00:00:00Z",
      }),
      repo("old-tool", { description: "[Deprecated] moved elsewhere", topics: ["security"] }),
      repo("ada", { description: "My profile" }),
    ],
    pinned: [],
    years: [...byYear.entries()].map(([year, ds]) => ({
      year,
      commits: ds.reduce((s, d) => s + d.count, 0),
      pullRequests: 10,
      issues: 2,
      reviews: 1,
      restricted: 0,
      days: ds,
      commitsByRepo: [
        { repo: "ada/authz-engine", owner: "ada", isPrivate: false, count: 300 },
        { repo: "ada/oidc-kit", owner: "ada", isPrivate: false, count: 100 },
        { repo: "ada/cli-thing", owner: "ada", isPrivate: false, count: 50 },
      ],
    })),
    prs: [
      pr("dex", "dexidp", "MERGED", "2026-03-01T00:00:00Z"),
      pr("dex", "dexidp", "MERGED", "2026-06-01T00:00:00Z"),
      pr("dex", "dexidp", "OPEN", "2026-10-01T00:00:00Z"),
      pr("spire", "spiffe", "MERGED", "2026-04-01T00:00:00Z"),
      pr("spire", "spiffe", "MERGED", "2026-09-01T00:00:00Z"),
      pr("spire", "spiffe", "CLOSED", "2026-09-02T00:00:00Z"),
      pr("site", "ada-labs", "MERGED", "2026-05-01T00:00:00Z"),
    ],
    prTotals: { authored: 40, external: 7, externalMerged: 5 },
    externalIssues: 3,
    commitTimes: [
      ...Array.from({ length: 30 }, () => ({ date: "2026-10-10T23:15:00.000+09:00" })),
      ...Array.from({ length: 10 }, () => ({ date: "2026-10-11T00:30:00.000+09:00" })),
      ...Array.from({ length: 5 }, () => ({ date: "2026-10-12T14:00:00.000+09:00" })),
    ],
    monthlyCommits: Array.from({ length: 12 }, (_, i) => ({
      month: `2026-${String(i + 1).padStart(2, "0")}`,
      commits: 10 * (i + 1),
    })),
  };
}
