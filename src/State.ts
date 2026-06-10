/**
 * State management for 3D Embeddings Viewer
 */

import { atom } from 'recoil';

// Geometry and colors are split so that recoloring (changing "Color by")
// does not re-transfer x/y/z/ids, which dominate the payload on large
// datasets
export interface PlotData {
  x: number[];
  y: number[];
  // All zeros for 2D embeddings (rendered as a flat plane)
  z: number[];
  sample_ids: string[];
  // Original embedding dimensionality (>= 4 still plots the first 3 dims,
  // matching the builtin 2D panel's first-2 behavior)
  num_dims: number;
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
  // Per-sample hover display lines; for aggregated list fields these
  // carry the distribution (eg ["cat: 3", "dog: 2", "5 other objects"])
  labels: string[][];
  color_scheme: 'categorical' | 'continuous';
  // Continuous only: per-sample numeric values
  colors?: number[];
  // Categorical only: classes sorted by count desc; class_indices is each
  // sample's dominant class (drives point color), class_members is each
  // sample's full set of present classes (drives legend counts,
  // highlighting, and class filtering)
  categories?: PlotCategory[];
  class_indices?: number[];
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

export const plotErrorAtom = atom<string | null>({
  key: 'threed-embeddings-plot-error',
  default: null,
});

export interface LassoSelection {
  count: number;
  // Present only for small selections (applied as a Select stage); null
  // for large selections, which are server-side (tag + MatchTags stage)
  // so that huge id lists never live in client state or view stages
  ids: string[] | null;
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
