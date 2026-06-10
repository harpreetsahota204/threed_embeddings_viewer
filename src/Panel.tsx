/**
 * 3D Embeddings Panel
 *
 * Renders a plotly scatter3d plot of 3D brain visualization results with
 * click + custom lasso selection (scatter3d has no native selection
 * support). Styled to match the built-in 2D Embeddings panel: floating
 * controls over a clean, axis-less plot.
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
import { useDebugLogging } from './useDebugLogging';
import LassoOverlay from './LassoOverlay';
import TabIndicator from './TabIndicator';
import { selectIdsInLasso, projectPointToClient, Point2D } from './lasso';
import {
  dimToward,
  numericToColors,
  VIRIDIS_CSS_GRADIENT,
} from './colors';
import { log } from './logger';
import './Operator';

const SELECTED_COLOR = '#ff9800';
const DEFAULT_CAMERA = { eye: { x: 1.5, y: 1.5, z: 1.5 } };

// Module-level so the camera survives panel remounts (applying a lasso
// selection changes the view, which reloads the page query and remounts
// the panel subtree)
let savedCamera: any = null;

const HIDDEN_AXIS = {
  visible: false,
  showgrid: false,
  zeroline: false,
  showbackground: false,
};

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
  useDebugLogging();
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

  // Matches the 2D embeddings panel "PlotOption" button styling
  const plotOptionStyle = useCallback(
    (active = false) => ({
      display: 'flex',
      alignItems: 'center',
      cursor: 'pointer',
      color: active ? theme.background.level1 : theme.primary.plainColor,
      background: active ? theme.primary.plainColor : theme.neutral.softBg,
      border: 'none',
      borderBottom: `1px solid ${theme.primary.plainColor}`,
      borderTopLeftRadius: 3,
      borderTopRightRadius: 3,
      padding: '0.25rem 0.5rem',
      fontSize: '14px',
      fontFamily: 'inherit',
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
    const HALO_SCALE = 2.4;

    let colors: string[];
    let sizes: number[];

    // Soft "glow" behind selected points: a second trace at the same
    // coordinates with larger, translucent markers, drawn under the
    // main trace. Always present (possibly empty) so the trace count
    // never changes across selections.
    const halo = {
      x: [] as number[],
      y: [] as number[],
      z: [] as number[],
      colors: [] as string[],
      sizes: [] as number[],
    };
    const addHalo = (i: number, color: string, size: number) => {
      halo.x.push(plotData.x[i]);
      halo.y.push(plotData.y[i]);
      halo.z.push(plotData.z[i]);
      halo.colors.push(color);
      halo.sizes.push(size * HALO_SCALE);
    };

    if (!resolvedSelection) {
      colors = baseColors;
      sizes = new Array(plotData.x.length).fill(BASE_SIZE);
    } else {
      const selectionSet = new Set(resolvedSelection);
      // The visible plot background is the spaces panel background
      const background =
        theme.background.mediaSpace || theme.background.level2;

      colors = [];
      sizes = [];
      plotData.sample_ids.forEach((id, i) => {
        if (selectedSamples.has(id)) {
          colors.push(SELECTED_COLOR);
          sizes.push(CHECKED_SIZE);
          addHalo(i, SELECTED_COLOR, CHECKED_SIZE);
        } else if (selectionSet.has(id)) {
          colors.push(baseColors[i]);
          sizes.push(BASE_SIZE);
          addHalo(i, baseColors[i], BASE_SIZE);
        } else {
          colors.push(dimToward(baseColors[i], background, 0.8));
          sizes.push(DIMMED_SIZE);
        }
      });
    }

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
        x: halo.x,
        y: halo.y,
        z: halo.z,
        marker: { color: halo.colors, size: halo.sizes, opacity: 0.25 },
        hoverinfo: 'skip',
        showlegend: false,
      },
      {
        type: 'scatter3d',
        mode: 'markers',
        x: plotData.x,
        y: plotData.y,
        z: plotData.z,
        text: plotData.labels,
        marker: { color: colors, size: sizes, opacity: 0.85 },
        hovertemplate:
          '<b>%{text}</b><br>x: %{x:.3f}<br>y: %{y:.3f}<br>z: %{z:.3f}<extra></extra>',
        showlegend: false,
      },
    ];
  }, [
    plotData,
    plotSelection.resolvedSelection,
    selectedSamples,
    theme.background.mediaSpace,
    theme.background.level2,
  ]);

  const plotLayout = useMemo(
    () => ({
      autosize: true,
      uirevision: cameraRev,
      margin: { l: 0, r: 0, t: 0, b: 0 },
      font: { family: 'var(--fo-fontFamily-body)', size: 14 },
      scene: {
        dragmode: 'orbit',
        xaxis: HIDDEN_AXIS,
        yaxis: HIDDEN_AXIS,
        zaxis: HIDDEN_AXIS,
        camera: savedCamera || DEFAULT_CAMERA,
        bgcolor: 'rgba(0,0,0,0)',
      },
      hovermode: 'closest',
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
    }),
    [cameraRev]
  );

  // Plotly only writes the live camera back into the layout on a clean
  // canvas mouseup/wheel, so a zoom/rotate that ends off-canvas would be
  // lost on the next trace rebuild (the view "resets"). Snapshot the live
  // camera from the scene right before any selection-triggered rebuild,
  // and keep both the module copy (for remounts) and plotly's layout
  // object (for in-place rebuilds) in sync.
  const captureCamera = useCallback(() => {
    const camera =
      plotRef.current?.el?._fullLayout?.scene?._scene?.getCamera?.();
    if (camera) {
      savedCamera = camera;
      plotLayout.scene.camera = camera;
    }
  }, [plotLayout]);

  const handleRelayout = useCallback(
    (event: any) => {
      const camera = event?.['scene.camera'];
      if (camera) {
        savedCamera = camera;
        plotLayout.scene.camera = camera;
      }
    },
    [plotLayout]
  );

  const handleResetView = useCallback(() => {
    savedCamera = null;
    setCameraRev((rev) => rev + 1);
  }, []);

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
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) {
      // It's a drag (camera rotation), not a click
      clickGateRef.current = 0;
    }
  }, []);

  const handleClick = useCallback(
    (event: any) => {
      if (lassoActive || !plotData) return;

      // The halo trace has hoverinfo skip; only the main trace (index 1)
      // produces points
      const point = event?.points?.find((p: any) => p.curveNumber === 1);
      if (!point) return;

      const gate = clickGateRef.current;
      if (!gate || performance.now() - gate > 500) return;
      clickGateRef.current = 0; // consume: one click per gesture

      const sampleId = plotData.sample_ids[point.pointNumber];
      log('point clicked:', sampleId);
      captureCamera();
      plotSelection.handleSelected([sampleId]);
    },
    [lassoActive, plotData, plotSelection, captureCamera]
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
      captureCamera();
      plotSelection.handleSelected(ids);
    },
    [plotData, plotSelection, captureCamera]
  );

  const handleLassoCancel = useCallback(() => setLassoActive(false), []);

  // Thumbnail preview of the hovered sample, positioned next to the
  // projected point in viewport coordinates
  const [hoverPreview, setHoverPreview] = useState<{
    index: number;
    x: number;
    y: number;
  } | null>(null);

  const handleHover = useCallback(
    (event: any) => {
      if (lassoActive || !plotData?.filepaths) return;

      const point = event?.points?.find((p: any) => p.curveNumber === 1);
      if (!point) return;

      const i = point.pointNumber;
      const pos = projectPointToClient(
        plotRef.current?.el,
        plotData.x[i],
        plotData.y[i],
        plotData.z[i]
      );
      if (pos) {
        setHoverPreview((prev) =>
          prev?.index === i ? prev : { index: i, x: pos.x, y: pos.y }
        );
      }
    },
    [lassoActive, plotData]
  );

  const handleUnhover = useCallback(() => setHoverPreview(null), []);

  const hoverSrc = useMemo(() => {
    if (hoverPreview === null || !plotData?.filepaths) return null;
    const filepath = plotData.filepaths[hoverPreview.index];
    return filepath ? (fos.getSampleSrc(filepath) as string) : null;
  }, [hoverPreview, plotData]);

  // Min/max labels for the continuous colorscale legend
  const colorRange = useMemo(() => {
    if (plotData?.color_scheme !== 'continuous') return null;
    const values = plotData.colors as number[];
    return { min: Math.min(...values), max: Math.max(...values) };
  }, [plotData]);

  const plotConfig = useMemo(
    () => ({
      displayModeBar: false,
      displaylogo: false,
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

  const isLoading = brainResultSelector.hasSelection && !plotData && !plotError;

  return (
    <div
      style={{
        position: 'relative',
        height: '100%',
        width: '100%',
        // No background: inherit the spaces panel background, exactly
        // like the 2D embeddings panel
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
    >
      {/* Floating controls, styled like the 2D embeddings panel */}
      <div
        style={{
          position: 'absolute',
          top: '1rem',
          left: 0,
          width: '100%',
          zIndex: 20,
          display: 'flex',
          justifyContent: 'space-between',
          columnGap: '1rem',
          padding: '0 1rem',
          pointerEvents: 'none',
        }}
      >
        <div
          style={{ display: 'flex', columnGap: '1rem', pointerEvents: 'all' }}
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
                style={plotOptionStyle(lassoActive)}
                title="Draw a lasso around points to select them (Esc to cancel)"
              >
                Lasso
              </button>

              <button
                onClick={handleResetView}
                style={plotOptionStyle()}
                title="Reset camera view"
              >
                Reset View
              </button>
            </>
          )}
        </div>

        {plotData && (
          <div
            style={{
              color: theme.text.secondary,
              fontSize: '13px',
              pointerEvents: 'none',
              alignSelf: 'center',
            }}
          >
            Points: {plotData.x.length.toLocaleString()}
          </div>
        )}
      </div>

      {/* Plot area */}
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
            onRelayout={handleRelayout}
            onHover={handleHover}
            onUnhover={handleUnhover}
            useResizeHandler={true}
          />
          {lassoActive && (
            <LassoOverlay
              onComplete={handleLassoComplete}
              onCancel={handleLassoCancel}
            />
          )}

          {/* Hovered sample thumbnail */}
          {hoverSrc && hoverPreview && !lassoActive && (
            <img
              key={hoverSrc}
              src={hoverSrc}
              style={{
                position: 'fixed',
                left: hoverPreview.x + 16,
                top: hoverPreview.y + 16,
                width: 120,
                height: 120,
                objectFit: 'cover',
                borderRadius: 4,
                border: `1px solid ${theme.primary.plainBorder}`,
                background: theme.background.level2,
                zIndex: 1000,
                pointerEvents: 'none',
              }}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          )}

          {/* Colorscale legend for continuous color fields */}
          {colorRange && (
            <div
              style={{
                position: 'absolute',
                right: '1rem',
                top: '50%',
                transform: 'translateY(-50%)',
                zIndex: 10,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-end',
                gap: 4,
                pointerEvents: 'none',
                color: theme.text.secondary,
                fontSize: '11px',
              }}
            >
              {labelSelector.label && (
                <div style={{ marginBottom: 2 }}>{labelSelector.label}</div>
              )}
              <div style={{ display: 'flex', gap: 6, alignItems: 'stretch' }}>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    textAlign: 'right',
                  }}
                >
                  <span>{colorRange.max.toFixed(3)}</span>
                  <span>{colorRange.min.toFixed(3)}</span>
                </div>
                <div
                  style={{
                    width: 12,
                    height: 160,
                    borderRadius: 2,
                    background: VIRIDIS_CSS_GRADIENT,
                  }}
                />
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

registerComponent({
  name: 'ThreeDEmbeddingsPanel',
  label: '3D Embeddings',
  component: ThreeDEmbeddingsPanel,
  type: PluginComponentType.Panel,
  activator: () => true,
  panelOptions: {
    TabIndicator,
  },
});

export default ThreeDEmbeddingsPanel;
