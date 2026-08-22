"use client";

import { useMemo, useState } from "react";

/**
 * What the corpus is made of, as a shape rather than a sentence.
 *
 * This replaced a hundred families printed as `bolt 12 · bucket 2 · …` on one
 * line — unreadable, and it hid the one thing it was supposed to show: how
 * evenly the corpus is spread. That answer is not the same at every level.
 * References are close to uniform (104 families, 88.4 effective); pairs are
 * not (12 families hold 60 %). A sentence cannot carry either.
 *
 * The ring draws every family, so its texture is the answer: many similar
 * slices means even, one dominant wedge means skewed. The bars underneath rank
 * them, so a reader can also find their own family. Folding the tail into a
 * single grey wedge was tried first and was worse than the sentence — on a
 * near-uniform distribution it made 86 % of the ring one colour, which reads as
 * extreme skew when the truth is the opposite.
 *
 * Drawn as inline SVG on purpose: no chart library, nothing to load, and the
 * public mirror stays a handful of source files.
 */

const RING = [
  "#6ec3c0", "#e08a3c", "#5fbf7d", "#8b9dc9", "#d8695f",
  "#c9a227", "#9b6fc4", "#4fa3a0", "#c47b9c", "#7f9f5a",
  "#d0a05f", "#6b8fb5",
];
const REST = "#39424e";   // the tail, in the bar list

type Props = {
  /** family -> count */
  data: Record<string, number>;
  /** what one unit is, for the tooltip and the caption */
  unit?: string;
  /** how many families get a distinct colour before the tail ramp begins */
  head?: number;
};

function arc(cx: number, cy: number, r: number, from: number, to: number) {
  const p = (a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  const [x0, y0] = p(from);
  const [x1, y1] = p(to);
  return `M ${x0} ${y0} A ${r} ${r} 0 ${to - from > Math.PI ? 1 : 0} 1 ${x1} ${y1}`;
}

export default function FamilyChart({ data, unit = "pairs", head = 10 }: Props) {
  const [hover, setHover] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  const { slices, rows, total, effective, topShare, singletons } = useMemo(() => {
    const rows = Object.entries(data)
      .filter(([, n]) => n > 0)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const total = rows.reduce((s, [, n]) => s + n, 0);
    // Every family gets a slice. Folding the tail into one grey wedge was
    // actively misleading: at the reference level the corpus is close to even —
    // 104 families, 88.4 effective — and a ring that is 86 % one colour reads
    // as extreme skew. Drawn in full, the texture tells the truth either way:
    // many similar slices means even, one dominant wedge means skewed.
    const slices = rows.map(([f, n], i) => ({
      family: f, n,
      colour: i < head
        ? RING[i % RING.length]
        // Tail: one hue, fading with rank, so the head still reads as the head
        // without pretending the tail is a single thing.
        : `hsl(207 12% ${44 - Math.min(18, (18 * (i - head)) / Math.max(1, rows.length - head))}%)`,
    }));
    // exp(entropy): the number of *equally sized* families that would produce
    // this spread. Far below the family count means the tail is decorative.
    let h = 0;
    for (const [, n] of rows) {
      const p = n / total;
      if (p > 0) h -= p * Math.log(p);
    }
    return {
      slices, rows, total,
      effective: total ? Math.exp(h) : 0,
      topShare: total ? rows.slice(0, 5).reduce((s, [, n]) => s + n, 0) / total : 0,
      singletons: rows.filter(([, n]) => n === 1).length,
    };
  }, [data, head]);

  if (!total) return <p className="note">No families yet.</p>;

  const R = 78, SW = 26, C = 96;
  let angle = -Math.PI / 2;
  const max = rows[0][1];
  const visible = expanded ? rows : rows.slice(0, 14);

  return (
    <div className="famchart">
      <div className="famring">
        <svg viewBox="0 0 192 192" width="192" height="192" role="img"
             aria-label={`family distribution over ${total} ${unit}`}>
          {slices.map((s) => {
            const sweep = (s.n / total) * Math.PI * 2;
            const gap = Math.min(0.012, sweep * 0.18);
            const d = arc(C, C, R, angle + gap, angle + sweep - gap);
            angle += sweep;
            const on = hover === s.family;
            return (
              <path key={s.family} d={d} fill="none" stroke={s.colour}
                    strokeWidth={on ? SW + 5 : SW} opacity={hover && !on ? 0.35 : 1}
                    onMouseEnter={() => setHover(s.family)}
                    onMouseLeave={() => setHover(null)}>
                <title>{`${s.family} — ${s.n} ${unit} (${(100 * s.n / total).toFixed(1)}%)`}</title>
              </path>
            );
          })}
          <text x={C} y={C - 6} textAnchor="middle" className="fambig">
            {hover ? slices.find((s) => s.family === hover)?.n : rows.length}
          </text>
          <text x={C} y={C + 12} textAnchor="middle" className="famsub">
            {hover ? unit : "families"}
          </text>
        </svg>
      </div>

      <div className="famside">
        <div className="famstats">
          <div><b>{effective.toFixed(1)}</b><span>effective families</span></div>
          <div><b>{(100 * topShare).toFixed(0)}%</b><span>held by the top 5</span></div>
          <div><b>{singletons}</b><span>with a single {unit.replace(/s$/, "")}</span></div>
        </div>
        <p className="note" style={{ margin: "2px 0 10px" }}>
          <b>Effective families</b> is exp(entropy) — how many <i>equally sized</i>
          {" "}families would give this same spread. {rows.length} present against
          {" "}{effective.toFixed(1)} effective means the aggregates belong to the head.
        </p>
        <div className="fambars">
          {visible.map(([f, n], i) => (
            <div key={f} className={`fambar${hover === f ? " on" : ""}`}
                 onMouseEnter={() => setHover(f)} onMouseLeave={() => setHover(null)}>
              <span className="fname">{f}</span>
              <span className="ftrack">
                <span className="ffill" style={{
                  width: `${(100 * n) / max}%`,
                  background: i < head ? RING[i % RING.length] : REST,
                }} />
              </span>
              <span className="fnum">{n}</span>
            </div>
          ))}
        </div>
        {rows.length > 14 && (
          <button className="pill" style={{ marginTop: 8, cursor: "pointer" }}
                  onClick={() => setExpanded((v) => !v)}>
            {expanded ? "show fewer" : `show all ${rows.length}`}
          </button>
        )}
      </div>
    </div>
  );
}
