import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-garden-scan-worker-secret, x-worker-secret",
};

type LngLat = [number, number];
type Ring = LngLat[];
type LocalPoint = { x: number; z: number };
type JsonRecord = Record<string, unknown>;

type ScanAnchor = {
  id?: string;
  mapLngLat?: LngLat | null;
  imagePoint?: { x: number; y: number } | null;
  arLocal?: { x: number; y: number; z: number } | null;
  confidence?: number | null;
  evidenceFrameIds?: string[];
};

type ScanManifest = {
  version?: number;
  session_id?: string;
  garden_id?: string;
  device?: JsonRecord;
  capture?: JsonRecord;
  anchors?: ScanAnchor[];
  route?: {
    steps?: JsonRecord[];
    pose_hints?: JsonRecord[];
  };
  files?: {
    tracking?: string | null;
    keyframes?: string | null;
    preview?: string | null;
    video?: string | null;
  };
};

const MIN_KEYFRAMES = 8;
const MIN_ANCHORS = 2;
const MIN_ANCHOR_SPREAD_M = 3;
const METERS_PER_DEG = 111_320;
const PIPELINE_VERSION = "garden-twin-v1";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function recordOrEmpty(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
}

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isLngLat(value: unknown): value is LngLat {
  return Array.isArray(value)
    && value.length >= 2
    && typeof value[0] === "number"
    && typeof value[1] === "number"
    && Number.isFinite(value[0])
    && Number.isFinite(value[1]);
}

function isImagePoint(value: unknown) {
  const point = recordOrEmpty(value);
  const x = finiteNumber(point.x);
  const y = finiteNumber(point.y);
  return x !== null && y !== null && x >= 0 && x <= 1 && y >= 0 && y <= 1;
}

function isArLocal(value: unknown) {
  const point = recordOrEmpty(value);
  return finiteNumber(point.x) !== null && finiteNumber(point.y) !== null && finiteNumber(point.z) !== null;
}

function isLocalPoint(value: unknown): value is LocalPoint {
  const point = recordOrEmpty(value);
  return finiteNumber(point.x) !== null && finiteNumber(point.z) !== null;
}

function isAlignableAnchor(anchor: unknown): anchor is ScanAnchor {
  const row = recordOrEmpty(anchor);
  return isLngLat(row.mapLngLat) && (isImagePoint(row.imagePoint) || isArLocal(row.arLocal));
}

function distanceMeters(a: LngLat, b: LngLat) {
  const midLat = ((a[1] + b[1]) / 2) * Math.PI / 180;
  const dx = (b[0] - a[0]) * METERS_PER_DEG * Math.cos(midLat);
  const dy = (b[1] - a[1]) * METERS_PER_DEG;
  return Math.hypot(dx, dy);
}

function anchorSpreadMeters(anchors: unknown) {
  if (!Array.isArray(anchors)) return 0;
  const alignable = anchors.filter(isAlignableAnchor);
  let best = 0;
  for (let i = 0; i < alignable.length; i += 1) {
    for (let j = i + 1; j < alignable.length; j += 1) {
      best = Math.max(best, distanceMeters(alignable[i].mapLngLat!, alignable[j].mapLngLat!));
    }
  }
  return Number(best.toFixed(2));
}

function routePoseHintsFromManifest(manifest: ScanManifest) {
  const route = recordOrEmpty((manifest as unknown as JsonRecord).route);
  const directHints = Array.isArray(route.pose_hints) ? route.pose_hints : [];
  const routeSteps = Array.isArray(route.steps) ? route.steps : [];
  const rows = directHints.length ? directHints : routeSteps;
  return rows
    .map((value, index) => {
      const row = recordOrEmpty(value);
      if (!isLngLat(row.mapLngLat) || !isLocalPoint(row.local)) return null;
      return {
        id: typeof row.id === "string" ? row.id : `route-pose-${index + 1}`,
        label: typeof row.label === "string" ? row.label : null,
        mapLngLat: row.mapLngLat,
        local: row.local,
        confidence: finiteNumber(row.confidence) ?? finiteNumber(row.poseConfidence) ?? 0.46,
        evidenceFrameId: typeof row.evidenceFrameId === "string" ? row.evidenceFrameId : null,
        motionScore: finiteNumber(row.motionScore),
        deviceQualityScore: finiteNumber(row.deviceQualityScore),
      };
    })
    .filter((hint): hint is {
      id: string;
      label: string | null;
      mapLngLat: LngLat;
      local: LocalPoint;
      confidence: number;
      evidenceFrameId: string | null;
      motionScore: number | null;
      deviceQualityScore: number | null;
    } => Boolean(hint));
}

