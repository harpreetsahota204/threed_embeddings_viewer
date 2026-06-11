/**
 * deck.gl scene helpers: GPU attribute buffers, scatter layers, camera
 * fit, and OrbitView frustum sizing.
 *
 * Buffers are typed arrays uploaded as deck binary attributes (no per-
 * point accessor callbacks). The position buffer is built once per
 * geometry load and kept stable so deck only re-uploads colors/radii on
 * selection changes.
 */

import { OrbitView } from '@deck.gl/core';
import { ArcLayer, LineLayer, ScatterplotLayer } from '@deck.gl/layers';
import { PlotData, PlotColors } from './State';
import { RGB, blendRgb, cssToRgb, viridisRgb, minMax } from './colors';
import { DeckViewState } from './cameraStore';

// Matches deck OrbitView default fovy; used for far-plane sizing.
const ORBIT_FOVY = 50;

const RADIUS_WORLD_FRAC = 0.004;
const PIXEL_RADIUS_SCALE_2D = 2.5;
const HALO_MAX_PIXELS_3D = 26;

// Relative point radii (unitless multipliers); actual size from radiusScale.
const BASE_RADIUS = 1.0;
const DIMMED_RADIUS = 0.72;
const CHECKED_RADIUS = 1.6;
const HALO_SCALE = 2.4;
const HALO_LIMIT = 50000;

const UNIFORM_RGB: RGB = cssToRgb('#1f77b4');
const SELECTED_RGB: RGB = [255, 152, 0];
const SIM_SOURCE_RGB: RGB = [255, 152, 0];
const SIM_NEIGHBOR_RGB: RGB = [255, 193, 7];
const DIM_AMOUNT = 0.8;

export interface SimilarNeighbor {
  index: number;
  // Position in the similarity ranking (0 = closest neighbor)
  rank: number;
}

export interface SimilarityFocus {
  sourceIndex: number;
  neighborIndices: Set<number>;
}

interface ScatterSizing {
  radiusUnits: 'pixels' | 'common';
  radiusScale: number;
  radiusMinPixels?: number;
  radiusMaxPixels?: number;
}

export interface SceneBounds {
  center: [number, number, number];
  maxExtent: number;
}

export interface SceneBuffers {
  colors: Uint8Array;
  radii: Float32Array;
  halo: {
    positions: Float32Array;
    colors: Uint8Array;
    radii: Float32Array;
  };
}

/** Focal distance for deck's default OrbitView perspective projection. */
function orbitFocalDistance(): number {
  return 0.5 / Math.tan((ORBIT_FOVY * Math.PI) / 360);
}

/**
 * Point radius config. 3D uses world units clamped to a pixel range so
 * points grow on fly-in; 2D uses fixed pixels. radiusScale is calibrated
 * so the fitted overview lands near ~2.8px regardless of coordinate scale.
 */
function scatterSizing(is2D: boolean, maxExtent: number): ScatterSizing {
  if (is2D) {
    return { radiusUnits: 'pixels', radiusScale: PIXEL_RADIUS_SCALE_2D };
  }
  return {
    radiusUnits: 'common',
    radiusScale: maxExtent * RADIUS_WORLD_FRAC,
    radiusMinPixels: 1.5,
    radiusMaxPixels: 10,
  };
}

/**
 * Grows the far clip plane with zoom so scaled geometry stays inside the
 * frustum (OrbitView zoom is a scale, not a dolly).
 */
function computeOrbitFar(
  maxExtent: number,
  zoom: number,
  viewportHeight: number
): number {
  const scale = Math.pow(2, zoom) / Math.max(viewportHeight, 1);
  return Math.max(1000, orbitFocalDistance() + (maxExtent / 2) * scale * 3);
}

/** OrbitView with zoom-dependent far plane for 3D frustum bracketing. */
export function buildOrbitView(
  is2D: boolean,
  bounds: SceneBounds | null,
  zoom: number,
  viewportHeight: number
): OrbitView {
  const base = {
    orthographic: is2D,
    orbitAxis: is2D ? ('Y' as const) : ('Z' as const),
  };
  if (is2D || !bounds) return new OrbitView(base);
  return new OrbitView({
    ...base,
    far: computeOrbitFar(bounds.maxExtent, zoom, viewportHeight),
  });
}

export function pointAt(
  plotData: PlotData,
  index: number
): [number, number, number] {
  return [plotData.x[index], plotData.y[index], plotData.z[index]];
}

const SCATTER_BASE = {
  billboard: true,
  stroked: false,
} as const;

