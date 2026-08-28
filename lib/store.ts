/**
 * Data layer with two backends, chosen by environment.
 *
 *   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY set  ->  Supabase (Postgres)
 *   otherwise                                     ->  local file store
 *
 * The local backend exists so the app is runnable and testable before a
 * Supabase project exists. It reads the same `dataset/manifest.json` the
 * ingest writes and appends verdicts to `.data/judgments.jsonl`. It is a dev
 * convenience, not a second product: the row shapes are identical, so
 * switching backends is an env change and nothing else.
 *
 * The service-role key is only ever read here, on the server. It is never sent
 * to the browser.
 */

import { promises as fs } from "node:fs";
import path from "node:path";
import type { Candidate, Evaluation, Judgment, Pair, Ref } from "./types";

export type Corpus = {
  refs: Ref[]; candidates: Candidate[]; pairs: Pair[]; evaluations: Evaluation[];
};

const MANIFEST = path.join(process.cwd(), "public", "pairs", "manifest.json");
const LOCAL_DIR = path.join(process.cwd(), ".data");
const LOCAL_JUDGMENTS = path.join(LOCAL_DIR, "judgments.jsonl");

export function backend(): "supabase" | "local" {
  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return "supabase";
  }
  // A deployed instance has no writable, persistent filesystem: on Vercel the
  // local store would accept every verdict and lose it at the next cold start.
  // Silent data loss during an annotation session is worse than not booting,
  // so refuse instead of falling back.
  if (process.env.VERCEL || process.env.PREFERENCE_LAB_REQUIRE_SUPABASE === "1") {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set when deployed — " +
      "the local file store is ephemeral here and verdicts would be lost.",
    );
  }
  return "local";
}

function client() {
  // Imported lazily so the local backend never needs the dependency at runtime.
  const { createClient } = require("@supabase/supabase-js");
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });
}

// ------------------------------------------------------------------ corpus --

let cached: Corpus | null = null;
let cachedAt = 0;
/**
 * How long a loaded corpus is reused within one warm instance.
 *
 * The Supabase branch used to skip the cache entirely -- the `if (cached)`
 * below sat in the filesystem branch only -- so every request refetched refs,
 * candidates, active pairs AND all evaluations with their jsonb metric blobs:
 * about 6,700 rows, paginated at 1,000, so eight round trips. `/api/pairs`
 * measured 1.5-2.6 s, and it is the endpoint a rater hits between every
 * judgment. The cost grew with the corpus, which had just tripled.
 *
 * A minute is chosen because the corpus only changes when someone publishes,
 * and the worst case is a rater seeing the previous queue for under a minute.
 * Verdicts are deliberately NOT cached: `judgmentsFor` stays live, or a rater
 * would be handed a pair they just answered.
 */
const CORPUS_TTL_MS = 60_000;

/**
 * Read a whole table, not the first page of it.
 *
 * PostgREST caps an unbounded select at the project's `max-rows` (1000 by
 * default) and reports no error when it truncates — the corpus simply arrives
 * short. That is survivable at 352 pairs and silently destroys the queue at
 * 1328: pairs past the cap are never served, and every candidate they point at
 * looks unreferenced. Paginate explicitly so growth cannot do that again.
 */
const PAGE = 1000;

async function fetchAll(db: any, table: string, filter?: (q: any) => any) {
  const out: any[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = db.from(table).select("*").range(from, from + PAGE - 1);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`supabase ${table}: ${error.message}`);
    out.push(...data);
    if (data.length < PAGE) return out;
  }
}

