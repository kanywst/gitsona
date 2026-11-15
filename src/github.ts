import { execFileSync } from "node:child_process";

const API = "https://api.github.com";

export class GitHubError extends Error {}

export function resolveToken(explicit?: string): string {
  const fromEnv = explicit ?? process.env.GITSONA_TOKEN ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
  if (fromEnv) return fromEnv.trim();
  try {
    const t = execFileSync("gh", ["auth", "token"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (t) return t;
  } catch {
    /* gh not installed or not logged in */
  }
  throw new GitHubError(
    "No GitHub token found. Run `gh auth login`, or set GITHUB_TOKEN to a token with read:user scope.",
  );
}

export class GitHub {
  requests = 0;
  constructor(
    private token: string,
    private log: (msg: string) => void = () => {},
  ) {}

  private headers(): Record<string, string> {
    return {
      authorization: `bearer ${this.token}`,
      accept: "application/vnd.github+json",
      "user-agent": "gitsona",
      "x-github-api-version": "2022-11-28",
    };
  }

  async graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      this.requests++;
      const res = await fetch(`${API}/graphql`, {
        method: "POST",
        headers: { ...this.headers(), "content-type": "application/json" },
        body: JSON.stringify({ query, variables }),
      });
      if ((res.status === 502 || res.status === 503 || res.status === 504) && attempt < 3) {
        await sleep(1000 * 2 ** attempt);
        continue;
      }
      if (res.status === 401) throw new GitHubError("GitHub rejected the token (401). Check that it is valid.");
      const body = (await res.json()) as { data?: T; errors?: { message: string; type?: string }[] };
      if (body.errors?.length) {
        const msg = body.errors.map((e) => e.message).join("; ");
        if (body.data && body.errors.every((e) => e.type === "FORBIDDEN" || e.type === "NOT_FOUND")) {
          this.log(`partial GraphQL result: ${msg}`);
          return body.data;
        }
        throw new GitHubError(`GitHub GraphQL error: ${msg}`);
      }
      if (!res.ok || !body.data) throw new GitHubError(`GitHub GraphQL request failed with HTTP ${res.status}`);
      return body.data;
    }
  }

  async rest<T>(path: string): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      this.requests++;
      const res = await fetch(`${API}${path}`, { headers: this.headers() });
      if (res.status === 403 || res.status === 429) {
        const reset = Number(res.headers.get("x-ratelimit-reset") ?? 0) * 1000;
        const wait = Math.min(Math.max(reset - Date.now(), 2000), 65_000);
        if (attempt < 2) {
          this.log(`rate limited on ${path.split("?")[0]}, waiting ${Math.round(wait / 1000)}s`);
          await sleep(wait);
          continue;
        }
      }
      if (res.status === 422 || res.status === 404) throw new GitHubError(`GitHub returned ${res.status} for ${path}`);
      if (!res.ok) throw new GitHubError(`GitHub REST ${path} failed with HTTP ${res.status}`);
      return (await res.json()) as T;
    }
  }

  async bytes(url: string): Promise<{ data: Uint8Array; type: string } | null> {
    try {
      const res = await fetch(url, { headers: { "user-agent": "gitsona" } });
      if (!res.ok) return null;
      return { data: new Uint8Array(await res.arrayBuffer()), type: res.headers.get("content-type") ?? "image/png" };
    } catch {
      return null;
    }
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
