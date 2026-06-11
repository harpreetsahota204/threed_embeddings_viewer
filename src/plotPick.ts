/** GPU picking helpers for the scatter plot layer. */

export const PICK_RADIUS = 8;
export const HOVER_PICK_INTERVAL_MS = 50;

interface PickableDeck {
  pickObject(opts: {
    x: number;
    y: number;
    radius: number;
    layerIds: string[];
  }): { index?: number | null } | null;
}

/** Returns a point index at client coords, or null if off-plot / empty. */
export function pickPointIndex(
  deck: PickableDeck,
  plotArea: HTMLElement,
  clientX: number,
  clientY: number,
  radius = PICK_RADIUS
): number | null {
  const rect = plotArea.getBoundingClientRect();
  const x = clientX - rect.left;
  const y = clientY - rect.top;
  if (x < 0 || y < 0 || x > rect.width || y > rect.height) return null;

  const index = deck.pickObject({ x, y, radius, layerIds: ['points'] })?.index;
  return index == null || index < 0 ? null : index;
}
