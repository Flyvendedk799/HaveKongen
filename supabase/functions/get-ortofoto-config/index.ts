const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve((req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const token = Deno.env.get("DATAFORSYNINGEN_TOKEN");
  if (!token) {
    return new Response(JSON.stringify({ error: "DATAFORSYNINGEN_TOKEN not set" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  // WMTS REST template for orto_foraar (spring orthophoto, ~12.5cm).
  // Mapbox raster source uses {z}/{x}/{y}; the service is in Web Mercator (EPSG:3857) tile pyramid "webmercator".
  const wmtsTemplate =
    `https://api.dataforsyningen.dk/orto_foraar_wmts_DAF?service=WMTS&request=GetTile&version=1.0.0` +
    `&layer=orto_foraar_wmts&style=default&format=image/jpeg&tilematrixset=KortforsyningTilingDK` +
    `&tilematrix={z}&tilerow={y}&tilecol={x}&token=${token}`;
  // Simpler/more reliable: use the Web Mercator REST endpoint.
  const restTemplate =
    `https://api.dataforsyningen.dk/orto_foraar_DAF?service=WMS&request=GetMap&version=1.3.0` +
    `&layers=orto_foraar&styles=&format=image/jpeg&transparent=false&width=512&height=512` +
    `&crs=EPSG:3857&bbox={bbox-epsg-3857}&token=${token}`;

  return new Response(
    JSON.stringify({
      token,
      wmtsTemplate,
      wmsTemplate: restTemplate,
      attribution: "© SDFE / Dataforsyningen",
    }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
