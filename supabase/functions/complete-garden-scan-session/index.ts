import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-garden-scan-worker-secret, x-worker-secret",
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
const USER_ALLOWED_STATUS = new Set(["capturing", "uploaded"]);
const WORKER_ALLOWED_STATUS = new Set(["processing", "ready", "needs_anchor_correction", "failed"]);
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
const MIN_SCAN_KEYFRAMES = 8;
const MIN_ALIGNED_ANCHORS = 2;
const MIN_ANCHOR_SPREAD_M = 3;
const MIN_ROUTE_STEPS = 4;
const MIN_ROUTE_POSE_HINTS = 4;

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
  const twin = row.twin as Record<string, unknown> | undefined;
  return row.version === 1
    && row.units === "meters"
    && Array.isArray(row.center)
    && Boolean(terrain)
    && Array.isArray(terrain?.lawnRings)
    && Array.isArray(row.objects)
    && Boolean(alignment)
    && typeof alignment?.confidence === "number"
    && Boolean(quality)
    && typeof quality?.score === "number"
    && Boolean(twin)
    && twin?.scope === "full";
}

function depthModelIssues(value: unknown) {
  const issues: string[] = [];
  if (!isDepthModelCandidate(value)) return ["invalid_model_shape"];
  const row = value as Record<string, unknown>;
  const alignment = row.alignment as Record<string, unknown>;
  const quality = row.quality as Record<string, unknown>;
  const terrain = row.terrain as Record<string, unknown>;
  const objects = row.objects as Array<Record<string, unknown>>;
  const twin = row.twin as Record<string, unknown>;
  const twinRole = twin.role as Record<string, unknown> | undefined;
  const twinModel = twin.model as Record<string, unknown> | undefined;
  const twinEvidence = twin.evidence as Record<string, unknown> | undefined;
  if ((alignment.confidence as number) < 0 || (alignment.confidence as number) > 1) issues.push("alignment_confidence_out_of_range");
  if ((quality.score as number) < 0 || (quality.score as number) > 100) issues.push("quality_score_out_of_range");
  if (!Array.isArray(terrain.boundary) || terrain.boundary.length < 3) issues.push("missing_boundary");
  if (!twinRole || twinRole.visual !== true || twinRole.operational !== true) issues.push("invalid_twin_scope");
  if (twin.confidencePolicy !== "truthful-confidence") issues.push("invalid_confidence_policy");
  if (!twinModel || typeof twinModel.name !== "string" || typeof twinModel.version !== "string") issues.push("missing_twin_model_metadata");
  if (twinModel && twinModel.commercialUseApproved !== true) issues.push("model_license_not_production_approved");
  if (!twinEvidence || typeof twinEvidence.keyframeCount !== "number") issues.push("missing_twin_evidence");
  if (!objects.every((object) => Array.isArray(object.footprint) && object.footprint.length >= 3)) issues.push("object_with_invalid_footprint");
  if (!objects.every((object) => typeof object.confidence === "number" && object.confidence >= 0 && object.confidence <= 1)) issues.push("object_confidence_out_of_range");
  if (alignment.mode === "scan-anchored") {
    const anchorCount = typeof alignment.anchorCount === "number" ? alignment.anchorCount : 0;
    const routePoseCount = typeof alignment.routePoseCount === "number" ? alignment.routePoseCount : 0;
    if (anchorCount < MIN_ALIGNED_ANCHORS && routePoseCount < MIN_ROUTE_POSE_HINTS) issues.push("scan_alignment_requires_anchors_or_route_poses");
  }
  return issues;
}

function canTransition(from: string, to: string) {
  if (from === to) return true;
  return (TRANSITIONS[from] ?? []).includes(to);
}

function objectOrEmpty(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function normalizeWarnings(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(
    value
      .map(String)
      .map((warning) => warning.trim())
      .filter(Boolean),
  )].slice(0, 24);
}

function isLngLat(value: unknown) {
  return Array.isArray(value)
    && value.length >= 2
    && typeof value[0] === "number"
    && typeof value[1] === "number"
    && Number.isFinite(value[0])
    && Number.isFinite(value[1]);
}

function isImagePoint(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const point = value as Record<string, unknown>;
  return typeof point.x === "number"
    && typeof point.y === "number"
    && point.x >= 0
    && point.x <= 1
    && point.y >= 0
    && point.y <= 1;
}

function isArLocal(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const point = value as Record<string, unknown>;
  return typeof point.x === "number" && typeof point.y === "number" && typeof point.z === "number";
}

