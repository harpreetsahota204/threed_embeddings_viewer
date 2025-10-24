/**
 * State management for 3D Embeddings Viewer
 */

import { atom, selector } from 'recoil';

export interface PlotData {
  x: number[];
  y: number[];
  z: number[];
  sample_ids: string[];
  labels: string[];
  colors: (string | number)[];
  color_scheme: 'categorical' | 'continuous' | 'uniform';
}

// Main plot data atom
export const plotDataAtom = atom<PlotData | null>({
  key: 'threed-embeddings-plot-data',
  default: null,
});

// Selected sample IDs atom
export const selectedSampleIdsAtom = atom<string[]>({
  key: 'threed-embeddings-selected-samples',
  default: [],
});

// Selector for number of points
export const numPointsSelector = selector<number>({
  key: 'threed-embeddings-num-points',
  get: ({ get }) => {
    const plotData = get(plotDataAtom);
    return plotData ? plotData.x.length : 0;
  },
});

// Selector for number of selected points
export const numSelectedSelector = selector<number>({
  key: 'threed-embeddings-num-selected',
  get: ({ get }) => {
    const selected = get(selectedSampleIdsAtom);
    return selected.length;
  },
});

