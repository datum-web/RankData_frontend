import { NextResponse } from "next/server";
import { allJudgments, backend, countsNow, loadCorpus } from "@/lib/store";
import { METRIC_ROWS } from "@/lib/types";
import { raterFromRequest } from "@/lib/auth";
import { CURRENT_STIMULUS, scoresFor } from "@/lib/corpus";

export const dynamic = "force-dynamic";

const val = (c: any, key: string) =>
  key === "v1_iou" ? c?.v1_iou ?? null : c?.metrics?.[key] ?? null;

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

const tally = (xs: (string | number)[]) => {
  const out: Record<string, number> = {};
  for (const x of xs) out[String(x)] = (out[String(x)] ?? 0) + 1;
  return out;
};

/**
 * Dashboard figures.
 *
 * Three groups, kept apart on purpose: what the corpus contains, what *you*
 * have done, and what everyone has done. Pooling a rater's own progress with
 * everyone else's is how someone ends up reading their own dozen verdicts as a
 * study result.
 *
 * `metric_agreement` is a monitoring view, not the preference model: it answers
 * "how often would this metric alone have picked what the expert picked". Ties
 * are excluded because a metric can only express a direction.
 */
export async function GET(req: Request) {
  let me: string | null;
  try {
    me = (await raterFromRequest(req))?.email ?? null;
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "server not configured" }, { status: 500 });
  }
  if (!me) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  let corpus, judgments;
  try {
    corpus = await loadCorpus();
    judgments = await allJudgments();
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "backend unavailable" }, { status: 500 });
  }

  const byPair = new Map(corpus.pairs.map((p) => [p.id, p]));
  const scores = scoresFor(corpus);
  const byCand = new Map(corpus.candidates.map((c) => [c.id, c]));
  // Metrics are keyed by (candidate, the reference the pair shows). Reading
  // them off the candidate quoted the reference it was generated for, which in
  // a cross-reference pair is a different question from the one the rater
  // answered.

  const scored = judgments.filter((j) => !j.is_tie && j.chosen_id);

  /**
   * Agreement is reported per stimulus, never pooled.
   *
   * The image set changed mid-study: the first one normalised every shape on
   * its own bounding box and so could not show a uniform size error at all.
   * A verdict formed without seeing a defect and one formed while seeing it are
   * different observations, and averaging them produces a number that describes
   * neither. Pooling here also flattered v1's IoU specifically, because v1
   * divides scale out too and therefore agreed with a rater who could not see
   * it — a co-blindness, not an accuracy.
   */
  const stimulusOf = (j: any) => j.stimulus ?? "per-shape-normalised-v0";

  function agreementOver(js: any[]) {
    return METRIC_ROWS.map((row) => {
      let agree = 0, usable = 0;
      for (const j of js) {
        const pair = byPair.get(j.pair_id);
        if (!pair) continue;
        const va = val(scores.of(pair.a, pair.ref_id), row.key as string);
        const vb = val(scores.of(pair.b, pair.ref_id), row.key as string);
        if (va == null || vb == null || va === vb) continue;
        usable += 1;
        if ((va > vb) === (j.chosen_id === pair.a)) agree += 1;
      }
      return { key: row.key, label: row.label, agree, usable,
               rate: usable ? agree / usable : null };
    });
  }

  const byStimulus: Record<string, ReturnType<typeof agreementOver>> = {};
  for (const st of new Set(scored.map(stimulusOf))) {
    byStimulus[st] = agreementOver(scored.filter((j) => stimulusOf(j) === st));
  }
  // Everything whose evidence the image change did not alter, which is most of
  // it. Excluded: verdicts on a pair containing a scale-only defect, because
  // that defect was not on screen when the choice was made.
  const usable = scored.filter((j) => countsNow(j, CURRENT_STIMULUS));
  const metric_agreement = agreementOver(usable);
  const superseded = scored.length - usable.length;
  const carried = usable.filter((j) => stimulusOf(j) !== CURRENT_STIMULUS).length;
  // Of the carried verdicts, the ones whose on-screen numbers were computed
  // against a different reference. The pictures were right; the figures beside
  // them were not, and the rater did look at them.
  const carried_with_wrong_metrics =
    usable.filter((j: any) => j.metrics_were_wrong).length;

  // A pair left open on screen records the idle time as its decision. Newer
  // rows already subtract hidden-tab time, but older ones cannot be corrected
  // retroactively, and one 3.2-hour row is enough to make a total meaningless.
  // The total is therefore capped per pair and the number of capped rows is
  // reported, rather than quietly showing a wrong sum.
  const IDLE_CAP_MS = 10 * 60 * 1000;

  const mine = judgments.filter((j) => j.rater === me);
  const mineScored = mine.filter((j) => !j.is_tie && j.chosen_id);
  const myLeft = mineScored.filter((j) => j.chosen_id === j.left_id).length;

  return NextResponse.json({
    backend: backend(),
    corpus: {
      references: corpus.refs.length,
      candidates: corpus.candidates.length,
      pairs: corpus.pairs.length,
      families: tally(corpus.refs.map((r) => r.family)),
      cohorts: tally(corpus.pairs.map((p) => p.cohort ?? "unlabelled")),
    },
    mine: {
      rater: me,
      judged: mine.length,
      remaining: corpus.pairs.length - mine.length,
      ties: mine.length - mineScored.length,
      median_decision_ms: median(mine.map((j) => j.decision_ms).filter(Number.isFinite)),
      total_time_ms: mine.reduce((a, j) => a + Math.min(j.decision_ms || 0, IDLE_CAP_MS), 0),
      capped: mine.filter((j) => (j.decision_ms || 0) > IDLE_CAP_MS).length,
      by_confidence: tally(mine.map((j) => j.confidence)),
      // Far from 0.5 either way is worth a look: it usually means position,
      // not geometry, is driving the choice.
      left_pick_rate: mineScored.length ? myLeft / mineScored.length : null,
    },
    all: {
      judgments: judgments.length,
      stimulus: CURRENT_STIMULUS,
      metric_agreement_by_stimulus: byStimulus,
      superseded_verdicts: superseded,
      carried_verdicts: carried,
      carried_with_wrong_metrics,
      raters: [...new Set(judgments.map((j) => j.rater))],
      ties: judgments.length - scored.length,
      median_decision_ms: median(judgments.map((j) => j.decision_ms).filter(Number.isFinite)),
    },
    metric_agreement,
  });
}
