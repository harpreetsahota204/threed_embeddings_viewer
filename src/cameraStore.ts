/**
 * Module-level deck.gl OrbitView view-state storage so the user's camera
 * survives panel remounts (applying a selection changes the view, which
 * reloads the page query and remounts the panel subtree). Reset when the
 * geometry source changes so e.g. a 2D visualization doesn't inherit a 3D
 * camera.
 */

export interface DeckViewState {
  target: [number, number, number];
  rotationX: number;
  rotationOrbit: number;
  zoom: number;
}

let savedViewState: DeckViewState | null = null;

export function getSavedViewState(): DeckViewState | null {
  return savedViewState;
}

export function setSavedViewState(viewState: DeckViewState) {
  savedViewState = viewState;
}

/** New geometry (brain-key/dataset switch): forget the saved camera */
export function resetCameraStore() {
  savedViewState = null;
}
