import { NextResponse } from "next/server";
import { backend } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * Deploy health check. Deliberately unauthenticated, and deliberately empty.
 *
 * A deployment gate should not need credentials, so this is the one route
 * outside the session gate. It therefore reports **nothing about the corpus** —
 * no counts, no families, no verdicts — only whether the server booted with a
 * database behind it. Everything else stays behind `/api/session`.
 */
export async function GET() {
  try {
    return NextResponse.json({ ok: true, backend: backend() });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "not configured" },
      { status: 500 },
    );
  }
}
