// Client helpers for Denmark's national elevation model (DHM), used by the
// Havemåler 3D builder to show true ground slope and pre-fill object heights.
// The grid is fetched from the `get-elevation` edge function; everything here
// is pure so it can be unit tested and reused by the 3D viewer.
import type { LngLat, Ring } from "@/lib/havemaalerGeometry";

export type ElevationStats = {
  minM: number;
  maxM: number;
  meanM: number;
  reliefM: number;
};

export type ElevationField = {
  source: "dhm";
  cols: number;
  rows: number;
  // [minLng, minLat, maxLng, maxLat]. Grid row 0 = north (maxLat).
  bbox: [number, number, number, number];
  terrain: number[][];
  surface: number[][] | null;
  stats: ElevationStats;
  resolutionM: number;
  confidence: number;
  attribution?: string;
};

export type ElevationResult =
  | { available: true; field: ElevationField }
  | { available: false; detail: string };

type RawElevationResponse = {
  available?: boolean;
  source?: string;
  cols?: number;
  rows?: number;
  bbox?: number[];
  terrain?: number[][];
  surface?: number[][] | null;
  stats?: Partial<ElevationStats>;
  resolutionM?: number;
  attribution?: string;
  detail?: string;
};

function isGrid(value: unknown, rows: number, cols: number): value is number[][] {
  return Array.isArray(value)
    && value.length === rows
    && value.every((row) => Array.isArray(row) && row.length === cols && row.every((n) => typeof n === "number" && Number.isFinite(n)));
}

export function parseElevationResponse(value: unknown): ElevationResult {
  const data = (value && typeof value === "object" ? value : {}) as RawElevationResponse;
  if (!data.available || data.source !== "dhm") {
    return { available: false, detail: data.detail ?? "Ingen højdedata tilgængelig" };
  }
  const cols = Number(data.cols);
  const rows = Number(data.rows);
  const bbox = Array.isArray(data.bbox) && data.bbox.length === 4 && data.bbox.every((n) => Number.isFinite(n))
    ? (data.bbox as [number, number, number, number])
    : null;
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 2 || !bbox) {
    return { available: false, detail: "Ugyldigt højdegitter" };
  }
  if (!isGrid(data.terrain, rows, cols)) {
    return { available: false, detail: "Terrængitter mangler" };
  }
  const surface = isGrid(data.surface, rows, cols) ? data.surface : null;
  const stats = elevationStatsFromGrid(data.terrain);
  return {
    available: true,
    field: {
      source: "dhm",
      cols,
      rows,
      bbox,
      terrain: data.terrain,
      surface,
      stats,
      resolutionM: Number.isFinite(data.resolutionM) ? Number(data.resolutionM) : 1.2,
      confidence: terrainConfidence(stats, Boolean(surface)),
      attribution: typeof data.attribution === "string" ? data.attribution : undefined,
    },
  };
}

export function elevationStatsFromGrid(grid: number[][]): ElevationStats {
  let min = Infinity;
  let max = -Infinity;
  let sum = 0;
  let count = 0;
  for (const row of grid) {
    for (const v of row) {
      if (v < min) min = v;
      if (v > max) max = v;
      sum += v;
      count += 1;
    }
  }
  if (!count) return { minM: 0, maxM: 0, meanM: 0, reliefM: 0 };
  return {
    minM: Number(min.toFixed(2)),
    maxM: Number(max.toFixed(2)),
    meanM: Number((sum / count).toFixed(2)),
    reliefM: Number((max - min).toFixed(2)),
  };
}

