import { useRecoilValue } from "recoil";
import * as fos from "@fiftyone/state";
import { usePanelStatePartial } from "@fiftyone/spaces";
import { useEffect, useState } from "react";
import { useBrainResult } from "./useBrainResult";

export const useColorByField = () => usePanelStatePartial("colorByField", null);

// Hook to get available color by choices
export function useColorByChoices() {
  const datasetName = useRecoilValue(fos.datasetName);
  const [brainKey] = useBrainResult();
  const view = useRecoilValue(fos.view);
  const slices = useRecoilValue(fos.currentSlices(false));
  const [loadedPlot] = usePanelStatePartial("loadedPlot", null, true);
  const dataset = useRecoilValue(fos.dataset);
  const fullSchema = useRecoilValue(fos.fullSchema);

  const [isLoading, setIsLoading] = useState(false);
  const [availableFields, setAvailableFields] = useState(null);

  useEffect(() => {
    if (loadedPlot && brainKey && dataset && fullSchema) {
      setIsLoading(true);
      
      // Get available fields from schema
      const fields = ["uncolored"];
      
      // Add sample fields
      if (fullSchema) {
        Object.keys(fullSchema).forEach(fieldName => {
          const field = fullSchema[fieldName];
          // Add basic fields
          fields.push(fieldName);
          
          // Add nested fields for classifications/detections
          if (field.ftype && field.ftype.includes("Classification")) {
            fields.push(`${fieldName}.label`);
            fields.push(`${fieldName}.confidence`);
          }
          if (field.ftype && field.ftype.includes("Detections")) {
            fields.push(`${fieldName}.detections.label`);
            fields.push(`${fieldName}.detections.confidence`);
          }
        });
      }
      
      setAvailableFields(fields);
      setIsLoading(false);
    }
  }, [datasetName, brainKey, view, slices, loadedPlot, dataset, fullSchema]);

  return {
    availableFields,
    isLoading,
  };
}

export function useLabelSelector() {
  const dataset = useRecoilValue(fos.dataset);
  const fullSchema = useRecoilValue(fos.fullSchema);
  const [label, setLabel] = useColorByField();
  const { availableFields, isLoading } = useColorByChoices();

  const handlers = {
    onSelect(selected) {
      if (selected === "uncolored") {
        selected = null;
      }
      setLabel(selected);
    },
    value: label,
    toKey: (item) => item,
    useSearch: (search) => ({
      values:
        availableFields &&
        availableFields.filter((item) =>
          item.toLowerCase().includes(search.toLowerCase())
        ),
    }),
  };

  return {
    label,
    handlers,
    isLoading,
    canSelect: !isLoading && availableFields && availableFields.length > 0,
  };
}