/** Halo (selection glow) + main points ScatterplotLayers. */
export function buildScatterLayers(opts: {
  count: number;
  positions: Float32Array;
  sceneBuffers: SceneBuffers;
  is2D: boolean;
  maxExtent: number;
}): ScatterplotLayer[] {
  const { count, positions, sceneBuffers, is2D, maxExtent } = opts;
  const sizing = scatterSizing(is2D, maxExtent);
  const layers: ScatterplotLayer[] = [];
  const { halo } = sceneBuffers;

  if (halo.radii.length > 0) {
    layers.push(
      new ScatterplotLayer({
        id: 'halo',
        data: {
          length: halo.radii.length,
          attributes: {
            getPosition: { value: halo.positions, size: 3 },
            getFillColor: { value: halo.colors, size: 3 },
            getRadius: { value: halo.radii, size: 1 },
          },
        },
        ...sizing,
        ...SCATTER_BASE,
        radiusMaxPixels: is2D ? sizing.radiusMaxPixels : HALO_MAX_PIXELS_3D,
        opacity: 0.25,
        pickable: false,
        parameters: { depthTest: false, depthMask: false },
      })
    );
  }

  layers.push(
    new ScatterplotLayer({
      id: 'points',
      data: {
        length: count,
        attributes: {
          getPosition: { value: positions, size: 3 },
          getFillColor: { value: sceneBuffers.colors, size: 3 },
          getRadius: { value: sceneBuffers.radii, size: 1 },
        },
      },
      ...sizing,
      ...SCATTER_BASE,
      opacity: 0.85,
      pickable: true,
      antialiasing: is2D,
      parameters: { depthTest: !is2D },
    })
  );

  return layers;
}

/** Interleaves the x/y/z typed arrays into a single [x,y,z,...] buffer. */
export function buildPositions(plotData: PlotData): Float32Array {
  const { x, y, z, count } = plotData;
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    positions[i * 3] = x[i];
    positions[i * 3 + 1] = y[i];
    positions[i * 3 + 2] = z[i];
  }
  return positions;
}

export function computeBounds(plotData: PlotData): SceneBounds {
  const { x, y, z, count } = plotData;
  const bx = minMax(x.subarray(0, count));
  const by = minMax(y.subarray(0, count));
  const bz = minMax(z.subarray(0, count));
  const maxExtent = Math.max(
    bx.max - bx.min,
    by.max - by.min,
    bz.max - bz.min,
    1e-6
  );
  return {
    center: [
      (bx.min + bx.max) / 2,
      (by.min + by.max) / 2,
      (bz.min + bz.max) / 2,
    ],
    maxExtent,
  };
}

/**
 * Base (unselected, undimmed) per-point RGB buffer. Uniform color when
 * uncolored, viridis for continuous fields, category color for
 * categorical.
 */
export function buildBaseColors(
  plotData: PlotData,
  colors: PlotColors | null
): Uint8Array {
  const count = plotData.count;
  const out = new Uint8Array(count * 3);

  if (!colors) {
    for (let o = 0; o < count * 3; o += 3) {
      out[o] = UNIFORM_RGB[0];
      out[o + 1] = UNIFORM_RGB[1];
      out[o + 2] = UNIFORM_RGB[2];
    }
    return out;
  }

  if (colors.color_scheme === 'continuous') {
    const values = colors.colors!;
    const { min, max } = minMax(values);
    const range = max - min || 1;
    for (let i = 0; i < count; i++) {
      const [r, g, b] = viridisRgb((values[i] - min) / range);
      out[i * 3] = r;
      out[i * 3 + 1] = g;
      out[i * 3 + 2] = b;
    }
    return out;
  }

  const palette = colors.categories!.map((c) => cssToRgb(c.color));
  const indices = colors.class_indices!;
  for (let i = 0; i < count; i++) {
    const [r, g, b] = palette[indices[i]];
    out[i * 3] = r;
    out[i * 3 + 1] = g;
    out[i * 3 + 2] = b;
  }
  return out;
}

/**
 * Builds the per-point color + radius buffers for the current selection
 * state, plus the (optional, capped) halo buffers for selected points.
 *
 * Bright/dim priority mirrors the renderer's tiers: similarity focus
 * (explore click) > checked samples > lasso selection > view-filter
 * bitmask; class highlight applies only when no higher tier is active.
 */
