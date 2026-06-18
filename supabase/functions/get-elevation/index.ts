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
// No external GeoTIFF dependency: the DHM WCS returns a small, uncompressed,
// single-band Float32 GeoTIFF, which we parse inline. (esm.sh/geotiff pulls in
// node:vm, which the Supabase edge runtime can't load.)

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
const WCS_FORMATS = ["GTiff", "GeoTIFF", "image/tiff"];

// Minimal reader for an uncompressed, single-band Float32 (or Float64) GeoTIFF
// — exactly what Dataforsyningen's DHM WCS returns. Returns row-major samples
// (row 0 = north). Returns null for anything it can't safely decode.
function parseFloatTiff(u8: Uint8Array): { data: Float32Array; width: number; height: number } | null {
  if (u8.byteLength < 8) return null;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const b0 = dv.getUint8(0);
  const b1 = dv.getUint8(1);
  let le: boolean;
  if (b0 === 0x49 && b1 === 0x49) le = true; // "II"
  else if (b0 === 0x4d && b1 === 0x4d) le = false; // "MM"
  else return null;
  if (dv.getUint16(2, le) !== 42) return null;

  const ifdOff = dv.getUint32(4, le);
  if (ifdOff + 2 > u8.byteLength) return null;
  const entries = dv.getUint16(ifdOff, le);
  const TYPE_SIZE: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };
  const tags: Record<number, number[]> = {};
  for (let i = 0; i < entries; i += 1) {
    const e = ifdOff + 2 + i * 12;
    const tag = dv.getUint16(e, le);
    const type = dv.getUint16(e + 2, le);
    const count = dv.getUint32(e + 4, le);
    const size = (TYPE_SIZE[type] ?? 1) * count;
    const base = size > 4 ? dv.getUint32(e + 8, le) : e + 8;
    const vals: number[] = [];
    for (let j = 0; j < count; j += 1) {
      if (type === 3 || type === 8) vals.push(dv.getUint16(base + j * 2, le));
      else if (type === 4 || type === 9) vals.push(dv.getUint32(base + j * 4, le));
      else if (type === 1 || type === 2 || type === 6 || type === 7) vals.push(dv.getUint8(base + j));
      else vals.push(dv.getUint32(base + j * 4, le));
    }
    tags[tag] = vals;
  }

  const width = tags[256]?.[0];
  const height = tags[257]?.[0];
  const bps = tags[258]?.[0] ?? 32;
  const compression = tags[259]?.[0] ?? 1;
  const samplesPerPixel = tags[277]?.[0] ?? 1;
  const sampleFormat = tags[339]?.[0] ?? 1; // 3 = IEEE float
  const stripOffsets = tags[273] ?? [];
  const stripByteCounts = tags[279] ?? [];
  if (!width || !height) return null;
  if (compression !== 1) return null; // uncompressed only
  if (samplesPerPixel !== 1) return null;
  if (sampleFormat !== 3 || (bps !== 32 && bps !== 64)) return null;
  if (!stripOffsets.length) return null;

  const total = width * height;
  const data = new Float32Array(total);
  const bytesPer = bps / 8;
  let idx = 0;
  for (let s = 0; s < stripOffsets.length && idx < total; s += 1) {
    const off = stripOffsets[s];
    const count = Math.floor((stripByteCounts[s] ?? (total - idx) * bytesPer) / bytesPer);
    for (let k = 0; k < count && idx < total; k += 1) {
      const at = off + k * bytesPer;
      if (at + bytesPer > u8.byteLength) return null;
      data[idx] = bps === 64 ? dv.getFloat64(at, le) : dv.getFloat32(at, le);
      idx += 1;
    }
  }
  return idx === total ? { data, width, height } : null;
}

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
    try {
      const res = await rawHttpsGet(url, timeoutMs);
      if (!res || res.status !== 200) {
        console.warn(`get-elevation ${coverage} (${format}) HTTP ${res?.status ?? "no-response"}`);
        continue;
      }
      // WCS returns an XML ServiceExceptionReport (not a TIFF) on error.
      if (res.body.byteLength < 256 || (res.body[0] !== 0x49 && res.body[0] !== 0x4d)) {
        continue;
      }
      const parsed = parseFloatTiff(res.body);
      if (!parsed) {
        console.warn(`get-elevation ${coverage} (${format}) unparseable TIFF (${res.body.byteLength}b)`);
        continue;
      }
      return parsed;
    } catch (e) {
      console.warn(`get-elevation ${coverage} (${format}) failed`, String(e));
    }
  }
  return null;
}

