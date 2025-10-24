import { useEffect } from "react";
import { useRecoilCallback, useRecoilValue, useSetRecoilState } from "recoil";
import * as fos from "@fiftyone/state";
import { usePanelStatePartial } from "@fiftyone/spaces";
import { atoms as selectionAtoms } from "./usePlotSelection";
import { usePointsField } from "./useBrainResult";
import { shouldResolveSelection } from "./utils";
import { useOperatorExecutor } from "@fiftyone/operators";

export default function useExtendedStageEffect() {
  const datasetName = useRecoilValue(fos.datasetName);
  const view = useRecoilValue(fos.view);
  const [loadedPlot] = usePanelStatePartial("loadedPlot", null, true);
  const setOverrideStage = useSetRecoilState(
    fos.extendedSelectionOverrideStage
  );
  const { selection, spatialSelection } = useRecoilValue(fos.extendedSelection);
  const getCurrentDataset = useRecoilCallback(({ snapshot }) => async () => {
    return snapshot.getPromise(fos.datasetName);
  });
  const slices = useRecoilValue(fos.currentSlices(false));
  const lassoPoints = useRecoilValue(selectionAtoms.lassoPoints);
  const [pointsField] = usePointsField();

  const createExtendedStageExecutor = useOperatorExecutor(
    "@harpreetsahota/threed-embeddings/create_extended_stage"
  );

  useEffect(() => {
    if (loadedPlot && Array.isArray(selection) && selection.length > 0) {
      const shouldIncludeSelection = shouldResolveSelection(
        view,
        null,
        loadedPlot.patches_field,
        pointsField
      );

      // Call operator to create stage
      createExtendedStageExecutor
        .execute({
          selection: shouldIncludeSelection ? selection : null,
          patches_field: loadedPlot.patches_field,
        })
        .then(async (res: any) => {
          const currentDataset = await getCurrentDataset();
          if (currentDataset !== datasetName) return;
          if (spatialSelection) {
            return;
          }
          
          // Set the stage if we got one back
          if (res && res.stage) {
            setOverrideStage(res.stage);
          }
        })
        .catch((err) => {
          console.error("Failed to create extended stage:", err);
        });
    } else if (selection === null || (Array.isArray(selection) && selection.length === 0)) {
      // Clear the stage when selection is cleared
      setOverrideStage(null);
    }
  }, [
    datasetName,
    loadedPlot?.patches_field,
    view,
    selection,
    pointsField,
    lassoPoints,
  ]);
}

