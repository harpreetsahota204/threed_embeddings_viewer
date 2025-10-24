/**
 * Main 3D Embeddings Panel Component
 */

import React, { useState, useCallback, useMemo } from 'react';
import { registerComponent, PluginComponentType } from '@fiftyone/plugins';
import { useOperatorExecutor } from '@fiftyone/operators';
import { useRecoilValue, useSetRecoilState } from 'recoil';
import * as fos from '@fiftyone/state';
import Plot from 'react-plotly.js';
import { plotDataAtom, selectedSampleIdsAtom } from './State';
import './Operator';

const ThreeDEmbeddingsPanel: React.FC = () => {
  // Use Recoil state for data managed by operators
  const plotData = useRecoilValue(plotDataAtom);
  const selectedSampleIds = useRecoilValue(selectedSampleIdsAtom);
  const setSelectedSampleIds = useSetRecoilState(selectedSampleIdsAtom);
  
  // Local state for UI concerns
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [colorByField, setColorByField] = useState<string>('None');
  const [dragMode, setDragMode] = useState<'lasso' | 'pan' | 'orbit'>('orbit');
  const [revision, setRevision] = useState(0);
  
  const dataset = useRecoilValue(fos.dataset);

  const loadVisualizationExecutor = useOperatorExecutor(
    '@harpreetsahota/threed-embeddings/load_visualization_results'
  );
  const applySelectionExecutor = useOperatorExecutor(
    '@harpreetsahota/threed-embeddings/apply_selection_from_plot'
  );

  // Handle loading visualization with color by field
  const handleLoadVisualization = useCallback(async (colorField?: string) => {
    if (!dataset) {
      setError('No dataset loaded');
      return;
    }
    
    setIsLoading(true);
    setError(null);
    
    try {
      // Execute operator with color_by parameter
      const params = colorField && colorField !== 'None' ? { color_by: colorField } : {};
      await loadVisualizationExecutor.execute(params);
      // plotData will automatically update via Recoil when SetPlotData executes
      // Clear selection when loading new visualization
      setSelectedSampleIds([]);
      setRevision(prev => prev + 1); // Force plot update
    } catch (err) {
      console.error('Error loading visualization:', err);
      setError(err instanceof Error ? err.message : 'Failed to load visualization');
    } finally {
      setIsLoading(false);
    }
  }, [dataset, loadVisualizationExecutor, setSelectedSampleIds]);
  
  // Handle color by field change
  const handleColorByChange = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    const newColorField = event.target.value;
    setColorByField(newColorField);
    handleLoadVisualization(newColorField);
  }, [handleLoadVisualization]);

  // Handle lasso/box selection
  const handleSelected = useCallback(
    async (event: any) => {
      if (!event?.points || !plotData) return;
      
      const selectedIds = event.points.map((p: any) => plotData.sample_ids[p.pointIndex]);
      setSelectedSampleIds(selectedIds);
      await applySelectionExecutor.execute({ sample_ids: selectedIds });
    },
    [plotData, setSelectedSampleIds, applySelectionExecutor]
  );
  
  // Handle deselection
  const handleDeselect = useCallback(async () => {
    setSelectedSampleIds([]);
    await applySelectionExecutor.execute({ sample_ids: [] });
  }, [setSelectedSampleIds, applySelectionExecutor]);

  // Memoize plot traces to prevent flickering
  const plotTraces = useMemo(() => {
    if (!plotData) return [];
    
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
  }, [plotData, selectedSampleIds]);

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

  // Get available color fields from dataset
  const colorFields = useMemo(() => {
    if (!dataset) return ['None'];
    const fields = ['None'];
    const schema = dataset.sampleFields || [];
    for (const field of schema) {
      const fieldName = field.name || field;
      if (typeof fieldName === 'string') {
        fields.push(fieldName);
        // Add nested fields for Classifications/Detections
        if (fieldName.includes('label') || fieldName.includes('confidence')) {
          fields.push(fieldName);
        }
      }
    }
    return fields;
  }, [dataset]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{
        padding: '12px',
        borderBottom: '1px solid #e0e0e0',
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        flexWrap: 'wrap',
      }}>
        <button
          onClick={() => handleLoadVisualization()}
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
        
        {plotData && !isLoading && (
          <>
            <select
              value={colorByField}
              onChange={handleColorByChange}
              style={{
                padding: '8px 12px',
                border: '1px solid #e0e0e0',
                borderRadius: '4px',
                backgroundColor: 'white',
                cursor: 'pointer',
                fontSize: '14px',
              }}
            >
              {colorFields.map(field => (
                <option key={field} value={field}>{field}</option>
              ))}
            </select>
            
            <div style={{ display: 'flex', gap: '4px', border: '1px solid #e0e0e0', borderRadius: '4px', padding: '2px' }}>
              <button
                onClick={() => setDragMode('orbit')}
                style={{
                  padding: '6px 12px',
                  backgroundColor: dragMode === 'orbit' ? '#3b5acf' : 'transparent',
                  color: dragMode === 'orbit' ? 'white' : '#666',
                  border: 'none',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: dragMode === 'orbit' ? 600 : 400,
                }}
                title="Orbit mode - rotate and zoom the plot"
              >
                Orbit
              </button>
              <button
                onClick={() => setDragMode('lasso')}
                style={{
                  padding: '6px 12px',
                  backgroundColor: dragMode === 'lasso' ? '#3b5acf' : 'transparent',
                  color: dragMode === 'lasso' ? 'white' : '#666',
                  border: 'none',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: dragMode === 'lasso' ? 600 : 400,
                }}
                title="Lasso mode - select points by drawing"
              >
                Lasso
              </button>
              <button
                onClick={() => setDragMode('pan')}
                style={{
                  padding: '6px 12px',
                  backgroundColor: dragMode === 'pan' ? '#3b5acf' : 'transparent',
                  color: dragMode === 'pan' ? 'white' : '#666',
                  border: 'none',
                  borderRadius: '3px',
                  cursor: 'pointer',
                  fontSize: '13px',
                  fontWeight: dragMode === 'pan' ? 600 : 400,
                }}
                title="Pan mode - move the plot"
              >
                Pan
              </button>
            </div>
          </>
        )}
        
        {selectedSampleIds.length > 0 && (
          <>
            <button
              onClick={handleDeselect}
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
              uirevision: revision, // Preserve zoom/pan state
              dragmode: dragMode,
              margin: { l: 0, r: 0, t: 0, b: 0 },
              scene: {
                xaxis: { title: 'Component 1', showgrid: true, zeroline: false },
                yaxis: { title: 'Component 2', showgrid: true, zeroline: false },
                zaxis: { title: 'Component 3', showgrid: true, zeroline: false },
                camera: { eye: { x: 1.5, y: 1.5, z: 1.5 } },
              },
              hovermode: dragMode === 'orbit' ? 'closest' : false,
              paper_bgcolor: 'rgba(0,0,0,0)',
              plot_bgcolor: 'rgba(0,0,0,0)',
            }}
            config={{
              displayModeBar: true,
              displaylogo: false,
              responsive: true,
              modeBarButtonsToRemove: ['toImage'],
            }}
            style={{ width: '100%', height: '100%' }}
            onSelected={handleSelected}
            onDeselect={handleDeselect}
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
  activator: ({ dataset }: { dataset: any }) => dataset !== null,
});

export default ThreeDEmbeddingsPanel;
