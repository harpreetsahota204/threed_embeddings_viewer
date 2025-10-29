/**
 * 3D Embeddings Panel Component
 * Following the same architecture as 2D embeddings, adapted for 3D visualization
 */

import React, { Fragment, useMemo, useCallback, useEffect, useRef } from 'react';
import { registerComponent, PluginComponentType } from '@fiftyone/plugins';
import { Selector, useTheme } from '@fiftyone/components';
import { usePanelStatePartial } from '@fiftyone/spaces';
import * as fos from '@fiftyone/state';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import Plot from 'react-plotly.js';
import { useBrainResultsSelector } from './useBrainResult';
import { useLabelSelector } from './useLabelSelector';
import { usePlotSelection } from './usePlotSelection';
import { usePlot } from './usePlot';
import { useResetPlotZoom, useZoomRevision, useCameraReset } from './useResetPlotZoom';
import './Operator';

// Value component for Selector (memoized to prevent re-renders)
const Value = React.memo<{ value: string; className?: string }>(({ value }) => {
  return <>{value}</>;
});

const ThreeDEmbeddingsPanel = React.memo(({ dimensions }: { dimensions?: { bounds?: { width: number; height: number } } }) => {
  const theme = useTheme();
  const plotRef = useRef<any>(null);
  const resetZoom = useResetPlotZoom();
  const brainResultSelector = useBrainResultsSelector();
  const labelSelector = useLabelSelector();
  const canSelect = brainResultSelector.canSelect;
  const showPlot = brainResultSelector.showPlot;
  const plotSelection = usePlotSelection();
  const { plotData, isLoading } = usePlot();
  const [zoomRev] = useZoomRevision();
  const [cameraReset, setCameraReset] = useCameraReset();
  
  const [dragMode, setDragMode] = usePanelStatePartial(
    "dragMode",
    "turntable",
    true
  );
  const [loadingPlotError] = usePanelStatePartial(
    "loadingPlotError",
    null,
    true
  );

  // Memoize selector styles to prevent object recreation
  const selectorStyle = useMemo(() => ({
    background: theme.neutral.softBg,
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    padding: "0.25rem",
  }), [theme.neutral.softBg]);

  // Get selected samples for highlighting
  const selectedSamples = useRecoilValue(fos.selectedSamples);

  // Memoize plot traces using Plotly's built-in selectedpoints mechanism
  const plotTraces = useMemo(() => {
    if (!plotData) return [];

    // resolvedSelection contains points that should be "bright" (in view or selected)
    const resolvedSelection = plotSelection.resolvedSelection || [];
    const selectionSet = new Set(resolvedSelection);
    const hasPlotSelection = resolvedSelection.length > 0;
    
    // Also track actual user selections for highlighting
    const userSelectedSet = selectedSamples;
    const hasUserSelection = userSelectedSet.size > 0;

    // Build selectedpoints array - points that should use "selected" styling
    const selectedpoints: number[] = [];
    const userSelectedIndices: number[] = [];

    plotData.sample_ids.forEach((id, idx) => {
      // Points in resolvedSelection should be bright (in view or selected)
      if (selectionSet.has(id)) {
        selectedpoints.push(idx);
      }
      
      // Track actual user selections separately for orange highlighting
      if (userSelectedSet.has(id)) {
        userSelectedIndices.push(idx);
      }
    });

    // Main trace with all points
    // Use Plotly's selectedpoints mechanism for dimming (like 2D does)
    const mainTrace = {
      type: 'scatter3d',
      mode: 'markers',
      x: plotData.x,
      y: plotData.y,
      z: plotData.z,
      text: plotData.labels,
      ids: plotData.sample_ids,
      selectedpoints: selectedpoints.length > 0 ? selectedpoints : null,
      marker: {
        size: 4,
        color: plotData.color_scheme === 'continuous' 
          ? plotData.colors as number[]
          : plotData.colors as string[],
        colorscale: plotData.color_scheme === 'continuous' ? 'Viridis' : undefined,
        showscale: plotData.color_scheme === 'continuous',
      },
      selected: {
        marker: {
          opacity: hasUserSelection ? 1 : 0.7, // Bright if user selected, normal if just in view
          size: hasUserSelection ? 6 : 4,
          color: hasUserSelection ? '#ff9800' : undefined, // Orange if user selected
          line: hasUserSelection ? { width: 1, color: '#ffffff' } : undefined,
        },
      },
      unselected: {
        marker: {
          opacity: 0.2, // 🎯 DIMMED (not in view)
          size: 3,
        },
      },
      hovertemplate: '<b>%{text}</b><br>x: %{x:.3f}<br>y: %{y:.3f}<br>z: %{z:.3f}<extra></extra>',
      showlegend: false,
    };

    return [mainTrace];
  }, [plotData, plotSelection.resolvedSelection, plotSelection.selectionStyle, selectedSamples]);
  
  // Handle click selection - use plotSelection.handleSelected to avoid freezing
  const handleClick = useCallback(
    (event: any) => {
      if (!event?.points || !plotData) return;
      
      const clickedIndex = event.points[0].pointIndex;
      const sampleId = plotData.sample_ids[clickedIndex];
      
      // Use plotSelection.handleSelected which properly manages state
      plotSelection.handleSelected([sampleId], { x: [], y: [], z: [] });
    },
    [plotData, plotSelection]
  );

  // Handle box/lasso selection
  const handleSelected = useCallback(
    (event: any) => {
      if (!event?.points || !plotData) return;

      const selectedIds = event.points.map((p: any) => plotData.sample_ids[p.pointIndex]);
      
      // Use plotSelection.handleSelected which properly manages state
      plotSelection.handleSelected(selectedIds, { x: [], y: [], z: [] });
    },
    [plotData, plotSelection]
  );

  // Handle deselection
  const handleDeselect = useCallback(() => {
    plotSelection.handleSelected(null, null);
  }, [plotSelection]);
  
  // Handle clear selection button
  const handleClearSelection = useCallback(() => {
    plotSelection.clearSelection();
  }, [plotSelection]);
  
  // Reset camera to initial position
  const handleResetCamera = useCallback(() => {
    if (plotRef.current) {
      // Use Plotly's relayout to reset camera to default position
      const Plotly = (window as any).Plotly;
      if (Plotly && plotRef.current.el) {
        Plotly.relayout(plotRef.current.el, {
          'scene.camera': {
            eye: { x: 1.5, y: 1.5, z: 1.5 },
            center: { x: 0, y: 0, z: 0 },
            up: { x: 0, y: 0, z: 1 }
          }
        });
      }
    }
  }, []);

  // Memoize button style helper to prevent recreation
  const plotOptionStyle = useCallback((isActive: boolean) => ({
    padding: '6px 12px',
    backgroundColor: isActive ? theme.primary.plainColor : 'transparent',
    color: isActive ? theme.primary.plainActiveBg : theme.text.secondary,
    border: 'none',
    borderRadius: '3px',
    cursor: 'pointer',
    fontSize: '13px',
    fontWeight: isActive ? 600 : 400,
    opacity: isActive ? 1 : 0.7,
    transition: 'all 0.2s',
  }), [theme.primary.plainColor, theme.primary.plainActiveBg, theme.text.secondary]);

  // Memoize plot layout to prevent flickering
  const plotLayout = useMemo(() => ({
    autosize: true,
    uirevision: zoomRev,
    margin: { l: 0, r: 0, t: 0, b: 0 },
    scene: {
      dragmode: dragMode, // For 3D, dragmode goes in scene, not layout!
      xaxis: {
        title: 'Component 1',
        showgrid: true,
        zeroline: false,
        gridcolor: theme.primary.plainBorder,
      },
      yaxis: {
        title: 'Component 2',
        showgrid: true,
        zeroline: false,
        gridcolor: theme.primary.plainBorder,
      },
      zaxis: {
        title: 'Component 3',
        showgrid: true,
        zeroline: false,
        gridcolor: theme.primary.plainBorder,
      },
      camera: { eye: { x: 1.5, y: 1.5, z: 1.5 } },
      bgcolor: theme.background.level1,
    },
    hovermode: 'closest',
    paper_bgcolor: theme.background.level1,
    plot_bgcolor: theme.background.level1,
  }), [zoomRev, dragMode, theme.primary.plainBorder, theme.background.level1]);

  // Memoize plot config to prevent flickering
  const plotConfig = useMemo(() => ({
    displayModeBar: true,
    displaylogo: false,
    responsive: true,
    modeBarButtonsToRemove: ['toImage', 'sendDataToCloud'],
    // Keep selection tools visible (box select, lasso select if available)
  }), []);

  // Stable style object
  const plotStyle = useMemo(() => ({ width: '100%', height: '100%' }), []);

  // Show error if present
  if (loadingPlotError) {
    return (
      <div
        style={{
          padding: '2rem',
          textAlign: 'center',
          color: theme.text.secondary,
        }}
      >
        <div style={{ color: theme.error.plainColor, marginBottom: '1rem' }}>
          Error loading visualization
        </div>
        <div style={{ fontSize: '0.9rem' }}>{loadingPlotError.message}</div>
      </div>
    );
  }

  // Show message if no brain results available
  if (!canSelect) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: theme.text.secondary,
          flexDirection: 'column',
          gap: '1rem',
          padding: '2rem',
          textAlign: 'center',
        }}
      >
        <div style={{ fontSize: '1.1rem', fontWeight: 500 }}>
          No 3D visualizations found
        </div>
        <div style={{ fontSize: '0.9rem', maxWidth: '400px' }}>
          Compute 3D embeddings using <code>fob.compute_visualization(dataset, num_dims=3)</code>
        </div>
      </div>
    );
  }

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
        {/* Brain Key Selector */}
        <Selector
          cy="3d-embeddings-brain-key"
          {...brainResultSelector.handlers}
          placeholder="Select brain key"
          overflow={true}
          component={Value}
          resultsPlacement="bottom-start"
          containerStyle={selectorStyle}
        />

        {/* Color By Selector */}
        {brainResultSelector.hasSelection &&
          !brainResultSelector.hasLoadingError &&
          !labelSelector.isLoading && (
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

        {/* Info text about selection */}
        {showPlot && plotData && (
          <span style={{ fontSize: '12px', color: theme.text.secondary, fontStyle: 'italic' }}>
            Click points to select
          </span>
        )}

        {/* Clear Selection Button */}
        {plotSelection.hasSelection && !plotSelection.selectionIsExternal && (
          <button
            onClick={handleClearSelection}
            style={{
              padding: '6px 12px',
              backgroundColor: 'transparent',
              border: `1px solid ${theme.primary.plainBorder}`,
              borderRadius: '4px',
              cursor: 'pointer',
              color: theme.text.secondary,
              fontSize: '13px',
            }}
            title="Clear selection"
          >
            Clear Selection
          </button>
        )}

        {/* Reset View Button */}
        {showPlot && plotData && (
          <button
            onClick={handleResetCamera}
            style={{
              padding: '6px 12px',
              backgroundColor: 'transparent',
              border: `1px solid ${theme.primary.plainBorder}`,
              borderRadius: '4px',
              cursor: 'pointer',
              color: theme.text.secondary,
              fontSize: '13px',
            }}
            title="Reset camera view"
          >
            Reset View
          </button>
        )}

        {/* Selection Count */}
        {plotSelection.hasSelection && (
          <span style={{ color: theme.primary.plainColor, fontWeight: 500, fontSize: '13px' }}>
            {plotSelection.selectionStyle === 'selected' && selectedSamples.size > 0
              ? `Selected: ${selectedSamples.size}`
              : `In view: ${plotSelection.resolvedSelection?.length || 0}`
            }
          </span>
        )}

        {/* Point Count */}
        {plotData && (
          <span
            style={{ marginLeft: 'auto', color: theme.text.secondary, fontSize: '13px' }}
          >
            Points: {plotData.x.length.toLocaleString()}
          </span>
        )}
      </div>

      {/* Plot Area */}
      <div style={{ flex: 1, position: 'relative' }}>
        {isLoading && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: theme.text.secondary,
              flexDirection: 'column',
              gap: '1rem',
            }}
          >
            <div>Select the Brain Key with your 3D Visualization</div>
            <div style={{ fontSize: '0.85rem', opacity: 0.7 }}>
              Choose from the dropdown above
            </div>
          </div>
        )}

        {!isLoading && !showPlot && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: theme.text.secondary,
              flexDirection: 'column',
              gap: '1rem',
              padding: '2rem',
              textAlign: 'center',
            }}
          >
            <div style={{ fontSize: '1rem' }}>
              Select the Brain Key with your 3D Visualization
            </div>
            <div style={{ fontSize: '0.85rem', opacity: 0.7 }}>
              Use the dropdown above to choose a 3D visualization to display
            </div>
          </div>
        )}

        {showPlot && plotData && !isLoading && (
          <Plot
            ref={plotRef}
            data={plotTraces as any}
            layout={plotLayout as any}
            config={plotConfig}
            style={plotStyle}
            onClick={handleClick}
            onSelected={handleSelected}
            onDeselect={handleDeselect}
            useResizeHandler={true}
          />
        )}
      </div>
    </div>
  );
});

registerComponent({
  name: 'ThreeDEmbeddingsPanel',
  label: '3D Embeddings',
  component: ThreeDEmbeddingsPanel,
  type: PluginComponentType.Panel,
  activator: () => true,
});

export default ThreeDEmbeddingsPanel;
