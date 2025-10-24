/**
 * Main 3D Embeddings Panel Component
 */

import React, { useState, useCallback, useEffect } from 'react';
import { registerComponent, PluginComponentType } from '@fiftyone/plugins';
import { useOperatorExecutor } from '@fiftyone/operators';
import { useRecoilValue } from 'recoil';
import * as fos from '@fiftyone/state';
import Plot from 'react-plotly.js';
import './Operator';

interface PlotData {
  x: number[];
  y: number[];
  z: number[];
  sample_ids: string[];
  labels: string[];
  colors: (string | number)[];
  color_scheme: 'categorical' | 'continuous' | 'uniform';
}

const ThreeDEmbeddingsPanel: React.FC = () => {
  const [plotData, setPlotData] = useState<PlotData | null>(null);
  const [selectedSampleIds, setSelectedSampleIds] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const dataset = useRecoilValue(fos.dataset);

  const loadVisualizationExecutor = useOperatorExecutor(
    '@harpreetsahota/threed-embeddings/load_visualization_results'
  );
  const applySelectionExecutor = useOperatorExecutor(
    '@harpreetsahota/threed-embeddings/apply_selection_from_plot'
  );

  // Handle loading visualization
  const handleLoadVisualization = useCallback(async () => {
    if (!dataset) {
      setError('No dataset loaded');
      return;
    }
    
    setIsLoading(true);
    setError(null);
    try {
      const result = await loadVisualizationExecutor.execute({});
      if (result?.plot_data) {
        setPlotData(result.plot_data);
        setSelectedSampleIds([]);
      }
    } catch (err) {
      console.error('Error loading visualization:', err);
      setError(err instanceof Error ? err.message : 'Failed to load visualization');
    } finally {
      setIsLoading(false);
    }
  }, [loadVisualizationExecutor, dataset]);

  // Handle selection from plot
  const handlePlotClick = useCallback(
    async (event: any) => {
      if (!event.points || !plotData) return;
      
      const clickedIndex = event.points[0].pointIndex;
      const sampleId = plotData.sample_ids[clickedIndex];
      
      // Toggle selection
      const newSelection = selectedSampleIds.includes(sampleId)
        ? selectedSampleIds.filter(id => id !== sampleId)
        : [...selectedSampleIds, sampleId];
      
      setSelectedSampleIds(newSelection);
      await applySelectionExecutor.execute({ sample_ids: newSelection });
    },
    [plotData, selectedSampleIds, applySelectionExecutor]
  );

  // Handle box selection
  const handleSelected = useCallback(
    async (event: any) => {
      if (!event?.points || !plotData) return;
      
      const selectedIds = event.points.map((p: any) => plotData.sample_ids[p.pointIndex]);
      setSelectedSampleIds(selectedIds);
      await applySelectionExecutor.execute({ sample_ids: selectedIds });
    },
    [plotData, applySelectionExecutor]
  );

  // Create plot traces
  const plotTraces = plotData ? (() => {
    const isSelected = plotData.sample_ids.map(id => selectedSampleIds.includes(id));
    
    const unselectedIndices = isSelected.map((sel, idx) => sel ? -1 : idx).filter(idx => idx !== -1);
    const selectedIndices = isSelected.map((sel, idx) => sel ? idx : -1).filter(idx => idx !== -1);
    
    const traces = [];
    
    // Unselected points
    if (unselectedIndices.length > 0) {
      traces.push({
        type: 'scatter3d',
        mode: 'markers',
        x: unselectedIndices.map(i => plotData.x[i]),
        y: unselectedIndices.map(i => plotData.y[i]),
        z: unselectedIndices.map(i => plotData.z[i]),
        text: unselectedIndices.map(i => plotData.labels[i]),
        marker: {
          size: 4,
          color: plotData.color_scheme === 'continuous'
            ? unselectedIndices.map(i => plotData.colors[i] as number)
            : unselectedIndices.map(i => plotData.colors[i] as string),
          colorscale: plotData.color_scheme === 'continuous' ? 'Viridis' : undefined,
          showscale: plotData.color_scheme === 'continuous',
          opacity: 0.7,
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
        x: selectedIndices.map(i => plotData.x[i]),
        y: selectedIndices.map(i => plotData.y[i]),
        z: selectedIndices.map(i => plotData.z[i]),
        text: selectedIndices.map(i => plotData.labels[i]),
        marker: {
          size: 6,
          color: '#ff4444',
          opacity: 1,
          line: { width: 1, color: '#ffffff' },
        },
        hovertemplate: '<b>%{text}</b><br>x: %{x:.3f}<br>y: %{y:.3f}<br>z: %{z:.3f}<extra></extra>',
        showlegend: false,
      });
    }
    
    return traces;
  })() : [];

  // Show message if no dataset
  if (!dataset) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        color: '#666',
        fontSize: '14px',
      }}>
        No dataset loaded
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        padding: '12px',
        borderBottom: '1px solid #e0e0e0',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
      }}>
        <button
          onClick={handleLoadVisualization}
          disabled={isLoading}
          style={{
            padding: '8px 16px',
            backgroundColor: '#3b5acf',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: isLoading ? 'not-allowed' : 'pointer',
            opacity: isLoading ? 0.6 : 1,
          }}
        >
          {isLoading ? 'Loading...' : 'Load Visualization'}
        </button>
        
        {selectedSampleIds.length > 0 && (
          <>
            <button
              onClick={async () => {
                setSelectedSampleIds([]);
                await applySelectionExecutor.execute({ sample_ids: [] });
              }}
              style={{
                padding: '8px 16px',
                backgroundColor: 'transparent',
                border: '1px solid #e0e0e0',
                borderRadius: '4px',
                cursor: 'pointer',
              }}
            >
              Clear Selection
            </button>
            <span style={{ color: '#3b5acf', fontWeight: 500 }}>
              Selected: {selectedSampleIds.length}
            </span>
          </>
        )}
        
        {plotData && (
          <span style={{ marginLeft: 'auto', color: '#666' }}>
            Points: {plotData.x.length.toLocaleString()}
          </span>
        )}
      </div>
      
      <div style={{ flex: 1 }}>
        {error && (
          <div style={{
            padding: '12px',
            backgroundColor: '#fee',
            color: '#c33',
            borderBottom: '1px solid #fcc',
            fontSize: '14px',
          }}>
            Error: {error}
          </div>
        )}
        
        {!plotData && !isLoading && !error && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: '#666',
          }}>
            Click "Load Visualization" to view 3D embeddings
          </div>
        )}
        
        {isLoading && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100%',
            color: '#666',
          }}>
            Loading visualization...
          </div>
        )}
        
        {plotData && !isLoading && (
          <Plot
            data={plotTraces as any}
            layout={{
              autosize: true,
              margin: { l: 0, r: 0, t: 0, b: 0 },
              scene: {
                xaxis: { title: 'Component 1' },
                yaxis: { title: 'Component 2' },
                zaxis: { title: 'Component 3' },
                camera: { eye: { x: 1.5, y: 1.5, z: 1.5 } },
              },
              hovermode: 'closest',
            }}
            config={{
              displayModeBar: true,
              displaylogo: false,
              responsive: true,
            }}
            style={{ width: '100%', height: '100%' }}
            onClick={handlePlotClick}
            onSelected={handleSelected}
            useResizeHandler={true}
          />
        )}
      </div>
    </div>
  );
}

registerComponent({
  name: 'ThreeDEmbeddingsPanel',
  label: '3D Embeddings Viewer',
  component: ThreeDEmbeddingsPanel,
  type: PluginComponentType.Panel,
  activator: ({ dataset }) => dataset !== null,
});

export default ThreeDEmbeddingsPanel;
