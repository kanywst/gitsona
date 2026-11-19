import { type GitHub, GitHubError } from "./github.ts";

export interface Lang {
  name: string;
  color: string | null;
}

export interface Repo {
  name: string;
  nameWithOwner: string;
  owner: string;
  description: string | null;
  url: string;
  homepageUrl: string | null;
  stars: number;
  forks: number;
  isArchived: boolean;
  isPrivate: boolean;
  isFork: boolean;
  createdAt: string;
  pushedAt: string | null;
  primaryLanguage: Lang | null;
  languages: { name: string; color: string | null; size: number }[];
  topics: string[];
  releases: number;
  latestRelease: { tag: string; publishedAt: string | null } | null;
}

export interface Day {
  date: string;
  count: number;
}

export interface YearContrib {
  year: number;
  commits: number;
  pullRequests: number;
  issues: number;
  reviews: number;
  restricted: number;
  days: Day[];
  commitsByRepo: { repo: string; owner: string; isPrivate: boolean; count: number }[];
}

export interface ExternalPR {
  title: string;
  url: string;
  state: "OPEN" | "CLOSED" | "MERGED";
  createdAt: string;
  mergedAt: string | null;
  repo: string;
  owner: string;
  ownerAvatar: string;
  repoStars: number;
  repoLanguage: Lang | null;
}

export interface CommitTime {
  /** Author date as written by git, including the author's UTC offset. */
  date: string;
}

export interface RawData {
  fetchedAt: string;
  user: {
    login: string;
    name: string | null;
    bio: string | null;
    websiteUrl: string | null;
    twitter: string | null;
    avatarUrl: string;
    createdAt: string;
    followers: number;
    following: number;
    orgs: string[];
  };
  repos: Repo[];
  pinned: Repo[];
  years: YearContrib[];
  prs: ExternalPR[];
  prTotals: { authored: number; external: number; externalMerged: number };
  /** True when PR search stopped at its 1,000-result cap, so the counts above are lower bounds. */
  prsTruncated?: boolean;
  externalIssues: number;
  commitTimes: CommitTime[];
  /** Public commits on default branches per calendar month, last 12 months (commit search). */
  monthlyCommits: { month: string; commits: number }[];
}

const REPO_FIELDS = `
  name nameWithOwner description url homepageUrl stargazerCount forkCount
  isArchived isPrivate isFork createdAt pushedAt
  owner { login }
  primaryLanguage { name color }
  languages(first: 12, orderBy: { field: SIZE, direction: DESC }) { edges { size node { name color } } }
  repositoryTopics(first: 15) { nodes { topic { name } } }
  releases(first: 1, orderBy: { field: CREATED_AT, direction: DESC }) { totalCount nodes { tagName publishedAt } }
`;

interface GqlRepo {
  name: string;
  nameWithOwner: string;
  description: string | null;
  url: string;
  homepageUrl: string | null;
  stargazerCount: number;
  forkCount: number;
  isArchived: boolean;
  isPrivate: boolean;
  isFork: boolean;
  createdAt: string;
  pushedAt: string | null;
  owner: { login: string };
  primaryLanguage: Lang | null;
  languages: { edges: { size: number; node: Lang }[] };
  repositoryTopics: { nodes: { topic: { name: string } }[] };
  releases: { totalCount: number; nodes: { tagName: string; publishedAt: string | null }[] };
}

function toRepo(r: GqlRepo): Repo {
  const rel = r.releases.nodes[0];
  return {
    name: r.name,
    nameWithOwner: r.nameWithOwner,
    owner: r.owner.login,
    description: r.description,
    url: r.url,
    homepageUrl: r.homepageUrl || null,
    stars: r.stargazerCount,
    forks: r.forkCount,
    isArchived: r.isArchived,
    isPrivate: r.isPrivate,
    isFork: r.isFork,
    createdAt: r.createdAt,
    pushedAt: r.pushedAt,
    primaryLanguage: r.primaryLanguage,
    languages: r.languages.edges.map((e) => ({ name: e.node.name, color: e.node.color, size: e.size })),
    topics: r.repositoryTopics.nodes.map((n) => n.topic.name),
    releases: r.releases.totalCount,
    latestRelease: rel ? { tag: rel.tagName, publishedAt: rel.publishedAt } : null,
  };
}

export interface CollectOptions {
  includePrivate: boolean;
  log: (msg: string) => void;
}

