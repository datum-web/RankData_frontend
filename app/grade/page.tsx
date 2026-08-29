"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { METRIC_ROWS, type Candidate, type PairView } from "@/lib/types";
import { explainWarnings } from "@/lib/corpus";
import Viewer3D, { DEFAULT_ORBIT, type Orbit } from "../Viewer3D";
import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * One click is the whole verdict.
 *
 * Three buttons: which one, or neither.
 *
 * It was a seven-point scale that folded strength into the direction. Two
 * problems, and the second is why it is gone. The labels put the comparison
 * sign outside each word -- "Left >" against "> Right" -- so the right-hand
 * buttons read as "greater than right", the opposite of what they do. And
 * seven targets each carrying a word of explanation is a paragraph to re-read
 * on every pair, which is a tax on the one thing the rater is here to do.
 *
 * WHAT THIS COSTS. `confidence` is `not null check between 1 and 4`, so a
 * three-way verdict has to write *something*: it writes 3. From here on the
 * column is constant and carries no information, and the 225 verdicts already
 * collected are the only ones with a real strength on them. The 4x5 pilot
 * found per-judgment strength more informative than the ranking itself, so
 * this is a real loss, taken deliberately. Getting it back means either the
 * buttons return or a separate control does.
 *
 * `key` is the keyboard shortcut, left to right.
 */
const SCALE = [
  { key: "1", side: "left"  as const, confidence: 3 as const, label: "left",  hint: "left is closer to the reference" },
  { key: "2", side: "tie"   as const, confidence: 3 as const, label: "tie",   hint: "cannot separate them" },
  { key: "3", side: "right" as const, confidence: 3 as const, label: "right", hint: "right is closer to the reference" },
] as const;

const value = (c: Candidate, key: string): number | null =>
  key === "v1_iou" ? c.v1_iou ?? null : ((c.metrics as any)?.[key] ?? null);

const fmt = (n: number | null) => (n == null ? "N/A" : n.toFixed(4));

/**
 * What to print as a candidate's identifier.
 *
 * Perturbation ids name the defect — `…~missing_tooth`, `…~undersized` — so
 * printing them hands the rater the answer without looking at the geometry.
 * That is a far stronger anchor than the metrics. The defect is masked behind a
 * stable variant letter; the real id stays in the database, and case number
 * plus side still identify the row exactly.
 */
function candidateLabel(cand: Candidate): string {
  if (cand.origin !== "perturbation") return cand.id;
  const tag = cand.id.split("~")[1] ?? "";
  let h = 0;
  for (const ch of tag) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `${cand.ref_id} · variant ${String.fromCharCode(65 + (h % 26))}`;
}

/** Percentile rank of `v` among sorted `values`, 0-100. */
function rank(v: number, values: number[]): number {
  if (!values.length) return 50;
  let below = 0;
  for (const x of values) if (x < v) below++;
  let equal = 0;
  for (const x of values) if (x === v) equal++;
  return ((below + equal / 2) / values.length) * 100;
}

/**
 * Where these two values sit in the corpus-wide distribution of this metric.
 *
 * The raw number cannot be read as good or bad on its own. The track spans the
 * corpus min to max, the shaded band is the middle half (p25-p75) and the tick
 * is the median, so "above the band" reads as high without the rater having to
 * remember what a typical aligned IoU looks like.
 */
function Spread({ stats, left, right }: {
  stats?: { min: number; max: number; median: number; constant: boolean; values: number[]; n: number };
  left: number | null;
  right: number | null;
}) {
  if (!stats) return <span className="na">—</span>;
  if (stats.constant) {
    return <span className="constant" title="every candidate in the corpus scores the same here">constant</span>;
  }
  const { min, max, median, values, n } = stats;
  const rl = left == null ? null : rank(left, values);
  const rr = right == null ? null : rank(right, values);
  const title =
    `corpus of ${n}: ${min.toFixed(3)} – ${max.toFixed(3)}, median ${median.toFixed(3)}. ` +
    `Position is percentile rank, so the middle of the track is a typical score.`;
  return (
    <div className="spreadwrap" title={title}>
      <div className="spread">
        <div className="band" style={{ left: "25%", width: "50%" }} />
        <div className="med" style={{ left: "50%" }} />
        {rl != null && <div className="dot L" style={{ left: `${rl}%` }} />}
        {rr != null && <div className="dot R" style={{ left: `${rr}%` }} />}
      </div>
      <div className="ranks">
        <span className="rk L">{rl == null ? "—" : `p${Math.round(rl)}`}</span>
        <span className="rk R">{rr == null ? "—" : `p${Math.round(rr)}`}</span>
      </div>
    </div>
  );
}

