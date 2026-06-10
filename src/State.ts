/**
 * State management for 3D Embeddings Viewer
 */

import { atom } from 'recoil';

export interface PlotData {
  x: number[];
  y: number[];
  z: number[];
  sample_ids: string[];
  labels: string[];
  colors: (string | number)[];
  color_scheme: 'categorical' | 'continuous' | 'uniform';
}

// Plot data is delivered by the Python operator via ctx.trigger().
// These are plain recoil atoms (not panel state) because triggered JS
// operators execute outside of the panel context.
export const plotDataAtom = atom<PlotData | null>({
  key: 'threed-embeddings-plot-data',
  default: null,
});

export const plotErrorAtom = atom<string | null>({
  key: 'threed-embeddings-plot-error',
  default: null,
});
