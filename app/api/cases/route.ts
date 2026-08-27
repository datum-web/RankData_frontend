import { NextResponse } from "next/server";
import { allJudgments, loadCorpus } from "@/lib/store";
import { ANALYSIS_METRICS } from "@/lib/types";
import { isAdmin, raterFromRequest } from "@/lib/auth";
import { countsNow, CURRENT_STIMULUS, scoresFor } from "@/lib/corpus";

export const dynamic = "force-dynamic";

const val = (e: any, key: string) =>
  key === "v1_iou" ? e?.v1_iou ?? null : e?.metrics?.[key] ?? null;

/**
 * One row per case: the scores next to the verdict.
 *
 * The dashboard says how often a metric agreed; it cannot say *where* it
 * disagreed. This is the table you need to open a specific case and ask why —
 * which is the whole point of collecting the verdicts.
 *
 * Everything is oriented A → B, the pair's own order, never left/right, so a
 * row means the same thing regardless of how the sides happened to be shuffled
 * for whoever judged it.
 */
export async function GET(req: Request) {
  let me: string | null;
  let admin = false;
  try {
    const who = await raterFromRequest(req);
    me = who?.email ?? null;
    admin = !!me && isAdmin(me);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "server not configured" }, { status: 500 });
  }
  if (!me) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  // An administrator can read the case log as any rater. Everyone else is
  // pinned to their own, and the check is here rather than in the page because
  // the page is not what enforces it.
  const asRater = new URL(req.url).searchParams.get("rater");
  if (asRater && !admin) {
    return NextResponse.json({ error: "not an administrator" }, { status: 403 });
  }
  const subject = asRater || me;

  let corpus, judgments;
  try {
    [corpus, judgments] = await Promise.all([loadCorpus(), allJudgments()]);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "backend unavailable" }, { status: 500 });
  }

  const scores = scoresFor(corpus);
  const byCand = new Map(corpus.candidates.map((c) => [c.id, c]));
  // Scores and pictures are looked up by (candidate, the reference on screen).
  // Reading them off the candidate quoted whatever reference it happened to be
  // generated for, which for a cross-reference pair is not the one being shown.
  const famOf = new Map(corpus.refs.map((r) => [r.id, r.family]));
  const refImg = new Map(corpus.refs.map((r) => [r.id, r.image]));
  const refImgV0 = new Map(corpus.refs.map((r) => [r.id, (r as any).image_v0 ?? r.image]));
  const perPair = new Map<string, any[]>();
  for (const j of judgments) {
    if (!perPair.has(j.pair_id)) perPair.set(j.pair_id, []);
    perPair.get(j.pair_id)!.push(j);
  }

  const rows = corpus.pairs.map((pair) => {
    const a = scores.of(pair.a, pair.ref_id);
    const b = scores.of(pair.b, pair.ref_id);
    const aCand = byCand.get(pair.a);
    const bCand = byCand.get(pair.b);
    // Two orientations, on purpose. `chose` is A/B for analysis; the left/right
    // fields reconstruct what that rater actually saw, which is what a visual
    // review has to show — sides are shuffled per (pair, rater), so replaying a
    // verdict in A/B order would show it mirrored.
    const verdicts = (perPair.get(pair.id) ?? []).map((j) => {
      const left = scores.of(j.left_id, pair.ref_id);
      const right = scores.of(j.right_id, pair.ref_id);
      const leftCand = byCand.get(j.left_id);
      const rightCand = byCand.get(j.right_id);
      // Show the picture this rater actually saw. The first stimulus set
      // normalised every shape on its own bounding box, which hid uniform size
      // errors; replacing those images with the reference-scaled ones would
      // make a past verdict look like it was made on evidence that was not on
      // screen at the time.
      const old = (j.stimulus ?? "per-shape-normalised-v0") !== CURRENT_STIMULUS;
      const shot = (c: any) => (old ? c?.image_v0 ?? c?.image : c?.image) ?? null;
      return {
        rater: j.rater,
        chose: j.is_tie ? "tie" : (j.chosen_id === pair.a ? "A" : "B"),
        chose_side: j.is_tie ? "tie" : (j.chosen_id === j.left_id ? "left" : "right"),
        confidence: j.confidence,
        decision_ms: j.decision_ms,
        hidden_ms: j.hidden_ms ?? 0,
        notes: j.notes || null,
        mine: j.rater === subject,
        stimulus: j.stimulus ?? "per-shape-normalised-v0",
        // Whether this verdict still counts, decided by the shared rule
        // rather than by comparing the stimulus name. Most stored verdicts
        // carry an older name and are still valid, because the image change
        // did not alter the evidence in their pair.
        counts_now: countsNow(j),
        ref_image: old ? refImgV0.get(pair.ref_id) ?? refImg.get(pair.ref_id)
                       : refImg.get(pair.ref_id),
        left: { id: j.left_id, image: shot(left), origin: leftCand?.origin,
                model: leftCand?.provenance?.model ?? null,
                anchor_label: leftCand?.provenance?.anchor_label ?? null,
                anchor_value: leftCand?.provenance?.anchor_value ?? null },
        right: { id: j.right_id, image: shot(right), origin: rightCand?.origin,
                 model: rightCand?.provenance?.model ?? null,
                 anchor_label: rightCand?.provenance?.anchor_label ?? null,
                 anchor_value: rightCand?.provenance?.anchor_value ?? null },
      };
    });

    // Which side each metric prefers, and whether that matched the human.
    const metrics: Record<string, any> = {};
    for (const row of ANALYSIS_METRICS) {
      const key = row.key as string;
      const va = val(a, key);
      const vb = val(b, key);
      const prefers = va == null || vb == null || va === vb
        ? null : (va > vb ? "A" : "B");
      const directional = verdicts.filter((v) => v.chose !== "tie");
      const agree = prefers == null || !directional.length
        ? null
        : directional.filter((v) => v.chose === prefers).length / directional.length;
      metrics[key] = { a: va, b: vb, delta: va != null && vb != null ? va - vb : null, prefers, agree };
    }

    return {
      case_no: pair.case_no ?? null,
      pair_id: pair.id,
      ref_id: pair.ref_id,
      family: famOf.get(pair.ref_id) ?? "—",
      ref_image: refImg.get(pair.ref_id) ?? null,
      cohort: pair.cohort ?? "—",
      // The evaluator records why a channel is unavailable. Carrying it through
      // is what turns a bare dash into "this mesh is not watertight, so there
      // is no topology" instead of an apparent hole in the data.
      a: { id: pair.a, origin: aCand?.origin, model: aCand?.provenance?.model ?? null,
           warnings: (a as any)?.metrics?.warnings ?? [] },
      b: { id: pair.b, origin: bCand?.origin, model: bCand?.provenance?.model ?? null,
           warnings: (b as any)?.metrics?.warnings ?? [] },
      verdicts,
      judged: verdicts.length,
      metrics,
      // How divided the metrics are on this case. Cases where the metrics
      // themselves disagree are the ones a human verdict actually settles.
      metric_split: (() => {
        const votes = Object.values(metrics)
          .map((m: any) => m.prefers).filter(Boolean);
        const aVotes = votes.filter((v) => v === "A").length;
        return { a: aVotes, b: votes.length - aVotes, total: votes.length };
      })(),
    };
  });

  rows.sort((x, y) => (x.case_no ?? 0) - (y.case_no ?? 0));
  return NextResponse.json({
    rows,
    metrics: ANALYSIS_METRICS.map((m) => ({ key: m.key, label: m.label,
                                           short: m.short ?? (m.key as string) })),
    viewing: subject,
    is_admin: admin,
    // Only an administrator gets the roster; for anyone else the list of who
    // else is rating is not theirs to see.
    raters: admin ? [...new Set(judgments.map((j) => j.rater))].sort() : [],
  });
}
