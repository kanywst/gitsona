#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { analyze } from "./analyze.ts";
import { collect, type RawData } from "./collect.ts";
import { GitHub, GitHubError, resolveToken } from "./github.ts";
import { previewHtml } from "./preview.ts";
import { commitAndPush, createProfileRepo, ensureCheckout, hasGh, repoExists, writeWorkflow } from "./publish.ts";
import { mergeReadme, readmeBlock } from "./readme.ts";
import {
  DEFAULT_TYPESET,
  fontFileProblem,
  TYPESET_NAMES,
  TYPESETS,
  type Typeset,
  type TypesetName,
  withDisplayFont,
} from "./render/fonts.ts";
import { fetchAvatars, render, SECTIONS, type Section } from "./render/index.ts";

const VERSION = "0.1.0";
const ASSETS = "gitsona";

const HELP = `gitsona ${VERSION}
Draw a GitHub profile README from what you actually do on GitHub.

Usage
  gitsona [user] [options]

  With no user, gitsona draws the account your token belongs to.

Output
  -o, --out <dir>        Where to write README.md and ${ASSETS}/ (default: ./<user>,
                         or . when run inside a <user>/<user> checkout)
      --replace          Overwrite README.md instead of updating the gitsona block
      --preview          Also write gitsona-preview.html to check the result locally
      --json             Also write ${ASSETS}/profile.json with the derived numbers

Content
      --sections <list>  Comma-separated, in order: ${SECTIONS.join(",")}
      --font <name>      Typeface preset: pixel (default), geist, mono, grotesk, rounded, retro
      --display-font <file>
                         Use your own .ttf/.otf for the name and headlines
      --accent <hex>     Accent colour (default: your top language's colour)
      --no-motion        Skip the contour draw-in animation
      --no-cursor        Leave out the accent "_" after your name
      --no-bio           Leave your GitHub bio out of the README
      --private          Count private repositories in language and topic stats
                         (their names are never drawn)

Publishing
      --action           Add a weekly GitHub Actions workflow that redraws the profile
      --push             Create <user>/<user> if needed, commit and push (asks first)
  -y, --yes              Don't ask before creating the repository or pushing

Data
      --token <token>    GitHub token (default: GITHUB_TOKEN, GH_TOKEN, or \`gh auth token\`)
      --save-raw <file>  Save the raw GitHub data for re-rendering
      --from-raw <file>  Render from saved raw data without calling GitHub

  -q, --quiet            Only print errors
  -h, --help             Show this help
  -v, --version          Show the version
`;

const color = process.stdout.isTTY && !process.env.NO_COLOR;
const c = {
  dim: (s: string) => (color ? `\x1b[2m${s}\x1b[22m` : s),
  bold: (s: string) => (color ? `\x1b[1m${s}\x1b[22m` : s),
  accent: (s: string) => (color ? `\x1b[36m${s}\x1b[39m` : s),
  red: (s: string) => (color ? `\x1b[31m${s}\x1b[39m` : s),
};

async function confirm(question: string, yes: boolean): Promise<boolean> {
  if (yes) return true;
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(`${question} ${c.dim("[y/N]")} `)).trim().toLowerCase();
  rl.close();
  return a === "y" || a === "yes";
}

