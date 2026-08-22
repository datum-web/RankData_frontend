import { NextResponse } from "next/server";
import { SESSION_COOKIE, isAdmin, raterFromRequest, sessionCookieOptions } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** Who am I? The client uses this to decide whether to show the sign-in form. */
export async function GET(req: Request) {
  try {
    const rater = await raterFromRequest(req);
    return NextResponse.json({
      rater: rater?.email ?? null,
      admin: rater ? isAdmin(rater.email) : false,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "server not configured" }, { status: 500 });
  }
}

/**
 * Sign in against Supabase Auth.
 *
 * The password is forwarded to Supabase and never stored, logged or compared
 * here. The returned access token goes straight into an httpOnly cookie, so it
 * is not reachable from client JavaScript.
 */
export async function POST(req: Request) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const email = String(body?.email ?? "").trim().toLowerCase();
  const password = String(body?.password ?? "");
  if (!email || !password) {
    return NextResponse.json({ error: "email and password required" }, { status: 400 });
  }

  const url = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return NextResponse.json(
      { error: "SUPABASE_URL and SUPABASE_ANON_KEY must be set" },
      { status: 500 },
    );
  }

  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
    cache: "no-store",
  });

  if (!res.ok) {
    // One message for every failure mode, so the response cannot be used to
    // learn which email addresses exist.
    return NextResponse.json({ error: "invalid email or password" }, { status: 401 });
  }

  const data = await res.json();
  const token = data?.access_token;
  if (!token) return NextResponse.json({ error: "no token returned" }, { status: 502 });

  const out = NextResponse.json({ rater: data?.user?.email ?? email });
  out.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(req));
  return out;
}

/** Sign out. */
export async function DELETE(req: Request) {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(req), maxAge: 0 });
  return res;
}
