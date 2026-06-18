// segment-lawn v5: fast, parcel-aware lawn segmentation.
// Design:
//  - Gemini 2.5 Flash only, with a hard latency budget that fits the browser timeout
//  - 512px crop, 36m default window (~7 cm/px), matching the source imagery detail
//  - Strict structured JSON (polygon, confidence, exclusions, notes)
//  - Validates: contains click pixel, plausible area, non-self-intersection, parcel containment
//  - Optional `excludePolygons` returned: model can flag flowerbeds/decks inside lawn
//  - Smooths out near-duplicate vertices server-side

import { rawHttpsGet } from "../_shared/rawHttps.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API = "https://ai.gateway.lovable.dev/v1/chat/completions";
const FLASH_MODEL = "google/gemini-2.5-flash";
const MODEL_TIMEOUT_MS = 13500;
const REFINE_TIMEOUT_MS = 6500;
const DEFAULT_CROP_METERS = 36;
const DEFAULT_IMAGE_SIZE = 512;
const MIN_IMAGE_SIZE = 256;
const MAX_IMAGE_SIZE = 640;
const MIN_CROP_METERS = 16;
const MAX_CROP_METERS = 70;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  return Math.round(clampNumber(value, fallback, min, max));
}

function hashKey(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36);
}

function metersToDeg(m: number, lat: number) {
  return { dLat: m / 111320, dLng: m / (111320 * Math.cos((lat * Math.PI) / 180)) };
}

// Ray-cast: is point inside polygon (pixel space)
function pointInPoly(px: number, py: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    const intersect = ((yi > py) !== (yj > py)) && (px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-9) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Shoelace area in pixel² for sanity check
function polyAreaPx(poly: [number, number][]): number {
  return Math.abs(signedAreaPx(poly));
}

function signedAreaPx(poly: [number, number][]): number {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += (poly[j][0] * poly[i][1]) - (poly[i][0] * poly[j][1]);
  }
  return a / 2;
}

// Drop near-duplicate vertices (< 4px apart)
function dedupeVertices(poly: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const v of poly) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(v[0] - last[0], v[1] - last[1]) >= 4) out.push(v);
  }
  if (out.length > 2) {
    const f = out[0], l = out[out.length - 1];
    if (Math.hypot(f[0] - l[0], f[1] - l[1]) < 4) out.pop();
  }
  return out;
}

type ModelResult =
  | { ok: true; content: string }
  | { ok: false; code: string; status: number; detail: string };

type SegmentCandidate = {
  polygon: [number, number][];
  exclusions: [number, number][][];
  confidence: number;
  notes?: string;
};

type CandidateResult =
  | { ok: true; candidate: SegmentCandidate }
  | { ok: false; code: string; status: number; detail: string; noLawn?: boolean };

