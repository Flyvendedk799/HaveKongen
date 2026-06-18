// Samples Denmark's national elevation model (Danmarks Højdemodel, DHM) over a
// garden so Havemåler Part 2 can show real ground slope and pre-fill object
// heights. Terrain (dhm_terraen / DTM) gives bare-earth height; surface
// (dhm_overflade / DSM) gives the top of trees, hedges and buildings. The
// difference (DSM - DTM) is the height of everything standing on the ground.
//
// Data: Dataforsyningen WCS (https://api.dataforsyningen.dk/dhm_wcs_DAF),
// authed with the same DATAFORSYNINGEN_TOKEN already used for ortofoto/matrikel.
// Everything degrades gracefully: any failure returns { available: false } and
// the builder falls back to a flat terrain with fully manual heights.
import { fromArrayBuffer } from "https://esm.sh/geotiff@2.1.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "public, max-age=86400" },
  });
}

function unavailable(detail: string, status = 200) {
  return json({ available: false, source: "none", detail }, status);
}

type LngLat = [number, number];

// WGS84 longitude/latitude -> UTM zone 32N easting/northing (EPSG:25832),
// the native CRS of DHM. Snyder series, sub-centimetre over a garden.
function lngLatToUtm32(lng: number, lat: number): [number, number] {
  const a = 6378137.0;
  const f = 1 / 298.257223563;
  const k0 = 0.9996;
  const lon0 = (9 * Math.PI) / 180; // zone 32 central meridian
  const e2 = f * (2 - f);
  const ep2 = e2 / (1 - e2);
  const phi = (lat * Math.PI) / 180;
  const lam = (lng * Math.PI) / 180;
  const sinPhi = Math.sin(phi);
  const cosPhi = Math.cos(phi);
  const tanPhi = Math.tan(phi);
  const N = a / Math.sqrt(1 - e2 * sinPhi * sinPhi);
  const T = tanPhi * tanPhi;
  const C = ep2 * cosPhi * cosPhi;
  const A = cosPhi * (lam - lon0);
  const M = a * (
    (1 - e2 / 4 - (3 * e2 * e2) / 64 - (5 * e2 * e2 * e2) / 256) * phi
    - ((3 * e2) / 8 + (3 * e2 * e2) / 32 + (45 * e2 * e2 * e2) / 1024) * Math.sin(2 * phi)
    + ((15 * e2 * e2) / 256 + (45 * e2 * e2 * e2) / 1024) * Math.sin(4 * phi)
    - ((35 * e2 * e2 * e2) / 3072) * Math.sin(6 * phi)
  );
  const easting = k0 * N * (A + ((1 - T + C) * A ** 3) / 6 + ((5 - 18 * T + T * T + 72 * C - 58 * ep2) * A ** 5) / 120) + 500000;
  const northing = k0 * (M + N * tanPhi * ((A * A) / 2 + ((5 - T + 9 * C + 4 * C * C) * A ** 4) / 24 + ((61 - 58 * T + T * T + 600 * C - 330 * ep2) * A ** 6) / 720));
  return [easting, northing];
}

function isLngLat(value: unknown): value is LngLat {
  return Array.isArray(value) && value.length >= 2
    && typeof value[0] === "number" && typeof value[1] === "number"
    && Number.isFinite(value[0]) && Number.isFinite(value[1]);
}

function parsePolygon(value: unknown): LngLat[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isLngLat).map((p) => [p[0], p[1]] as LngLat);
}

// DHM nodata is -9999; Denmark's terrain spans roughly -8m..173m.
function isValidElevation(v: number) {
  return Number.isFinite(v) && v > -100 && v < 500;
}

// GeoServer (1.0.0) names the GeoTIFF output "GeoTIFF" or "image/tiff"; GDAL
// servers use "GTiff". Try each so we actually get raster data instead of
// silently falling back. The first valid TIFF wins.
const WCS_FORMATS = ["GeoTIFF", "image/tiff", "GTiff"];

