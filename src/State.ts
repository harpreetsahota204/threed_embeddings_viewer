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

// Main plot data atom (managed by operators via ctx.trigger())
export const plotDataAtom = atom<PlotData | null>({
  key: 'threed-embeddings-plot-data',
  default: null,
});

// Selector for number of points
export const numPointsSelector = selector<number>({
  key: 'threed-embeddings-num-points',
  get: ({ get }) => {
    const plotData = get(plotDataAtom);
    return plotData ? plotData.x.length : 0;
  },
});