export async function loadCorpus(): Promise<Corpus> {
  if (cached && Date.now() - cachedAt < CORPUS_TTL_MS) return cached;

  if (backend() === "supabase") {
    const db = client();
    const [refs, candidates, pairs, evaluations] = await Promise.all([
      fetchAll(db, "pl_refs"),
      fetchAll(db, "pl_candidates"),
      fetchAll(db, "pl_pairs", (q: any) => q.eq("active", true)),
      fetchAll(db, "pl_evaluations"),
    ]).then((r) => r.map((data) => ({ data })));
    cached = {
      evaluations: evaluations.data.map((e: any) => ({
        candidate_id: e.candidate_id, ref_id: e.ref_id,
        metrics: e.metrics ?? {}, v1_iou: e.v1_iou ?? null,
        image: e.image_url ?? null, image_v0: e.image_url_v0 ?? e.image_url ?? null,
        stimulus: e.stimulus ?? null,
      })),
      refs: refs.data.map((r: any) => ({ ...r, image: r.image_url,
        image_v0: r.image_url_v0 ?? r.image_url, mesh: r.mesh ?? null, frame: r.frame ?? null })),
      candidates: candidates.data.map((c: any) => ({
        ...c,
        image: c.image_url,
        image_v0: c.image_url_v0 ?? c.image_url,
        stimulus: c.stimulus ?? null,
        v1_iou: c.provenance?.v1_iou ?? null,
        mesh: c.mesh ?? null,
      })),
      pairs: pairs.data.map((p: any) => ({ ...p, a: p.a_id, b: p.b_id, case_no: p.case_no })),
    };
    cachedAt = Date.now();
    return cached;
  }

  if (cached) return cached;
  const raw = JSON.parse(await fs.readFile(MANIFEST, "utf8"));
  cached = { refs: raw.refs, candidates: raw.candidates, pairs: raw.pairs,
             evaluations: raw.evaluations ?? [] };
  return cached;
}

// ---------------------------------------------------------------- verdicts --

/**
 * Pairs this rater has already answered *usefully*.
 *
 * A pair is asked once, not once per image set — re-asking 145 questions whose
 * answers are still valid would be a waste of the rater's time. But the 36
 * verdicts that cannot be counted are a different matter: each covers a pair
 * whose candidate differed from the reference only in uniform scale, which the
 * old renderer divided out, so the defect was never on screen. Those answers
 * cannot be salvaged and the question has never really been put, so the pair
 * returns to the queue. The old row stays; the new verdict is a separate
 * observation under a different stimulus, not an overwrite.
 */
// Re-exported, not redefined. This file named `common-scale-v1` — the retired
// reference-scaled renderer — long after that stimulus was withdrawn, and
// `saveJudgment` stamps this value onto every verdict as it is written, so each
// new answer was being labelled with a renderer that had not produced its
// images. `lib/corpus` holds the one definition; three copies of a rule is how
// they end up disagreeing.
export { CURRENT_STIMULUS } from "./corpus";
import { CURRENT_STIMULUS } from "./corpus";
import { withoutTestRaters } from "./testRaters";

/**
 * Whether a verdict can be counted against the current images.
 *
 * Not simply `stimulus === current`. The image set changed in three ways and
 * only one of them can alter a verdict:
 *
 *  - framing and resolution changed for everything, which moves pixels but not
 *    which reconstruction is better;
 *  - absolute translation stopped being drawn, which removes a difference the
 *    metrics never measured either;
 *  - a uniform scale error became visible, having previously rendered to within
 *    0.03 % of the reference's pixels.
 *
 * Only the third changes the evidence, and it applies to exactly one class of
 * candidate. `stimulus_equivalent` is set on the verdicts where no candidate in
 * the pair carried a scale-only defect: the rater was looking at the same
 * geometry, so their answer stands. 145 of 181 existing verdicts qualify.
 */
export function countsNow(j: any, current: string): boolean {
  return (j.stimulus ?? "per-shape-normalised-v0") === current
      || j.stimulus_equivalent === true;
}


export async function judgmentsFor(rater: string): Promise<Set<string>> {
  if (backend() === "supabase") {
    const data = await fetchAll(client(), "pl_judgments",
                                (q: any) => q.eq("rater", rater));
    return new Set(data.filter((r: any) => countsNow(r, CURRENT_STIMULUS))
                       .map((r: any) => r.pair_id));
  }
  try {
    const text = await fs.readFile(LOCAL_JUDGMENTS, "utf8");
    const done = new Set<string>();
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      if (row.rater === rater && countsNow(row, CURRENT_STIMULUS)) {
        done.add(row.pair_id);
      }
    }
    return done;
  } catch {
    return new Set();
  }
}

