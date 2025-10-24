import { usePanelStatePartial } from "@fiftyone/spaces";
import * as fos from "@fiftyone/state";
import { useEffect } from "react";
import { useRecoilValue } from "recoil";
import { useBrainResult } from "./useBrainResult";
import { useColorByField } from "./useLabelSelector";
import { useOperatorExecutor } from "@fiftyone/operators";

export function useViewChangeEffect() {
  const colorSeed = useRecoilValue(fos.colorSeed);
  const datasetName = useRecoilValue(fos.datasetName);
  const [brainKey] = useBrainResult();
  const [labelField] = useColorByField();
  const view = useRecoilValue(fos.view);
  const slices = useRecoilValue(fos.currentSlices(false));
  const filters = useRecoilValue(fos.filters);
  const [, setLoadedPlot] = usePanelStatePartial("loadedPlot", null, true);
  const [, setLoadingPlot] = usePanelStatePartial("loadingPlot", true, true);
  const [, setLoadingPlotError] = usePanelStatePartial(
    "loadingPlotError",
    null,
    true
  );

  const loadVisualizationExecutor = useOperatorExecutor(
    "@harpreetsahota/threed-embeddings/load_visualization_results"
  );

  useEffect(() => {
    if (!brainKey || !datasetName) {
      return;
    }

    setLoadingPlot(true);
    setLoadingPlotError(null);

    // Execute operator to load visualization
    const params: any = { brain_key: brainKey };
    if (labelField && labelField !== "uncolored") {
      params.color_by = labelField;
    }

    loadVisualizationExecutor
      .execute(params)
      .then(() => {
        // Data will be set via ctx.trigger() -> SetPlotData
        // Mark as loaded after a brief delay to ensure data is set
        setTimeout(() => {
          setLoadedPlot({ loaded: true });
          setLoadingPlot(false);
        }, 100);
      })
      .catch((err: Error) => {
        console.error("Error loading 3D visualization:", err);
        setLoadingPlotError({
          message: err.message || "Failed to load visualization",
          stack: err.stack,
        });
        setLoadingPlot(false);
      });
  }, [datasetName, brainKey, labelField, view, colorSeed, slices, filters]);
}

