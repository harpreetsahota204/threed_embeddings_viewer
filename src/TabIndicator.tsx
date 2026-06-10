/**
 * Selection count shown in the panel tab (visible even when the panel is
 * hidden); clicking it clears the lasso selection. Mirrors the built-in
 * 2D Embeddings panel behavior.
 */

import { useCallback, useEffect } from 'react';
import { FilterAndSelectionIndicator } from '@fiftyone/components';
import { useRecoilValue } from 'recoil';
import { lassoSelectionAtom } from './State';
import {
  useClearLassoSelection,
  useLassoStageWatchdog,
} from './usePlotSelection';
import { log } from './logger';

export default function ThreeDEmbeddingsTabIndicator() {
  const selection = useRecoilValue(lassoSelectionAtom);
  const clearSelection = useClearLassoSelection();

  // Runs here rather than in the panel so external stage removal is
  // detected even while the panel is hidden (the tab stays mounted)
  useLassoStageWatchdog();

  useEffect(() => {
    log(
      `tab indicator: count=${selection?.length ?? 0}`,
      selection?.length ? '(visible)' : '(hidden)'
    );
  }, [selection]);

  const handleClear = useCallback(() => {
    log('tab indicator: clear clicked');
    clearSelection();
  }, [clearSelection]);

  if (!selection?.length) return null;

  return (
    <FilterAndSelectionIndicator
      selectionCount={selection.length.toString()}
      onClickSelection={handleClear}
    />
  );
}