export function buildSceneBuffers(opts: {
  positions: Float32Array;
  baseRGB: Uint8Array;
  background: RGB;
  inSelection: ((i: number) => boolean) | null;
  checkedIndices: Set<number> | null;
  highlightSet: Set<number> | null;
  classMembers?: number[][];
  similarityFocus?: SimilarityFocus | null;
}): SceneBuffers {
  const {
    positions,
    baseRGB,
    background,
    inSelection,
    checkedIndices,
    highlightSet,
    classMembers,
    similarityFocus,
  } = opts;

  const count = baseRGB.length / 3;
  const colors = new Uint8Array(count * 3);
  const radii = new Float32Array(count);
  const haloIndices: number[] = [];

  const setColor = (i: number, rgb: RGB | Uint8Array, off = 0) => {
    colors[i * 3] = rgb[off];
    colors[i * 3 + 1] = rgb[off + 1];
    colors[i * 3 + 2] = rgb[off + 2];
  };
  const dim = (i: number) => {
    const o = i * 3;
    setColor(
      i,
      blendRgb([baseRGB[o], baseRGB[o + 1], baseRGB[o + 2]], background, DIM_AMOUNT)
    );
    radii[i] = DIMMED_RADIUS;
  };
  const bright = (i: number) => {
    setColor(i, baseRGB, i * 3);
    radii[i] = BASE_RADIUS;
    haloIndices.push(i);
  };

  if (similarityFocus) {
    const { sourceIndex, neighborIndices } = similarityFocus;
    for (let i = 0; i < count; i++) {
      if (i === sourceIndex) {
        setColor(i, SIM_SOURCE_RGB);
        radii[i] = CHECKED_RADIUS;
        haloIndices.push(i);
      } else if (neighborIndices.has(i)) {
        setColor(i, SIM_NEIGHBOR_RGB);
        radii[i] = BASE_RADIUS * 1.15;
        haloIndices.push(i);
      } else {
        dim(i);
      }
    }
  } else if (highlightSet && classMembers) {
    for (let i = 0; i < count; i++) {
      if (classMembers[i].some((ci) => highlightSet.has(ci))) {
        bright(i);
      } else {
        dim(i);
      }
    }
  } else if (!inSelection) {
    colors.set(baseRGB);
    radii.fill(BASE_RADIUS);
  } else {
    for (let i = 0; i < count; i++) {
      if (checkedIndices?.has(i)) {
        setColor(i, SELECTED_RGB);
        radii[i] = CHECKED_RADIUS;
        haloIndices.push(i);
      } else if (inSelection(i)) {
        bright(i);
      } else {
        dim(i);
      }
    }
  }

  const halo = buildHalo(positions, colors, radii, haloIndices);
  return { colors, radii, halo };
}

function buildHalo(
  positions: Float32Array,
  colors: Uint8Array,
  radii: Float32Array,
  indices: number[]
): SceneBuffers['halo'] {
  const empty = {
    positions: new Float32Array(0),
    colors: new Uint8Array(0),
    radii: new Float32Array(0),
  };
  if (!indices.length || indices.length > HALO_LIMIT) return empty;

  const k = indices.length;
  const hp = new Float32Array(k * 3);
  const hc = new Uint8Array(k * 3);
  const hr = new Float32Array(k);
  for (let j = 0; j < k; j++) {
    const i = indices[j];
    hp[j * 3] = positions[i * 3];
    hp[j * 3 + 1] = positions[i * 3 + 1];
    hp[j * 3 + 2] = positions[i * 3 + 2];
    hc[j * 3] = colors[i * 3];
    hc[j * 3 + 1] = colors[i * 3 + 1];
    hc[j * 3 + 2] = colors[i * 3 + 2];
    hr[j] = radii[i] * HALO_SCALE;
  }
  return { positions: hp, colors: hc, radii: hr };
}

function readPosition(
  positions: Float32Array,
  index: number
): [number, number, number] {
  const o = index * 3;
  return [positions[o], positions[o + 1], positions[o + 2]];
}

/** Arcs (3D) or segments (2D) from a source point to its neighbors. */
export function buildSimilarityLinkLayer(opts: {
  sourceIndex: number;
  neighbors: SimilarNeighbor[];
  positions: Float32Array;
  is2D: boolean;
}): ArcLayer | LineLayer | null {
  const { sourceIndex, neighbors, positions, is2D } = opts;
  if (!neighbors.length) return null;

  const source = readPosition(positions, sourceIndex);
  const data = neighbors.map((n) => ({
    source,
    target: readPosition(positions, n.index),
  }));

  const common = {
    id: 'similarity-links',
    data,
    pickable: false,
    getWidth: 2,
    widthUnits: 'pixels' as const,
    parameters: { depthTest: !is2D, depthMask: false },
  };

  if (is2D) {
    return new LineLayer({
      ...common,
      getSourcePosition: (d: (typeof data)[0]) => d.source,
      getTargetPosition: (d: (typeof data)[0]) => d.target,
      getColor: [...SIM_SOURCE_RGB, 180],
    });
  }

  return new ArcLayer({
    ...common,
    getSourcePosition: (d: (typeof data)[0]) => d.source,
    getTargetPosition: (d: (typeof data)[0]) => d.target,
    getSourceColor: [...SIM_SOURCE_RGB, 200],
    getTargetColor: [...SIM_NEIGHBOR_RGB, 160],
  });
}

/**
 * Initial OrbitView view state: centered on the data, zoomed to fit, with
 * an oblique angle for 3D and a straight-on (orthographic) view for 2D.
 */
export function initialViewState(
  bounds: SceneBounds,
  is2D: boolean,
  viewportPx: number
): DeckViewState {
  // OrbitView zoom is log2(pixels per world unit); fit the largest extent
  // into the viewport with a small margin
  const zoom = Math.log2(Math.max(viewportPx, 1) / bounds.maxExtent) - 0.5;
  return {
    target: bounds.center,
    rotationX: is2D ? 0 : 30,
    rotationOrbit: is2D ? 0 : 30,
    zoom,
  };
}
