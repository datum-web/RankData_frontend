"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import BackToTop from "./BackToTop";
import FamilyChart from "./FamilyChart";

/**
 * Dashboard — the landing page once signed in.
 *
 * Three groups of numbers, deliberately not merged: what the corpus contains,
 * what you personally have done, and what every rater has produced together.
 * Reading your own dozen verdicts as a study result is the mistake this
 * separation exists to prevent.
 */

const fmtMs = (ms: number | null | undefined) =>
  ms == null ? "—" : ms >= 60000 ? `${(ms / 60000).toFixed(1)} min` : `${(ms / 1000).toFixed(1)} s`;

const CONF_LABEL: Record<string, string> = {
  "1": "tie / can't separate", "2": "slightly", "3": "better", "4": "much better",
};

export default function Dashboard() {
  const [rater, setRater] = useState("");
  const [checking, setChecking] = useState(true);
  const [stats, setStats] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [gateError, setGateError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [admin, setAdmin] = useState(false);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/stats", { cache: "no-store" });
    const data = await res.json();
    if (data.error) setError(data.error);
    else { setStats(data); setError(null); }
  }, []);

  useEffect(() => {
    fetch("/api/session", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => { if (d.rater) setRater(d.rater); setAdmin(Boolean(d.admin)); })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => { if (rater) void refresh(); }, [rater, refresh]);

  if (checking) {
    return (
      <div className="wrap">
        <header className="bar"><Link className="home" href="/"><h1>BenchCAD Preference Lab</h1></Link></header>
        <p className="note">Checking your session…</p>
      </div>
    );
  }

  if (!rater) {
    return (
      <div className="wrap">
        <header className="bar"><Link className="home" href="/"><h1>BenchCAD Preference Lab</h1></Link></header>
        <div className="card" style={{ maxWidth: 460 }}>
          <h2>Sign in</h2>
          <p className="note" style={{ marginTop: 0 }}>
            Accounts are created by the study administrator; there is no public
            sign-up. Your account identifies you, so verdicts stay attributable and
            your queue picks up where you left off.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setGateError(null);
              const fd = new FormData(e.currentTarget);
              const email = (fd.get("email") as string || "").trim();
              const password = (fd.get("password") as string || "");
              if (!email || !password) return;
              const res = await fetch("/api/session", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ email, password }),
              });
              const data = await res.json();
              if (data.rater) setRater(data.rater);
              else setGateError(data.error || "could not sign in");
            }}
          >
            <label className="field">
              <span>Email</span>
              <input className="text" name="email" type="email" autoFocus
                     autoComplete="username" placeholder="you@example.com" />
            </label>
            <label className="field">
              <span>Password</span>
              <input className="text" name="password" type="password"
                     autoComplete="current-password" placeholder="••••••••" />
            </label>
            {gateError && (
              <p className="note" style={{ color: "var(--bad)", marginTop: 0 }}>{gateError}</p>
            )}
            <button className="submit" type="submit">Sign in</button>
          </form>
        </div>
      </div>
    );
  }

  const mine = stats?.mine;
  const corpus = stats?.corpus;
  const all = stats?.all;
  const done = mine?.judged ?? 0;
  const total = corpus?.pairs ?? 0;
  const progress = total ? (done / total) * 100 : 0;

  return (
    <div className="wrap">
      <header className="bar">
        <Link className="home" href="/"><h1>BenchCAD Preference Lab</h1></Link>
        <span className="badge">dashboard</span>
        <span className="spacer" />
        <span className="badge">{rater}</span>
        <Link className="pill" href="/review">review</Link>
        <Link className="pill" href="/cases">cases</Link>
        {admin && <Link className="pill" href="/admin">admin</Link>}
        <button
          className="pill"
          data-on={confirmReset ? 1 : 0}
          onClick={async () => {
            if (!confirmReset) { setConfirmReset(true); return; }
            setConfirmReset(false);
            const res = await fetch("/api/reset", { method: "POST" });
            const data = await res.json();
            if (data.error) return setError(data.error);
            await refresh();
          }}
        >{confirmReset ? "really? clears all your verdicts" : "reset my verdicts"}</button>
        <button
          className="pill"
          onClick={async () => {
            await fetch("/api/session", { method: "DELETE" });
            setRater("");
            setStats(null);
          }}
        >sign out</button>
      </header>

      {error && <div className="card" style={{ marginBottom: 16, borderColor: "var(--bad)" }}>{error}</div>}

      <div className="card hero">
        <div style={{ flex: 1 }}>
          <h2 style={{ marginBottom: 6 }}>Your progress</h2>
          <div className="big">{done} <span className="of">of {total} pairs</span></div>
          <div className="bar-track"><div className="bar-fill" style={{ width: `${progress}%` }} /></div>
          <p className="note" style={{ marginTop: 8, marginBottom: 0 }}>
            {mine?.remaining ?? 0} left
            {mine?.median_decision_ms != null && <> · {fmtMs(mine.median_decision_ms)} median per pair</>}
            {mine?.total_time_ms ? <> · {fmtMs(mine.total_time_ms)} spent</> : null}
            {mine?.capped ? (
              <> · <span title="pairs left open on screen; counted as 10 min each so one idle tab does not dominate the total">
                {mine.capped} idle {mine.capped === 1 ? "pair" : "pairs"} capped
              </span></>
            ) : null}
          </p>
        </div>
        <div style={{ display: "grid", gap: 8 }}>
          <Link className="submit start" href="/grade">
            {done === 0 ? "Start grading →" : done >= total ? "Review / redo →" : "Continue grading →"}
          </Link>
          {/* The same record built two different ways — the comparison the
              metric exists to be judged against, and the one the queue is
              thinnest on. Worth being able to spend a session on directly. */}
          <Link className="pill" href="/grade?cohort=native,model-vs-model"
                style={{ textAlign: "center" }}>
            same-record only →
          </Link>
        </div>
      </div>

      <div className="cards3">
        <div className="card">
          <h2>The corpus</h2>
          <div className="kv"><span>references</span><span>{corpus?.references ?? "—"}</span></div>
          <div className="kv"><span>candidates</span><span>{corpus?.candidates ?? "—"}</span></div>
          <div className="kv"><span>pairs</span><span>{corpus?.pairs ?? "—"}</span></div>
          {corpus?.cohorts && Object.entries(corpus.cohorts).map(([k, v]) => (
            <div className="kv" key={k}><span>· {k}</span><span>{v as number}</span></div>
          ))}
          <p className="note" style={{ marginTop: 10 }}>
            {corpus?.families ? `${Object.keys(corpus.families).length} families` : "—"}
            {corpus?.families && <> · see the distribution below</>}
          </p>
        </div>

        <div className="card">
          <h2>How you judged</h2>
          {done === 0 ? (
            <p className="note">Nothing yet. These fill in as you grade.</p>
          ) : (
            <>
              {["4", "3", "2", "1"].map((c) => (
                <div className="kv" key={c}>
                  <span>{CONF_LABEL[c]}</span>
                  <span>{mine?.by_confidence?.[c] ?? 0}</span>
                </div>
              ))}
              <div className="kv"><span>ties</span><span>{mine?.ties ?? 0}</span></div>
              <div className="kv">
                <span>picked the left side</span>
                <span className={
                  mine?.left_pick_rate != null && Math.abs(mine.left_pick_rate - 0.5) > 0.2
                    ? "warnrow" : undefined
                }>
                  {mine?.left_pick_rate == null ? "—" : `${(mine.left_pick_rate * 100).toFixed(0)}%`}
                </span>
              </div>
              <p className="note" style={{ marginTop: 10 }}>
                Sides are shuffled per pair, so a left-pick rate far from 50 % suggests
                position rather than geometry is driving the choice.
              </p>
            </>
          )}
        </div>

        <div className="card">
          <h2>Everyone</h2>
          <div className="kv"><span>verdicts</span><span>{all?.judgments ?? 0}</span></div>
          <div className="kv"><span>raters</span><span>{all?.raters?.length ?? 0}</span></div>
          <div className="kv"><span>ties</span><span>{all?.ties ?? 0}</span></div>
          <div className="kv"><span>median per pair</span><span>{fmtMs(all?.median_decision_ms)}</span></div>
          <p className="note" style={{ marginTop: 10 }}>
            Pooled across every rater, your own rows included.
          </p>
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>Would this metric alone have picked what the experts picked?</h2>
        {(all?.judgments ?? 0) === 0 ? (
          <p className="note">No verdicts yet — grade a few pairs and this fills in.</p>
        ) : (all?.carried_verdicts ?? 0) === 0
             && stats.metric_agreement.every((m: any) => !m.usable) ? (
          <p className="note">
            <b>{all.superseded_verdicts} verdicts are recorded and none can be counted
            here.</b> Each covers a pair containing a candidate whose only defect is a
            uniform scale error, and the earlier images normalised every shape on its
            own bounding box — that part rendered to within 0.03 % of the reference&apos;s
            pixels, so the defect was not on screen when the choice was made. Nothing
            was deleted; the verdicts are exportable and replayable in <b>review</b>.
          </p>
        ) : (
          <>
            <table className="metrics">
              <thead>
                <tr><th>metric</th><th>agrees</th><th>of</th><th style={{ width: 280 }}>rate</th></tr>
              </thead>
              <tbody>
                {stats.metric_agreement.map((m: any) => (
                  <tr key={m.key}>
                    <td>{m.label}</td>
                    <td className="num">{m.agree}</td>
                    <td className="num lose">{m.usable}</td>
                    <td>
                      {m.rate == null ? <span className="na">no usable pairs</span> : (
                        <div className="ratebar">
                          <div className="ratefill" style={{ width: `${m.rate * 100}%` }} />
                          <span className="ratetxt">{(m.rate * 100).toFixed(0)}%</span>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(all?.carried_verdicts ?? 0) > 0 && (
              <p className="note" style={{ marginTop: 12 }}>
                <b>{all.carried_verdicts} of these were made against the earlier
                images and are counted anyway.</b> Those images differed in framing
                and drew absolute position, neither of which the metrics measure or
                a rater judges on; they are excluded only where a candidate&apos;s
                defect was a uniform scale error, which the old renderer divided out
                and which therefore was not visible. {all.superseded_verdicts} verdicts
                are excluded on that basis.
                {(all?.carried_with_wrong_metrics ?? 0) > 0 && <>
                  {" "}A further caveat on {all.carried_with_wrong_metrics} of them:
                  the figures shown beside those pairs were computed against a
                  different reference from the one on screen, and the metric panel
                  was looked at. The pictures were right, the numbers were not.
                  Both are flagged per row in the CSV export.
                </>}
              </p>
            )}
            <p className="note" style={{ marginTop: 12 }}>
              A monitoring view, not the preference model. Ties are excluded because a
              metric can only express a direction. And the metrics were visible while
              these verdicts were made, so agreement here is an upper bound with
              anchoring baked in — not evidence that a metric predicts expert preference.
            </p>
          </>
        )}
      </div>

      {corpus?.families && (
        <div className="card" style={{ marginTop: 16 }}>
          <h2>What the corpus is made of</h2>
          <FamilyChart data={corpus.families as Record<string, number>}
                       unit="references" />
        </div>
      )}

      <BackToTop />
    </div>
  );
}
