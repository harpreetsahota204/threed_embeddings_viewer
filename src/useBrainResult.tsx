import { usePanelStatePartial } from "@fiftyone/spaces";
import * as fos from "@fiftyone/state";
import { useRecoilValue } from "recoil";
import { useColorByField } from "./useLabelSelector";

// React hooks for brain result selection
export const useBrainResult = () => usePanelStatePartial("brainResult", null);
export const usePointsField = () => usePanelStatePartial("pointsField", null);

export function useBrainResultsSelector() {
  const [selected, setSelected] = useBrainResult();
  const dataset = useRecoilValue(fos.dataset);
  const [colorByField, setColorByField] = useColorByField();
  const [loadingPlotError, setLoadingPlotError] = usePanelStatePartial(
    "loadingPlotError",
    null,
    true
  );

  const handlers = {
    onSelect(selected) {
      setSelected(selected);
      setColorByField(null); // Reset color when brain key changes
      setLoadingPlotError(null);
    },
    value: selected,
    useSearch: (search) => ({
      values: getBrainKeysFromDataset(dataset).filter((item) =>
        item.toLowerCase().includes(search.toLowerCase())
      ),
    }),
  };

  const hasSelection = selected !== null;

  return {
    handlers,
    brainKey: selected,
    canSelect: countValid3DBrainMethods(dataset) > 0,
    hasSelection: hasSelection,
    hasLoadingError: loadingPlotError !== null,
    showPlot: !loadingPlotError && hasSelection,
  };
}

export function getBrainKeysFromDataset(dataset) {
  if (!dataset || !dataset.brainMethods) return [];
  
  return dataset.brainMethods
    .filter(is3DVisualizationConfig)
    .map((item) => item.key);
}

function countValid3DBrainMethods(dataset) {
  const methods = dataset?.brainMethods || [];
  return methods.filter(is3DVisualizationConfig).length;
}

function is3DVisualizationConfig(item) {
  // Check if it's a visualization config with 3 dimensions
  if (!item.config) return false;
  const isVisualization = item.config.cls && item.config.cls.includes("fiftyone.brain.visualization");
  // For 3D, we need num_dims to be 3 or points to be 3D
  const is3D = item.config.num_dims === 3;
  return isVisualization && is3D;
}