async function callModel(model: string, prompt: string, b64: string, aiKey: string, timeoutMs = MODEL_TIMEOUT_MS): Promise<ModelResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(LOVABLE_API, {
      method: "POST",
      signal: controller.signal,
      headers: { Authorization: `Bearer ${aiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 1600,
        response_format: { type: "json_object" },
        messages: [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } },
          ],
        }],
      }),
    });
    if (!r.ok) {
      const errTxt = await r.text().catch(() => "");
      console.warn(`[${model}] HTTP ${r.status}: ${errTxt.slice(0, 200)}`);
      if (r.status === 402) return { ok: false, code: "ai_credits_exhausted", status: 402, detail: "AI credits exhausted" };
      if (r.status === 429) return { ok: false, code: "ai_rate_limited", status: 429, detail: "AI gateway rate limited" };
      return { ok: false, code: "ai_upstream_error", status: 502, detail: `AI gateway returned HTTP ${r.status}` };
    }
    const j = await r.json();
    const content = j.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      return { ok: false, code: "ai_empty_response", status: 502, detail: "AI gateway returned an empty response" };
    }
    return { ok: true, content };
  } catch (e) {
    console.warn(`[${model}] fetch error:`, String(e));
    if ((e as any)?.name === "AbortError") {
      return { ok: false, code: "ai_timeout", status: 504, detail: `AI gateway timed out after ${timeoutMs}ms` };
    }
    return { ok: false, code: "ai_network_error", status: 502, detail: "AI gateway request failed" };
  } finally {
    clearTimeout(timeout);
  }
}

function buildPrompt(width: number, height: number, px: number, py: number, opts: { hint?: string; parcelPixels?: [number, number][] } = {}) {
  const hintNote = opts.hint === "tighter"
    ? "\nBe CONSERVATIVE — only confidently green grass cover."
    : opts.hint === "looser"
      ? "\nBe slightly LOOSER — include grass partially shaded by trees."
      : "";
  const parcelNote = opts.parcelPixels?.length
    ? `\nPROPERTY LIMIT: The user's parcel boundary in image pixels is ${JSON.stringify(opts.parcelPixels.slice(0, 80))}. The lawn polygon MUST stay inside this parcel and must not include neighbours.`
    : "";

  return `You are a precise aerial-imagery segmentation engine for Danish residential lawns.

INPUT: A top-down ortophoto, ${width}x${height} pixels. The marker pixel (${px}, ${py}) is the user's intended lawn point.

GOAL: Trace the OUTER BOUNDARY of the SINGLE connected lawn region that contains the marker pixel.

INCLUDE: continuous grass, mowed strips, areas with patchy/yellowing grass that are still maintained turf.
EXCLUDE: buildings, roofs, driveways, parking, gravel/grus, terraces, wooden decks, paved paths, flowerbeds (bede), hedges, individual shrubs, trees with closed canopy, ponds/water, sand pits, bare soil, neighbouring lawns separated by hedge/fence/path.${hintNote}${parcelNote}

If the marker is clearly not on grass, return an empty polygon with low confidence.

CRITICAL: This is NOT a parcel outline and NOT a convex hull. Do not connect around roofs, patios, roads, driveways, parked cars, gravel or paving. Every polygon edge must stay on the grass/non-grass transition. If a straight segment would cross hardscape or a building, add more vertices and trace around the grass edge instead.

Follow the visible turf edge clockwise. Stay within 1-2 px of the visible transition. Use many vertices for irregular residential lawns; accuracy beats simplicity.

OUTPUT — STRICT JSON only, no markdown, no commentary:
{
  "polygon": [[x,y], ...],
  "exclusions": [[[x,y], ...], ...],
  "confidence": 0.0-1.0,
  "notes": "<short reason for confidence value>"
}

REQUIREMENTS:
- polygon: [] if marker is not on grass; otherwise 18-90 integer-pixel vertices, ordered clockwise along the boundary, MUST contain pixel (${px}, ${py}), no self-intersection, vertices in [0,${width}] x [0,${height}].
- Prefer extra vertices at every visible corner where grass meets roof, driveway, terrace, hedge, bed or road.
- exclusions: 0-3 inner rings for non-lawn islands inside the main polygon (flowerbeds, ponds). Each 6-30 vertices. Empty array if none obvious.
- confidence: honest estimate. 0.9+ = boundary unambiguous; 0.6-0.8 = some shaded/occluded edges; <0.6 = significant uncertainty.

Return ONLY the JSON object.`;
}

function buildRefinePrompt(
  width: number,
  height: number,
  px: number,
  py: number,
  previousPolygon: [number, number][],
  opts: { parcelPixels?: [number, number][] } = {},
) {
  const parcelNote = opts.parcelPixels?.length
    ? `\nPROPERTY LIMIT pixels: ${JSON.stringify(opts.parcelPixels.slice(0, 80))}. Stay inside it.`
    : "";

  return `You are correcting an aerial lawn segmentation.

Image size: ${width}x${height}. Marker pixel: (${px}, ${py}).
Previous polygon: ${JSON.stringify(previousPolygon)}

The previous polygon may be too coarse. Fix it so it includes ONLY visible grass connected to the marker.

Hard rule: remove any roof, patio, driveway, road, parking area, gravel, paving, hedge, flowerbed, tree canopy, car, or bare soil. Do not draw a hull around those objects. If an edge crosses non-grass, replace it with vertices along the real grass boundary.${parcelNote}

Return STRICT JSON only:
{
  "polygon": [[x,y], ...],
  "exclusions": [[[x,y], ...], ...],
  "confidence": 0.0-1.0,
  "notes": "<short correction note>"
}

Requirements: polygon must contain (${px}, ${py}), use 18-90 integer vertices, no self-intersection, all vertices inside [0,${width}] x [0,${height}].`;
}

function parseJson(txt: string): any | null {
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

function parsePixelRing(raw: unknown, width: number, height: number): [number, number][] | null {
  if (!Array.isArray(raw)) return null;
  const out: [number, number][] = [];
  for (const p of raw) {
    if (!Array.isArray(p) || p.length < 2) return null;
    const x = Math.round(Number(p[0]));
    const y = Math.round(Number(p[1]));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    if (x < 0 || x > width || y < 0 || y > height) return null;
    out.push([x, y]);
  }
  return out;
}

function normalizeClockwise(poly: [number, number][]): [number, number][] {
  // In image coordinates y grows downward, so positive shoelace area is visually clockwise.
  return signedAreaPx(poly) >= 0 ? poly : [...poly].reverse();
}

function pointOnSegment(px: number, py: number, a: [number, number], b: [number, number]): boolean {
  const cross = (px - a[0]) * (b[1] - a[1]) - (py - a[1]) * (b[0] - a[0]);
  if (Math.abs(cross) > 1e-7) return false;
  const dot = (px - a[0]) * (b[0] - a[0]) + (py - a[1]) * (b[1] - a[1]);
  if (dot < -1e-7) return false;
  const lenSq = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
  return dot <= lenSq + 1e-7;
}

function pointInOrOnPoly(px: number, py: number, poly: [number, number][]): boolean {
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (pointOnSegment(px, py, poly[j], poly[i])) return true;
  }
  return pointInPoly(px, py, poly);
}

function segmentOrientation(a: [number, number], b: [number, number], c: [number, number]): number {
  const v = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
  if (Math.abs(v) < 1e-7) return 0;
  return v > 0 ? 1 : 2;
}

function segmentsIntersect(a: [number, number], b: [number, number], c: [number, number], d: [number, number]): boolean {
  const o1 = segmentOrientation(a, b, c);
  const o2 = segmentOrientation(a, b, d);
  const o3 = segmentOrientation(c, d, a);
  const o4 = segmentOrientation(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && pointOnSegment(c[0], c[1], a, b)) return true;
  if (o2 === 0 && pointOnSegment(d[0], d[1], a, b)) return true;
  if (o3 === 0 && pointOnSegment(a[0], a[1], c, d)) return true;
  if (o4 === 0 && pointOnSegment(b[0], b[1], c, d)) return true;
  return false;
}

function hasSelfIntersection(poly: [number, number][]): boolean {
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      const adjacent = j === i || j === (i + 1) % n || i === (j + 1) % n;
      if (adjacent) continue;
      const c = poly[j];
      const d = poly[(j + 1) % n];
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}

function ringInsideRing(inner: [number, number][], outer: [number, number][]): boolean {
  return inner.every(([x, y]) => pointInOrOnPoly(x, y, outer));
}

function areaMetersFromPx(areaPx: number, width: number, height: number, bbox: [number, number, number, number], lat: number): number {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const widthM = Math.abs(maxLng - minLng) * 111320 * Math.cos((lat * Math.PI) / 180);
  const heightM = Math.abs(maxLat - minLat) * 111320;
  return (areaPx / (width * height)) * widthM * heightM;
}

function maxEdgePx(poly: [number, number][]): number {
  let max = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    max = Math.max(max, Math.hypot(a[0] - b[0], a[1] - b[1]));
  }
  return max;
}

function shouldRefine(poly: [number, number][], width: number, height: number, confidence: number): boolean {
  const longEdge = maxEdgePx(poly) > Math.min(width, height) * 0.18;
  return poly.length < 24 || longEdge || confidence < 0.82;
}

function candidateFromParsed(
  parsed: any,
  width: number,
  height: number,
  px: number,
  py: number,
  bbox: [number, number, number, number],
  lat: number,
  parcelPixels?: [number, number][],
): CandidateResult {
  if (Array.isArray(parsed?.polygon) && parsed.polygon.length === 0) {
    return {
      ok: false,
      code: "no_lawn",
      status: 422,
      detail: typeof parsed.notes === "string" ? parsed.notes : "Ingen plæne fundet ved markøren",
      noLawn: true,
    };
  }
  if (!parsed?.polygon || !Array.isArray(parsed.polygon) || parsed.polygon.length < 4) {
    return { ok: false, code: "ai_bad_response", status: 502, detail: "AI response did not include a usable polygon" };
  }

  const rawPoly = parsePixelRing(parsed.polygon, width, height);
  if (!rawPoly) {
    return { ok: false, code: "invalid_geometry", status: 422, detail: "polygon contains invalid coordinates" };
  }

  const poly = normalizeClockwise(dedupeVertices(rawPoly));
  const area = polyAreaPx(poly);
  const minArea = (width * height) * 0.005;
  const maxArea = (width * height) * 0.95;
  const areaM2 = areaMetersFromPx(area, width, height, bbox, lat);
  const containsClick = pointInOrOnPoly(px, py, poly);

  let failureReason = "";
  if (!containsClick) failureReason = `polygon does not contain marker pixel (${px}, ${py})`;
  else if (area < minArea) failureReason = `polygon too small (${Math.round(area)} px², expected > ${Math.round(minArea)})`;
  else if (area > maxArea) failureReason = "polygon covers nearly the whole crop — likely the wrong region";
  else if (areaM2 < 4) failureReason = `polygon area too small (${areaM2.toFixed(1)} m²)`;
  else if (areaM2 > 5000) failureReason = `polygon area too large (${Math.round(areaM2)} m²)`;
  else if (hasSelfIntersection(poly)) failureReason = "polygon self-intersects";
  else if (parcelPixels?.length && !ringInsideRing(poly, parcelPixels)) failureReason = "polygon leaves parcel boundary";

  const confidence = Math.max(0, Math.min(1, typeof parsed.confidence === "number" ? parsed.confidence : 0.7));
  if (!failureReason && confidence < 0.45) failureReason = `low confidence (${confidence.toFixed(2)})`;

  if (failureReason) {
    return { ok: false, code: "invalid_geometry", status: 422, detail: failureReason };
  }

  const exclusions: [number, number][][] = Array.isArray(parsed.exclusions)
    ? parsed.exclusions
        .filter((r: any) => Array.isArray(r) && r.length >= 4)
        .map((r: any[]) => parsePixelRing(r, width, height))
        .filter((r: [number, number][] | null): r is [number, number][] => !!r)
        .map((r: [number, number][]) => normalizeClockwise(dedupeVertices(r)))
        .filter((r: [number, number][]) => r.length >= 4)
        .filter((r: [number, number][]) => !hasSelfIntersection(r))
        .filter((r: [number, number][]) => ringInsideRing(r, poly))
    : [];

  return {
    ok: true,
    candidate: {
      polygon: poly,
      exclusions,
      confidence,
      notes: parsed.notes,
    },
  };
}

async function fetchImageBytes(url: string, attempts = 2, timeoutMs = 6500): Promise<Uint8Array> {
  let last = "";
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      // Raw TLS GET (handles the Dataforsyningen gateway's unclean TLS close).
      const response = await rawHttpsGet(url, timeoutMs, { Accept: "image/jpeg,image/png" });
      if (!response || response.status !== 200) {
        last = `HTTP ${response?.status ?? "no-response"}`;
        continue;
      }
      if (response.contentType.includes("xml")) {
        last = "service exception";
        continue;
      }
      if (response.body.byteLength > 100) return response.body;
      last = "empty image response";
    } catch (e) {
      last = String(e);
    }
  }
  throw new Error(last || "image fetch failed");
}

