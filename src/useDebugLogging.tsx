/**
 * Debug logging for selection/view/filter state transitions. Each effect
 * fires only when its piece of state actually changes, so the console
 * gives a causal trace of what changed and in what order.
 */

import { useEffect } from "react";
import { useRecoilValue } from "recoil";
import * as fos from "@fiftyone/state";
import { usePanelStatePartial } from "@fiftyone/spaces";
import { lassoSelectionAtom, lassoStageIdAtom } from "./State";
import { log } from "./logger";

export function useDebugLogging() {
  const view = useRecoilValue(fos.view) as any[];
  const filters = useRecoilValue(fos.filters) as Record<string, unknown>;
  const selectedSamples = useRecoilValue(fos.selectedSamples) as Set<string>;
  const lassoSelection = useRecoilValue(lassoSelectionAtom);
  const stageId = useRecoilValue(lassoStageIdAtom);
  const [viewSelection] = usePanelStatePartial("viewSelection", null, true);

  useEffect(() => {
    log("panel mounted");
    return () => log("panel unmounted");
  }, []);

  useEffect(() => {
    const stages = (view || []).map((s) => {
      const cls = s?._cls?.split(".").pop() ?? "?";
      return s?._uuid === stageId ? `${cls}(ours)` : cls;
    });
    log(`view: [${stages.join(", ")}] (${(view || []).length} stages)`);
  }, [view, stageId]);

  useEffect(() => {
    const keys = Object.keys(filters || {});
    log(`filters: ${keys.length ? keys.join(", ") : "(none)"}`);
  }, [filters]);

  useEffect(() => {
    log(`checked samples (grid): ${selectedSamples.size}`);
  }, [selectedSamples]);

  useEffect(() => {
    log(
      `lassoSelection: ${lassoSelection?.length ?? "none"},`,
      `stageId: ${stageId ?? "none"}`
    );
  }, [lassoSelection, stageId]);

  useEffect(() => {
    log(`viewSelection (dimming set): ${viewSelection?.length ?? "none"}`);
  }, [viewSelection]);
}
