// segment-lawn v2: center-cropped high-resolution analysis around click point.
// Returns polygon in lng/lat + confidence + analyzed bbox for client preview.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API = "https://ai.gateway.lovable.dev/v1/chat/completions";

function hashKey(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36);
}

// Convert meters to degrees latitude/longitude at given lat
function metersToDeg(m: number, lat: number): { dLat: number; dLng: number } {
  const dLat = m / 111320;
  const dLng = m / (111320 * Math.cos((lat * Math.PI) / 180));
  return { dLat, dLng };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const {
      click,
      cropMeters = 80, // size of analyzed window in meters (square)
      width = 768,
      height = 768,
      hint, // optional: "tighter" | "looser" — for retry
    } = body as {
      click: [number, number];
      cropMeters?: number;
      width?: number;
      height?: number;
      hint?: string;
    };

    if (!click || click.length !== 2) {
      return new Response(JSON.stringify({ error: "click [lng,lat] required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const dfToken = Deno.env.get("DATAFORSYNINGEN_TOKEN");
    const aiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!dfToken || !aiKey) {
      return new Response(JSON.stringify({ error: "missing tokens" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Build a tight bbox centered on click
    const [clng, clat] = click;
    const half = cropMeters / 2;
    const { dLat, dLng } = metersToDeg(half, clat);
    const minLat = clat - dLat, maxLat = clat + dLat;
    const minLng = clng - dLng, maxLng = clng + dLng;

    const cacheKey = hashKey(JSON.stringify({ click: [clng.toFixed(6), clat.toFixed(6)], cropMeters, hint: hint ?? "" }));
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
    } catch (e) {
      console.warn("cache lookup failed:", String(e));
    }

    // Fetch ortofoto WMS
    const wms = `https://api.dataforsyningen.dk/orto_foraar_DAF?service=WMS&request=GetMap`
      + `&version=1.3.0&layers=orto_foraar&styles=&format=image/jpeg&transparent=FALSE`
      + `&width=${width}&height=${height}&crs=EPSG:4326`
      + `&bbox=${minLat},${minLng},${maxLat},${maxLng}&token=${dfToken}`;

    const imgRes = await fetch(wms, { headers: { "Accept-Encoding": "identity", "Accept": "image/jpeg" } });
    if (!imgRes.ok) {
      const t = await imgRes.text().catch(() => "");
      return new Response(JSON.stringify({ error: "ortofoto fetch failed", status: imgRes.status, detail: t.slice(0, 200) }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const imgBuf = new Uint8Array(await imgRes.arrayBuffer());
    let bin = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < imgBuf.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, Array.from(imgBuf.subarray(i, i + CHUNK)) as any);
    }
    const b64 = btoa(bin);

    // Click is at image center by construction
    const px = Math.round(width / 2);
    const py = Math.round(height / 2);

    const tighter = hint === "tighter";
    const looser = hint === "looser";
    const prompt = `You are an expert aerial-imagery segmentation tool for Danish residential properties.
Image: top-down ortophoto, ${width}x${height} px, centered on a marker pixel (${px}, ${py}) which is on GRASS/LAWN.
Task: outline the SINGLE connected lawn region containing that pixel.
Exclude: buildings, roofs, driveways, gravel, terraces/decks, paved paths, flowerbeds, hedges, individual shrubs, trees with closed canopy, water, sand, bare soil.
${tighter ? "Be CONSERVATIVE — only confidently green grass." : ""}
${looser ? "Be slightly LOOSER — include grass partially shaded by trees." : ""}
Return STRICT JSON only:
{"polygon":[[x,y],...],"confidence":0.0-1.0,"notes":"<short>"}
- 16-80 vertices, ordered along the boundary, no self-intersection.
- Coordinates are integer pixels in [0,${width}] x [0,${height}].
- confidence: how sure you are this is the true lawn boundary.`;

    const aiRes = await fetch(LOVABLE_API, {
      method: "POST",
      headers: { Authorization: `Bearer ${aiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-pro",
        messages: [{
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } },
          ],
        }],
      }),
    });
    if (!aiRes.ok) {
      const t = await aiRes.text();
      const status = aiRes.status === 429 || aiRes.status === 402 ? aiRes.status : 502;
      return new Response(JSON.stringify({ error: "ai failed", status: aiRes.status, detail: t.slice(0, 400) }), {
        status, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const aiJson = await aiRes.json();
    const txt: string = aiJson.choices?.[0]?.message?.content ?? "";
    const m = txt.match(/\{[\s\S]*\}/);
    if (!m) {
      return new Response(JSON.stringify({ error: "no json from ai", raw: txt.slice(0, 400) }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    let parsed: { polygon: [number, number][]; confidence?: number; notes?: string };
    try { parsed = JSON.parse(m[0]); } catch {
      return new Response(JSON.stringify({ error: "ai json parse failed", raw: m[0].slice(0, 400) }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!Array.isArray(parsed.polygon) || parsed.polygon.length < 4) {
      return new Response(JSON.stringify({ error: "ai returned too few points", raw: txt.slice(0, 200) }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // pixel -> lng/lat
    const lnglat: [number, number][] = parsed.polygon.map(([x, y]) => [
      minLng + (x / width) * (maxLng - minLng),
      maxLat - (y / height) * (maxLat - minLat),
    ]);

    const confidence = typeof parsed.confidence === "number" ? Math.max(0, Math.min(1, parsed.confidence)) : 0.7;

    // Cache
    try {
      await fetch(`${supaUrl}/rest/v1/lawn_segmentation_cache`, {
        method: "POST",
        headers: {
          apikey: supaKey, Authorization: `Bearer ${supaKey}`,
          "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates",
        },
        body: JSON.stringify({ bbox_hash: cacheKey, polygon: lnglat, source: "gemini" }),
      });
    } catch (e) { console.warn("cache write failed:", String(e)); }

    return new Response(JSON.stringify({
      polygon: lnglat,
      cached: false,
      confidence,
      notes: parsed.notes,
      bbox: [minLng, minLat, maxLng, maxLat],
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
