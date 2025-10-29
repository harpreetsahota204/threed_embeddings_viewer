/**
 * Hook to track which samples are in the current filtered view
 * This enables dimming points that are filtered out
 */

import { useEffect, useState } from "react";
import { useRecoilValue } from "recoil";
import * as fos from "@fiftyone/state";
import { usePanelStatePartial } from "@fiftyone/spaces";
import { useBrainResult } from "./useBrainResult";
import { useOperatorExecutor } from "@fiftyone/operators";

export function useViewSamplesEffect() {
  const [viewSampleIds, setViewSampleIds] = useState<Set<string> | null>(null);
  const datasetName = useRecoilValue(fos.datasetName);
  const [brainKey] = useBrainResult();
  const view = useRecoilValue(fos.view);
  const slices = useRecoilValue(fos.currentSlices(false));
  const filters = useRecoilValue(fos.filters);
  const [loadedPlot] = usePanelStatePartial("loadedPlot", null, true);

  // Operator to get samples in current view
  const getViewSamplesExecutor = useOperatorExecutor(
    "@harpreetsahota/threed-embeddings/get_view_samples"
  );

  useEffect(() => {
    if (!brainKey || !datasetName || !loadedPlot) {
      // No filtering - all samples visible
      setViewSampleIds(null);
      return;
    }

    // Check if there are any filters or view stages applied
    const hasFilters = filters && Object.keys(filters).length > 0;
    const hasViewStages = view && view.length > 0;
    
    if (!hasFilters && !hasViewStages) {
      // No filtering - all samples visible
      setViewSampleIds(null);
      return;
    }

    // Get samples in current view from backend
    getViewSamplesExecutor
      .execute({ brain_key: brainKey })
      .then((result: any) => {
        if (result && result.sample_ids) {
          setViewSampleIds(new Set(result.sample_ids));
        } else {
          // If we can't get view samples, show all
          setViewSampleIds(null);
        }
      })
      .catch((err) => {
        console.warn("Could not fetch view samples:", err);
        // On error, show all samples (don't dim anything)
        setViewSampleIds(null);
      });
  }, [datasetName, brainKey, view, filters, slices, loadedPlot]);

  return viewSampleIds;
}

