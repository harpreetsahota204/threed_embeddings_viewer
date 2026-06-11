import { useEffect, useState } from 'react';
import { useRecoilValue } from 'recoil';
import * as fos from '@fiftyone/state';
import { useOperatorExecutor } from '@fiftyone/operators';
import { usePanelStatePartial } from '@fiftyone/spaces';
import { logError } from './logger';

export const useSimilarityKey = () =>
  usePanelStatePartial('similarityKey', null, true);

// Similarity runs are enumerated server-side via
// list_brain_runs(type=fob.Similarity): the frontend dataset.brainMethods
// object does not reliably expose a run's type, so we cannot filter for
// similarity runs client-side the way the visualization selector does.
export function useSimilarityKeySelector() {
  const [selected, setSelected] = useSimilarityKey();
  const datasetName = useRecoilValue(fos.datasetName) as string;
  const [keys, setKeys] = useState<string[]>([]);

  const executor = useOperatorExecutor(
    '@harpreetsahota/threed-embeddings/list_similarity_runs'
  );

  useEffect(() => {
    if (!datasetName) {
      setKeys([]);
      return;
    }

    let stale = false;
    executor.execute(
      {},
      {
        skipErrorNotification: true,
        callback: (result: any) => {
          if (stale) return;
          if (result?.error) {
            logError('list_similarity_runs failed', result.error);
            setKeys([]);
            return;
          }
          setKeys(result?.result?.keys ?? []);
        },
      }
    );
    return () => {
      stale = true;
    };
  }, [datasetName]);

  const handlers = {
    onSelect(value: string) {
      setSelected(value);
    },
    value: selected,
    useSearch: (search: string) => ({
      values: keys.filter((item) =>
        item.toLowerCase().includes(search.toLowerCase())
      ),
    }),
  };

  return {
    handlers,
    simKey: selected,
    canSelect: keys.length > 0,
    hasSelection: selected !== null,
    keys,
  };
}
