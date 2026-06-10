/**
 * Cursor-anchored wheel zoom ("zoom toward where the mouse points").
 *
 * plotly's gl3d wheel zoom ignores the cursor entirely: in perspective
 * it dollies the camera along the view axis toward the scene CENTER
 * (3d-view-controls `view.pan(0, 0, dz)`), and in orthographic it
 * scales the aspectratio uniformly. This hook intercepts wheel events
 * in the capture phase (suppressing plotly's handlers) and re-implements
 * zoom anchored at the plotted point nearest the cursor, so that point
 * stays fixed on screen while the scene scales around it — map-style
 * zoom. With no point near the cursor, it falls back to plotly's
 * center-zoom behavior.
 */

import { useEffect, useRef } from 'react';
import { PlotData } from './State';
import { dataToCameraSpace, pickNearestPoint } from './lasso';

// Zoom factor = exp(deltaY * sensitivity); ~0.9x per standard wheel
// tick, matching plotly's feel
const WHEEL_SENSITIVITY = 0.0011;

// Generous: zooming "toward that cluster" should anchor even when the
// cursor is near, not exactly on, a dot
const ANCHOR_RADIUS_PX = 80;

// Reuse the picked anchor while the wheel keeps spinning around the same
// cursor position — picking is O(points), wheel ticks are frequent
const ANCHOR_CACHE_MS = 250;
const ANCHOR_CACHE_PX = 12;

export interface Aspectratio {
  x: number;
  y: number;
  z: number;
}

interface AnchorCache {
  x: number;
  y: number;
  t: number;
  anchor: number[] | null;
}

export function useCursorZoom(
  areaRef: React.RefObject<HTMLDivElement | null>,
  plotRef: React.MutableRefObject<any>,
  plotData: PlotData | null,
  distanceLimits: number[],
  // Called after every applied zoom step; aspect is non-null when the
  // zoom changed the aspectratio (orthographic mode)
  onZoomed: (aspect: Aspectratio | null) => void
) {
  const anchorCacheRef = useRef<AnchorCache | null>(null);

  useEffect(() => {
    const el = areaRef.current;
    if (!el || !plotData) return;

    const pickAnchor = (
      gd: any,
      x: number,
      y: number
    ): number[] | null => {
      const cached = anchorCacheRef.current;
      const now = performance.now();
      if (
        cached &&
        now - cached.t < ANCHOR_CACHE_MS &&
        Math.hypot(x - cached.x, y - cached.y) < ANCHOR_CACHE_PX
      ) {
        cached.t = now;
        return cached.anchor;
      }

      const index = pickNearestPoint(
        gd,
        plotData,
        { x, y },
        ANCHOR_RADIUS_PX
      );
      const anchor =
        index === null
          ? null
          : dataToCameraSpace(
              gd,
              plotData.x[index],
              plotData.y[index],
              plotData.z[index]
            );

      anchorCacheRef.current = { x, y, t: now, anchor };
      return anchor;
    };

    const onWheel = (e: WheelEvent) => {
      // Horizontal wheel is plotly's scene-spin gesture; leave it alone
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;

      const gd = plotRef.current?.el;
      const scene = gd?._fullLayout?.scene?._scene;
      if (!scene?.glplot || !scene.camera) return;
      if (gd._context?._scrollZoom?.gl3d === false) return;

      // Suppress plotly's center-zoom handlers (camera wheelListener +
      // the scene-level ortho aspectratio handler)
      e.preventDefault();
      e.stopPropagation();

      // Normalize line/page wheel modes to pixels
      const deltaY =
        e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1);
      const f = Math.exp(deltaY * WHEEL_SENSITIVITY); // <1 zooms in

      const camera = scene.getCamera();
      const { eye, center, up } = camera;
      const zoomingIn = f < 1;
      // Only re-anchor the orbit pivot (camera center) when zooming IN.
      // On zoom-OUT, moving the center toward the cursor pushes it
      // *beyond* its current position (factor f > 1), so repeated
      // zoom-outs at scattered cursor positions drift the pivot outside
      // the point cloud — after which orbiting swings the whole cloud
      // across the screen and feels like panning. Zoom-out therefore
      // dollies around the existing center (pivot stays on the data).
      const anchor = zoomingIn ? pickAnchor(gd, e.clientX, e.clientY) : null;

      if (scene.camera._ortho) {
        // Ortho zoom = scaling the aspectratio (camera distance has no
        // visual effect). Scaling the scene by s moves the anchor's
        // world position from a to s*a; shifting the camera by
        // (s-1)*a keeps it fixed on screen.
        const s = 1 / f;
        const o = scene.glplot.getAspectratio();
        const aspect = { x: s * o.x, y: s * o.y, z: s * o.z };
        scene.glplot.setAspectratio(aspect);

        if (anchor) {
          const [ax, ay, az] = anchor;
          scene.camera.lookAt(
            [
              eye.x + (s - 1) * ax,
              eye.y + (s - 1) * ay,
              eye.z + (s - 1) * az,
            ],
            [
              center.x + (s - 1) * ax,
              center.y + (s - 1) * ay,
              center.z + (s - 1) * az,
            ],
            [up.x, up.y, up.z]
          );
        }

        onZoomed(aspect);
        return;
      }

      // Perspective: scale eye AND center toward the anchor; the
      // anchored point's projection is invariant under this transform,
      // and the camera distance scales by f exactly like a plain dolly.
      // anchor is null on zoom-out (and over empty space), where this
      // degenerates to a pure dolly around the existing center.
      const distance = Math.hypot(
        eye.x - center.x,
        eye.y - center.y,
        eye.z - center.z
      );
      const next = distance * f;
      if (next < distanceLimits[0] || next > distanceLimits[1]) return;

      const [ax, ay, az] = anchor ?? [center.x, center.y, center.z];
      scene.camera.lookAt(
        [
          ax + (eye.x - ax) * f,
          ay + (eye.y - ay) * f,
          az + (eye.z - az) * f,
        ],
        [
          ax + (center.x - ax) * f,
          ay + (center.y - ay) * f,
          az + (center.z - az) * f,
        ],
        [up.x, up.y, up.z]
      );

      onZoomed(null);
    };

    el.addEventListener('wheel', onWheel, { capture: true, passive: false });
    return () =>
      el.removeEventListener('wheel', onWheel, { capture: true });
  }, [areaRef, plotRef, plotData, distanceLimits, onZoomed]);
}
