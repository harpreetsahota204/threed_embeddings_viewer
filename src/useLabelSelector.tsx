import { useMemo } from "react";
import { useRecoilValue } from "recoil";
import * as fos from "@fiftyone/state";
import { usePanelStatePartial } from "@fiftyone/spaces";

export const useColorByField = () => usePanelStatePartial("colorByField", null);

const UNCOLORED = "uncolored";

const PRIMITIVE_FTYPES = [
  "fiftyone.core.fields.StringField",
  "fiftyone.core.fields.BooleanField",
  "fiftyone.core.fields.IntField",
  "fiftyone.core.fields.FloatField",
];

const SKIP_FIELDS = ["filepath", "tags", "metadata"];

function getColorByChoices(fullSchema: any): string[] {
  const fields = [UNCOLORED];

  for (const [name, field] of Object.entries<any>(fullSchema || {})) {
    if (SKIP_FIELDS.includes(name)) continue;

    const docType = field.embeddedDocType || "";
    if (docType.endsWith(".Classification")) {
      fields.push(`${name}.label`, `${name}.confidence`);
    } else if (docType.endsWith(".Detections")) {
      fields.push(`${name}.detections.label`, `${name}.detections.confidence`);
    } else if (PRIMITIVE_FTYPES.includes(field.ftype)) {
      fields.push(name);
    }
  }

  return fields;
}

export function useLabelSelector() {
  const fullSchema = useRecoilValue(fos.fullSchema);
  const [label, setLabel] = useColorByField();

  const availableFields = useMemo(
    () => getColorByChoices(fullSchema),
    [fullSchema]
  );

  const handlers = {
    onSelect(selected: string) {
      setLabel(selected === UNCOLORED ? null : selected);
    },
    value: label,
    toKey: (item: string) => item,
    useSearch: (search: string) => ({
      values: availableFields.filter((item) =>
        item.toLowerCase().includes(search.toLowerCase())
      ),
    }),
  };

  return {
    label,
    handlers,
  };
}
