import { usePanelStatePartial } from "@fiftyone/spaces";
import { useViewChangeEffect } from "./useViewChangeEffect";
import { useSelectionEffect } from "./useSelectionEffect";
import { useRecoilValue } from "recoil";
import { plotDataAtom } from "./State";

export function usePlot() {
  const [loadedPlot] = usePanelStatePartial("loadedPlot", null, true);
  const [loadingPlot] = usePanelStatePartial("loadingPlot", true, true);
  const plotData = useRecoilValue(plotDataAtom);

  // Auto-refetch when view changes
  useViewChangeEffect();
  
  // Update plotSelection based on view/filters for dimming effect
  useSelectionEffect();

  return {
    plotData,
    isLoading: loadingPlot,
    isLoaded: !!loadedPlot,
  };
}

