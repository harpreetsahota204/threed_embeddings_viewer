/**
 * JS operators that receive data pushed from the Python operators via
 * ctx.trigger(). They write to plain recoil atoms because triggered
 * operators execute outside of the panel context.
 *
 * Geometry arrives as a set_plot_data_meta trigger (allocate) followed
 * by set_plot_data_chunk triggers (base64 float32 -> typed arrays).
 * Assembly state is module-level: triggered operators are recreated per
 * call and panels remount frequently, but a stream must survive both.
 */

import {
  Operator,
  OperatorConfig,
  registerOperator,
} from '@fiftyone/operators';
import { useSetRecoilState } from 'recoil';
import {
  plotColorsAtom,
  plotDataAtom,
  plotErrorAtom,
  plotProgressAtom,
  PlotColors,
} from './State';
import { resetGeometryRequest } from './useLoadPlotEffect';
import { base64ToBytes } from './base64';
import { logError, logInfo, logWarn } from './logger';

interface GeometryAssembly {
  source: string;
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  count: number;
  numDims: number;
  numChunks: number;
  received: number;
  loadedPoints: number;
  startedAt: number;
}

let assembly: GeometryAssembly | null = null;

// Above this many loaded points, skip the progressive per-chunk plot
// updates (each one is a full plotly trace rebuild of everything loaded
// so far) and only render on completion
const PROGRESSIVE_RENDER_LIMIT = 1000000;

function decodeF32(b64: string): Float32Array {
  return new Float32Array(base64ToBytes(b64).buffer);
}

class SetPlotDataMeta extends Operator {
  get config() {
    return new OperatorConfig({
      name: 'set_plot_data_meta',
      label: 'Set Plot Data Meta',
      unlisted: true,
    });
  }

  useHooks() {
    return {
      setPlotProgress: useSetRecoilState(plotProgressAtom),
      setPlotError: useSetRecoilState(plotErrorAtom),
    };
  }

  async execute({ hooks, params }: any) {
    const { source, count, num_dims, num_chunks } = params ?? {};
    if (!source || !count || !num_dims || !num_chunks) {
      logError('set_plot_data_meta: invalid payload', params);
      hooks.setPlotError('Invalid plot metadata received');
      return;
    }

    logInfo(
      `geometry stream start: ${count.toLocaleString()} points, ` +
        `${num_dims}D, ${num_chunks} chunk(s) [${source}]`
    );

    assembly = {
      source,
      x: new Float32Array(count),
      y: new Float32Array(count),
      // Stays zeroed for 2D embeddings (rendered as a flat plane)
      z: new Float32Array(count),
      count,
      numDims: num_dims,
      numChunks: num_chunks,
      received: 0,
      loadedPoints: 0,
      startedAt: performance.now(),
    };
    hooks.setPlotProgress({ received: 0, total: num_chunks });
  }
}

class SetPlotDataChunk extends Operator {
  get config() {
    return new OperatorConfig({
      name: 'set_plot_data_chunk',
      label: 'Set Plot Data Chunk',
      unlisted: true,
    });
  }

  useHooks() {
    return {
      setPlotData: useSetRecoilState(plotDataAtom),
      setPlotProgress: useSetRecoilState(plotProgressAtom),
      setPlotError: useSetRecoilState(plotErrorAtom),
    };
  }

  async execute({ hooks, params }: any) {
    const { source, chunk_index, start, size, x, y, z } = params ?? {};

    if (!assembly) {
      logWarn('set_plot_data_chunk: no stream in progress; ignoring');
      return;
    }
    if (assembly.source !== source) {
      logWarn(
        `set_plot_data_chunk: stale chunk from ${source} ` +
          `(current stream: ${assembly.source}); ignoring`
      );
      return;
    }
    if (!x || !y || start == null || size == null) {
      logError('set_plot_data_chunk: invalid payload', params);
      hooks.setPlotError('Invalid plot chunk received');
      assembly = null;
      return;
    }

    try {
      const t0 = performance.now();
      assembly.x.set(decodeF32(x), start);
      assembly.y.set(decodeF32(y), start);
      if (z) {
        assembly.z.set(decodeF32(z), start);
      }
      const decodeMs = (performance.now() - t0).toFixed(1);

      assembly.received += 1;
      assembly.loadedPoints = Math.max(
        assembly.loadedPoints,
        start + size
      );

      logInfo(
        `geometry chunk ${chunk_index + 1}/${assembly.numChunks}: ` +
          `${size.toLocaleString()} points in ${decodeMs}ms`
      );

      const complete = assembly.received === assembly.numChunks;
      hooks.setPlotProgress(
        complete
          ? null
          : { received: assembly.received, total: assembly.numChunks }
      );

      if (complete) {
        const totalMs = (performance.now() - assembly.startedAt).toFixed(0);
        logInfo(
          `geometry stream complete: ` +
            `${assembly.count.toLocaleString()} points in ${totalMs}ms`
        );
        hooks.setPlotData({
          x: assembly.x,
          y: assembly.y,
          z: assembly.z,
          count: assembly.count,
          num_dims: assembly.numDims,
        });
        hooks.setPlotError(null);
        assembly = null;
      } else if (assembly.loadedPoints <= PROGRESSIVE_RENDER_LIMIT) {
        // Progressive rendering: show what has arrived so far
        hooks.setPlotData({
          x: assembly.x.subarray(0, assembly.loadedPoints),
          y: assembly.y.subarray(0, assembly.loadedPoints),
          z: assembly.z.subarray(0, assembly.loadedPoints),
          count: assembly.loadedPoints,
          num_dims: assembly.numDims,
        });
        hooks.setPlotError(null);
      }
    } catch (e) {
      logError('set_plot_data_chunk: decode failed', e);
      hooks.setPlotError('Failed to decode plot data');
      assembly = null;
    }
  }
}

class SetPlotColors extends Operator {
  get config() {
    return new OperatorConfig({
      name: 'set_plot_colors',
      label: 'Set Plot Colors',
      unlisted: true,
    });
  }

  useHooks() {
    return {
      setPlotColors: useSetRecoilState(plotColorsAtom),
    };
  }

  async execute({ hooks, params }: any) {
    const data = params.plot_colors as PlotColors;
    const valid =
      data?.labels &&
      (data.color_scheme === 'continuous'
        ? data.colors
        : data.categories && data.class_indices && data.class_members);
    if (!valid) {
      logError('set_plot_colors: invalid payload', params);
      return;
    }

    logInfo(
      `colors received: ${data.labels.length.toLocaleString()} points, ` +
        `${data.color_scheme}`
    );
    hooks.setPlotColors(data);
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
      setPlotProgress: useSetRecoilState(plotProgressAtom),
    };
  }

  async execute({ hooks, params }: any) {
    logError('set_plot_error:', params.error);
    assembly = null;
    // Allow the frontend to retry the failed geometry load
    resetGeometryRequest();
    hooks.setPlotProgress(null);
    hooks.setPlotError(params.error || 'Unknown error');
  }
}

registerOperator(SetPlotDataMeta, '@harpreetsahota/threed-embeddings');
registerOperator(SetPlotDataChunk, '@harpreetsahota/threed-embeddings');
registerOperator(SetPlotColors, '@harpreetsahota/threed-embeddings');
registerOperator(SetPlotError, '@harpreetsahota/threed-embeddings');
