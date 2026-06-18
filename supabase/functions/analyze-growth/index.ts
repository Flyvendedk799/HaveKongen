const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM = `Du er en dansk havecoach med speciale i visuel vækstsporing.
Analyser et nyt plantefoto sammen med eventuel tidligere observationshistorik.
Svar KUN som JSON:
{
  "summary": "kort dansk konklusion",
  "stage": "frøplante|vegetativ|blomstrer|frugtsætter|moden|hvile|ukendt",
  "vigor": "low|medium|high",
  "confidence": 0..1,
  "estimated_height_cm": number|null,
  "flowering": boolean,
  "fruiting": boolean,
  "harvest_readiness": "ikke klar|snart|klar|overmoden|ikke relevant",
  "anomaly_flags": ["slappe blade", "..."],
  "trend": "ny observation|vokser|stabil|tilbagegang|kræver flere fotos",
  "next_action": "konkret næste handling på dansk"
}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { imageDataUrl, note, context } = await req.json();
    if (!imageDataUrl || typeof imageDataUrl !== "string") {
      return json({ error: "imageDataUrl required" }, 400);
    }

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return json(fallbackGrowth(context, note), 200);

    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: [
                  "Analyser vækststatus for dette foto.",
                  note ? `Brugerens note: ${note}` : "",
                  context ? `Kontekst og tidligere observationer: ${JSON.stringify(context)}` : "",
                  "Hvis der er færre end to brugbare observationer, sig tydeligt at trend kræver flere fotos.",
                ].filter(Boolean).join("\n"),
              },
              { type: "image_url", image_url: { url: imageDataUrl } },
            ],
          },
        ],
        response_format: { type: "json_object" },
      }),
    });

    if (!res.ok) {
      if (res.status === 429) return json({ error: "AI er optaget - prøv igen" }, 429);
      if (res.status === 402) return json({ error: "AI-kredit opbrugt" }, 402);
      return json(fallbackGrowth(context, note), 200);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? "{}";
    let parsed: unknown;
    try { parsed = JSON.parse(content); } catch { parsed = fallbackGrowth(context, note); }
    return json(parsed, 200);
  } catch (e) {
    console.error("analyze-growth", e);
    return json({ error: e instanceof Error ? e.message : "Ukendt fejl" }, 500);
  }
});

function fallbackGrowth(context: unknown, note?: string) {
  const ctx = context && typeof context === "object" ? context as { previous?: unknown } : {};
  const previous = Array.isArray(ctx.previous) ? ctx.previous.length : 0;
  return {
    summary: previous > 0 ? "Vækstfoto gemt til sammenligning." : "Første vækstfoto gemt.",
    stage: "ukendt",
    vigor: "medium",
    confidence: 0.32,
    estimated_height_cm: null,
    flowering: false,
    fruiting: false,
    harvest_readiness: "ikke relevant",
    anomaly_flags: [],
    trend: previous > 0 ? "kræver flere fotos" : "ny observation",
    next_action: note || "Tag et nyt foto fra samme vinkel om 5-7 dage for en bedre væksttrend.",
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