function routePoseSpreadMeters(manifest: ScanManifest) {
  const poses = routePoseHintsFromManifest(manifest);
  let best = 0;
  for (let i = 0; i < poses.length; i += 1) {
    for (let j = i + 1; j < poses.length; j += 1) {
      best = Math.max(best, distanceMeters(poses[i].mapLngLat, poses[j].mapLngLat));
    }
  }
  return Number(best.toFixed(2));
}

function parseMaybeJson(value: unknown) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function sameLngLat(a: LngLat, b: LngLat) {
  return Math.abs(a[0] - b[0]) < 1e-10 && Math.abs(a[1] - b[1]) < 1e-10;
}

function normalizeRing(coords: unknown): Ring | null {
  if (!Array.isArray(coords)) return null;
  const ring = coords.filter(isLngLat).map((point) => [point[0], point[1]] as LngLat);
  if (ring.length >= 2 && sameLngLat(ring[0], ring[ring.length - 1])) ring.pop();
  return ring.length >= 3 ? ring : null;
}

function ringsFromGeoJson(value: unknown): Ring[] {
  const data = parseMaybeJson(value);
  const obj = recordOrEmpty(data);
  if (obj.type === "Polygon" && Array.isArray(obj.coordinates)) {
    const ring = normalizeRing(obj.coordinates[0]);
    return ring ? [ring] : [];
  }
  if (obj.type === "MultiPolygon" && Array.isArray(obj.coordinates)) {
    return obj.coordinates
      .map((polygon) => Array.isArray(polygon) ? normalizeRing(polygon[0]) : null)
      .filter((ring): ring is Ring => Boolean(ring));
  }
  if (Array.isArray(data)) {
    const direct = normalizeRing(data);
    if (direct) return [direct];
    const polygonRing = normalizeRing(data[0]);
    return polygonRing ? [polygonRing] : [];
  }
  return [];
}

function exclusionRings(value: unknown): Ring[] {
  const data = parseMaybeJson(value);
  if (!Array.isArray(data)) return ringsFromGeoJson(data);
  return data.flatMap((item) => {
    const rings = ringsFromGeoJson(item);
    if (rings.length) return rings;
    const ring = normalizeRing(item);
    return ring ? [ring] : [];
  });
}

function centerFromRings(rings: Ring[]): LngLat {
  const points = rings.flat().filter(isLngLat);
  if (!points.length) return [0, 0];
  const lngs = points.map(([lng]) => lng);
  const lats = points.map(([, lat]) => lat);
  return [
    (Math.min(...lngs) + Math.max(...lngs)) / 2,
    (Math.min(...lats) + Math.max(...lats)) / 2,
  ];
}

function lngLatToLocal(point: LngLat, center: LngLat): LocalPoint {
  const midLat = (point[1] + center[1]) / 2;
  return {
    x: (point[0] - center[0]) * METERS_PER_DEG * Math.cos((midLat * Math.PI) / 180),
    z: (point[1] - center[1]) * METERS_PER_DEG,
  };
}

function ringAreaM2(ring: Ring) {
  const center = centerFromRings([ring]);
  const local = ring.map((point) => lngLatToLocal(point, center));
  let area = 0;
  for (let i = 0, j = local.length - 1; i < local.length; j = i++) {
    area += local[j].x * local[i].z - local[i].x * local[j].z;
  }
  return Math.abs(area / 2);
}

function localBounds(points: LocalPoint[]) {
  const xs = points.map((point) => point.x);
  const zs = points.map((point) => point.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  return {
    width: Math.max(0, maxX - minX),
    depth: Math.max(0, maxZ - minZ),
  };
}

function dimensionsForRing(ring: Ring, center: LngLat) {
  const bounds = localBounds(ring.map((point) => lngLatToLocal(point, center)));
  return {
    width: Number(bounds.width.toFixed(1)),
    depth: Number(bounds.depth.toFixed(1)),
  };
}

function numberFromRecord(value: unknown, key: string) {
  const row = recordOrEmpty(value);
  return finiteNumber(row[key]);
}

function completedRouteStepsFromManifest(manifest: ScanManifest) {
  const capture = recordOrEmpty(manifest.capture);
  const direct = numberFromRecord(capture, "completed_route_steps");
  if (direct !== null) return direct;
  const route = recordOrEmpty((manifest as unknown as JsonRecord).route);
  const steps = Array.isArray(route.steps) ? route.steps : [];
  return steps.length;
}

function normalizeWarnings(value: unknown) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(String).map((warning) => warning.trim()).filter(Boolean))].slice(0, 24);
}

