// segment-lawn v3: high-resolution, reasoning-grounded lawn segmentation.
// Improvements vs v2:
//  - Pro model first (Gemini 2.5 Pro), flash as fallback
//  - 1024px crop, 70m default window (~7 cm/px) for sharper boundaries
//  - Strict prompt with chain-of-thought + structured JSON (polygon, confidence, exclusions, notes)
//  - Validates: contains click pixel, plausible area, monotonic vertices
//  - Auto-refines: if click not inside or confidence < 0.55, runs a 2nd pass with the
//    failed polygon shown back to the model for correction
//  - Optional `excludePolygons` returned: model can flag flowerbeds/decks inside lawn
//  - Smooths out near-duplicate vertices server-side

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
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
  }
  return Math.abs(a) / 2;
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

async function callModel(model: string, prompt: string, b64: string, aiKey: string): Promise<string | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(LOVABLE_API, {
        method: "POST",
        headers: { Authorization: `Bearer ${aiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${b64}` } },
            ],
          }],
        }),
      });
      if (r.ok) {
        const j = await r.json();
        return j.choices?.[0]?.message?.content ?? "";
      }
      if (r.status === 429 || r.status === 402) return null;
      await new Promise((res) => setTimeout(res, 400 * (attempt + 1)));
    } catch {
      await new Promise((res) => setTimeout(res, 400 * (attempt + 1)));
    }
  }
  return null;
}

function buildPrompt(width: number, height: number, px: number, py: number, opts: { hint?: string; previousFailure?: string } = {}) {
  const refineNote = opts.previousFailure
    ? `\nPREVIOUS ATTEMPT FAILED: ${opts.previousFailure}\nProduce a CORRECTED polygon that addresses the issue.`
    : "";
  const hintNote = opts.hint === "tighter"
    ? "\nBe CONSERVATIVE — only confidently green grass cover."
    : opts.hint === "looser"
      ? "\nBe slightly LOOSER — include grass partially shaded by trees."
      : "";

  return `You are a precise aerial-imagery segmentation engine for Danish residential lawns.

INPUT: A top-down ortophoto, ${width}x${height} pixels. The marker pixel (${px}, ${py}) is GUARANTEED to be on grass.

GOAL: Trace the OUTER BOUNDARY of the SINGLE connected lawn region that contains the marker pixel.

INCLUDE: continuous grass, mowed strips, areas with patchy/yellowing grass that are still maintained turf.
EXCLUDE: buildings, roofs, driveways, parking, gravel/grus, terraces, wooden decks, paved paths, flowerbeds (bede), hedges, individual shrubs, trees with closed canopy, ponds/water, sand pits, bare soil, neighbouring lawns separated by hedge/fence/path.${hintNote}${refineNote}

REASONING: First, mentally identify the boundary by following the lawn's edge clockwise. Stay within 1-2 px of the visible transition. For curved edges use more vertices; for straight edges use fewer.

OUTPUT — STRICT JSON only, no markdown, no commentary:
{
  "polygon": [[x,y], ...],
  "exclusions": [[[x,y], ...], ...],
  "confidence": 0.0-1.0,
  "notes": "<short reason for confidence value>"
}

REQUIREMENTS:
- polygon: 20-100 integer-pixel vertices, ordered clockwise along the boundary, MUST contain pixel (${px}, ${py}), no self-intersection, vertices in [0,${width}] x [0,${height}].
- exclusions: 0-3 inner rings for non-lawn islands inside the main polygon (flowerbeds, ponds). Each 6-30 vertices. Empty array if none obvious.
- confidence: honest estimate. 0.9+ = boundary unambiguous; 0.6-0.8 = some shaded/occluded edges; <0.6 = significant uncertainty.

Return ONLY the JSON object.`;
}