async function main(argv: string[]): Promise<number> {
  const { values: v, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      out: { type: "string", short: "o" },
      replace: { type: "boolean" },
      preview: { type: "boolean" },
      json: { type: "boolean" },
      sections: { type: "string" },
      accent: { type: "string" },
      font: { type: "string" },
      "display-font": { type: "string" },
      "no-motion": { type: "boolean" },
      "no-cursor": { type: "boolean" },
      "no-bio": { type: "boolean" },
      private: { type: "boolean" },
      action: { type: "boolean" },
      push: { type: "boolean" },
      yes: { type: "boolean", short: "y" },
      token: { type: "string" },
      "save-raw": { type: "string" },
      "from-raw": { type: "string" },
      quiet: { type: "boolean", short: "q" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  if (v.help) {
    process.stdout.write(HELP);
    return 0;
  }
  if (v.version) {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }
  if (positionals.length > 1) throw new UsageError("Give at most one GitHub user.");
  const log = (s: string) => {
    if (!v.quiet) process.stderr.write(`${s}\n`);
  };

  const sections = parseSections(v.sections);
  if (v.accent && !/^#[0-9a-f]{6}$/i.test(v.accent)) throw new UsageError("--accent takes a hex colour like #3fb950.");
  const fontName = (v.font ?? DEFAULT_TYPESET) as TypesetName;
  if (!TYPESET_NAMES.includes(fontName)) {
    throw new UsageError(`Unknown --font ${v.font}. Choose from ${TYPESET_NAMES.join(", ")}.`);
  }
  let typeset: Typeset = TYPESETS[fontName];
  if (v["display-font"]) {
    const file = resolve(v["display-font"]);
    const problem = fontFileProblem(file);
    if (problem) throw new UsageError(`--display-font: ${v["display-font"]} ${problem}.`);
    typeset = withDisplayFont(typeset, file);
  }

  let raw: RawData;
  let gh: GitHub | null = null;
  if (v["from-raw"]) {
    raw = JSON.parse(readFileSync(v["from-raw"], "utf8")) as RawData;
  } else {
    gh = new GitHub(resolveToken(v.token), (m) => log(c.dim(`  ${m}`)));
    const login = positionals[0] ?? (await viewer(gh));
    log(`${c.accent("gitsona")} reading ${c.bold(`@${login}`)} from GitHub`);
    raw = await collect(gh, login, { includePrivate: !!v.private, log: (m) => log(c.dim(`  ${m}`)) });
    if (v["save-raw"]) writeFileSync(v["save-raw"], JSON.stringify(raw));
  }
  const login = raw.user.login;
  const profile = analyze(raw);

  const out = resolve(v.out ?? defaultOut(login));
  if (v.push) {
    if (!hasGh()) throw new UsageError("--push needs the GitHub CLI (gh). Install it, or push the files yourself.");
    const slug = `${login}/${login}`;
    if (!repoExists(slug)) {
      if (!(await confirm(`Create the public repository ${c.bold(slug)}?`, !!v.yes))) {
        log("Not creating it. Nothing was pushed.");
        return 1;
      }
      createProfileRepo(login);
      log(`  created ${slug}`);
    }
    ensureCheckout(login, out);
  }

  const avatars = gh ? await fetchAvatars(gh, profile) : new Map<string, string>();
  const rendered = render(
    profile,
    { sections, motion: !v["no-motion"], cursor: !v["no-cursor"], accent: v.accent, typeset },
    avatars,
  );

  mkdirSync(join(out, ASSETS), { recursive: true });
  for (const [name, svg] of rendered.files) writeFileSync(join(out, ASSETS, name), svg);
  // Images from an earlier run that this run no longer draws (a project that left the cards).
  // Only gitsona's own file names are touched, so anything else kept in the folder stays.
  const stale = readdirSync(join(out, ASSETS)).filter(
    (f) => /^[a-z0-9._-]+-(dark|light)\.svg$/.test(f) && !rendered.files.has(f),
  );
  for (const f of stale) rmSync(join(out, ASSETS, f));
  const readmePath = join(out, "README.md");
  const block = readmeBlock(profile, {
    sections: rendered.sections,
    dir: `./${ASSETS}`,
    bio: v["no-bio"] ? null : undefined,
  });
  const existing = existsSync(readmePath) ? readFileSync(readmePath, "utf8") : null;
  writeFileSync(readmePath, mergeReadme(existing, block, !!v.replace));
  if (v.json) {
    const { lastYear, ...rest } = profile;
    writeFileSync(
      join(out, ASSETS, "profile.json"),
      JSON.stringify({ ...rest, lastYear: { ...lastYear, days: undefined } }, null, 2),
    );
  }
  if (v.preview) writeFileSync(join(out, "gitsona-preview.html"), previewHtml(profile, block));
  if (v.action) writeWorkflow(out);

  const rel = relative(process.cwd(), out) || ".";
  const bytes = [...rendered.files.values()].reduce((s, f) => s + f.length, 0);
  log("");
  log(`  ${c.bold(profile.displayName)}  ${c.dim(profile.headline)}`);
  log(`  ${c.dim(profile.summary)}`);
  log("");
  log(
    `  wrote ${c.accent(join(rel, "README.md"))} and ${rendered.files.size} images in ${c.accent(join(rel, ASSETS))} ${c.dim(`(${Math.round(bytes / 1024)} KB)`)}`,
  );
  if (v.preview) log(`  preview ${c.accent(join(rel, "gitsona-preview.html"))}`);
  if (v.action) log(`  workflow ${c.accent(join(rel, ".github/workflows/gitsona.yml"))}`);
  if (existing && !existing.includes("<!-- gitsona:start -->") && !v.replace) {
    log(c.dim("  Your existing README text was kept below the gitsona block."));
  }

  if (v.push) {
    if (!(await confirm(`Commit and push to ${c.bold(`${login}/${login}`)}?`, !!v.yes))) {
      log("Not pushed. The files are ready in the output directory.");
      return 0;
    }
    const paths = ["README.md", ASSETS, ...(v.action ? [".github/workflows/gitsona.yml"] : [])];
    const r = commitAndPush(out, paths, "docs: draw profile with gitsona");
    log(r === "pushed" ? `  pushed: https://github.com/${login}` : "  nothing changed, nothing pushed");
  } else if (!v.quiet) {
    log("");
    log(c.dim(`  Next: push ${rel} to github.com/${login}/${login}, or run again with --push.`));
  }
  return 0;
}

function parseSections(s: string | undefined): Section[] {
  if (!s) return [...SECTIONS];
  const list = s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const bad = list.filter((x) => !(SECTIONS as readonly string[]).includes(x));
  if (bad.length) throw new UsageError(`Unknown section: ${bad.join(", ")}. Choose from ${SECTIONS.join(", ")}.`);
  return list as Section[];
}

function defaultOut(login: string): string {
  const here = basename(process.cwd()).toLowerCase();
  return here === login.toLowerCase() ? "." : login;
}

async function viewer(gh: GitHub): Promise<string> {
  const d = await gh.graphql<{ viewer: { login: string } }>(`query { viewer { login } }`);
  return d.viewer.login;
}

class UsageError extends Error {}

main(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (e: unknown) => {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`${c.red("gitsona:")} ${msg}\n`);
    if (e instanceof UsageError) process.stderr.write(c.dim("Run gitsona --help for usage.\n"));
    else if (!(e instanceof GitHubError) && process.env.GITSONA_DEBUG && e instanceof Error)
      process.stderr.write(`${e.stack}\n`);
    process.exit(e instanceof UsageError ? 2 : 1);
  },
);
