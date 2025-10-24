/**
 * 3D Plot Component using Plotly
 */

import React, { useMemo, useCallback } from 'react';
import Plot from 'react-plotly.js';
import { PlotData } from './state';

interface Plot3DProps {
  data: PlotData;
  selectedSampleIds: string[];
  onSelectionChange: (sampleIds: string[]) => void;
}

const Plot3D: React.FC<Plot3DProps> = ({ data, selectedSampleIds, onSelectionChange }) => {
  // Create plot data
  const plotData = useMemo(() => {
    if (!data || !data.x || !data.y || !data.z) {
      return [];
    }

    const isSelected = data.sample_ids.map((id) => selectedSampleIds.includes(id));
    
    // Create two traces: unselected and selected points
    const unselectedIndices = isSelected.map((sel, idx) => (sel ? -1 : idx)).filter((idx) => idx !== -1);
    const selectedIndices = isSelected.map((sel, idx) => (sel ? idx : -1)).filter((idx) => idx !== -1);

    const traces = [];

    // Unselected points
    if (unselectedIndices.length > 0) {
      traces.push({
        type: 'scatter3d',
        mode: 'markers',
        x: unselectedIndices.map((i) => data.x[i]),
        y: unselectedIndices.map((i) => data.y[i]),
        z: unselectedIndices.map((i) => data.z[i]),
        text: unselectedIndices.map((i) => data.labels[i]),
        customdata: unselectedIndices.map((i) => data.sample_ids[i]),
        marker: {
          size: 4,
          color: data.color_scheme === 'continuous' 
            ? unselectedIndices.map((i) => data.colors[i] as number)
            : unselectedIndices.map((i) => data.colors[i] as string),
          colorscale: data.color_scheme === 'continuous' ? 'Viridis' : undefined,
          showscale: data.color_scheme === 'continuous',
          opacity: 0.7,
          line: {
            width: 0,
          },
        },
        hovertemplate: '<b>%{text}</b><br>x: %{x:.3f}<br>y: %{y:.3f}<br>z: %{z:.3f}<extra></extra>',
        name: 'Unselected',
        showlegend: false,
      });
    }

    // Selected points
    if (selectedIndices.length > 0) {
      traces.push({
        type: 'scatter3d',
        mode: 'markers',
        x: selectedIndices.map((i) => data.x[i]),
        y: selectedIndices.map((i) => data.y[i]),
        z: selectedIndices.map((i) => data.z[i]),
        text: selectedIndices.map((i) => data.labels[i]),
        customdata: selectedIndices.map((i) => data.sample_ids[i]),
        marker: {
          size: 6,
          color: '#ff4444',
          opacity: 1,
          line: {
            width: 1,
            color: '#ffffff',
          },
        },
        hovertemplate: '<b>%{text}</b><br>x: %{x:.3f}<br>y: %{y:.3f}<br>z: %{z:.3f}<extra></extra>',
        name: 'Selected',
        showlegend: false,
      });
    }

    return traces;
  }, [data, selectedSampleIds]);

  // Handle click selection
  const handleClick = useCallback(
    (event: any) => {
      if (!event.points || event.points.length === 0) return;

      const clickedPoint = event.points[0];
      const sampleId = clickedPoint.customdata;

      if (!sampleId) return;

      // Toggle selection
      const newSelection = selectedSampleIds.includes(sampleId)
        ? selectedSampleIds.filter((id) => id !== sampleId)
        : [...selectedSampleIds, sampleId];

      onSelectionChange(newSelection);
    },
    [selectedSampleIds, onSelectionChange]
  );

  // Handle box/lasso selection
  const handleSelected = useCallback(
    (event: any) => {
      if (!event || !event.points || event.points.length === 0) return;

      const selectedIds = event.points.map((point: any) => point.customdata).filter(Boolean);

      onSelectionChange(selectedIds);
    },
    [onSelectionChange]
  );

  // Layout configuration
  const layout = useMemo(
    () => ({
      autosize: true,
      margin: { l: 0, r: 0, t: 0, b: 0 },
      scene: {
        xaxis: {
          title: 'Component 1',
          showgrid: true,
          zeroline: false,
        },
        yaxis: {
          title: 'Component 2',
          showgrid: true,
          zeroline: false,
        },
        zaxis: {
          title: 'Component 3',
          showgrid: true,
          zeroline: false,
        },
        camera: {
          eye: { x: 1.5, y: 1.5, z: 1.5 },
        },
      },
      hovermode: 'closest',
      paper_bgcolor: 'transparent',
      plot_bgcolor: 'transparent',
    }),
    []
  );

  // Config
  const config = useMemo(
    () => ({
      displayModeBar: true,
      displaylogo: false,
      modeBarButtonsToAdd: ['select2d', 'lasso2d'] as any,
      modeBarButtonsToRemove: ['toImage'],
      responsive: true,
    }),
    []
  );

  if (!data || plotData.length === 0) {
    return (
      <div style={{ 
        display: 'flex', 
        alignItems: 'center', 
        justifyContent: 'center', 
        height: '100%',
        color: '#666'
      }}>
        No data to display
      </div>
    );
  }

  return (
    <Plot
      data={plotData as any}
      layout={layout as any}
      config={config}
      style={{ width: '100%', height: '100%' }}
      onClick={handleClick}
      onSelected={handleSelected}
      useResizeHandler={true}
    />
  );
};

export default Plot3D;

