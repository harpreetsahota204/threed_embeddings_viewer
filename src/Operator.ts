/**
 * TypeScript Operators for 3D Embeddings Viewer
 * Following FiftyOne JS plugin patterns from:
 * https://docs.voxel51.com/plugins/developing_plugins.html#developing-js-plugins
 */

import {
  Operator,
  OperatorConfig,
  ExecutionContext,
  registerOperator,
} from '@fiftyone/operators';
import { useSetRecoilState } from 'recoil';
import {
  plotDataAtom,
  selectedSampleIdsAtom,
  PlotData,
} from './State';

/**
 * Operator to receive and store plot data from Python operator
 */
class SetPlotData extends Operator {
  get config(): OperatorConfig {
    return new OperatorConfig({
      name: 'set_plot_data',
      label: 'Set Plot Data',
      unlisted: true,
    });
  }

  useHooks() {
    const setPlotData = useSetRecoilState(plotDataAtom);
    return { setPlotData };
  }

  async execute({ hooks, params }: ExecutionContext) {
    try {
      const data = params.plot_data as PlotData;

      if (!data || !data.x || !data.y || !data.z) {
        throw new Error('Invalid plot data received');
      }

      hooks.setPlotData(data);
      return { success: true };
    } catch (error: any) {
      console.error('Failed to set plot data:', error);
      return { success: false, error: error.message };
    }
  }
}

/**
 * Operator to sync selection state when Python operator executes
 */
class UpdateSelection extends Operator {
  get config(): OperatorConfig {
    return new OperatorConfig({
      name: 'update_selection',
      label: 'Update Selection',
      unlisted: true,
    });
  }

  useHooks() {
    const setSelectedSampleIds = useSetRecoilState(selectedSampleIdsAtom);
    return { setSelectedSampleIds };
  }

  async execute({ hooks, params }: ExecutionContext) {
    try {
      const sampleIds = params.sample_ids as string[];
      hooks.setSelectedSampleIds(sampleIds);
      return { success: true, count: sampleIds.length };
    } catch (error: any) {
      console.error('Failed to update selection:', error);
      return { success: false, error: error.message };
    }
  }
}

// Register operators with the plugin namespace
registerOperator(SetPlotData, '@harpreetsahota/threed-embeddings');
registerOperator(UpdateSelection, '@harpreetsahota/threed-embeddings');

