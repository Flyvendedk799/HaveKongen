import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

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

const UPLOAD_TARGETS = [
  { kind: "manifest", fileName: "manifest.json", contentType: "application/json", required: true },
  { kind: "tracking", fileName: "tracking.json", contentType: "application/json", required: true },
  { kind: "keyframes", fileName: "keyframes.json", contentType: "application/json", required: true },
  { kind: "preview", fileName: "preview.jpg", contentType: "image/jpeg", required: false },
  { kind: "video", fileName: "capture.webm", contentType: "video/webm", required: false },
] as const;
const PIPELINE_VERSION = "garden-twin-v1";

function objectOrEmpty(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

async function signedUploadTargets(prefix: string) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const baseTargets = UPLOAD_TARGETS.map((target) => ({
    kind: target.kind,
    path: `${prefix}/${target.fileName}`,
    contentType: target.contentType,
    required: target.required,
    signedUrl: null as string | null,
    token: null as string | null,
  }));

  if (!supabaseUrl || !serviceKey) return baseTargets;

  const admin = createClient(supabaseUrl, serviceKey);
  return await Promise.all(baseTargets.map(async (target) => {
    const { data, error } = await admin.storage
      .from("garden-scans")
      .createSignedUploadUrl(target.path, { upsert: true });
    if (error || !data) return target;
    return {
      ...target,
      signedUrl: data.signedUrl ?? null,
      token: data.token ?? null,
    };
  }));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Unauthorized" }, 401);

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const body = await req.json().catch(() => ({}));
    const gardenId = typeof body.garden_id === "string" ? body.garden_id : "";
    if (!gardenId) return json({ error: "garden_id required" }, 400);

    const { data: garden, error: gardenError } = await sb
      .from("gardens")
      .select("id,name,polygon,exclusions,area_m2,latitude,longitude")
      .eq("id", gardenId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (gardenError) return json({ error: gardenError.message }, 500);
    if (!garden) return json({ error: "garden_not_found" }, 404);

    const captureMetadata = {
      requested_from: typeof body.source === "string" ? body.source : "havemaaler",
      requested_at: new Date().toISOString(),
      pipeline_version: PIPELINE_VERSION,
      minimum_anchor_count: 2,
      recommended_anchor_count: 4,
      capture_goal_seconds: 60,
      expected_payload: {
        camera_transforms: true,
        keyframes: true,
        tracking_quality: true,
        feature_points: true,
        browser_motion_optional: true,
        lidar_depth_optional: false,
      },
      garden_snapshot: {
        area_m2: garden.area_m2,
        latitude: garden.latitude,
        longitude: garden.longitude,
        has_polygon: Boolean(garden.polygon),
        has_exclusions: Array.isArray(garden.exclusions) ? garden.exclusions.length > 0 : Boolean(garden.exclusions),
      },
      ...objectOrEmpty(body.capture_metadata),
    };

    const pendingUploadPrefix = `${user.id}/pending-${crypto.randomUUID()}`;
    const now = new Date().toISOString();
    const { data: session, error } = await sb
      .from("garden_scan_sessions")
      .insert({
        user_id: user.id,
        garden_id: gardenId,
        status: "created",
        device_model: typeof body.device_model === "string" ? body.device_model : null,
        device_capabilities: objectOrEmpty(body.device_capabilities),
        capture_client_version: typeof body.capture_client_version === "string" ? body.capture_client_version : null,
        pipeline_version: PIPELINE_VERSION,
        upload_prefix: pendingUploadPrefix,
        manifest_path: null,
        capture_metadata: captureMetadata,
        anchors: Array.isArray(body.anchors) ? body.anchors : [],
        last_status_at: now,
        status_history: [{
          status: "created",
          at: now,
          actor: "web",
          reason: "session_created",
        }],
        warnings: [],
      })
      .select()
      .single();

    if (error || !session) return json({ error: error?.message ?? "session_create_failed" }, 500);

    const scanUrl = `/havemaaler/scan?garden_id=${encodeURIComponent(gardenId)}&session_id=${encodeURIComponent(session.id)}`;
    const uploadPrefix = `${user.id}/${session.id}`;
    const uploadTargets = await signedUploadTargets(uploadPrefix);
    const manifestPath = `${uploadPrefix}/manifest.json`;
    const { error: prefixError } = await sb
      .from("garden_scan_sessions")
      .update({ upload_prefix: uploadPrefix, manifest_path: manifestPath })
      .eq("id", session.id)
      .eq("user_id", user.id);
    if (prefixError) return json({ error: prefixError.message }, 500);

    await sb.from("garden_scan_events").insert({
      session_id: session.id,
      garden_id: gardenId,
      user_id: user.id,
      event_type: "session_created",
      payload: {
        pipeline_version: PIPELINE_VERSION,
        upload_prefix: uploadPrefix,
        upload_target_count: uploadTargets.length,
      },
    });

    return json({
      session: { ...session, upload_prefix: uploadPrefix, manifest_path: manifestPath },
      scan_url: scanUrl,
      mobile_web_url: scanUrl,
      upload_prefix: uploadPrefix,
      upload_bucket: "garden-scans",
      upload_targets: uploadTargets,
      manifest_schema: {
        version: 1,
        required: ["session_id", "garden_id", "device", "anchors", "capture", "tracking", "keyframes"],
        coordinate_spaces: ["browser_camera", "device_motion", "garden_lnglat"],
      },
      pipeline_contract: {
        version: PIPELINE_VERSION,
        statuses: ["created", "capturing", "uploaded", "processing", "ready", "needs_anchor_correction", "failed", "cancelled"],
        quality_gates: {
          minimum_anchors: 2,
          recommended_anchors: 4,
          recommended_capture_seconds: [45, 90],
          ready_requires_valid_depth_model: true,
          hidden_regions_must_be_unknown_not_guessed: true,
        },
      },
      anchor_guidance: [
        "house_corner",
        "terrace_corner",
        "shed_corner",
        "gate_or_fence_corner",
      ],
    });
  } catch (e) {
    console.error("create-garden-scan-session", e);
    return json({ error: e instanceof Error ? e.message : "unknown_error" }, 500);
  }
});
