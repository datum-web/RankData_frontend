/**
 * What a pair view shows, decided in one place instead of in five JSX guards.
 *
 * Every one of these rules was learned by shipping its absence:
 *
 *   an anchor has no solid   -> the zoom gave a third of its width to a card
 *                               saying so, and the two solids being compared
 *                               were squeezed into the rest
 *   an anchor has no scores  -> the metric table rendered the candidate's own
 *                               numbers directly under the words "the metric
 *                               panel is hidden here on purpose"
 *   a candidate can be 1/200 -> placed by the reference's frame it is a dot,
 *      of the reference         and the rater is asked to judge what they
 *                               cannot see
 *
 * They were fixed one at a time in the markup, where nothing stops the next
 * change from reintroducing them. Here they are one function each, and the
 * tests hold them.
 */

export type ViewLike = {
  blind?: boolean;
  reference?: { frame?: { longest?: number } | null } | null;
  left?: { origin?: string; frame?: { longest?: number } | null } | null;
  right?: { origin?: string; frame?: { longest?: number } | null } | null;
};

/** An anchor is a number, not a part. */
export function isAnchorPair(v: ViewLike): boolean {
  return v.left?.origin === "anchor" || v.right?.origin === "anchor";
}

/**
 * Which panels the zoom should lay out.
 *
 * Never the anchor: it has no solid, and its cell is pure waste in a view whose
 * whole purpose is size.
 */
export function zoomPanels(v: ViewLike): Array<"reference" | "left" | "right"> {
  const out: Array<"reference" | "left" | "right"> = ["reference"];
  if (v.left?.origin !== "anchor") out.push("left");
  if (v.right?.origin !== "anchor") out.push("right");
  return out;
}

/**
 * Whether the numbers are on screen.
 *
 * Hidden for the blind arm, and hidden for an anchor pair for a different
 * reason: reading the candidate's own score first turns "is this better than
 * 0.45" from a judgement into arithmetic.
 */
export function showsMetrics(v: ViewLike): boolean {
  return !v.blind && !isAnchorPair(v);
}

/** How small the smaller real solid is, relative to the reference's frame. */
export function scaleRatio(v: ViewLike): number {
  const ref = v.reference?.frame?.longest;
  if (!ref || ref <= 0) return 1;
  const own = [v.left, v.right]
    .filter((c) => c && c.origin !== "anchor")
    .map((c) => c?.frame?.longest)
    .filter((x): x is number => typeof x === "number" && x > 0);
  return own.length ? Math.min(...own.map((x) => x / ref)) : 1;
}

/**
 * Below this the solid is a speck at reference scale and the zoom shows
 * nothing, so it opens fitted to its own bounds -- with the size error stated
 * in words, because fitting must not quietly forgive it.
 */
export const SPECK = 0.2;

export function shouldAutoFit(v: ViewLike): boolean {
  return scaleRatio(v) < SPECK;
}