function estimateResidualM(input: {
  keyframes: number;
  coverageScore: number;
  deviceQualityScore: number;
  usableKeyframes: number;
  anchorSpreadM: number;
  anchorCount: number;
  routePoseCount: number;
  routePoseSpreadM: number;
  motionScore: number;
  parallaxScore: number;
}) {
  const manualResidual = input.anchorSpreadM >= 8 ? 0.42 : input.anchorSpreadM >= 3 ? 0.95 : 2.8;
  const routeResidual = input.routePoseCount >= MIN_KEYFRAMES / 2 && input.routePoseSpreadM >= MIN_ANCHOR_SPREAD_M
    ? (input.routePoseSpreadM >= 8 ? 1.15 : 1.65)
    : 3.2;
  let residual = Math.min(manualResidual, routeResidual);
  if (input.keyframes < 18) residual += 0.25;
  if (input.coverageScore < 0.72) residual += 0.45;
  if (input.deviceQualityScore < 0.45) residual += 0.55;
  if (input.usableKeyframes < MIN_KEYFRAMES) residual += 0.35;
  if (input.anchorCount < 2 && input.routePoseCount < MIN_KEYFRAMES / 2) residual += 0.55;
  if (input.anchorCount < 2 && input.motionScore > 0 && input.motionScore < 0.3) residual += 0.35;
  if (input.anchorCount < 2 && input.parallaxScore > 0 && input.parallaxScore < 0.25) residual += 0.25;
  if (input.anchorCount < 3 && input.routePoseCount < MIN_KEYFRAMES / 2) residual += 0.2;
  return Number(residual.toFixed(2));
}

function qualityForScan(input: {
  keyframes: number;
  usableKeyframes: number;
  routeSteps: number;
  anchorCount: number;
  anchorSpreadM: number;
  routePoseCount: number;
  routePoseSpreadM: number;
  motionScore: number;
  parallaxScore: number;
  residualM: number;
  coverageScore: number;
  deviceQualityScore: number;
  objectCount: number;
}) {
  let score = 48;
  const reasons = ["Mobilscan er forankret til Havemaler-geometrien."];
  score += Math.min(18, input.keyframes);
  score += Math.min(8, input.usableKeyframes);
  score += Math.min(8, input.routeSteps * 2);
  score += Math.min(12, input.anchorCount * 4);
  score += Math.min(8, input.routePoseCount * 2);
  if (input.anchorSpreadM >= 8) {
    score += 7;
    reasons.push("Ankre er godt spredt.");
  } else if (input.routePoseSpreadM >= 8) {
    score += 4;
    reasons.push("Guidede route-poser giver grov kortplacering uden GPU.");
  }
  if (input.residualM <= 0.8) {
    score += 7;
    reasons.push("Alignment residual er lav.");
  } else if (input.residualM > 1.6) {
    score -= 10;
    reasons.push("Alignment residual kraever review.");
  }
  if (input.coverageScore >= 0.82) score += 5;
  if (input.motionScore >= 0.6 && input.parallaxScore >= 0.45) {
    score += 5;
    reasons.push("Telefonens motion/parallax understoetter route-alignment.");
  } else if (input.anchorCount < 2 && input.motionScore > 0 && input.motionScore < 0.3) {
    score -= 6;
    reasons.push("Telefonens motion/parallax er svag for route-alignment.");
  }
  if (input.deviceQualityScore >= 0.72) {
    score += 6;
    reasons.push("Telefonens keyframes er skarpe og godt belyst.");
  } else if (input.deviceQualityScore < 0.45) {
    score -= 12;
    reasons.push("Telefonens keyframes er svage og kraever mere usikkerhed.");
  }
  if (input.objectCount > 0) reasons.push("Brugerdefinerede udeladelser er bevaret som objekter.");
  const bounded = Math.max(0, Math.min(100, Math.round(score)));
  return {
    score: bounded,
    grade: bounded >= 76 ? "strong" : bounded >= 52 ? "usable" : "draft",
    reasons,
    nextBestAction: bounded >= 76 ? "ready" : "review_objects",
  };
}

