/**
 * The exclusion that keeps QA out of the study.
 *
 * It has to hold without configuration, because the way it fails — counting
 * test verdicts as data — is invisible: every number still renders, the gate
 * still passes, the fit still converges, and the answer is quietly wrong.
 */
import { afterEach, describe, expect, it } from "vitest";
import { isTestRater, withoutTestRaters, QA_DOMAIN } from "../testRaters";

afterEach(() => { delete process.env.PREFERENCE_LAB_TEST_RATERS; });

describe("isTestRater", () => {
  it("excludes the QA domain with no environment set at all", () => {
    // The point of the convention: a deploy that forgot the variable still
    // keeps QA out.
    expect(process.env.PREFERENCE_LAB_TEST_RATERS).toBeUndefined();
    expect(isTestRater(`qa@${QA_DOMAIN}`)).toBe(true);
    expect(isTestRater(`anyone-else@${QA_DOMAIN}`)).toBe(true);
  });

  it("leaves real raters alone", () => {
    expect(isTestRater("bigskydog0617@gmail.com")).toBe(false);
    expect(isTestRater("sunzhenchuan@mail.ustc.edu.cn")).toBe(false);
    expect(isTestRater("zj.guo@yahoo.com")).toBe(false);
  });

  it("is not fooled by a lookalike domain", () => {
    // The `@` is part of the suffix, so a domain that merely ends in the same
    // letters is not a match. Worth pinning: dropping it would silently
    // exclude a real rater, which is the more damaging direction of this bug.
    expect(isTestRater("someone@notrankdata.dev")).toBe(false);
    expect(isTestRater("someone@rankdata.dev.example.com")).toBe(false);
    expect(isTestRater("rankdata.dev@gmail.com")).toBe(false);
  });

  it("ignores case and surrounding space", () => {
    expect(isTestRater(`  QA@${QA_DOMAIN.toUpperCase()} `)).toBe(true);
  });

  it("treats nothing as a real rater rather than excluding it", () => {
    // A row with no rater is a data problem to surface, not one to hide.
    expect(isTestRater(null)).toBe(false);
    expect(isTestRater(undefined)).toBe(false);
    expect(isTestRater("")).toBe(false);
  });

  it("also honours an explicit list, for an account elsewhere", () => {
    process.env.PREFERENCE_LAB_TEST_RATERS = "temp@gmail.com, other@x.io";
    expect(isTestRater("temp@gmail.com")).toBe(true);
    expect(isTestRater("OTHER@X.IO")).toBe(true);
    expect(isTestRater("bigskydog0617@gmail.com")).toBe(false);
  });
});

describe("withoutTestRaters", () => {
  const rows = [
    { rater: "bigskydog0617@gmail.com", id: 1 },
    { rater: `qa@${QA_DOMAIN}`, id: 2 },
    { rater: "sunzhenchuan@mail.ustc.edu.cn", id: 3 },
  ];

  it("drops QA rows and keeps the rest, in order", () => {
    expect(withoutTestRaters(rows).map((r) => r.id)).toEqual([1, 3]);
  });

  it("keeps everything when there is no QA row", () => {
    const real = rows.filter((r) => r.id !== 2);
    expect(withoutTestRaters(real)).toHaveLength(2);
  });

  it("handles an empty table", () => {
    expect(withoutTestRaters([])).toEqual([]);
  });
});
