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
  z: number[];
  sample_ids: string[];
}

export interface PlotColors {
  labels: string[];
  colors: (string | number)[];
  color_scheme: 'categorical' | 'continuous';
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

// Lasso selection state lives in plain atoms (not panel state) because the
// panel tab indicator renders outside of the panel context
export const lassoSelectionAtom = atom<string[] | null>({
  key: 'threed-embeddings-lasso-selection',
  default: null,
});

// The _uuid of the Select stage this plugin added to the view
export const lassoStageIdAtom = atom<string | null>({
  key: 'threed-embeddings-lasso-stage-id',
  default: null,
});
