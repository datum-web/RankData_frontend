# RankData — pairwise preference frontend

Next.js app for collecting expert pairwise preference over CAD reconstructions.
Frontend and backend are one deployable: the pages are the UI, `app/api/*` are
the server.

**This repository contains code only.** The corpus — reference and candidate
renders, and every evaluator metric — lives in Supabase: rows in Postgres,
images in a private Storage bucket streamed through `/api/image` with the
service key, which never reaches the browser.

## Configuration

Server-side only. Never prefix these with `NEXT_PUBLIC_`; the service-role key
is a full-access database credential.

    PREFERENCE_LAB_ADMINS        comma-separated emails allowed to see /admin
    SUPABASE_URL                 https://<project>.supabase.co
    SUPABASE_ANON_KEY            <anon key; used only to call the auth endpoint>
    SUPABASE_SERVICE_ROLE_KEY    <service role key>
    PREFERENCE_LAB_BUCKET        preference-lab   (optional)

A deployed instance refuses to start without the Supabase pair rather than
falling back to an ephemeral local store that would silently drop verdicts.

## Access

Identity is **Supabase Auth**. `/api/session` exchanges email and password for a
Supabase access token and stores it in an httpOnly cookie; every data route —
pairs, judge, stats and the image proxy — verifies that token against the
project's published JWKS and returns 401 without it. There is no hand-rolled
crypto and no session table.

Public sign-up is disabled on the project; accounts are created by an
administrator. Rater identity comes from the verified token rather than from
anything the browser sends, so verdicts stay attributable.

## Develop

    npm install
    npm run dev      # http://localhost:3939

Ingest, scoring, schema and analysis live in the private research repository.
