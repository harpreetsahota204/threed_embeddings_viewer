/**
 * Projection support for server-side lasso resolution.
 *
 * deck.gl handles all picking on the GPU (hover/click), so the only
 * projection we still snapshot is for the lasso: the polygon plus the
 * scene's view-projection matrix go to the apply_selection operator,
 * which projects all points in numpy and runs point-in-polygon there
 * (id lists never cross the wire). The matrix is deck's
 * `viewport.viewProjectionMatrix` (column-major / gl-matrix layout); the
 * server replicates the standard NDC->screen mapping using the viewport
 * rect.
 */

export interface Point2D {
  x: number;
  y: number;
}

export interface ProjectionParams {
  // deck.gl viewport.viewProjectionMatrix (column-major, 16 elements)
  matrix: number[];
  // Viewport size in CSS pixels + the canvas offset in client coords, so
  // the server can map projected points into the same client-space the
  // lasso polygon was drawn in
  rect: { left: number; top: number; width: number; height: number };
}

/**
 * Snapshots the deck viewport's view-projection matrix and screen rect
 * for server-side lasso resolution. `canvasRect` is the deck canvas's
 * bounding rect in client coordinates.
 */
export function getDeckProjection(
  deck: any,
  canvasRect: { left: number; top: number }
): ProjectionParams | null {
  const viewport = deck?.getViewports?.()[0];
  if (!viewport?.viewProjectionMatrix) return null;

  return {
    matrix: Array.from(viewport.viewProjectionMatrix as number[]),
    rect: {
      left: canvasRect.left,
      top: canvasRect.top,
      width: viewport.width,
      height: viewport.height,
    },
  };
}
