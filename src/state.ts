/**
 * State management for 3D Embeddings Viewer
 */

import { atom, selector } from 'recoil';

export interface PlotPoint {
  x: number;
  y: number;
  z: number;
  sampleId: string;
  label: string;
  color: string | number;
}

export interface PlotData {
  x: number[];
  y: number[];
  z: number[];
  sample_ids: string[];
  labels: string[];
  colors: (string | number)[];
  color_scheme: 'categorical' | 'continuous' | 'uniform';
}

export interface PanelState {
  plotData: PlotData | null;
  selectedSampleIds: string[];
  brainKey: string | null;
  colorBy: string;
  isLoading: boolean;
  error: string | null;
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

// Current brain key atom
export const brainKeyAtom = atom<string | null>({
  key: 'threed-embeddings-brain-key',
  default: null,
});

// Color by field atom
export const colorByAtom = atom<string>({
  key: 'threed-embeddings-color-by',
  default: 'None',
});

// Loading state atom
export const isLoadingAtom = atom<boolean>({
  key: 'threed-embeddings-is-loading',
  default: false,
});

// Error state atom
export const errorAtom = atom<string | null>({
  key: 'threed-embeddings-error',
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

// Selector for number of selected points
export const numSelectedSelector = selector<number>({
  key: 'threed-embeddings-num-selected',
  get: ({ get }) => {
    const selected = get(selectedSampleIdsAtom);
    return selected.length;
  },
});

