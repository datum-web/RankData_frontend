import { NextResponse } from "next/server";
import { raterFromRequest } from "@/lib/auth";
import { deleteJudgmentsFor } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Clear the signed-in rater's own verdicts and start the queue again.
 *
 * Scoped to the caller by construction: the rater comes from the verified
 * session and there is no parameter to widen it, so one rater cannot wipe
 * another's work or the whole study. Administrators use
 * `ingest/manage_raters.py`-adjacent SQL for anything broader, on purpose —
 * a global wipe should not be one request away from a browser.
 */
export async function POST(req: Request) {
  let rater;
  try {
    rater = await raterFromRequest(req);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "server not configured" }, { status: 500 });
  }
  if (!rater) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  try {
    const deleted = await deleteJudgmentsFor(rater.email);
    return NextResponse.json({ ok: true, deleted, rater: rater.email });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "reset failed" }, { status: 500 });
  }
}
