import { usePanelStatePartial } from "@fiftyone/spaces";
import * as fos from "@fiftyone/state";
import { useRecoilValue, useSetRecoilState } from "recoil";
import { useColorByField } from "./useLabelSelector";
import { plotErrorAtom } from "./State";

// local=true: non-local panel state is serialized into the session
// workspace, and the App responds to every change with a router.replace +
// server mutation — re-executing the page query and flickering the grid
// on every brain-key/color-by change. The cost of local is only that
// saved workspaces don't persist these selections.
export const useBrainResult = () =>
  usePanelStatePartial("brainResult", null, true);

export function useBrainResultsSelector() {
  const [selected, setSelected] = useBrainResult();
  const dataset = useRecoilValue(fos.dataset);
  const [, setColorByField] = useColorByField();
  const setPlotError = useSetRecoilState(plotErrorAtom);

  const brainKeys = getBrainKeysFromDataset(dataset);

  const handlers = {
    onSelect(selected: string) {
      setSelected(selected);
      setColorByField(null); // Reset color when brain key changes
      setPlotError(null);
    },
    value: selected,
    useSearch: (search: string) => ({
      values: brainKeys.filter((item) =>
        item.toLowerCase().includes(search.toLowerCase())
      ),
    }),
  };

  return {
    handlers,
    brainKey: selected,
    canSelect: brainKeys.length > 0,
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
  // Any dimensionality >= 2 is renderable; list all visualizations
  return !!item.config?.cls?.includes("fiftyone.brain.visualization");
}