export async function saveJudgment(j: Judgment): Promise<{ revisions: number }> {
  if (backend() === "supabase") {
    const db = client();
    // Keyed by stimulus as well as (pair, rater). The images changed under this
    // study — the first set could not show a uniform size error at all — so a
    // verdict formed against the old pictures and one formed against the new
    // ones are two different observations. Overwriting on (pair, rater) alone
    // silently destroyed the earlier one the moment anyone re-judged, and the
    // superseded verdict is still evidence: it records what a person does when
    // the defect is not on screen.
    const stimulus = j.stimulus ?? "per-shape-normalised-v0";
    const { data: existing } = await db
      .from("pl_judgments")
      .select("revisions")
      .eq("pair_id", j.pair_id)
      .eq("rater", j.rater)
      .eq("stimulus", stimulus)
      .maybeSingle();
    const revisions = existing ? (existing.revisions ?? 0) + 1 : 0;
    const { error } = await db
      .from("pl_judgments")
      .upsert({ ...j, stimulus, revisions, updated_at: new Date().toISOString() },
              { onConflict: "pair_id,rater,stimulus" });
    if (error) throw new Error(`supabase: ${error.message}`);
    return { revisions };
  }
  await fs.mkdir(LOCAL_DIR, { recursive: true });
  const prior = await judgmentsFor(j.rater);
  const revisions = prior.has(j.pair_id) ? 1 : 0;
  await fs.appendFile(
    LOCAL_JUDGMENTS,
    JSON.stringify({ ...j, revisions, created_at: new Date().toISOString() }) + "\n",
  );
  return { revisions };
}

/**
 * Every verdict in the study.
 *
 * QA accounts are filtered out here and nowhere else: four routes read this,
 * and an exclusion each of them had to remember is an exclusion three of them
 * would eventually forget. `includeTest` exists for the one caller that might
 * legitimately want to see them — nothing does today.
 */
export async function allJudgments(
  opts: { includeTest?: boolean } = {},
): Promise<any[]> {
  const rows = await allJudgmentRows();
  return opts.includeTest ? rows : withoutTestRaters(rows);
}

async function allJudgmentRows(): Promise<any[]> {
  if (backend() === "supabase") {
    // Paginated for the same reason as the corpus: at 1000 verdicts this would
    // start quietly reporting a study smaller than the one that was run.
    return fetchAll(client(), "pl_judgments");
  }
  try {
    const text = await fs.readFile(LOCAL_JUDGMENTS, "utf8");
    // Later rows supersede earlier ones for the same (pair, rater).
    const latest = new Map<string, any>();
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      latest.set(`${row.pair_id}::${row.rater}`, row);
    }
    return [...latest.values()];
  } catch {
    return [];
  }
}

/** Delete one rater's verdicts. Scoped by the caller's verified identity. */
export async function deleteJudgmentsFor(rater: string): Promise<number> {
  if (backend() === "supabase") {
    const db = client();
    const { data, error } = await db
      .from("pl_judgments").delete().eq("rater", rater).select("id");
    if (error) throw new Error(`supabase: ${error.message}`);
    return data?.length ?? 0;
  }
  let kept: string[] = [], removed = 0;
  try {
    for (const line of (await fs.readFile(LOCAL_JUDGMENTS, "utf8")).split("\n")) {
      if (!line.trim()) continue;
      if (JSON.parse(line).rater === rater) removed++;
      else kept.push(line);
    }
  } catch {
    return 0;
  }
  await fs.writeFile(LOCAL_JUDGMENTS, kept.join("\n") + (kept.length ? "\n" : ""));
  return removed;
}

// ---------------------------------------------------------------- accounts --

export type Account = { email: string; banned: boolean; last_sign_in: string | null };

/** Every rater account, including ones that have never signed in. */
export async function listAccounts(): Promise<Account[]> {
  if (backend() !== "supabase") return [];
  const url = `${process.env.SUPABASE_URL!.replace(/\/$/, "")}/auth/v1/admin/users?per_page=200`;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const res = await fetch(url, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`supabase auth admin: ${res.status}`);
  const data = await res.json();
  return (data.users ?? []).map((u: any) => ({
    email: u.email,
    banned: Boolean(u.banned_until && new Date(u.banned_until) > new Date()),
    last_sign_in: u.last_sign_in_at ?? null,
  }));
}
