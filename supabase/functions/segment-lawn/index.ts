// segment-lawn: takes a bbox (in lng/lat) + zoom, fetches the corresponding ortofoto
// composite from Dataforsyningen, sends it to Gemini 2.5 Pro vision with a prompt that
// asks for a single GeoJSON polygon outlining the connected lawn touching a click point,
// and returns simplified polygon coordinates in lng/lat.
//
// Caches by bbox+click hash in public.lawn_segmentation_cache.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const LOVABLE_API = "https://ai.gateway.lovable.dev/v1/chat/completions";

function hashKey(s: string): string {
  // simple djb2
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) ^ s.charCodeAt(i);
  return (h >>> 0).toString(36);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const rawBody = await req.text();
    console.log("segment-lawn req body length:", rawBody.length);
    let body: any;
    try { body = JSON.parse(rawBody || "{}"); }
    catch (e) {
      return new Response(JSON.stringify({ error: "invalid json body", raw: rawBody.slice(0,200) }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { bbox, click, width = 768, height = 768 } = body as {
      bbox: [number, number, number, number]; // [minLng, minLat, maxLng, maxLat]
      click: [number, number];                // [lng, lat]
      width?: number;
      height?: number;
    };
    if (!bbox || bbox.length !== 4 || !click || click.length !== 2) {
      return new Response(JSON.stringify({ error: "bbox and click required" }), {
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

    const cacheKey = hashKey(JSON.stringify({ bbox, click, width, height }));

    // Check cache via Supabase REST (anon)
    const supaUrl = Deno.env.get("SUPABASE_URL")!;
    const supaKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    try {
      const cacheRes = await fetch(
        `${supaUrl}/rest/v1/lawn_segmentation_cache?bbox_hash=eq.${cacheKey}&select=polygon`,
        { headers: { apikey: supaKey, Authorization: `Bearer ${supaKey}` } },
      );
      const cacheTxt = await cacheRes.text();
      const cached = cacheTxt ? JSON.parse(cacheTxt) : [];
      if (Array.isArray(cached) && cached[0]?.polygon) {
        return new Response(JSON.stringify({ polygon: cached[0].polygon, cached: true }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    } catch (e) {
      console.warn("cache lookup failed:", String(e));
    }

    // Fetch ortofoto via WMS in EPSG:4326 (BBOX order = minLat,minLng,maxLat,maxLng for v1.3)
    const [minLng, minLat, maxLng, maxLat] = bbox;
    const wms = `https://api.dataforsyningen.dk/orto_foraar_DAF?service=WMS&request=GetMap`
      + `&version=1.3.0&layers=orto_foraar&styles=&format=image/jpeg&transparent=FALSE`
      + `&width=${width}&height=${height}&crs=EPSG:4326`
      + `&bbox=${minLat},${minLng},${maxLat},${maxLng}&token=${dfToken}`;

    console.log("fetching wms...");
    const imgRes = await fetch(wms, { headers: { "Accept-Encoding": "identity", "Accept": "image/jpeg" } });
    console.log("wms status:", imgRes.status, "ct:", imgRes.headers.get("content-type"), "cl:", imgRes.headers.get("content-length"), "ce:", imgRes.headers.get("content-encoding"));
    if (!imgRes.ok) {
      const t = await imgRes.text().catch(() => "");
      return new Response(JSON.stringify({ error: "ortofoto fetch failed", status: imgRes.status, detail: t.slice(0,200) }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    let imgBuf: Uint8Array;
    try {
      imgBuf = new Uint8Array(await imgRes.arrayBuffer());
    } catch (e) {
      console.error("arrayBuffer failed:", String(e));
      return new Response(JSON.stringify({ error: "ortofoto read failed", detail: String(e) }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    console.log("ortofoto bytes:", imgBuf.length);
    let bin = "";
    const CHUNK = 0x8000;
    for (let i = 0; i < imgBuf.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, Array.from(imgBuf.subarray(i, i + CHUNK)) as any);
    }
    const b64 = btoa(bin);
    console.log("b64 length:", b64.length);

    // Click as pixel coords
    const px = Math.round(((click[0] - minLng) / (maxLng - minLng)) * width);
    const py = Math.round(((maxLat - click[1]) / (maxLat - minLat)) * height);

    const prompt = `You are a precise aerial-imagery segmentation tool.
The image is a top-down orthophoto of a Danish residential property, ${width}x${height} pixels.
The user clicked on pixel (${px}, ${py}) which is on grass/lawn.
Identify the single connected LAWN region containing that pixel. Exclude buildings, driveways, terraces, gravel, flowerbeds, hedges, paths, trees and shrubs.
Return ONLY valid JSON of the form:
{"polygon":[[x1,y1],[x2,y2],...]}
where each [x,y] is a pixel coordinate (integers, 0-${width}). Provide 12-60 vertices, ordered along the boundary, no holes, no extra text.`;

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
      return new Response(JSON.stringify({ error: "ai failed", detail: t.slice(0, 400) }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
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
    let parsed: { polygon: [number, number][] };
    try { parsed = JSON.parse(m[0]); } catch {
      return new Response(JSON.stringify({ error: "ai json parse failed", raw: m[0].slice(0, 400) }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // pixel -> lng/lat
    const lnglat: [number, number][] = parsed.polygon.map(([x, y]) => [
      minLng + (x / width) * (maxLng - minLng),
      maxLat - (y / height) * (maxLat - minLat),
    ]);

    // Cache
    await fetch(`${supaUrl}/rest/v1/lawn_segmentation_cache`, {
      method: "POST",
      headers: {
        apikey: supaKey, Authorization: `Bearer ${supaKey}`,
        "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates",
      },
      body: JSON.stringify({ bbox_hash: cacheKey, polygon: lnglat, source: "gemini" }),
    });

    return new Response(JSON.stringify({ polygon: lnglat, cached: false }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
