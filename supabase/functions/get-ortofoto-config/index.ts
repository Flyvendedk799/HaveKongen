const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Tells the frontend whether ortofoto imagery is usable, and where the tile proxy
 * lives.
 *
 * The browser must not talk to the Dataforsyningen WMS directly: it is noisy,
 * flaky under tile bursts, and the service token would be visible in DevTools.
 * Everything goes through `ortofoto-tile` instead.
 *
 * `wmsTemplate` is derived from the *request*, not from `SUPABASE_URL`. On a
 * self-hosted stack SUPABASE_URL is the cluster-internal Kong address
 * (`http://kong:8000`), which no browser can resolve. Clients should prefer
 * `tilePath` and join it to the Supabase URL they were configured with.
 */
function publicOrigin(req: Request): string | null {
  const origin = req.headers.get("origin");
  if (origin && /^https?:\/\//.test(origin)) return origin.replace(/\/+$/, "");

  const forwardedHost = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (forwardedHost && !forwardedHost.startsWith("kong")) {
    // The tunnel terminates TLS and forwards plain HTTP to Kong, so
    // x-forwarded-proto says "http" for a request the browser made over HTTPS.
    // Only a loopback host is genuinely not TLS.
    const local = /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(forwardedHost);
    return `${local ? "http" : "https"}://${forwardedHost}`;
  }
  return null;
}

const TILE_PATH = "/functions/v1/ortofoto-tile?width=512&height=512&bbox={bbox-epsg-3857}";

Deno.serve((req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const origin = publicOrigin(req);

  return new Response(
    JSON.stringify({
      available: Boolean(Deno.env.get("DATAFORSYNINGEN_TOKEN")),
      tilePath: TILE_PATH,
      wmsTemplate: origin ? `${origin}${TILE_PATH}` : null,
      attribution: "© SDFI / Dataforsyningen",
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
