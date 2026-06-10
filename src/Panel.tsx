/**
 * Embeddings Panel
 *
 * Renders brain visualization results of any dimensionality >= 2 in a
 * plotly scatter3d scene (2D embeddings as a flat plane viewed top-down)
 * with click + custom lasso selection (scatter3d has no native selection
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
import { useCheckedIndices } from './useCheckedIndices';
import { usePlot } from './usePlot';
import { logError } from './logger';
import LassoOverlay from './LassoOverlay';
import TabIndicator from './TabIndicator';
import EmbeddingsPanelIcon from './Icon';
import HoverCard from './HoverCard';
import { CategoricalLegend, ColorLegend, FloatingPanel } from './Legend';
import {
  getProjectionParams,
  pickNearestPoint,
  projectPointToClient,
  Point2D,
} from './lasso';
import { base64ToBytes } from './base64';
import { testBit } from './bitmask';
import { dimToward, minMax, numericToColors } from './colors';
import { lassoSelectionAtom, PlotCategory } from './State';
import {
  getDefaultAspectratio,
  getSavedAspectratio,
  getSavedCamera,
  recordDefaultAspectratio,
  setSavedAspectratio,
  setSavedCamera,
  resetSavedCamera,
} from './cameraStore';
import { Aspectratio, useCursorZoom } from './useCursorZoom';
import './Operator';

const SELECTED_COLOR = '#ff9800';
const UNIFORM_COLOR = '#1f77b4';
const DEFAULT_CAMERA = { eye: { x: 1.5, y: 1.5, z: 1.5 } };
// 2D embeddings: top-down orthographic view renders like a true 2D plot
const DEFAULT_CAMERA_2D = {
  eye: { x: 0, y: 0, z: 2 },
  up: { x: 0, y: 1, z: 0 },
  projection: { type: 'orthographic' },
};

// Sample id, filepath, and hover lines are looked up per hover by point
// index (not shipped with plot/colors data); cached per
// dataset::brainKey::colorBy::index.
interface SampleInfo {
  sampleId: string | null;
  filepath: string | null;
  hoverLines: string[] | null;
}
const sampleInfoCache = new Map<string, SampleInfo>();

// plotly hardcodes the gl3d camera distance limits to [0.01, 100]
// (gl3d/scene.js) — only ~250x zoom-in from the default camera. These
// extend the range to "effectively infinite": the floor is set by
// float32 GPU coordinates, which start to jitter below ~1e-4 of the
// scene size anyway.
const ZOOM_DISTANCE_LIMITS = [1e-5, 1000];

const HIDDEN_AXIS = {
  visible: false,
  showgrid: false,
  zeroline: false,
  showbackground: false,
};

const Value = React.memo<{ value: string }>(({ value }) => <>{value}</>);

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
  const { plotData, plotColors, plotError, plotProgress } = usePlot();
  const datasetName = useRecoilValue(fos.datasetName) as string;
  const lassoSelection = useRecoilValue(lassoSelectionAtom);
  const clearSelection = useClearLassoSelection();
  // Grid-checked samples resolved to point indices (ids never live here)
  const checkedIndices = useCheckedIndices(plotData);

  // Explore mode (default): orbit/zoom/hover, grab cursor, clicks inert.
  // Select mode: pointer cursor, click toggles a point, drag lassos.
  // Double-click switches between the two. Stored in panel state (not
  // useState) so deferred page-query reloads, which remount the panel,
  // don't silently kick the user back to explore mode.
  const [selectMode, setSelectMode] = usePanelStatePartial(
    'selectMode',
    false,
    true
  );
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
  // the current geometry (eg while recoloring after a brain key switch,
  // or while geometry chunks are still streaming in)
  const activeColors = useMemo(() => {
    if (!plotData || !plotColors) return null;
    return plotColors.count === plotData.count ? plotColors : null;
  }, [plotData, plotColors]);

  // Legend click-to-highlight: class labels whose points stay bright while
  // everything else dims. Panel state so it survives remounts.
  const [highlightedClasses, setHighlightedClasses] = usePanelStatePartial(
    'highlightedClasses',
    [],
    true
  );

  // In-view bitmask for the current filtered view (set by
  // useSelectionEffect); base64, in brain-result index order. Drives
  // out-of-view dimming and view-aware legend counts.
  const [viewBitmaskB64] = usePanelStatePartial('viewBitmask', null, true);

  const viewBitmask = useMemo(() => {
    if (!viewBitmaskB64 || !plotData) return null;
    const bits = base64ToBytes(viewBitmaskB64);
    // Guard against a stale bitmask from previous geometry (eg right
    // after a brain key switch or while chunks are still streaming)
    return bits.length === Math.ceil(plotData.count / 8) ? bits : null;
  }, [viewBitmaskB64, plotData]);

  // Per-category counts within the current view (presence semantics);
  // null when unfiltered
  const viewCounts = useMemo(() => {
    if (
      !plotData ||
      !activeColors?.categories ||
      !activeColors.class_members ||
      !viewBitmask
    ) {
      return null;
    }

    const counts = new Array(activeColors.categories.length).fill(0);
    for (let i = 0; i < plotData.count; i++) {
      if (testBit(viewBitmask, i)) {
        for (const classIndex of activeColors.class_members[i]) {
          counts[classIndex]++;
        }
      }
    }
    return counts;
  }, [plotData, activeColors, viewBitmask]);

  // Drop highlights for classes that no longer exist (color-by changed)
  useEffect(() => {
    if (!highlightedClasses?.length) return;
    const known = new Set(
      (activeColors?.categories ?? []).map((c: PlotCategory) => c.label)
    );
    const pruned = highlightedClasses.filter((label: string) =>
      known.has(label)
    );
    if (pruned.length !== highlightedClasses.length) {
      setHighlightedClasses(pruned);
    }
  }, [activeColors, highlightedClasses]);

  const toggleHighlightedClass = useCallback(
    (label: string) => {
      setHighlightedClasses((current: string[] = []) =>
        current.includes(label)
          ? current.filter((l) => l !== label)
          : [...current, label]
      );
    },
    [setHighlightedClasses]
  );

  // Base (unselected, undimmed) per-point colors. Memoized separately
  // from plotTraces so that selections/dimming changes don't recompute
  // the colorscale mapping over every point.
  const baseColors = useMemo(() => {
    if (!plotData) return null;
    if (!activeColors) {
      return new Array(plotData.count).fill(UNIFORM_COLOR) as string[];
    }
    if (activeColors.color_scheme === 'continuous') {
      return numericToColors(activeColors.colors!);
    }
    const categories = activeColors.categories!;
    const indices = activeColors.class_indices!;
    const out = new Array<string>(plotData.count);
    for (let i = 0; i < plotData.count; i++) {
      out[i] = categories[indices[i]].color;
    }
    return out;
  }, [plotData, activeColors]);

  const plotTraces = useMemo(() => {
    if (!plotData || !baseColors) return [];

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
    //
    // All tiers are index-based (no ids client-side). Bright/dim
    // priority: checked samples > lasso selection > view-filter bitmask;
    // class highlight applies only when none of those are active.
    const selectionIndices = plotSelection.selectionIndices;
    const inSelection: ((i: number) => boolean) | null = checkedIndices
      ? (i) => checkedIndices.has(i)
      : selectionIndices
      ? (i) => selectionIndices.has(i)
      : viewBitmask
      ? (i) => testBit(viewBitmask, i)
      : null;

    // Class highlight (legend clicks): applies only when no sample
    // selection/filter is active — any selection tier beats it. Presence
    // semantics: a point is highlighted if it CONTAINS a highlighted class
    const highlightedIndexSet =
      !inSelection &&
      activeColors?.class_members &&
      highlightedClasses?.length
        ? new Set(
            activeColors
              .categories!.map((c, i) =>
                highlightedClasses.includes(c.label) ? i : -1
              )
              .filter((i) => i >= 0)
          )
        : null;

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

    // The visible plot background is the spaces panel background
    const background = theme.background.mediaSpace || theme.background.level2;

    if (highlightedIndexSet) {
      colors = [];
      sizes = [];
      activeColors!.class_members!.forEach((memberIndices, i) => {
        if (memberIndices.some((ci) => highlightedIndexSet.has(ci))) {
          colors.push(baseColors[i]);
          sizes.push(BASE_SIZE);
          addHalo(i, baseColors[i], BASE_SIZE);
        } else {
          colors.push(dimToward(baseColors[i], background, 0.8));
          sizes.push(DIMMED_SIZE);
        }
      });
    } else if (!inSelection) {
      colors = baseColors;
      sizes = new Array(plotData.count).fill(BASE_SIZE);
    } else {
      colors = [];
      sizes = [];
      for (let i = 0; i < plotData.count; i++) {
        if (checkedIndices?.has(i)) {
          colors.push(SELECTED_COLOR);
          sizes.push(CHECKED_SIZE);
          addHalo(i, SELECTED_COLOR, CHECKED_SIZE);
        } else if (inSelection(i)) {
          colors.push(baseColors[i]);
          sizes.push(BASE_SIZE);
          addHalo(i, baseColors[i], BASE_SIZE);
        } else {
          colors.push(dimToward(baseColors[i], background, 0.8));
          sizes.push(DIMMED_SIZE);
        }
      }
    }

    // Array marker sizes make plotly treat the trace as a bubble chart,
    // whose marker.line defaults to width 1 in WHITE (Color.background);
    // disable the outline explicitly. Hover is skipped because it is
    // rendered by our own card via pointer-move picking.
    const markerTrace = (
      x: ArrayLike<number>,
      y: ArrayLike<number>,
      z: ArrayLike<number>,
      color: string[],
      size: number[],
      opacity: number
    ) => ({
      type: 'scatter3d',
      mode: 'markers',
      x,
      y,
      z,
      marker: { color, size, opacity, line: { width: 0 } },
      hoverinfo: 'skip',
      showlegend: false,
    });

    // Halo first so it renders beneath the main trace
    return [
      markerTrace(halo.x, halo.y, halo.z, halo.colors, halo.sizes, 0.25),
      markerTrace(plotData.x, plotData.y, plotData.z, colors, sizes, 0.85),
    ];
  }, [
    plotData,
    baseColors,
    activeColors,
    viewBitmask,
    highlightedClasses,
    plotSelection.selectionIndices,
    checkedIndices,
    theme.background.mediaSpace,
    theme.background.level2,
  ]);

  const is2D = plotData?.num_dims === 2;

  const plotLayout = useMemo(() => {
    const savedAspect = getSavedAspectratio();
    return {
      autosize: true,
      uirevision: cameraRev,
      margin: { l: 0, r: 0, t: 0, b: 0 },
      font: { family: 'var(--fo-fontFamily-body)', size: 14 },
      scene: {
        dragmode: 'orbit',
        xaxis: HIDDEN_AXIS,
        yaxis: HIDDEN_AXIS,
        zaxis: HIDDEN_AXIS,
        camera:
          getSavedCamera() || (is2D ? DEFAULT_CAMERA_2D : DEFAULT_CAMERA),
        bgcolor: 'rgba(0,0,0,0)',
        // Ortho (2D) zoom lives in the aspectratio; restore it across
        // rebuilds/remounts just like the camera
        ...(savedAspect
          ? { aspectmode: 'manual', aspectratio: savedAspect }
          : {}),
      } as any,
      hovermode: false,
      paper_bgcolor: 'rgba(0,0,0,0)',
      plot_bgcolor: 'rgba(0,0,0,0)',
    };
  }, [cameraRev, is2D]);

  const getScene = useCallback(
    () => plotRef.current?.el?._fullLayout?.scene?._scene,
    []
  );

  // Plotly only writes the live camera back into the layout on a clean
  // canvas mouseup/wheel, so a zoom/rotate that ends off-canvas would be
  // lost on the next trace rebuild (the view "resets"). Snapshot the live
  // camera from the scene right before any selection-triggered rebuild,
  // and keep the module copy (for remounts), plotly's layout object (for
  // in-place rebuilds), AND plotly's fullLayout record in sync — the
  // last one is what plotly diffs against when deciding whether a layout
  // camera change needs applying, and programmatic camera moves (cursor
  // zoom) never update it on their own.
  const captureCamera = useCallback(() => {
    const camera = getScene()?.getCamera?.();
    if (camera) {
      setSavedCamera(camera);
      plotLayout.scene.camera = camera;
      const fullLayout = plotRef.current?.el?._fullLayout;
      if (fullLayout?.scene) {
        fullLayout.scene.camera = camera;
      }
    }
  }, [plotLayout, getScene]);

  // "Infinizoom": widen plotly's hardcoded camera distance limits, and
  // keep the near/far clip planes tracking the zoom level — zNear must
  // shrink as the camera closes in (or nearby points clip away right
  // when you zoom toward them), but a permanently tiny zNear destroys
  // depth-buffer precision at normal zoom, so it scales with distance.
  const applyZoomLimits = useCallback(() => {
    const scene = getScene();
    const view = scene?.camera?.view;
    if (view?.setDistanceLimits) {
      view.setDistanceLimits(
        ZOOM_DISTANCE_LIMITS[0],
        ZOOM_DISTANCE_LIMITS[1]
      );
    }

    const glplot = scene?.glplot;
    const camera = scene?.getCamera?.();
    if (glplot && camera) {
      const distance = Math.hypot(
        camera.eye.x - camera.center.x,
        camera.eye.y - camera.center.y,
        camera.eye.z - camera.center.z
      );
      glplot.zNear = Math.min(0.01, Math.max(distance * 0.01, 1e-7));
      glplot.zFar = Math.max(1000, distance * 4);
    }
  }, [getScene]);

  // The scene is recreated on every panel remount/brain-key switch;
  // re-apply the limits once it exists, and snapshot the pristine
  // aspectratio (Reset View restores it after ortho zooming — but only
  // when the scene was created WITHOUT a restored zoom)
  useEffect(() => {
    if (!plotData) return;
    let cancelled = false;
    const tryApply = () => {
      if (cancelled) return;
      const scene = getScene();
      if (scene?.camera) {
        applyZoomLimits();
        const aspect = scene.glplot?.getAspectratio?.();
        if (aspect && !getSavedAspectratio()) {
          recordDefaultAspectratio(aspect);
        }
      } else {
        requestAnimationFrame(tryApply);
      }
    };
    tryApply();
    return () => {
      cancelled = true;
    };
  }, [plotData, applyZoomLimits, getScene]);

  const handleRelayout = useCallback(
    (event: any) => {
      const camera = event?.['scene.camera'];
      if (camera) {
        setSavedCamera(camera);
        plotLayout.scene.camera = camera;
      }

      // plotly's relayout tracking records scene.aspectratio as a "GUI
      // edit" once our ortho cursor-zoom has changed it, but the
      // uirevision code doesn't recognize aspectratio keys and logs
      // "unrecognized GUI edit: scene.aspectratio.x" on every rebuild.
      // We persist the aspectratio through the layout ourselves, so the
      // tracking entries are redundant — drop them.
      const preGUI = plotRef.current?.el?._fullLayout?._preGUI;
      if (preGUI) {
        for (const key of Object.keys(preGUI)) {
          if (key.startsWith('scene.aspectratio')) {
            delete preGUI[key];
          }
        }
      }

      // Fires on every wheel tick / drag end — keeps clip planes in
      // sync with the zoom level
      applyZoomLimits();
    },
    [plotLayout, applyZoomLimits]
  );

  // After every cursor-zoom step: persist the camera (the zoom is
  // applied programmatically, so plotly emits no relayout) and keep the
  // clip planes tracking the new distance
  const handleCursorZoomed = useCallback(
    (aspect: Aspectratio | null) => {
      captureCamera();
      if (aspect) {
        setSavedAspectratio(aspect);
        plotLayout.scene.aspectmode = 'manual';
        plotLayout.scene.aspectratio = aspect;
      }
      applyZoomLimits();
    },
    [captureCamera, plotLayout, applyZoomLimits]
  );

  const plotAreaRef = useRef<HTMLDivElement>(null);
  useCursorZoom(
    plotAreaRef,
    plotRef,
    plotData,
    ZOOM_DISTANCE_LIMITS,
    handleCursorZoomed
  );

  // Reset View applies the default camera IMPERATIVELY (scene.camera
  // .lookAt) rather than relying on the uirevision bump alone: plotly
  // only applies a layout camera when it differs from its own fullLayout
  // record, and programmatic camera moves (cursor zoom) never enter that
  // record — so after wheel zooming, a layout-driven reset is a no-op
  // ("reset view sometimes does nothing").
  const handleResetView = useCallback(() => {
    resetSavedCamera();

    const scene = getScene();
    if (scene?.camera) {
      const eye = is2D ? DEFAULT_CAMERA_2D.eye : DEFAULT_CAMERA.eye;
      const up = is2D ? [0, 1, 0] : [0, 0, 1];
      scene.camera.lookAt([eye.x, eye.y, eye.z], [0, 0, 0], up);
    }

    // Ortho (2D) zoom lives in the aspectratio; restore the pristine one
    const defaultAspect = getDefaultAspectratio();
    if (scene?.glplot && defaultAspect) {
      scene.glplot.setAspectratio(defaultAspect);
    }

    applyZoomLimits();
    setCameraRev((rev) => rev + 1);
  }, [is2D, getScene, applyZoomLimits]);

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
  //
  // The lasso is resolved server-side: only the polygon and the camera
  // projection go over the wire, never id lists.
  const handleLassoComplete = useCallback(
    (polygon: Point2D[]) => {
      const gd = plotRef.current?.el;
      if (!gd || !plotData) return;

      const projection = getProjectionParams(gd);
      if (!projection) return;

      captureCamera();
      plotSelection.handleLasso(polygon, projection);
    },
    [plotData, plotSelection, captureCamera]
  );

  const handlePick = useCallback(
    (point: Point2D) => {
      const gd = plotRef.current?.el;
      if (!gd || !plotData) return;

      const index = pickNearestPoint(gd, plotData, point);
      if (index === null) {
        return; // empty space: keep mode, change nothing
      }

      captureCamera();
      plotSelection.toggleSelected(index);
    },
    [plotData, plotSelection, captureCamera]
  );

  const handleSelectModeExit = useCallback(
    () => setSelectMode(false),
    [setSelectMode]
  );

  // Esc in explore mode clears class highlights, the selection, and grid
  // filtering together (the 2D embeddings panel behavior). In select mode,
  // Esc exits the mode first (handled by the overlay); the next Esc then
  // clears.
  useEffect(() => {
    if (selectMode) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (highlightedClasses?.length) {
        setHighlightedClasses([]);
      }
      if (lassoSelection?.count) {
        clearSelection();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    selectMode,
    lassoSelection,
    clearSelection,
    highlightedClasses,
    setHighlightedClasses,
  ]);

  const handleExploreDoubleClick = useCallback(() => {
    if (!plotData) return;
    setSelectMode(true);
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
    () => (getScene()?.glplot?.canvas ?? null) as HTMLCanvasElement | null,
    [getScene]
  );

  // Resolve the hovered point's sample id + filepath lazily by index
  // (one tiny request per first hover, cached afterwards)
  const [hoverInfo, setHoverInfo] = useState<SampleInfo | null>(null);
  const getSampleInfoExecutor = useOperatorExecutor(
    '@harpreetsahota/threed-embeddings/get_sample_info'
  );

  useEffect(() => {
    const brainKey = brainResultSelector.brainKey;
    const colorBy = labelSelector.label;
    if (hoverPreview === null || !plotData || !brainKey) {
      setHoverInfo(null);
      return;
    }

    const index = hoverPreview.index;
    const cacheKey = `${datasetName}::${brainKey}::${colorBy ?? ''}::${index}`;

    const cached = sampleInfoCache.get(cacheKey);
    if (cached !== undefined) {
      setHoverInfo(cached);
      return;
    }

    setHoverInfo(null);
    let stale = false;
    getSampleInfoExecutor.execute(
      {
        brain_key: brainKey,
        index,
        ...(colorBy ? { color_by: colorBy } : {}),
      },
      {
        skipErrorNotification: true,
        callback: (result: any) => {
          if (result?.error) {
            logError('get_sample_info failed', result.error);
            return;
          }
          const info: SampleInfo = {
            sampleId: result?.result?.sample_id ?? null,
            filepath: result?.result?.filepath ?? null,
            hoverLines: result?.result?.hover_lines ?? null,
          };
          sampleInfoCache.set(cacheKey, info);
          if (!stale) {
            setHoverInfo(info);
          }
        },
      }
    );
    return () => {
      stale = true;
    };
  }, [
    hoverPreview,
    plotData,
    datasetName,
    brainResultSelector.brainKey,
    labelSelector.label,
  ]);

  const hoverSrc = hoverInfo?.filepath
    ? (fos.getSampleSrc(hoverInfo.filepath) as string)
    : null;

  // Min/max labels for the continuous colorscale legend
  const colorRange = useMemo(() => {
    if (activeColors?.color_scheme !== 'continuous') return null;
    return minMax(activeColors.colors!);
  }, [activeColors]);

  // Shift-clicking a legend class selects all samples CONTAINING it
  // (presence semantics, like sidebar label filters), resolved
  // server-side and applied as the same view-stage filter as a lasso
  const selectClass = useCallback(
    (label: string) => {
      if (!labelSelector.label) return;

      captureCamera();
      plotSelection.handleClassSelect(labelSelector.label, label);
    },
    [labelSelector.label, plotSelection, captureCamera]
  );

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
          No visualizations found
        </div>
        <div style={{ fontSize: '0.9rem', maxWidth: '400px' }}>
          Compute embeddings using{' '}
          <code>fob.compute_visualization(dataset)</code>
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
                onClick={() => setSelectMode(!selectMode)}
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
            Points: {plotData.count.toLocaleString()}
            {plotProgress &&
              ` (loading ${plotProgress.received}/${plotProgress.total})`}
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
              Select the Brain Key with your visualization
            </div>
            <div style={{ fontSize: '0.85rem', opacity: 0.7 }}>
              Use the dropdown above to choose a visualization to display
            </div>
          </>,
          theme.text.secondary
        )}

      {isLoading &&
        centerMessage(
          <div>
            Loading visualization...
            {plotProgress &&
              ` (${Math.round(
                (plotProgress.received / plotProgress.total) * 100
              )}%)`}
          </div>,
          theme.text.secondary
        )}

      {!plotError && plotData && (
        <>
          {/* Explore mode: grab cursor (grabbing while rotating);
              double-click enters select mode */}
          <div
            ref={plotAreaRef}
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

          {/* Hover card works in both explore and select modes */}
          {hoverPreview && (
            <HoverCard
              x={hoverPreview.x}
              y={hoverPreview.y}
              src={hoverSrc}
              lines={
                hoverInfo?.hoverLines ??
                (hoverInfo?.sampleId ? [hoverInfo.sampleId] : [])
              }
              theme={theme}
            />
          )}

          {colorRange && (
            <FloatingPanel
              stateKey="legend"
              title={labelSelector.label ?? 'value'}
              theme={theme}
            >
              <ColorLegend min={colorRange.min} max={colorRange.max} />
            </FloatingPanel>
          )}

          {activeColors?.color_scheme === 'categorical' && (
            <FloatingPanel
              stateKey="legend"
              title={labelSelector.label ?? 'class'}
              theme={theme}
            >
              <CategoricalLegend
                categories={activeColors.categories!}
                viewCounts={viewCounts}
                highlighted={highlightedClasses ?? []}
                onToggle={toggleHighlightedClass}
                onSelect={selectClass}
              />
            </FloatingPanel>
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
  Icon: EmbeddingsPanelIcon,
  panelOptions: {
    TabIndicator,
  },
});

export default ThreeDEmbeddingsPanel;