async function fetchCoverage(
  coverage: "dhm_terraen" | "dhm_overflade",
  utmBbox: [number, number, number, number],
  width: number,
  height: number,
  token: string,
  timeoutMs: number,
): Promise<{ data: Float32Array; width: number; height: number } | null> {
  for (const format of WCS_FORMATS) {
    const params = new URLSearchParams({
      service: "WCS",
      version: "1.0.0",
      request: "GetCoverage",
      coverage,
      crs: "EPSG:25832",
      bbox: utmBbox.join(","),
      width: String(width),
      height: String(height),
      format,
      token,
    });
    const url = `https://api.dataforsyningen.dk/dhm_wcs_DAF?${params.toString()}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        console.warn(`get-elevation ${coverage} (${format}) HTTP ${response.status}`);
        continue;
      }
      const contentType = response.headers.get("content-type") ?? "";
      const buffer = await response.arrayBuffer();
      // WCS returns an XML ServiceExceptionReport (not a TIFF) on error.
      if (contentType.includes("xml") || contentType.includes("html") || buffer.byteLength < 256) {
        console.warn(`get-elevation ${coverage} (${format}) non-tiff response (${contentType}, ${buffer.byteLength}b)`);
        continue;
      }
      const tiff = await fromArrayBuffer(buffer);
      const image = await tiff.getImage();
      const rasters = await image.readRasters({ interleave: true });
      const w = image.getWidth();
      const h = image.getHeight();
      const raw = rasters as unknown as ArrayLike<number>;
      const data = new Float32Array(w * h);
      for (let i = 0; i < w * h; i += 1) data[i] = Number(raw[i]);
      return { data, width: w, height: h };
    } catch (e) {
      console.warn(`get-elevation ${coverage} (${format}) failed`, String(e));
    } finally {
      clearTimeout(timeout);
    }
  }
  return null;
}

// Resample a raw raster (row 0 = north) into a rows x cols grid of valid
// elevations, replacing nodata with the nearest valid neighbour average.
function toGrid(raw: { data: Float32Array; width: number; height: number }, cols: number, rows: number): number[][] {
  const grid: number[][] = [];
  let sum = 0;
  let count = 0;
  for (let r = 0; r < rows; r += 1) {
    const row: number[] = [];
    const sy = Math.min(raw.height - 1, Math.round((r / Math.max(1, rows - 1)) * (raw.height - 1)));
    for (let c = 0; c < cols; c += 1) {
      const sx = Math.min(raw.width - 1, Math.round((c / Math.max(1, cols - 1)) * (raw.width - 1)));
      const v = raw.data[sy * raw.width + sx];
      if (isValidElevation(v)) {
        row.push(v);
        sum += v;
        count += 1;
      } else {
        row.push(NaN);
      }
    }
    grid.push(row);
  }
  if (!count) return [];
  const mean = sum / count;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      if (Number.isNaN(grid[r][c])) grid[r][c] = mean;
    }
  }
  return grid;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const token = Deno.env.get("DATAFORSYNINGEN_TOKEN");
    if (!token) return unavailable("DATAFORSYNINGEN_TOKEN not set");

    let body: unknown = {};
    try {
      body = await req.json();
    } catch {
      return unavailable("JSON body required", 400);
    }
    const record = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
    const polygon = parsePolygon(record.polygon);
    if (polygon.length < 3) return unavailable("polygon with >= 3 lng/lat points required", 400);

    const lngs = polygon.map((p) => p[0]);
    const lats = polygon.map((p) => p[1]);
    const margin = 0.00004; // ~3-4m breathing room so edge objects are covered
    const minLng = Math.min(...lngs) - margin;
    const maxLng = Math.max(...lngs) + margin;
    const minLat = Math.min(...lats) - margin;
    const maxLat = Math.max(...lats) + margin;

    // Convert the four bbox corners to UTM and take the axis-aligned UTM extent.
    const corners: LngLat[] = [[minLng, minLat], [maxLng, minLat], [maxLng, maxLat], [minLng, maxLat]];
    const utm = corners.map(([lng, lat]) => lngLatToUtm32(lng, lat));
    const minE = Math.min(...utm.map((p) => p[0]));
    const maxE = Math.max(...utm.map((p) => p[0]));
    const minN = Math.min(...utm.map((p) => p[1]));
    const maxN = Math.max(...utm.map((p) => p[1]));
    const spanE = maxE - minE;
    const spanN = maxN - minN;
    if (!(spanE > 0) || !(spanN > 0) || spanE > 600 || spanN > 600) {
      return unavailable("garden bbox out of supported range");
    }

    // Aim for ~1.2m grid spacing, capped to keep the request and payload small.
    const target = Math.max(spanE, spanN) / 1.2;
    const maxCells = 48;
    const longest = Math.max(8, Math.min(maxCells, Math.round(target)));
    const cols = Math.max(8, Math.min(maxCells, Math.round((spanE / Math.max(spanE, spanN)) * longest)));
    const rows = Math.max(8, Math.min(maxCells, Math.round((spanN / Math.max(spanE, spanN)) * longest)));
    const utmBbox: [number, number, number, number] = [minE, minN, maxE, maxN];

    const [terrainRaw, surfaceRaw] = await Promise.all([
      fetchCoverage("dhm_terraen", utmBbox, cols, rows, token, 8000),
      fetchCoverage("dhm_overflade", utmBbox, cols, rows, token, 8000),
    ]);

    if (!terrainRaw) return unavailable("DHM terrain coverage unavailable");
    const terrain = toGrid(terrainRaw, cols, rows);
    if (!terrain.length) return unavailable("DHM terrain returned no valid samples");
    const surface = surfaceRaw ? toGrid(surfaceRaw, cols, rows) : [];

    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    for (const row of terrain) {
      for (const v of row) {
        if (v < min) min = v;
        if (v > max) max = v;
        sum += v;
      }
    }
    const meanM = sum / (rows * cols);
    const resolutionM = Number((Math.max(spanE, spanN) / Math.max(1, longest - 1)).toFixed(2));

    return json({
      available: true,
      source: "dhm",
      cols,
      rows,
      // North-up grid mapped linearly onto the lng/lat bbox (row 0 = north / maxLat).
      bbox: [minLng, minLat, maxLng, maxLat],
      terrain,
      surface: surface.length ? surface : null,
      stats: {
        minM: Number(min.toFixed(2)),
        maxM: Number(max.toFixed(2)),
        meanM: Number(meanM.toFixed(2)),
        reliefM: Number((max - min).toFixed(2)),
      },
      resolutionM,
      attribution: "Danmarks Højdemodel (DHM) © SDFI / Dataforsyningen",
    });
  } catch (e) {
    console.warn("get-elevation crashed", String(e));
    return unavailable(String(e));
  }
});
