import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { backend } from "@/lib/store";
import { raterFromRequest } from "@/lib/auth";

/**
 * Server-side image proxy.
 *
 * The deployable repository is public, so the CAD renders are not in it — they
 * live in a private Supabase Storage bucket. This route fetches them with the
 * service key and streams the bytes, so no Supabase URL, bucket name or key
 * ever reaches the browser.
 *
 * With no Supabase configured (local development) it serves the same file from
 * `public/pairs/`, which is gitignored. One code path in the UI either way.
 */

const NAME = /^[A-Za-z0-9._-]+\.png$/;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  // Renders are corpus data; without this the images would be public even
  // though the rows behind them are not.
  let rater: string | null;
  try {
    rater = (await raterFromRequest(req))?.email ?? null;
  } catch (err: any) {
    return NextResponse.json({ error: err?.message ?? "server not configured" }, { status: 500 });
  }
  if (!rater) return NextResponse.json({ error: "not authenticated" }, { status: 401 });

  const { name } = await params;

  // Path traversal guard: the name is used to build a filesystem path and a
  // storage key, so anything but a bare PNG file name is rejected outright.
  if (!NAME.test(name) || name.includes("..")) {
    return NextResponse.json({ error: "bad image name" }, { status: 400 });
  }

  const headers = {
    "Content-Type": "image/png",
    // Renders are immutable for a given name; a re-ingest writes a new dataset.
    "Cache-Control": "private, max-age=3600",
  };

  if (backend() === "supabase") {
    const bucket = process.env.PREFERENCE_LAB_BUCKET || "preference-lab";
    const url =
      `${process.env.SUPABASE_URL!.replace(/\/$/, "")}` +
      `/storage/v1/object/${bucket}/pairs/${encodeURIComponent(name)}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
      },
      cache: "no-store",
    });
    if (!res.ok) {
      return NextResponse.json(
        { error: `storage ${res.status} for ${name}` },
        { status: res.status === 404 ? 404 : 502 },
      );
    }
    return new NextResponse(await res.arrayBuffer(), { headers });
  }

  try {
    const file = path.join(process.cwd(), "public", "pairs", name);
    return new NextResponse(new Uint8Array(await fs.readFile(file)), { headers });
  } catch {
    return NextResponse.json({ error: `not found: ${name}` }, { status: 404 });
  }
}
