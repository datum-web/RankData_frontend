import { allJudgments, loadCorpus } from "@/lib/store";
import { METRIC_ROWS } from "@/lib/types";
import { isAdmin, raterFromRequest } from "@/lib/auth";
import { countsNow } from "@/lib/store";
import { CURRENT_STIMULUS, scoresFor } from "@/lib/corpus";

export const dynamic = "force-dynamic";

const val = (e: any, key: string) =>
  key === "v1_iou" ? e?.v1_iou ?? null : e?.metrics?.[key] ?? null;

/**
 * A rater's evaluation history as a spreadsheet.
 *
 * One row per verdict, wide: the case, both candidates, every metric's value on
 * each side, and what the person actually chose. Wide rather than long because
 * the question this file exists to answer — where a metric and a person part
 * company — is a per-row comparison, and a long format would make it a join.
 *
 * Sides are named `left`/`right` as that rater saw them, not the pair's stored
 * A/B order. The shuffle is per (pair, rater), so exporting in A/B order would
 * silently mirror half the rows against the screenshots and the review page.
 */

/**
 * Excel executes a cell that begins with `=`, `+`, `-` or `@`, and the notes
 * field is free text a rater typed. Prefixing with an apostrophe keeps the
 * value readable while making it inert.
 */
function cell(v: unknown): string {
  if (v == null) return "";
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const num = (v: number | null | undefined, d = 6) =>
  typeof v === "number" && Number.isFinite(v) ? v.toFixed(d) : "";

export async function GET(req: Request) {
  let me: string | null;
  let admin = false;
  try {
    const who = await raterFromRequest(req);
    me = who?.email ?? null;
    admin = !!me && isAdmin(me);
  } catch (err: any) {
    return Response.json({ error: err?.message ?? "server not configured" }, { status: 500 });
  }
  if (!me) return Response.json({ error: "not authenticated" }, { status: 401 });

  const params = new URL(req.url).searchParams;
  const want = params.get("rater");
  // `all` is an administrator's export of everybody. Anyone else is confined to
  // their own history, enforced here rather than by which button the page shows.
  const scope = want === "all" ? "all" : (want || me);
  if (scope !== me && !admin) {
    return Response.json({ error: "not an administrator" }, { status: 403 });
  }

  let corpus, judgments;
  try {
    [corpus, judgments] = await Promise.all([loadCorpus(), allJudgments()]);
  } catch (err: any) {
    return Response.json({ error: err?.message ?? "backend unavailable" }, { status: 500 });
  }

  const scores = scoresFor(corpus);
  const byCand = new Map(corpus.candidates.map((c) => [c.id, c]));
  const byPair = new Map(corpus.pairs.map((p) => [p.id, p]));
  // Scores come from the evaluation for (candidate, the reference the pair
  // shows), exactly as every page does. Reading them off the candidate exported
  // whatever reference it was generated for, which for the 100 cross-reference
  // pairs is not the one the rater was looking at — 99 of 181 rows disagreed
  // with the screen, by as much as 0.97 against 0.05.
  const famOf = new Map(corpus.refs.map((r) => [r.id, r.family]));

  const rows = judgments
    .filter((j) => scope === "all" || j.rater === scope)
    .sort((a, b) => String(a.rater).localeCompare(String(b.rater))
      || ((byPair.get(a.pair_id)?.case_no ?? 0) - (byPair.get(b.pair_id)?.case_no ?? 0)));

  const keys = METRIC_ROWS.map((m) => m.key as string);
  const header = [
    "rater", "case_no", "pair_id", "cohort", "family", "reference_id", "stimulus",
    "judged_at", "counts_now", "stimulus_equivalent", "metrics_were_wrong",
    "chose", "chosen_id", "confidence", "confidence_label",
    "decision_ms", "decision_ms_net", "hidden_ms", "notes",
    "left_id", "left_origin", "left_model",
    "right_id", "right_origin", "right_model",
    ...keys.flatMap((k) => [`${k}_left`, `${k}_right`, `${k}_gap`, `${k}_favours`, `${k}_agreed`]),
  ];

  const CONF: Record<number, string> = {
    1: "tie", 2: "slightly better", 3: "better", 4: "much better",
  };

  const lines = [header.map(cell).join(",")];
  for (const j of rows) {
    const pair = byPair.get(j.pair_id);
    if (!pair) continue;
    const left = byCand.get(j.left_id);
    const right = byCand.get(j.right_id);
    const leftIsA = j.left_id === pair.a;
    const chose = j.is_tie ? "tie" : (j.chosen_id === j.left_id ? "left" : "right");

    const out: string[] = [
      cell(j.rater),
      cell(pair.case_no ?? ""),
      cell(pair.id),
      cell(pair.cohort ?? ""),
      cell(famOf.get(pair.ref_id) ?? ""),
      cell(pair.ref_id),
      cell(j.stimulus ?? "per-shape-normalised-v0"),
      cell((j as any).created_at ?? ""),
      // Whether this verdict is counted against the current images, and why.
      // `stimulus_equivalent` means the image change did not alter the evidence
      // in this pair; `metrics_were_wrong` means the figures shown beside it
      // were computed against a different reference from the one displayed.
      cell(String(countsNow(j, CURRENT_STIMULUS))),
      cell(String((j as any).stimulus_equivalent === true)),
      cell(String((j as any).metrics_were_wrong === true)),
      cell(chose),
      cell(j.chosen_id ?? ""),
      cell(j.confidence),
      cell(CONF[j.confidence] ?? ""),
      cell(j.decision_ms ?? ""),
      // What the rater actually spent on it: a pair left open in a background
      // tab once recorded 3.2 hours, and that is idle time, not deliberation.
      cell(Math.max(0, (j.decision_ms ?? 0) - (j.hidden_ms ?? 0))),
      cell(j.hidden_ms ?? 0),
      cell(j.notes ?? ""),
      cell(j.left_id), cell(left?.origin ?? ""), cell(left?.provenance?.model ?? ""),
      cell(j.right_id), cell(right?.origin ?? ""), cell(right?.provenance?.model ?? ""),
    ];

    for (const k of keys) {
      const va = val(scores.of(pair.a, pair.ref_id), k);
      const vb = val(scores.of(pair.b, pair.ref_id), k);
      const l = leftIsA ? va : vb;
      const r = leftIsA ? vb : va;
      const gap = l != null && r != null ? Math.abs(l - r) : null;
      const favours = l == null || r == null || l === r ? "" : (l > r ? "left" : "right");
      // Blank rather than FALSE when the metric cannot separate the pair or the
      // rater called it a tie: there is no agreement to report, and a FALSE
      // there would be counted as a disagreement by anyone summing the column.
      const agreed = !favours || chose === "tie" ? "" : String(favours === chose);
      out.push(num(l), num(r), num(gap), cell(favours), agreed);
    }
    lines.push(out.join(","));
  }

  const name = scope === "all" ? "all-raters" : scope.replace(/[^a-z0-9]+/gi, "-");
  // The BOM is what makes Excel read this as UTF-8 instead of the local
  // codepage; without it non-ASCII notes arrive mangled.
  const body = "﻿" + lines.join("\r\n") + "\r\n";
  return new Response(body, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="preference-lab-${name}.csv"`,
      "cache-control": "no-store",
    },
  });
}
