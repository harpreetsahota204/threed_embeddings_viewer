/**
 * 3D Embeddings Panel Component
 * Following the same architecture as 2D embeddings, adapted for 3D visualization
 */

import React, { Fragment, useMemo, useCallback, useEffect } from 'react';
import { registerComponent, PluginComponentType } from '@fiftyone/plugins';
import { Selector, useTheme } from '@fiftyone/components';
import { usePanelStatePartial } from '@fiftyone/spaces';
import * as fos from '@fiftyone/state';
import { useRecoilValue } from 'recoil';
import Plot from 'react-plotly.js';
import { useBrainResultsSelector } from './useBrainResult';
import { useLabelSelector } from './useLabelSelector';
import { usePlotSelection } from './usePlotSelection';
import { usePlot } from './usePlot';
import { useResetPlotZoom, useZoomRevision } from './useResetPlotZoom';
import './Operator';

// Value component for Selector (memoized to prevent re-renders)
const Value = React.memo<{ value: string; className?: string }>(({ value }) => {
  return <>{value}</>;
});

const ThreeDEmbeddingsPanel = React.memo(({ dimensions }: { dimensions?: { bounds?: { width: number; height: number } } }) => {
  const theme = useTheme();
  const resetZoom = useResetPlotZoom();
  const brainResultSelector = useBrainResultsSelector();
  const labelSelector = useLabelSelector();
  const canSelect = brainResultSelector.canSelect;
  const showPlot = brainResultSelector.showPlot;
  const plotSelection = usePlotSelection();
  const { plotData, isLoading } = usePlot();
  const [zoomRev] = useZoomRevision();
  
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

  // Memoize plot traces to prevent flickering
  const plotTraces = useMemo(() => {
    if (!plotData) return [];

    const resolvedSelection = plotSelection.resolvedSelection || [];
    const selectionSet = new Set(resolvedSelection);
    const hasSelection = resolvedSelection.length > 0;

    const selectedIndices: number[] = [];
    const unselectedIndices: number[] = [];

    plotData.sample_ids.forEach((id, idx) => {
      if (hasSelection && selectionSet.has(id)) {
        selectedIndices.push(idx);
      } else {
        unselectedIndices.push(idx);
      }
    });

    const traces = [];

    // Unselected points
    if (unselectedIndices.length > 0) {
      traces.push({
        type: 'scatter3d',
        mode: 'markers',
        x: unselectedIndices.map((i) => plotData.x[i]),
        y: unselectedIndices.map((i) => plotData.y[i]),
        z: unselectedIndices.map((i) => plotData.z[i]),
        text: unselectedIndices.map((i) => plotData.labels[i]),
        marker: {
          size: 4,
          color:
            plotData.color_scheme === 'continuous'
              ? unselectedIndices.map((i) => plotData.colors[i] as number)
              : unselectedIndices.map((i) => plotData.colors[i] as string),
          colorscale: plotData.color_scheme === 'continuous' ? 'Viridis' : undefined,
          showscale: plotData.color_scheme === 'continuous',
          opacity: hasSelection ? 0.3 : 0.7,
        },
        hovertemplate: '<b>%{text}</b><br>x: %{x:.3f}<br>y: %{y:.3f}<br>z: %{z:.3f}<extra></extra>',
        showlegend: false,
      });
    }

    // Selected points
    if (selectedIndices.length > 0) {
      traces.push({
        type: 'scatter3d',
        mode: 'markers',
        x: selectedIndices.map((i) => plotData.x[i]),
        y: selectedIndices.map((i) => plotData.y[i]),
        z: selectedIndices.map((i) => plotData.z[i]),
        text: selectedIndices.map((i) => plotData.labels[i]),
        marker: {
          size: 6,
          color: plotSelection.selectionStyle === 'selected' ? '#ff9800' : '#ff4444',
          opacity: 1,
          line: { width: 1, color: '#ffffff' },
        },
        hovertemplate: '<b>%{text}</b><br>x: %{x:.3f}<br>y: %{y:.3f}<br>z: %{z:.3f}<extra></extra>',
        showlegend: false,
      });
    }

    return traces;
  }, [plotData, plotSelection.resolvedSelection, plotSelection.selectionStyle]);

  // Handle lasso/box selection
  const handleSelected = useCallback(
    (event: any) => {
      if (!event?.points || !plotData) return;

      const selectedIds = event.points.map((p: any) => plotData.sample_ids[p.pointIndex]);
      
      // Note: For 3D, lasso points aren't as straightforward as 2D
      // We'll store the selection but not the lasso path for now
      plotSelection.handleSelected(selectedIds, { x: [], y: [], z: [] });
    },
    [plotData, plotSelection]
  );

  // Handle deselection
  const handleDeselect = useCallback(() => {
    plotSelection.handleSelected(null, { x: [], y: [], z: [] });
  }, [plotSelection]);

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

        {/* Interaction Mode Buttons */}
        {showPlot && plotData && (
          <div
            style={{
              display: 'flex',
              gap: '4px',
              border: `1px solid ${theme.primary.plainBorder}`,
              borderRadius: '4px',
              padding: '2px',
            }}
          >
            <button
              onClick={() => setDragMode('turntable')}
              style={plotOptionStyle(dragMode === 'turntable')}
              title="Rotate mode - rotate the plot around center"
            >
              Rotate
            </button>
            <button
              onClick={() => setDragMode('orbit')}
              style={plotOptionStyle(dragMode === 'orbit')}
              title="Orbit mode - free rotation"
            >
              Orbit
            </button>
            <button
              onClick={() => setDragMode('pan')}
              style={plotOptionStyle(dragMode === 'pan')}
              title="Pan mode - move the plot"
            >
              Pan
            </button>
          </div>
        )}
        
        {/* Info text about box select */}
        {showPlot && plotData && (
          <span style={{ fontSize: '12px', color: theme.text.secondary, fontStyle: 'italic' }}>
            Use toolbar to box select points
          </span>
        )}

        {/* Clear Selection Button */}
        {!plotSelection.selectionIsExternal && plotSelection.hasSelection && (
          <button
            onClick={plotSelection.clearSelection}
            style={{
              padding: '6px 12px',
              backgroundColor: 'transparent',
              border: `1px solid ${theme.primary.plainBorder}`,
              borderRadius: '4px',
              cursor: 'pointer',
              color: theme.text.secondary,
              fontSize: '13px',
            }}
            title="Clear selection (Esc)"
          >
            Clear Selection
          </button>
        )}

        {/* Reset Zoom Button */}
        {showPlot && plotData && (
          <button
            onClick={resetZoom}
            style={{
              padding: '6px 12px',
              backgroundColor: 'transparent',
              border: `1px solid ${theme.primary.plainBorder}`,
              borderRadius: '4px',
              cursor: 'pointer',
              color: theme.text.secondary,
              fontSize: '13px',
            }}
            title="Reset zoom"
          >
            Reset Zoom
          </button>
        )}

        {/* Selection Count */}
        {plotSelection.hasSelection && (
          <span style={{ color: theme.primary.plainColor, fontWeight: 500, fontSize: '13px' }}>
            Selected: {plotSelection.resolvedSelection?.length || 0}
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
            }}
          >
            Loading visualization...
          </div>
        )}

        {!isLoading && !showPlot && brainResultSelector.hasSelection && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: '100%',
              color: theme.text.secondary,
            }}
          >
            Select a brain key to view 3D embeddings
          </div>
        )}

        {showPlot && plotData && !isLoading && (
          <Plot
            key={`plot-${zoomRev}`}
            data={plotTraces as any}
            layout={plotLayout as any}
            config={plotConfig}
            style={plotStyle}
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
