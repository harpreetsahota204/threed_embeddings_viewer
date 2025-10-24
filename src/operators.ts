/**
 * TypeScript bridge operators for state management
 */

import { Operator, OperatorConfig, useOperatorExecutor } from '@fiftyone/operators';
import { useSetRecoilState } from 'recoil';
import {
  plotDataAtom,
  selectedSampleIdsAtom,
  isLoadingAtom,
  errorAtom,
  PlotData,
} from './state';

/**
 * Operator to set plot data from Python
 */
class SetPlotDataOperator extends Operator {
  get config(): OperatorConfig {
    return {
      name: 'set_plot_data',
      label: 'Set Plot Data',
      unlisted: true,
    };
  }

  useHooks() {
    const setPlotData = useSetRecoilState(plotDataAtom);
    const setIsLoading = useSetRecoilState(isLoadingAtom);
    const setError = useSetRecoilState(errorAtom);

    return { setPlotData, setIsLoading, setError };
  }

  async execute({ hooks, params }: any) {
    const { setPlotData, setIsLoading, setError } = hooks;

    try {
      setIsLoading(true);
      setError(null);

      const data = params.data as PlotData;

      if (!data || !data.x || !data.y || !data.z) {
        throw new Error('Invalid plot data received');
      }

      setPlotData(data);
      setIsLoading(false);

      return { success: true };
    } catch (error: any) {
      setError(error.message || 'Failed to load plot data');
      setIsLoading(false);
      return { success: false, error: error.message };
    }
  }
}

/**
 * Operator to update selection from React to FiftyOne
 */
class UpdateSelectionOperator extends Operator {
  get config(): OperatorConfig {
    return {
      name: 'update_selection',
      label: 'Update Selection',
      unlisted: true,
    };
  }

  useHooks() {
    const setSelectedSampleIds = useSetRecoilState(selectedSampleIdsAtom);
    const executor = useOperatorExecutor('@harpreetsahota/threed-embeddings/apply_selection_from_plot');

    return { setSelectedSampleIds, executor };
  }

  async execute({ hooks, params }: any) {
    const { setSelectedSampleIds, executor } = hooks;

    try {
      const sampleIds = params.sample_ids as string[];

      // Update local state
      setSelectedSampleIds(sampleIds);

      // Trigger Python operator to update FiftyOne selection
      await executor.execute({
        sample_ids: sampleIds,
      });

      return { success: true, num_selected: sampleIds.length };
    } catch (error: any) {
      console.error('Failed to update selection:', error);
      return { success: false, error: error.message };
    }
  }
}

export { SetPlotDataOperator, UpdateSelectionOperator };

