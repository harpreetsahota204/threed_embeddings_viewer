import { useCallback, useEffect, useMemo, useRef } from "react";
import { useRecoilState, useRecoilValue } from "recoil";
import * as fos from "@fiftyone/state";
import { useOperatorExecutor } from "@fiftyone/operators";
import { useBrainResult } from "./useBrainResult";
import { ProjectionParams, Point2D } from "./lasso";
import {
  LassoSelection,
  lassoSelectionAtom,
  lassoStageIdAtom,
} from "./State";

const SELECT_STAGE_CLS = "fiftyone.core.stages.Select";
const MATCH_TAGS_STAGE_CLS = "fiftyone.core.stages.MatchTags";

// Must match _SELECTION_TAG in __init__.py
const SELECTION_TAG = "3d-embeddings-selection";

const APPLY_SELECTION_URI =
  "@harpreetsahota/threed-embeddings/apply_selection";

// Tracks dataset switches across remounts so stale selections are dropped
let lastDataset: string | null = null;

function newStageId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `lasso-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function selectStage(sampleIds: string[]) {
  return {
    _cls: SELECT_STAGE_CLS,
    kwargs: [
      ["sample_ids", sampleIds],
      ["ordered", false],
    ],
    _uuid: newStageId(),
  };
}

function matchTagsStage() {
  return {
    _cls: MATCH_TAGS_STAGE_CLS,
    kwargs: [
      ["tags", [SELECTION_TAG]],
      ["bool", true],
      ["all", false],
    ],
    _uuid: newStageId(),
  };
}

/**
 * Returns a callback that removes the selection tag from the dataset if
 * (and only if) the given selection is tag-tier. Fire-and-forget.
 */
function useUntagSelection() {
  const applyExecutor = useOperatorExecutor(APPLY_SELECTION_URI);

  return useCallback((selection: LassoSelection | null) => {
    if (selection && !selection.ids) {
      applyExecutor.execute(
        { kind: "clear" },
        { skipErrorNotification: true }
      );
    }
  }, []);
}

/**
 * Clears the lasso selection and removes the plugin's view stage. For
 * tag-tier selections, also removes the selection tag from the dataset.
 * Safe to use outside of the panel context (eg the tab indicator), since
 * it only touches global state.
 */
export function useClearLassoSelection() {
  const view = useRecoilValue(fos.view) as any[];
  const setView = fos.useSetView();
  const [selectedSamples, setSelectedSamples] = useRecoilState<Set<string>>(
    fos.selectedSamples
  );
  const [stageId, setStageId] = useRecoilState(lassoStageIdAtom);
  const [lassoSelection, setLassoSelection] =
    useRecoilState(lassoSelectionAtom);
  const untagSelection = useUntagSelection();

  return useCallback(() => {
    // Tag-tier selections leave a tag on the dataset; remove it
    untagSelection(lassoSelection);
    setLassoSelection(null);
    if (stageId) {
      setStageId(null);
      setView((view || []).filter((s) => s?._uuid !== stageId));
    }
    if (selectedSamples.size > 0) {
      setSelectedSamples(new Set());
    }
  }, [view, stageId, selectedSamples, lassoSelection]);
}

/**
 * If the user removed our stage from the view bar, drop the local
 * selection too (untagging for tag-tier selections). Mounted in the tab
 * indicator (not the panel) so it also works while the panel is hidden.
 *
 * Tracks the specific uuid that has been observed in the view: setView
 * propagates asynchronously, so right after a lasso replaces the stage,
 * the view still briefly contains the OLD uuid. Only a stage that has
 * been observed in the view and is then missing was removed externally.
 */
export function useLassoStageWatchdog() {
  const view = useRecoilValue(fos.view) as any[];
  const [stageId, setStageId] = useRecoilState(lassoStageIdAtom);
  const [lassoSelection, setLassoSelection] =
    useRecoilState(lassoSelectionAtom);
  const untagSelection = useUntagSelection();

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
      untagSelection(lassoSelection);
      setLassoSelection(null);
    }
  }, [view, stageId, lassoSelection, untagSelection]);
}

/**
 * Selections are resolved server-side by the apply_selection operator
 * (the polygon/class goes over the wire, never id lists) and applied as
 * a view stage rather than fos.extendedSelection. The extended selection
 * is client-only state that the App resets whenever the page query
 * reloads, and nothing can re-assert it while the panel is hidden
 * (panels unmount). A view stage is server-backed session state, so the
 * grid filter survives refreshes and the panel being hidden, and is
 * visible/removable in the view bar.
 *
 * Two tiers, decided by the server: small selections come back as ids
 * and are applied as a Select stage (read-only, exactly as before);
 * large selections are written as a dataset tag server-side and applied
 * as a constant-size MatchTags stage.
 */
export function usePlotSelection() {
  const datasetName = useRecoilValue(fos.datasetName) as string;
  const [brainKey] = useBrainResult();
  const view = useRecoilValue(fos.view) as any[];
  const setView = fos.useSetView();
  const [selectedSamples, setSelectedSamples] = useRecoilState<Set<string>>(
    fos.selectedSamples
  );
  const [lassoSelection, setLassoSelection] =
    useRecoilState(lassoSelectionAtom);
  const [stageId, setStageId] = useRecoilState(lassoStageIdAtom);
  const applyExecutor = useOperatorExecutor(APPLY_SELECTION_URI);
  const clearSelection = useClearLassoSelection();

  // Drop stale selection state when the dataset changes. The previous
  // dataset may keep a stale selection tag (we cannot untag a dataset
  // that is no longer the context); it is superseded by the next
  // selection there.
  useEffect(() => {
    if (lastDataset !== null && lastDataset !== datasetName) {
      setLassoSelection(null);
      setStageId(null);
    }
    lastDataset = datasetName;
  }, [datasetName]);

  function applyStage(stage: any, count: number, ids: string[] | null) {
    // Only clear checked samples if there are any; redundant writes sync
    // to the server session and trigger page refreshes
    if (selectedSamples.size > 0) {
      setSelectedSamples(new Set());
    }

    const otherStages = (view || []).filter((s) => s?._uuid !== stageId);
    setLassoSelection({ count, ids });
    setStageId(stage._uuid);
    setView([...otherStages, stage]);
  }

  function applyResult(result: any) {
    const count = result?.count ?? 0;
    if (!count) {
      clearSelection();
      return;
    }

    const ids = result?.sample_ids ?? null;
    applyStage(ids ? selectStage(ids) : matchTagsStage(), count, ids);
  }

  // The execute() promise does not resolve with the result; results must
  // be read via the callback option
  const executeApply = (params: Record<string, unknown>) => {
    applyExecutor.execute(params, {
      callback: (result: any) => applyResult(result?.result),
    });
  };

  function handleLasso(polygon: Point2D[], projection: ProjectionParams) {
    if (!brainKey) return;
    executeApply({
      kind: "lasso",
      brain_key: brainKey,
      lasso: { polygon, ...projection },
    });
  }

  // Selects all samples CONTAINING the class (presence semantics, like
  // sidebar label filters)
  function handleClassSelect(colorBy: string, label: string) {
    if (!brainKey) return;
    executeApply({
      kind: "class",
      brain_key: brainKey,
      color_by: colorBy,
      label,
    });
  }

  // Adds/removes a single point from the current selection (select mode
  // click). Clearing the last point clears the whole selection.
  function toggleSelected(sampleId: string) {
    if (!lassoSelection || lassoSelection.ids) {
      // Small tier: ids are local, toggle stays client-side
      const current = lassoSelection?.ids ?? [];
      const next = current.includes(sampleId)
        ? current.filter((id) => id !== sampleId)
        : [...current, sampleId];

      if (next.length === 0) {
        clearSelection();
      } else {
        applyStage(selectStage(next), next.length, next);
      }
      return;
    }

    // Tag tier: membership lives server-side
    applyExecutor.execute(
      { kind: "toggle", sample_id: sampleId },
      {
        callback: (result: any) => {
          const count = result?.result?.count ?? 0;
          if (!count) {
            clearSelection();
            return;
          }
          // Fresh uuid so the view re-resolves the mutated tag
          applyStage(matchTagsStage(), count, null);
        },
      }
    );
  }

  // Memoized so that the trace memo in Panel only invalidates when the
  // selection actually changes.
  // Bright-point priority: checked samples > small-tier lasso ids.
  // Tag-tier and view-filter dimming are index-based (viewBitmask, which
  // the stage change refreshes) and handled in the Panel.
  const resolvedSelection = useMemo(() => {
    if (selectedSamples.size) {
      return Array.from(selectedSamples);
    }
    if (lassoSelection?.ids?.length) {
      return lassoSelection.ids;
    }
    return null;
  }, [selectedSamples, lassoSelection]);

  return {
    handleLasso,
    handleClassSelect,
    toggleSelected,
    resolvedSelection,
  };
}