export async function collect(gh: GitHub, login: string, opts: CollectOptions): Promise<RawData> {
  const { log } = opts;

  log("profile");
  const profile = await gh.graphql<{
    user: {
      login: string;
      name: string | null;
      bio: string | null;
      websiteUrl: string | null;
      twitterUsername: string | null;
      avatarUrl: string;
      createdAt: string;
      followers: { totalCount: number };
      following: { totalCount: number };
      organizations: { nodes: { login: string }[] };
      pinnedItems: { nodes: GqlRepo[] };
      contributionsCollection: { contributionYears: number[] };
    } | null;
  }>(
    `query($login: String!) {
      user(login: $login) {
        login name bio websiteUrl twitterUsername avatarUrl createdAt
        followers { totalCount } following { totalCount }
        organizations(first: 100) { nodes { login } }
        pinnedItems(first: 6, types: REPOSITORY) { nodes { ... on Repository { ${REPO_FIELDS} } } }
        contributionsCollection { contributionYears }
      }
    }`,
    { login },
  );
  const u = profile.user;
  if (!u) throw new GitHubError(`GitHub user "${login}" was not found.`);

  // Independent queries run together; the search API calls inside each stay sequential or pooled.
  log("repositories, contribution calendar, pull requests and commit times");
  const [repos, years, { prs, authored, truncated }, externalIssues, { times, monthly }] = await Promise.all([
    collectRepos(gh, u.login, opts.includePrivate),
    collectYears(gh, u.login, u.contributionsCollection.contributionYears),
    collectPRs(gh, u.login),
    searchCount(gh, `author:${u.login} is:issue -user:${u.login}`),
    collectCommitTimes(gh, u.login),
  ]);

  return {
    fetchedAt: new Date().toISOString(),
    user: {
      login: u.login,
      name: u.name,
      bio: u.bio,
      websiteUrl: u.websiteUrl,
      twitter: u.twitterUsername,
      avatarUrl: u.avatarUrl,
      createdAt: u.createdAt,
      followers: u.followers.totalCount,
      following: u.following.totalCount,
      orgs: u.organizations.nodes.map((o) => o.login),
    },
    repos,
    pinned: u.pinnedItems.nodes.filter((r) => r?.name).map(toRepo),
    years,
    prs,
    prTotals: {
      authored,
      external: prs.length,
      externalMerged: prs.filter((p) => p.state === "MERGED").length,
    },
    prsTruncated: truncated,
    externalIssues,
    commitTimes: times,
    monthlyCommits: monthly,
  };
}

async function collectRepos(gh: GitHub, login: string, includePrivate: boolean): Promise<Repo[]> {
  const repos: Repo[] = [];
  let after: string | null = null;
  for (;;) {
    const page: {
      user: { repositories: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: GqlRepo[] } };
    } = await gh.graphql(
      `query($login: String!, $after: String, $privacy: RepositoryPrivacy) {
        user(login: $login) {
          repositories(first: 100, after: $after, ownerAffiliations: OWNER, isFork: false, privacy: $privacy,
                       orderBy: { field: PUSHED_AT, direction: DESC }) {
            pageInfo { hasNextPage endCursor }
            nodes { ${REPO_FIELDS} }
          }
        }
      }`,
      { login, after, privacy: includePrivate ? null : "PUBLIC" },
    );
    repos.push(...page.user.repositories.nodes.map(toRepo));
    if (!page.user.repositories.pageInfo.hasNextPage) break;
    after = page.user.repositories.pageInfo.endCursor;
  }

  return repos;
}

async function collectYears(gh: GitHub, login: string, contributionYears: number[]): Promise<YearContrib[]> {
  const now = new Date();
  const out: YearContrib[] = [];
  const yearsSorted = [...contributionYears].sort((a, b) => a - b);
  // A few years per request keeps each response well under GitHub's node limits.
  for (let i = 0; i < yearsSorted.length; i += 3) {
    const chunk = yearsSorted.slice(i, i + 3);
    const fields = chunk
      .map((y) => {
        const from = `${y}-01-01T00:00:00Z`;
        const to = y === now.getUTCFullYear() ? now.toISOString() : `${y}-12-31T23:59:59Z`;
        return `y${y}: contributionsCollection(from: "${from}", to: "${to}") {
          totalCommitContributions totalPullRequestContributions totalIssueContributions
          totalPullRequestReviewContributions restrictedContributionsCount
          contributionCalendar { weeks { contributionDays { date contributionCount } } }
          commitContributionsByRepository(maxRepositories: 50) {
            repository { nameWithOwner isPrivate owner { login } }
            contributions { totalCount }
          }
        }`;
      })
      .join("\n");
    type Coll = {
      totalCommitContributions: number;
      totalPullRequestContributions: number;
      totalIssueContributions: number;
      totalPullRequestReviewContributions: number;
      restrictedContributionsCount: number;
      contributionCalendar: { weeks: { contributionDays: { date: string; contributionCount: number }[] }[] };
      commitContributionsByRepository: {
        repository: { nameWithOwner: string; isPrivate: boolean; owner: { login: string } };
        contributions: { totalCount: number };
      }[];
    };
    const data = await gh.graphql<{ user: Record<string, Coll> }>(
      `query($login: String!) { user(login: $login) { ${fields} } }`,
      { login },
    );
    for (const y of chunk) {
      const c = data.user[`y${y}`];
      if (!c) continue;
      out.push({
        year: y,
        commits: c.totalCommitContributions,
        pullRequests: c.totalPullRequestContributions,
        issues: c.totalIssueContributions,
        reviews: c.totalPullRequestReviewContributions,
        restricted: c.restrictedContributionsCount,
        days: c.contributionCalendar.weeks
          .flatMap((w) => w.contributionDays)
          .map((d) => ({ date: d.date, count: d.contributionCount })),
        commitsByRepo: c.commitContributionsByRepository.map((r) => ({
          repo: r.repository.nameWithOwner,
          owner: r.repository.owner.login,
          isPrivate: r.repository.isPrivate,
          count: r.contributions.totalCount,
        })),
      });
    }
  }
  return out;
}

