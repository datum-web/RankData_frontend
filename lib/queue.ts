/**
 * What to ask next, and which candidate goes on the left.
 *
 * Pulled out of the route so it can be tested. The route now decides nothing:
 * it fetches, calls these, and serialises. Every function here is pure — no
 * fetch, no `process.env`, no clock — which is the whole point.
 */

import { hash } from "./hash";

/**
 * Which candidate is drawn on the left.
 *
 * Random across pairs but *stable* for a given (pair, rater): a reload
 * mid-judgment that flipped the sides would corrupt both the verdict and the
 * timing.
 */
export function aOnLeft(pairId: string, rater: string): boolean {
  return (hash(`${pairId}::${rater}`) & 1) === 0;
}

/**
 * A flat shuffle, per rater.
 *
 * Not grouped by family: the corpus is uneven enough that a family-blocked
 * queue would spend a whole session on one part (one spline hub owns nine of
 * fifty open pairs). Keyed on the rater so order effects — fatigue, drift, the
 * first-ten calibration wobble — do not line up across people.
 */
export function shuffleFor<T extends { id: string }>(pairs: T[], rater: string): T[] {
  return [...pairs].sort(
    (a, b) => hash(`order::${rater}::${a.id}`) - hash(`order::${rater}::${b.id}`));
}

/** The metric channels whose disagreement makes a pair worth asking about. */
export const CHANNELS = [
  "aligned_iou", "q_l", "sil_iou", "dino_cos", "face",
] as const;

/**
 * How much the metric channels disagree about a pair, 0 to 1.
 *
 * 1 when they split evenly, 0 when they are unanimous or too few of them have
 * an opinion. A pair every channel already agrees on teaches almost nothing
 * whatever the human says; a pair that splits them is where a verdict is worth
 * a session.
 *
 * Deliberately *not* expected information gain under the fitted preference
 * model. That model is fitted on verdicts cast while the metrics were visible,
 * so steering the queue with it would chase its own anchoring bias. This needs
 * no fitted weights and no verdicts at all — it is a property of the corpus.
 */
export function disagreement(
  value: (candidateId: string, refId: string, key: string) => number | null,
  pair: { a: string; b: string; ref_id: string },
  channels: readonly string[] = CHANNELS,
): number {
  let votesA = 0, votesB = 0;
  for (const key of channels) {
    const va = value(pair.a, pair.ref_id, key);
    const vb = value(pair.b, pair.ref_id, key);
    if (va == null || vb == null || va === vb) continue;
    if (va > vb) votesA++; else votesB++;
  }
  const n = votesA + votesB;
  if (n < 2) return 0;
  return 1 - Math.abs(votesA - votesB) / n;
}

export type QueueOptions = {
  rater: string;
  /** pair id -> disagreement, from `disagreement()` */
  info: Map<string, number>;
  /** how many of the most contested pairs every rater sees, in the same set */
  corePairs: number;
  /** how many bands the rest is sorted into; within a band the shuffle stands */
  buckets?: number;
  /** `"shuffle"` returns the flat per-rater shuffle and ignores everything else */
  mode?: "informative" | "shuffle";
};

/**
 * The queue, in the order it will be asked.
 *
 * Contested pairs first, but **bucketed, not sorted**. A total order by
 * disagreement puts every rater on the same path in the same order, which
 * throws away the one property the shuffle exists for. Bucketing keeps the
 * informative pairs near the front while leaving order decorrelated between
 * people.
 *
 * Overlap is arranged on purpose instead: the `corePairs` most contested pairs
 * are the same set for everybody, so the panel shares something to measure
 * agreement on. Core membership is by id, not by rater, so it cannot drift
 * between sessions.
 */
export function buildQueue<T extends { id: string }>(
  eligible: T[], opts: QueueOptions,
): T[] {
  const shuffled = shuffleFor(eligible, opts.rater);
  if (opts.mode === "shuffle") return shuffled;

  const buckets = opts.buckets ?? 4;
  const bucketOf = (id: string) =>
    Math.min(buckets - 1, Math.floor((1 - (opts.info.get(id) ?? 0)) * buckets));

  const ranked = [...eligible].sort(
    (x, y) => (opts.info.get(y.id) ?? 0) - (opts.info.get(x.id) ?? 0)
              || (x.id < y.id ? -1 : 1));
  const core = new Set(ranked.slice(0, Math.max(0, opts.corePairs)).map((p) => p.id));

  const inCore = shuffled.filter((p) => core.has(p.id));
  const rest = shuffled.filter((p) => !core.has(p.id));
  // Stable sort: the per-rater shuffle survives inside each band.
  rest.sort((x, y) => bucketOf(x.id) - bucketOf(y.id));
  return [...inCore, ...rest];
}
