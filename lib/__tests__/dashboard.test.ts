/**
 * The dashboard's metric-agreement card, with the inputs the page really
 * gets. The first one is the regression: a signed-in first render has no
 * stats yet, and 02ca8f6 read through it.
 */
import { describe, expect, it } from "vitest";
import { agreementCard } from "../dashboard";

const rows = (rate: number | null, usable = 0) =>
  [{ key: "pix_fg", label: "pix", rate, usable, agree: 0 }];

describe("agreementCard", () => {
  it("is empty, not a crash, before stats have loaded", () => {
    expect(agreementCard(null)).toBe("empty");
    expect(agreementCard(undefined)).toBe("empty");
    expect(agreementCard({})).toBe("empty");
  });

  it("is empty for a rater with no rates yet (no `all` is sent to them)", () => {
    expect(agreementCard({ metric_agreement: rows(null) })).toBe("empty");
  });

  it("shows a rater the table once there are rates, with no `all` at all", () => {
    expect(agreementCard({ metric_agreement: rows(0.62) })).toBe("table");
  });

  it("shows an administrator the superseded note when nothing counts", () => {
    expect(agreementCard({
      metric_agreement: rows(null, 0),
      all: { judgments: 38, carried_verdicts: 0, superseded_verdicts: 38 },
    })).toBe("superseded");
  });

  it("shows an administrator the table otherwise", () => {
    expect(agreementCard({
      metric_agreement: rows(0.62, 100),
      all: { judgments: 4888, carried_verdicts: 160 },
    })).toBe("table");
  });
});