async function searchCount(gh: GitHub, q: string): Promise<number> {
  const d = await gh.graphql<{ search: { issueCount: number } }>(
    `query($q: String!) { search(query: $q, type: ISSUE, first: 1) { issueCount } }`,
    { q },
  );
  return d.search.issueCount;
}

async function collectPRs(
  gh: GitHub,
  login: string,
): Promise<{ prs: ExternalPR[]; authored: number; truncated: boolean }> {
  const authored = await searchCount(gh, `author:${login} is:pr`);
  const prs: ExternalPR[] = [];
  let after: string | null = null;
  let truncated = false;
  for (let page = 0; page < 10; page++) {
    const d: {
      search: {
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
        nodes: (
          | {
              title: string;
              url: string;
              state: "OPEN" | "CLOSED" | "MERGED";
              createdAt: string;
              mergedAt: string | null;
              repository: {
                nameWithOwner: string;
                stargazerCount: number;
                isPrivate: boolean;
                owner: { login: string; avatarUrl: string };
                primaryLanguage: Lang | null;
              };
            }
          | Record<string, never>
        )[];
      };
    } = await gh.graphql(
      `query($q: String!, $after: String) {
        search(query: $q, type: ISSUE, first: 100, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { ... on PullRequest {
            title url state createdAt mergedAt
            repository { nameWithOwner stargazerCount isPrivate owner { login avatarUrl(size: 64) } primaryLanguage { name color } }
          } }
        }
      }`,
      { q: `author:${login} is:pr -user:${login} sort:created-desc`, after },
    );
    for (const n of d.search.nodes) {
      if (!("repository" in n) || n.repository.isPrivate) continue;
      prs.push({
        title: n.title,
        url: n.url,
        state: n.state,
        createdAt: n.createdAt,
        mergedAt: n.mergedAt,
        repo: n.repository.nameWithOwner,
        owner: n.repository.owner.login,
        ownerAvatar: n.repository.owner.avatarUrl,
        repoStars: n.repository.stargazerCount,
        repoLanguage: n.repository.primaryLanguage,
      });
    }
    if (!d.search.pageInfo.hasNextPage) break;
    // Search serves at most 10 pages; more results past the last one means the counts are lower bounds.
    if (page === 9) truncated = true;
    after = d.search.pageInfo.endCursor;
  }
  return { prs, authored, truncated };
}

async function collectCommitTimes(
  gh: GitHub,
  login: string,
): Promise<{ times: CommitTime[]; monthly: { month: string; commits: number }[] }> {
  // One page per calendar month for the last 12 months. A single newest-first query would hit
  // the 1000-result cap within days for a busy account and describe only the latest sprint.
  const now = new Date();
  const months = Array.from({ length: 12 }, (_, k) => {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (11 - k), 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
    return { start, range: `${start.toISOString().slice(0, 10)}..${end.toISOString().slice(0, 10)}` };
  });
  type Page = { total_count: number; items: { commit: { author: { date: string } | null } }[] };
  // Three at a time: the search API allows 30 requests a minute and punishes bursts.
  const pages = await pool(months, 3, async (m) => {
    const q = encodeURIComponent(`author:${login} author-date:${m.range}`);
    try {
      return await gh.rest<Page>(`/search/commits?q=${q}&sort=author-date&order=desc&per_page=100`);
    } catch {
      return null;
    }
  });
  if (pages.every((p) => p === null)) throw new GitHubError("GitHub commit search failed for every month.");
  const times: CommitTime[] = [];
  const monthly: { month: string; commits: number }[] = [];
  pages.forEach((d, k) => {
    if (!d) return;
    monthly.push({ month: months[k]!.start.toISOString().slice(0, 7), commits: d.total_count });
    for (const it of d.items) if (it.commit.author?.date) times.push({ date: it.commit.author.date });
  });
  return { times, monthly };
}

/** Maps with at most `n` calls in flight, keeping input order. */
async function pool<T, R>(items: T[], n: number, f: (t: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await f(items[i]!);
      }
    }),
  );
  return out;
}
