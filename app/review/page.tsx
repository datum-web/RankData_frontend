"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import BackToTop from "../BackToTop";

/**
 * Visual review of everything already judged.
 *
 * Reference, left, right, side by side, with the chosen one outlined. Sides are
 * shown **as that rater actually saw them**, not in the pair's A/B order: the
 * sides are shuffled per (pair, rater), so replaying a verdict in A/B order
 * would mirror half the rows and make a review of your own choices misleading.
 */

const KEYS = ["v1_iou", "aligned_iou", "topology", "face", "edge", "bspace_min", "q_l"] as const;
const SHORT: Record<string, string> = {
  v1_iou: "v1 IoU", aligned_iou: "aligned", topology: "topo",
  face: "face", edge: "edge", bspace_min: "B-min", q_l: "Q_L",
};
const CONF: Record<number, string> = { 1: "tie", 2: "slightly", 3: "better", 4: "much better" };

type Filter = "all" | "disagreed" | "unsure" | "quick";

export default function ReviewPage() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [family, setFamily] = useState("all");
  const [limit, setLimit] = useState(30);
  // Administrators can replay any rater's log. The server decides whether that
  // is allowed; this only chooses what to ask for.
  const [asRater, setAsRater] = useState<string>("");

  // The admin table links straight to a rater's log, so the query string has to
  // seed the selector rather than only the dropdown driving it.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("rater");
    if (q) setAsRater(q);
  }, []);

  const load = useCallback(async () => {
    const res = await fetch(
      asRater ? `/api/cases?rater=${encodeURIComponent(asRater)}` : "/api/cases",
      { cache: "no-store" });
    const d = await res.json();
    if (d.error) setError(d.error); else { setData(d); setError(null); }
  }, [asRater]);
  useEffect(() => { void load(); }, [load]);

  const families = useMemo(
    () => (data ? [...new Set(data.rows.map((r: any) => r.family))].sort() : []),
    [data],
  );

  const rows = useMemo(() => {
    if (!data) return [];
    return data.rows
      .filter((r: any) => r.judged > 0)
      .filter((r: any) => family === "all" || r.family === family)
      .filter((r: any) => {
        if (filter === "disagreed") {
          return KEYS.some((k) => r.metrics[k]?.agree != null && r.metrics[k].agree < 0.5);
        }
        if (filter === "unsure") return r.verdicts.some((v: any) => v.confidence <= 2);
        if (filter === "quick") return r.verdicts.some((v: any) => (v.decision_ms ?? 1e9) < 4000);
        return true;
      });
  }, [data, filter, family]);

  if (error) {
    return (
      <div className="wrap">
        <header className="bar">
          <Link className="home" href="/"><h1>BenchCAD Preference Lab</h1></Link>
          <span className="badge">review</span><span className="spacer" />
          <Link className="pill" href="/">← dashboard</Link>
        </header>
        <div className="card" style={{ borderColor: "var(--bad)" }}>{error}</div>
      </div>
    );
  }

  return (
    <div className="wrap">
      <header className="bar">
        <Link className="home" href="/"><h1>BenchCAD Preference Lab</h1></Link>
        <span className="badge">review</span>
        <span className="badge">{rows.length} judged</span>
        {data?.viewing && <span className="badge case">{data.viewing}</span>}
        <span className="spacer" />
        <a className="pill" href={asRater
             ? `/api/export?rater=${encodeURIComponent(asRater)}` : "/api/export"}>
          export csv
        </a>
        <Link className="pill" href="/cases">numbers →</Link>
        <Link className="pill" href="/">← dashboard</Link>
      </header>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="conf" style={{ alignItems: "center" }}>
          {(["all", "disagreed", "unsure", "quick"] as Filter[]).map((f) => (
            <button key={f} className="pill" data-on={filter === f ? 1 : 0}
                    onClick={() => { setFilter(f); setLimit(30); }}>
              {f === "all" ? "everything judged" :
               f === "disagreed" ? "a metric disagreed with me" :
               f === "unsure" ? "I was unsure (tie or slightly)" : "decided in under 4 s"}
            </button>
          ))}
          {data?.is_admin && data.raters?.length > 1 && (
            <>
              <span style={{ width: 12 }} />
              <select className="text" style={{ width: "auto" }} value={asRater}
                      onChange={(e) => { setAsRater(e.target.value); setLimit(30); }}
                      title="administrators only: replay another rater's log">
                <option value="">me</option>
                {data.raters.map((r: string) => <option key={r} value={r}>{r}</option>)}
              </select>
            </>
          )}
          <span style={{ width: 12 }} />
          <select className="text" style={{ width: "auto" }} value={family}
                  onChange={(e) => { setFamily(e.target.value); setLimit(30); }}>
            <option value="all">all families</option>
            {families.map((f: any) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        <p className="note" style={{ marginTop: 10, marginBottom: 0 }}>
          Left and right are shown exactly as they were presented to you — the sides
          are shuffled per case, so this is your own view replayed, not the pair's
          storage order. The green outline is what you picked.
        </p>
      </div>

      {!data ? <p className="note">Loading…</p> : rows.slice(0, limit).map((r: any) => (
        r.verdicts.filter((v: any) => v.mine).map((v: any, vi: number) => (
          <div className="card reviewrow" key={`${r.pair_id}-${vi}`}>
            <div className="rvhead">
              <span className="badge case">case #{r.case_no}</span>
              <span className="badge">{r.family}</span>
              <span className="badge">{r.cohort}</span>
              {v.counts_now === false && (
                <span className="badge" title="Judged against the earlier images, which normalised each shape on its own bounding box and so could not show a uniform size error.">
                  old stimulus
                </span>
              )}
              <span className="spacer" />
              <span className="note">
                {v.chose === "tie" ? "called it a tie" : `chose ${v.chose_side}`}
                {" · "}{CONF[v.confidence]}
                {v.decision_ms != null && <> · {(v.decision_ms / 1000).toFixed(1)} s</>}
              </span>
            </div>

            <div className="rvimgs">
              <figure className="rvcell">
                <img className="shot refshot" src={`/api/image/${v.ref_image ?? r.ref_image}`} alt="reference" />
                <figcaption>reference<br /><span className="idtag">{r.ref_id}</span></figcaption>
              </figure>
              {(["left", "right"] as const).map((side) => {
                const c = v[side];
                const picked = v.chose_side === side;
                return (
                  <figure key={side} className={`rvcell${picked ? " picked" : ""}`}>
                    {c.origin === "anchor" ? (
                      /* This side was a target score, never a render. */
                      <div className="shot anchorcard">
                        <span className="anchorlabel">{c.anchor_label ?? "score"}</span>
                        <span className="anchorvalue">
                          {(c.anchor_value ?? 0).toFixed(2)}
                        </span>
                      </div>
                    ) : (
                      <img className="shot" src={`/api/image/${c.image}`} alt={side} />
                    )}
                    <figcaption>
                      {side}{picked && <span className="chosen"> ✓ chosen</span>}
                      <br /><span className="idtag">{c.model ?? c.origin ?? "—"}</span>
                    </figcaption>
                  </figure>
                );
              })}
            </div>

            {/* Values, not just a verdict on the values. The metrics dict is
                stored A -> B; the pictures above are in the order this rater
                actually saw them, so the columns are flipped to match. Reading
                "left 0.92 / right 0.57" against the green outline is the whole
                point — "no" on its own says a metric disagreed but not by how
                much, and a 0.004 disagreement is not the same finding as a
                0.4 one. */}
            {(() => {
              const leftIsA = v.left.id === r.a.id;
              const side = (m: any, want: "left" | "right") =>
                m == null ? null : ((want === "left") === leftIsA ? m.a : m.b);
              const num = (x: number | null | undefined) =>
                x == null ? "—" : x.toFixed(3);
              return (
                <div className="scrollx">
                <table className="metrics compactmetrics">
                  <thead>
                    <tr><th /> {KEYS.map((k) => <th key={k}>{SHORT[k]}</th>)}</tr>
                  </thead>
                  <tbody>
                    {(["left", "right"] as const).map((s) => (
                      <tr key={s}>
                        <td className={v.chose_side === s ? "win" : "lose"}>
                          {s}{v.chose_side === s && " ✓"}
                        </td>
                        {KEYS.map((k) => {
                          const m = r.metrics[k];
                          const mine = side(m, s);
                          const other = side(m, s === "left" ? "right" : "left");
                          const better = mine != null && other != null && mine > other;
                          return (
                            <td key={k} className={`num ${better ? "win" : "lose"}`}>
                              {num(mine)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                    <tr>
                      <td className="lose">gap</td>
                      {KEYS.map((k) => {
                        const m = r.metrics[k];
                        const l = side(m, "left"), rt = side(m, "right");
                        const d = l != null && rt != null ? Math.abs(l - rt) : null;
                        return (
                          <td key={k} className="num lose">
                            {d == null ? "—" : d < 0.001 ? "<0.001" : d.toFixed(3)}
                          </td>
                        );
                      })}
                    </tr>
                    <tr>
                      <td className="lose">agreed?</td>
                      {KEYS.map((k) => {
                        const m = r.metrics[k];
                        return (
                          <td key={k} className={`num ${
                            m?.agree == null ? "lose" : m.agree >= 0.5 ? "win" : "warnrow"}`}>
                            {m?.agree == null ? "—" : m.agree >= 0.5 ? "yes" : "no"}
                          </td>
                        );
                      })}
                    </tr>
                  </tbody>
                </table>
                </div>
              );
            })()}
            {v.notes && <p className="note" style={{ marginTop: 8 }}>note: {v.notes}</p>}
          </div>
        ))
      ))}

      {data && rows.length > limit && (
        <button className="submit" style={{ margin: "8px auto", display: "block" }}
                onClick={() => setLimit((n) => n + 30)}>
          show 30 more ({rows.length - limit} left)
        </button>
      )}
      {data && rows.length === 0 && <p className="note">Nothing matches that filter.</p>}
      <BackToTop />
    </div>
  );
}
