/**
 * Module-level store for the 3D world point currently under the cursor, used
 * by CursorDollyOrbitController to dolly the camera toward what you're
 * pointing at on scroll-zoom (a "fly into the cloud" feel, vs deck's default
 * scale-around-the-target-plane zoom).
 *
 * The value is written by the panel's hover pick (which already runs on
 * pointer-move and yields a point index), so the dolly anchor costs zero
 * extra GPU work during zoom — it's a plain array lookup. During a scroll the
 * cursor is stationary, so the last hovered point remains the correct anchor.
 * Cleared when the cursor is over empty space or leaves the plot.
 */

let anchor: [number, number, number] | null = null;

export function getDollyAnchor(): [number, number, number] | null {
  return anchor;
}

export function setDollyAnchor(point: [number, number, number]) {
  anchor = point;
}

export function clearDollyAnchor() {
  anchor = null;
}
