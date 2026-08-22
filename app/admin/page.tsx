"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import BackToTop from "../BackToTop";
import FamilyChart from "../FamilyChart";

/**
 * Administrator view.
 *
 * Answers what the rater dashboard deliberately must not: who has done what,
 * where coverage is thin, whether two raters who saw the same pair agreed, and
 * whether a metric's apparent agreement survives being split by cohort.
 */

const fmtMs = (ms: number | null | undefined) =>
  ms == null ? "—" : ms >= 60000 ? `${(ms / 60000).toFixed(1)} min` : `${(ms / 1000).toFixed(1)} s`;

const fmtWhen = (iso: string | null | undefined) =>
  !iso ? "never" : new Date(iso).toISOString().slice(0, 16).replace("T", " ");

const rate = (r: number | null | undefined) =>
  r == null ? "—" : `${(r * 100).toFixed(0)}%`;

/**
 * What the corpus is actually made of.
 *
 * Every aggregate on this page is a weighted average over families, and the
 * weights are not uniform: the generator produced far more rings and fasteners
 * than anything else, so "agreement is 0.76" is largely a statement about
 * washers. Rather than let that be discovered by someone reading a surprising
 * number, it is shown — at all four levels, because they skew differently. A
 * family can hold many references and few pairs, or many pairs and no verdicts.
 *
 * Administrators only. A rater who sees which families are thin has been told
 * which cases carry the most weight, and that is an invitation to judge them
 * differently.
 */