export default function GradePage() {
  const router = useRouter();
  const [rater, setRater] = useState("");
  const [view, setView] = useState<PairView | null>(null);
  const [finished, setFinished] = useState(false);
  const [notes, setNotes] = useState("");
  const [lastPairId, setLastPairId] = useState<string | null>(null);
  // Hovering a scale button lights up the candidate it would pick. With one
  // click committing the verdict, confirming the target before pressing matters.
  const [hoverSide, setHoverSide] = useState<"left" | "right" | null>(null);
    const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<any>(null);
  // The blown-up view. `zoom` is which panel was clicked, so the overlay can
  // open on the thing the rater was already looking at.
  const [zoom, setZoom] = useState<null | "reference" | "left" | "right">(null);
  // Flip mode: reference plus ONE candidate, swapped in place.
  //
  // Three panels side by side is the right way to answer "which of these is
  // closer to that" on a desktop and the wrong way on a phone, where they
  // become three stacked thumbnails the rater has to compare from memory.
  // Swapping two images at the same position and size instead is how a person
  // actually spots a geometric difference -- the part that moves is the part
  // that differs. Default on below 720px, available everywhere.
  const [flip, setFlip] = useState(false);
  // Show each candidate in its own frame instead of the reference's.
  //
  // 345 of the 880 candidates are the right shape at a round unit-less size --
  // `box(1,1,1)` where the reference is 200 mm -- and at 1/200 they render as a
  // single pixel. That size error is a real finding and the caption states the
  // ratio either way, but the rater still has to be able to see the shape they
  // are being asked to judge. Off by default: wrong size should look wrong.
  const [fitOwn, setFitOwn] = useState(false);
  const [flipSide, setFlipSide] = useState<"left" | "right">("left");
  // Default to the pictures when the browser cannot do 3-D at all, rather than
  // opening on three empty boxes and making the rater find the other tab. The
  // probe is a throwaway canvas, done once, and it never throws: a browser
  // without WebGL returns null from getContext rather than raising.
  const [mode, setMode] = useState<"3d" | "image">("3d");
  useEffect(() => {
    let ok = false;
    try {
      const c = document.createElement("canvas");
      ok = !!(c.getContext("webgl2") || c.getContext("webgl"));
    } catch { ok = false; }
    if (!ok) setMode("image");
  }, []);
  const [orbit, setOrbit] = useState<Orbit>(DEFAULT_ORBIT);
  // Read inside the keydown handler, which is bound once; a state value there
  // would be the one captured at bind time.
  const zoomRef = useRef<typeof zoom>(null);
  zoomRef.current = zoom;
  const flipRef = useRef(false);
  flipRef.current = flip;

  const openZoom = useCallback((which: "reference" | "left" | "right") => {
    // A phone has room for two panels, not three. Opening straight into flip
    // mode saves the rater discovering the button before the view is usable.
    if (typeof window !== "undefined" && window.innerWidth <= 720) {
      setFlip(true);
      if (which !== "reference") setFlipSide(which);
    }
    setZoom(which);
  }, []);

  // --- timing. Decision latency is a recorded signal, not telemetry: with the
  // metrics visible it is what separates "obvious at a glance" from "argued
  // with the numbers". Dwell over the metric panel is logged the same way.
  const shownAt = useRef<number>(0);
  const firstInput = useRef<number | null>(null);
  const dwell = useRef<number>(0);
  const dwellFrom = useRef<number | null>(null);
  const interactions = useRef<{ key: string; at: number }[]>([]);
  // Time the tab spent hidden. A pair left open overnight recorded a 3.2 hour
  // decision on real data; that is idle time, not deliberation, and it drags
  // any mean with it. Subtracted from decision_ms and also reported raw.
  const hidden = useRef<number>(0);
  const hiddenFrom = useRef<number | null>(null);

  const markInput = useCallback(() => {
    if (firstInput.current == null) firstInput.current = Date.now() - shownAt.current;
  }, []);

  const [gateError, setGateError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  // Identity is whatever the signed session says. Nothing about the rater is
  // trusted from the browser.
  useEffect(() => {
    fetch("/api/session", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (d.rater) setRater(d.rater); else router.replace("/"); })
      .catch(() => router.replace("/"))
      .finally(() => setChecking(false));
  }, []);

  const load = useCallback(async (who: string, pairId?: string) => {
    setError(null);
    // Read the cohort here rather than in a render-scoped const. It used to be
    // computed on every render and captured by a `useCallback(..., [])`, so the
    // callback held whichever value existed when it was first built -- an empty
    // string during the server render. It happened to work; it was one
    // hydration-order change away from silently dropping the filter.
    //
    // Straight off `location` rather than through `useSearchParams`, which
    // would drag a Suspense boundary in for one optional string.
    const cohort = typeof window === "undefined"
      ? "" : new URLSearchParams(window.location.search).get("cohort") || "";
    const res = await fetch(
      pairId
        ? `/api/pairs?pair=${encodeURIComponent(pairId)}`
        : `/api/pairs${cohort ? `?cohort=${encodeURIComponent(cohort)}` : ""}`,
      { cache: "no-store" },
    );
    const data = await res.json();
    if (data.error) return setError(data.error);
    if (data.done) {
      setFinished(true);
      setView(null);
    } else {
      setFinished(false);
      setView(data);
    }
    setNotes("");
    setHoverSide(null);
    // Drop focus from the previous pair's button. With one click committing a
    // verdict, a focus ring left on a scale button is an invitation to a
    // double-tap that would judge the next pair by accident.
    (document.activeElement as HTMLElement | null)?.blur?.();
    shownAt.current = Date.now();
    firstInput.current = null;
    dwell.current = 0;
    dwellFrom.current = null;
    interactions.current = [];
    hidden.current = 0;
    hiddenFrom.current = document.hidden ? Date.now() : null;
    fetch("/api/stats", { cache: "no-store" }).then((r) => r.json()).then(setStats).catch(() => {});
  }, []);

  // Warm the next pair while this one is being looked at.
  //
  // Judging is one click, and everything after that click was serial: POST the
  // verdict, GET the next pair, then three renders pulled through `/api/image`
  // from private storage one after another. The rater waited through all of it
  // between every verdict. None of it has to happen then -- the next pair is
  // knowable as soon as this one is on screen.
  //
  // `?after=` consumes nothing, so a prefetch that is never used costs one
  // request. `new Image()` puts the renders in the browser's own cache, which
  // is what the real `<img>` will hit a moment later.
  useEffect(() => {
    if (!view?.pair?.id) return;
    let dead = false;
    const t = setTimeout(() => {
      fetch(`/api/pairs?after=${encodeURIComponent(view.pair.id)}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((next) => {
          if (dead || !next || next.error || next.done) return;
          for (const src of [next.reference?.image, next.left?.image, next.right?.image]) {
            if (src) new Image().src = `/api/image/${src}`;
          }
        })
        .catch(() => {});
    }, 400);   // let the current pair's own images win the connection first
    return () => { dead = true; clearTimeout(t); };
  }, [view?.pair?.id]);

  useEffect(() => {
    if (rater) void load(rater);
  }, [rater, load]);

  const submit = useCallback(async (
    choice: "left" | "right" | "tie",
    confidence: 1 | 2 | 3 | 4,
  ) => {
    if (!view || busy) return;
    setBusy(true);
    setError(null);
    if (dwellFrom.current != null) {
      dwell.current += Date.now() - dwellFrom.current;
      dwellFrom.current = null;
    }
    if (hiddenFrom.current != null) {
      hidden.current += Date.now() - hiddenFrom.current;
      hiddenFrom.current = null;
    }
    const wall = Date.now() - shownAt.current;
    const active = Math.max(0, wall - hidden.current);
    const judgedPairId = view.pair.id;
    const chosen =
      choice === "tie" ? null : choice === "left" ? view.left.id : view.right.id;
    const res = await fetch("/api/judge", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        pair_id: view.pair.id,
        chosen_id: chosen,
        is_tie: choice === "tie",
        confidence,
        left_id: view.left.id,
        right_id: view.right.id,
        // What the client believes it showed. The server recomputes this and
        // its answer is the one stored -- see lib/blind.ts -- so this is here
        // to be comparable, not to be trusted. It said `true` unconditionally
        // even after the blind arm shipped, which was simply false on a third
        // of pairs.
        metrics_shown: !view.blind,
        decision_ms: active,
        hidden_ms: hidden.current,
        time_to_first_input_ms: firstInput.current,
        metric_dwell_ms: dwell.current,
        metric_interactions: interactions.current,
        notes,
        client: { ua: navigator.userAgent, w: window.innerWidth },
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (data.error) return setError(data.error);
    // A single click commits, so keep a way back to the pair just judged.
    setLastPairId(judgedPairId);
    await load(rater);
  }, [view, busy, rater, notes, load]);

  // Keyboard: 1 left, 2 tie, 3 right; confidence uses q/w/e/r because 1-4 is
  // already taken. Only while a pair is on screen — otherwise these fire on the
  // sign-in form, where Enter would run the judgment path instead of signing in.
  useEffect(() => {
    if (!view) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;
      // Esc closes the blown-up comparison. Nothing else fires while it is
      // open: a stray digit there would commit a verdict for the pair behind
      // the overlay, which is the opposite of taking a closer look.
      if (zoomRef.current) {
        if (e.key === "Escape") setZoom(null);
        // Space is the flicker: hold the eye still, swap the picture.
        //
        // Space only. The arrows used to swap here and commit a verdict once
        // the overlay closed -- the same key meaning "look closer" one moment
        // and "decide, irreversibly" the next, with the hand already resting on
        // it. One key, one meaning, everywhere.
        else if (flipRef.current && e.key === " ") {
          e.preventDefault();
          setFlipSide((v) => (v === "left" ? "right" : "left"));
        }
        return;
      }
      const point = SCALE.find((p) => p.key === e.key);
      if (point) {
        markInput();
        void submit(point.side, point.confidence);
        return;
      }
      // Arrows say the same thing as 1 and 3, for a hand already on them.
      if (e.key === "ArrowLeft") { markInput(); void submit("left", 3); }
      else if (e.key === "ArrowRight") { markInput(); void submit("right", 3); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [submit, markInput, view]);

  if (checking) {
    return (
      <div className="wrap">
        <header className="bar"><Link className="home" href="/"><h1>BenchCAD Preference Lab</h1></Link></header>
        <p className="note">Checking your session…</p>
      </div>
    );
  }

  if (!rater) return null;   // redirecting to the dashboard

  return (
    <div className="wrap">
      <header className="bar">
        <Link className="home" href="/"><h1>BenchCAD Preference Lab</h1></Link>
        {view?.pair.case_no != null && (
          <span className="badge case">case #{view.pair.case_no}</span>
        )}
        {view && <span className="badge">{view.reference.family}</span>}
        {view && <span className="badge">{view.pair.cohort}</span>}
        {view && <span className="badge">{view.remaining} left of {view.total}</span>}
        {/* Say so when the queue is not the whole corpus. Judging a filtered
            slice is fine; not knowing you are is not. */}
        {view?.cohort && <span className="badge warn">filtered · {view.cohort}</span>}
        <span className="spacer" />
        {stats?.backend === "local" && <span className="badge warn">local store — no Supabase configured</span>}
        <span className="badge">{rater}</span>
        <Link className="pill" href="/">← dashboard</Link>
      </header>

      {error && <div className="card" style={{ marginBottom: 16, borderColor: "var(--bad)" }}>{error}</div>}

      {finished && (
        <div className="card done">
          <h2>Every pair judged.</h2>
          <p><Link className="pill" href="/">see the dashboard</Link></p>
          <p className="note">
            {stats?.mine?.judged ?? 0} verdicts from you, {stats?.all?.judgments ?? 0} in total.
            Median decision time{" "}
            {stats?.mine?.median_decision_ms != null
              ? `${(stats.mine.median_decision_ms / 1000).toFixed(1)} s`
              : "—"}.
          </p>
          {stats?.metric_agreement && (
            <table className="metrics" style={{ maxWidth: 520, margin: "20px auto 0" }}>
              <thead><tr><th>Metric alone agrees with you</th><th>rate</th><th>n</th></tr></thead>
              <tbody>
                {stats.metric_agreement.map((m: any) => (
                  <tr key={m.key}>
                    <td>{m.label}</td>
                    <td className="num">{m.rate == null ? "—" : `${(m.rate * 100).toFixed(0)}%`}</td>
                    <td className="num lose">{m.usable}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {view && zoom && (
        /* Full-bleed comparison. One camera drives all three panels, because
           the question is "which of these two is closer to that", and answering
           it by eye needs the same aspect of all three on screen at once — not
           three models the rater has to line up from memory. */
        <div className="lightbox" onClick={() => setZoom(null)}>
          <div className="lbinner" onClick={(e) => e.stopPropagation()}>
            <div className="bar" style={{ marginBottom: 10 }}>
              <span className="badge case">case #{view.pair.case_no ?? "—"}</span>
              <span className="badge">{view.reference.family}</span>
              <span className="spacer" />
              <button className="pill" data-on={mode === "3d" ? 1 : 0}
                      onClick={() => setMode("3d")}>turnable solid</button>
              <button className="pill" data-on={mode === "image" ? 1 : 0}
                      onClick={() => setMode("image")}>rendered views</button>
              {mode === "3d" && (
                <button className="pill" onClick={() => setOrbit(DEFAULT_ORBIT)}>reset view</button>
              )}
              <button className="pill" data-on={fitOwn ? 1 : 0}
                      onClick={() => setFitOwn((v) => !v)}
                      title="show each solid at its own size — the ratio stays in the caption">
                {fitOwn ? "fit: own size" : "fit: reference size"}
              </button>
              <button className="pill" data-on={flip ? 1 : 0}
                      onClick={() => setFlip((v) => !v)}
                      title="reference plus one candidate, swapped in place">
                {flip ? "flip: on" : "flip"}
              </button>
              <button className="pill" onClick={() => setZoom(null)}>close ✕</button>
            </div>

            <div className={`lbgrid${flip ? " flip" : ""}`}>
              {([
                ["reference", view.reference.mesh ?? null, view.reference.image, "reference — ground truth", 0x8a94a6],
                ["left", view.left.mesh ?? null, view.left.image, "left", 0x6ec3c0],
                ["right", view.right.mesh ?? null, view.right.image, "right", 0x6ec3c0],
              ] as const)
                // In flip mode the two candidates share one slot, so only the
                // selected one is mounted -- the other must not be laid out at
                // all or the swap moves the picture, which is the one thing
                // this view exists to avoid.
                .filter(([key]) => !flip || key === "reference" || key === flipSide)
                .map(([key, mesh, image, label, colour]) => (
                <div key={key} className={`lbcell${zoom === key ? " focused" : ""}`}>
                  {mode === "3d" ? (
                    mesh ? (
                      <Viewer3D mesh={mesh} frame={(view.reference as any).frame ?? null}
                                orbit={orbit} onOrbit={setOrbit} color={colour} label={label}
                                fit={fitOwn && key !== "reference"} />
                    ) : (
                      <div className="v3d">
                        <div className="v3dcanvas anchorcard">
                          <span className="anchorlabel">no solid</span>
                          <span className="anchorhint">
                            this side is a target score, not a part
                          </span>
                        </div>
                        <div className="v3dfoot"><span>{label}</span></div>
                      </div>
                    )
                  ) : (
                    <figure className="lbfig">
                      {image
                        ? <img src={`/api/image/${image}`} alt={label} />
                        : <div className="anchorcard" style={{ minHeight: 300 }}>
                            <span className="anchorlabel">no render</span>
                          </div>}
                      <figcaption>{label}</figcaption>
                    </figure>
                  )}
                </div>
              ))}
            </div>

            {flip && (
              /* Full-width and thumb-height: on a phone this is the control the
                 rater uses dozens of times per pair, so it is the biggest thing
                 on screen after the pictures. */
              <button className="flipbar" onClick={() =>
                        setFlipSide((v) => (v === "left" ? "right" : "left"))}>
                showing <b>{flipSide}</b> — tap to swap
                <span className="flipkey">space</span>
              </button>
            )}

            <p className="note" style={{ marginTop: 10, marginBottom: 0 }}>
              {flip
                ? "Two panels, one candidate at a time, swapped in place: what moves between taps is what differs. Tap the bar or press space; press Esc to close."
                : ""}
            </p>
            <p className="note" style={{ marginTop: 10, marginBottom: 0,
                                         display: flip ? "none" : undefined }}>
              Drag to turn, scroll to zoom — all three move together. Every solid is
              placed by the <b>reference&apos;s</b> centre and longest axis, so a part
              that is the wrong size looks the wrong size instead of being fitted to
              its own frame. Press <b>Esc</b> to close; the scale buttons still work
              underneath.
            </p>
          </div>
        </div>
      )}

      {view && (
        <div className="stack">
          <div>
            {/* Reference beside the candidates rather than above them.
                Stacked, the reference alone filled the first screen and the two
                things it was being compared against were a scroll away, which
                turns every judgment into a memory test. Three across fits the
                1360px container with room for all three at 430px. */}
            <div className="pairgrid" style={{ marginBottom: 12 }}>
              <div className="card refcard">
                <h2>Reference — ground truth</h2>
                <img className="shot refshot zoomable" src={`/api/image/${view.reference.image}`}
                     alt="reference" onClick={() => openZoom("reference")}
                     title="click to open the solid, turnable and full size" />
                <div className="refmeta">
                  <span><b>case</b> <span className="idtag">#{view.pair.case_no ?? "—"}</span></span>
                  <span><b>GT</b> <span className="idtag">{view.reference.id}</span></span>
                  <span><b>family</b> {view.reference.family}</span>
                </div>
              </div>
              {(["left", "right"] as const).map((side) => {
                const cand = side === "left" ? view.left : view.right;
                return (
                  <div key={side} className={`side${hoverSide === side ? " picked" : ""}`}>
                    <h3>
                      {side}
                      <span className="key">{side === "left" ? "←/1" : "→/3"}</span>
                    </h3>
                    {cand.origin === "anchor" ? (
                      /* This side is deliberately a number. Comparing a render
                         against a target score is what puts the rater's sense
                         of "good enough" onto the metric's own axis — ordering
                         alone never says where on the scale a person sits. */
                      <div className="shot anchorcard">
                        <span className="anchorlabel">
                          {cand.provenance?.anchor_label ?? "score"}
                        </span>
                        <span className="anchorvalue">
                          {(cand.provenance?.anchor_value ?? 0).toFixed(2)}
                        </span>
                        <span className="anchorhint">
                          a reconstruction that scores exactly this
                        </span>
                      </div>
                    ) : (
                      <img className="shot zoomable" src={`/api/image/${cand.image}`} alt={side}
                           onClick={() => openZoom(side as "left" | "right")}
                           title="click to open the solid, turnable and full size" />
                    )}
                    <div className="kv">
                      <span>candidate</span>
                      <span className="idtag">
                        {cand.origin === "anchor" ? "score anchor" : candidateLabel(cand)}
                      </span>
                    </div>
                    <div className="kv">
                      <span>{cand.origin === "perturbation" ? "origin"
                             : cand.origin === "anchor" ? "this side is" : "model"}</span>
                      <span>{cand.origin === "perturbation" ? "perturbed reference"
                             : cand.origin === "anchor" ? "a target score, not a part"
                             : (cand.provenance?.model ?? "—")}</span>
                    </div>
                    {cand.ref_id !== view.reference.id && (
                      <div className="kv">
                        <span>generated for</span>
                        <span className="idtag warnrow">{cand.ref_id}</span>
                      </div>
                    )}
                    {explainWarnings(cand.metrics?.warnings).map((w) => (
                      <div className="warnrow" key={w.raw} title={w.raw}>⚠ {w.text}</div>
                    ))}
                  </div>
                );
              })}
            </div>

            {/* Scores belong in the decision zone. The full table further down
                has the corpus context and the explanations, but with one click
                committing the verdict nobody scrolls to it — so the side-by-side
                comparison has to sit between the images and the buttons, where
                the eye already is. */}
            {view.blind ? (
              /* Blind arm. Say so plainly: an empty space where the numbers
                 usually are reads as a bug, and a rater who thinks the tool is
                 broken behaves differently from one who knows the numbers are
                 being withheld on purpose. */
              <div className="card blindcard">
                <b>Metrics hidden for this pair.</b>
                <span>
                  Every verdict collected before today was cast with the scores on
                  screen, so none of them can say whether the metrics predict
                  preference or merely anchor it. Judge this one on the pictures.
                </span>
              </div>
            ) : null}
            {!view.blind && view.left.origin !== "anchor" && view.right.origin !== "anchor" && (
            <div className="card scoreband">
              <div className="scorehead">
                <span>metric</span><span className="num">left</span>
                <span className="who">favours</span><span className="num">right</span>
              </div>
              {METRIC_ROWS.map((row) => {
                const key = row.key as string;
                const l = value(view.left, key);
                const r = value(view.right, key);
                const gap = l != null && r != null ? l - r : null;
                const who = gap == null || gap === 0 ? null : gap > 0 ? "left" : "right";
                return (
                  <div className="scorerow" key={key}>
                    <span className="mname" title={row.hint}>{row.label}</span>
                    <span className={`num${who === "left" ? " win" : ""}`}>
                      {l == null ? "—" : l.toFixed(3)}
                    </span>
                    <span className={`who ${who ?? "even"}`}>
                      {who == null ? "=" : who === "left" ? "◀" : "▶"}
                      {gap != null && gap !== 0 && (
                        <em>{Math.abs(gap) < 0.001 ? "<0.001" : Math.abs(gap).toFixed(3)}</em>
                      )}
                    </span>
                    <span className={`num${who === "right" ? " win" : ""}`}>
                      {r == null ? "—" : r.toFixed(3)}
                    </span>
                  </div>
                );
              })}
              <p className="note scorenote">
                These are the metrics&apos; opinion, not the answer. Where they
                disagree with you is the whole point of collecting your verdict.
              </p>
            </div>
            )}
            {(view.left.origin === "anchor" || view.right.origin === "anchor") && (
              <p className="note anchornote">
                One side is a number. Judge the render against it: is this
                reconstruction better or worse than a part that scores exactly
                that? The metric panel is hidden here on purpose — reading the
                candidate&apos;s own score first would make the answer a
                comparison of two numbers instead of a judgement.
              </p>
            )}

            {/* The verdict sits immediately under the images. It used to be
                below the metric table, so choosing meant looking away from the
                thing being judged and back again. */}
            <div className="card verdict" style={{ marginBottom: 16 }}>
              <div className="scale">
                {SCALE.map((pt) => (
                  <button
                    key={pt.key}
                    className={`step${pt.side === "tie" ? " tie" : ""}`}
                    disabled={busy}
                    onMouseEnter={() => setHoverSide(pt.side === "tie" ? null : pt.side)}
                    onMouseLeave={() => setHoverSide(null)}
                    onClick={() => { markInput(); void submit(pt.side, pt.confidence); }}
                    title={pt.hint}
                  >
                    <b>{pt.label}</b>
                    <span className="key">{pt.key}</span>
                  </button>
                ))}
              </div>
              <div className="rowend">
                <span className="note" style={{ marginRight: "auto" }}>
                  One click records it and loads the next pair · keys <b>1</b> <b>2</b> <b>3</b>, or ← →
                </span>
                {busy && <span className="note">saving…</span>}
                {lastPairId && !busy && (
                  <button className="pill" onClick={() => void load(rater, lastPairId)}>
                    ↩ redo the pair I just judged
                  </button>
                )}
              </div>
            </div>

            {/* The anchor guard belongs here too. The panel above is hidden for
                an anchor pair and the copy tells the rater so -- then this
                second table rendered the candidate's full score sheet anyway,
                which is the exact thing the anchor cohort exists to prevent:
                read the candidate's own aligned IoU first and "is this better
                than 0.45" stops being a judgement and becomes arithmetic. */}
            {!view.blind && view.left.origin !== "anchor"
                          && view.right.origin !== "anchor" && (
            <div
              className="card scrollx"
              style={{ marginBottom: 16 }}
              onMouseEnter={() => {
                // Engaging with the numbers counts as first input. Without this
                // a one-click verdict makes time_to_first_input equal to
                // decision_ms and the field carries nothing.
                markInput();
                dwellFrom.current = Date.now();
              }}
              onMouseLeave={() => {
                if (dwellFrom.current != null) {
                  dwell.current += Date.now() - dwellFrom.current;
                  dwellFrom.current = null;
                }
              }}
            >
              <h2>BenchCAD-ME metrics — higher is better</h2>
              <table className="metrics">
                <thead>
                  <tr>
                    <th>metric</th><th>left</th><th>right</th><th>Δ</th>
                    <th style={{ width: 170, textAlign: "center" }}>where it sits in the corpus</th>
                    <th>favours</th>
                  </tr>
                </thead>
                <tbody>
                  {METRIC_ROWS.map((row) => {
                    const l = value(view.left, row.key as string);
                    const r = value(view.right, row.key as string);
                    const usable = l != null && r != null && l !== r;
                    const favL = usable && l! > r!;
                    return (
                      <tr
                        key={row.key as string}
                        onMouseEnter={() => {
                          // Capped: a rater sweeping the table must not be able
                          // to grow one row's payload without bound.
                          if (interactions.current.length < 200) {
                            interactions.current.push({
                              key: row.key as string, at: Date.now() - shownAt.current,
                            });
                          }
                        }}
                      >
                        <td>
                          <div className="metricname">
                            {row.label}
                            <small>{row.hint}</small>
                          </div>
                        </td>
                        <td className={`num ${l == null ? "na" : usable && favL ? "win" : "lose"}`}>{fmt(l)}</td>
                        <td className={`num ${r == null ? "na" : usable && !favL ? "win" : "lose"}`}>{fmt(r)}</td>
                        <td className="num lose">
                          {l == null || r == null ? "—" : (l - r >= 0 ? "+" : "") + (l - r).toFixed(4)}
                        </td>
                        <td>
                          <Spread stats={view.stats?.[row.key as string]} left={l} right={r} />
                        </td>
                        <td>
                          {!usable ? <span className="favours">tie</span>
                            : <span className={`favours ${favL ? "L" : "R"}`}>{favL ? "LEFT" : "RIGHT"}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            )}

            <div className="card">
              <h2>Note — optional, write it before you click</h2>
              <textarea className="text" rows={2} value={notes}
                        onChange={(e) => { markInput(); setNotes(e.target.value); }} />
              <p className="note" style={{ marginTop: 10, marginBottom: 0 }}>
                A 1 mm split can read as a slightly deeper groove in these views. If the
                metrics claim something you cannot see, that disagreement is the
                interesting data — say what you actually saw.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
