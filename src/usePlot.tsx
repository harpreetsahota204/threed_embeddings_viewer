import { usePanelStatePartial } from "@fiftyone/spaces";
import { useViewChangeEffect } from "./useViewChangeEffect";
import useExtendedStageEffect from "./useExtendedStageEffect";
import { useRecoilValue } from "recoil";
import { plotDataAtom } from "./State";

export function usePlot() {
  const [loadedPlot] = usePanelStatePartial("loadedPlot", null, true);
  const [loadingPlot] = usePanelStatePartial("loadingPlot", true, true);
  const plotData = useRecoilValue(plotDataAtom);

  // Auto-refetch when view changes
  useViewChangeEffect();
  
  // Create view stages from selection
  useExtendedStageEffect();

  return {
    plotData,
    isLoading: loadingPlot,
    isLoaded: !!loadedPlot,
  };
}