// Real terrain is noisy; a few cm of relief is measurement noise, not slope.
function terrainConfidence(stats: ElevationStats, hasSurface: boolean): number {
  let confidence = 0.7;
  if (hasSurface) confidence += 0.1;
  if (stats.reliefM < 0.15) confidence -= 0.1;
  return Math.max(0.4, Math.min(0.92, Number(confidence.toFixed(2))));
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

// Fractional grid coordinates for a lng/lat. Row 0 = north (maxLat).
function gridCoords(field: ElevationField, lng: number, lat: number) {
  const [minLng, minLat, maxLng, maxLat] = field.bbox;
  const fx = clamp(((lng - minLng) / Math.max(1e-9, maxLng - minLng)) * (field.cols - 1), 0, field.cols - 1);
  const fy = clamp(((maxLat - lat) / Math.max(1e-9, maxLat - minLat)) * (field.rows - 1), 0, field.rows - 1);
  return { fx, fy };
}

function bilinear(grid: number[][], fx: number, fy: number) {
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(grid[0].length - 1, x0 + 1);
  const y1 = Math.min(grid.length - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const top = grid[y0][x0] * (1 - tx) + grid[y0][x1] * tx;
  const bottom = grid[y1][x0] * (1 - tx) + grid[y1][x1] * tx;
  return top * (1 - ty) + bottom * ty;
}

/** Absolute terrain elevation (m above sea level) at a point. */
export function sampleTerrain(field: ElevationField, lng: number, lat: number): number {
  const { fx, fy } = gridCoords(field, lng, lat);
  return bilinear(field.terrain, fx, fy);
}

/** Absolute surface elevation (top of trees/buildings) at a point, if known. */
export function sampleSurface(field: ElevationField, lng: number, lat: number): number | null {
  if (!field.surface) return null;
  const { fx, fy } = gridCoords(field, lng, lat);
  return bilinear(field.surface, fx, fy);
}

/** Terrain height relative to the garden's lowest point — what the mesh displaces by. */
export function relativeTerrainHeight(field: ElevationField, lng: number, lat: number): number {
  return Number((sampleTerrain(field, lng, lat) - field.stats.minM).toFixed(3));
}

function ringCentroid(ring: Ring): LngLat {
  let lng = 0;
  let lat = 0;
  for (const [x, y] of ring) {
    lng += x;
    lat += y;
  }
  return [lng / ring.length, lat / ring.length];
}

/**
 * LiDAR-measured height of whatever stands on a footprint (DSM − DTM), in metres.
 * Returns null when there's no surface model or the object is flush with the
 * ground (so the builder keeps its type-based default instead of forcing zero).
 */
export function measuredObjectHeight(field: ElevationField, ring: Ring): number | null {
  if (!field.surface || ring.length < 3) return null;
  const samples: number[] = [];
  // Sample the centroid plus each vertex pulled slightly inward.
  const centroid = ringCentroid(ring);
  const points: LngLat[] = [centroid, ...ring.map(([lng, lat]) => [
    lng + (centroid[0] - lng) * 0.35,
    lat + (centroid[1] - lat) * 0.35,
  ] as LngLat)];
  for (const [lng, lat] of points) {
    const surface = sampleSurface(field, lng, lat);
    const terrain = sampleTerrain(field, lng, lat);
    if (surface != null && Number.isFinite(surface) && Number.isFinite(terrain)) {
      samples.push(surface - terrain);
    }
  }
  if (!samples.length) return null;
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  if (median < 0.4) return null; // below noise floor; treat as ground-level
  return Number(Math.min(35, median).toFixed(1));
}

// Metres-per-cell in each grid direction, derived from the lng/lat bbox.
function cellMetrics(field: ElevationField) {
  const [minLng, minLat, maxLng, maxLat] = field.bbox;
  const midLat = (minLat + maxLat) / 2;
  const mPerCol = ((maxLng - minLng) / Math.max(1, field.cols - 1)) * 111_320 * Math.cos((midLat * Math.PI) / 180);
  const mPerRow = ((maxLat - minLat) / Math.max(1, field.rows - 1)) * 111_320;
  return { mPerCol: Math.max(0.05, mPerCol), mPerRow: Math.max(0.05, mPerRow) };
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

export type TerrainSlopeStats = {
  maxSlopePct: number;
  meanSlopePct: number;
  /** Whether the steepest slope exceeds a typical entry robot-mower limit (~35%). */
  exceedsRobotLimit: boolean;
};

/** Steepest and average slope across the terrain grid, as rise/run percentages. */
export function terrainSlopeStats(field: ElevationField): TerrainSlopeStats {
  const { mPerCol, mPerRow } = cellMetrics(field);
  const grid = field.terrain;
  let max = 0;
  let sum = 0;
  let count = 0;
  for (let r = 0; r < field.rows; r += 1) {
    for (let c = 0; c < field.cols; c += 1) {
      if (c + 1 < field.cols) {
        const slope = Math.abs(grid[r][c + 1] - grid[r][c]) / mPerCol;
        max = Math.max(max, slope);
        sum += slope;
        count += 1;
      }
      if (r + 1 < field.rows) {
        const slope = Math.abs(grid[r + 1][c] - grid[r][c]) / mPerRow;
        max = Math.max(max, slope);
        sum += slope;
        count += 1;
      }
    }
  }
  const maxSlopePct = Number((max * 100).toFixed(1));
  return {
    maxSlopePct,
    meanSlopePct: Number(((count ? sum / count : 0) * 100).toFixed(1)),
    exceedsRobotLimit: maxSlopePct > 35,
  };
}

export type DetectedObjectType = "tree" | "hedge" | "shed";

export type DetectedObject = {
  type: DetectedObjectType;
  center: LngLat;
  widthM: number;
  depthM: number;
  heightM: number;
  confidence: number;
};

/**
 * Find candidate objects directly from the DHM surface model: cells where the
 * surface stands meaningfully above the terrain (DSM − DTM) are clustered, then
 * classified by shape and height into trees, hedges and sheds. This is the
 * "we found your trees" magic — the user only reviews and tweaks. Returns [] when
 * there's no surface grid. Conservative on purpose to avoid false positives
 * (big footprints like a house are skipped).
 */
export function detectObjectsFromElevation(field: ElevationField, options: { maxObjects?: number; minHeightM?: number } = {}): DetectedObject[] {
  if (!field.surface) return [];
  const minHeight = options.minHeightM ?? 0.8;
  const maxObjects = options.maxObjects ?? 16;
  const { cols, rows, terrain, surface } = field;
  const { mPerCol, mPerRow } = cellMetrics(field);
  const cellAreaM2 = mPerCol * mPerRow;
  const [minLng, minLat, maxLng, maxLat] = field.bbox;

  // Height-above-ground map.
  const tall: boolean[][] = [];
  for (let r = 0; r < rows; r += 1) {
    const row: boolean[] = [];
    for (let c = 0; c < cols; c += 1) {
      row.push((surface[r][c] - terrain[r][c]) >= minHeight);
    }
    tall.push(row);
  }

  const visited: boolean[][] = tall.map((row) => row.map(() => false));
  const detections: DetectedObject[] = [];

  for (let r0 = 0; r0 < rows; r0 += 1) {
    for (let c0 = 0; c0 < cols; c0 += 1) {
      if (!tall[r0][c0] || visited[r0][c0]) continue;
      // Flood fill (8-connected) to collect one cluster.
      const stack: Array<[number, number]> = [[r0, c0]];
      visited[r0][c0] = true;
      const cells: Array<[number, number]> = [];
      let minR = r0;
      let maxR = r0;
      let minC = c0;
      let maxC = c0;
      while (stack.length) {
        const [r, c] = stack.pop()!;
        cells.push([r, c]);
        if (r < minR) minR = r;
        if (r > maxR) maxR = r;
        if (c < minC) minC = c;
        if (c > maxC) maxC = c;
        for (let dr = -1; dr <= 1; dr += 1) {
          for (let dc = -1; dc <= 1; dc += 1) {
            const nr = r + dr;
            const nc = c + dc;
            if (nr < 0 || nc < 0 || nr >= rows || nc >= cols) continue;
            if (!tall[nr][nc] || visited[nr][nc]) continue;
            visited[nr][nc] = true;
            stack.push([nr, nc]);
          }
        }
      }

      const areaM2 = cells.length * cellAreaM2;
      if (areaM2 < 0.8 || areaM2 > 45) continue; // noise, or a house/large structure

      const heights = cells.map(([r, c]) => surface[r][c] - terrain[r][c]);
      const medianHeight = median(heights);
      const widthM = (maxC - minC + 1) * mPerCol;
      const depthM = (maxR - minR + 1) * mPerRow;
      const fill = cells.length / Math.max(1, (maxC - minC + 1) * (maxR - minR + 1));
      const longSide = Math.max(widthM, depthM);
      const shortSide = Math.max(0.3, Math.min(widthM, depthM));
      const aspect = longSide / shortSide;

      const avgC = cells.reduce((s, [, c]) => s + c, 0) / cells.length;
      const avgR = cells.reduce((s, [r]) => s + r, 0) / cells.length;
      const lng = minLng + (avgC / Math.max(1, cols - 1)) * (maxLng - minLng);
      const lat = maxLat - (avgR / Math.max(1, rows - 1)) * (maxLat - minLat);

      let type: DetectedObjectType | null = null;
      let outWidth = widthM;
      let outDepth = depthM;
      let confidence = 0.7;
      if (aspect >= 2.2 && medianHeight >= 0.8 && medianHeight <= 4 && areaM2 <= 40) {
        type = "hedge";
        outWidth = longSide;
        outDepth = shortSide;
        confidence = 0.72;
      } else if (aspect < 2.2 && medianHeight >= 3) {
        type = "tree";
        const diameter = (widthM + depthM) / 2;
        outWidth = diameter;
        outDepth = diameter;
        confidence = 0.78;
      } else if (aspect < 2.5 && medianHeight >= 1.8 && medianHeight <= 4.5 && fill >= 0.55 && areaM2 >= 3) {
        type = "shed";
        confidence = 0.7;
      } else if (aspect < 2.2 && medianHeight >= 2) {
        type = "tree";
        const diameter = (widthM + depthM) / 2;
        outWidth = diameter;
        outDepth = diameter;
        confidence = 0.7;
      }
      if (!type) continue;

      detections.push({
        type,
        center: [Number(lng.toFixed(7)), Number(lat.toFixed(7))],
        widthM: Number(Math.max(0.4, outWidth).toFixed(1)),
        depthM: Number(Math.max(0.3, outDepth).toFixed(1)),
        heightM: Number(Math.min(30, medianHeight).toFixed(1)),
        confidence: Number(Math.min(0.88, confidence * (0.85 + field.confidence * 0.18)).toFixed(2)),
      });
    }
  }

  // Tallest / most confident first, capped.
  return detections
    .sort((a, b) => (b.confidence - a.confidence) || (b.heightM - a.heightM))
    .slice(0, maxObjects);
}

export type SlopeBand = "flat" | "gentle" | "moderate" | "steep";

export function slopeBand(reliefM: number): SlopeBand {
  if (reliefM < 0.25) return "flat";
  if (reliefM < 0.8) return "gentle";
  if (reliefM < 2) return "moderate";
  return "steep";
}

export function slopeLabel(reliefM: number): string {
  const band = slopeBand(reliefM);
  if (band === "flat") return "Stort set fladt";
  if (band === "gentle") return "Svagt skrånende";
  if (band === "moderate") return "Tydelig hældning";
  return "Stejlt terræn";
}

export function slopeHintFromRelief(reliefM: number): "flat" | "gentle" | "unknown" {
  if (reliefM < 0.25) return "flat";
  if (reliefM < 2) return "gentle";
  return "gentle";
}

/**
 * Fetch the DHM elevation field for a lawn outline via the edge function.
 * `invoke` is injected so this stays dependency-free and unit-testable.
 */
export async function fetchElevationField(
  polygon: Ring,
  invoke: (body: { polygon: Ring }) => Promise<{ data: unknown; error: unknown }>,
): Promise<ElevationResult> {
  if (polygon.length < 3) return { available: false, detail: "Tegn græsfladen først" };
  try {
    const { data, error } = await invoke({ polygon });
    if (error) return { available: false, detail: "Højdeopslag fejlede" };
    return parseElevationResponse(data);
  } catch {
    return { available: false, detail: "Højdeopslag fejlede" };
  }
}
