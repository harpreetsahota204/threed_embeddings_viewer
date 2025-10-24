import {
  atom,
  useRecoilState,
  useRecoilValue,
  useSetRecoilState,
} from "recoil";
import * as fos from "@fiftyone/state";
import { usePanelStatePartial } from "@fiftyone/spaces";
import { useBrainResultInfo } from "./useBrainResultInfo";
import { useResetExtendedSelection } from "@fiftyone/state";

const SELECTION_SCOPE = "3d-embeddings-selection";

export const atoms = {
  lassoPoints: atom({
    key: "3d-embeddings-lassoPoints",
    default: { x: [], y: [], z: [] },
  }),
};

export function usePlotSelection() {
  const brainResultInfo = useBrainResultInfo();
  const patchesField = brainResultInfo?.config?.patchesField;
  const resetExtendedSelection = useResetExtendedSelection();
  const [{ selection, scope }, setExtendedSelection] = useRecoilState(
    fos.extendedSelection
  );
  const [selectedSamples, setSelectedSamples] = useRecoilState(
    fos.selectedSamples
  );
  const [plotSelection, setPlotSelection] = usePanelStatePartial(
    "plotSelection",
    [],
    true
  );
  const [lassoPoints, setLassoPoints] = useRecoilState(atoms.lassoPoints);
  const selectedPatchIds = useRecoilValue(fos.selectedPatchIds(patchesField));
  const selectedPatchSampleIds = useRecoilValue(fos.selectedPatchSamples);

  function handleSelected(
    selectedResults,
    lassoPoints: { x: number[]; y: number[]; z: number[] }
  ) {
    setSelectedSamples(new Set());
    setExtendedSelection({
      selection: selectedResults,
      scope: SELECTION_SCOPE,
    });
    if (lassoPoints) {
      setLassoPoints(lassoPoints);
    }
    if (selectedResults === null) {
      clearSelection();
    }
  }

  function clearSelection() {
    resetExtendedSelection();
    setPlotSelection(null);
    setSelectedSamples(new Set());
  }

  let selectionStyle = null;
  const selected = Array.from(selectedSamples);
  const selectedPatchIdsArr = Array.from(selectedPatchIds);
  const selectedPatchSampleIdsArr = Array.from(selectedPatchSampleIds);
  let resolvedSelection = null;

  // Selection priority: patches > patch samples > samples > plot > extended
  if (
    !patchesField &&
    selectedPatchSampleIdsArr &&
    selectedPatchSampleIdsArr.length
  ) {
    resolvedSelection = selectedPatchSampleIdsArr;
    selectionStyle = "selected";
  } else if (selectedPatchIdsArr && selectedPatchIdsArr.length) {
    resolvedSelection = selectedPatchIdsArr;
    selectionStyle = "selected";
  } else if (selected && selected.length) {
    resolvedSelection = selected;
    selectionStyle = "selected";
  } else if (plotSelection && plotSelection.length) {
    resolvedSelection = plotSelection;
    selectionStyle = "plot";
  } else if (selection && selection.length) {
    resolvedSelection = selection;
    selectionStyle = "extended";
  }

  const hasSelection = resolvedSelection !== null;
  return {
    setPlotSelection,
    handleSelected,
    clearSelection,
    resolvedSelection,
    hasSelection,
    selectionStyle,
    selectionIsExternal: scope !== SELECTION_SCOPE,
  };
}

