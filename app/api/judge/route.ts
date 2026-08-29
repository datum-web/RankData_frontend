import { NextResponse } from "next/server";
import { loadCorpus, saveJudgment } from "@/lib/store";
import { raterFromRequest } from "@/lib/auth";
import { isBlind } from "@/lib/blind";
import type { Judgment } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  let sessionRater: string | null;
  try {
    sessionRater = (await raterFromRequest(req))?.email ?? null;
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "server not configured" }, { status: 500 });
  }
  if (!sessionRater) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const required = ["pair_id", "confidence", "left_id", "right_id", "decision_ms"];
  for (const key of required) {
    if (body[key] === undefined || body[key] === null || body[key] === "") {
      return NextResponse.json({ error: `${key} required` }, { status: 400 });
    }
  }

  const confidence = Number(body.confidence);
  if (![1, 2, 3, 4].includes(confidence)) {
    return NextResponse.json({ error: "confidence must be 1..4" }, { status: 400 });
  }

  const isTie = Boolean(body.is_tie);
  const chosen = isTie ? null : body.chosen_id;
  if (!isTie && !chosen) {
    return NextResponse.json({ error: "chosen_id required unless is_tie" }, { status: 400 });
  }

  // The verdict must name a candidate that is actually in this pair. Without
  // this a client bug could silently record a preference for the wrong solid.
  const corpus = await loadCorpus();
  const pair = corpus.pairs.find((p) => p.id === body.pair_id);
  if (!pair) return NextResponse.json({ error: "unknown pair" }, { status: 400 });
  const members = new Set([pair.a, pair.b]);
  if (!members.has(body.left_id) || !members.has(body.right_id)) {
    return NextResponse.json({ error: "left/right are not this pair's candidates" }, { status: 400 });
  }
  if (chosen && !members.has(chosen)) {
    return NextResponse.json({ error: "chosen_id is not in this pair" }, { status: 400 });
  }

  const judgment: Judgment = {
    pair_id: body.pair_id,
    rater: sessionRater,
    chosen_id: chosen,
    is_tie: isTie,
    confidence: confidence as 1 | 2 | 3 | 4,
    left_id: body.left_id,
    right_id: body.right_id,
    // Recomputed, not believed. This flag is the whole basis of the blind
    // analysis, and taking it from the request body would make the one field
    // that has to be trustworthy the one field a browser can set freely.
    metrics_shown: !isBlind(String(body.pair_id), sessionRater),
    decision_ms: Math.max(0, Math.round(Number(body.decision_ms))),
    time_to_first_input_ms:
      body.time_to_first_input_ms == null ? null : Math.max(0, Math.round(Number(body.time_to_first_input_ms))),
    metric_dwell_ms: Math.max(0, Math.round(Number(body.metric_dwell_ms) || 0)),
    hidden_ms: Math.max(0, Math.round(Number(body.hidden_ms) || 0)),
    metric_interactions: Array.isArray(body.metric_interactions) ? body.metric_interactions : [],
    notes: body.notes ? String(body.notes).slice(0, 2000) : null,
    client: body.client && typeof body.client === "object" ? body.client : {},
    // Which images this verdict was formed from. Recorded server-side, from the
    // corpus rather than the client, because a verdict is only interpretable
    // against the stimulus that produced it -- the first image set hid uniform
    // size errors entirely, so pooling the two sets would mix judgements about
    // a defect with judgements about a defect the rater could not see.
    // From whichever side actually has one, not from `left`. An anchor is a
    // number and carries no stimulus, so an anchor-on-the-left pair fell to the
    // legacy default and every anchor verdict was stamped
    // `per-shape-normalised-v0` -- saved, but excluded from every statistic
    // that compares stimuli, which is all of them. Silent: the click succeeds
    // and the verdict simply never counts.
    stimulus: [body.left_id, body.right_id]
      .map((id) => corpus.candidates.find((c) => c.id === id)?.stimulus)
      .find((x) => x) ?? "per-shape-normalised-v0",
  };

  try {
    const { revisions } = await saveJudgment(judgment);
    return NextResponse.json({ ok: true, revisions });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "save failed" }, { status: 500 });
  }
}
