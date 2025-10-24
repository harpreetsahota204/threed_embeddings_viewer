import { usePanelStatePartial } from "@fiftyone/spaces";
import { useViewChangeEffect } from "./useViewChangeEffect";
import { useRecoilValue } from "recoil";
import { plotDataAtom } from "./State";

export function usePlot() {
  const [loadedPlot] = usePanelStatePartial("loadedPlot", null, true);
  const [loadingPlot] = usePanelStatePartial("loadingPlot", true, true);
  const plotData = useRecoilValue(plotDataAtom);

  useViewChangeEffect();

  return {
    plotData,
    isLoading: loadingPlot,
    isLoaded: !!loadedPlot,
  };
}

