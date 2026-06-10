/**
 * 3D Embeddings Panel
 *
 * Renders a plotly scatter3d plot of 3D brain visualization results with
 * click + custom lasso selection (scatter3d has no native selection support).
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { registerComponent, PluginComponentType } from '@fiftyone/plugins';
import { Selector, useTheme } from '@fiftyone/components';
import * as fos from '@fiftyone/state';
import { useRecoilValue } from 'recoil';
import Plot from 'react-plotly.js';
import { useBrainResultsSelector } from './useBrainResult';
import { useLabelSelector } from './useLabelSelector';
import { usePlotSelection } from './usePlotSelection';
import { usePlot } from './usePlot';
import LassoOverlay from './LassoOverlay';
import { selectIdsInLasso, Point2D } from './lasso';
import { dimToward, numericToColors } from './colors';
import { log } from './logger';
import './Operator';

const SELECTED_COLOR = '#ff9800';

const Value = React.memo<{ value: string; className?: string }>(
  ({ value }) => <>{value}</>
);

const centerMessage = (children: React.ReactNode, color: string) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      height: '100%',
      color,
      flexDirection: 'column',
      gap: '1rem',
      padding: '2rem',
      textAlign: 'center',
    }}
  >
    {children}
  </div>
);

const ThreeDEmbeddingsPanel = () => {
  const theme = useTheme();
  const plotRef = useRef<any>(null);
  const brainResultSelector = useBrainResultsSelector();
  const labelSelector = useLabelSelector();
  const plotSelection = usePlotSelection();
  const { plotData, plotError } = usePlot();
  const selectedSamples = useRecoilValue(fos.selectedSamples) as Set<string>;
  const [lassoActive, setLassoActive] = useState(false);
  // Bumping this value resets the camera to the layout default (uirevision).
  // Must be truthy: plotly treats a falsy uirevision as "no revision" and
  // resets the camera on every data update.
  const [cameraRev, setCameraRev] = useState(1);

  const selectorStyle = useMemo(
    () => ({
      background: theme.neutral.softBg,
      borderTopLeftRadius: 3,
      borderTopRightRadius: 3,
      padding: '0.25rem',
    }),
    [theme.neutral.softBg]
  );

  const buttonStyle = useCallback(
    (active = false) => ({
      padding: '6px 12px',
      backgroundColor: active ? theme.primary.plainColor : 'transparent',
      border: `1px solid ${theme.primary.plainBorder}`,
      borderRadius: '4px',
      cursor: 'pointer',
      color: active ? theme.background.level1 : theme.text.secondary,
      fontSize: '13px',
    }),
    [theme]
  );

  const plotTraces = useMemo(() => {
    if (!plotData) return [];

    const t0 = performance.now();
    const resolvedSelection = plotSelection.resolvedSelection;

    // scatter3d does not support selectedpoints/selected/unselected, so
    // dimming is done with explicit per-point colors and sizes.
    //
    // IMPORTANT: the marker config must keep the same shape (color-string
    // array + size array) whether or not a selection exists. Switching
    // between numeric colorscale mode and color-array mode makes
    // gl-scatter3d re-render every point with subtly different
    // sizing/shading, which is visually jarring. Selection therefore only
    // changes the *values* of dimmed points: selected points keep their
    // exact base color, unselected points blend toward the background
    // (solid colors, since translucent scatter3d markers render with
    // blending artifacts).
    const baseColors =
      plotData.color_scheme === 'continuous'
        ? numericToColors(plotData.colors as number[])
        : (plotData.colors as string[]);

    // NB: scatter3d halves array sizes relative to scalar sizes (array
    // values go through bubble-chart diameter scaling in
    // scatter3d/convert.js), so these are 2x the intended scalar size
    const BASE_SIZE = 8;
    const DIMMED_SIZE = 6;
    const CHECKED_SIZE = 12;

    let colors: string[];
    let sizes: number[];

    if (!resolvedSelection) {
      colors = baseColors;
      sizes = new Array(plotData.x.length).fill(BASE_SIZE);
    } else {
      const selectionSet = new Set(resolvedSelection);
      const background = theme.background.level1;

      colors = [];
      sizes = [];
      plotData.sample_ids.forEach((id, i) => {
        if (selectedSamples.has(id)) {
          colors.push(SELECTED_COLOR);
          sizes.push(CHECKED_SIZE);
        } else if (selectionSet.has(id)) {
          colors.push(baseColors[i]);
          sizes.push(BASE_SIZE);
        } else {
          colors.push(dimToward(baseColors[i], background, 0.8));
          sizes.push(DIMMED_SIZE);
        }
      });
    }

    const marker = { color: colors, size: sizes, opacity: 0.85 };

    // Each recompute makes plotly rebuild the WebGL scene, so this should
    // only fire when data or selection actually changes
    log(
      `plotTraces rebuilt: ${plotData.x.length} pts,`,
      `selection=${resolvedSelection?.length ?? 'none'},`,
      `checked=${selectedSamples.size},`,
      `${(performance.now() - t0).toFixed(1)}ms`
    );

    return [
      {
        type: 'scatter3d',
        mode: 'markers',
        x: plotData.x,
        y: plotData.y,
        z: plotData.z,
        text: plotData.labels,
        marker,
        hovertemplate:
          '<b>%{text}</b><br>x: %{x:.3f}<br>y: %{y:.3f}<br>z: %{z:.3f}<extra></extra>',
        showlegend: false,
      },
    ];
  }, [
    plotData,
    plotSelection.resolvedSelection,
    selectedSamples,
    theme.background.level1,
  ]);

  // plotly gl3d emits plotly_click from its render loop whenever a mouse
  // button is held over a point — NOT once per DOM click. Since our click
  // handler triggers a re-render, naively handling every event creates an
  // infinite click->render->click feedback loop that freezes the app. The
  // gate below arms on pointerdown, disarms on drag, and is consumed by
  // the first click event, so exactly one click per real gesture is
  // honored.
  const clickGateRef = useRef(0);
  const pointerDownRef = useRef<{ x: number; y: number } | null>(null);

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    pointerDownRef.current = { x: e.clientX, y: e.clientY };
    clickGateRef.current = performance.now();
  }, []);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    const down = pointerDownRef.current;
    if (
      down &&
      Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5
    ) {
      // It's a drag (camera rotation), not a click
      clickGateRef.current = 0;
    }
  }, []);

  const handleClick = useCallback(
    (event: any) => {
      if (lassoActive || !event?.points?.length || !plotData) return;

      const gate = clickGateRef.current;
      if (!gate || performance.now() - gate > 500) return;
      clickGateRef.current = 0; // consume: one click per gesture

      const sampleId = plotData.sample_ids[event.points[0].pointNumber];
      log('point clicked:', sampleId);
      plotSelection.handleSelected([sampleId]);
    },
    [lassoActive, plotData, plotSelection]
  );

  const handleLassoComplete = useCallback(
    (polygon: Point2D[]) => {
      setLassoActive(false);
      const gd = plotRef.current?.el;
      if (!gd || !plotData) return;

      const t0 = performance.now();
      const ids = selectIdsInLasso(gd, plotData, polygon);
      log(
        `lasso complete: polygon=${polygon.length} vertices,`,
        `matched=${ids.length}/${plotData.sample_ids.length} pts,`,
        `${(performance.now() - t0).toFixed(1)}ms`
      );
      plotSelection.handleSelected(ids);
    },
    [plotData, plotSelection]
  );

  const handleLassoCancel = useCallback(() => setLassoActive(false), []);

  const plotLayout = useMemo(
    () => ({
      autosize: true,
      uirevision: cameraRev,
      margin: { l: 0, r: 0, t: 0, b: 0 },
      scene: {
        dragmode: 'turntable',
        xaxis: { title: 'Component 1', gridcolor: theme.primary.plainBorder },
        yaxis: { title: 'Component 2', gridcolor: theme.primary.plainBorder },
        zaxis: { title: 'Component 3', gridcolor: theme.primary.plainBorder },
        camera: { eye: { x: 1.5, y: 1.5, z: 1.5 } },
        bgcolor: theme.background.level1,
      },
      hovermode: 'closest',
      paper_bgcolor: theme.background.level1,
      plot_bgcolor: theme.background.level1,
    }),
    [cameraRev, theme.primary.plainBorder, theme.background.level1]
  );

  const plotConfig = useMemo(
    () => ({
      displayModeBar: true,
      displaylogo: false,
      modeBarButtonsToRemove: ['toImage'],
      responsive: true,
    }),
    []
  );

  const plotStyle = useMemo(() => ({ width: '100%', height: '100%' }), []);

  if (!brainResultSelector.canSelect) {
    return centerMessage(
      <>
        <div style={{ fontSize: '1.1rem', fontWeight: 500 }}>
          No 3D visualizations found
        </div>
        <div style={{ fontSize: '0.9rem', maxWidth: '400px' }}>
          Compute 3D embeddings using{' '}
          <code>fob.compute_visualization(dataset, num_dims=3)</code>
        </div>
      </>,
      theme.text.secondary
    );
  }

  const isLoading =
    brainResultSelector.hasSelection && !plotData && !plotError;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: theme.background.level1,
      }}
    >
      {/* Control Bar */}
      <div
        style={{
          padding: '0.5rem',
          borderBottom: `1px solid ${theme.primary.plainBorder}`,
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          flexWrap: 'wrap',
          background: theme.background.level2,
        }}
      >
        <Selector
          cy="3d-embeddings-brain-key"
          {...brainResultSelector.handlers}
          placeholder="Select brain key"
          overflow={true}
          component={Value}
          resultsPlacement="bottom-start"
          containerStyle={selectorStyle}
        />

        {brainResultSelector.hasSelection && (
          <Selector
            cy="3d-embeddings-colorby"
            {...labelSelector.handlers}
            placeholder="Color by"
            overflow={true}
            component={Value}
            resultsPlacement="bottom-start"
            containerStyle={selectorStyle}
          />
        )}

        {plotData && (
          <>
            <button
              onClick={() => setLassoActive((active) => !active)}
              style={buttonStyle(lassoActive)}
              title="Draw a lasso around points to select them (Esc to cancel)"
            >
              Lasso
            </button>

            <button
              onClick={() => setCameraRev((rev) => rev + 1)}
              style={buttonStyle()}
              title="Reset camera view"
            >
              Reset View
            </button>
          </>
        )}

        {plotSelection.hasSelection && (
          <button
            onClick={plotSelection.clearSelection}
            style={buttonStyle()}
            title="Clear selection"
          >
            Clear Selection
          </button>
        )}

        {plotSelection.hasSelection && (
          <span
            style={{
              color: theme.primary.plainColor,
              fontWeight: 500,
              fontSize: '13px',
            }}
          >
            {`${plotSelection.selectionStyle === 'plot' ? 'In view' : 'Selected'}: ${
              plotSelection.resolvedSelection?.length || 0
            }`}
          </span>
        )}

        {plotData && (
          <span
            style={{
              marginLeft: 'auto',
              color: theme.text.secondary,
              fontSize: '13px',
            }}
          >
            Points: {plotData.x.length.toLocaleString()}
          </span>
        )}
      </div>

      {/* Plot Area */}
      <div
        style={{ flex: 1, position: 'relative', minHeight: 0 }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
      >
        {plotError &&
          centerMessage(
            <>
              <div style={{ color: theme.error.plainColor }}>
                Error loading visualization
              </div>
              <div style={{ fontSize: '0.9rem' }}>{plotError}</div>
            </>,
            theme.text.secondary
          )}

        {!plotError &&
          !brainResultSelector.hasSelection &&
          centerMessage(
            <>
              <div style={{ fontSize: '1rem' }}>
                Select the Brain Key with your 3D Visualization
              </div>
              <div style={{ fontSize: '0.85rem', opacity: 0.7 }}>
                Use the dropdown above to choose a visualization to display
              </div>
            </>,
            theme.text.secondary
          )}

        {isLoading &&
          centerMessage(<div>Loading visualization...</div>, theme.text.secondary)}

        {!plotError && plotData && (
          <>
            <Plot
              ref={plotRef}
              data={plotTraces as any}
              layout={plotLayout as any}
              config={plotConfig}
              style={plotStyle}
              onClick={handleClick}
              useResizeHandler={true}
            />
            {lassoActive && (
              <LassoOverlay
                onComplete={handleLassoComplete}
                onCancel={handleLassoCancel}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
};

registerComponent({
  name: 'ThreeDEmbeddingsPanel',
  label: '3D Embeddings',
  component: ThreeDEmbeddingsPanel,
  type: PluginComponentType.Panel,
  activator: () => true,
});

export default ThreeDEmbeddingsPanel;
