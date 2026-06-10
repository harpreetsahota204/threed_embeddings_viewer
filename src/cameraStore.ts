/**
 * Module-level camera storage so the user's camera survives panel
 * remounts (applying a selection changes the view, which reloads the page
 * query and remounts the panel subtree). Reset when the geometry source
 * changes so eg a 2D visualization doesn't inherit a 3D camera.
 */

let savedCamera: any = null;

// Orthographic (2D) zoom is an aspectratio scale, not a camera move, so
// it must be saved/restored alongside the camera
let savedAspectratio: { x: number; y: number; z: number } | null = null;

export function getSavedCamera(): any {
  return savedCamera;
}

export function setSavedCamera(camera: any) {
  savedCamera = camera;
}

export function getSavedAspectratio() {
  return savedAspectratio;
}

export function setSavedAspectratio(aspect: {
  x: number;
  y: number;
  z: number;
}) {
  savedAspectratio = aspect;
}

export function resetSavedCamera() {
  savedCamera = null;
  savedAspectratio = null;
}
