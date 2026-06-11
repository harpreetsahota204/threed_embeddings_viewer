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
import { logError, logWarn, logDebug } from "./logger";

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

    const sampleIds = Array.from(selectedSamples);

    // DEBUG: get_sample_indices crashed server-side with
    // "unhashable type: 'list'", which means an element of sample_ids is
    // an array, not a string. Log the exact shape we are sending.
    logDebug("get_sample_indices -> request", {
      brainKey,
      count: sampleIds.length,
      firstFive: sampleIds.slice(0, 5),
      elementTypes: sampleIds.slice(0, 5).map((id) => typeof id),
      anyNonString: sampleIds.some((id) => typeof id !== "string"),
      nonStringSamples: sampleIds.filter((id) => typeof id !== "string").slice(0, 5),
    });

    let stale = false;
    executor.execute(
      { brain_key: brainKey, sample_ids: sampleIds },
      {
        skipErrorNotification: true,
        callback: (result: any) => {
          if (stale) return;
          if (result?.error) {
            logError("get_sample_indices failed", result.error);
            logDebug("get_sample_indices -> ERROR", {
              error: result.error,
              sentCount: sampleIds.length,
              firstFive: sampleIds.slice(0, 5),
            });
            setIndices(null);
            return;
          }
          const resolved = result?.result?.indices;
          logDebug("get_sample_indices -> ok", {
            resolvedCount: resolved?.length ?? 0,
            serverDebug: result?.result?._debug ?? null,
          });
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
