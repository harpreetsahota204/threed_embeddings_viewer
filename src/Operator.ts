/**
 * JS operators that receive data pushed from the Python operators via
 * ctx.trigger(). They write to plain recoil atoms because triggered
 * operators execute outside of the panel context.
 */

import {
  Operator,
  OperatorConfig,
  registerOperator,
} from '@fiftyone/operators';
import { useSetRecoilState } from 'recoil';
import { plotDataAtom, plotErrorAtom, PlotData } from './State';
import { logError } from './logger';

class SetPlotData extends Operator {
  get config() {
    return new OperatorConfig({
      name: 'set_plot_data',
      label: 'Set Plot Data',
      unlisted: true,
    });
  }

  useHooks() {
    return {
      setPlotData: useSetRecoilState(plotDataAtom),
      setPlotError: useSetRecoilState(plotErrorAtom),
    };
  }

  async execute({ hooks, params }: any) {
    const data = params.plot_data as PlotData;
    if (!data?.x || !data?.y || !data?.z) {
      logError('set_plot_data: invalid payload', params);
      hooks.setPlotError('Invalid plot data received');
      return;
    }

    hooks.setPlotData(data);
    hooks.setPlotError(null);
  }
}

class SetPlotError extends Operator {
  get config() {
    return new OperatorConfig({
      name: 'set_plot_error',
      label: 'Set Plot Error',
      unlisted: true,
    });
  }

  useHooks() {
    return {
      setPlotError: useSetRecoilState(plotErrorAtom),
    };
  }

  async execute({ hooks, params }: any) {
    logError('set_plot_error:', params.error);
    hooks.setPlotError(params.error || 'Unknown error');
  }
}

registerOperator(SetPlotData, '@harpreetsahota/threed-embeddings');
registerOperator(SetPlotError, '@harpreetsahota/threed-embeddings');
