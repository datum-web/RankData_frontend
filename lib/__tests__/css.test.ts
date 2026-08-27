/**
 * A lint for the one CSS mistake that has actually cost us a layout.
 *
 * `grid-template-columns: 1fr` is `minmax(auto, 1fr)`, and `auto` floors the
 * track at its min-content width. One unbreakable candidate id therefore
 * widened its column past the viewport and the whole page scrolled sideways
 * with the right-hand card off-screen — at 390 px the grading page overflowed
 * by 172 px and the admin page by 626.
 *
 * Seventeen tracks in the file had the bug; only one happened to hold content
 * long enough to show it. That is the argument for a lint rather than a fix:
 * the next one will be latent too.
 *
 * There is no jsdom here and this deliberately does not need one. It reads the
 * stylesheet as text, which is enough to catch the shape.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync(join(__dirname, "..", "..", "app", "globals.css"), "utf8");

/** Every `grid-template-columns` declaration, comments stripped. */
function tracks(): string[] {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => l.includes("grid-template-columns:"))
    .map((l) => l.trim());
}

describe("globals.css", () => {
  it("has grid declarations to check", () => {
    expect(tracks().length).toBeGreaterThan(10);
  });

  it("never uses a bare `1fr` track", () => {
    // `minmax(0, 1fr)` is fine; `repeat(3, minmax(0, 1fr))` is fine;
    // a naked `1fr` anywhere in the track list is not.
    const offenders = tracks().filter((line) => {
      const value = line.split("grid-template-columns:")[1] ?? "";
      const withoutMinmax = value.replace(/minmax\([^)]*\)/g, "MM");
      return /\b\d*\.?\d*fr\b/.test(withoutMinmax);
    });
    expect(offenders).toEqual([]);
  });

  it("lets a long value wrap without breaking its label", () => {
    // Applying the wrap to every `.kv span` broke the labels too: at 390 px
    // "candidate" came out as can / did / ate down three lines.
    expect(css).toMatch(/\.kv span:last-child[^{]*\{[^}]*overflow-wrap:\s*anywhere/);
    expect(css).toMatch(/\.kv span:first-child[^{]*\{[^}]*white-space:\s*nowrap/);
  });

  it("keeps a scroll container for the wide tables", () => {
    // A metric table has six columns and a floor of ~550 px. Below that it
    // scrolls in its own box rather than dragging the page sideways.
    expect(css).toMatch(/\.scrollx\s*\{[^}]*overflow-x:\s*auto/);
  });
});

/**
 * The reference is what both candidates are being compared against, so it must
 * not be the smallest picture on the page. It was capped at 230px wide while
 * the candidates got 300px tall — about 110px per view of a 2x2 composite,
 * which is not enough of a CAD part to judge from.
 */
describe("judging layout", () => {
  const css = readFileSync(join(__dirname, "../../app/globals.css"), "utf8");
  const num = (re: RegExp) => {
    const m = css.match(re);
    return m ? Number(m[1]) : NaN;
  };

  it("does not make the reference smaller than the candidates", () => {
    const ref = num(/\.refcard \.shot \{[^}]*max-height:\s*(\d+)px/);
    const cand = num(/\.pairgrid \.shot \{ max-height:\s*(\d+)px/);
    expect(Number.isFinite(ref)).toBe(true);
    expect(Number.isFinite(cand)).toBe(true);
    expect(ref).toBeGreaterThanOrEqual(cand);
  });

  it("does not re-impose a narrow width cap on the reference", () => {
    expect(css).not.toMatch(/\.refcard \.shot \{[^}]*max-width:\s*\d+px/);
  });
});
