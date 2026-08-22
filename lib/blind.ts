/**
 * Which pairs are judged without the metrics on screen.
 *
 * Every one of the first 225 verdicts was cast with the metric table visible,
 * so a model fitted on them measures "how well the metrics predict a decision
 * made while looking at the metrics". `fit_preference.py` has printed that
 * warning next to its own output since it was written; the fix is not a
 * caveat, it is a blind cohort.
 *
 * Two properties matter and both come from hashing rather than from storage:
 *
 * **Stable.** A reload must not change what the rater sees. If it did, the
 * `metrics_shown` flag on the verdict would be a guess about which version was
 * on screen when they decided.
 *
 * **Server-side.** The client is told whether to hide the panel, but the
 * judgment route recomputes the same value instead of believing the body.
 * Otherwise the one field the blind analysis depends on is the one field a
 * browser could set to anything.
 *
 * Per (rater, pair), so two raters on the same pair are not both blind, and one
 * rater is not blind on a whole family at once.
 */

import { hash } from "./hash";

/**
 * Share of pairs shown without metrics, 0-100.
 *
 * A third is the default: enough that the blind arm reaches a usable size in
 * the same number of sessions, not so much that the sighted arm — which is
 * what the deployed tool actually looks like — stops growing. Set
 * `PREFERENCE_LAB_BLIND_PCT=0` to turn it off.
 */
export function blindPercent(): number {
  const raw = process.env.PREFERENCE_LAB_BLIND_PCT;
  const n = raw == null || raw === "" ? 33 : Number(raw);
  return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 33;
}

export function isBlind(pairId: string, rater: string): boolean {
  const pct = blindPercent();
  if (pct <= 0) return false;
  if (pct >= 100) return true;
  // A separate salt from the side-assignment hash, or the two decisions would
  // be correlated: every blind pair would also have A on the same side.
  return hash(`blind::${pairId}::${rater}`) % 100 < pct;
}
