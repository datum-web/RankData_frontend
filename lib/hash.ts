/**
 * One hash, used everywhere a decision must be stable without being stored.
 *
 * Side assignment, queue order and the blind arm all need the same property:
 * the same (thing, rater) must give the same answer on every request, across
 * restarts, with nothing written down. A hash gives that; a random number or a
 * database column would not.
 *
 * It was copied into two files. That is how the two copies of image naming and
 * the two copies of stimulus labelling started, and both ended with the copies
 * out of step and hundreds of rows wrong.
 */

/**
 * FNV-1a plus an avalanche finaliser.
 *
 * Plain FNV-1a has weak avalanche on inputs sharing long prefixes, which every
 * pair id in a family does. Sorting 110 pairs by the raw value put 58-72 % of
 * neighbours in the same family against a true-random 35 %, with runs of 16-24
 * identical families — measured across five raters, so it was systematic, not
 * one unlucky seed. The finaliser mixes the bits properly.
 */
export function hash(value: string): number {
  let h = 2166136261;
  for (const ch of value) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16; h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15; h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 16;
  return h >>> 0;
}
