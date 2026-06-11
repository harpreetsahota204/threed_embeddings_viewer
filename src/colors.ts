/**
 * Color helpers for the deck.gl point renderer.
 *
 * Point colors are uploaded to the GPU as a Uint8 RGB attribute buffer
 * (see deckScene.ts), so these helpers work in RGB tuples rather than
 * hex/css strings. Dimming blends a point's color toward the panel
 * background (solid colors, not alpha — translucent overdraw at scale
 * looks muddy).
 */

export type RGB = [number, number, number];

// Plotly's exact Viridis stops (kept for parity with the builtin panel and
// the legend gradient), pre-parsed to RGB once for the per-point colormap.
const VIRIDIS_STOPS: Array<[number, string]> = [
  [0, '#440154'],
  [0.06274509803921569, '#48186a'],
  [0.12549019607843137, '#472d7b'],
  [0.18823529411764706, '#424086'],
  [0.25098039215686274, '#3b528b'],
  [0.3137254901960784, '#33638d'],
  [0.3764705882352941, '#2c728e'],
  [0.4392156862745098, '#26828e'],
  [0.5019607843137255, '#21918c'],
  [0.5647058823529412, '#1fa088'],
  [0.6274509803921569, '#28ae80'],
  [0.6901960784313725, '#3fbc73'],
  [0.7529411764705882, '#5ec962'],
  [0.8156862745098039, '#84d44b'],
  [0.8784313725490196, '#addc30'],
  [0.9411764705882353, '#d8e219'],
  [1, '#fde725'],
];

function hexToRgb(hex: string): RGB {
  let h = hex.replace('#', '');
  if (h.length === 3) {
    h = h.replace(/./g, (c) => c + c);
  }
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

// Parses any CSS color (hex, rgb(), hsl(), named) by letting the browser
// normalize it through a canvas fillStyle. Cached: category palettes and
// the theme background are parsed repeatedly.
let canvasCtx: CanvasRenderingContext2D | null = null;
const cssColorCache = new Map<string, RGB>();

export function cssToRgb(color: string): RGB {
  const cached = cssColorCache.get(color);
  if (cached) return cached;

  if (!canvasCtx) {
    canvasCtx = document.createElement('canvas').getContext('2d');
  }

  let rgb: RGB = [128, 128, 128];
  if (canvasCtx) {
    canvasCtx.fillStyle = color;
    const normalized = canvasCtx.fillStyle as string;
    if (normalized.startsWith('#')) {
      rgb = hexToRgb(normalized);
    } else {
      const parts = normalized.match(/[\d.]+/g);
      if (parts && parts.length >= 3) {
        rgb = [Number(parts[0]), Number(parts[1]), Number(parts[2])];
      }
    }
  }

  cssColorCache.set(color, rgb);
  return rgb;
}

/** Blends `color` toward `background` by `amount` (0 = unchanged, 1 = bg) */
export function blendRgb(color: RGB, background: RGB, amount: number): RGB {
  return [
    color[0] + (background[0] - color[0]) * amount,
    color[1] + (background[1] - color[1]) * amount,
    color[2] + (background[2] - color[2]) * amount,
  ];
}

const VIRIDIS_RGB_STOPS: Array<[number, RGB]> = VIRIDIS_STOPS.map(
  ([t, hex]) => [t, hexToRgb(hex)]
);

/** Maps t in [0, 1] to a viridis RGB color (matches plotly's Viridis) */
export function viridisRgb(t: number): RGB {
  const clamped = Math.max(0, Math.min(1, t));
  for (let i = 1; i < VIRIDIS_RGB_STOPS.length; i++) {
    const [t1, rgb1] = VIRIDIS_RGB_STOPS[i];
    if (clamped <= t1) {
      const [t0, rgb0] = VIRIDIS_RGB_STOPS[i - 1];
      const f = (clamped - t0) / (t1 - t0);
      return [
        rgb0[0] + f * (rgb1[0] - rgb0[0]),
        rgb0[1] + f * (rgb1[1] - rgb0[1]),
        rgb0[2] + f * (rgb1[2] - rgb0[2]),
      ];
    }
  }
  return VIRIDIS_RGB_STOPS[VIRIDIS_RGB_STOPS.length - 1][1];
}

/** Loop-based min/max; Math.min(...values) overflows the stack on ~100k+ */
export function minMax(values: ArrayLike<number>): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { min, max };
}

/** CSS gradient matching the viridis colorscale, for the legend overlay */
export const VIRIDIS_CSS_GRADIENT = `linear-gradient(to top, ${VIRIDIS_STOPS.map(
  ([t, c]) => `${c} ${(t * 100).toFixed(1)}%`
).join(', ')})`;
