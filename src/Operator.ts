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
import { usePanelStatePartial } from '@fiftyone/spaces';
import {
  plotDataAtom,
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
 * Operator to handle errors from Python operator
 */
class SetPlotError extends Operator {
  get config(): OperatorConfig {
    return new OperatorConfig({
      name: 'set_plot_error',
      label: 'Set Plot Error',
      unlisted: true,
    });
  }

  useHooks() {
    return {
      setLoadingPlotError: usePanelStatePartial("loadingPlotError", null, true)[1],
    };
  }

  async execute({ hooks, params }: ExecutionContext) {
    try {
      const error = params.error;
      hooks.setLoadingPlotError({
        message: error,
        stack: '',
      });
      return { success: true };
    } catch (error: any) {
      console.error('Failed to set plot error:', error);
      return { success: false, error: error.message };
    }
  }
}

// Register operators with the plugin namespace
registerOperator(SetPlotData, '@harpreetsahota/threed-embeddings');
registerOperator(SetPlotError, '@harpreetsahota/threed-embeddings');