function countAlignableAnchors(value: unknown) {
  if (!Array.isArray(value)) return 0;
  return value.filter((anchor) => {
    if (!anchor || typeof anchor !== "object" || Array.isArray(anchor)) return false;
    const row = anchor as Record<string, unknown>;
    return isLngLat(row.mapLngLat) && (isImagePoint(row.imagePoint) || isArLocal(row.arLocal));
  }).length;
}

function distanceMeters(a: [number, number], b: [number, number]) {
  const midLat = ((a[1] + b[1]) / 2) * Math.PI / 180;
  const dx = (b[0] - a[0]) * 111_320 * Math.cos(midLat);
  const dy = (b[1] - a[1]) * 111_320;
  return Math.hypot(dx, dy);
}

function anchorSpreadMeters(value: unknown) {
  if (!Array.isArray(value)) return 0;
  const anchors = value.filter((anchor) => {
    if (!anchor || typeof anchor !== "object" || Array.isArray(anchor)) return false;
    const row = anchor as Record<string, unknown>;
    return isLngLat(row.mapLngLat) && (isImagePoint(row.imagePoint) || isArLocal(row.arLocal));
  }) as Array<Record<string, unknown>>;
  let best = 0;
  for (let i = 0; i < anchors.length; i += 1) {
    for (let j = i + 1; j < anchors.length; j += 1) {
      best = Math.max(best, distanceMeters(anchors[i].mapLngLat as [number, number], anchors[j].mapLngLat as [number, number]));
    }
  }
  return best;
}

function numberFromRecord(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const next = (value as Record<string, unknown>)[key];
  return typeof next === "number" && Number.isFinite(next) ? next : null;
}

