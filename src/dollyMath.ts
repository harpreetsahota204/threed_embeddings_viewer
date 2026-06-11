/** Pure math for cursor-dolly scroll zoom (see cursorDollyController.ts). */

const DOLLY_STRENGTH = 0.6;
const MAX_LATERAL_STEP = 0.35;
const MAX_DEPTH_STEP = 0.9;

/** deck OrbitController wheel-delta → relative scale (scale > 1 = zoom in). */
export function wheelZoomScale(delta: number, speed = 0.01): number {
  let scale = 2 / (1 + Math.exp(-Math.abs(delta * speed)));
  if (delta < 0 && scale !== 0) scale = 1 / scale;
  return scale;
}

/**
 * Advances target toward anchor on zoom-in. Depth pull keeps pace with
 * perspective scale so distant clusters don't recede; lateral pull is
 * gentler for a smooth centering feel.
 */
export function dollyTargetTowardAnchor(
  target: [number, number, number],
  anchor: [number, number, number],
  viewDir: [number, number, number],
  scale: number
): [number, number, number] {
  const [vx, vy, vz] = viewDir;
  const dx = anchor[0] - target[0];
  const dy = anchor[1] - target[1];
  const dz = anchor[2] - target[2];

  const depth = dx * vx + dy * vy + dz * vz;
  const lx = dx - depth * vx;
  const ly = dy - depth * vy;
  const lz = dz - depth * vz;

  const kLat = Math.min(MAX_LATERAL_STEP, (scale - 1) * DOLLY_STRENGTH);
  const kDepth = Math.min(MAX_DEPTH_STEP, Math.max(kLat, 1 - 1 / scale));

  return [
    target[0] + lx * kLat + vx * depth * kDepth,
    target[1] + ly * kLat + vy * depth * kDepth,
    target[2] + lz * kLat + vz * depth * kDepth,
  ];
}

/** Unit vector from camera position toward the view target. */
export function viewDirection(
  target: [number, number, number],
  camera: [number, number, number]
): [number, number, number] {
  let vx = target[0] - camera[0];
  let vy = target[1] - camera[1];
  let vz = target[2] - camera[2];
  const len = Math.hypot(vx, vy, vz) || 1;
  return [vx / len, vy / len, vz / len];
}
