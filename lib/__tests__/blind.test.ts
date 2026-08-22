/**
 * The blind arm is the only thing that will tell us whether the metrics predict
 * preference or merely anchor it, and it rests entirely on two properties of
 * this assignment. Both are asserted here because neither is visible in use:
 * a blind arm that quietly drifted would look exactly like one that worked.
 */
import { afterEach, describe, expect, it } from "vitest";
import { blindPercent, isBlind } from "../blind";
import { aOnLeft } from "../queue";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `pair-${i}`);
const rate = (rater: string, n = 2000) =>
  ids(n).filter((p) => isBlind(p, rater)).length / n;

afterEach(() => { delete process.env.PREFERENCE_LAB_BLIND_PCT; });

describe("blindPercent", () => {
  it("defaults to a third", () => {
    expect(blindPercent()).toBe(33);
  });

  it("honours the environment and clamps nonsense", () => {
    process.env.PREFERENCE_LAB_BLIND_PCT = "50"; expect(blindPercent()).toBe(50);
    process.env.PREFERENCE_LAB_BLIND_PCT = "-5"; expect(blindPercent()).toBe(0);
    process.env.PREFERENCE_LAB_BLIND_PCT = "900"; expect(blindPercent()).toBe(100);
    process.env.PREFERENCE_LAB_BLIND_PCT = "abc"; expect(blindPercent()).toBe(33);
    process.env.PREFERENCE_LAB_BLIND_PCT = ""; expect(blindPercent()).toBe(33);
  });
});

describe("isBlind", () => {
  it("is stable — a reload must not change what was shown", () => {
    // If this drifted, `metrics_shown` would be a guess about which version of
    // the page the rater was actually looking at when they decided.
    for (const p of ids(50)) {
      expect(isBlind(p, "a@x.com")).toBe(isBlind(p, "a@x.com"));
    }
  });

  it("hits roughly the configured share", () => {
    expect(rate("a@x.com")).toBeGreaterThan(0.28);
    expect(rate("a@x.com")).toBeLessThan(0.38);
  });

  it("is off entirely at 0 and on entirely at 100", () => {
    process.env.PREFERENCE_LAB_BLIND_PCT = "0";
    expect(ids(200).some((p) => isBlind(p, "a@x.com"))).toBe(false);
    process.env.PREFERENCE_LAB_BLIND_PCT = "100";
    expect(ids(200).every((p) => isBlind(p, "a@x.com"))).toBe(true);
  });

  it("differs between raters, so a pair is not blind for everyone at once", () => {
    // Two raters both blind on the same pair would leave that pair with no
    // sighted verdict to compare against, which is the comparison the arm is for.
    const both = ids(500).filter(
      (p) => isBlind(p, "a@x.com") && isBlind(p, "b@x.com")).length;
    // independent: ~0.33^2 of 500 = 54
    expect(both).toBeGreaterThan(20);
    expect(both).toBeLessThan(100);
  });

  it("does not correlate with side assignment", () => {
    // Separate salts. Shared ones would put A on the same side of every blind
    // pair, confounding side bias with the arm.
    const n = 2000;
    const blindAndLeft = ids(n).filter(
      (p) => isBlind(p, "a@x") && aOnLeft(p, "a@x")).length;
    const blind = ids(n).filter((p) => isBlind(p, "a@x")).length;
    expect(blindAndLeft / blind).toBeGreaterThan(0.42);
    expect(blindAndLeft / blind).toBeLessThan(0.58);
  });
});
