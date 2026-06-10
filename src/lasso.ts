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

// Column-major 4×4 multiply (gl-matrix / plotly layout)
function mul4x4(a: number[], b: number[]): number[] {
  const out = new Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[k * 4 + row] * b[col * 4 + k];
      }
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

function clipMatrix(camera: CameraParams): number[] {
  return mul4x4(camera.projection, mul4x4(camera.view, camera.model));
}

// clip = M * [x, y, z, 1]; returns client coords or null if behind camera
function toClientCoords(
  m: number[],
  rect: DOMRect,
  x: number,
  y: number,
  z: number
): Point2D | null {
  const px = m[0] * x + m[4] * y + m[8] * z + m[12];
  const py = m[1] * x + m[5] * y + m[9] * z + m[13];
  const pw = m[3] * x + m[7] * y + m[11] * z + m[15];
  if (pw <= 0) return null;

  const invW = 0.5 / pw;
  return {
    x: rect.left + (0.5 + px * invW) * rect.width,
    y: rect.top + (0.5 - py * invW) * rect.height,
  };
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

  const m = glplot.cameraParams.model as number[];
  const [sx, sy, sz] = scene.dataScale as number[];
  const dx = x * sx;
  const dy = y * sy;
  const dz = z * sz;
  const wx = m[0] * dx + m[4] * dy + m[8] * dz + m[12];
  const wy = m[1] * dx + m[5] * dy + m[9] * dz + m[13];
  const wz = m[2] * dx + m[6] * dy + m[10] * dz + m[14];
  const ww = m[3] * dx + m[7] * dy + m[11] * dz + m[15];
  return [wx / ww, wy / ww, wz / ww];
}

/** Projects a single data point to client (viewport) coordinates */
export function projectPointToClient(
  gd: any,
  x: number,
  y: number,
  z: number
): Point2D | null {
  const internals = getSceneInternals(gd);
  if (!internals) return null;

  const [sx, sy, sz] = internals.dataScale;
  const m = clipMatrix(internals.camera);
  return toClientCoords(m, internals.rect, x * sx, y * sy, z * sz);
}

/**
 * Returns the index of the point nearest to `target` (client coordinates)
 * within `radius` pixels, or null if none is close enough.
 *
 * Premultiplies projection·view·model once and scans with no per-point
 * allocations (the old path allocated ~5 objects per point).
 */
export function pickNearestPoint(
  gd: any,
  plotData: PlotData,
  target: Point2D,
  radius = 12
): number | null {
  const internals = getSceneInternals(gd);
  if (!internals) return null;

  const [sx, sy, sz] = internals.dataScale;
  const m = clipMatrix(internals.camera);
  const { rect } = internals;
  const radius2 = radius * radius;
  const tx = target.x;
  const ty = target.y;

  let best = -1;
  let bestDist2 = radius2;

  const xs = plotData.x;
  const ys = plotData.y;
  const zs = plotData.z;
  const n = plotData.count;

  for (let i = 0; i < n; i++) {
    const dx = xs[i] * sx;
    const dy = ys[i] * sy;
    const dz = zs[i] * sz;

    const px = m[0] * dx + m[4] * dy + m[8] * dz + m[12];
    const py = m[1] * dx + m[5] * dy + m[9] * dz + m[13];
    const pw = m[3] * dx + m[7] * dy + m[11] * dz + m[15];
    if (pw <= 0) continue;

    const invW = 0.5 / pw;
    const cx = rect.left + (0.5 + px * invW) * rect.width;
    const cy = rect.top + (0.5 - py * invW) * rect.height;

    const ddx = cx - tx;
    const ddy = cy - ty;
    const dist2 = ddx * ddx + ddy * ddy;
    if (dist2 < bestDist2) {
      bestDist2 = dist2;
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
