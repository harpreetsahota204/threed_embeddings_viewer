/**
 * Module-level camera storage so the user's camera survives panel
 * remounts (applying a selection changes the view, which reloads the page
 * query and remounts the panel subtree). Reset when the geometry source
 * changes so eg a 2D visualization doesn't inherit a 3D camera.
 */

interface Aspect {
  x: number;
  y: number;
  z: number;
}

let savedCamera: any = null;

// Orthographic (2D) zoom is an aspectratio scale, not a camera move, so
// it must be saved/restored alongside the camera
let savedAspectratio: Aspect | null = null;

// The scene's pristine aspectratio (plotly computes it from the data),
// snapshotted at first scene creation so Reset View can restore it after
// ortho zooming
let defaultAspectratio: Aspect | null = null;

export function getSavedCamera(): any {
  return savedCamera;
}

export function setSavedCamera(camera: any) {
  savedCamera = camera;
}

export function getSavedAspectratio() {
  return savedAspectratio;
}

export function setSavedAspectratio(aspect: Aspect) {
  savedAspectratio = aspect;
}

export function getDefaultAspectratio() {
  return defaultAspectratio;
}

export function recordDefaultAspectratio(aspect: Aspect) {
  // Only the first (pristine) value counts; later scene creations may
  // already carry a restored zoom
  if (!defaultAspectratio) {
    defaultAspectratio = { ...aspect };
  }
}

/** Reset View: forget the user's camera/zoom, keep the plot defaults */
export function resetSavedCamera() {
  savedCamera = null;
  savedAspectratio = null;
}

/** New geometry (brain-key/dataset switch): forget everything */
export function resetCameraStore() {
  savedCamera = null;
  savedAspectratio = null;
  defaultAspectratio = null;
}
