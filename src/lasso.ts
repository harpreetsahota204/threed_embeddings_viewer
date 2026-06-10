/**
 * Lasso selection support for 3D scatter plots.
 *
 * Plotly's scatter3d traces do not support native box/lasso selection, so we
 * project every 3D point into screen space using the scene's camera matrices
 * (the same math plotly uses internally to position hover labels; see
 * plotly.js/src/plots/gl3d/project.js) and test each projected point against
 * a user-drawn polygon.
 */

import { PlotData } from './State';
import { logError } from './logger';

export interface Point2D {
  x: number;
  y: number;
}

interface CameraParams {
  model: number[];
  view: number[];
  projection: number[];
}

// out = m * v for a column-major 4x4 matrix
function xformMatrix(m: number[], v: number[]): number[] {
  const out = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 4; j++) {
      out[j] += m[4 * i + j] * v[i];
    }
  }
  return out;
}

function project(camera: CameraParams, v: number[]): number[] {
  return xformMatrix(
    camera.projection,
    xformMatrix(camera.view, xformMatrix(camera.model, [v[0], v[1], v[2], 1]))
  );
}

/** Ray-casting point-in-polygon test */
function pointInPolygon(pt: Point2D, polygon: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    if (
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi
    ) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Returns the sample IDs whose projected screen positions fall inside the
 * polygon, which must be given in client (viewport) coordinates.
 */
export function selectIdsInLasso(
  gd: any,
  plotData: PlotData,
  polygon: Point2D[]
): string[] {
  const scene = gd?._fullLayout?.scene?._scene;
  const glplot = scene?.glplot;
  if (!glplot?.cameraParams || !scene.dataScale || !scene.container) {
    logError('3D scene internals unavailable; cannot lasso select');
    return [];
  }

  const camera = glplot.cameraParams as CameraParams;
  const [sx, sy, sz] = scene.dataScale as number[];
  const rect = scene.container.getBoundingClientRect();

  const ids: string[] = [];
  for (let i = 0; i < plotData.sample_ids.length; i++) {
    const p = project(camera, [
      plotData.x[i] * sx,
      plotData.y[i] * sy,
      plotData.z[i] * sz,
    ]);

    // Skip points behind the camera
    if (p[3] <= 0) continue;

    const screen = {
      x: rect.left + (0.5 + (0.5 * p[0]) / p[3]) * rect.width,
      y: rect.top + (0.5 - (0.5 * p[1]) / p[3]) * rect.height,
    };

    if (pointInPolygon(screen, polygon)) {
      ids.push(plotData.sample_ids[i]);
    }
  }

  return ids;
}
