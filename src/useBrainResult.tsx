import { usePanelStatePartial } from "@fiftyone/spaces";
import * as fos from "@fiftyone/state";
import { useRecoilValue, useSetRecoilState } from "recoil";
import { useColorByField } from "./useLabelSelector";
import { plotErrorAtom } from "./State";

export const useBrainResult = () => usePanelStatePartial("brainResult", null);

export function useBrainResultsSelector() {
  const [selected, setSelected] = useBrainResult();
  const dataset = useRecoilValue(fos.dataset);
  const [, setColorByField] = useColorByField();
  const setPlotError = useSetRecoilState(plotErrorAtom);

  const handlers = {
    onSelect(selected: string) {
      setSelected(selected);
      setColorByField(null); // Reset color when brain key changes
      setPlotError(null);
    },
    value: selected,
    useSearch: (search: string) => ({
      values: getBrainKeysFromDataset(dataset).filter((item) =>
        item.toLowerCase().includes(search.toLowerCase())
      ),
    }),
  };

  return {
    handlers,
    brainKey: selected,
    canSelect: getBrainKeysFromDataset(dataset).length > 0,
    hasSelection: selected !== null,
  };
}

function getBrainKeysFromDataset(dataset: any): string[] {
  if (!dataset?.brainMethods) return [];

  return dataset.brainMethods
    .filter(isVisualizationConfig)
    .map((item: any) => item.key);
}

function isVisualizationConfig(item: any) {
  // 2D vs 3D is validated when loading; list all visualizations here
  return !!item.config?.cls?.includes("fiftyone.brain.visualization");
}
