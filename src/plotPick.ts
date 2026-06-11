/** GPU picking helpers for the scatter plot layer. */

export const PICK_RADIUS = 8;
export const HOVER_PICK_INTERVAL_MS = 50;

// Wait for the cursor to settle on a point before fetching its sample
// info. Sweeping across the cloud changes the picked index every few ms;
// without this, each intermediate point fires its own get_sample_info
// operator call, flooding the backend with concurrent requests. Resolved
// points are cached, so this only gates the first lookup per point.
export const HOVER_INFO_DEBOUNCE_MS = 120;

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
