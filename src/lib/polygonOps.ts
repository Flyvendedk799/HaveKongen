import * as turf from "@turf/turf";
import type mapboxgl from "mapbox-gl";

export type LngLat = [number, number];
export type Ring = LngLat[];

/** Close a ring (append first point) for turf. */
export function closed(r: Ring): LngLat[] {
  if (r.length < 3) return r;
  const first = r[0], last = r[r.length - 1];
  return first[0] === last[0] && first[1] === last[1] ? r : [...r, first];
}

/** Union two simple polygons (rings); returns outer ring of the largest piece, or null. */
export function unionRings(a: Ring, b: Ring): Ring | null {
  try {
    const pa = turf.polygon([closed(a)]);
    const pb = turf.polygon([closed(b)]);
    const u = turf.union(turf.featureCollection([pa, pb]));
    if (!u) return null;
    return largestRingFromGeometry(u.geometry);
  } catch { return null; }
}

function polygonFromRing(ring: Ring) {
  return turf.polygon([closed(ring)]);
}

function ringFromPositions(positions: GeoJSON.Position[]): Ring {
  return positions
    .slice(0, -1)
    .map((point) => [point[0], point[1]] as LngLat)
    .filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]));
}

function ringsFromGeometry(geom: GeoJSON.Geometry | null | undefined): Ring[] {
  const coords = geom?.type === "Polygon"
    ? [geom.coordinates[0]]
    : geom?.type === "MultiPolygon"
      ? geom.coordinates.map((polygon) => polygon[0])
      : [];
  return coords
    .map(ringFromPositions)
    .filter((r: Ring) => r.length >= 3)
    .sort((a: Ring, b: Ring) => turf.area(polygonFromRing(b)) - turf.area(polygonFromRing(a)));
}

function largestRingFromGeometry(geom: GeoJSON.Geometry | null | undefined): Ring | null {
  return ringsFromGeometry(geom)[0] ?? null;
}

/** Add a lawn ring to a set, merging only when it touches/overlaps an existing lawn. */
export function addRingToSet(rings: Ring[], incoming: Ring): Ring[] {
  if (incoming.length < 3) return rings;
  try {
    let pending: Ring[] = [incoming];
    const kept: Ring[] = [];

    for (const existing of rings) {
      let mergedExisting = false;
      const nextPending: Ring[] = [];

      for (const candidate of pending) {
        const pe = polygonFromRing(existing);
        const pc = polygonFromRing(candidate);
        if (!mergedExisting && turf.booleanIntersects(pe, pc)) {
          const union = turf.union(turf.featureCollection([pe, pc]));
          const pieces = union ? ringsFromGeometry(union.geometry) : [];
          nextPending.push(...(pieces.length ? pieces : [candidate]));
          mergedExisting = true;
        } else {
          nextPending.push(candidate);
        }
      }

      pending = nextPending;
      if (!mergedExisting) kept.push(existing);
    }

    return [...kept, ...pending]
      .filter((r) => r.length >= 3)
      .sort((a, b) => turf.area(polygonFromRing(b)) - turf.area(polygonFromRing(a)));
  } catch {
    return [...rings, incoming];
  }
}

/** Subtract b from a; returns outer ring of largest piece, or null. */
export function subtractRings(a: Ring, b: Ring): Ring | null {
  try {
    const pa = turf.polygon([closed(a)]);
    const pb = turf.polygon([closed(b)]);
    const d = turf.difference(turf.featureCollection([pa, pb]));
    if (!d) return null;
    return largestRingFromGeometry(d.geometry);
  } catch { return null; }
}

/** Distance between two lng/lat points in pixels at given mapbox map. */
export function pixelDistance(map: mapboxgl.Map, a: LngLat, b: LngLat): number {
  const pa = map.project(a), pb = map.project(b);
  return Math.hypot(pa.x - pb.x, pa.y - pb.y);
}
