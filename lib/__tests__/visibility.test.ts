/**
 * Who sees the study's totals.
 *
 * Participant count and verdict count are the study's figures, not a rater's,
 * and are returned to administrators only. Tested at the response, because
 * the page is not what enforces it: a rater reads /api/stats, not the JSX.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const RATERS = ["alice@example.org", "bob@example.org", "carol@example.org"];
let who = RATERS[0];

vi.mock("@/lib/auth", async () => {
  const real = await vi.importActual<any>("@/lib/auth");
  return { ...real, raterFromRequest: async () => ({ id: "x", email: who }) };
});

const corpus = {
  refs: [{ id: "r1", family: "washer", image: "r1.png" }],
  candidates: [
    { id: "c1", ref_id: "r1", origin: "model", image: "c1.png" },
    { id: "c2", ref_id: "r1", origin: "model", image: "c2.png" },
  ],
  pairs: [{ id: "p1", ref_id: "r1", a: "c1", b: "c2", cohort: "x" }],
  evaluations: [
    { candidate_id: "c1", ref_id: "r1", metrics: { pix_fg: 0.9, iou24_norm: 0.8 } },
    { candidate_id: "c2", ref_id: "r1", metrics: { pix_fg: 0.4, iou24_norm: 0.2 } },
  ],
};
const judgments = RATERS.map((rater, i) => ({
  pair_id: "p1", rater, chosen_id: i === 2 ? "c2" : "c1", is_tie: false,
  left_id: "c1", right_id: "c2", confidence: 3, decision_ms: 1000 + i,
  stimulus: "harness-normalised-unclipped",
}));

vi.mock("@/lib/store", async () => {
  const real = await vi.importActual<any>("@/lib/store");
  return {
    ...real,
    backend: () => "local",
    loadCorpus: async () => corpus,
    allJudgments: async () => judgments,
  };
});

const req = (url = "http://x/api") => new Request(url, { headers: { cookie: "s=1" } });

beforeEach(() => { process.env.PREFERENCE_LAB_ADMINS = "carol@example.org"; });
afterEach(() => { delete process.env.PREFERENCE_LAB_ADMINS; who = RATERS[0]; });

describe("/api/stats", () => {
  it("returns no pooled figures to a rater", async () => {
    const { GET } = await import("@/app/api/stats/route");
    who = "alice@example.org";
    const d = await (await GET(req())).json();
    expect(d.is_admin).toBe(false);
    expect(d.all).toBeUndefined();
    // Own progress still there.
    expect(d.mine.judged).toBe(1);
    // The agreement table carries rates only: the counts under a rate are the
    // total by another name.
    for (const m of d.metric_agreement) {
      expect(m).not.toHaveProperty("agree");
      expect(m).not.toHaveProperty("usable");
    }
    expect(JSON.stringify(d)).not.toContain("bob@example.org");
  });

  it("returns them to an administrator", async () => {
    const { GET } = await import("@/app/api/stats/route");
    who = "carol@example.org";
    const d = await (await GET(req())).json();
    expect(d.is_admin).toBe(true);
    expect(d.all.judgments).toBe(3);
    expect(d.all.raters).toHaveLength(3);
    const pix = d.metric_agreement.find((m: any) => m.key === "pix_fg");
    expect(pix.usable).toBe(3);
    expect(pix.agree).toBe(2);
  });

  it("is nobody with the variable unset", async () => {
    const { GET } = await import("@/app/api/stats/route");
    delete process.env.PREFERENCE_LAB_ADMINS;
    who = "carol@example.org";
    const d = await (await GET(req())).json();
    expect(d.all).toBeUndefined();
  });
});

describe("/api/cases", () => {
  it("shows a rater their own verdicts only", async () => {
    const { GET } = await import("@/app/api/cases/route");
    who = "alice@example.org";
    const d = await (await GET(req())).json();
    expect(d.is_admin).toBe(false);
    expect(d.raters).toEqual([]);
    const row = d.rows.find((r: any) => r.pair_id === "p1");
    expect(row.judged).toBe(1);
    expect(row.verdicts.map((v: any) => v.rater)).toEqual(["alice@example.org"]);
    expect(JSON.stringify(d)).not.toContain("bob@example.org");
  });

  it("shows an administrator everyone's", async () => {
    const { GET } = await import("@/app/api/cases/route");
    who = "carol@example.org";
    const d = await (await GET(req())).json();
    const row = d.rows.find((r: any) => r.pair_id === "p1");
    expect(row.judged).toBe(3);
    expect(d.raters).toEqual(RATERS);
  });
});
