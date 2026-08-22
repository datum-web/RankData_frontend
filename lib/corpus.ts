import type { Candidate, Evaluation, Metrics } from "./types";
import type { Corpus } from "./store";

/**
 * Reading a score, in one place.
 *
 * A score belongs to (candidate, the reference the pair shows), not to the
 * candidate. Five routes each built their own lookup for that, and when the
 * keying changed four were updated and the CSV export was not — 99 of 181
 * exported rows disagreed with the screen, by as much as 0.97 against 0.05.
 *
 * A gate check was added to catch that class by matching source text, which
 * works but is a patch over a shape problem. With one implementation there is
 * nothing left to keep in step.
 */

// A NUL, written as an escape rather than as the byte itself: a literal
// control character makes git treat the whole file as binary, so every
// change to it arrives in review as "Bin 4597 bytes" with no diff.
const SEP = "\u0000";

export type Scores = {
  /** The evaluation for this candidate against the reference on screen. */
  of: (candidateId: string, refId: string) => Evaluation | null;
  /** One metric, with `v1_iou` living beside `metrics` rather than inside it. */
  value: (candidateId: string, refId: string, key: string) => number | null;
  /** The candidate row: identity, provenance, origin — never scores. */
  candidate: (candidateId: string) => Candidate | undefined;
};

export function scoresFor(corpus: Corpus): Scores {
  const byEval = new Map<string, Evaluation>(
    corpus.evaluations.map((e) => [`${e.candidate_id}${SEP}${e.ref_id}`, e]),
  );
  const byCand = new Map(corpus.candidates.map((c) => [c.id, c]));
  const of = (candidateId: string, refId: string) =>
    byEval.get(`${candidateId}${SEP}${refId}`) ?? null;
  return {
    of,
    candidate: (id: string) => byCand.get(id),
    value: (candidateId: string, refId: string, key: string) => {
      const e = of(candidateId, refId);
      if (!e) return null;
      if (key === "v1_iou") return e.v1_iou ?? null;
      const m = e.metrics as Metrics | undefined;
      const v = m ? (m as Record<string, unknown>)[key] : undefined;
      return typeof v === "number" ? v : null;
    },
  };
}

/**
 * Which stimulus a verdict was formed against, and whether it still counts.
 *
 * Here rather than in `store` so every consumer answers it identically.
 */
export const CURRENT_STIMULUS = "harness-normalised-unclipped";

export function countsNow(
  j: { stimulus?: string | null; stimulus_equivalent?: boolean },
): boolean {
  return (j.stimulus ?? "") === CURRENT_STIMULUS || j.stimulus_equivalent === true;
}

/**
 * Evaluator warnings, as something a rater can act on.
 *
 * They were printed verbatim, which put strings like
 *
 *   global_iou_unavailable: the Boolean returned an empty intersection for
 *   solids that overlap, and neither the cut nor the fuse route could
 *   corroborate a value; no level reached validity within the budget; the
 *   budget may be too small for L1
 *
 * next to the buttons. Two things are wrong with that beyond the jargon.
 *
 * The second clause is not a second finding. `Q_L` contains Topology, so the
 * moment Topology is N/A no level can report a value and the budget sentence
 * fires unconditionally — measured over the corpus it appeared on 72 rows and
 * was a real budget miss on exactly one. Showing it alongside the cause tells
 * the reader the evaluator hit two problems when it hit one, and points the
 * blame at a time limit that has nothing to do with it.
 *
 * And a rater is not being asked to debug the evaluator. What they need is
 * whether the two pictures are still comparable and which number is missing.
 * The original text stays available as a tooltip for us.
 */
const IMPLIED_BY_TOPOLOGY = "no level reached validity within the budget";

const PLAIN: [RegExp, string][] = [
  [/^topology_unavailable/,
   "Topology could not be measured — this solid's surface does not close, so it has no genus. The pictures are unaffected."],
  [/^global_iou_unavailable/,
   "Overlap could not be measured — the geometry kernel produced no value it could confirm. The pictures are unaffected."],
  [new RegExp(IMPLIED_BY_TOPOLOGY),
   "The spatial pass ran out of time before finishing its first level."],
];

export type Explained = { text: string; raw: string };

export function explainWarnings(warnings?: string[] | null): Explained[] {
  const list = warnings ?? [];
  const topologyFailed = list.some((w) => /^topology_unavailable/.test(w));
  const out: Explained[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    if (topologyFailed && raw.includes(IMPLIED_BY_TOPOLOGY)) continue;
    const hit = PLAIN.find(([re]) => re.test(raw));
    const text = hit ? hit[1] : raw;
    if (seen.has(text)) continue;
    seen.add(text);
    out.push({ text, raw });
  }
  return out;
}
