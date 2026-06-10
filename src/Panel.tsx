/**
 * 3D Embeddings Panel
 *
 * Renders a plotly scatter3d plot of 3D brain visualization results with
 * click + custom lasso selection (scatter3d has no native selection
 * support). Styled to match the built-in 2D Embeddings panel: floating
 * controls over a clean, axis-less plot.
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { registerComponent, PluginComponentType } from '@fiftyone/plugins';
import { Selector, useTheme } from '@fiftyone/components';
import { useOperatorExecutor } from '@fiftyone/operators';
import { usePanelStatePartial } from '@fiftyone/spaces';
import * as fos from '@fiftyone/state';
import { useRecoilValue } from 'recoil';
import Plot from 'react-plotly.js';
import { useBrainResultsSelector } from './useBrainResult';
import { useLabelSelector } from './useLabelSelector';
import {
  useClearLassoSelection,
  usePlotSelection,
} from './usePlotSelection';
import { usePlot } from './usePlot';
import LassoOverlay from './LassoOverlay';
import TabIndicator from './TabIndicator';
import {
  pickNearestPoint,
  projectPointToClient,
  selectIdsInLasso,
  Point2D,
} from './lasso';
import {
  dimToward,
  minMax,
  numericToColors,
  VIRIDIS_CSS_GRADIENT,
} from './colors';
import { lassoSelectionAtom } from './State';
import { log } from './logger';
import './Operator';

const SELECTED_COLOR = '#ff9800';
const UNIFORM_COLOR = '#1f77b4';
const DEFAULT_CAMERA = { eye: { x: 1.5, y: 1.5, z: 1.5 } };

// Filepaths are looked up per hover (not shipped with the plot data, which
// does not scale); cached here so each sample is fetched at most once
const filepathCache = new Map<string, string | null>();

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
  const { plotData, plotColors, plotError } = usePlot();
  const selectedSamples = useRecoilValue(fos.selectedSamples) as Set<string>;
  const lassoSelection = useRecoilValue(lassoSelectionAtom);
  const clearSelection = useClearLassoSelection();

  // Explore mode (default): orbit/zoom/hover, grab cursor, clicks inert.
  // Select mode: pointer cursor, click toggles a point, drag lassos.
  // Double-click switches between the two. Stored in panel state (not
  // useState) so deferred page-query reloads, which remount the panel,
  // don't silently kick the user back to explore mode.
  const [selectMode, setSelectModeRaw] = usePanelStatePartial(
    'selectMode',
    false,
    true
  );
  const setSelectMode = useCallback(
    (active: boolean, source: string) => {
      log(`mode: ${active ? 'select' : 'explore'} (via ${source})`);
      setSelectModeRaw(active);
    },
    [setSelectModeRaw]
  );

  // Mount logging: panel remounts (page-query reloads) reset any
  // component-local state, so knowing when they happen is essential when
  // debugging the interaction model
  useEffect(() => {
    log('panel mounted');
    return () => log('panel unmounted');
  }, []);
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

  // Colors arrive separately from geometry; ignore them until they match
  // the current geometry (eg while recoloring after a brain key switch)
  const activeColors = useMemo(() => {
    if (!plotData || !plotColors) return null;
    return plotColors.colors.length === plotData.x.length ? plotColors : null;
  }, [plotData, plotColors]);

  const plotTraces = useMemo(() => {
    if (!plotData) return [];

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
    let baseColors: string[];
    if (!activeColors) {
      baseColors = new Array(plotData.x.length).fill(UNIFORM_COLOR);
    } else if (activeColors.color_scheme === 'continuous') {
      baseColors = numericToColors(activeColors.colors as number[]);
    } else {
      baseColors = activeColors.colors as string[];
    }


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
        marker: { color: colors, size: sizes, opacity: 0.85 },
        // Hover is rendered by our own card via pointer-move picking
        hoverinfo: 'skip',
        showlegend: false,
      },
    ];
  }, [
    plotData,
    activeColors,
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
      hovermode: false,
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

  // Hover card for the pointed-at sample, positioned next to the
  // projected point in viewport coordinates. Hover is implemented with
  // our own nearest-point picking on pointer move (NOT plotly's hover
  // events, which come from the gl3d render loop, miss unhovers, and
  // don't fire at all under the select-mode overlay) — so it works
  // identically in both modes.
  const [hoverPreview, setHoverPreview] = useState<{
    index: number;
    x: number;
    y: number;
  } | null>(null);
  const hoverPreviewRef = useRef<typeof hoverPreview>(null);
  const lastHoverPickRef = useRef(0);

  const clearHover = useCallback(() => {
    if (hoverPreviewRef.current !== null) {
      hoverPreviewRef.current = null;
      setHoverPreview(null);
    }
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      // No hover while a button is held (rotating or drawing a lasso)
      if (e.buttons !== 0) {
        clearHover();
        return;
      }

      // Throttle picking; it's O(points)
      const now = performance.now();
      if (now - lastHoverPickRef.current < 50) return;
      lastHoverPickRef.current = now;

      const gd = plotRef.current?.el;
      if (!gd || !plotData) return;

      const index = pickNearestPoint(
        gd,
        plotData,
        { x: e.clientX, y: e.clientY },
        16
      );
      if (index === null) {
        clearHover();
        return;
      }

      if (hoverPreviewRef.current?.index !== index) {
        const pos = projectPointToClient(
          gd,
          plotData.x[index],
          plotData.y[index],
          plotData.z[index]
        );
        if (pos) {
          const preview = { index, x: pos.x, y: pos.y };
          hoverPreviewRef.current = preview;
          setHoverPreview(preview);
        }
      }
    },
    [plotData, clearHover]
  );

  const handlePointerLeave = useCallback(() => clearHover(), [clearHover]);

  // Selection only happens in select mode, through the overlay: a drag
  // lassos a region (replacing the selection), a click toggles the nearest
  // point. Exploration (orbit/hover) can never select accidentally — and
  // since we never listen to plotly's click events, gl3d's synthetic
  // repeated clicks (emitted from its render loop while a button is held)
  // are a non-issue.
  const handleLassoComplete = useCallback(
    (polygon: Point2D[]) => {
      const gd = plotRef.current?.el;
      if (!gd || !plotData) return;

      const ids = selectIdsInLasso(gd, plotData, polygon);
      log(
        `select mode: lasso matched ${ids.length}/${plotData.sample_ids.length} points`
      );
      captureCamera();
      plotSelection.handleSelected(ids);
    },
    [plotData, plotSelection, captureCamera]
  );

  const handlePick = useCallback(
    (point: Point2D) => {
      const gd = plotRef.current?.el;
      if (!gd || !plotData) return;

      const index = pickNearestPoint(gd, plotData, point);
      if (index === null) {
        log('select mode: click on empty space (no point within radius)');
        return; // keep mode, change nothing
      }

      captureCamera();
      plotSelection.toggleSelected(plotData.sample_ids[index]);
    },
    [plotData, plotSelection, captureCamera]
  );

  const handleSelectModeExit = useCallback(
    () => setSelectMode(false, 'Esc/double-click'),
    [setSelectMode]
  );

  // Esc in explore mode clears the selection and grid filtering (the 2D
  // embeddings panel behavior). In select mode, Esc exits the mode first
  // (handled by the overlay); the next Esc then clears.
  useEffect(() => {
    if (selectMode) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && lassoSelection?.length) {
        log(`explore mode: Esc pressed, clearing selection (${lassoSelection.length} ids)`);
        clearSelection();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectMode, lassoSelection, clearSelection]);

  const handleExploreDoubleClick = useCallback(() => {
    if (!plotData) return;
    setSelectMode(true, 'double-click');
  }, [plotData, setSelectMode]);

  // Grab-hand cursor animates to "grabbing" while rotating the scene
  const [grabbing, setGrabbing] = useState(false);
  useEffect(() => {
    if (!grabbing) return;
    const onUp = () => setGrabbing(false);
    window.addEventListener('pointerup', onUp);
    return () => window.removeEventListener('pointerup', onUp);
  }, [grabbing]);

  const getCanvas = useCallback(
    () =>
      (plotRef.current?.el?._fullLayout?.scene?._scene?.glplot?.canvas ??
        null) as HTMLCanvasElement | null,
    []
  );

  // Resolve the hovered sample's filepath lazily (one tiny request per
  // first hover, cached afterwards)
  const [hoverSrc, setHoverSrc] = useState<string | null>(null);
  const getFilepathExecutor = useOperatorExecutor(
    '@harpreetsahota/threed-embeddings/get_sample_filepath'
  );

  useEffect(() => {
    if (hoverPreview === null || !plotData) {
      setHoverSrc(null);
      return;
    }

    const sampleId = plotData.sample_ids[hoverPreview.index];
    const toSrc = (filepath: string | null) =>
      filepath ? (fos.getSampleSrc(filepath) as string) : null;

    const cached = filepathCache.get(sampleId);
    if (cached !== undefined) {
      setHoverSrc(toSrc(cached));
      return;
    }

    setHoverSrc(null);
    let stale = false;
    getFilepathExecutor.execute(
      { sample_id: sampleId },
      {
        skipErrorNotification: true,
        callback: (result: any) => {
          const filepath = result?.result?.filepath ?? null;
          filepathCache.set(sampleId, filepath);
          if (!stale) {
            setHoverSrc(toSrc(filepath));
          }
        },
      }
    );
    return () => {
      stale = true;
    };
  }, [hoverPreview, plotData]);

  // Min/max labels for the continuous colorscale legend
  const colorRange = useMemo(() => {
    if (activeColors?.color_scheme !== 'continuous') return null;
    return minMax(activeColors.colors as number[]);
  }, [activeColors]);

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
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
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
                onClick={() => setSelectMode(!selectMode, 'button')}
                style={plotOptionStyle(selectMode)}
                title="Double-click the plot to switch modes. Select mode: click points to toggle them, drag to lasso a region (Esc to exit)"
              >
                {selectMode ? 'Selecting' : 'Select'}
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
          {/* Explore mode: grab cursor (grabbing while rotating);
              double-click enters select mode */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              cursor: grabbing ? 'grabbing' : 'grab',
            }}
            onDoubleClick={handleExploreDoubleClick}
            onPointerDown={() => setGrabbing(true)}
          >
            <Plot
              ref={plotRef}
              data={plotTraces as any}
              layout={plotLayout as any}
              config={plotConfig}
              style={plotStyle}
              onRelayout={handleRelayout}
              useResizeHandler={true}
            />
          </div>
          {selectMode && (
            <LassoOverlay
              onComplete={handleLassoComplete}
              onPick={handlePick}
              onToggleMode={handleSelectModeExit}
              onCancel={handleSelectModeExit}
              getCanvas={getCanvas}
            />
          )}

          {/* Hover card: thumbnail + color-by value + coordinates (works
              in both explore and select modes) */}
          {hoverPreview && (
            <div
              style={{
                position: 'fixed',
                left: hoverPreview.x + 16,
                top: hoverPreview.y + 16,
                width: 122,
                borderRadius: 4,
                border: `1px solid ${theme.primary.plainBorder}`,
                background: theme.background.level2,
                overflow: 'hidden',
                zIndex: 1000,
                pointerEvents: 'none',
              }}
            >
              {hoverSrc && (
                <img
                  key={hoverSrc}
                  src={hoverSrc}
                  style={{
                    width: 120,
                    height: 120,
                    objectFit: 'cover',
                    display: 'block',
                  }}
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display =
                      'none';
                  }}
                />
              )}
              <div style={{ padding: '4px 6px', fontSize: '11px' }}>
                <div
                  style={{
                    fontWeight: 600,
                    color: theme.text.primary,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {activeColors?.labels[hoverPreview.index] ??
                    plotData.sample_ids[hoverPreview.index].slice(0, 8)}
                </div>
                <div style={{ color: theme.text.secondary }}>
                  {plotData.x[hoverPreview.index].toFixed(3)},{' '}
                  {plotData.y[hoverPreview.index].toFixed(3)},{' '}
                  {plotData.z[hoverPreview.index].toFixed(3)}
                </div>
              </div>
            </div>
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
