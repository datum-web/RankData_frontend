"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import BackToTop from "../BackToTop";
import { explainWarnings } from "@/lib/corpus";

/**
 * Case-by-case: every score next to every verdict.
 *
 * The dashboard reports how often a metric agreed. It cannot say *where* it
 * disagreed, and that is the question worth asking — so this table exists to be
 * filtered down to the rows where the metrics and the people part company.
 */

const KEYS = ["v1_iou", "aligned_iou", "topology", "face", "edge", "bspace_min", "q_l"] as const;
const SHORT: Record<string, string> = {
  v1_iou: "v1 IoU", aligned_iou: "aligned", topology: "topo",
  face: "face", edge: "edge", bspace_min: "B-min", q_l: "Q_L",
};

const num = (v: number | null | undefined, d = 3) =>
  v == null ? "—" : v.toFixed(d);

/** Why this cell has no comparison — the evaluator's own words where it has any. */
function why(row: any, m: any): string | null {
  if (m?.a == null && row.a?.origin === "anchor") return "A is a score anchor: a target number, not a solid";
  if (m?.b == null && row.b?.origin === "anchor") return "B is a score anchor: a target number, not a solid";
  const w = [
    ...explainWarnings(m?.a == null ? row.a?.warnings : []),
    ...explainWarnings(m?.b == null ? row.b?.warnings : []),
  ];
  return w.length ? w.map((x) => x.text).join(" ") : null;
}

type Filter = "all" | "judged" | "disputed" | "split";

export default function CasesPage() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("judged");
  const [family, setFamily] = useState("all");
  const [cohort, setCohort] = useState("all");

  const load = useCallback(async () => {
    const res = await fetch("/api/cases", { cache: "no-store" });
    const d = await res.json();
    if (d.error) setError(d.error); else { setData(d); setError(null); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const families = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.rows.map((r: any) => r.family))].sort();
  }, [data]);

  const cohorts = useMemo(
    () => (data ? [...new Set(data.rows.map((r: any) => r.cohort))].sort() : []),
    [data],
  );

  const rows = useMemo(() => {
    if (!data) return [];
    return data.rows.filter((r: any) => {
      if (family !== "all" && r.family !== family) return false;
      if (cohort !== "all" && r.cohort !== cohort) return false;
      if (filter === "judged") return r.judged > 0;
      // A metric said one thing and the person said the other.
      if (filter === "disputed") {
        return r.judged > 0 && KEYS.some((k) => {
          const m = r.metrics[k];
          return m?.agree != null && m.agree < 0.5;
        });
      }
      // The metrics do not agree among themselves; the human verdict is what
      // settles these, so they are the most informative rows to look at.
      if (filter === "split") return r.metric_split.a > 0 && r.metric_split.b > 0;
      return true;
    });
  }, [data, filter, family, cohort]);

  if (error) {
    return (
      <div className="wrap">
        <header className="bar">
          <Link className="home" href="/"><h1>BenchCAD Preference Lab</h1></Link>
          <span className="badge">cases</span><span className="spacer" />
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
        <span className="badge">cases</span>
        <span className="badge">{rows.length} shown</span>
        <span className="spacer" />
        <Link className="pill" href="/">← dashboard</Link>
        <Link className="pill" href="/grade">grade →</Link>
      </header>

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="conf" style={{ alignItems: "center" }}>
          {(["judged", "disputed", "split", "all"] as Filter[]).map((f) => (
            <button key={f} className="pill" data-on={filter === f ? 1 : 0}
                    onClick={() => setFilter(f)}>
              {f === "judged" ? "judged" :
               f === "disputed" ? "a metric disagreed with the person" :
               f === "split" ? "metrics disagree with each other" : "everything"}
            </button>
          ))}
          <span style={{ width: 12 }} />
          <select className="text" style={{ width: "auto" }} value={family}
                  onChange={(e) => setFamily(e.target.value)}>
            <option value="all">all families</option>
            {families.map((f: any) => <option key={f} value={f}>{f}</option>)}
          </select>
          <select className="text" style={{ width: "auto" }} value={cohort}
                  onChange={(e) => setCohort(e.target.value)}>
            <option value="all">all cohorts</option>
            {cohorts.map((c: any) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <p className="note" style={{ marginTop: 10, marginBottom: 0 }}>
          Each cell holds <b>both</b> scores, A above B — the pair's own order, never
          left/right, so a row means the same thing however the sides were shuffled for
          whoever judged it. The higher of the two is green. The cell is tinted once a
          verdict exists: green if the metric picked the same side, red if it picked
          the other.
        </p>
        <p className="note" style={{ marginTop: 6, marginBottom: 0 }}>
          A dash is one of three things, never a lost computation. The pair is a{" "}
          <b>score anchor</b>, so one side is a target number and carries only the
          metric being anchored. Or the evaluator <b>could not produce that channel</b>{" "}
          for that solid — a mesh that is not watertight has no topology, an empty
          boolean intersection has no IoU — and the reason is recorded as a warning on
          the candidate. Or the two sides are <b>exactly equal</b>, in which case both
          numbers are still printed and only the comparison is empty.
        </p>
      </div>

      {!data ? <p className="note">Loading…</p> : (
        <div className="card scrollx">
          <table className="metrics cases">
            <thead>
              <tr>
                <th>case</th><th>family</th><th>cohort</th>
                {KEYS.map((k) => <th key={k}>{SHORT[k]}</th>)}
                <th>metrics split</th><th>verdicts</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any) => (
                <tr key={r.pair_id}>
                  <td className="num"><b>#{r.case_no}</b></td>
                  <td className="lose">{r.family}</td>
                  <td className="lose">{r.cohort}</td>
                  {/* Both values, not the difference. Showing only the delta
                      blanked the whole cell whenever one side lacked the metric
                      — which is every anchor pair, where the real candidate's
                      seven scores all exist — and again whenever the two sides
                      were exactly equal, which is most of topology. The number
                      that was computed should be on screen. */}
                  {KEYS.map((k) => {
                    const m = r.metrics[k];
                    const agreeCls = m?.agree == null ? "" : m.agree >= 0.5 ? " agreed" : " opposed";
                    return (
                      <td key={k} className={`num twoval${agreeCls}`}
                          title={m?.delta == null
                                 ? (why(r, m) ?? "no comparison: one side has no value here")
                                 : `gap ${Math.abs(m.delta).toFixed(4)}` +
                                   (m.agree == null ? "" : m.agree >= 0.5
                                     ? " · metric agreed with the verdict"
                                     : " · metric disagreed with the verdict")}>
                        <span className={m?.prefers === "A" ? "win" : ""}>{num(m?.a)}</span>
                        <span className={m?.prefers === "B" ? "win" : ""}>{num(m?.b)}</span>
                        {m?.delta == null && why(r, m) && <span className="whymark">?</span>}
                      </td>
                    );
                  })}
                  <td className="num lose">{r.metric_split.a}–{r.metric_split.b}</td>
                  <td>
                    {r.verdicts.length === 0 ? <span className="na">not judged</span> : (
                      r.verdicts.map((v: any, i: number) => (
                        <span key={i} className={`favours ${v.chose === "A" ? "L" : v.chose === "B" ? "R" : ""}`}
                              style={{ marginRight: 6 }}
                              title={`${v.rater} · confidence ${v.confidence}` +
                                     (v.notes ? ` · ${v.notes}` : "")}>
                          {v.chose}{v.chose !== "tie" ? `·c${v.confidence}` : ""}
                        </span>
                      ))
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length === 0 && <p className="note">Nothing matches that filter.</p>}
        </div>
      )}
      <BackToTop />
    </div>
  );
}
