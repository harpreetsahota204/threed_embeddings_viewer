import { useEffect, useMemo } from "react";
import { useRecoilState } from "recoil";
import * as fos from "@fiftyone/state";
import { usePanelStatePartial } from "@fiftyone/spaces";
import { log } from "./logger";

const SELECTION_SCOPE = "3d-embeddings-selection";

function sameIds(a: string[], b: string[] | null): boolean {
  if (!b || a.length !== b.length) return false;
  const bSet = new Set(b);
  return a.every((id) => bSet.has(id));
}

export function usePlotSelection() {
  const resetExtendedSelection = fos.useResetExtendedSelection();
  const [{ selection }, setExtendedSelection] = useRecoilState<{
    selection: string[] | null;
    scope?: string;
  }>(fos.extendedSelection);
  const [selectedSamples, setSelectedSamples] = useRecoilState<Set<string>>(
    fos.selectedSamples
  );
  // The lasso/click selection lives in panel state because the App resets
  // fos.extendedSelection whenever the page query reloads (server "refresh"
  // events re-commit the dataset fragment, whose sync closure does not
  // track user-set values)
  const [lassoSelection, setLassoSelection] = usePanelStatePartial(
    "lassoSelection",
    null,
    true
  );
  // Sample ids in the current filtered view, used for dimming
  const [viewSelection] = usePanelStatePartial("viewSelection", null, true);

  // Re-assert the extended selection if the App wiped it (this is what
  // filters the sample grid)
  useEffect(() => {
    if (lassoSelection?.length && (!selection || selection.length === 0)) {
      log(
        `re-asserting extended selection (${lassoSelection.length} ids) after external reset`
      );
      setExtendedSelection({
        selection: lassoSelection,
        scope: SELECTION_SCOPE,
      });
    }
  }, [selection, lassoSelection]);

  function handleSelected(selectedResults: string[]) {
    log("handleSelected:", selectedResults.length, "ids");
    if (selectedResults.length === 0) {
      clearSelection();
      return;
    }

    // No-op on identical selections: redundant state writes re-render the
    // plot, which can feed back into plotly's synthetic click events
    if (sameIds(selectedResults, lassoSelection)) {
      return;
    }

    // Only clear checked samples if there are any; redundant writes sync to
    // the server session and trigger page refreshes
    if (selectedSamples.size > 0) {
      setSelectedSamples(new Set());
    }
    setLassoSelection(selectedResults);
    setExtendedSelection({
      selection: selectedResults,
      scope: SELECTION_SCOPE,
    });
  }

  function clearSelection() {
    log("clearSelection");
    setLassoSelection(null);
    resetExtendedSelection();
    if (selectedSamples.size > 0) {
      setSelectedSamples(new Set());
    }
  }

  // Memoized so that the trace memo in Panel only invalidates when the
  // selection actually changes
  const { resolvedSelection, selectionStyle } = useMemo(() => {
    // Selection priority: checked samples > lasso selection > view filtering
    if (selectedSamples.size) {
      return {
        resolvedSelection: Array.from(selectedSamples),
        selectionStyle: "selected",
      };
    }
    if (lassoSelection?.length) {
      return { resolvedSelection: lassoSelection, selectionStyle: "extended" };
    }
    if (viewSelection?.length) {
      return { resolvedSelection: viewSelection, selectionStyle: "plot" };
    }
    return { resolvedSelection: null, selectionStyle: null };
  }, [selectedSamples, lassoSelection, viewSelection]);

  return {
    handleSelected,
    clearSelection,
    resolvedSelection,
    hasSelection: resolvedSelection !== null,
    selectionStyle,
  };
}
