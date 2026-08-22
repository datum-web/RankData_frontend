export type Metrics = {
  aligned_iou: number | null;
  topology: number | null;
  face: number | null;
  edge: number | null;
  bspace_min: number | null;
  bspace_mean: number | null;
  q_l: number | null;
  q_l_without_iou: number | null;
  /** Overlap of the rendered silhouettes -- the only channel computed from the
   *  picture on screen rather than from the solids. */
  sil_iou?: number | null;
  sil_iou_aligned?: number | null;
  /** Which stimulus the silhouettes came from. A render change invalidates this
   *  channel the way it invalidates a verdict, and nothing else in `metrics`. */
  sil_stimulus?: string | null;
  sil_version?: string;
  /** Cosine similarity of DINOv2 embeddings of the two renders. Learned
   *  features rather than raw overlap, so it is a second opinion on the same
   *  pictures -- rho +0.72 against silhouette IoU, not a restatement of it. */
  dino_cos?: number | null;
  dino_stimulus?: string | null;
  dino_version?: string;
  warnings?: string[];
  errors?: unknown[];
  error?: string;
};

export type Candidate = {
  id: string;
  ref_id: string;
  origin: string;
  image: string | null;
  /** The earlier per-shape-normalised render, kept so a past verdict can be
   *  replayed against the picture that rater actually saw. */
  image_v0?: string;
  /** Which stimulus set `image` belongs to. */
  stimulus?: string | null;
  /** Turnable geometry for the in-page viewer; null for anchors. */
  mesh?: string | null;
  provenance: {
    model?: string; run?: string; latency_s?: number; total_tokens?: number;
    /** Set on `origin: "anchor"` rows, whose "image" is a target score. */
    anchor_metric?: string; anchor_label?: string; anchor_value?: number;
  };
  v1_iou: number | null;
  metrics: Metrics;
};

export type Ref = {
  id: string;
  family: string;
  image: string;
  mesh?: string | null;
  /** Centre and longest axis of this reference, in its own units. Every solid
   *  shown against it is placed by these, so sizes on screen are comparable. */
  frame?: { centre: [number, number, number]; longest: number } | null;
  image_v0?: string;
  stimulus?: string | null;
  source?: string;
};

/**
 * One candidate measured and rendered against one specific reference.
 *
 * The reference is part of the key because it is part of the measurement: the
 * same solid scored against two different references is two different numbers,
 * and a pair decides which reference is on screen. Storing the score on the
 * candidate meant a cross-reference pair quoted a number computed against a
 * reference the rater never saw.
 */
export type Evaluation = {
  candidate_id: string;
  ref_id: string;
  metrics: Metrics;
  v1_iou: number | null;
  image: string | null;
  image_v0: string | null;
  stimulus: string | null;
};

export type Pair = {
  id: string;
  ref_id: string;
  a: string;
  b: string;
  cohort?: string;
  /** stable corpus-wide case number; not the queue position, which varies per rater */
  case_no?: number;
};

/**
 * Where a metric's values sit across the whole corpus.
 *
 * A raw 0.6390 says nothing on its own — the rater cannot tell whether that is
 * a good aligned IoU or a poor one. These are computed over every scored
 * candidate so the UI can place each value in its own distribution.
 * `constant` marks a metric that does not vary at all on this corpus, which is
 * itself worth showing rather than drawing a meaningless bar.
 */
export type MetricStats = {
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
  n: number;
  constant: boolean;
  /** ascending, for rank-based placement */
  values: number[];
};

/** One pair, resolved and already shuffled for presentation. */
export type PairView = {
  /** which cohort the queue was filtered to, null when unfiltered */
  cohort?: string | null;
  pair: Pair;
  reference: Ref;
  left: Candidate;
  right: Candidate;
  /** true when `left` is the pair's A side — recorded so side bias stays measurable. */
  aShownLeft: boolean;
  index: number;
  total: number;
  remaining: number;
  /** True when this pair is served without the metric panel. Decided
   *  server-side per (rater, pair); see `lib/blind.ts`. */
  blind: boolean;
  /** How much the metric channels disagree about this pair, 0-1. The queue is
   *  ordered by it, so the pairs that separate the metrics come first. */
  info?: number;
  /** keyed by the same keys as METRIC_ROWS */
  stats: Record<string, MetricStats>;
};

export type Judgment = {
  pair_id: string;
  rater: string;
  chosen_id: string | null;
  is_tie: boolean;
  confidence: 1 | 2 | 3 | 4;
  left_id: string;
  right_id: string;
  metrics_shown: boolean;
  decision_ms: number;
  time_to_first_input_ms: number | null;
  metric_dwell_ms: number;
  hidden_ms: number;
  metric_interactions: unknown[];
  notes?: string | null;
  /** The stimulus set the rater was looking at. Stamped server-side; a verdict
   *  is only interpretable against the images that produced it. */
  stimulus?: string;
  client?: Record<string, unknown>;
};

/** Display order and labels for the metric panel. Higher is always better. */
export const METRIC_ROWS: {
  key: keyof Metrics | "v1_iou";
  label: string;
  hint: string;
}[] = [
  { key: "v1_iou", label: "BenchCAD v1 IoU", hint: "overlap in the as-generated pose, no alignment" },
  { key: "aligned_iou", label: "Aligned IoU", hint: "overlap after ADFCA pose alignment" },
  { key: "topology", label: "Topology", hint: "solid / genus / void agreement" },
  { key: "face", label: "Face spectrum", hint: "global face-type distribution agreement" },
  { key: "edge", label: "Edge spectrum", hint: "global edge-type distribution agreement" },
  { key: "bspace_min", label: "B-Space worst cell", hint: "worst local region; localises concentrated error" },
  { key: "q_l", label: "Q_L (canonical)", hint: "I · T^0.40 · F^0.30 · E^0.30 at the deepest valid level" },
  { key: "q_l_without_iou", label: "Q_L without IoU", hint: "structure only; reported when IoU is unavailable" },
  // Last, because it is the control rather than part of the stack: it looks at
  // the same 2x2 composite the rater does. On the 38 verdicts whose stimulus we
  // still hold it agreed with the human 73.7 % of the time, against 74.3 % for
  // 3D aligned IoU -- level, for no dependency beyond numpy.
  { key: "sil_iou", label: "Silhouette IoU (2D)", hint: "overlap of the rendered outlines, on the very image shown" },
  // Compressed near the top by construction -- interquartile spread 0.168
  // against silhouette IoU's 0.381 -- so it separates candidates far less than
  // its agreement rate suggests. Said in the hint rather than left to be
  // rediscovered from the numbers.
  { key: "dino_cos", label: "DINOv2 similarity (2D)", hint: "learned image similarity; agrees often but scores cluster high" },
];
