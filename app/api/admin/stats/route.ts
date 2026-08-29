import { NextResponse } from "next/server";
import { allJudgments, backend, loadCorpus, listAccounts } from "@/lib/store";
import { ANALYSIS_METRICS } from "@/lib/types";
import { isAdmin, raterFromRequest } from "@/lib/auth";
import { countsForMetric, countsNow, scoresFor } from "@/lib/corpus";

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
 * Study-wide view for whoever runs the study.
 *
 * Deliberately answers the questions a rater's dashboard must not: who has
 * done what, where coverage is thin, whether two raters who saw the same pair
 * agreed, and whether a metric's apparent agreement holds once the two cohorts
 * are separated.
 */
export async function GET(req: Request) {
  let me;
  try {
    me = await raterFromRequest(req);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "server not configured" }, { status: 500 });
  }
  if (!me) return NextResponse.json({ error: "not authenticated" }, { status: 401 });
  if (!isAdmin(me.email)) {
    return NextResponse.json({ error: "not an administrator" }, { status: 403 });
  }

  let corpus, judgments, accounts;
  try {
    [corpus, judgments] = await Promise.all([loadCorpus(), allJudgments()]);
    accounts = await listAccounts();
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "backend unavailable" }, { status: 500 });
  }

  // See the rater dashboard: one idle pair can dominate a sum, so totals are
  // capped per pair and the number of capped rows is surfaced.
  const IDLE_CAP_MS = 10 * 60 * 1000;

  const byPair = new Map(corpus.pairs.map((p) => [p.id, p]));
  const scores = scoresFor(corpus);
  const byCand = new Map(corpus.candidates.map((c) => [c.id, c]));
  // Metrics are keyed by (candidate, the reference the pair shows). Reading
  // them off the candidate quoted the reference it was generated for, which in
  // a cross-reference pair is a different question from the one the rater
  // answered.

  const total = corpus.pairs.length;

  // ---- per rater -----------------------------------------------------------
  const raters = [...new Set([
    ...judgments.map((j) => j.rater),
    ...accounts.map((a) => a.email),
  ])].sort();

  const mval = (c: any, key: string) =>
    key === "v1_iou" ? c?.v1_iou ?? null : c?.metrics?.[key] ?? null;

  /**
   * How often each metric picked the same side this rater did.
   *
   * The corpus-wide number hides the thing an administrator needs: whether one
   * rater is reading the geometry differently from the others, or from the
   * metrics. Counted only over directional verdicts on pairs where the metric
   * actually separates the two candidates.
   */
  // Restricted to verdicts the current stimulus did not invalidate. This route
  // carried its own copy of that rule, naming a stimulus that has since been
  // retired, so per-rater agreement was computed over 6 verdicts instead of 187
  // — the exact divergence `lib/corpus` exists to prevent, in a file that
  // already imports from it. One definition, used here too.
  function metricAgreement(all: any[]) {
    const mine = all;
    const out: Record<string, { agree: number; n: number }> = {};
    for (const row of ANALYSIS_METRICS) {
      const key = row.key as string;
      let agree = 0, n = 0;
      for (const j of mine.filter((x: any) => countsForMetric(key, x))) {
        if (j.is_tie || !j.chosen_id) continue;
        const pair = byPair.get(j.pair_id);
        if (!pair) continue;
        const va = mval(scores.of(pair.a, pair.ref_id), key);
        const vb = mval(scores.of(pair.b, pair.ref_id), key);
        if (va == null || vb == null || va === vb) continue;
        n++;
        const prefers = va > vb ? pair.a : pair.b;
        if (prefers === j.chosen_id) agree++;
      }
      out[key] = { agree, n };
    }
    return out;
  }

  const perRater = raters.map((email) => {
    const mine = judgments.filter((j) => j.rater === email);
    const scored = mine.filter((j) => !j.is_tie && j.chosen_id);
    const left = scored.filter((j) => j.chosen_id === j.left_id).length;
    const acct = accounts.find((a) => a.email.toLowerCase() === email.toLowerCase());
    return {
      metric_agreement: metricAgreement(mine),
      superseded: mine.filter((j) => !countsNow(j)).length,
      by_cohort: tally(mine.map((j) => byPair.get(j.pair_id)?.cohort ?? "unlabelled")),
      by_stimulus: tally(mine.map((j) => j.stimulus ?? "per-shape-normalised-v0")),
      email,
      judged: mine.length,
      remaining: total - mine.length,
      ties: mine.length - scored.length,
      median_decision_ms: median(mine.map((j) => j.decision_ms).filter(Number.isFinite)),
      total_time_ms: mine.reduce((a, j) => a + Math.min(j.decision_ms || 0, IDLE_CAP_MS), 0),
      capped: mine.filter((j) => (j.decision_ms || 0) > IDLE_CAP_MS).length,
      by_confidence: tally(mine.map((j) => j.confidence)),
      left_pick_rate: scored.length ? left / scored.length : null,
      last_activity: mine.length
        ? mine.map((j) => j.created_at).sort().slice(-1)[0]
        : null,
      account: acct ? { exists: true, banned: acct.banned, last_sign_in: acct.last_sign_in } : { exists: false },
    };
  });

  // ---- coverage ------------------------------------------------------------
  const perPair = new Map<string, any[]>();
  for (const j of judgments) {
    if (!perPair.has(j.pair_id)) perPair.set(j.pair_id, []);
    perPair.get(j.pair_id)!.push(j);
  }
  const counts = corpus.pairs.map((p) => perPair.get(p.id)?.length ?? 0);
  const coverage = {
    unjudged: counts.filter((n) => n === 0).length,
    once: counts.filter((n) => n === 1).length,
    twice_or_more: counts.filter((n) => n >= 2).length,
    total,
  };

  // ---- inter-rater agreement ----------------------------------------------
  // Only pairs two different raters both gave a direction on. Anything less is
  // not agreement, it is one opinion.
  let both = 0, same = 0;
  const disputes: any[] = [];
  for (const [pairId, list] of perPair) {
    const directional = list.filter((j) => !j.is_tie && j.chosen_id);
    const byRater = new Map(directional.map((j) => [j.rater, j]));
    if (byRater.size < 2) continue;
    const entries = [...byRater.values()];
    for (let i = 0; i < entries.length; i++) {
      for (let k = i + 1; k < entries.length; k++) {
        both += 1;
        if (entries[i].chosen_id === entries[k].chosen_id) same += 1;
        else {
          const pair = byPair.get(pairId);
          disputes.push({
            pair_id: pairId,
            ref_id: pair?.ref_id,
            cohort: pair?.cohort,
            a: { rater: entries[i].rater, chose: entries[i].chosen_id, confidence: entries[i].confidence },
            b: { rater: entries[k].rater, chose: entries[k].chosen_id, confidence: entries[k].confidence },
          });
        }
      }
    }
  }

  // ---- per-metric agreement, split by cohort -------------------------------
  const cohorts = [...new Set(corpus.pairs.map((p) => p.cohort ?? "unlabelled"))];
  const scoredAll = judgments.filter((j) => !j.is_tie && j.chosen_id);
  const metric_agreement = ANALYSIS_METRICS.map((row) => {
    const key = row.key as string;
    // Same rule as above: a picture-derived metric may only be paired with a
    // verdict cast on the pictures it was computed from.
    const eligible = (j: any) => countsForMetric(key, j);
    const row_out: any = { key, label: row.label, overall: null, by_cohort: {} };
    const count = (subset: any[]) => {
      let agree = 0, usable = 0;
      for (const j of subset.filter(eligible)) {
        const pair = byPair.get(j.pair_id);
        if (!pair) continue;
        const va = val(scores.of(pair.a, pair.ref_id), key);
        const vb = val(scores.of(pair.b, pair.ref_id), key);
        if (va == null || vb == null || va === vb) continue;
        usable += 1;
        if ((va > vb) === (j.chosen_id === pair.a)) agree += 1;
      }
      return { agree, usable, rate: usable ? agree / usable : null };
    };
    row_out.overall = count(scoredAll);
    for (const c of cohorts) {
      row_out.by_cohort[c] = count(
        scoredAll.filter((j) => (byPair.get(j.pair_id)?.cohort ?? "unlabelled") === c),
      );
    }
    return row_out;
  });

  // ---- family distribution -------------------------------------------------
  // The corpus is not a balanced sample of mechanical parts, and it never
  // claimed to be: it inherits whatever the generator produced, which is heavy
  // on rings and fasteners. That skew decides what every aggregate on this page
  // means — an overall agreement figure is mostly a statement about washers —
  // so it is measured here rather than left to be noticed.
  //
  // Reported at four levels because they skew differently: a family can have
  // many references and few pairs, or many pairs and no verdicts at all.
  const famOfRef = new Map(corpus.refs.map((r) => [r.id, r.family]));
  const famRows = new Map<string, {
    family: string; refs: number; candidates: number;
    pairs: number; judged: number; verdicts: number;
  }>();
  const famRow = (family: string) => {
    if (!famRows.has(family)) {
      famRows.set(family, { family, refs: 0, candidates: 0, pairs: 0, judged: 0, verdicts: 0 });
    }
    return famRows.get(family)!;
  };
  for (const r of corpus.refs) famRow(r.family).refs += 1;
  for (const c of corpus.candidates.filter((c: any) => c.origin !== "anchor")) {
    const f = famOfRef.get(c.ref_id);
    if (f) famRow(f).candidates += 1;
  }
  for (const p of corpus.pairs) {
    const f = famOfRef.get(p.ref_id);
    if (!f) continue;
    const row = famRow(f);
    row.pairs += 1;
    const seen = perPair.get(p.id)?.length ?? 0;
    if (seen) {
      row.judged += 1;
      row.verdicts += seen;
    }
  }
  const families = [...famRows.values()].sort((a, b) => b.pairs - a.pairs || a.family.localeCompare(b.family));

  // How concentrated the corpus is, in one number per level. The effective
  // count is exp(Shannon entropy): the number of *equally sized* families that
  // would produce the same spread. 104 families with an effective count of 40
  // means the tail is decorative.
  const effective = (xs: number[]) => {
    const total = xs.reduce((a, b) => a + b, 0);
    if (!total) return null;
    let h = 0;
    for (const x of xs) {
      if (x <= 0) continue;
      const p = x / total;
      h -= p * Math.log(p);
    }
    return Math.exp(h);
  };
  const share = (xs: number[], top: number) => {
    const total = xs.reduce((a, b) => a + b, 0);
    if (!total) return null;
    return [...xs].sort((a, b) => b - a).slice(0, top).reduce((a, b) => a + b, 0) / total;
  };
  const level = (pick: (r: typeof families[number]) => number) => {
    const xs = families.map(pick);
    return {
      total: xs.reduce((a, b) => a + b, 0),
      families_present: xs.filter((x) => x > 0).length,
      effective_families: effective(xs),
      top5_share: share(xs, 5),
      singletons: xs.filter((x) => x === 1).length,
    };
  };
  const distribution = {
    families,
    concentration: {
      references: level((r) => r.refs),
      candidates: level((r) => r.candidates),
      pairs: level((r) => r.pairs),
      verdicts: level((r) => r.verdicts),
    },
  };

  return NextResponse.json({
    backend: backend(),
    distribution,
    corpus: {
      references: corpus.refs.length,
      // Anchors excluded: they are target numbers, not reconstructions, and
      // counting them told the reader the corpus holds 3,518 candidates when
      // 2,074 are solids and 1,444 are values from a fixed grid.
      candidates: corpus.candidates.filter((c: any) => c.origin !== "anchor").length,
      pairs: total,
      families: tally(corpus.refs.map((r) => r.family)),
      cohorts: tally(corpus.pairs.map((p) => p.cohort ?? "unlabelled")),
    },
    accounts: accounts.length,
    metric_keys: ANALYSIS_METRICS.map((m) => m.key as string),
    raters: perRater,
    coverage,
    inter_rater: {
      comparable: both,
      agree: same,
      rate: both ? same / both : null,
      disputes: disputes.slice(0, 25),
    },
    metric_agreement,
    cohorts,
  });
}