async function downloadJson(sb: ReturnType<typeof createClient>, path: string) {
  const { data, error } = await sb.storage.from("garden-scans").download(path);
  if (error || !data) throw new Error(`Could not download ${path}: ${error?.message ?? "missing object"}`);
  return JSON.parse(await data.text()) as unknown;
}

async function completeSession(status: string, body: JsonRecord) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const workerSecret = Deno.env.get("GARDEN_SCAN_WORKER_SECRET")!;
  const response = await fetch(`${supabaseUrl}/functions/v1/complete-garden-scan-session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "x-garden-scan-worker-secret": workerSecret,
    },
    body: JSON.stringify({ ...body, status, actor: "worker" }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof payload.error === "string" ? payload.error : `complete ${status} failed`);
  return payload;
}

function buildDepthModel(input: {
  session: JsonRecord;
  garden: JsonRecord;
  manifest: ScanManifest;
  tracking: JsonRecord;
  warnings: string[];
}) {
  const lawnRings = ringsFromGeoJson(input.garden.polygon);
  if (!lawnRings.length) throw new Error("garden_missing_lawn_geometry");
  const exclusions = exclusionRings(input.garden.exclusions);
  const previousDepthModel = recordOrEmpty(parseMaybeJson(input.garden.depth_model));
  const previousTerrain = recordOrEmpty(previousDepthModel.terrain);
  const previousBoundary = normalizeRing(previousTerrain.boundary);
  const center = finiteNumber(input.garden.longitude) !== null && finiteNumber(input.garden.latitude) !== null
    ? [input.garden.longitude as number, input.garden.latitude as number] as LngLat
    : centerFromRings(lawnRings);
  const boundary = previousBoundary ?? lawnRings[0];
  const anchors = Array.isArray(input.manifest.anchors) ? input.manifest.anchors : [];
  const alignableAnchorCount = anchors.filter(isAlignableAnchor).length;
  const anchorSpreadM = anchorSpreadMeters(anchors);
  const capture = recordOrEmpty(input.manifest.capture);
  const trackingQuality = recordOrEmpty(input.tracking.capture_quality);
  const manifestQuality = recordOrEmpty(capture.quality_summary);
  const trackingQualitySummary = recordOrEmpty(trackingQuality.quality_summary);
  const keyframeCount = numberFromRecord(capture, "keyframe_count") ?? numberFromRecord(trackingQuality, "keyframe_count") ?? 0;
  const routeStepCount = completedRouteStepsFromManifest(input.manifest);
  const coverageScore = numberFromRecord(capture, "coverage_score") ?? numberFromRecord(trackingQuality, "coverage_score") ?? 0.62;
  const routePoseHints = routePoseHintsFromManifest(input.manifest);
  const routePoseCount = numberFromRecord(capture, "route_pose_count")
    ?? numberFromRecord(trackingQuality, "route_pose_count")
    ?? routePoseHints.length;
  const routePoseSpreadM = numberFromRecord(capture, "route_pose_spread_m")
    ?? numberFromRecord(trackingQuality, "route_pose_spread_m")
    ?? routePoseSpreadMeters(input.manifest);
  const motionSummary = recordOrEmpty(capture.motion_summary);
  const trackingMotionSummary = recordOrEmpty(trackingQuality.motion_summary);
  const motionScore = numberFromRecord(capture, "motion_score")
    ?? numberFromRecord(trackingQuality, "motion_score")
    ?? numberFromRecord(motionSummary, "motionScore")
    ?? numberFromRecord(trackingMotionSummary, "motionScore")
    ?? 0;
  const parallaxScore = numberFromRecord(capture, "parallax_score")
    ?? numberFromRecord(trackingQuality, "parallax_score")
    ?? numberFromRecord(motionSummary, "parallaxScore")
    ?? numberFromRecord(trackingMotionSummary, "parallaxScore")
    ?? 0;
  const usableKeyframeCount = numberFromRecord(capture, "usable_keyframe_count")
    ?? numberFromRecord(trackingQuality, "usable_keyframe_count")
    ?? numberFromRecord(manifestQuality, "usableFrameCount")
    ?? numberFromRecord(trackingQualitySummary, "usableFrameCount")
    ?? keyframeCount;
  const deviceQualityScore = numberFromRecord(capture, "device_quality_score")
    ?? numberFromRecord(trackingQuality, "device_quality_score")
    ?? numberFromRecord(manifestQuality, "qualityScore")
    ?? numberFromRecord(trackingQualitySummary, "qualityScore")
    ?? 0.5;
  const lowLightFrameCount = numberFromRecord(capture, "low_light_frame_count")
    ?? numberFromRecord(trackingQuality, "low_light_frame_count")
    ?? numberFromRecord(manifestQuality, "lowLightFrameCount")
    ?? 0;
  const blurryFrameCount = numberFromRecord(capture, "blurry_frame_count")
    ?? numberFromRecord(trackingQuality, "blurry_frame_count")
    ?? numberFromRecord(manifestQuality, "blurryFrameCount")
    ?? 0;
  const residualM = estimateResidualM({
    keyframes: keyframeCount,
    coverageScore,
    deviceQualityScore,
    usableKeyframes: usableKeyframeCount,
    anchorSpreadM,
    anchorCount: alignableAnchorCount,
    routePoseCount,
    routePoseSpreadM,
    motionScore,
    parallaxScore,
  });
  const objects = exclusions.slice(0, 16).map((ring, index) => ({
    id: `manual-exclusion-${index + 1}`,
    type: "patio",
    label: "Udeladt omraade",
    footprint: ring,
    localFootprint: ring.map((point) => lngLatToLocal(point, center)),
    areaM2: Math.round(ringAreaM2(ring)),
    dimensionsM: dimensionsForRing(ring, center),
    heightRangeM: [0, 0.25],
    confidence: 0.7,
    source: "manual",
    notes: "Bevaret fra Havemaler-udeladelse. Ikke hallucineret af worker.",
  }));
  const unknownRegions = coverageScore < 0.7
    || deviceQualityScore < 0.45
    || (alignableAnchorCount < MIN_ANCHORS && motionScore > 0 && motionScore < 0.3)
    || input.warnings.includes("limited_tracking")
    ? lawnRings.slice(0, 1)
    : [];
  const quality = qualityForScan({
    keyframes: keyframeCount,
    usableKeyframes: usableKeyframeCount,
    routeSteps: routeStepCount,
    anchorCount: alignableAnchorCount,
    anchorSpreadM,
    routePoseCount,
    routePoseSpreadM,
    motionScore,
    parallaxScore,
    residualM,
    coverageScore,
    deviceQualityScore,
    objectCount: objects.length,
  });
  const modelLicense = Deno.env.get("GARDEN_SCAN_MODEL_LICENSE") || "commercial-approved";
  const modelProvider = Deno.env.get("GARDEN_SCAN_MODEL_PROVIDER") || "havekongen";
  const allWarnings = [...new Set([
    ...input.warnings,
    "truthful_reconstruction_worker_v1",
    "unknown_regions_not_hallucinated",
    ...(unknownRegions.length ? ["partial_coverage_unknown_regions"] : []),
    ...(deviceQualityScore < 0.45 ? ["weak_device_quality"] : []),
    ...(alignableAnchorCount < MIN_ANCHORS && routePoseCount >= MIN_KEYFRAMES / 2 ? ["route_pose_alignment_estimate"] : []),
    ...(routePoseCount < MIN_KEYFRAMES / 2 ? ["few_route_pose_hints"] : []),
    ...(motionScore > 0 && motionScore < 0.3 ? ["weak_phone_motion"] : []),
    ...(parallaxScore > 0 && parallaxScore < 0.25 ? ["weak_motion_parallax"] : []),
    ...(usableKeyframeCount < MIN_KEYFRAMES ? ["few_usable_keyframes"] : []),
    ...(lowLightFrameCount > 0 ? ["low_light_capture"] : []),
    ...(blurryFrameCount / Math.max(1, keyframeCount) >= 0.35 ? ["many_blurry_frames"] : []),
    ...(modelLicense === "commercial-approved" ? [] : ["model_license_not_configured"]),
  ])];

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    gardenId: input.garden.id ?? input.session.garden_id ?? null,
    name: input.garden.name ?? "Garden twin",
    center,
    units: "meters",
    alignment: {
      mode: "scan-anchored",
      anchorCount: alignableAnchorCount,
      routePoseCount,
      routePoseSpreadM,
      residualM,
      confidence: Number(Math.max(0.45, Math.min(0.94, coverageScore - residualM * 0.08 + alignableAnchorCount * 0.04)).toFixed(2)),
      notes: alignableAnchorCount >= MIN_ANCHORS
        ? "Browser scan aligned to Havemaler geometry with manual anchors. Unseen regions stay marked unknown."
        : "Browser scan aligned with guided route poses. This is a truthful low-confidence no-GPU alignment, not precise photogrammetry.",
    },
    quality,
    twin: {
      scope: "full",
      role: { visual: true, operational: true },
      status: quality.grade === "strong" ? "scan_aligned" : "needs_review",
      confidencePolicy: "truthful-confidence",
      updatedBy: "ai_reconstruction_worker",
      model: {
        name: "havemaaler-truthful-reconstruction-worker",
        version: Deno.env.get("GARDEN_SCAN_MODEL_VERSION") || PIPELINE_VERSION,
        provider: modelProvider,
        license: modelLicense,
        commercialUseApproved: modelLicense === "commercial-approved",
      },
      evidence: {
        ortofoto: true,
        cadastralBoundary: Boolean(previousBoundary),
        manualGeometry: true,
        mobileScan: true,
        keyframeCount,
        usableKeyframeCount,
        routeStepCount,
        alignableAnchorCount,
        anchorSpreadM,
        routePoseCount,
        routePoseSpreadM,
        coverageScore,
        deviceQualityScore,
        motionScore,
        parallaxScore,
        residualM,
        warnings: allWarnings,
      },
    },
    captureReadiness: {
      minimumAnchors: 2,
      recommendedAnchors: 4,
      recommendedSeconds: [45, 90],
      anchorSuggestions: boundary.slice(0, 4).map((point, index) => ({
        id: `anchor-${index + 1}`,
        label: index === 0 ? "Start-hjorne" : `Kortanker ${index + 1}`,
        kind: "boundary_corner",
        lngLat: point,
        local: lngLatToLocal(point, center),
        priority: index + 1,
      })),
    },
    terrain: {
      boundary,
      localBoundary: boundary.map((point) => lngLatToLocal(point, center)),
      lawnRings,
      localLawnRings: lawnRings.map((ring) => ring.map((point) => lngLatToLocal(point, center))),
      areaM2: finiteNumber(input.garden.area_m2) ?? Math.round(lawnRings.reduce((sum, ring) => sum + ringAreaM2(ring), 0)),
      slopeHint: "unknown",
      elevationConfidence: Number(Math.max(0.28, Math.min(0.86, coverageScore * 0.62 + deviceQualityScore * 0.28 - residualM * 0.05)).toFixed(2)),
      unknownRegions,
    },
    objects,
    warnings: allWarnings,
    privacy: {
      rawMediaRetentionDays: 14,
      derivedGeometryStored: true,
      rawMediaUserDeletable: true,
    },
    scan: {
      sessionId: input.session.id ?? null,
      deviceModel: input.manifest.device && typeof input.manifest.device === "object"
        ? String((input.manifest.device as JsonRecord).model ?? "mobile web")
        : "mobile web",
      captureSeconds: numberFromRecord(capture, "duration_seconds"),
      supportsLidar: false,
    },
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const workerSecret = Deno.env.get("GARDEN_SCAN_WORKER_SECRET");
  const providedSecret = req.headers.get("x-garden-scan-worker-secret") ?? req.headers.get("x-worker-secret");
  if (!workerSecret || providedSecret !== workerSecret) return json({ error: "worker_unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json({ error: "service_env_missing" }, 500);

  const body = await req.json().catch(() => ({}));
  const sessionId = typeof body.session_id === "string" ? body.session_id : null;
  const claimedBy = typeof body.claimed_by === "string" ? body.claimed_by : "garden-scan-worker";
  const sb = createClient(supabaseUrl, serviceKey);
  let claimedSessionId: string | null = null;

  try {
    const claim = sessionId
      ? await sb.rpc("claim_garden_scan_session", { p_session_id: sessionId, p_claimed_by: claimedBy })
      : await sb.rpc("claim_next_garden_scan_session", { p_claimed_by: claimedBy });
    if (claim.error) return json({ error: claim.error.message }, 500);
    const session = Array.isArray(claim.data) ? claim.data[0] as JsonRecord | undefined : null;
    if (!session) return json({ claimed: false, error: "no_uploaded_session" }, sessionId ? 409 : 200);
    claimedSessionId = typeof session.id === "string" ? session.id : null;

    await sb.from("garden_scan_events").insert({
      session_id: session.id,
      garden_id: session.garden_id,
      user_id: session.user_id,
      event_type: "worker_claimed",
      payload: { claimed_by: claimedBy, pipeline_version: PIPELINE_VERSION },
    });

    const manifestPath = typeof session.manifest_path === "string" ? session.manifest_path : null;
    if (!manifestPath) throw new Error("manifest_path_missing");
    const manifest = await downloadJson(sb, manifestPath) as ScanManifest;
    if (manifest.session_id !== session.id || manifest.garden_id !== session.garden_id) throw new Error("manifest_session_mismatch");
    if (manifest.version !== 1) throw new Error("manifest_version_invalid");
    if (!manifest.files?.tracking || !manifest.files?.keyframes) throw new Error("required_artifacts_missing");

    const [tracking, keyframesResult, gardenResult] = await Promise.all([
      downloadJson(sb, manifest.files.tracking),
      downloadJson(sb, manifest.files.keyframes),
      sb.from("gardens").select("id,name,latitude,longitude,area_m2,polygon,exclusions,depth_model").eq("id", session.garden_id).maybeSingle(),
    ]);
    if (gardenResult.error || !gardenResult.data) throw new Error(gardenResult.error?.message ?? "garden_not_found");

    const keyframes = recordOrEmpty(keyframesResult);
    const frameRows = Array.isArray(keyframes.frames) ? keyframes.frames : [];
    const capture = recordOrEmpty(manifest.capture);
    const keyframeCount = numberFromRecord(capture, "keyframe_count") ?? frameRows.length;
    const routeStepCount = completedRouteStepsFromManifest(manifest);
    const usableKeyframeCount = numberFromRecord(capture, "usable_keyframe_count") ?? keyframeCount;
    const deviceQualityScore = numberFromRecord(capture, "device_quality_score") ?? 0.5;
    const routePoseHints = routePoseHintsFromManifest(manifest);
    const routePoseCount = numberFromRecord(capture, "route_pose_count") ?? routePoseHints.length;
    const routePoseSpreadM = numberFromRecord(capture, "route_pose_spread_m") ?? routePoseSpreadMeters(manifest);
    const motionSummary = recordOrEmpty(capture.motion_summary);
    const motionScore = numberFromRecord(capture, "motion_score") ?? numberFromRecord(motionSummary, "motionScore") ?? 0;
    const parallaxScore = numberFromRecord(capture, "parallax_score") ?? numberFromRecord(motionSummary, "parallaxScore") ?? 0;
    const warnings = normalizeWarnings(session.warnings);
    if (keyframeCount < MIN_KEYFRAMES) throw new Error("too_few_keyframes");
    if (usableKeyframeCount < 5 || deviceQualityScore < 0.25) {
      const completion = await completeSession("needs_anchor_correction", {
        session_id: session.id,
        reason: "weak_device_capture_quality",
        warnings: [...warnings, "weak_device_quality"],
        error_code: "weak_device_capture_quality",
        error_detail: `Need at least 5 usable phone keyframes and basic image quality. Got ${usableKeyframeCount} usable frames and quality score ${deviceQualityScore}.`,
        capture_metadata: {
          keyframe_count: keyframeCount,
          usable_keyframe_count: usableKeyframeCount,
          device_quality_score: deviceQualityScore,
          route_pose_count: routePoseCount,
          route_pose_spread_m: routePoseSpreadM,
          motion_score: motionScore,
          parallax_score: parallaxScore,
          completed_route_steps: routeStepCount,
        },
      });
      return json({ claimed: true, session_id: session.id, status: "needs_anchor_correction", completion });
    }

    const anchors = Array.isArray(manifest.anchors) ? manifest.anchors : [];
    const alignableAnchorCount = anchors.filter(isAlignableAnchor).length;
    const anchorSpreadM = anchorSpreadMeters(anchors);
    const manualAlignmentReady = alignableAnchorCount >= MIN_ANCHORS && anchorSpreadM >= MIN_ANCHOR_SPREAD_M;
    const routePoseAlignmentReady = routePoseCount >= MIN_KEYFRAMES / 2
      && routePoseSpreadM >= MIN_ANCHOR_SPREAD_M
      && deviceQualityScore >= 0.35
      && (motionScore === 0 || motionScore >= 0.25 || parallaxScore >= 0.22);
    if (!manualAlignmentReady && !routePoseAlignmentReady) {
      const completion = await completeSession("needs_anchor_correction", {
        session_id: session.id,
        reason: "weak_alignment_evidence",
        warnings: [...warnings, "needs_anchor_correction"],
        error_code: "weak_alignment_evidence",
        error_detail: `Need ${MIN_ANCHORS} map/camera anchors or ${MIN_KEYFRAMES / 2} guided route poses spread by at least ${MIN_ANCHOR_SPREAD_M}m. Got ${alignableAnchorCount} anchors (${anchorSpreadM}m) and ${routePoseCount} route poses (${routePoseSpreadM}m).`,
        anchors,
        route_pose_hints: routePoseHints,
        capture_metadata: {
          keyframe_count: keyframeCount,
          usable_keyframe_count: usableKeyframeCount,
          device_quality_score: deviceQualityScore,
          completed_route_steps: routeStepCount,
          aligned_anchor_count: alignableAnchorCount,
          anchor_spread_m: anchorSpreadM,
          route_pose_count: routePoseCount,
          route_pose_spread_m: routePoseSpreadM,
          motion_score: motionScore,
          parallax_score: parallaxScore,
        },
      });
      return json({ claimed: true, session_id: session.id, status: "needs_anchor_correction", completion });
    }

    const resultJson = buildDepthModel({
      session,
      garden: gardenResult.data as JsonRecord,
      manifest,
      tracking: recordOrEmpty(tracking),
      warnings,
    });
    const residualM = recordOrEmpty(resultJson.alignment).residualM;
    if (typeof residualM === "number" && residualM > 2.4) {
      const completion = await completeSession("needs_anchor_correction", {
        session_id: session.id,
        reason: "alignment_residual_too_high",
        warnings: [...warnings, "alignment_residual_too_high"],
        error_code: "alignment_residual_too_high",
        error_detail: `Alignment residual ${residualM}m is too high for a truthful garden twin.`,
        anchors,
        capture_metadata: {
          keyframe_count: keyframeCount,
          usable_keyframe_count: usableKeyframeCount,
          device_quality_score: deviceQualityScore,
          completed_route_steps: routeStepCount,
          aligned_anchor_count: alignableAnchorCount,
          anchor_spread_m: anchorSpreadM,
          route_pose_count: routePoseCount,
          route_pose_spread_m: routePoseSpreadM,
          motion_score: motionScore,
          parallax_score: parallaxScore,
          residual_m: residualM,
        },
      });
      return json({ claimed: true, session_id: session.id, status: "needs_anchor_correction", completion });
    }

    const completion = await completeSession("ready", {
      session_id: session.id,
      reason: "truthful_reconstruction_worker_ready",
      result_json: resultJson,
      confidence: recordOrEmpty(resultJson.alignment).confidence,
      warnings: resultJson.warnings,
      anchors,
      capture_metadata: {
        keyframe_count: keyframeCount,
        usable_keyframe_count: usableKeyframeCount,
        device_quality_score: deviceQualityScore,
        completed_route_steps: routeStepCount,
        aligned_anchor_count: alignableAnchorCount,
        anchor_spread_m: anchorSpreadM,
        route_pose_count: routePoseCount,
        route_pose_spread_m: routePoseSpreadM,
        motion_score: motionScore,
        parallax_score: parallaxScore,
        residual_m: residualM,
        worker_model: recordOrEmpty(recordOrEmpty(resultJson.twin).model),
      },
    });
    return json({ claimed: true, session_id: session.id, status: "ready", completion });
  } catch (error) {
    const message = error instanceof Error ? error.message : "worker_unknown_error";
    const failedSessionId = claimedSessionId ?? sessionId;
    if (failedSessionId) {
      try {
        await completeSession("failed", {
          session_id: failedSessionId,
          reason: "worker_failed",
          error_code: message,
          error_detail: message,
          warnings: ["worker_failed"],
        });
      } catch {
        // If completion fails, return the original worker error.
      }
    }
    return json({ error: message }, 500);
  }
});