// Raw HTTPS GET over Deno.connectTls. We can't use fetch() here: the
// api.dataforsyningen.dk gateway (Gravitee) returns chunked responses and
// closes the TLS connection without a close_notify, which Deno's fetch rejects
// with "unexpected end of file". Reading the socket directly lets us accept the
// full body and treat the unclean close as end-of-stream.
async function rawHttpsGet(urlStr: string, timeoutMs: number): Promise<{ status: number; body: Uint8Array } | null> {
  const url = new URL(urlStr);
  const host = url.hostname;
  const port = url.port ? Number(url.port) : 443;
  const path = `${url.pathname}${url.search}`;
  let conn: Deno.TlsConn | null = null;
  const timer = setTimeout(() => { try { conn?.close(); } catch { /* already closed */ } }, timeoutMs);
  try {
    conn = await Deno.connectTls({ hostname: host, port });
    const req = `GET ${path} HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: havekongen-elevation\r\nAccept: */*\r\nConnection: close\r\n\r\n`;
    await conn.write(new TextEncoder().encode(req));
    const chunks: Uint8Array[] = [];
    const buf = new Uint8Array(65536);
    try {
      while (true) {
        const n = await conn.read(buf);
        if (n === null) break;
        chunks.push(buf.slice(0, n));
      }
    } catch { /* unclean TLS close after the full body — tolerated */ }
    let len = 0;
    for (const c of chunks) len += c.length;
    const all = new Uint8Array(len);
    let o = 0;
    for (const c of chunks) { all.set(c, o); o += c.length; }
    return parseHttpResponse(all);
  } catch (e) {
    console.warn("rawHttpsGet failed", String(e));
    return null;
  } finally {
    clearTimeout(timer);
    try { conn?.close(); } catch { /* already closed */ }
  }
}

function parseHttpResponse(all: Uint8Array): { status: number; body: Uint8Array } | null {
  let sep = -1;
  for (let i = 0; i + 3 < all.length; i += 1) {
    if (all[i] === 13 && all[i + 1] === 10 && all[i + 2] === 13 && all[i + 3] === 10) { sep = i; break; }
  }
  if (sep < 0) return null;
  const headerText = new TextDecoder().decode(all.slice(0, sep));
  const rawBody = all.slice(sep + 4);
  const lines = headerText.split("\r\n");
  const status = Number(lines[0]?.match(/HTTP\/\d\.\d\s+(\d{3})/)?.[1] ?? 0);
  let chunked = false;
  for (let i = 1; i < lines.length; i += 1) {
    const idx = lines[i].indexOf(":");
    if (idx <= 0) continue;
    if (lines[i].slice(0, idx).trim().toLowerCase() === "transfer-encoding"
      && lines[i].slice(idx + 1).toLowerCase().includes("chunked")) chunked = true;
  }
  return { status, body: chunked ? dechunk(rawBody) : rawBody };
}

function dechunk(b: Uint8Array): Uint8Array {
  const parts: Uint8Array[] = [];
  let i = 0;
  while (i < b.length) {
    let j = i;
    while (j + 1 < b.length && !(b[j] === 13 && b[j + 1] === 10)) j += 1;
    const size = parseInt(new TextDecoder().decode(b.slice(i, j)).split(";")[0].trim(), 16);
    if (!Number.isFinite(size) || size <= 0) break;
    i = j + 2;
    parts.push(b.slice(i, i + size));
    i += size + 2;
  }
  let len = 0;
  for (const p of parts) len += p.length;
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
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
