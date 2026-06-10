/**
 * Color helpers for per-point trace styling.
 *
 * scatter3d does not support plotly's selected/unselected styling, so
 * dimming is achieved by computing explicit per-point colors. Solid colors
 * are used throughout: translucent (rgba) scatter3d markers render with
 * ugly WebGL blending artifacts, so dimming blends toward the panel
 * background color instead.
 */

type RGB = [number, number, number];

// Plotly's exact Viridis stops (plotly.js/src/components/colorscale/scales.js)
// so client-computed colors match what plotly renders via colorscale
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

function rgbToHex([r, g, b]: RGB): string {
  return `#${[r, g, b]
    .map((c) => Math.round(c).toString(16).padStart(2, '0'))
    .join('')}`;
}

// Parses any CSS color (hex, rgb(), hsl(), named) by letting the browser
// normalize it through a canvas fillStyle
let canvasCtx: CanvasRenderingContext2D | null = null;
const cssColorCache = new Map<string, RGB>();

function cssToRgb(color: string): RGB {
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
export function dimToward(
  color: string,
  background: string,
  amount: number
): string {
  const [r, g, b] = cssToRgb(color);
  const [br, bg_, bb] = cssToRgb(background);
  return rgbToHex([
    r + (br - r) * amount,
    g + (bg_ - g) * amount,
    b + (bb - b) * amount,
  ]);
}

// Stops pre-parsed to RGB once: viridis() runs per point on every
// recolor, and re-parsing hex strings there is wasted work at scale
const VIRIDIS_RGB_STOPS: Array<[number, RGB]> = VIRIDIS_STOPS.map(
  ([t, hex]) => [t, hexToRgb(hex)]
);

/** Maps t in [0, 1] to a viridis hex color (matches plotly's Viridis) */
function viridis(t: number): string {
  const clamped = Math.max(0, Math.min(1, t));
  for (let i = 1; i < VIRIDIS_RGB_STOPS.length; i++) {
    const [t1, rgb1] = VIRIDIS_RGB_STOPS[i];
    if (clamped <= t1) {
      const [t0, rgb0] = VIRIDIS_RGB_STOPS[i - 1];
      const f = (clamped - t0) / (t1 - t0);
      return rgbToHex([
        rgb0[0] + f * (rgb1[0] - rgb0[0]),
        rgb0[1] + f * (rgb1[1] - rgb0[1]),
        rgb0[2] + f * (rgb1[2] - rgb0[2]),
      ]);
    }
  }
  return VIRIDIS_STOPS[VIRIDIS_STOPS.length - 1][1];
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

/** Converts numeric color values to viridis hex colors */
export function numericToColors(values: ArrayLike<number>): string[] {
  const { min, max } = minMax(values);
  const range = max - min || 1;
  const out = new Array<string>(values.length);
  for (let i = 0; i < values.length; i++) {
    out[i] = viridis((values[i] - min) / range);
  }
  return out;
}

/** CSS gradient matching the viridis colorscale, for the legend overlay */
export const VIRIDIS_CSS_GRADIENT = `linear-gradient(to top, ${VIRIDIS_STOPS.map(
  ([t, c]) => `${c} ${(t * 100).toFixed(1)}%`
).join(', ')})`;
