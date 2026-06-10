/**
 * Transparent overlay that captures a freehand lasso polygon over the plot.
 * While mounted it swallows all pointer events, so the underlying 3D scene
 * does not rotate during the drag.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Point2D } from './lasso';

interface LassoOverlayProps {
  // Receives the polygon in client (viewport) coordinates
  onComplete: (polygon: Point2D[]) => void;
  onCancel: () => void;
}

const MIN_POINT_DISTANCE = 3;

const LassoOverlay: React.FC<LassoOverlayProps> = ({
  onComplete,
  onCancel,
}) => {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [path, setPath] = useState<Point2D[]>([]);
  const drawingRef = useRef(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  const toLocal = useCallback((e: React.PointerEvent): Point2D => {
    const rect = overlayRef.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      drawingRef.current = true;
      setPath([toLocal(e)]);
    },
    [toLocal]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!drawingRef.current) return;
      const pt = toLocal(e);
      setPath((prev) => {
        const last = prev[prev.length - 1];
        if (
          last &&
          Math.hypot(pt.x - last.x, pt.y - last.y) < MIN_POINT_DISTANCE
        ) {
          return prev;
        }
        return [...prev, pt];
      });
    },
    [toLocal]
  );

  const handlePointerUp = useCallback(() => {
    if (!drawingRef.current) return;
    drawingRef.current = false;

    setPath((finalPath) => {
      if (finalPath.length < 3) {
        onCancel();
      } else {
        const rect = overlayRef.current!.getBoundingClientRect();
        onComplete(
          finalPath.map((pt) => ({ x: pt.x + rect.left, y: pt.y + rect.top }))
        );
      }
      return [];
    });
  }, [onComplete, onCancel]);

  const svgPath = path.map((pt) => `${pt.x},${pt.y}`).join(' ');

  return (
    <div
      ref={overlayRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 10,
        cursor: 'crosshair',
        touchAction: 'none',
      }}
    >
      <svg width="100%" height="100%" style={{ display: 'block' }}>
        {path.length > 1 && (
          <polygon
            points={svgPath}
            fill="rgba(255, 152, 0, 0.1)"
            stroke="#ff9800"
            strokeWidth={1.5}
            strokeDasharray="6 4"
          />
        )}
      </svg>
    </div>
  );
};

export default LassoOverlay;
