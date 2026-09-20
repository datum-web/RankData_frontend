/**
 * What the metric-agreement card shows, decided away from the JSX so it can
 * be tested with the inputs the page actually sees -- including `stats`
 * still null on a signed-in first render, which is the state that took the
 * whole dashboard down once (1d0e272).
 *
 *   "empty"       nothing to show yet: stats not loaded, or no verdict counts
 *   "superseded"  verdicts exist but none can be counted (administrator view;
 *                 the counts needed to say so are administrator-only)
 *   "table"       the rates
 */
export type AgreementCard = "empty" | "superseded" | "table";

export function agreementCard(stats: any): AgreementCard {
  if (!stats || !Array.isArray(stats.metric_agreement)) return "empty";
  const rows: any[] = stats.metric_agreement;
  const all = stats.all;
  const noRates = rows.every((m) => m.rate == null);
  if (noRates && (all == null || (all.judgments ?? 0) === 0)) return "empty";
  if (all && (all.carried_verdicts ?? 0) === 0 && rows.every((m) => !m.usable)) {
    return "superseded";
  }
  return "table";
}
