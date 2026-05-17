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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/geo+json, application/json" },
    });
    let text = "";
    try {
      text = await response.text();
    } catch (e) {
      return { ok: false, status: response.status, text: "", err: String(e) };
    }
    return { ok: response.ok, status: response.status, text, err: "" };
  } catch (e) {
    return { ok: false, status: 0, text: "", err: String(e) };
  } finally {
    clearTimeout(timeout);
  }
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
