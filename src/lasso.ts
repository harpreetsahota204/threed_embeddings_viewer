/**
 * Screen-space projection support for the 3D scatter plot.
 *
 * Plotly's scatter3d traces have no native picking/selection, so hover and
 * click picking project points into screen space using the scene's camera
 * matrices (the same math plotly uses internally to position hover labels;
 * see plotly.js/src/plots/gl3d/project.js). Lasso resolution happens
 * server-side (the apply_selection operator runs this same projection in
 * numpy over all points); the frontend only ships the polygon and the
 * camera parameters via getProjectionParams().
 */

import { PlotData } from './State';

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

interface SceneInternals {
  camera: CameraParams;
  dataScale: number[];
  rect: DOMRect;
}

function getSceneInternals(gd: any): SceneInternals | null {
  const scene = gd?._fullLayout?.scene?._scene;
  const glplot = scene?.glplot;
  if (!glplot?.cameraParams || !scene.dataScale || !scene.container) {
    return null;
  }

  return {
    camera: glplot.cameraParams as CameraParams,
    dataScale: scene.dataScale as number[],
    rect: scene.container.getBoundingClientRect(),
  };
}

function toClient(
  { camera, dataScale: [sx, sy, sz], rect }: SceneInternals,
  x: number,
  y: number,
  z: number
): Point2D | null {
  const p = project(camera, [x * sx, y * sy, z * sz]);

  // Behind the camera
  if (p[3] <= 0) return null;

  return {
    x: rect.left + (0.5 + (0.5 * p[0]) / p[3]) * rect.width,
    y: rect.top + (0.5 - (0.5 * p[1]) / p[3]) * rect.height,
  };
}

/**
 * Maps a data point into the camera's world space — the space that
 * `scene.getCamera()`'s eye/center coordinates live in (dataScale, then
 * the scene model matrix). Used to anchor cursor-centered zoom.
 */
export function dataToCameraSpace(
  gd: any,
  x: number,
  y: number,
  z: number
): number[] | null {
  const scene = gd?._fullLayout?.scene?._scene;
  const glplot = scene?.glplot;
  if (!glplot?.cameraParams?.model || !scene.dataScale) return null;

  const [sx, sy, sz] = scene.dataScale as number[];
  const v = xformMatrix(glplot.cameraParams.model, [
    x * sx,
    y * sy,
    z * sz,
    1,
  ]);
  return [v[0] / v[3], v[1] / v[3], v[2] / v[3]];
}

/** Projects a single data point to client (viewport) coordinates */
export function projectPointToClient(
  gd: any,
  x: number,
  y: number,
  z: number
): Point2D | null {
  const internals = getSceneInternals(gd);
  return internals && toClient(internals, x, y, z);
}

/**
 * Returns the index of the point nearest to `target` (client coordinates)
 * within `radius` pixels, or null if none is close enough.
 */
export function pickNearestPoint(
  gd: any,
  plotData: PlotData,
  target: Point2D,
  radius = 12
): number | null {
  const internals = getSceneInternals(gd);
  if (!internals) return null;

  let best = -1;
  let bestDistance = radius;
  for (let i = 0; i < plotData.count; i++) {
    const screen = toClient(internals, plotData.x[i], plotData.y[i], plotData.z[i]);
    if (!screen) continue;

    const distance = Math.hypot(screen.x - target.x, screen.y - target.y);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }

  return best >= 0 ? best : null;
}

export interface ProjectionParams {
  camera: { model: number[]; view: number[]; projection: number[] };
  data_scale: number[];
  rect: { left: number; top: number; width: number; height: number };
}

/**
 * Snapshots the scene's projection state (camera matrices, data scale,
 * container rect) for server-side lasso resolution.
 */
export function getProjectionParams(gd: any): ProjectionParams | null {
  const internals = getSceneInternals(gd);
  if (!internals) return null;

  const { camera, dataScale, rect } = internals;
  return {
    camera: {
      model: Array.from(camera.model),
      view: Array.from(camera.view),
      projection: Array.from(camera.projection),
    },
    data_scale: Array.from(dataScale),
    rect: {
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    },
  };
}
