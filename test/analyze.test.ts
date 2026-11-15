import { describe, expect, test } from "bun:test";
import { analyze, buildHeadline, isRetired, languageShares, localTime } from "../src/analyze.ts";
import { fixture } from "./fixture.ts";

describe("analyze", () => {
  const p = analyze(fixture());

  test("leaves the profile repository and retired repos out of the picture", () => {
    expect(p.landmarks.map((r) => r.name)).not.toContain("ada");
    expect(p.landmarks.map((r) => r.name)).not.toContain("old-tool");
  });

  test("leaves pinned repositories to GitHub's own Pinned section", () => {
    const raw = fixture();
    raw.pinned = [raw.repos[0]!];
    const names = analyze(raw).landmarks.map((r) => r.name);
    expect(names).not.toContain("authz-engine");
    expect(names).toContain("oidc-kit");
  });

  test("ranks specific domains ahead of generic ones", () => {
    expect(p.domains[0]?.id).toBe("authorization");
    expect(p.headline.toLowerCase()).toContain("authorization");
    expect(p.headline.toLowerCase()).not.toContain("developer tools");
  });

  test("counts upstream work only in projects the person does not own or belong to", () => {
    expect(p.upstream.merged).toBe(4);
    expect(p.upstream.open).toBe(1);
    expect(p.upstream.projects.map((x) => x.repo)).toEqual(["dexidp/dex", "spiffe/spire"]);
    expect(p.upstream.orgsRun).toEqual([{ org: "ada-labs", merged: 1 }]);
    expect(p.summary).toContain("dex and spire");
  });

  test("reads commit hours in the author's own time zone", () => {
    expect(p.rhythm.samples).toBe(45);
    expect(p.rhythm.peakHour).toBe(23);
    expect(p.rhythm.chronotype).toBe("Night owl");
    expect(p.rhythm.window[0]).toBeGreaterThanOrEqual(20);
  });

  test("keeps every trait on its 0..1 scale with evidence", () => {
    expect(p.traits).toHaveLength(4);
    for (const t of p.traits) {
      expect(t.value).toBeGreaterThanOrEqual(0);
      expect(t.value).toBeLessThanOrEqual(1);
      expect(t.evidence.length).toBeGreaterThan(10);
    }
  });

  test("computes the last year window and streaks from the calendar", () => {
    expect(p.lastYear.days).toHaveLength(365);
    expect(p.lastYear.longestStreak).toBe(6);
    expect(p.lastYear.peak.count).toBe(9);
    expect(p.lastYear.activeDays).toBeLessThan(365);
  });

  test("accent follows the top language", () => {
    expect(p.accent).toBe("#00ADD8");
  });
});

describe("privacy", () => {
  test("private repositories shape the numbers but never appear by name", () => {
    const raw = fixture();
    raw.repos.push({
      ...raw.repos[0]!,
      name: "secret-plan",
      nameWithOwner: "ada/secret-plan",
      description: "Do not show this",
      isPrivate: true,
      stars: 999,
    });
    const p = analyze(raw);
    const text = JSON.stringify({ l: p.landmarks, r: p.recent, h: p.headline, s: p.summary, u: p.upstream });
    expect(text).not.toContain("secret-plan");
    expect(text).not.toContain("Do not show this");
    expect(p.totals.repos).toBe(5);
  });
});

describe("helpers", () => {
  test("localTime keeps the wall clock from the ISO offset", () => {
    expect(localTime("2026-11-16T00:55:35.000+09:00")).toEqual({ weekday: 0, hour: 0 });
    expect(localTime("2026-11-15T23:59:00-08:00")).toEqual({ weekday: 6, hour: 23 });
    expect(localTime("nonsense")).toBeNull();
  });

  test("isRetired spots archived and pointer repositories", () => {
    const base = fixture().repos[0]!;
    expect(isRetired({ ...base, isArchived: true })).toBe(true);
    expect(isRetired({ ...base, description: "Moved to other/repo" })).toBe(true);
    expect(isRetired({ ...base, description: "[Merged into x] y" })).toBe(true);
    expect(isRetired(base)).toBe(false);
  });

  test("languageShares sums to one", () => {
    const shares = languageShares(fixture().repos);
    expect(shares.reduce((s, l) => s + l.share, 0)).toBeCloseTo(1, 6);
    expect(shares[0]?.name).toBe("Go");
  });

  test("buildHeadline falls back when there is nothing to say", () => {
    expect(buildHeadline([])).toBe("Software on GitHub");
  });
});
