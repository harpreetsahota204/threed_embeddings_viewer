/**
 * Keeps the viewSelection panel state in sync with the current
 * view/filters so that out-of-view points are dimmed in the 3D plot.
 */

import { useEffect } from "react";
import { useRecoilValue } from "recoil";
import * as fos from "@fiftyone/state";
import { usePanelStatePartial } from "@fiftyone/spaces";
import { useOperatorExecutor } from "@fiftyone/operators";
import { useBrainResult } from "./useBrainResult";
import { plotDataAtom } from "./State";

export function useSelectionEffect() {
  const datasetName = useRecoilValue(fos.datasetName);
  const [brainKey] = useBrainResult();
  const view = useRecoilValue(fos.view) as unknown[];
  const filters = useRecoilValue(fos.filters) as Record<string, unknown>;
  const plotData = useRecoilValue(plotDataAtom);
  const [, setViewSelection] = usePanelStatePartial("viewSelection", null, true);

  const getViewSamplesExecutor = useOperatorExecutor(
    "@harpreetsahota/threed-embeddings/get_view_samples"
  );

  useEffect(() => {
    if (!plotData || !brainKey || !datasetName) {
      return;
    }

    const hasFilters = filters && Object.keys(filters).length > 0;
    const hasViewStages = view && view.length > 0;

    if (!hasFilters && !hasViewStages) {
      setViewSelection(null);
      return;
    }

    // The execute() promise does not resolve with the result; results
    // must be read via the callback option
    getViewSamplesExecutor.execute(
      { brain_key: brainKey },
      {
        callback: (result: any) => {
          const ids = result?.result?.sample_ids;
          setViewSelection(ids?.length ? ids : null);
        },
      }
    );
  }, [datasetName, brainKey, view, filters, plotData]);
}
