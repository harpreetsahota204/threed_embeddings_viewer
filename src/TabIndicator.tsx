/**
 * Selection count shown in the panel tab (visible even when the panel is
 * hidden); clicking it clears the lasso selection. Mirrors the built-in
 * 2D Embeddings panel behavior.
 */

import { FilterAndSelectionIndicator } from '@fiftyone/components';
import { useRecoilValue } from 'recoil';
import { lassoSelectionAtom } from './State';
import {
  useClearLassoSelection,
  useLassoStageWatchdog,
} from './usePlotSelection';

export default function ThreeDEmbeddingsTabIndicator() {
  const selection = useRecoilValue(lassoSelectionAtom);
  const clearSelection = useClearLassoSelection();

  // Runs here rather than in the panel so external stage removal is
  // detected even while the panel is hidden (the tab stays mounted)
  useLassoStageWatchdog();

  if (!selection?.count) return null;

  return (
    <FilterAndSelectionIndicator
      selectionCount={selection.count.toLocaleString()}
      onClickSelection={clearSelection}
    />
  );
}
