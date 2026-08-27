/**
 * Two things a rater sees that must not lie: the score attached to a candidate,
 * and the reason a score is missing.
 */
import { describe, expect, it } from "vitest";
import { countsNow, explainWarnings, scoresFor, CURRENT_STIMULUS , countsForMetric } from "../corpus";

describe("scoresFor", () => {
  // A score belongs to (candidate, the reference the pair shows), not to the
  // candidate. Reading it off the candidate gives the reference it was
  // generated for, which in a cross-record pair is a different solid — that bug
  // made 99 of 181 exported rows disagree with the screen.
  const corpus: any = {
    candidates: [{ id: "c1", ref_id: "rA" }, { id: "c2", ref_id: "rB" }],
    evaluations: [
      { candidate_id: "c1", ref_id: "rA", v1_iou: 0.11, metrics: { q_l: 0.5 } },
      { candidate_id: "c1", ref_id: "rB", v1_iou: 0.22, metrics: { q_l: 0.9 } },
    ],
  };
  const s = scoresFor(corpus);

  it("keys on the pair's reference, not the candidate's own", () => {
    expect(s.value("c1", "rA", "q_l")).toBe(0.5);
    expect(s.value("c1", "rB", "q_l")).toBe(0.9);
  });

  it("reads v1_iou from beside `metrics`, not inside it", () => {
    expect(s.value("c1", "rA", "v1_iou")).toBe(0.11);
  });

  it("returns null rather than guessing when there is no evaluation", () => {
    expect(s.value("c2", "rA", "q_l")).toBeNull();
    expect(s.of("c2", "rA")).toBeNull();
  });

  it("returns null for a non-numeric metric instead of passing it through", () => {
    expect(s.value("c1", "rA", "warnings")).toBeNull();
  });
});

describe("countsNow", () => {
  it("counts a verdict cast against the current stimulus", () => {
    expect(countsNow({ stimulus: CURRENT_STIMULUS })).toBe(true);
  });
  it("does not count one cast against an older set of pictures", () => {
    expect(countsNow({ stimulus: "per-shape-normalised-v0" })).toBe(false);
    expect(countsNow({})).toBe(false);
  });
  it("honours an explicit equivalence flag", () => {
    expect(countsNow({ stimulus: "old", stimulus_equivalent: true })).toBe(true);
  });
});

describe("explainWarnings", () => {
  const TOPO = "topology_unavailable: shell mesh is not watertight: some edge is not in exactly two triangles";
  const BUDGET = "no level reached validity within the budget; the budget may be too small for L1";
  const IOU = "global_iou_unavailable: the Boolean returned an empty intersection for solids that overlap";

  it("drops the budget line when topology is the cause of it", () => {
    // Q_L contains T, so the moment topology is N/A no level can report a value
    // and the budget sentence fires unconditionally. Over the corpus it appeared
    // on 72 rows and was a real budget miss on exactly one.
    const out = explainWarnings([TOPO, BUDGET]);
    expect(out).toHaveLength(1);
    expect(out[0].text).toMatch(/Topology could not be measured/);
  });

  it("keeps the budget line when it stands on its own", () => {
    const out = explainWarnings([BUDGET]);
    expect(out).toHaveLength(1);
    expect(out[0].text).toMatch(/ran out of time/);
  });

  it("translates the jargon but keeps the original for us", () => {
    const [w] = explainWarnings([IOU]);
    expect(w.text).toMatch(/Overlap could not be measured/);
    expect(w.raw).toBe(IOU);
  });

  it("passes an unrecognised warning through rather than swallowing it", () => {
    const [w] = explainWarnings(["something_new: a thing we have not seen"]);
    expect(w.text).toBe("something_new: a thing we have not seen");
  });

  it("does not repeat a message when two warnings map to it", () => {
    expect(explainWarnings([IOU, IOU])).toHaveLength(1);
  });

  it("handles nothing at all", () => {
    expect(explainWarnings()).toEqual([]);
    expect(explainWarnings(null)).toEqual([]);
    expect(explainWarnings([])).toEqual([]);
  });
});

/**
 * A verdict survives a re-render; a number computed from the pixels does not.
 * Pairing the two was measured putting silhouette IoU below chance, so the
 * distinction is enforced rather than remembered.
 */
describe("countsForMetric", () => {
  const equiv = { stimulus: "per-shape-normalised-v0", stimulus_equivalent: true };
  const current = { stimulus: CURRENT_STIMULUS };
  const stale = { stimulus: "harness-normalised", stimulus_equivalent: false };

  it("lets solid-derived metrics use an equivalence-flagged verdict", () => {
    for (const k of ["aligned_iou", "q_l", "topology", "face", "edge", "bspace_min"]) {
      expect(countsForMetric(k, equiv)).toBe(true);
    }
  });

  it("refuses an equivalence-flagged verdict for every picture-derived metric", () => {
    for (const k of ["sil_iou", "pix_fg", "depth_iou", "dino_cos",
                     "sam3_generic", "sam3_vlm"]) {
      expect(countsForMetric(k, equiv)).toBe(false);
    }
  });

  it("accepts the current stimulus for both kinds", () => {
    expect(countsForMetric("sil_iou", current)).toBe(true);
    expect(countsForMetric("aligned_iou", current)).toBe(true);
  });

  it("refuses a stale stimulus for a picture metric even without the flag", () => {
    expect(countsForMetric("pix_fg", stale)).toBe(false);
    expect(countsForMetric("aligned_iou", stale)).toBe(false);
  });
});
