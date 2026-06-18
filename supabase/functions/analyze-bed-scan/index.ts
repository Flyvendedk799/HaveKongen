const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM = `Du er en dansk havecoach. Brugeren scanner et helt bed eller en havezone.
Vurder helheden: tæthed, ukrudt, tørke/våd jord, sygdomspres, skadedyr, næringsmangel, mulch og næste handling.
Svar KUN som JSON:
{
  "summary": "kort dansk konklusion",
  "severity": "low|medium|high",
  "confidence": 0..1,
  "moisture": "dry|ok|wet|unknown",
  "density": "sparse|ok|crowded|unknown",
  "weed_pressure": "low|medium|high|unknown",
  "disease_pressure": "low|medium|high|unknown",
  "symptoms": ["..."],
  "causes": ["..."],
  "next_action": "konkret næste handling",
  "task_suggestions": [{"title":"...", "kind":"water|weed|thin|diagnose|fertilize|mulch|harvest", "priority":"normal|high|urgent"}]
}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { imageDataUrl, note, context } = await req.json();
    if (!imageDataUrl || typeof imageDataUrl !== "string") {
      return json({ error: "imageDataUrl required" }, 400);
    }

    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return json(fallbackBedScan(note), 200);

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
                  "Vurder hele bedet på billedet.",
                  note ? `Brugerens note: ${note}` : "",
                  context ? `Havekontekst: ${JSON.stringify(context)}` : "",
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
      return json(fallbackBedScan(note), 200);
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content ?? "{}";
    let parsed: unknown;
    try { parsed = JSON.parse(content); } catch { parsed = fallbackBedScan(note); }
    return json(parsed, 200);
  } catch (e) {
    console.error("analyze-bed-scan", e);
    return json({ error: e instanceof Error ? e.message : "Ukendt fejl" }, 500);
  }
});

function fallbackBedScan(note?: string) {
  return {
    summary: "Bedscan gemt. AI kunne ikke lave en fuld vurdering lige nu.",
    severity: "low",
    confidence: 0.25,
    moisture: "unknown",
    density: "unknown",
    weed_pressure: "unknown",
    disease_pressure: "unknown",
    symptoms: [],
    causes: [],
    next_action: note || "Gem billedet og scan igen senere for sammenligning.",
    task_suggestions: [],
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
