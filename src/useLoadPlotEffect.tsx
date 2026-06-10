import { useEffect } from "react";
import { useRecoilValue, useSetRecoilState } from "recoil";
import * as fos from "@fiftyone/state";
import { useOperatorExecutor } from "@fiftyone/operators";
import { useBrainResult } from "./useBrainResult";
import { useColorByField } from "./useLabelSelector";
import { plotDataAtom, plotErrorAtom } from "./State";

// Module-level so it survives panel remounts: the App reloads the page query
// on server "refresh" events, which remounts the panel subtree. A useRef here
// would reset and cause a spurious full reload on every refresh.
let requestedSource: string | null = null;

/**
 * Loads plot data whenever the dataset, brain key, or color-by field
 * changes. The data itself arrives via the set_plot_data trigger.
 *
 * Note: this intentionally does NOT reload on view/filter changes; those
 * only affect dimming, which is handled by useSelectionEffect.
 */
export function useLoadPlotEffect() {
  const datasetName = useRecoilValue(fos.datasetName);
  const [brainKey] = useBrainResult();
  const [labelField] = useColorByField();
  const setPlotData = useSetRecoilState(plotDataAtom);
  const setPlotError = useSetRecoilState(plotErrorAtom);

  const executor = useOperatorExecutor(
    "@harpreetsahota/threed-embeddings/load_visualization_results"
  );

  useEffect(() => {
    if (!brainKey || !datasetName) {
      if (requestedSource !== null) {
        requestedSource = null;
        setPlotData(null);
        setPlotError(null);
      }
      return;
    }

    const dataSource = `${datasetName}::${brainKey}`;
    const source = `${dataSource}::${labelField ?? ""}`;
    if (source === requestedSource) {
      return;
    }

    // Clear stale points when switching dataset/brain key, but keep them
    // visible while recoloring (avoids flicker on color-by changes)
    if (!requestedSource?.startsWith(`${dataSource}::`)) {
      setPlotData(null);
    }
    requestedSource = source;
    setPlotError(null);

    const params: { brain_key: string; color_by?: string } = {
      brain_key: brainKey,
    };
    if (labelField) {
      params.color_by = labelField;
    }

    executor.execute(params, {
      callback: (result: any) => {
        if (result?.error) {
          // Allow a retry after failures
          requestedSource = null;
        }
      },
    });
  }, [datasetName, brainKey, labelField]);
}
