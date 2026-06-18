import { rawHttpsGet } from "../_shared/rawHttps.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_CROP_METERS = 36;
const DEFAULT_IMAGE_SIZE = 512;
const MIN_IMAGE_SIZE = 256;
const MAX_IMAGE_SIZE = 768;
const MIN_CROP_METERS = 12;
const MAX_CROP_METERS = 90;

type LngLat = [number, number];
type Bbox = [number, number, number, number];
type PixelPoint = [number, number];

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

function metersToDeg(meters: number, lat: number) {
  return {
    dLat: meters / 111320,
    dLng: meters / (111320 * Math.max(0.15, Math.cos((lat * Math.PI) / 180))),
  };
}

function ringBbox(ring?: LngLat[] | null): Bbox | null {
  if (!Array.isArray(ring) || ring.length < 3) return null;
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const p of ring) {
    if (!Array.isArray(p) || p.length < 2) continue;
    const lng = Number(p[0]);
    const lat = Number(p[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;
    minLng = Math.min(minLng, lng);
    minLat = Math.min(minLat, lat);
    maxLng = Math.max(maxLng, lng);
    maxLat = Math.max(maxLat, lat);
  }
  if (!Number.isFinite(minLng) || !(minLng < maxLng) || !(minLat < maxLat)) return null;
  return [minLng, minLat, maxLng, maxLat];
}

function pointInPoly(lng: number, lat: number, ring: LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = ((yi > lat) !== (yj > lat))
      && lng < ((xj - xi) * (lat - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function deriveCropBbox(click: LngLat, cropMeters: number, parcelPolygon?: LngLat[] | null): Bbox {
  const [lng, lat] = click;
  const half = cropMeters / 2;
  const { dLat, dLng } = metersToDeg(half, lat);
  let bbox: Bbox = [lng - dLng, lat - dLat, lng + dLng, lat + dLat];
  const parcelBox = ringBbox(parcelPolygon);
  if (!parcelBox) return bbox;

  const pad = metersToDeg(3, lat);
  bbox = [
    Math.max(bbox[0], parcelBox[0] - pad.dLng),
    Math.max(bbox[1], parcelBox[1] - pad.dLat),
    Math.min(bbox[2], parcelBox[2] + pad.dLng),
    Math.min(bbox[3], parcelBox[3] + pad.dLat),
  ];
  if (!(bbox[0] < bbox[2]) || !(bbox[1] < bbox[3])) return [lng - dLng, lat - dLat, lng + dLng, lat + dLat];

  const widthM = (bbox[2] - bbox[0]) * 111320 * Math.cos((lat * Math.PI) / 180);
  const heightM = (bbox[3] - bbox[1]) * 111320;
  if (widthM <= 0 || heightM <= 0) return bbox;
  if (widthM > heightM) {
    const extra = metersToDeg((widthM - heightM) / 2, lat).dLat;
    bbox[1] -= extra;
    bbox[3] += extra;
  } else if (heightM > widthM) {
    const extra = metersToDeg((heightM - widthM) / 2, lat).dLng;
    bbox[0] -= extra;
    bbox[2] += extra;
  }
  return bbox;
}

function lngLatToPixel([lng, lat]: LngLat, bbox: Bbox, width: number, height: number): PixelPoint {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  return [
    Math.round(((lng - minLng) / (maxLng - minLng || 1)) * width),
    Math.round(((maxLat - lat) / (maxLat - minLat || 1)) * height),
  ];
}

function metersPerPx(bbox: Bbox, width: number, height: number) {
  const [, minLat, , maxLat] = bbox;
  const midLat = (minLat + maxLat) / 2;
  const widthM = Math.abs(bbox[2] - bbox[0]) * 111320 * Math.cos((midLat * Math.PI) / 180);
  const heightM = Math.abs(bbox[3] - bbox[1]) * 111320;
  return ((widthM / width) + (heightM / height)) / 2;
}

async function fetchImageBytes(url: string, attempts: number, timeoutMs: number): Promise<Uint8Array> {
  let lastDetail = "";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      // Raw TLS GET (handles the Dataforsyningen gateway's unclean TLS close).
      const response = await rawHttpsGet(url, timeoutMs, { Accept: "image/jpeg,image/png" });
      if (!response || response.status !== 200) {
        lastDetail = `HTTP ${response?.status ?? "no-response"}`;
      } else if (response.contentType.includes("xml")) {
        lastDetail = "service exception";
      } else if (response.body.byteLength > 100) {
        return response.body;
      } else {
        lastDetail = "empty image response";
      }
    } catch (e) {
      lastDetail = String(e);
    }
    if (attempt < attempts) await new Promise((resolve) => setTimeout(resolve, 140 * attempt));
  }
  throw new Error(lastDetail || "image fetch failed");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
  }
  return btoa(binary);
}

function dataforsyningenUrl(bbox: Bbox, width: number, height: number, token: string) {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  return "https://api.dataforsyningen.dk/orto_foraar_DAF?service=WMS&request=GetMap"
    + "&version=1.3.0&layers=orto_foraar&styles=&format=image/jpeg&transparent=FALSE"
    + `&width=${width}&height=${height}&crs=EPSG:4326`
    + `&bbox=${minLat},${minLng},${maxLat},${maxLng}&token=${encodeURIComponent(token)}`;
}

function mapboxStaticUrl(bbox: Bbox, width: number, height: number, token: string) {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  return "https://api.mapbox.com/styles/v1/mapbox/satellite-v9/static/"
    + `[${minLng},${minLat},${maxLng},${maxLat}]/${width}x${height}`
    + `?access_token=${encodeURIComponent(token)}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed", detail: "POST required" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const click = body.click as LngLat | undefined;
    if (!Array.isArray(click) || click.length !== 2 || !Number.isFinite(Number(click[0])) || !Number.isFinite(Number(click[1]))) {
      return json({ error: "invalid_request", detail: "click [lng,lat] required" }, 400);
    }
    const lng = Number(click[0]);
    const lat = Number(click[1]);
    if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      return json({ error: "invalid_request", detail: "click coordinates out of range" }, 400);
    }

    const cropMeters = clampNumber(body.cropMeters, DEFAULT_CROP_METERS, MIN_CROP_METERS, MAX_CROP_METERS);
    const imageSize = clampInt(body.imageSize ?? body.width ?? DEFAULT_IMAGE_SIZE, DEFAULT_IMAGE_SIZE, MIN_IMAGE_SIZE, MAX_IMAGE_SIZE);
    const width = clampInt(body.width ?? imageSize, imageSize, MIN_IMAGE_SIZE, MAX_IMAGE_SIZE);
    const height = clampInt(body.height ?? imageSize, imageSize, MIN_IMAGE_SIZE, MAX_IMAGE_SIZE);
    const parcelPolygon = Array.isArray(body.parcelPolygon)
      ? body.parcelPolygon
          .filter((p: unknown) => Array.isArray(p) && p.length >= 2)
          .map((p: any) => [Number(p[0]), Number(p[1])] as LngLat)
          .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y))
      : null;

    if (parcelPolygon?.length >= 3 && !pointInPoly(lng, lat, parcelPolygon)) {
      const pad = metersToDeg(1.5, lat);
      const box = ringBbox(parcelPolygon);
      const nearBox = box && lng >= box[0] - pad.dLng && lng <= box[2] + pad.dLng && lat >= box[1] - pad.dLat && lat <= box[3] + pad.dLat;
      if (!nearBox) return json({ error: "outside_parcel", detail: "Click is outside the selected parcel" }, 422);
    }

    const bbox = deriveCropBbox([lng, lat], cropMeters, parcelPolygon);
    if (!(bbox[0] < bbox[2]) || !(bbox[1] < bbox[3])) {
      return json({ error: "invalid_request", detail: "Crop bbox is empty" }, 400);
    }

    const dataforsyningenToken = Deno.env.get("DATAFORSYNINGEN_TOKEN");
    const mapboxToken = Deno.env.get("MAPBOX_PUBLIC_TOKEN");
    const diagnostics: Record<string, unknown> = {
      cropMeters,
      width,
      height,
      bbox,
      fallbacks: [],
    };

    let bytes: Uint8Array | null = null;
    let imagerySource: "dataforsyningen" | "mapbox" = "dataforsyningen";
    if (dataforsyningenToken) {
      try {
        bytes = await fetchImageBytes(dataforsyningenUrl(bbox, width, height, dataforsyningenToken), 2, 5200);
      } catch (e) {
        diagnostics.dataforsyningenError = String(e);
        (diagnostics.fallbacks as string[]).push("mapbox");
      }
    } else {
      diagnostics.dataforsyningenError = "DATAFORSYNINGEN_TOKEN missing";
      (diagnostics.fallbacks as string[]).push("mapbox");
    }

    if (!bytes) {
      if (!mapboxToken) {
        return json({
          error: "imagery_fetch_failed",
          detail: diagnostics.dataforsyningenError ?? "No imagery provider available",
          diagnostics,
        }, 502);
      }
      imagerySource = "mapbox";
      try {
        bytes = await fetchImageBytes(mapboxStaticUrl(bbox, width, height, mapboxToken), 1, 6500);
      } catch (e) {
        diagnostics.mapboxError = String(e);
        return json({ error: "imagery_fetch_failed", detail: String(e), diagnostics }, 502);
      }
    }

    const clickPx = lngLatToPixel([lng, lat], bbox, width, height);
    const parcelPx = parcelPolygon && parcelPolygon.length >= 3
      ? parcelPolygon
          .map((p) => lngLatToPixel(p, bbox, width, height))
          .filter(([x, y]) => x >= -width && x <= width * 2 && y >= -height && y <= height * 2)
      : null;

    return json({
      imageBase64: bytesToBase64(bytes),
      bbox,
      clickPx,
      metersPerPx: metersPerPx(bbox, width, height),
      parcelPx: parcelPx && parcelPx.length >= 3 ? parcelPx : null,
      imagerySource,
      diagnostics,
    });
  } catch (e) {
    return json({ error: "server_error", detail: String(e) }, 500);
  }
});
