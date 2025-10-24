/**
 * Control panel for 3D embeddings viewer
 */

import React from 'react';
import { useRecoilValue } from 'recoil';
import { numPointsSelector, numSelectedSelector } from './state';

interface ControlsProps {
  onLoadVisualization: () => void;
  onClearSelection: () => void;
  isLoading: boolean;
}

const Controls: React.FC<ControlsProps> = ({
  onLoadVisualization,
  onClearSelection,
  isLoading,
}) => {
  const numPoints = useRecoilValue(numPointsSelector);
  const numSelected = useRecoilValue(numSelectedSelector);

  return (
    <div style={{
      padding: '12px',
      borderBottom: '1px solid var(--fo-palette-divider, #e0e0e0)',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      flexWrap: 'wrap',
      backgroundColor: 'var(--fo-palette-background-level1, #fafafa)',
    }}>
      {/* Load visualization button */}
      <button
        onClick={onLoadVisualization}
        disabled={isLoading}
        style={{
          padding: '8px 16px',
          backgroundColor: 'var(--fo-palette-primary-main, #3b5acf)',
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: isLoading ? 'not-allowed' : 'pointer',
          fontSize: '14px',
          fontWeight: 500,
          opacity: isLoading ? 0.6 : 1,
        }}
      >
        {isLoading ? 'Loading...' : 'Load Visualization'}
      </button>

      {/* Clear selection button */}
      {numSelected > 0 && (
        <button
          onClick={onClearSelection}
          style={{
            padding: '8px 16px',
            backgroundColor: 'transparent',
            color: 'var(--fo-palette-text-secondary, #666)',
            border: '1px solid var(--fo-palette-divider, #e0e0e0)',
            borderRadius: '4px',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: 500,
          }}
        >
          Clear Selection
        </button>
      )}

      {/* Stats */}
      <div style={{ 
        marginLeft: 'auto',
        display: 'flex',
        gap: '16px',
        fontSize: '14px',
        color: 'var(--fo-palette-text-secondary, #666)',
      }}>
        {numPoints > 0 && (
          <>
            <span>
              <strong>Points:</strong> {numPoints.toLocaleString()}
            </span>
            {numSelected > 0 && (
              <span style={{ color: 'var(--fo-palette-primary-main, #3b5acf)' }}>
                <strong>Selected:</strong> {numSelected.toLocaleString()}
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default Controls;