function parseJson(txt: string): any | null {
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const {
      click,
      cropMeters = 70,
      width = 1024,
      height = 1024,
      hint,
    } = body as {
      click: [number, number]; cropMeters?: number; width?: number; height?: number; hint?: string;
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

    const [clng, clat] = click;
    const half = cropMeters / 2;
    const { dLat, dLng } = metersToDeg(half, clat);
    const minLat = clat - dLat, maxLat = clat + dLat;
    const minLng = clng - dLng, maxLng = clng + dLng;

    const cacheKey = hashKey(JSON.stringify({ click: [clng.toFixed(6), clat.toFixed(6)], cropMeters, hint: hint ?? "", v: 3 }));
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

    const px = Math.round(width / 2);
    const py = Math.round(height / 2);

    const models = ["google/gemini-2.5-pro", "google/gemini-2.5-flash"];

    let best: { polygon: [number, number][]; exclusions: [number, number][][]; confidence: number; notes?: string } | null = null;
    let lastError = "";

    for (const model of models) {
      // Pass 1
      const txt1 = await callModel(model, buildPrompt(width, height, px, py, { hint }), b64, aiKey);
      if (!txt1) { lastError = `${model}: no response`; continue; }
      let parsed = parseJson(txt1);
      if (!parsed?.polygon || !Array.isArray(parsed.polygon) || parsed.polygon.length < 6) {
        lastError = `${model}: invalid polygon shape`;
        continue;
      }

      let poly = dedupeVertices(parsed.polygon.map((p: any) => [Math.round(p[0]), Math.round(p[1])] as [number, number]));
      const area = polyAreaPx(poly);
      const minArea = (width * height) * 0.005; // > 0.5% of crop
      const maxArea = (width * height) * 0.95;
      const containsClick = pointInPoly(px, py, poly);

      let failureReason = "";
      if (!containsClick) failureReason = `polygon does not contain marker pixel (${px}, ${py})`;
      else if (area < minArea) failureReason = `polygon too small (${Math.round(area)} px², expected > ${Math.round(minArea)})`;
      else if (area > maxArea) failureReason = `polygon covers nearly the whole crop — likely the wrong region`;

      // Refinement pass on failure or low confidence
      const conf = typeof parsed.confidence === "number" ? parsed.confidence : 0.7;
      if (failureReason || conf < 0.55) {
        const reason = failureReason || `low confidence (${conf.toFixed(2)})`;
        const txt2 = await callModel(model, buildPrompt(width, height, px, py, { hint, previousFailure: reason }), b64, aiKey);
        if (txt2) {
          const p2 = parseJson(txt2);
          if (p2?.polygon && Array.isArray(p2.polygon) && p2.polygon.length >= 6) {
            const poly2 = dedupeVertices(p2.polygon.map((p: any) => [Math.round(p[0]), Math.round(p[1])] as [number, number]));
            const area2 = polyAreaPx(poly2);
            if (pointInPoly(px, py, poly2) && area2 >= minArea && area2 <= maxArea) {
              parsed = p2;
              poly = poly2;
              failureReason = "";
            }
          }
        }
      }

      if (failureReason) { lastError = `${model}: ${failureReason}`; continue; }

      const exclusions: [number, number][][] = Array.isArray(parsed.exclusions)
        ? parsed.exclusions
            .filter((r: any) => Array.isArray(r) && r.length >= 4)
            .map((r: any[]) => dedupeVertices(r.map((p: any) => [Math.round(p[0]), Math.round(p[1])] as [number, number])))
            .filter((r: [number, number][]) => r.length >= 4)
        : [];

      best = {
        polygon: poly,
        exclusions,
        confidence: Math.max(0, Math.min(1, typeof parsed.confidence === "number" ? parsed.confidence : 0.7)),
        notes: parsed.notes,
      };
      break;
    }

    if (!best) {
      return new Response(JSON.stringify({ error: "ai failed", detail: lastError, fallback: true }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
          body: JSON.stringify({ bbox_hash: cacheKey, polygon: lnglat, source: "gemini-v3" }),
        });
      } catch (e) { console.warn("cache write failed:", String(e)); }
    }

    return new Response(JSON.stringify({
      polygon: lnglat,
      exclusions: exclusionsLL,
      cached: false,
      confidence: best.confidence,
      notes: best.notes,
      bbox: [minLng, minLat, maxLng, maxLat],
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