async function fetchMapboxFallbackImage(
  bbox: [number, number, number, number],
  width: number,
  height: number,
): Promise<Uint8Array | null> {
  const token = Deno.env.get("MAPBOX_PUBLIC_TOKEN");
  if (!token) return null;
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const staticUrl = `https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/`
    + `[${minLng},${minLat},${maxLng},${maxLat}]/${width}x${height}`
    + `?access_token=${encodeURIComponent(token)}`;
  try {
    return await fetchImageBytes(staticUrl, 1, 6500);
  } catch (e) {
    console.warn("mapbox fallback image failed", String(e));
    return null;
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    let {
      click,
      cropMeters = DEFAULT_CROP_METERS,
      width = DEFAULT_IMAGE_SIZE,
      height = DEFAULT_IMAGE_SIZE,
      hint,
      parcelBbox,
      parcelPolygon,
    } = body as {
      click: [number, number]; cropMeters?: number; width?: number; height?: number; hint?: string;
      parcelBbox?: [number, number, number, number]; // [minLng,minLat,maxLng,maxLat]
      parcelPolygon?: [number, number][];
    };

    if (!Array.isArray(click) || click.length !== 2 || !Number.isFinite(Number(click[0])) || !Number.isFinite(Number(click[1]))) {
      return json({ error: "invalid_request", detail: "click [lng,lat] required" }, 400);
    }

    const dfToken = Deno.env.get("DATAFORSYNINGEN_TOKEN");
    const aiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!dfToken || !aiKey) {
      return json({ error: "missing_config", detail: "DATAFORSYNINGEN_TOKEN or LOVABLE_API_KEY missing" }, 500);
    }

    cropMeters = clampNumber(cropMeters, DEFAULT_CROP_METERS, MIN_CROP_METERS, MAX_CROP_METERS);
    width = clampInt(width, DEFAULT_IMAGE_SIZE, MIN_IMAGE_SIZE, MAX_IMAGE_SIZE);
    height = clampInt(height, width, MIN_IMAGE_SIZE, MAX_IMAGE_SIZE);

    const [clng, clat] = [Number(click[0]), Number(click[1])];
    if (clng < -180 || clng > 180 || clat < -90 || clat > 90) {
      return json({ error: "invalid_request", detail: "click coordinates out of range" }, 400);
    }
    const half = cropMeters / 2;
    const { dLat, dLng } = metersToDeg(half, clat);
    let minLat = clat - dLat, maxLat = clat + dLat;
    let minLng = clng - dLng, maxLng = clng + dLng;

    // If a parcel bbox is provided, clip the crop window to it (with small padding)
    // so the AI only sees the user's own property.
    if (parcelBbox && parcelBbox.length === 4) {
      const [pMinLng, pMinLat, pMaxLng, pMaxLat] = parcelBbox;
      const pad = metersToDeg(3, clat); // 3m breathing room
      if (clng < pMinLng - pad.dLng || clng > pMaxLng + pad.dLng || clat < pMinLat - pad.dLat || clat > pMaxLat + pad.dLat) {
        return json({ error: "outside_parcel", detail: "Click is outside the selected parcel" }, 422);
      }
      minLng = Math.max(minLng, pMinLng - pad.dLng);
      maxLng = Math.min(maxLng, pMaxLng + pad.dLng);
      minLat = Math.max(minLat, pMinLat - pad.dLat);
      maxLat = Math.min(maxLat, pMaxLat + pad.dLat);
      // Make square (preserves the click center as best as possible)
      const w = maxLng - minLng, h = maxLat - minLat;
      if (w > 0 && h > 0) {
        // expand the smaller axis to match the larger so image isn't stretched
        if (w > h) {
          const extra = (w - h) / 2;
          minLat -= extra; maxLat += extra;
        } else if (h > w) {
          const extra = (h - w) / 2 / Math.cos((clat * Math.PI) / 180);
          minLng -= extra; maxLng += extra;
        }
      }
    }

    if (!(minLng < maxLng) || !(minLat < maxLat)) {
      return json({ error: "invalid_request", detail: "Crop bbox is empty" }, 400);
    }

    const cacheKey = hashKey(JSON.stringify({ click: [clng.toFixed(6), clat.toFixed(6)], cropMeters, width, height, hint: hint ?? "", parcel: parcelBbox?.map(n=>n.toFixed(5)).join(",") ?? "", v: 7 }));
    const supaUrl = Deno.env.get("SUPABASE_URL")!;
    const supaKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Cache lookup
    try {
      const cacheRes = await fetch(
        `${supaUrl}/rest/v1/lawn_segmentation_cache?bbox_hash=eq.${cacheKey}&select=polygon`,
        { headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` } },
      );
      const cached = await cacheRes.json().catch(() => []);
      if (Array.isArray(cached) && cached[0]?.polygon) {
        return new Response(JSON.stringify({
          polygon: cached[0].polygon, cached: true, confidence: 0.95,
          bbox: [minLng, minLat, maxLng, maxLat],
        }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
    } catch (e) { console.warn("cache lookup failed:", String(e)); }

    // Fetch ortofoto WMS
    const wms = `https://api.dataforsyningen.dk/orto_foraar_DAF?service=WMS&request=GetMap`
      + `&version=1.3.0&layers=orto_foraar&styles=&format=image/jpeg&transparent=FALSE`
      + `&width=${width}&height=${height}&crs=EPSG:4326`
      + `&bbox=${minLat},${minLng},${maxLat},${maxLng}&token=${dfToken}`;

    let imgBuf: Uint8Array;
    try {
      imgBuf = await fetchImageBytes(wms, 1, 4500);
    } catch (e) {
      console.warn("ortofoto crop failed, trying mapbox fallback", String(e));
      const fallback = await fetchMapboxFallbackImage([minLng, minLat, maxLng, maxLat], width, height);
      if (!fallback) {
        return json({ error: "imagery_fetch_failed", detail: String(e) }, 502);
      }
      imgBuf = fallback;
    }
    let bin = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < imgBuf.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, Array.from(imgBuf.subarray(i, i + CHUNK)) as any);
    }
    const b64 = btoa(bin);

    // Click pixel within the (possibly parcel-clipped) crop
    const px = Math.round(((clng - minLng) / (maxLng - minLng)) * width);
    const py = Math.round(((maxLat - clat) / (maxLat - minLat)) * height);
    const ll2px = ([lng, lat]: [number, number]): [number, number] => [
      Math.round(((lng - minLng) / (maxLng - minLng)) * width),
      Math.round(((maxLat - lat) / (maxLat - minLat)) * height),
    ];
    const rawParcelPixels = Array.isArray(parcelPolygon) && parcelPolygon.length >= 3
      ? parcelPolygon.map(ll2px).filter(([x, y]) => x >= -80 && x <= width + 80 && y >= -80 && y <= height + 80)
      : [];
    const parcelPixels = rawParcelPixels.length >= 3 ? rawParcelPixels : undefined;

    const models: Array<{ id: string; timeout: number }> = [
      { id: FLASH_MODEL, timeout: MODEL_TIMEOUT_MS },
    ];

    let best: SegmentCandidate | null = null;
    let lastError = "";
    let lastFailure: ModelResult | null = null;
    let noLawnNote: string | null = null;

    for (const m of models) {
      const model = m.id;
      const result = await callModel(model, buildPrompt(width, height, px, py, { hint, parcelPixels }), b64, aiKey, m.timeout);
      if (!result.ok) { lastFailure = result; lastError = `${model}: ${result.detail}`; continue; }
      let parsed = parseJson(result.content);
      if (!parsed) {
        console.warn(`[${model}] unparseable response (first 400 chars):`, result.content.slice(0, 400));
        lastFailure = { ok: false, code: "ai_bad_response", status: 502, detail: "AI response was not valid JSON" };
        lastError = `${model}: unparseable response`;
        continue;
      }
      let candidate = candidateFromParsed(parsed, width, height, px, py, [minLng, minLat, maxLng, maxLat], clat, parcelPixels);
      if (!candidate.ok) {
        if (candidate.noLawn) {
          noLawnNote = candidate.detail;
          console.warn(`[${model}] no lawn detected: ${noLawnNote}`);
          lastError = `${model}: no lawn at click`;
          continue;
        }
        lastFailure = { ok: false, code: candidate.code, status: candidate.status, detail: candidate.detail };
        lastError = `${model}: ${candidate.detail}`;
        continue;
      }

      best = candidate.candidate;

      if (shouldRefine(best.polygon, width, height, best.confidence)) {
        const refineResult = await callModel(
          model,
          buildRefinePrompt(width, height, px, py, best.polygon, { parcelPixels }),
          b64,
          aiKey,
          REFINE_TIMEOUT_MS,
        );
        if (refineResult.ok) {
          const refinedParsed = parseJson(refineResult.content);
          if (refinedParsed) {
            const refined = candidateFromParsed(refinedParsed, width, height, px, py, [minLng, minLat, maxLng, maxLat], clat, parcelPixels);
            if (refined.ok) {
              best = {
                ...refined.candidate,
                notes: refined.candidate.notes ?? best.notes,
              };
            } else {
              console.warn(`[${model}] refine rejected: ${refined.detail}`);
            }
          }
        } else {
          console.warn(`[${model}] refine skipped: ${refineResult.detail}`);
        }
      }
      break;
    }

    if (!best) {
      if (noLawnNote) {
        return json({ error: "no_lawn", detail: noLawnNote, noLawn: true }, 422);
      }
      if (lastFailure && !lastFailure.ok) {
        return json({ error: lastFailure.code, detail: lastFailure.detail, fallback: true }, lastFailure.status);
      }
      return json({ error: "ai_failed", detail: lastError, fallback: true }, 502);
    }

    // pixel -> lng/lat
    const px2ll = ([x, y]: [number, number]): [number, number] => [
      minLng + (x / width) * (maxLng - minLng),
      maxLat - (y / height) * (maxLat - minLat),
    ];
    const lnglat = best.polygon.map(px2ll);
    const exclusionsLL = best.exclusions.map((r) => r.map(px2ll));

    // Cache (only when confidence reasonable)
    if (best.confidence >= 0.6) {
      try {
        await fetch(`${supaUrl}/rest/v1/lawn_segmentation_cache`, {
          method: "POST",
          headers: {
            apikey: supaKey, Authorization: `Bearer ${supaKey}`,
            "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates",
          },
          body: JSON.stringify({ bbox_hash: cacheKey, polygon: lnglat, source: "gemini-flash-v5" }),
        });
      } catch (e) { console.warn("cache write failed:", String(e)); }
    }

    return json({
      polygon: lnglat,
      exclusions: exclusionsLL,
      cached: false,
      confidence: best.confidence,
      notes: best.notes,
      bbox: [minLng, minLat, maxLng, maxLat],
    });
  } catch (e) {
    return json({ error: "server_error", detail: String(e) }, 500);
  }
});
