import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { backend } from "@/lib/store";
import { raterFromRequest } from "@/lib/auth";

/**
 * Server-side mesh proxy — the same shape as the image route, for the geometry.
 *
 * Four fixed views cannot show a rater a tooth flank or the inside of a bore,
 * so the page can load the solid itself and let them turn it. The meshes are
 * corpus data exactly like the renders: private bucket, service key server
 * side, nothing about Supabase reaching the browser.
 */

const NAME = /^[A-Za-z0-9._-]+\.plm$/;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  // Geometry is the most sensitive thing here: a mesh is the answer. Without
  // this gate the corpus would be downloadable by anyone with a URL.
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
    return NextResponse.json({ error: "bad mesh name" }, { status: 400 });
  }

  const headers = {
    "Content-Type": "application/octet-stream",
    // Immutable for a given name; a re-ingest writes a new dataset.
    "Cache-Control": "private, max-age=86400",
  };

  if (backend() === "supabase") {
    const bucket = process.env.PREFERENCE_LAB_BUCKET || "preference-lab";
    const url =
      `${process.env.SUPABASE_URL!.replace(/\/$/, "")}` +
      `/storage/v1/object/${bucket}/meshes/${encodeURIComponent(name)}`;
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
    const file = path.join(process.cwd(), "public", "meshes", name);
    return new NextResponse(new Uint8Array(await fs.readFile(file)), { headers });
  } catch {
    return NextResponse.json({ error: `not found: ${name}` }, { status: 404 });
  }
}
