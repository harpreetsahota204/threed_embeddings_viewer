import { useRecoilValue } from "recoil";
import {
  plotColorsAtom,
  plotDataAtom,
  plotErrorAtom,
  plotProgressAtom,
} from "./State";
import { useLoadPlotEffect } from "./useLoadPlotEffect";
import { useSelectionEffect } from "./useSelectionEffect";

export function usePlot() {
  useLoadPlotEffect();
  useSelectionEffect();

  return {
    plotData: useRecoilValue(plotDataAtom),
    plotColors: useRecoilValue(plotColorsAtom),
    plotError: useRecoilValue(plotErrorAtom),
    plotProgress: useRecoilValue(plotProgressAtom),
  };
}
