/**
 * The grid's checked samples (fos.selectedSamples) are sample ids, but
 * the plot works in point indices and no longer holds ids client-side.
 * This resolves checked ids -> indices via the get_sample_indices
 * operator whenever the checked set changes.
 */

import { useEffect, useState } from "react";
import { useRecoilValue } from "recoil";
import * as fos from "@fiftyone/state";
import { useOperatorExecutor } from "@fiftyone/operators";
import { useBrainResult } from "./useBrainResult";
import { PlotData } from "./State";
import { logError, logWarn } from "./logger";

// Checked-sample styling is skipped above this many ids (manual grid
// checking never realistically reaches this; "select all"-scale checked
// sets would ship huge id lists for styling only)
const MAX_CHECKED_IDS = 10000;

export function useCheckedIndices(
  plotData: PlotData | null
): Set<number> | null {
  const selectedSamples = useRecoilValue(fos.selectedSamples) as Set<string>;
  const [brainKey] = useBrainResult();
  const [indices, setIndices] = useState<Set<number> | null>(null);

  const executor = useOperatorExecutor(
    "@harpreetsahota/threed-embeddings/get_sample_indices"
  );

  useEffect(() => {
    if (!plotData || !brainKey || selectedSamples.size === 0) {
      setIndices(null);
      return;
    }

    if (selectedSamples.size > MAX_CHECKED_IDS) {
      logWarn(
        `${selectedSamples.size.toLocaleString()} checked samples exceeds ` +
          `the styling limit (${MAX_CHECKED_IDS.toLocaleString()}); ` +
          `checked-point highlighting skipped`
      );
      setIndices(null);
      return;
    }

    let stale = false;
    executor.execute(
      { brain_key: brainKey, sample_ids: Array.from(selectedSamples) },
      {
        skipErrorNotification: true,
        callback: (result: any) => {
          if (stale) return;
          if (result?.error) {
            logError("get_sample_indices failed", result.error);
            setIndices(null);
            return;
          }
          const resolved = result?.result?.indices;
          setIndices(resolved?.length ? new Set(resolved) : null);
        },
      }
    );
    return () => {
      stale = true;
    };
  }, [selectedSamples, brainKey, plotData]);

  return indices;
}
