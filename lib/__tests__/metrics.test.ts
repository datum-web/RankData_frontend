import { describe, expect, it } from "vitest";
import { ANALYSIS_METRICS, ANALYSIS_ONLY, METRIC_ROWS } from "../types";

/**
 * The registry split is a study-integrity boundary, not a display preference.
 *
 * `METRIC_ROWS` is rendered beside the two pictures a rater is judging.
 * `ANALYSIS_ONLY` is everything still being chosen between. The down-select
 * ranks metrics by BLIND verdicts because a sighted verdict measures how well a
 * metric predicts a decision made while looking at it, so a candidate metric
 * reaching the panel quietly contaminates the arm that decides it.
 *
 * The failure mode this guards is mundane: someone adds a row to the wrong
 * array. It costs nothing to catch here and cannot be caught later, because a
 * contaminated verdict looks exactly like a clean one.
 */
describe("metric registries", () => {
  it("keeps candidate metrics out of the rater's panel", () => {
    const panel = new Set(METRIC_ROWS.map((r) => r.key as string));
    for (const row of ANALYSIS_ONLY) {
      expect(panel.has(row.key as string)).toBe(false);
    }
  });

  it("keeps channels that lost the down-select out of the panel", () => {
    const panel = METRIC_ROWS.map((r) => r.key as string);
    for (const key of panel) {
      expect(key.startsWith("sam3_")).toBe(false);
      expect(key.startsWith("depth_")).toBe(false);
    }
    // DINOv2 fails gates 1 and 2; it stays computed and stays off the panel.
    expect(panel).not.toContain("dino_cos");
  });

  it("shows the metric the down-select chose", () => {
    expect(METRIC_ROWS.map((r) => r.key as string)).toContain("pix_fg");
  });

  it("has no duplicate keys across the two registries", () => {
    const keys = ANALYSIS_METRICS.map((r) => r.key as string);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("gives every row a column heading, since the tables read it from here", () => {
    for (const row of ANALYSIS_METRICS) {
      expect(row.short, `${row.key as string} has no short label`).toBeTruthy();
      expect((row.short as string).length).toBeLessThanOrEqual(8);
      expect(row.label.length).toBeGreaterThan(0);
      expect(row.hint.length).toBeGreaterThan(0);
    }
  });

  it("is the concatenation of the two, in order", () => {
    expect(ANALYSIS_METRICS).toEqual([...METRIC_ROWS, ...ANALYSIS_ONLY]);
  });
});
