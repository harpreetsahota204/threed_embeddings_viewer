import { useRecoilValue } from "recoil";
import { plotDataAtom, plotErrorAtom } from "./State";
import { useLoadPlotEffect } from "./useLoadPlotEffect";
import { useSelectionEffect } from "./useSelectionEffect";

export function usePlot() {
  useLoadPlotEffect();
  useSelectionEffect();

  return {
    plotData: useRecoilValue(plotDataAtom),
    plotError: useRecoilValue(plotErrorAtom),
  };
}
