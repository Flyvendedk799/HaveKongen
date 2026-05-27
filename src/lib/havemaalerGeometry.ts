export type LngLat = [number, number];
export type Ring = LngLat[];
export type GardenPolygon = {
  type: "Polygon" | "MultiPolygon";
  coordinates: LngLat[][] | LngLat[][][];
};

type FingerprintInput = {
  name?: string | null;
  center?: LngLat | null;
  lawns: Ring[];
  exclusions: Ring[];
  matrikel?: Ring | null;
  imagery?: string | null;
  areaM2?: number | null;
};

function parseMaybeJson(value: unknown) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

export function isLngLat(value: unknown): value is LngLat {
  return Array.isArray(value)
    && value.length >= 2
    && typeof value[0] === "number"
    && typeof value[1] === "number"
    && Number.isFinite(value[0])
    && Number.isFinite(value[1]);
}

function sameLngLat(a: LngLat, b: LngLat) {
  return Math.abs(a[0] - b[0]) < 1e-10 && Math.abs(a[1] - b[1]) < 1e-10;
}

export function normalizeRing(coords: unknown): Ring | null {
  if (!Array.isArray(coords)) return null;
  const ring = coords.filter(isLngLat).map((point) => [point[0], point[1]] as LngLat);
  if (ring.length >= 2 && sameLngLat(ring[0], ring[ring.length - 1])) ring.pop();
  return ring.length >= 3 ? ring : null;
}

export function ringsFromGeoJson(value: unknown): Ring[] {
  const data = parseMaybeJson(value);
  if (!data || typeof data !== "object") return [];
  const obj = data as { type?: unknown; coordinates?: unknown };
  if (obj.type === "Polygon" && Array.isArray(obj.coordinates)) {
    const ring = normalizeRing(obj.coordinates[0]);
    return ring ? [ring] : [];
  }
  if (obj.type === "MultiPolygon" && Array.isArray(obj.coordinates)) {
    return obj.coordinates
      .map((polygon) => {
        if (!Array.isArray(polygon)) return null;
        return normalizeRing(polygon[0]) ?? (Array.isArray(polygon[0]) ? normalizeRing(polygon[0][0]) : null);
      })
      .filter((ring): ring is Ring => Boolean(ring));
  }
  if (Array.isArray(data)) {
    const direct = normalizeRing(data);
    if (direct) return [direct];
    const polygonRing = normalizeRing(data[0]);
    return polygonRing ? [polygonRing] : [];
  }
  return [];
}

export function exclusionRingsFromJson(value: unknown): Ring[] {
  const data = parseMaybeJson(value);
  if (!Array.isArray(data)) return ringsFromGeoJson(data);
  return data.flatMap((item) => {
    const rings = ringsFromGeoJson(item);
    if (rings.length) return rings;
    const ring = normalizeRing(item);
    return ring ? [ring] : [];
  });
}

export function centerFromRings(rings: Ring[]): LngLat | null {
  const points = rings.flat();
  if (!points.length) return null;
  const lngs = points.map((point) => point[0]);
  const lats = points.map((point) => point[1]);
  return [
    (Math.min(...lngs) + Math.max(...lngs)) / 2,
    (Math.min(...lats) + Math.max(...lats)) / 2,
  ];
}

export function polygonForRing(ring: Ring): GardenPolygon {
  return { type: "Polygon", coordinates: [[...ring, ring[0]]] };
}

export function polygonForRings(rings: Ring[]): GardenPolygon {
  return rings.length === 1
    ? polygonForRing(rings[0])
    : { type: "MultiPolygon", coordinates: rings.map((ring) => [[...ring, ring[0]]]) };
}

export function serializeExclusions(rings: Ring[]): GardenPolygon[] {
  return rings.map(polygonForRing);
}

function roundedPoint(point: LngLat): LngLat {
  return [Number(point[0].toFixed(7)), Number(point[1].toFixed(7))];
}

function roundedRing(ring?: Ring | null) {
  return (ring ?? []).map(roundedPoint);
}

export function gardenGeometryFingerprint(input: FingerprintInput) {
  return JSON.stringify({
    name: input.name ?? null,
    center: input.center ? roundedPoint(input.center) : null,
    lawns: input.lawns.map(roundedRing),
    exclusions: input.exclusions.map(roundedRing),
    matrikel: roundedRing(input.matrikel),
    imagery: input.imagery ?? null,
    areaM2: input.areaM2 == null ? null : Math.round(input.areaM2),
  });
}
