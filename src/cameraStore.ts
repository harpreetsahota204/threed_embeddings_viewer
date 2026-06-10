/**
 * Module-level camera storage so the user's camera survives panel
 * remounts (applying a selection changes the view, which reloads the page
 * query and remounts the panel subtree). Reset when the geometry source
 * changes so eg a 2D visualization doesn't inherit a 3D camera.
 */

let savedCamera: any = null;

export function getSavedCamera(): any {
  return savedCamera;
}

export function setSavedCamera(camera: any) {
  savedCamera = camera;
}

export function resetSavedCamera() {
  savedCamera = null;
}
