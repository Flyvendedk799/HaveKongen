import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ALLOWED_STATUS = new Set([
  "capturing",
  "uploaded",
  "processing",
  "ready",
  "needs_anchor_correction",
  "failed",
  "cancelled",
]);
const TRANSITIONS: Record<string, string[]> = {
  created: ["capturing", "uploaded", "failed", "cancelled"],
  capturing: ["uploaded", "failed", "cancelled"],
  uploaded: ["processing", "needs_anchor_correction", "failed", "cancelled"],
  processing: ["ready", "needs_anchor_correction", "failed"],
  ready: [],
  needs_anchor_correction: ["capturing", "uploaded", "processing", "failed", "cancelled"],
  failed: [],
  cancelled: [],
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isDepthModelCandidate(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  const terrain = row.terrain as Record<string, unknown> | undefined;
  const alignment = row.alignment as Record<string, unknown> | undefined;
  const quality = row.quality as Record<string, unknown> | undefined;
  return row.version === 1
    && row.units === "meters"
    && Array.isArray(row.center)
    && Boolean(terrain)
    && Array.isArray(terrain?.lawnRings)
    && Array.isArray(row.objects)
    && Boolean(alignment)
    && typeof alignment?.confidence === "number"
    && Boolean(quality)
    && typeof quality?.score === "number";
}

function depthModelIssues(value: unknown) {
  const issues: string[] = [];
  if (!isDepthModelCandidate(value)) return ["invalid_model_shape"];
  const row = value as Record<string, unknown>;
  const alignment = row.alignment as Record<string, unknown>;
  const quality = row.quality as Record<string, unknown>;
  const terrain = row.terrain as Record<string, unknown>;
  const objects = row.objects as Array<Record<string, unknown>>;
  if ((alignment.confidence as number) < 0 || (alignment.confidence as number) > 1) issues.push("alignment_confidence_out_of_range");
  if ((quality.score as number) < 0 || (quality.score as number) > 100) issues.push("quality_score_out_of_range");
  if (!Array.isArray(terrain.boundary) || terrain.boundary.length < 3) issues.push("missing_boundary");
  if (!objects.every((object) => Array.isArray(object.footprint) && object.footprint.length >= 3)) issues.push("object_with_invalid_footprint");
  if (!objects.every((object) => typeof object.confidence === "number" && object.confidence >= 0 && object.confidence <= 1)) issues.push("object_confidence_out_of_range");
  if (alignment.mode === "scan-anchored" && typeof alignment.anchorCount === "number" && alignment.anchorCount < 2) issues.push("scan_alignment_requires_anchors");
  return issues;
}

function canTransition(from: string, to: string) {
  if (from === to) return true;
  return (TRANSITIONS[from] ?? []).includes(to);
}

function objectOrEmpty(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
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
    const sessionId = typeof body.session_id === "string" ? body.session_id : "";
    const status = typeof body.status === "string" && ALLOWED_STATUS.has(body.status) ? body.status : "";
    if (!sessionId) return json({ error: "session_id required" }, 400);
    if (!status) return json({ error: "valid status required" }, 400);

    const { data: session, error: sessionError } = await sb
      .from("garden_scan_sessions")
      .select("id,garden_id,user_id,status,manifest_path,status_history,processing_attempts")
      .eq("id", sessionId)
      .eq("user_id", user.id)
      .maybeSingle();

    if (sessionError) return json({ error: sessionError.message }, 500);
    if (!session) return json({ error: "session_not_found" }, 404);
    if (!canTransition(session.status, status)) {
      return json({
        error: "invalid_status_transition",
        from: session.status,
        to: status,
        allowed: TRANSITIONS[session.status] ?? [],
      }, 409);
    }

    const warnings = Array.isArray(body.warnings) ? body.warnings.map(String).slice(0, 24) : [];
    const resultJson = body.result_json && typeof body.result_json === "object" ? body.result_json : null;
    const confidence = typeof body.confidence === "number" ? Math.max(0, Math.min(1, body.confidence)) : null;
    const now = new Date().toISOString();
    if (status === "uploaded" && !body.manifest_path && !session.manifest_path) {
      return json({ error: "manifest_path required for uploaded scans" }, 400);
    }
    if (status === "ready") {
      const issues = depthModelIssues(resultJson);
      if (issues.length) {
        return json({ error: "valid result_json required for ready scans", issues }, 400);
      }
    }

    const statusHistory = Array.isArray(session.status_history) ? session.status_history : [];
    const updatePayload: Record<string, unknown> = {
      status,
      warnings,
      last_status_at: now,
      status_history: [
        ...statusHistory.slice(-24),
        {
          status,
          at: now,
          actor: typeof body.actor === "string" ? body.actor : "client",
          reason: typeof body.reason === "string" ? body.reason : null,
        },
      ],
    };
    if (status === "processing") {
      updatePayload.processing_started_at = now;
      updatePayload.processing_attempts = (session.processing_attempts ?? 0) + 1;
      if (typeof body.claimed_by === "string") updatePayload.claimed_by = body.claimed_by.slice(0, 120);
    }
    if (status === "ready" || status === "failed" || status === "needs_anchor_correction") updatePayload.processing_finished_at = now;
    if (typeof body.error_code === "string") updatePayload.error_code = body.error_code;
    if (typeof body.error_detail === "string") updatePayload.error_detail = body.error_detail.slice(0, 2000);
    if (typeof body.manifest_path === "string") updatePayload.manifest_path = body.manifest_path;
    if (Array.isArray(body.anchors)) updatePayload.anchors = body.anchors;
    if (body.capture_metadata && typeof body.capture_metadata === "object") updatePayload.capture_metadata = objectOrEmpty(body.capture_metadata);
    if (resultJson) updatePayload.result_json = resultJson;
    if (confidence !== null) updatePayload.confidence = confidence;

    const { data: updated, error: updateError } = await sb
      .from("garden_scan_sessions")
      .update(updatePayload)
      .eq("id", sessionId)
      .eq("user_id", user.id)
      .select()
      .single();

    if (updateError || !updated) return json({ error: updateError?.message ?? "session_update_failed" }, 500);

    await sb.from("garden_scan_events").insert({
      session_id: sessionId,
      garden_id: session.garden_id,
      user_id: user.id,
      event_type: `status_${status}`,
      payload: {
        previous_status: session.status,
        status,
        confidence,
        warnings,
        error_code: typeof body.error_code === "string" ? body.error_code : null,
      },
    });

    if (status === "ready" && resultJson) {
      const { error: gardenError } = await sb
        .from("gardens")
        .update({
          depth_model: resultJson,
          depth_model_updated_at: new Date().toISOString(),
        })
        .eq("id", session.garden_id)
        .eq("user_id", user.id);

      if (gardenError) return json({ error: gardenError.message, session: updated }, 500);
    }

    return json({ session: updated });
  } catch (e) {
    console.error("complete-garden-scan-session", e);
    return json({ error: e instanceof Error ? e.message : "unknown_error" }, 500);
  }
});
