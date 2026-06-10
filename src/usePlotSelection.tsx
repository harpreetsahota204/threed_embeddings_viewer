import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  useRecoilState,
  useRecoilValue,
  useSetRecoilState,
} from "recoil";
import * as fos from "@fiftyone/state";
import { usePanelStatePartial } from "@fiftyone/spaces";
import { lassoSelectionAtom, lassoStageIdAtom } from "./State";

const SELECT_STAGE_CLS = "fiftyone.core.stages.Select";

// Tracks dataset switches across remounts so stale selections are dropped
let lastDataset: string | null = null;

function sameIds(a: string[], b: string[] | null): boolean {
  if (!b || a.length !== b.length) return false;
  const bSet = new Set(b);
  return a.every((id) => bSet.has(id));
}

function newStageId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `lasso-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Clears the lasso selection and removes the plugin's Select stage from
 * the view. Safe to use outside of the panel context (eg the tab
 * indicator), since it only touches global state.
 */
export function useClearLassoSelection() {
  const view = useRecoilValue(fos.view) as any[];
  const setView = fos.useSetView();
  const [selectedSamples, setSelectedSamples] = useRecoilState<Set<string>>(
    fos.selectedSamples
  );
  const [stageId, setStageId] = useRecoilState(lassoStageIdAtom);
  const setLassoSelection = useSetRecoilState(lassoSelectionAtom);

  return useCallback(() => {
    setLassoSelection(null);
    if (stageId) {
      setStageId(null);
      setView((view || []).filter((s) => s?._uuid !== stageId));
    }
    if (selectedSamples.size > 0) {
      setSelectedSamples(new Set());
    }
  }, [view, stageId, selectedSamples]);
}

/**
 * If the user removed our stage from the view bar, drop the local
 * selection too. Mounted in the tab indicator (not the panel) so it also
 * works while the panel is hidden.
 *
 * Tracks the specific uuid that has been observed in the view: setView
 * propagates asynchronously, so right after a lasso replaces the stage,
 * the view still briefly contains the OLD uuid. Only a stage that has
 * been observed in the view and is then missing was removed externally.
 */
export function useLassoStageWatchdog() {
  const view = useRecoilValue(fos.view) as any[];
  const [stageId, setStageId] = useRecoilState(lassoStageIdAtom);
  const setLassoSelection = useSetRecoilState(lassoSelectionAtom);

  const armedStageRef = useRef<string | null>(null);
  useEffect(() => {
    if (!stageId) {
      armedStageRef.current = null;
      return;
    }

    const present = (view || []).some((stage) => stage?._uuid === stageId);
    if (present) {
      armedStageRef.current = stageId;
    } else if (armedStageRef.current === stageId) {
      armedStageRef.current = null;
      setStageId(null);
      setLassoSelection(null);
    }
  }, [view, stageId]);
}

/**
 * Lasso/click selections are applied as a Select view stage rather than
 * fos.extendedSelection. The extended selection is client-only state that
 * the App resets whenever the page query reloads, and nothing can
 * re-assert it while the panel is hidden (panels unmount). A view stage is
 * server-backed session state, so the grid filter survives refreshes and
 * the panel being hidden, and is visible/removable in the view bar.
 */
export function usePlotSelection() {
  const datasetName = useRecoilValue(fos.datasetName) as string;
  const view = useRecoilValue(fos.view) as any[];
  const setView = fos.useSetView();
  const [selectedSamples, setSelectedSamples] = useRecoilState<Set<string>>(
    fos.selectedSamples
  );
  const [lassoSelection, setLassoSelection] =
    useRecoilState(lassoSelectionAtom);
  const [stageId, setStageId] = useRecoilState(lassoStageIdAtom);
  // Sample ids in the current filtered view, used for dimming
  const [viewSelection] = usePanelStatePartial("viewSelection", null, true);
  const clearSelection = useClearLassoSelection();

  // Drop stale selection state when the dataset changes
  useEffect(() => {
    if (lastDataset !== null && lastDataset !== datasetName) {
      setLassoSelection(null);
      setStageId(null);
    }
    lastDataset = datasetName;
  }, [datasetName]);

  function handleSelected(selectedResults: string[]) {
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

    const stage = {
      _cls: SELECT_STAGE_CLS,
      kwargs: [
        ["sample_ids", selectedResults],
        ["ordered", false],
      ],
      _uuid: newStageId(),
    };

    const otherStages = (view || []).filter((s) => s?._uuid !== stageId);
    setLassoSelection(selectedResults);
    setStageId(stage._uuid);
    setView([...otherStages, stage]);
  }

  // Memoized so that the trace memo in Panel only invalidates when the
  // selection actually changes.
  // Selection priority: checked samples > lasso selection > view filtering
  const resolvedSelection = useMemo(() => {
    if (selectedSamples.size) {
      return Array.from(selectedSamples);
    }
    if (lassoSelection?.length) {
      return lassoSelection;
    }
    if (viewSelection?.length) {
      return viewSelection;
    }
    return null;
  }, [selectedSamples, lassoSelection, viewSelection]);

  return {
    handleSelected,
    resolvedSelection,
  };
}
