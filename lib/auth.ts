/**
 * Access control, backed by Supabase Auth.
 *
 * Supabase owns identity: user records, password hashing, resets and the admin
 * UI. This module does not implement any of that and deliberately contains no
 * hand-rolled crypto — an earlier version signed its own session cookies, which
 * was unnecessary when the project already has an auth service.
 *
 * Flow: `/api/session` exchanges email + password for a Supabase access token
 * and stores it in an httpOnly cookie. Every data route verifies that token
 * locally against the project's published JWKS, so there is no network hop per
 * request and no shared secret in the app.
 *
 * Public signup is disabled on the project; users are created by an
 * administrator. The token itself is never exposed to client JavaScript.
 */

import { createRemoteJWKSet, jwtVerify } from "jose";

export const SESSION_COOKIE = "pl_session";

/** Access tokens live as long as the project's `jwt_exp` (set to 7 days), so
 *  there is no refresh dance; the cookie simply expires with the token. */
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7;

function projectUrl(): string {
  const url = process.env.SUPABASE_URL;
  if (!url) throw new Error("SUPABASE_URL is not set");
  return url.replace(/\/$/, "");
}

// Cached across invocations; `jose` refetches on unknown key id, so a signing
// key rotation heals itself without a redeploy.
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function keySet() {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${projectUrl()}/auth/v1/.well-known/jwks.json`));
  }
  return jwks;
}

export type Rater = { id: string; email: string };

export async function raterFromRequest(req: Request): Promise<Rater | null> {
  // Local development has no Supabase project, so nobody can sign in and the
  // whole app is unreachable. PREFERENCE_LAB_DEV_RATER restores it, and cannot
  // apply to a deployment: it requires SUPABASE_URL to be absent, and the store
  // already refuses to boot on Vercel without Supabase configured.
  const devRater = process.env.PREFERENCE_LAB_DEV_RATER;
  if (devRater && !process.env.SUPABASE_URL && !process.env.VERCEL) {
    return { id: "dev", email: devRater };
  }

  const token = req.headers
    .get("cookie")
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, keySet(), {
      issuer: `${projectUrl()}/auth/v1`,
    });
    const id = typeof payload.sub === "string" ? payload.sub : null;
    const email = typeof payload.email === "string" ? payload.email : null;
    if (!id || !email) return null;
    // A token minted for the anon or service role is not a user session.
    if (payload.role !== "authenticated") return null;
    return { id, email };
  } catch {
    // Expired, tampered, wrong issuer, unknown key — all just "not signed in".
    return null;
  }
}

/**
 * Cookie flags for the session.
 *
 * `secure` follows the **request's** protocol, not NODE_ENV. `next start` runs
 * with NODE_ENV=production, so keying off it marked the cookie Secure on
 * http://localhost and every browser silently dropped it — sign-in appeared to
 * succeed and then nothing was authenticated. Behind Vercel the TLS terminates
 * at the edge, so the forwarded protocol header is the authority.
 */
export function sessionCookieOptions(req?: Request) {
  let https = true;
  if (req) {
    const forwarded = req.headers.get("x-forwarded-proto");
    https = forwarded
      ? forwarded.split(",")[0].trim() === "https"
      : new URL(req.url).protocol === "https:";
  }
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: https,
    path: "/",
    maxAge: SESSION_MAX_AGE,
  };
}

/**
 * Administrators, by email, from `PREFERENCE_LAB_ADMINS` (comma-separated).
 *
 * An explicit list rather than a flag on the account: adding an admin should
 * require a deploy-time change someone can review, not a row edit. With the
 * variable unset nobody is an administrator, so a misconfigured deployment
 * locks the admin view rather than opening it.
 */
export function isAdmin(email: string): boolean {
  const raw = process.env.PREFERENCE_LAB_ADMINS ?? "";
  const admins = raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  return admins.includes(email.trim().toLowerCase());
}
