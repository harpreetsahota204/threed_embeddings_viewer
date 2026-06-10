import { useEffect } from "react";
import { useRecoilValue, useSetRecoilState } from "recoil";
import * as fos from "@fiftyone/state";
import { useOperatorExecutor } from "@fiftyone/operators";
import { useBrainResult } from "./useBrainResult";
import { useColorByField } from "./useLabelSelector";
import { plotColorsAtom, plotDataAtom, plotErrorAtom } from "./State";

// Module-level so they survive panel remounts: the App reloads the page
// query on server "refresh" events and view changes, which remounts the
// panel subtree. useRefs here would reset and cause spurious full reloads.
let requestedGeometry: string | null = null;
let requestedColors: string | null = null;

/**
 * Loads plot geometry when the dataset/brain key changes, and colors when
 * the color-by field changes. The two are fetched separately so that
 * recoloring does not re-transfer geometry (the dominant payload on large
 * datasets). Results arrive via the set_plot_data/set_plot_colors
 * triggers.
 *
 * Note: this intentionally does NOT reload on view/filter changes; those
 * only affect dimming, which is handled by useSelectionEffect.
 */
export function useLoadPlotEffect() {
  const datasetName = useRecoilValue(fos.datasetName);
  const [brainKey] = useBrainResult();
  const [labelField] = useColorByField();
  const setPlotData = useSetRecoilState(plotDataAtom);
  const setPlotColors = useSetRecoilState(plotColorsAtom);
  const setPlotError = useSetRecoilState(plotErrorAtom);

  const geometryExecutor = useOperatorExecutor(
    "@harpreetsahota/threed-embeddings/load_visualization_results"
  );
  const colorsExecutor = useOperatorExecutor(
    "@harpreetsahota/threed-embeddings/get_plot_colors"
  );

  // Geometry: x/y/z/sample_ids, depends only on the brain key
  useEffect(() => {
    if (!brainKey || !datasetName) {
      if (requestedGeometry !== null) {
        requestedGeometry = null;
        requestedColors = null;
        setPlotData(null);
        setPlotColors(null);
        setPlotError(null);
      }
      return;
    }

    const source = `${datasetName}::${brainKey}`;
    if (source === requestedGeometry) {
      return;
    }

    requestedGeometry = source;
    requestedColors = null;
    setPlotData(null);
    setPlotColors(null);
    setPlotError(null);

    geometryExecutor.execute(
      { brain_key: brainKey },
      {
        callback: (result: any) => {
          if (result?.error) {
            // Allow a retry after failures
            requestedGeometry = null;
          }
        },
      }
    );
  }, [datasetName, brainKey]);

  // Colors: depends on the color-by field too. Existing points stay
  // visible while recoloring (avoids flicker on color-by changes)
  useEffect(() => {
    if (!brainKey || !datasetName) {
      return;
    }

    const source = `${datasetName}::${brainKey}::${labelField ?? ""}`;
    if (source === requestedColors) {
      return;
    }
    requestedColors = source;

    if (!labelField) {
      // Uncolored: uniform point color, computed client-side
      setPlotColors(null);
      return;
    }

    colorsExecutor.execute(
      { brain_key: brainKey, color_by: labelField },
      {
        callback: (result: any) => {
          if (result?.error) {
            requestedColors = null;
          }
        },
      }
    );
  }, [datasetName, brainKey, labelField]);
}
