// Plant photo diagnosis using Lovable AI Gateway (Gemini vision).
// Returns structured JSON: diagnosis, severity, treatment, product_suggestions.
// Persists to plant_health_log when user is authenticated.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM = `Du er en dansk planteekspert. Brugeren uploader et billede af en plante eller et planteproblem.
Analyser symptomer (gulning, pletter, skadedyr, svamp, mangel, tørke etc.) og svar KUN som ren JSON, ingen markdown.
Schema:
{
  "plant_guess": "fx 'Æbletræ' eller null hvis ukendt",
  "diagnosis": "kort dansk diagnose, max 90 tegn",
  "severity": "low" | "medium" | "high",
  "confidence": 0..1,
  "symptoms": ["gulning af blade", ...],
  "causes": ["fx vandmangel"],
  "treatment": "konkret behandlingsplan i 2-4 sætninger på dansk",
  "prevention": "kort forebyggelse",
  "product_suggestions": [{"name":"fx 'Neemolie'", "category":"insektmiddel|gødning|svampemiddel|jordforbedring|værktøj"}]
}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { imageDataUrl, note } = await req.json();
    if (!imageDataUrl || typeof imageDataUrl !== "string") {
      return new Response(JSON.stringify({ error: "imageDataUrl required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const apiKey = Deno.env.get("LOVABLE_API_KEY");
    if (!apiKey) return new Response(JSON.stringify({ error: "AI key missing" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const aiResp = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: SYSTEM },
          { role: "user", content: [
            { type: "text", text: note ? `Brugerens note: ${note}` : "Diagnosticer denne plante." },
            { type: "image_url", image_url: { url: imageDataUrl } },
          ] },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (aiResp.status === 429) return new Response(JSON.stringify({ error: "Rate limited" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (aiResp.status === 402) return new Response(JSON.stringify({ error: "AI credits exhausted" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!aiResp.ok) {
      const t = await aiResp.text();
      console.error("ai err", aiResp.status, t);
      return new Response(JSON.stringify({ error: "AI error" }), { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const aiJson = await aiResp.json();
    const txt = aiJson.choices?.[0]?.message?.content ?? "{}";
    let parsed: any = {};
    try { parsed = JSON.parse(txt); } catch { parsed = { diagnosis: txt }; }

    // Persist to plant_health_log if authenticated
    const auth = req.headers.get("Authorization");
    if (auth) {
      try {
        const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, {
          global: { headers: { Authorization: auth } },
        });
        const { data: { user } } = await sb.auth.getUser();
        if (user) {
          await sb.from("plant_health_log").insert({
            user_id: user.id,
            diagnosis: parsed.diagnosis ?? null,
            severity: parsed.severity ?? null,
            treatment: parsed.treatment ?? null,
            product_suggestions: parsed.product_suggestions ?? [],
            raw: parsed,
          });
        }
      } catch (e) { console.error("persist err", e); }
    }

    return new Response(JSON.stringify(parsed), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("plant-diagnose", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
