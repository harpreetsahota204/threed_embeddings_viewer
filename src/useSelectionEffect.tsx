/**
 * Selection effect hook for 3D embeddings
 * Updates plotSelection when view/filters change to enable dimming of out-of-view points
 */

import { useEffect } from "react";
import { useRecoilValue } from "recoil";
import * as fos from "@fiftyone/state";
import { usePanelStatePartial } from "@fiftyone/spaces";
import { useBrainResult } from "./useBrainResult";
import { usePlotSelection } from "./usePlotSelection";
import { useOperatorExecutor } from "@fiftyone/operators";

export function useSelectionEffect() {
  const { setPlotSelection, resolvedSelection } = usePlotSelection();
  const datasetName = useRecoilValue(fos.datasetName);
  const selectedSamples = useRecoilValue(fos.selectedSamples);
  const [brainKey] = useBrainResult();
  const view = useRecoilValue(fos.view);
  const [loadedPlot] = usePanelStatePartial("loadedPlot", null, true);
  const filters = useRecoilValue(fos.filters);
  const { selection } = useRecoilValue(fos.extendedSelection);
  const slices = useRecoilValue(fos.currentSlices(false));

  // Operator to get samples in current view
  const getViewSamplesExecutor = useOperatorExecutor(
    "@harpreetsahota/threed-embeddings/get_view_samples"
  );

  // Update plotSelection when view changes
  useEffect(() => {
    if (!loadedPlot || !brainKey || !datasetName) {
      return;
    }

    // Check if there are any filters or view stages applied
    const hasFilters = filters && Object.keys(filters).length > 0;
    const hasViewStages = view && view.length > 0;
    const hasExtendedSelection = selection && selection.length > 0;

    // If there are filters/stages, get which samples are in view
    if (hasFilters || hasViewStages) {
      getViewSamplesExecutor
        .execute({ brain_key: brainKey })
        .then((result: any) => {
          if (result && result.sample_ids) {
            // Set plotSelection to samples in view
            // This will make these samples "bright" and others "dim"
            setPlotSelection(result.sample_ids);
          } else {
            // No result, clear plot selection (show all)
            setPlotSelection(null);
          }
        })
        .catch((err) => {
          console.warn("Could not fetch view samples:", err);
          // On error, clear plot selection (show all)
          setPlotSelection(null);
        });
    } else if (hasExtendedSelection) {
      // Use extended selection if no filters but there is an extended selection
      setPlotSelection(selection);
    } else if (selectedSamples && selectedSamples.size > 0) {
      // Use selected samples if no filters/extended selection
      setPlotSelection(Array.from(selectedSamples));
    } else {
      // No filters, no selection - show all points normally
      setPlotSelection(null);
    }
  }, [
    datasetName,
    brainKey,
    view,
    filters,
    selection,
    selectedSamples,
    loadedPlot,
  ]);
}

