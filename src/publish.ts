import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { END, START } from "./readme.ts";
import { VERSION } from "./version.ts";

/** Folder gitsona draws its images into, next to README.md. */
export const ASSETS = "gitsona";

/** Image names gitsona itself writes into ASSETS; anything else in the folder is someone else's. */
export const DRAWN = /^(hero|traits|rhythm|strata|upstream|project-[a-z0-9._-]+)-(dark|light)\.svg$/;

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
    "repo",
    "create",
    `${login}/${login}`,
    "--public",
    "--description",
    "Profile README, drawn by gitsona",
  ]);
  if (!r.ok) throw new Error(`gh repo create failed: ${r.out}`);
}

/** Clones the profile repo into dir when dir is not already a checkout of it. */
export function ensureCheckout(login: string, dir: string): void {
  if (existsSync(join(dir, ".git"))) return;
  // `gitsona --preview` then `gitsona --push` leaves an earlier draw in the default folder. It is
  // redrawn right after the clone, so it can be replaced, but only once the clone has worked.
  if (isEarlierDraw(dir)) {
    // Clone next to dir, then swap contents in. dir itself stays, since it may be the working directory.
    const tmp = mkdtempSync(join(dirname(dir), ".gitsona-clone-"));
    try {
      clone(login, tmp);
      for (const e of readdirSync(dir)) rmSync(join(dir, e), { recursive: true, force: true });
      for (const e of readdirSync(tmp)) renameSync(join(tmp, e), join(dir, e));
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
    return;
  }
  if (existsSync(dir) && readdirSync(dir).length > 0) {
    throw new Error(
      `${dir} exists and is not a git checkout. Pick an empty --out directory, or run gitsona inside your ${login}/${login} clone.`,
    );
  }
  clone(login, dir);
}

function clone(login: string, dir: string): void {
  const r = run("gh", ["repo", "clone", `${login}/${login}`, dir]);
  if (!r.ok) throw new Error(`gh repo clone failed: ${r.out}`);
}

/**
 * True when dir holds nothing but files a previous gitsona run wrote: a README.md with no text outside
 * the gitsona markers, drawn images, the preview page, profile.json and the workflow.
 */
export function isEarlierDraw(dir: string): boolean {
  try {
    return holdsOnlyADraw(dir);
  } catch {
    return false;
  }
}

function holdsOnlyADraw(dir: string): boolean {
  // lstat, so a symlink never counts as one of gitsona's files or folders.
  const isFile = (p: string) => lstatSync(p).isFile();
  const isDir = (p: string) => lstatSync(p).isDirectory();
  if (!existsSync(dir) || !isDir(dir)) return false;
  const top = readdirSync(dir);
  if (!top.length) return false;
  const files = new Set(["README.md", "gitsona-preview.html", ".DS_Store"]);
  const dirs = new Set([ASSETS, ".github"]);
  if (!top.every((e) => (files.has(e) && isFile(join(dir, e))) || (dirs.has(e) && isDir(join(dir, e))))) return false;
  if (top.includes("README.md")) {
    const text = readFileSync(join(dir, "README.md"), "utf8");
    const s = text.indexOf(START);
    const e = text.indexOf(END);
    if (s < 0 || e < s || (text.slice(0, s) + text.slice(e + END.length)).trim()) return false;
  }
  if (top.includes(ASSETS)) {
    const own = (n: string) => DRAWN.test(n) || n === "profile.json" || n === ".DS_Store";
    if (!readdirSync(join(dir, ASSETS)).every((n) => own(n) && isFile(join(dir, ASSETS, n)))) return false;
  }
  if (top.includes(".github")) {
    const gh = readdirSync(join(dir, ".github"));
    if (gh.length !== 1 || gh[0] !== "workflows" || !isDir(join(dir, ".github", "workflows"))) return false;
    const wf = readdirSync(join(dir, ".github", "workflows"));
    if (wf.length !== 1 || wf[0] !== "gitsona.yml" || !isFile(join(dir, ".github", "workflows", "gitsona.yml")))
      return false;
  }
  return true;
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

// Pinned to the release that wrote it, so a profile redraws with the same code each week
// instead of whatever is on main. Running gitsona --action again moves the pin.
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
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7
      - uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7
        with:
          node-version: 22
      - name: Redraw the profile
        run: npx -y gitsona@${VERSION} "\${{ github.repository_owner }}" --out . --quiet
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
