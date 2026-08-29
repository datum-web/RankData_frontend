import { NextResponse } from "next/server";
import { judgmentsFor, loadCorpus } from "@/lib/store";
import { raterFromRequest } from "@/lib/auth";
import { hash } from "@/lib/hash";
import { METRIC_ROWS, type MetricStats, type PairView } from "@/lib/types";
import { scoresFor } from "@/lib/corpus";
import { isBlind } from "@/lib/blind";
import { aOnLeft, buildQueue, disagreement } from "@/lib/queue";

export const dynamic = "force-dynamic";

/* Queue order lives in lib/queue.ts, with its tests.
 *
 * An earlier version stratified by family so the same family would not appear
 * twice running. It worked on its own terms — 0 % adjacent same-family — but it
 * is not what was asked for, and stratifying by family did nothing about the
 * thing a rater actually notices, which is the same reference part coming back
 * (one spline hub owns nine of the fifty open pairs). A flat shuffle is the
 * honest version of "random": clusters happen, and they are what random looks
 * like.
 *
 * Deterministic per rater, so a rater resumes exactly where they stopped, and
 * different between raters, so order effects do not align across people.
 */

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Corpus-wide distribution per metric, so a raw number can be read as high or low. */
function metricStats(all: any[]): Record<string, MetricStats> {
  // Score anchors are targets drawn from a fixed grid, not measurements of a
  // solid. Leaving them in put 88 synthetic values into the distribution the
  // rater is shown as "where this sits in the corpus", which is a claim about
  // real reconstructions.
  const candidates = all.filter((c) => c.origin !== "anchor");
  const out: Record<string, MetricStats> = {};
  for (const row of METRIC_ROWS) {
    const key = row.key as string;
    const values = candidates
      .map((c) => (key === "v1_iou" ? c.v1_iou : c.metrics?.[key]))
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v))
      .sort((a, b) => a - b);
    if (!values.length) continue;
    const min = values[0];
    const max = values[values.length - 1];
    out[key] = {
      min, max,
      p25: quantile(values, 0.25),
      median: quantile(values, 0.5),
      p75: quantile(values, 0.75),
      n: values.length,
      constant: max - min < 1e-9,
      // Sorted values so the client can place a score by rank. Linear min-max
      // is unreadable here: one outlier (face 0.1254 against a p25 of 0.89)
      // squashes every real difference into the last few pixels.
      values,
    };
  }
  return out;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  // Identity is taken from the signed session, never from the request, so a
  // rater cannot read or overwrite another rater's queue by changing a param.
  let rater: string | null;
  try {
    rater = (await raterFromRequest(req))?.email ?? null;
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "server not configured" }, { status: 500 });
  }
  if (!rater) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  let corpus, done;
  try {
    corpus = await loadCorpus();
    done = await judgmentsFor(rater);
  } catch (err: any) {
    // Misconfiguration must say what is wrong in the response, not only in a
    // log the person deploying will not read.
    return NextResponse.json({ error: err?.message ?? "backend unavailable" }, { status: 500 });
  }
  const wanted = url.searchParams.get("pair");

  const byId = new Map(corpus.candidates.map((c) => [c.id, c]));
  const refById = new Map(corpus.refs.map((r) => [r.id, r]));

  // Optional cohort filter, `?cohort=native` or a comma-separated list. The
  // queue is a flat shuffle over everything by default, which is right for an
  // unbiased sample — but 341 of the 1189 pairs are the same record built two
  // different ways, and those are the comparisons the metric exists to be
  // judged against. Being able to spend a session on them is worth more than
  // insisting every session be representative.
  const scoresForQueue = scoresFor(corpus);
  const cohorts = (url.searchParams.get("cohort") || "")
    .split(",").map((c) => c.trim()).filter(Boolean);
  const eligible = corpus.pairs.filter(
    (p) => !done.has(p.id) && (!cohorts.length || cohorts.includes(p.cohort ?? "")));
  // An anchor is a picture against a number, so it carries one channel and
  // `disagreement` is 0 for every one of them -- which sorts all 360 into the
  // last band, and a rater would meet their first anchor somewhere past pair
  // 800. They are 30 % of the queue precisely so they are encountered
  // throughout it, so they get a stable pseudo-random rank instead: spread
  // evenly through the bands, and decorrelated between raters like everything
  // else here.
  const info = new Map(eligible.map((p) => [
    p.id,
    p.cohort === "score-anchor"
      ? (hash(`anchor::${p.id}::${rater}`) % 1000) / 1000
      : disagreement(scoresForQueue.value, p),
  ]));
  const queue = buildQueue(eligible, {
    rater: rater!,
    info,
    corePairs: Number(process.env.PREFERENCE_LAB_CORE_PAIRS ?? 200),
    // Random, and random by default.
    //
    // The queue used to lead with the 200 most contested pairs and then band
    // the rest by how much the metrics disagree. That makes the metrics choose
    // which pairs a person is asked about -- and the verdicts are then used to
    // judge those same metrics. A sample selected by the thing under test is
    // not a sample of the corpus, and every rate computed from it (agreement,
    // tie rate, difficulty) describes the contested tail rather than the
    // benchmark. `?order=informative` still exists for looking at that tail
    // deliberately; it is not what a rater gets.
    mode: url.searchParams.get("order") === "informative" ? "informative" : "shuffle",
  });

  // `?after=<id>` returns the pair that follows the given one in this rater's
  // queue, without consuming anything. It exists so the client can fetch the
  // next pair's payload and warm its three renders while the rater is still
  // looking at the current one -- the images stream through `/api/image` from
  // private storage, so a cold pair is three proxied downloads after the click
  // and the wait is the whole delay between judging and judging again.
  const after = url.searchParams.get("after");
  const following = () => {
    const at = queue.findIndex((p) => p.id === after);
    return at >= 0 ? queue[at + 1] : queue[0];
  };
  const pair = wanted
    ? corpus.pairs.find((p) => p.id === wanted)
    : after ? following() : queue[0];

  if (!pair) {
    return NextResponse.json({
      done: true,
      cohort: cohorts.length ? cohorts.join(",") : null,
      total: cohorts.length ? corpus.pairs.filter(
        (p) => cohorts.includes(p.cohort ?? "")).length : corpus.pairs.length,
      remaining: 0,
      judged: done.size,
    });
  }

  // A candidate's score and its picture both depend on which reference it is
  // being shown against, so both come from the evaluation for (candidate, this
  // pair's reference) rather than off the candidate. Reading them off the
  // candidate quoted the reference it was generated for, which in a
  // cross-reference pair is not the one on screen.
  const scores = scoresForQueue;
  const merge = (id: string) => {
    const c = byId.get(id);
    const e = scores.of(id, pair.ref_id);
    if (!c || !e) return null;
    return { ...c, metrics: e.metrics, v1_iou: e.v1_iou,
             image: e.image ?? c.image, image_v0: e.image_v0 ?? c.image_v0,
             stimulus: e.stimulus ?? c.stimulus };
  };
  const a = merge(pair.a);
  const b = merge(pair.b);
  const reference = refById.get(pair.ref_id);
  if (!a || !b || !reference) {
    return NextResponse.json({
      error: `pair ${pair.id} has no evaluation against ${pair.ref_id}`,
    }, { status: 500 });
  }

  const left = aOnLeft(pair.id, rater);
  const view: PairView = {
    pair,
    reference,
    left: left ? a : b,
    right: left ? b : a,
    aShownLeft: left,
    blind: isBlind(pair.id, rater),
    info: info.get(pair.id) ?? 0,
    // Counted within the cohort when one is selected, so "12 of 341" means what
    // it says rather than quietly numbering against the whole corpus.
    cohort: cohorts.length ? cohorts.join(",") : null,
    index: (cohorts.length
      ? corpus.pairs.filter((p) => cohorts.includes(p.cohort ?? "")).length
      : corpus.pairs.length) - queue.length + 1,
    total: cohorts.length
      ? corpus.pairs.filter((p) => cohorts.includes(p.cohort ?? "")).length
      : corpus.pairs.length,
    remaining: queue.length,
    // The corpus distribution is over evaluations, not candidates: the same
    // solid scored against two references contributes two real measurements,
    // and a candidate with none contributes nothing.
    stats: metricStats(corpus.evaluations.filter(
      (e) => byId.get(e.candidate_id)?.origin !== "anchor")),
  };
  return NextResponse.json(view);
}
