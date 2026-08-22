/**
 * Accounts whose verdicts are not part of the study.
 *
 * A QA account has to walk the same path a rater does — sign in, be served a
 * pair, commit a verdict, see the next one — or it is not testing the thing
 * that matters. Which means it writes real rows to `pl_judgments`, and those
 * rows would otherwise be counted in every statistic, protected from trimming
 * by `rebalance`, and fitted by `fit_preference`.
 *
 * Excluded in ONE place, `allJudgments()`, so nothing downstream has to
 * remember. `PREFERENCE_LAB_TEST_RATERS` is read by the Python side too — the
 * gate, the rebalance stage and the fit all query the table directly — so the
 * list is config shared by both rather than logic duplicated in both.
 *
 * Not a database column on purpose: whether an account is real is a fact about
 * the study, not about the row, and it changes when a QA account is retired.
 */

/**
 * The QA domain. Every account under it is a test account.
 *
 * A convention rather than a list, and deliberately not only an environment
 * variable: an exclusion that depends on deploy configuration is one
 * misconfigured environment away from silently counting QA verdicts as data,
 * and the failure looks exactly like everything working. Real raters are at
 * gmail, ustc, yahoo — nobody will ever be issued an address here by accident.
 *
 * `PREFERENCE_LAB_TEST_RATERS` still adds to this, for a one-off account that
 * has to live somewhere else.
 */
export const QA_DOMAIN = "rankdata.dev";

export function testRaters(): Set<string> {
  return new Set(
    (process.env.PREFERENCE_LAB_TEST_RATERS ?? "")
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isTestRater(email: string | null | undefined): boolean {
  if (!email) return false;
  const e = email.trim().toLowerCase();
  return e.endsWith(`@${QA_DOMAIN}`) || testRaters().has(e);
}

/** Drop verdicts cast by a QA account. */
export function withoutTestRaters<T extends { rater?: string | null }>(rows: T[]): T[] {
  return rows.filter((r) => !isTestRater(r.rater));
}
