/**
 * Transparent overlay for select mode. Captures a freehand lasso polygon
 * (drag), a single-point pick (click), or a mode toggle (double-click).
 * While mounted it swallows all pointer events, so the underlying 3D scene
 * does not rotate.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Point2D } from './lasso';
import { log } from './logger';

interface LassoOverlayProps {
  // Receives the polygon in client (viewport) coordinates
  onComplete: (polygon: Point2D[]) => void;
  // Receives a click position in client (viewport) coordinates
  onPick: (point: Point2D) => void;
  // Double-click: switch back to explore mode
  onToggleMode: () => void;
  onCancel: () => void;
  // The WebGL canvas, for forwarding wheel events so zoom keeps working
  // while the overlay swallows pointer events
  getCanvas: () => HTMLCanvasElement | null;
}

const MIN_POINT_DISTANCE = 3;
const CLICK_TOLERANCE = 5;
const DOUBLE_CLICK_MS = 350;
const DOUBLE_CLICK_TOLERANCE = 6;

const LassoOverlay: React.FC<LassoOverlayProps> = ({
  onComplete,
  onPick,
  onToggleMode,
  onCancel,
  getCanvas,
}) => {
  const overlayRef = useRef<HTMLDivElement>(null);
  const [path, setPath] = useState<Point2D[]>([]);
  const drawingRef = useRef(false);
  const lastClickRef = useRef<{ time: number; x: number; y: number } | null>(
    null
  );

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        log('select mode: Esc pressed, exiting');
        onCancel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onCancel]);

  // Forward wheel events to the WebGL canvas so zooming works in select
  // mode (non-passive so the page doesn't scroll)
  useEffect(() => {
    const el = overlayRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const canvas = getCanvas();
      canvas?.dispatchEvent(
        new WheelEvent('wheel', {
          deltaX: e.deltaX,
          deltaY: e.deltaY,
          deltaMode: e.deltaMode,
          clientX: e.clientX,
          clientY: e.clientY,
          ctrlKey: e.ctrlKey,
          bubbles: true,
          cancelable: true,
        })
      );
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [getCanvas]);

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
      const rect = overlayRef.current!.getBoundingClientRect();
      const toClient = (pt: Point2D) => ({
        x: pt.x + rect.left,
        y: pt.y + rect.top,
      });

      const start = finalPath[0];
      const isClick =
        start &&
        finalPath.every(
          (pt) => Math.hypot(pt.x - start.x, pt.y - start.y) < CLICK_TOLERANCE
        );

      if (isClick) {
        const client = toClient(start);
        const prev = lastClickRef.current;
        const isDoubleClick =
          prev &&
          performance.now() - prev.time < DOUBLE_CLICK_MS &&
          Math.hypot(client.x - prev.x, client.y - prev.y) <
            DOUBLE_CLICK_TOLERANCE;

        if (isDoubleClick) {
          // Suppress the pick: this click is the second half of a
          // double-click, not a selection gesture
          log('select mode: double-click detected, toggling to explore mode');
          lastClickRef.current = null;
          onToggleMode();
        } else {
          lastClickRef.current = { time: performance.now(), ...client };
          onPick(client);
        }
      } else if (finalPath.length >= 3) {
        lastClickRef.current = null;
        onComplete(finalPath.map(toClient));
      }
      return [];
    });
  }, [onComplete, onPick, onToggleMode]);

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
        cursor: 'pointer',
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