function FamilyDistribution({ d }: { d: any }) {
  const [level, setLevel] = useState<"refs" | "candidates" | "pairs" | "verdicts">("pairs");
  const data: Record<string, number> = {};
  for (const r of d.families as any[]) data[r.family] = r[level] ?? 0;
  const thin = (d.families as any[]).filter((r) => r.pairs > 0 && !r.judged);

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="bar" style={{ marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>What the corpus is made of</h2>
        <span className="spacer" />
        {(["refs", "candidates", "pairs", "verdicts"] as const).map((k) => (
          <button key={k} className="pill" onClick={() => setLevel(k)}
                  style={{ opacity: level === k ? 1 : 0.42, cursor: "pointer" }}>
            {k}
          </button>
        ))}
      </div>
      <FamilyChart data={data} unit={level === "verdicts" ? "verdicts" : level} />
      {thin.length > 0 && (
        <p className="note" style={{ marginTop: 12 }}>
          <span className="warnrow" style={{ marginTop: 0 }}>{thin.length} families</span>
          {" "}have pairs in the queue and no verdict yet — that is how a corpus ends up
          broad on paper and narrow in the data.
        </p>
      )}
    </div>
  );
}

export default function AdminPage() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/admin/stats", { cache: "no-store" });
    const d = await res.json();
    if (d.error) setError(d.error);
    else { setData(d); setError(null); }
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  if (loading) {
    return <div className="wrap"><header className="bar">
      <Link className="home" href="/"><h1>BenchCAD Preference Lab</h1></Link>
      <span className="badge">admin</span></header>
      <p className="note">Loading…</p></div>;
  }

  if (error) {
    return (
      <div className="wrap">
        <header className="bar">
          <Link className="home" href="/"><h1>BenchCAD Preference Lab</h1></Link>
          <span className="badge">admin</span><span className="spacer" />
          <Link className="pill" href="/">← dashboard</Link>
        </header>
        <div className="card" style={{ borderColor: "var(--bad)", maxWidth: 560 }}>
          <h2>Not available</h2>
          <p className="note" style={{ marginTop: 0 }}>{error}</p>
          <p className="note">
            Administrators are listed in <code>PREFERENCE_LAB_ADMINS</code>. With that
            variable unset nobody is an administrator, so a misconfigured deployment
            locks this page rather than opening it.
          </p>
        </div>
      </div>
    );
  }

  const cov = data.coverage;
  const ir = data.inter_rater;

  return (
    <div className="wrap">
      <header className="bar">
        <Link className="home" href="/"><h1>BenchCAD Preference Lab</h1></Link>
        <span className="badge">admin</span>
        <span className="spacer" />
        <Link className="pill" href="/">← my dashboard</Link>
        <Link className="pill" href="/grade">grade →</Link>
      </header>

      <div className="cards3" style={{ marginBottom: 16 }}>
        <div className="card">
          <h2>Coverage</h2>
          <div className="kv"><span>pairs in the corpus</span><span>{cov.total}</span></div>
          <div className="kv"><span>never judged</span><span>{cov.unjudged}</span></div>
          <div className="kv"><span>judged once</span><span>{cov.once}</span></div>
          <div className="kv"><span>judged twice or more</span><span>{cov.twice_or_more}</span></div>
          <p className="note" style={{ marginTop: 10 }}>
            Only the last row supports inter-rater agreement. One opinion on a pair is
            data; it is not agreement.
          </p>
        </div>

        <div className="card">
          <h2>Inter-rater agreement</h2>
          {ir.comparable === 0 ? (
            <p className="note">
              No pair has a direction from two different raters yet, so there is nothing
              to compare. This stays empty until a second rater overlaps with the first.
            </p>
          ) : (
            <>
              <div className="big">{rate(ir.rate)}</div>
              <div className="kv"><span>comparable rater pairs</span><span>{ir.comparable}</span></div>
              <div className="kv"><span>agreed</span><span>{ir.agree}</span></div>
              <p className="note" style={{ marginTop: 10 }}>
                Ties are excluded — two raters calling a pair indistinguishable is not a
                direction to agree on.
              </p>
            </>
          )}
        </div>

        <div className="card">
          <h2>Corpus</h2>
          <div className="kv"><span>references</span><span>{data.corpus.references}</span></div>
          <div className="kv"><span>candidates</span><span>{data.corpus.candidates}</span></div>
          <div className="kv"><span>pairs</span><span>{data.corpus.pairs}</span></div>
          {Object.entries(data.corpus.cohorts).map(([k, v]) => (
            <div className="kv" key={k}><span>· {k}</span><span>{v as number}</span></div>
          ))}
          <div className="kv"><span>accounts</span><span>{data.accounts}</span></div>
        </div>
      </div>

      {data.distribution && <FamilyDistribution d={data.distribution} />}

      <div className="card" style={{ marginBottom: 16 }}>
        <div className="bar" style={{ marginBottom: 10 }}>
          <h2 style={{ margin: 0 }}>Raters</h2>
          <span className="spacer" />
          <a className="pill" href="/api/export?rater=all">export everyone (csv)</a>
        </div>
        <div className="scrollx"><table className="metrics">
          <thead>
            <tr>
              <th>account</th><th>judged</th><th>left</th><th>ties</th>
              <th>median</th><th>total</th><th>left-pick</th><th>last verdict</th>
              <th>last sign-in</th><th>cases</th><th>export</th>
            </tr>
          </thead>
          <tbody>
            {data.raters.map((r: any) => (
              <tr key={r.email}>
                <td>
                  {r.email}
                  {!r.account.exists && <span className="warnrow"> · no account</span>}
                  {r.account.banned && <span className="warnrow"> · disabled</span>}
                </td>
                <td className="num">{r.judged}</td>
                <td className="num lose">{r.remaining}</td>
                <td className="num lose">{r.ties}</td>
                <td className="num">{fmtMs(r.median_decision_ms)}</td>
                <td className="num lose">
                  {fmtMs(r.total_time_ms)}
                  {r.capped ? <span className="warnrow"> ·{r.capped} capped</span> : null}
                </td>
                <td className={`num ${
                  r.left_pick_rate != null && Math.abs(r.left_pick_rate - 0.5) > 0.2 ? "warnrow" : "lose"
                }`}>{rate(r.left_pick_rate)}</td>
                <td className="num lose">{fmtWhen(r.last_activity)}</td>
                <td className="num lose">{fmtWhen(r.account.last_sign_in)}</td>
                <td className="num">
                  {r.judged > 0
                    ? <Link className="pill" href={`/review?rater=${encodeURIComponent(r.email)}`}>open →</Link>
                    : <span className="na">—</span>}
                </td>
                <td className="num">
                  {r.judged > 0
                    ? <a className="pill" href={`/api/export?rater=${encodeURIComponent(r.email)}`}>csv</a>
                    : <span className="na">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table></div>
        <h3 style={{ marginTop: 22 }}>Where each rater sits against the metrics</h3>
        <div className="scrollx"><table className="metrics">
          <thead>
            <tr>
              <th>account</th>
              {(data.metric_keys ?? []).map((k: string) => <th key={k}>{k}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.raters.filter((r: any) => r.judged > 0).map((r: any) => (
              <tr key={r.email}>
                <td className="lose">{r.email}</td>
                {(data.metric_keys ?? []).map((k: string) => {
                  const m = r.metric_agreement?.[k];
                  if (!m || !m.n) return <td key={k} className="num lose">—</td>;
                  const p = m.agree / m.n;
                  return (
                    <td key={k} className={`num ${p >= 0.5 ? "win" : "warnrow"}`}
                        title={`${m.agree} of ${m.n} directional verdicts where this metric separates the pair`}>
                      {p.toFixed(2)}<span className="lose"> n={m.n}</span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table></div>
        <p className="note" style={{ marginTop: 10 }}>
          Share of that rater&apos;s directional verdicts the metric agreed with, over
          the pairs where it separates the two candidates at all. Below 0.50 is worth
          opening the case log for: a metric that is systematically <i>opposite</i> to a
          person is a stronger signal than one that is merely noisy.
        </p>
        <p className="note" style={{ marginTop: 6 }}>
          Counted over the <b>current stimulus only</b>. The first image set normalised
          every shape on its own bounding box and so could not show a uniform size
          error; verdicts formed against it are a different observation and are not
          averaged in.{" "}
          {data.raters.reduce((a: number, r: any) => a + (r.superseded ?? 0), 0) > 0 && (
            <b>{data.raters.reduce((a: number, r: any) => a + (r.superseded ?? 0), 0)} verdict(s)
            sit under the superseded stimulus and are excluded here</b>
          )}
        </p>

        <p className="note" style={{ marginTop: 12 }}>
          Sides are shuffled per (pair, rater), so a left-pick rate more than 20 points
          off even is flagged: it usually means position rather than geometry is driving
          that rater's choices.
        </p>
      </div>

      <div className="card">
        <h2>Metric agreement, split by cohort</h2>
        <div className="scrollx"><table className="metrics">
          <thead>
            <tr>
              <th>metric</th><th>overall</th>
              {data.cohorts.map((c: string) => <th key={c}>{c}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.metric_agreement.map((m: any) => (
              <tr key={m.key}>
                <td>{m.label}</td>
                <td className="num">
                  {m.overall.rate == null ? <span className="na">—</span>
                    : <>{rate(m.overall.rate)} <span className="lose">({m.overall.agree}/{m.overall.usable})</span></>}
                </td>
                {data.cohorts.map((c: string) => {
                  const cell = m.by_cohort[c];
                  return (
                    <td className="num" key={c}>
                      {!cell || cell.rate == null ? <span className="na">—</span>
                        : <>{rate(cell.rate)} <span className="lose">({cell.agree}/{cell.usable})</span></>}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table></div>
        <p className="note" style={{ marginTop: 12 }}>
          Split because the cohorts ask slightly different things: in <code>native</code>
          both candidates were generated for that exact record, while in
          <code> same-family</code> they are real outputs for sibling records. A metric
          that only agrees on one of them has not earned the overall number. And the
          metrics were visible while these verdicts were made, so every figure here is an
          upper bound with anchoring baked in.
        </p>
      </div>

      {ir.disputes.length > 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>Where raters disagreed</h2>
          <div className="scrollx"><table className="metrics">
            <thead><tr><th>pair</th><th>cohort</th><th>rater A</th><th>rater B</th></tr></thead>
            <tbody>
              {ir.disputes.map((d: any) => (
                <tr key={d.pair_id}>
                  <td>{d.pair_id}</td>
                  <td className="lose">{d.cohort}</td>
                  <td className="num">{d.a.rater} → {d.a.chose} <span className="lose">(c{d.a.confidence})</span></td>
                  <td className="num">{d.b.rater} → {d.b.chose} <span className="lose">(c{d.b.confidence})</span></td>
                </tr>
              ))}
            </tbody>
          </table></div>
          <p className="note" style={{ marginTop: 12 }}>
            The most informative rows in the study: two experts, same images, opposite
            calls. Worth opening the pair and reading the notes.
          </p>
        </div>
      )}

      <BackToTop />
    </div>
  );
}
