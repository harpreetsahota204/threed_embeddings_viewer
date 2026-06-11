/**
 * Embeddings Panel
 *
 * Renders brain visualization results of any dimensionality >= 2 with a
 * deck.gl ScatterplotLayer in an OrbitView (2D embeddings as a flat plane
 * viewed straight-on, orthographic). deck.gl keeps millions of points on
 * the GPU as binary attribute buffers, does hover/click picking on the
 * GPU. 3D scroll zoom uses a cursor-dolly controller; 2D uses orthographic
 * pan/zoom. Styled to match the built-in 2D Embeddings panel: floating
 * controls over a clean, axis-less scene.
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
import { DeckGL } from '@deck.gl/react';
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
import { getDeckProjection, Point2D } from './lasso';
import { clearDollyAnchor, setDollyAnchor } from './dollyAnchor';
import { CursorDollyOrbitController } from './cursorDollyController';
import { base64ToBytes } from './base64';
import { testBit } from './bitmask';
import { cssToRgb, minMax } from './colors';
import { lassoSelectionAtom, PlotCategory } from './State';
import {
  getSavedViewState,
  setSavedViewState,
  DeckViewState,
} from './cameraStore';
import {
  buildBaseColors,
  buildPositions,
  buildOrbitView,
  buildScatterLayers,
  buildSceneBuffers,
  computeBounds,
  initialViewState,
  pointAt,
} from './deckScene';
import {
  HOVER_PICK_INTERVAL_MS,
  HOVER_INFO_DEBOUNCE_MS,
  pickPointIndex,
} from './plotPick';
import './Operator';

// Sample id, filepath, and hover lines are looked up per hover by point
// index (not shipped with plot/colors data); cached per
// dataset::brainKey::colorBy::index.
interface SampleInfo {
  sampleId: string | null;
  filepath: string | null;
  hoverLines: string[] | null;
}
const sampleInfoCache = new Map<string, SampleInfo>();

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
  const deckRef = useRef<any>(null);
  const plotAreaRef = useRef<HTMLDivElement>(null);
  const brainResultSelector = useBrainResultsSelector();
  const labelSelector = useLabelSelector();
  const plotSelection = usePlotSelection();
  const { plotData, plotColors, plotError, plotProgress } = usePlot();
  const datasetName = useRecoilValue(fos.datasetName) as string;
  const lassoSelection = useRecoilValue(lassoSelectionAtom);
  const clearSelection = useClearLassoSelection();
  const brainKey = brainResultSelector.brainKey;
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

  // The select-mode overlay suppresses hover, so the dolly anchor can't be
  // refreshed there — drop it on mode change to avoid dollying toward a stale
  // point.
  useEffect(() => {
    clearDollyAnchor();
  }, [selectMode]);

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
  }, [activeColors, highlightedClasses, setHighlightedClasses]);

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

  const is2D = plotData?.num_dims === 2;

  // The visible scene background is the spaces panel background; dimmed
  // points blend toward it
  const backgroundRGB = useMemo(
    () => cssToRgb(theme.background.mediaSpace || theme.background.level2),
    [theme.background.mediaSpace, theme.background.level2]
  );

  // GPU attribute buffers. Positions are built once per geometry load and
  // the reference is kept stable so deck only re-uploads colors/radii when
  // a selection changes (geometry is the dominant buffer).
  const positions = useMemo(
    () => (plotData ? buildPositions(plotData) : null),
    [plotData]
  );

  const bounds = useMemo(
    () => (plotData ? computeBounds(plotData) : null),
    [plotData]
  );

  // Base (unselected, undimmed) per-point RGB. Memoized separately from
  // the selection buffers so dimming changes don't recompute the colormap.
  const baseRGB = useMemo(
    () => (plotData ? buildBaseColors(plotData, activeColors) : null),
    [plotData, activeColors]
  );

  const selectionIndices = plotSelection.selectionIndices;

  const inSelection = useMemo((): ((i: number) => boolean) | null => {
    if (checkedIndices) return (i) => checkedIndices.has(i);
    if (selectionIndices) return (i) => selectionIndices.has(i);
    if (viewBitmask) return (i) => testBit(viewBitmask, i);
    return null;
  }, [checkedIndices, selectionIndices, viewBitmask]);

  const highlightSet = useMemo(() => {
    if (inSelection || !activeColors?.class_members || !highlightedClasses?.length) {
      return null;
    }
    const labels = new Set(highlightedClasses);
    return new Set(
      activeColors.categories!
        .map((c, i) => (labels.has(c.label) ? i : -1))
        .filter((i) => i >= 0)
    );
  }, [inSelection, activeColors, highlightedClasses]);

  const sceneBuffers = useMemo(() => {
    if (!plotData || !positions || !baseRGB) return null;
    return buildSceneBuffers({
      positions,
      baseRGB,
      background: backgroundRGB,
      inSelection,
      checkedIndices,
      highlightSet,
      classMembers: activeColors?.class_members,
    });
  }, [
    plotData,
    positions,
    baseRGB,
    activeColors,
    inSelection,
    highlightSet,
    checkedIndices,
    backgroundRGB,
  ]);

  const layers = useMemo(() => {
    if (!plotData || !positions || !sceneBuffers || !bounds) return [];
    return buildScatterLayers({
      count: plotData.count,
      positions,
      sceneBuffers,
      is2D: !!is2D,
      maxExtent: bounds.maxExtent,
    });
  }, [plotData, positions, sceneBuffers, is2D, bounds]);

  // 2D: left-drag pans, no rotation (OrbitController defaults dragMode to
  // 'rotate', which makes left-drag rotate and leaves nothing for pan once
  // dragRotate is off — so 2D needs dragMode: 'pan'). Both: double-click
  // enters select mode rather than zooming; cursor-anchored scroll-zoom
  // stays on.
  const controller = useMemo(
    () =>
      is2D
        ? { dragMode: 'pan' as const, dragRotate: false, doubleClickZoom: false }
        : // 3D: dolly toward the cursor's point on scroll-in (fly into the
          // cloud), rather than deck's scale-around-the-target-plane zoom
          { type: CursorDollyOrbitController, doubleClickZoom: false },
    [is2D]
  );

  // OrbitView view state, persisted across remounts (applying a selection
  // reloads the page query and remounts the panel). null until the first
  // fit so deck never renders with an undefined camera.
  const [viewState, setViewState] = useState<DeckViewState | null>(null);
  // Tracks whether the user has moved the camera; while false we (re)fit
  // to the data as geometry streams in. Reset on geometry source change.
  const userMovedRef = useRef(false);

  useEffect(() => {
    userMovedRef.current = false;
  }, [datasetName, brainKey]);

  // Adopt a camera saved before a remount (treated as user-moved so we
  // don't refit over it)
  useEffect(() => {
    const saved = getSavedViewState();
    if (saved) {
      userMovedRef.current = true;
      setViewState(saved);
    }
  }, []);

  const fitView = useCallback(() => {
    if (!bounds) return;
    const area = plotAreaRef.current;
    const px = area
      ? Math.min(area.clientWidth || 0, area.clientHeight || 0)
      : 0;
    const vs = initialViewState(bounds, !!is2D, px || 700);
    setSavedViewState(vs);
    setViewState(vs);
  }, [bounds, is2D]);

  // Initial fit, and refit as geometry streams in, until the user moves
  useEffect(() => {
    if (!plotData || userMovedRef.current) return;
    fitView();
  }, [plotData, fitView]);

  const onViewStateChange = useCallback((params: any) => {
    userMovedRef.current = true;
    setSavedViewState(params.viewState);
    setViewState(params.viewState);
  }, []);

  const handleResetView = useCallback(() => {
    if (!plotData) return;
    userMovedRef.current = false;
    fitView();
  }, [plotData, fitView]);

  // Hover card for the pointed-at sample, positioned next to the projected
  // point. Implemented with our own pointer-move GPU picking (deck.pickObject)
  // rather than deck's onHover, so it works identically under the
  // select-mode overlay and in explore mode.
  const [hoverPreview, setHoverPreview] = useState<{
    index: number;
    x: number;
    y: number;
  } | null>(null);
  const hoverPreviewRef = useRef<typeof hoverPreview>(null);
  const lastHoverPickRef = useRef(0);

  const clearHover = useCallback(() => {
    clearDollyAnchor();
    if (hoverPreviewRef.current !== null) {
      hoverPreviewRef.current = null;
      setHoverPreview(null);
    }
  }, []);

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      // No hover while a button is held (orbiting or drawing a lasso)
      if (e.buttons !== 0) {
        clearHover();
        return;
      }

      const now = performance.now();
      if (now - lastHoverPickRef.current < HOVER_PICK_INTERVAL_MS) return;
      lastHoverPickRef.current = now;

      const deck = deckRef.current;
      const area = plotAreaRef.current;
      if (!deck || !area || !plotData) return;

      const index = pickPointIndex(deck, area, e.clientX, e.clientY);
      if (index === null) {
        clearHover();
        return;
      }

      setDollyAnchor(pointAt(plotData, index));

      if (hoverPreviewRef.current?.index !== index) {
        const rect = area.getBoundingClientRect();
        const viewport = deck.deck?.getViewports?.()[0];
        let cx = e.clientX;
        let cy = e.clientY;
        if (viewport) {
          const p = viewport.project(pointAt(plotData, index));
          cx = rect.left + p[0];
          cy = rect.top + p[1];
        }
        const preview = { index, x: cx, y: cy };
        hoverPreviewRef.current = preview;
        setHoverPreview(preview);
      }
    },
    [plotData, clearHover]
  );

  // Selection only happens in select mode, through the overlay: a drag
  // lassos a region (replacing the selection), a click toggles the nearest
  // point. The lasso is resolved server-side: only the polygon and the
  // view-projection matrix go over the wire, never id lists.
  const handleLassoComplete = useCallback(
    (polygon: Point2D[]) => {
      const deck = deckRef.current;
      const area = plotAreaRef.current;
      if (!deck?.deck || !area || !plotData) return;

      const rect = area.getBoundingClientRect();
      const projection = getDeckProjection(deck.deck, rect);
      if (!projection) return;

      plotSelection.handleLasso(polygon, projection);
    },
    [plotData, plotSelection]
  );

  const handlePick = useCallback(
    (point: Point2D) => {
      const deck = deckRef.current;
      const area = plotAreaRef.current;
      if (!deck || !area) return;

      const index = pickPointIndex(deck, area, point.x, point.y);
      if (index === null) return;

      plotSelection.toggleSelected(index);
    },
    [plotSelection]
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

  // deck's canvas, for forwarding wheel events from the select-mode
  // overlay so cursor-zoom keeps working while the overlay swallows drags
  const getCanvas = useCallback(
    () =>
      (plotAreaRef.current?.querySelector('canvas') ??
        null) as HTMLCanvasElement | null,
    []
  );

  const getCursor = useCallback(
    ({ isDragging }: { isDragging: boolean }) =>
      isDragging ? 'grabbing' : 'grab',
    []
  );

  const view = useMemo(() => {
    const height =
      plotAreaRef.current?.clientHeight ||
      getCanvas()?.clientHeight ||
      700;
    return buildOrbitView(!!is2D, bounds, viewState?.zoom ?? 0, height);
  }, [is2D, bounds, viewState?.zoom, getCanvas]);

  // Resolve the hovered point's sample id + filepath lazily by index
  // (one tiny request per first hover, cached afterwards)
  const [hoverInfo, setHoverInfo] = useState<SampleInfo | null>(null);
  const getSampleInfoExecutor = useOperatorExecutor(
    '@harpreetsahota/threed-embeddings/get_sample_info'
  );

  useEffect(() => {
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

    // Wait for the cursor to settle before requesting: sweeping past a
    // point shouldn't fire a get_sample_info operator call for it. Each
    // intermediate hoverPreview reruns this effect and clears the pending
    // timer below, so only the point the cursor rests on is fetched.
    const timer = setTimeout(() => {
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
    }, HOVER_INFO_DEBOUNCE_MS);

    return () => {
      stale = true;
      clearTimeout(timer);
    };
  }, [hoverPreview, plotData, datasetName, brainKey, labelSelector.label]);

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
      plotSelection.handleClassSelect(labelSelector.label, label);
    },
    [labelSelector.label, plotSelection]
  );

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
      onPointerLeave={clearHover}
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
          {/* Explore mode: grab cursor (grabbing while orbiting);
              double-click enters select mode */}
          <div
            ref={plotAreaRef}
            style={{ position: 'absolute', inset: 0 }}
            onDoubleClick={handleExploreDoubleClick}
          >
            {viewState && (
              <DeckGL
                ref={deckRef}
                views={view}
                viewState={viewState}
                onViewStateChange={onViewStateChange}
                controller={controller}
                layers={layers}
                getCursor={getCursor}
                style={{
                  position: 'absolute',
                  width: '100%',
                  height: '100%',
                }}
              />
            )}
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
