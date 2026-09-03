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
  /** SAM3 concept agreement. `generic` is one fixed four-word list, `hand` is
   *  cad-rl-reward's per-family lists, `vlm` reads the vocabulary off the
   *  reference render. Under evaluation, not shown to raters -- see
   *  ANALYSIS_ONLY below for why that distinction has to exist in code. */
  sam3_generic?: number | null;
  sam3_hand?: number | null;
  sam3_vlm?: number | null;
  sam3_stimulus?: string | null;
  /** Depth-slice IoU: the silhouette metric over nested slices of the depth
   *  buffer. Measured at rho 0.964 against silhouette IoU — it is the outline
   *  again, on a harsher scale. Kept for the record, not a candidate. */
  depth_iou?: number | null;
  depth_version?: string;
  /** Share of the part's pixels that look the same, on the exact composite the
   *  rater sees. The only channel that clears all five gates: it responds to a
   *  localised change instead of diluting it in an area ratio, which is what
   *  the ceiling on four families actually was. */
  pix_fg?: number | null;
  pix_stimulus?: string | null;
  pix_version?: string;
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

/**
 * Two registries, and the split is a study-integrity requirement rather than
 * tidiness.
 *
 * `METRIC_ROWS` is what a rater sees beside the two pictures. `ANALYSIS_ONLY`
 * is everything else we compute. They were one array, which meant that adding
 * a metric to the analysis pages also put it in front of the people whose
 * verdicts are used to rank metrics -- and the down-select ranks by BLIND
 * verdicts precisely because a sighted verdict measures how well a metric
 * predicts a decision made while looking at that metric. A candidate under
 * evaluation must not be able to reach the panel by being added to a list that
 * looks like it is about analysis.
 *
 * Anything still being chosen between goes in ANALYSIS_ONLY. It moves up when
 * the choice is made, not before.
 */
export type MetricRow = {
  key: keyof Metrics | "v1_iou";
  label: string;
  hint: string;
  /** Column heading for the dense analysis tables. Lives here rather than in
   *  each page: `cases` and `review` each kept their own copy of the key list
   *  and its abbreviations, so a metric added to the registry appeared on
   *  neither, and a metric renamed appeared twice under two names. */
  short?: string;
};

/** Display order and labels for the metric panel. Higher is always better. */
export const METRIC_ROWS: MetricRow[] = [
  { key: "v1_iou", label: "BenchCAD v1 IoU", hint: "overlap in the as-generated pose, no alignment", short: "v1 IoU" },
  { key: "aligned_iou", label: "Aligned IoU", hint: "overlap after ADFCA pose alignment", short: "aligned" },
  { key: "topology", label: "Topology", hint: "solid / genus / void agreement", short: "topo" },
  { key: "face", label: "Face spectrum", hint: "global face-type distribution agreement", short: "face" },
  { key: "edge", label: "Edge spectrum", hint: "global edge-type distribution agreement", short: "edge" },
  { key: "bspace_min", label: "B-Space worst cell", hint: "worst local region; localises concentrated error", short: "B-min" },
  { key: "q_l", label: "Q_L (canonical)", hint: "I · T^0.40 · F^0.30 · E^0.30 at the deepest valid level", short: "Q_L" },
  { key: "q_l_without_iou", label: "Q_L without IoU", hint: "structure only; reported when IoU is unavailable", short: "Q_L-noI" },
  // Last, because it is the control rather than part of the stack: it looks at
  // the same 2x2 composite the rater does. On the 38 verdicts whose stimulus we
  // still hold it agreed with the human 73.7 % of the time, against 74.3 % for
  // 3D aligned IoU -- level, for no dependency beyond numpy.
  { key: "sil_iou", label: "Silhouette IoU (2D)", hint: "overlap of the rendered outlines, on the very image shown", short: "sil" },
  // The 2D metric the down-select chose. Share of the part's pixels that look
  // the same, on the very composite above: the only candidate of eighteen to
  // clear all five gates at 100 % coverage, including a held-out change of
  // background. It is silhouette IoU made finer -- per-pixel appearance where
  // the outline uses per-pixel occupancy -- which is why the two sit together.
  { key: "pix_fg", label: "Pixel agreement (2D)", hint: "share of the part's pixels that look the same, on the image shown", short: "pix" },
  // Chance-corrected: (iou24 - x0) / (1 - x0), clamped at 0.
  //
  // Raw IoU is not comparable between parts. A washer is 96.8 % of its own
  // minimal enclosing cylinder, so a model that draws a plain cylinder scores
  // 0.97 and looks competent; a bolt's cylinder is 0.49 and the same work reads
  // as poor. x0 is exactly that head start and this removes it. Zero means "no
  // better than a primitive" -- a bucket, not a scale, which is why it clamps
  // instead of going negative.
  //
  // Measured over 2,484 pairs: raw 24-axis IoU has a median of 0.580, and this
  // has a median of 0.028. Half the corpus does not beat a box.
  { key: "prim_score", label: "Above-primitive score", hint: "(24-axis IoU - primitive floor) / (1 - floor), clamped at 0: how much better than the best enclosing sphere, cylinder or box", short: "vs-prim" },
];

/**
 * Computed and stored, shown on the analysis pages, deliberately absent from
 * the rater's panel while the 2D metric down-select is open.
 */
export const ANALYSIS_ONLY: MetricRow[] = [
  // Was on the rater's panel until the down-select finished. It fails gate 1
  // (0.9341 across a render change, threshold 0.95) and gate 2 (interquartile
  // spread 0.169 against a threshold of 0.25), and DINOv3 at matched size buys
  // the first without the second. Kept and still computed -- it is the learned
  // baseline every later proposal is measured against -- but it is not
  // something to put in front of someone whose verdict decides metrics.
  { key: "dino_cos", label: "DINOv2 similarity (2D)", hint: "learned image similarity; compressed near the top, IQR 0.169", short: "dino2" },
  { key: "sam3_generic", label: "SAM3 generic (2D)", hint: "concept agreement, one fixed four-word vocabulary", short: "s3-gen" },
  { key: "sam3_hand", label: "SAM3 hand (2D)", hint: "per-family vocabulary; 40 % of its scores are exactly 0", short: "s3-hand" },
  { key: "sam3_vlm", label: "SAM3 VLM vocab (2D)", hint: "vocabulary read off the reference render; declines 5 % of pairs", short: "s3-vlm" },
  { key: "depth_iou", label: "Depth-slice IoU (2D)", hint: "silhouette IoU over nested depth slices; measured as a restatement of the outline", short: "depth" },
  // Shown beside the corrected score so the correction is auditable rather
  // than a black box: these two are its inputs.
  { key: "iou24", label: "24-axis IoU", hint: "best voxel overlap over the 24 proper axis-aligned rotations; orientation searched, mirrors excluded", short: "iou24" },
  { key: "prim_x0", label: "Primitive floor (x0)", hint: "what the minimal enclosing sphere, cylinder or box already scores on this reference", short: "x0" },
];

/** Everything computed, for the analysis pages and the CSV export. */
export const ANALYSIS_METRICS: MetricRow[] = [...METRIC_ROWS, ...ANALYSIS_ONLY];
