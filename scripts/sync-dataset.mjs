// Copy the ingest output into the app's public/ so Next.js can serve it.
//
// public/pairs/ is COMMITTED, because a deploy builds from the repo and must
// not depend on the ingest having been run on the build machine. This script
// refreshes that committed copy after a re-ingest; it is a dev step, not a
// build step. If dataset/ is absent (a clean deploy checkout) it exits 0 and
// leaves the committed images alone.
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "..", "..", "dataset");
const dst = path.resolve(here, "..", "public", "pairs");

const manifestPath = path.join(src, "manifest.json");
try {
  await fs.access(manifestPath);
} catch {
  console.log(`no dataset at ${src} — keeping the committed public/pairs as is`);
  process.exit(0);
}

const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
await fs.mkdir(dst, { recursive: true });

let copied = 0;
for (const entry of await fs.readdir(path.join(src, "images"))) {
  await fs.copyFile(path.join(src, "images", entry), path.join(dst, entry));
  copied++;
}

// The serving copy carries no filesystem paths: the browser never needs them,
// and a committed artefact should not describe one machine's disk layout.
const served = {
  refs: manifest.refs.map(({ step, ...r }) => r),
  candidates: manifest.candidates.map(({ step, ...c }) => c),
  pairs: manifest.pairs,
};
await fs.writeFile(path.join(dst, "manifest.json"), JSON.stringify(served));

const scored = served.candidates.filter((c) => c.metrics && !c.metrics.error).length;
console.log(`synced ${copied} images, ${served.pairs.length} pairs, ` +
            `${scored}/${served.candidates.length} candidates scored -> ${dst}`);
if (scored < served.candidates.length) {
  console.log("  (run ingest/score_pairs.py to fill in the missing metrics)");
}
