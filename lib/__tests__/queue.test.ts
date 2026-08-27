/**
 * The queue decides what a rater is asked and in what order, and it is the one
 * part of the app where a mistake is invisible: a bad order still serves pairs,
 * still records verdicts, and quietly ruins the study a month later. Hence
 * tests on the properties rather than on the output.
 */
import { describe, expect, it } from "vitest";
import { aOnLeft, buildQueue, disagreement, shuffleFor } from "../queue";
import { hash } from "../hash";

const pairs = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: `p${String(i).padStart(3, "0")}` }));

describe("hash", () => {
  it("is deterministic", () => {
    expect(hash("abc")).toBe(hash("abc"));
  });

  it("separates inputs that share a long prefix", () => {
    // The failure this replaced: plain FNV-1a left neighbouring ids in the same
    // family, because every id in a family shares a prefix. Sorting by the hash
    // must not preserve the input order.
    const ids = pairs(200).map((p) => `spline_hub_000123::${p.id}`);
    const sorted = [...ids].sort((a, b) => hash(a) - hash(b));
    const kept = sorted.filter((id, i) => id === ids[i]).length;
    expect(kept).toBeLessThan(10);           // ~1 expected by chance
  });
});

describe("aOnLeft", () => {
  it("is stable for a (pair, rater) — a reload must not flip the sides", () => {
    for (const p of pairs(20)) {
      expect(aOnLeft(p.id, "a@x.com")).toBe(aOnLeft(p.id, "a@x.com"));
    }
  });

  it("puts A on either side across a corpus", () => {
    const left = pairs(400).filter((p) => aOnLeft(p.id, "a@x.com")).length;
    expect(left).toBeGreaterThan(150);
    expect(left).toBeLessThan(250);
  });

  it("differs between raters, so side bias cannot line up across a panel", () => {
    const same = pairs(200).filter(
      (p) => aOnLeft(p.id, "a@x.com") === aOnLeft(p.id, "b@x.com")).length;
    expect(same).toBeGreaterThan(60);
    expect(same).toBeLessThan(140);
  });
});

describe("disagreement", () => {
  const pair = { a: "A", b: "B", ref_id: "R" };
  const from = (a: Record<string, number | null>, b: Record<string, number | null>) =>
    (cand: string, _ref: string, key: string) =>
      (cand === "A" ? a : b)[key] ?? null;

  it("is 0 when every channel picks the same side", () => {
    expect(disagreement(from(
      { aligned_iou: 0.9, pix_fg: 0.9, sil_iou: 0.9, dino_cos: 0.9, topology: 0.9 },
      { aligned_iou: 0.1, pix_fg: 0.1, sil_iou: 0.1, dino_cos: 0.1, topology: 0.1 },
    ), pair)).toBe(0);
  });

  it("is 1 when they split evenly", () => {
    expect(disagreement(from(
      { aligned_iou: 0.9, pix_fg: 0.9, sil_iou: 0.1, dino_cos: 0.1 },
      { aligned_iou: 0.1, pix_fg: 0.1, sil_iou: 0.9, dino_cos: 0.9 },
    ), pair)).toBe(1);
  });

  it("is 0 when too few channels have an opinion to disagree", () => {
    // One vote is not a disagreement, and neither is none.
    expect(disagreement(from({ pix_fg: 0.9 }, { pix_fg: 0.1 }), pair)).toBe(0);
    expect(disagreement(from({}, {}), pair)).toBe(0);
  });

  it("ignores channels that are equal or missing rather than counting them", () => {
    // `topology` is 1.0 on both sides of most pairs; counting a tie as a vote
    // would drown the channels that actually separated them.
    const d = disagreement(from(
      { aligned_iou: 0.9, topology: 0.5, sil_iou: null },
      { aligned_iou: 0.1, topology: 0.5, sil_iou: 0.4 },
    ), pair);
    expect(d).toBe(0);          // one real vote left
  });
});

describe("buildQueue", () => {
  const all = pairs(60);
  const info = new Map(all.map((p, i) => [p.id, i < 10 ? 1 : i < 30 ? 0.5 : 0]));

  it("gives every rater the same core, so the panel overlaps", () => {
    const a = buildQueue(all, { rater: "a@x", info, corePairs: 10 });
    const b = buildQueue(all, { rater: "b@x", info, corePairs: 10 });
    expect(new Set(a.slice(0, 10).map((p) => p.id)))
      .toEqual(new Set(b.slice(0, 10).map((p) => p.id)));
  });

  it("puts the most contested pairs in that core", () => {
    const q = buildQueue(all, { rater: "a@x", info, corePairs: 10 });
    for (const p of q.slice(0, 10)) expect(info.get(p.id)).toBe(1);
  });

  it("does not give two raters the same order outside the core", () => {
    // The whole reason the order is shuffled: fatigue and drift must not line
    // up across people. A total sort by disagreement destroyed this.
    const a = buildQueue(all, { rater: "a@x", info, corePairs: 10 }).slice(10);
    const b = buildQueue(all, { rater: "b@x", info, corePairs: 10 }).slice(10);
    const same = a.filter((p, i) => p.id === b[i].id).length;
    expect(same).toBeLessThan(a.length / 2);
  });

  it("still orders informative before uninformative, in bands", () => {
    const q = buildQueue(all, { rater: "a@x", info, corePairs: 0 });
    const scores = q.map((p) => info.get(p.id)!);
    // non-increasing by band
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
  });

  it("loses nothing and duplicates nothing", () => {
    const q = buildQueue(all, { rater: "a@x", info, corePairs: 10 });
    expect(q).toHaveLength(all.length);
    expect(new Set(q.map((p) => p.id)).size).toBe(all.length);
  });

  it("falls back to the plain shuffle on request", () => {
    const q = buildQueue(all, { rater: "a@x", info, corePairs: 10, mode: "shuffle" });
    expect(q.map((p) => p.id)).toEqual(shuffleFor(all, "a@x").map((p) => p.id));
  });

  it("survives a corpus smaller than the core", () => {
    const few = pairs(3);
    const q = buildQueue(few, { rater: "a@x", info: new Map(), corePairs: 200 });
    expect(q).toHaveLength(3);
  });
});
