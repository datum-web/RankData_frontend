import { describe, it, expect } from "vitest";
import { isAnchorPair, zoomPanels, showsMetrics, scaleRatio, shouldAutoFit } from "../view";

const solid = (longest: number) => ({ origin: "model", frame: { longest } });
const anchor = { origin: "anchor" as const, frame: null };

describe("anchor pairs", () => {
  it("never lay out a panel for the number", () => {
    expect(zoomPanels({ reference: solid(100), left: solid(90), right: anchor }))
      .toEqual(["reference", "left"]);
    expect(zoomPanels({ reference: solid(100), left: anchor, right: solid(90) }))
      .toEqual(["reference", "right"]);
  });

  it("show two panels, not three", () => {
    expect(zoomPanels({ reference: solid(100), left: solid(90), right: anchor })).toHaveLength(2);
    expect(zoomPanels({ reference: solid(100), left: solid(90), right: solid(80) })).toHaveLength(3);
  });

  it("never show the metric table — that is the point of the cohort", () => {
    expect(showsMetrics({ reference: solid(100), left: solid(90), right: anchor })).toBe(false);
  });
});

describe("the blind arm", () => {
  it("hides the metrics", () => {
    expect(showsMetrics({ blind: true, left: solid(1), right: solid(1) })).toBe(false);
    expect(showsMetrics({ blind: false, left: solid(1), right: solid(1) })).toBe(true);
  });
});

describe("scale", () => {
  it("measures the smaller solid against the reference", () => {
    expect(scaleRatio({ reference: solid(200), left: solid(200), right: solid(1) }))
      .toBeCloseTo(0.005);
  });

  it("ignores the anchor, which has no size", () => {
    expect(scaleRatio({ reference: solid(200), left: solid(200), right: anchor })).toBe(1);
  });

  it("opens the zoom fitted only when the solid would be a speck", () => {
    // the real case: a 201.8 mm fan shroud against a unit-less box(1,1,0.1)
    expect(shouldAutoFit({ reference: solid(201.8), left: solid(1), right: anchor })).toBe(true);
    expect(shouldAutoFit({ reference: solid(201.8), left: solid(180), right: anchor })).toBe(false);
  });

  it("does not divide by a missing reference frame", () => {
    expect(scaleRatio({ reference: null, left: solid(1), right: solid(1) })).toBe(1);
    expect(scaleRatio({ reference: { frame: null }, left: solid(1), right: solid(1) })).toBe(1);
  });
});
