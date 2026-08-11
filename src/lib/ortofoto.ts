/**
 * Ortofoto imagery helpers.
 *
 * Every aerial image in the app comes from Dataforsyningen's ortofoto WMS, proxied
 * through the `ortofoto-tile` edge function so the service token never reaches the
 * browser. The proxy speaks WMS bboxes in EPSG:3857, which is what MapLibre's
 * `{bbox-epsg-3857}` raster token expands to.
 *
 * The tile URL is built here from `VITE_SUPABASE_URL` rather than taken from
 * `get-ortofoto-config`. On a self-hosted stack that function sees `SUPABASE_URL`
 * as the stack-internal Kong address (`http://kong:8000`), which no browser can
 * resolve — the frontend is the only party that knows its own public endpoint.
 */

const MERCATOR_RADIUS = 20037508.342789244;
const TILE_PIXELS = 512;

function supabaseOrigin(): string {
  const url = import.meta.env.VITE_SUPABASE_URL;
  return typeof url === "string" ? url.replace(/\/+$/, "") : "";
}

/** Raster tile template for MapLibre. Empty string when no endpoint is configured. */
export function ortofotoTileTemplate(): string {
  const origin = supabaseOrigin();
  if (!origin) return "";
  return `${origin}/functions/v1/ortofoto-tile`
    + `?width=${TILE_PIXELS}&height=${TILE_PIXELS}&bbox={bbox-epsg-3857}`;
}

function lngToMercator(lng: number) {
  return (lng * MERCATOR_RADIUS) / 180;
}

function latToMercator(lat: number) {
  // Web Mercator is undefined at the poles; clamp to the standard cutoff.
  const clamped = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const y = Math.log(Math.tan(((90 + clamped) * Math.PI) / 360)) / (Math.PI / 180);
  return (y * MERCATOR_RADIUS) / 180;
}

/** Metres per pixel at a given web-mercator zoom (256px tile convention). */
function groundResolution(zoom: number) {
  return (2 * MERCATOR_RADIUS) / (256 * Math.pow(2, zoom));
}

type StaticImageOptions = {
  width?: number;
  height?: number;
  zoom?: number;
};

/**
 * A single ortofoto JPEG centred on a coordinate — the replacement for a static
 * satellite image API. Returns null for coordinates we cannot place.
 */
export function ortofotoStaticUrl(
  lng: number,
  lat: number,
  options: StaticImageOptions = {},
): string | null {
  const origin = supabaseOrigin();
  if (!origin || !Number.isFinite(lng) || !Number.isFinite(lat)) return null;

  // The proxy caps a side at 512px, so ask for at most that and let the <img> scale.
  const width = Math.min(512, Math.max(128, Math.round(options.width ?? 512)));
  const height = Math.min(512, Math.max(128, Math.round(options.height ?? 320)));
  const zoom = options.zoom ?? 19;

  const resolution = groundResolution(zoom);
  const halfW = (width * resolution) / 2;
  const halfH = (height * resolution) / 2;
  const cx = lngToMercator(lng);
  const cy = latToMercator(lat);
  const bbox = [cx - halfW, cy - halfH, cx + halfW, cy + halfH]
    .map((n) => n.toFixed(3))
    .join(",");

  return `${origin}/functions/v1/ortofoto-tile?width=${width}&height=${height}&bbox=${bbox}`;
}

/** Attribution required by SDFI for ortofoto imagery. */
export const ORTOFOTO_ATTRIBUTION = "© SDFI / Dataforsyningen";

/**
 * Glyphs for MapLibre symbol layers. Served from `public/fonts` so the map has no
 * runtime dependency on a font CDN — see `public/fonts/README.md`.
 */
export const MAP_GLYPHS = "/fonts/{fontstack}/{range}.pbf";

/** The only font stack we ship glyphs for. */
export const MAP_FONT_STACK = ["Open Sans Bold"];
