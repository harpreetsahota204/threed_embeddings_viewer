/**
 * 3D Embeddings Panel Component
 * Following the same architecture as 2D embeddings, adapted for 3D visualization
 */

import React, { Fragment, useMemo, useCallback, useEffect } from 'react';
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

  // Simple click selection using FiftyOne's selectedSamples directly
  const selectedSamples = useRecoilValue(fos.selectedSamples);
  const setSelectedSamples = useSetRecoilState(fos.selectedSamples);

  // Memoize plot traces to prevent flickering
  const plotTraces = useMemo(() => {
    if (!plotData) return [];

    const selectedSet = selectedSamples;
    const hasSelection = selectedSet.size > 0;

    const selectedIndices: number[] = [];
    const unselectedIndices: number[] = [];

    plotData.sample_ids.forEach((id, idx) => {
      if (hasSelection && selectedSet.has(id)) {
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
          color: '#ff9800',
          opacity: 1,
          line: { width: 1, color: '#ffffff' },
        },
        hovertemplate: '<b>%{text}</b><br>x: %{x:.3f}<br>y: %{y:.3f}<br>z: %{z:.3f}<extra></extra>',
        showlegend: false,
      });
    }

    return traces;
  }, [plotData, selectedSamples]);
  
  // Handle click selection
  const handleClick = useCallback(
    (event: any) => {
      if (!event?.points || !plotData) return;
      
      const clickedIndex = event.points[0].pointIndex;
      const sampleId = plotData.sample_ids[clickedIndex];
      
      // Get current selection as array
      const currentSelection = Array.from(selectedSamples);
      
      let newSelection: string[];
      
      // Check if Shift key was pressed (for multi-select)
      if (event.event?.shiftKey) {
        // Add to selection if not already selected, remove if selected
        if (currentSelection.includes(sampleId)) {
          newSelection = currentSelection.filter(id => id !== sampleId);
        } else {
          newSelection = [...currentSelection, sampleId];
        }
      } else {
        // Single click without shift - select only this point
        newSelection = [sampleId];
      }
      
      // Update FiftyOne's selectedSamples directly (simple and fast)
      setSelectedSamples(new Set(newSelection));
    },
    [plotData, selectedSamples, setSelectedSamples]
  );

  // Handle box/lasso selection (if Plotly modebar tools are used - though they don't exist for 3D)
  const handleSelected = useCallback(
    (event: any) => {
      if (!event?.points || !plotData) return;

      const selectedIds = event.points.map((p: any) => plotData.sample_ids[p.pointIndex]);
      setSelectedSamples(new Set(selectedIds));
    },
    [plotData, setSelectedSamples]
  );

  // Handle deselection
  const handleDeselect = useCallback(() => {
    setSelectedSamples(new Set());
  }, [setSelectedSamples]);
  
  // Handle clear selection button
  const handleClearSelection = useCallback(() => {
    setSelectedSamples(new Set());
  }, [setSelectedSamples]);
  
  // Reset camera to initial position
  const handleResetCamera = useCallback(() => {
    // Increment camera reset counter to force remount with default camera
    setCameraReset();
  }, [setCameraReset]);

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
            Click points to select • Shift+Click for multiple
          </span>
        )}

        {/* Clear Selection Button */}
        {selectedSamples.size > 0 && (
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
        {selectedSamples.size > 0 && (
          <span style={{ color: theme.primary.plainColor, fontWeight: 500, fontSize: '13px' }}>
            Selected: {selectedSamples.size}
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
            key={`plot-${cameraReset}`}
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