function routeReadyFromMetadata(value: unknown) {
  const metadata = objectOrEmpty(value);
  const routeGuided = metadata.route_guided === true || metadata.capture_mode === "guided_center_route";
  const completedRouteSteps = numberFromRecord(metadata, "completed_route_steps") ?? 0;
  return {
    routeGuided,
    completedRouteSteps,
    ready: routeGuided && completedRouteSteps >= MIN_ROUTE_STEPS,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const body = await req.json().catch(() => ({}));
    const sessionId = typeof body.session_id === "string" ? body.session_id : "";
    const status = typeof body.status === "string" && ALLOWED_STATUS.has(body.status) ? body.status : "";
    if (!sessionId) return json({ error: "session_id required" }, 400);
    if (!status) return json({ error: "valid status required" }, 400);

    const workerSecret = Deno.env.get("GARDEN_SCAN_WORKER_SECRET");
    const providedWorkerSecret = req.headers.get("x-garden-scan-worker-secret") ?? req.headers.get("x-worker-secret");
    const workerAuthorized = Boolean(workerSecret && providedWorkerSecret && providedWorkerSecret === workerSecret);
    if (workerAuthorized && !WORKER_ALLOWED_STATUS.has(status)) {
      return json({ error: "status_not_allowed_for_worker", status }, 403);
    }
    if (!workerAuthorized && !USER_ALLOWED_STATUS.has(status)) {
      return json({ error: "status_not_allowed_for_user", status }, 403);
    }

    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (workerAuthorized && !serviceKey) return json({ error: "SUPABASE_SERVICE_ROLE_KEY not set" }, 500);
    const auth = req.headers.get("Authorization");
    if (!workerAuthorized && !auth) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const sb = workerAuthorized
      ? createClient(supabaseUrl, serviceKey!)
      : createClient(
        supabaseUrl,
        Deno.env.get("SUPABASE_ANON_KEY")!,
        { global: { headers: { Authorization: auth! } } },
      );

    let userId: string | null = null;
    if (!workerAuthorized) {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return json({ error: "Unauthorized" }, 401);
      userId = user.id;
    }

    let sessionQuery = sb
      .from("garden_scan_sessions")
      .select("id,garden_id,user_id,status,manifest_path,status_history,processing_attempts,capture_metadata,anchors,upload_prefix")
      .eq("id", sessionId);
    if (!workerAuthorized) sessionQuery = sessionQuery.eq("user_id", userId);
    const { data: session, error: sessionError } = await sessionQuery.maybeSingle();

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

    const warnings = normalizeWarnings(body.warnings);
    const serverWarnings = [...warnings];
    const resultJson = body.result_json && typeof body.result_json === "object" ? body.result_json : null;
    const confidence = typeof body.confidence === "number" ? Math.max(0, Math.min(1, body.confidence)) : null;
    const now = new Date().toISOString();
    if (status === "uploaded" && !body.manifest_path && !session.manifest_path) {
      return json({ error: "manifest_path required for uploaded scans" }, 400);
    }
    if (status === "uploaded") {
      const manifestPath = typeof body.manifest_path === "string" ? body.manifest_path : session.manifest_path;
      const expectedPrefix = typeof session.upload_prefix === "string" ? session.upload_prefix : `${session.user_id}/${sessionId}`;
      if (typeof manifestPath !== "string" || !manifestPath.startsWith(`${expectedPrefix}/`)) {
        return json({ error: "manifest_path_outside_session_prefix", expected_prefix: expectedPrefix }, 400);
      }
      const captureMetadata = objectOrEmpty(body.capture_metadata);
      const keyframeCount = numberFromRecord(captureMetadata, "frame_count") ?? numberFromRecord(captureMetadata, "keyframe_count");
      if (keyframeCount === null) {
        return json({ error: "missing_keyframe_count", minimum: 8 }, 400);
      }
      if (keyframeCount < MIN_SCAN_KEYFRAMES) {
        return json({ error: "too_few_keyframes", keyframe_count: keyframeCount, minimum: MIN_SCAN_KEYFRAMES }, 400);
      }
      const routeReadiness = routeReadyFromMetadata(captureMetadata);
      const uploadAnchors = Array.isArray(body.anchors) ? body.anchors : session.anchors;
      const alignableAnchorCount = countAlignableAnchors(uploadAnchors);
      if (alignableAnchorCount < MIN_ALIGNED_ANCHORS && !routeReadiness.ready) {
        return json({
          error: "route_or_anchors_required",
          message: `Uploaded scans require either ${MIN_ROUTE_STEPS} guided route steps or ${MIN_ALIGNED_ANCHORS} manual anchors with both mapLngLat and camera imagePoint or arLocal evidence.`,
          alignable_anchor_count: alignableAnchorCount,
          completed_route_steps: routeReadiness.completedRouteSteps,
          minimum_route_steps: MIN_ROUTE_STEPS,
        }, 400);
      }
      if (alignableAnchorCount < MIN_ALIGNED_ANCHORS) {
        serverWarnings.push("manual_anchors_missing");
      }
      const anchorSpreadM = alignableAnchorCount >= MIN_ALIGNED_ANCHORS ? anchorSpreadMeters(uploadAnchors) : 0;
      if (alignableAnchorCount >= MIN_ALIGNED_ANCHORS && anchorSpreadM < MIN_ANCHOR_SPREAD_M && !routeReadiness.ready) {
        return json({
          error: "weak_anchor_spread",
          message: "Uploaded scans require alignable anchors that are clearly separated on the map.",
          anchor_spread_m: Number(anchorSpreadM.toFixed(2)),
          minimum: MIN_ANCHOR_SPREAD_M,
        }, 400);
      }
      if (alignableAnchorCount >= MIN_ALIGNED_ANCHORS && anchorSpreadM < MIN_ANCHOR_SPREAD_M) {
        serverWarnings.push("weak_anchor_spread");
      }
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
      warnings: normalizeWarnings(serverWarnings),
      last_status_at: now,
      status_history: [
        ...statusHistory.slice(-24),
        {
          status,
          at: now,
          actor: typeof body.actor === "string" ? body.actor : workerAuthorized ? "worker" : "client",
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
    if (body.capture_metadata && typeof body.capture_metadata === "object") {
      updatePayload.capture_metadata = {
        ...objectOrEmpty(session.capture_metadata),
        ...objectOrEmpty(body.capture_metadata),
      };
    }
    if (resultJson) updatePayload.result_json = resultJson;
    if (confidence !== null) updatePayload.confidence = confidence;

    let updateQuery = sb
      .from("garden_scan_sessions")
      .update(updatePayload)
      .eq("id", sessionId);
    if (!workerAuthorized) updateQuery = updateQuery.eq("user_id", userId);
    const { data: updated, error: updateError } = await updateQuery.select().single();

    if (updateError || !updated) return json({ error: updateError?.message ?? "session_update_failed" }, 500);

    await sb.from("garden_scan_events").insert({
      session_id: sessionId,
      garden_id: session.garden_id,
      user_id: session.user_id,
      event_type: `status_${status}`,
      payload: {
        previous_status: session.status,
        status,
        confidence,
        warnings: normalizeWarnings(serverWarnings),
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
        .eq("user_id", session.user_id);

      if (gardenError) return json({ error: gardenError.message, session: updated }, 500);
    }

    return json({ session: updated });
  } catch (e) {
    console.error("complete-garden-scan-session", e);
    return json({ error: e instanceof Error ? e.message : "unknown_error" }, 500);
  }
});
