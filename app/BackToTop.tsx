"use client";

import { useEffect, useState } from "react";

/**
 * Return to the top of a long page.
 *
 * Every page here scrolls a long way — the review page replays 187 verdicts,
 * the case table is 2500 rows, the family list is 100 entries — and getting
 * back to the filters meant a long scroll or the keyboard. Appears once the
 * page has actually scrolled, so it never sits over a short page.
 */
export default function BackToTop() {
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const onScroll = () => setShown(window.scrollY > 600);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!shown) return null;
  return (
    <button
      className="totop"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      title="Back to top"
      aria-label="Back to top"
    >
      ↑
    </button>
  );
}
