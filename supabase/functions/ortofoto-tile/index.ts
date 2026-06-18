import { rawHttpsGet } from "../_shared/rawHttps.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TILE_HEADERS = {
  ...corsHeaders,
  "Content-Type": "image/jpeg",
  "Cache-Control": "public, max-age=86400, s-maxage=604800",
};

const BLANK_PNG = Uint8Array.from(
  atob("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII="),
  (c) => c.charCodeAt(0),
);

function blankTile(status = 200) {
  return new Response(BLANK_PNG, {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "image/png",
      "Cache-Control": "public, max-age=60, s-maxage=300",
    },
  });
}

function parseBbox(value: string | null): [number, number, number, number] | null {
  const parts = (value ?? "").split(",").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) return null;
  const [minX, minY, maxX, maxY] = parts;
  if (!(minX < maxX) || !(minY < maxY)) return null;
  const world = 20037508.342789244;
  if (parts.some((n) => Math.abs(n) > world + 1)) return null;
  return [minX, minY, maxX, maxY];
}

function tileSize(value: string | null): number {
  const n = Math.round(Number(value ?? 512));
  if (!Number.isFinite(n)) return 512;
  return Math.max(128, Math.min(512, n));
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const token = Deno.env.get("DATAFORSYNINGEN_TOKEN");
  if (!token) return blankTile(200);

  const url = new URL(req.url);
  const bbox = parseBbox(url.searchParams.get("bbox"));
  if (!bbox) return blankTile(200);

  const width = tileSize(url.searchParams.get("width"));
  const height = tileSize(url.searchParams.get("height"));
  const wms = `https://api.dataforsyningen.dk/orto_foraar_DAF?service=WMS&request=GetMap&version=1.3.0`
    + `&layers=orto_foraar&styles=&format=image/jpeg&transparent=FALSE`
    + `&width=${width}&height=${height}&crs=EPSG:3857`
    + `&bbox=${bbox.join(",")}&token=${encodeURIComponent(token)}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const upstream = await rawHttpsGet(wms, 4500, { Accept: "image/jpeg" });
      if (!upstream || upstream.status !== 200) continue;
      if (upstream.body.byteLength < 100) continue;
      // Guard against an XML ServiceException slipping through as a "tile".
      if (upstream.contentType.includes("xml")) continue;
      return new Response(upstream.body, { headers: TILE_HEADERS });
    } catch (e) {
      console.warn("ortofoto tile failed", String(e));
    }
  }

  return blankTile(200);
});
