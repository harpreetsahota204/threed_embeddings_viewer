import { useRecoilValue } from "recoil";
import { plotColorsAtom, plotDataAtom, plotErrorAtom } from "./State";
import { useLoadPlotEffect } from "./useLoadPlotEffect";
import { useSelectionEffect } from "./useSelectionEffect";

export function usePlot() {
  useLoadPlotEffect();
  useSelectionEffect();

  return {
    plotData: useRecoilValue(plotDataAtom),
    plotColors: useRecoilValue(plotColorsAtom),
    plotError: useRecoilValue(plotErrorAtom),
  };
}
