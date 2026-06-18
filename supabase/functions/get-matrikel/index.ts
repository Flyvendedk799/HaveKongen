import { rawHttpsGet, decodeText } from "../_shared/rawHttps.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function emptyFeatureCollection(detail?: string) {
  return json({ type: "FeatureCollection", features: [], detail });
}

async function fetchTextWithTimeout(url: string, timeoutMs: number) {
  // Raw TLS GET: the Dataforsyningen gateway closes chunked connections without
  // close_notify, which Deno's fetch rejects ("unexpected end of file").
  const res = await rawHttpsGet(url, timeoutMs, { Accept: "application/geo+json, application/json" });
  if (!res) return { ok: false, status: 0, text: "", err: "request failed" };
  return { ok: res.status >= 200 && res.status < 300, status: res.status, text: decodeText(res.body), err: "" };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const token = Deno.env.get("DATAFORSYNINGEN_TOKEN");
    if (!token) return emptyFeatureCollection("DATAFORSYNINGEN_TOKEN not set");

    const url = new URL(req.url);
    const lng = parseFloat(url.searchParams.get("lng") ?? "");
    const lat = parseFloat(url.searchParams.get("lat") ?? "");
    if (!isFinite(lng) || !isFinite(lat)) {
      return emptyFeatureCollection("lng and lat required");
    }

    const restApi = `https://api.dataforsyningen.dk/jordstykker?x=${lng}&y=${lat}&srid=4326&format=geojson&token=${encodeURIComponent(token)}`;

    let lastDetail = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await fetchTextWithTimeout(restApi, 5000);
      if (!result.ok) {
        lastDetail = result.err || `HTTP ${result.status}: ${result.text.slice(0, 240)}`;
        continue;
      }
      try {
        const parsed = JSON.parse(result.text);
        if (parsed?.type === "FeatureCollection") return json(parsed);
        lastDetail = "Unexpected GeoJSON shape";
      } catch (e) {
        lastDetail = `Invalid GeoJSON: ${String(e)}`;
      }
    }

    console.warn("matrikel lookup unavailable", lastDetail);
    return emptyFeatureCollection(lastDetail);
  } catch (e) {
    console.warn("matrikel lookup crashed", String(e));
    return emptyFeatureCollection(String(e));
  }
});
