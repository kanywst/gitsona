import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

function run(cmd: string, args: string[], cwd?: string): { ok: boolean; out: string } {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  return { ok: r.status === 0, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

export function hasGh(): boolean {
  return run("gh", ["--version"]).ok;
}

export function repoExists(slug: string): boolean {
  return run("gh", ["repo", "view", slug, "--json", "name"]).ok;
}

export function createProfileRepo(login: string): void {
  const r = run("gh", [
    "repo", "create", `${login}/${login}`, "--public",
    "--description", "Profile README, drawn by gitsona",
  ]);
  if (!r.ok) throw new Error(`gh repo create failed: ${r.out}`);
}

/** Clones the profile repo into dir when dir is not already a checkout of it. */
export function ensureCheckout(login: string, dir: string): void {
  if (existsSync(join(dir, ".git"))) return;
  if (existsSync(dir) && execFileSync("ls", ["-A", dir], { encoding: "utf8" }).trim()) {
    throw new Error(`${dir} exists and is not a git checkout. Pick an empty --out directory, or run gitsona inside your ${login}/${login} clone.`);
  }
  const r = run("gh", ["repo", "clone", `${login}/${login}`, dir]);
  if (!r.ok) throw new Error(`gh repo clone failed: ${r.out}`);
}

export function commitAndPush(dir: string, paths: string[], message: string): "pushed" | "unchanged" {
  const add = run("git", ["add", "--", ...paths], dir);
  if (!add.ok) throw new Error(`git add failed: ${add.out}`);
  if (run("git", ["diff", "--cached", "--quiet"], dir).ok) return "unchanged";
  const c = run("git", ["commit", "-m", message], dir);
  if (!c.ok) throw new Error(`git commit failed: ${c.out}`);
  const p = run("git", ["push", "origin", "HEAD"], dir);
  if (!p.ok) throw new Error(`git push failed: ${p.out}`);
  return "pushed";
}

export const WORKFLOW = `name: gitsona

on:
  schedule:
    - cron: "23 3 * * 1"
  workflow_dispatch:

permissions:
  contents: write

concurrency:
  group: gitsona
  cancel-in-progress: true

jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - name: Redraw the profile
        run: npx -y github:kanywst/gitsona "\${{ github.repository_owner }}" --out . --quiet
        env:
          # The default token sees public activity. For private contribution counts, add a
          # fine-grained token with read access to your repos as the GITSONA_TOKEN secret.
          GITHUB_TOKEN: \${{ secrets.GITSONA_TOKEN || secrets.GITHUB_TOKEN }}
      - name: Commit when something changed
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add README.md gitsona
          if git diff --cached --quiet; then
            echo "No change."
          else
            git commit -m "docs: redraw profile with gitsona"
            git push
          fi
`;

export function writeWorkflow(dir: string): string {
  const wf = join(dir, ".github", "workflows");
  mkdirSync(wf, { recursive: true });
  const path = join(wf, "gitsona.yml");
  writeFileSync(path, WORKFLOW);
  return path;
}
