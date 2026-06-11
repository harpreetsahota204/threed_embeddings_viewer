/**
 * State management for 3D Embeddings Viewer
 */

import { atom } from 'recoil';

// Geometry arrives as base64 float32 chunks and is held as typed arrays:
// ~5x smaller on the wire than JSON numbers and no per-point boxing in
// memory. Sample ids are never transferred — the frontend works in point
// indices and resolves ids server-side on demand (hover, selection).
// Geometry and colors are split so that recoloring (changing "Color by")
// does not re-transfer geometry, which dominates the payload.
export interface PlotData {
  x: Float32Array;
  y: Float32Array;
  // All zeros for 2D embeddings (rendered as a flat plane)
  z: Float32Array;
  // Number of valid points (may be less than the array capacity while
  // chunks are still streaming in)
  count: number;
  // Original embedding dimensionality (>= 4 still plots the first 3 dims,
  // matching the builtin 2D panel's first-2 behavior)
  num_dims: number;
}

// Geometry streaming progress; null when no load is in flight
export interface PlotProgress {
  received: number;
  total: number;
}

export interface PlotCategory {
  label: string;
  color: string;
  // Number of samples CONTAINING the class (presence semantics, like the
  // App sidebar) — rows can overlap, so counts may sum to more than the
  // number of points
  count: number;
}

export interface PlotColors {
  count: number;
  color_scheme: 'categorical' | 'continuous';
  // Continuous only: per-sample numeric values (base64 float32 on the wire)
  colors?: Float32Array;
  // Categorical only: classes sorted by count desc; class_indices is each
  // sample's dominant class (drives point color), class_members is each
  // sample's full set of present classes (drives legend counts,
  // highlighting, and class filtering). Hover lines are resolved lazily
  // via get_sample_info, not shipped here.
  categories?: PlotCategory[];
  class_indices?: Int32Array;
  class_members?: number[][];
}

// Plot data is delivered by the Python operators via ctx.trigger().
// These are plain recoil atoms (not panel state) because triggered JS
// operators execute outside of the panel context.
export const plotDataAtom = atom<PlotData | null>({
  key: 'threed-embeddings-plot-data',
  default: null,
});

// null means uncolored (uniform point color)
export const plotColorsAtom = atom<PlotColors | null>({
  key: 'threed-embeddings-plot-colors',
  default: null,
});

export const plotProgressAtom = atom<PlotProgress | null>({
  key: 'threed-embeddings-plot-progress',
  default: null,
});

export const plotErrorAtom = atom<string | null>({
  key: 'threed-embeddings-plot-error',
  default: null,
});

export interface LassoSelection {
  count: number;
  // Present only for small selections (applied as a Select stage); null
  // for large selections, which are server-side (tag + MatchTags stage)
  // so that huge id lists never live in client state or view stages.
  // ids feed the Select stage; indices drive point styling.
  ids: string[] | null;
  indices: number[] | null;
}

// Lasso selection state lives in plain atoms (not panel state) because the
// panel tab indicator renders outside of the panel context
export const lassoSelectionAtom = atom<LassoSelection | null>({
  key: 'threed-embeddings-lasso-selection',
  default: null,
});

// The _uuid of the Select stage this plugin added to the view
export const lassoStageIdAtom = atom<string | null>({
  key: 'threed-embeddings-lasso-stage-id',
  default: null,
});

// A similarity neighbor highlight (source point + its k nearest neighbors).
// Drives the orange/amber point coloring and the connecting arcs. Held in
// an atom (not panel/local state) because applying its Select view stage
// reloads the page query and remounts the panel, which would otherwise drop
// local state; the atom lets the highlight survive into explore mode so the
// user can orbit with the constellation still lit.
export interface SimilarityFocus {
  sourceIndex: number;
  neighbors: { index: number; rank: number }[];
}

export const similarityFocusAtom = atom<SimilarityFocus | null>({
  key: 'threed-embeddings-similarity-focus',
  default: null,
});
