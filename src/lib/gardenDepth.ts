import * as turf from "@turf/turf";
import type { Json } from "@/integrations/supabase/types";

export type LngLat = [number, number];
export type Ring = LngLat[];

export type DepthObjectType =
  | "tree"
  | "hedge"
  | "shed"
  | "fence"
  | "patio"
  | "bed"
  | "steps"
  | "retaining_wall"
  | "water"
  | "furniture"
  | "unknown_obstacle";

export type DepthSource =
  | "satellite"
  | "user_scan"
  | "ai_reconstruction"
  | "elevation_model"
  | "manual"
  | "fallback";

export type GardenElevationSummary = {
  source: "dhm";
  cols: number;
  rows: number;
  // [minLng, minLat, maxLng, maxLat]; grid row 0 = north (maxLat).
  bbox: [number, number, number, number];
  // Absolute terrain heights (m above sea level), rows x cols.
  terrain: number[][];
  stats: { minM: number; maxM: number; meanM: number; reliefM: number };
  resolutionM: number;
  confidence: number;
};

export type LocalPoint = { x: number; z: number };

export type GardenDepthObject = {
  id: string;
  type: DepthObjectType;
  label: string;
  footprint: Ring;
  localFootprint: LocalPoint[];
  areaM2?: number | null;
  dimensionsM?: { width: number; depth: number } | null;
  heightM?: number | null;
  heightRangeM?: [number, number] | null;
  confidence: number;
  source: DepthSource;
  evidenceFrameIds?: string[];
  notes?: string;
};

export type GardenDepthValidationIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
};

export type GardenTwinContract = {
  scope: "full";
  role: {
    visual: boolean;
    operational: boolean;
  };
  status: "draft" | "evidence_ready" | "scan_aligned" | "needs_review";
  confidencePolicy: "truthful-confidence";
  updatedBy: "havemaaler_2d" | "mobile_web_scan" | "ai_reconstruction_worker" | "manual_review";
  model: {
    name: string;
    version: string;
    provider: "havekongen" | "colmap" | "vggt" | "vggt-omega" | "sam2" | "depth-anything-v2" | "hybrid";
    license: "commercial-approved" | "open-source" | "non-commercial-evaluation" | "not-configured";
    commercialUseApproved: boolean;
  };
  evidence: {
    ortofoto: boolean;
    cadastralBoundary: boolean;
    manualGeometry: boolean;
    mobileScan: boolean;
    keyframeCount: number;
    usableKeyframeCount?: number | null;
    routeStepCount: number;
    alignableAnchorCount: number;
    anchorSpreadM?: number | null;
    routePoseCount?: number | null;
    routePoseSpreadM?: number | null;
    coverageScore?: number | null;
    deviceQualityScore?: number | null;
    motionScore?: number | null;
    parallaxScore?: number | null;
    residualM?: number | null;
    warnings: string[];
  };
};

export type GardenDepthModel = {
  version: 1;
  generatedAt: string;
  gardenId?: string | null;
  name?: string | null;
  center: LngLat;
  units: "meters";
  alignment: {
    mode: "satellite-only" | "scan-anchored" | "elevation-model" | "manual";
    anchorCount: number;
    routePoseCount?: number | null;
    routePoseSpreadM?: number | null;
    residualM?: number | null;
    confidence: number;
    notes?: string;
  };
  quality: {
    score: number;
    grade: "draft" | "usable" | "strong";
    reasons: string[];
    nextBestAction: "draw_lawn" | "add_anchors" | "mobile_scan" | "review_objects" | "ready";
  };
  twin: GardenTwinContract;
  captureReadiness: {
    minimumAnchors: number;
    recommendedAnchors: number;
    recommendedSeconds: [number, number];
    anchorSuggestions: Array<{
      id: string;
      label: string;
      kind: "house_corner" | "terrace_corner" | "shed_corner" | "gate_or_fence_corner" | "boundary_corner";
      lngLat: LngLat;
      local: LocalPoint;
      priority: number;
    }>;
  };
  terrain: {
    boundary: Ring;
    localBoundary: LocalPoint[];
    lawnRings: Ring[];
    localLawnRings: LocalPoint[][];
    areaM2?: number | null;
    slopeHint: "flat" | "gentle" | "unknown";
    elevationConfidence: number;
    unknownRegions: Ring[];
    elevation?: GardenElevationSummary | null;
  };
  objects: GardenDepthObject[];
  warnings: string[];
  privacy: {
    rawMediaRetentionDays: number;
    derivedGeometryStored: boolean;
    rawMediaUserDeletable: boolean;
  };
  scan?: {
    sessionId?: string | null;
    deviceModel?: string | null;
    captureSeconds?: number | null;
    supportsLidar?: boolean | null;
  };
};

type GenerateDepthModelInput = {
  gardenId?: string | null;
  name?: string | null;
  center?: LngLat | null;
  lawnRings: Ring[];
  exclusions?: Ring[];
  matrikel?: Ring | null;
  areaM2?: number | null;
  generatedAt?: string;
};

const METERS_PER_DEG = 111_320;

export function isGardenDepthModel(value: unknown): value is GardenDepthModel {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<GardenDepthModel>;
  return row.version === 1
    && row.units === "meters"
    && Array.isArray(row.center)
    && row.center.length >= 2
    && Boolean(row.terrain)
    && Array.isArray(row.objects)
    && Boolean(row.quality)
    && Boolean(row.captureReadiness);
}

export function coerceGardenDepthModel(value: unknown): GardenDepthModel | null {
  if (typeof value === "string") {
    try {
      return coerceGardenDepthModel(JSON.parse(value));
    } catch {
      return null;
    }
  }
  const upgraded = upgradeLegacyDepthModel(value);
  if (upgraded) return upgraded;
  return isGardenDepthModel(value) ? value : null;
}

export function depthModelToJson(model: GardenDepthModel): Json {
  return model as unknown as Json;
}

export function validateGardenDepthModel(value: unknown): string[] {
  return inspectGardenDepthModel(value).issues.map((issue) => issue.code);
}

export function inspectGardenDepthModel(value: unknown): { model: GardenDepthModel | null; issues: GardenDepthValidationIssue[]; readyForSave: boolean } {
  const model = coerceGardenDepthModel(value);
  if (!model) {
    return {
      model: null,
      issues: [{ severity: "error", code: "invalid_model_shape", message: "Depth model skal følge GardenDepthModel v1." }],
      readyForSave: false,
    };
  }

  const issues: GardenDepthValidationIssue[] = [];
  if (!isLngLat(model.center)) issues.push({ severity: "error", code: "invalid_center", message: "Modelcenter skal være gyldig lng/lat." });
  if (model.terrain.boundary.length < 3) issues.push({ severity: "error", code: "missing_boundary", message: "Terrain mangler havegrænse." });
  if (!model.terrain.boundary.every(isLngLat)) issues.push({ severity: "error", code: "invalid_boundary_coordinate", message: "Havegrænsen indeholder ugyldige koordinater." });
  if (!model.terrain.lawnRings.length) issues.push({ severity: "error", code: "missing_lawn_rings", message: "Mindst en græsflade er påkrævet." });
  if (model.terrain.localBoundary.length !== model.terrain.boundary.length) {
    issues.push({ severity: "warning", code: "boundary_local_mismatch", message: "Lokal og geospatial havegrænse matcher ikke punkt-for-punkt." });
  }
  if (model.alignment.confidence < 0 || model.alignment.confidence > 1) {
    issues.push({ severity: "error", code: "alignment_confidence_out_of_range", message: "Alignment confidence skal være mellem 0 og 1." });
  }
  if (model.quality.score < 0 || model.quality.score > 100) {
    issues.push({ severity: "error", code: "quality_score_out_of_range", message: "Quality score skal være mellem 0 og 100." });
  }
  if (model.captureReadiness.minimumAnchors < 2) {
    issues.push({ severity: "warning", code: "weak_minimum_anchor_rule", message: "Pipeline bør kræve mindst 2 ankre." });
  }
  if (model.twin.scope !== "full" || !model.twin.role.visual || !model.twin.role.operational) {
    issues.push({ severity: "error", code: "invalid_twin_scope", message: "Garden twin skal være både visuel og operationel." });
  }
  if (model.twin.confidencePolicy !== "truthful-confidence") {
    issues.push({ severity: "error", code: "invalid_confidence_policy", message: "Garden twin skal bruge truthful-confidence policy." });
  }
  if (!model.twin.model.commercialUseApproved) {
    issues.push({ severity: "warning", code: "model_license_not_production_approved", message: "Rekonstruktionsmodellen mangler produktionsgodkendt licensmetadata." });
  }
  if (model.twin.status === "scan_aligned" && model.alignment.mode !== "scan-anchored") {
    issues.push({ severity: "error", code: "scan_twin_requires_scan_alignment", message: "Scan-aligned twin kræver scan-anchored alignment." });
  }
  if (model.twin.evidence.mobileScan && model.twin.evidence.keyframeCount < 8) {
    issues.push({ severity: "warning", code: "mobile_scan_with_few_keyframes", message: "Mobilscan-evidens har færre end 8 keyframes." });
  }
  if (model.objects.some((object) => object.footprint.length < 3)) {
    issues.push({ severity: "error", code: "object_with_invalid_footprint", message: "Et objekt mangler gyldigt footprint." });
  }
  if (model.objects.some((object) => object.localFootprint.length !== object.footprint.length)) {
    issues.push({ severity: "warning", code: "object_local_footprint_mismatch", message: "Et objekt har forskellig lokal og geospatial geometri." });
  }
  if (model.objects.some((object) => object.confidence < 0 || object.confidence > 1)) {
    issues.push({ severity: "error", code: "object_confidence_out_of_range", message: "Objekt-confidence skal være mellem 0 og 1." });
  }
  if (model.objects.some((object) => object.heightRangeM && object.heightRangeM[0] > object.heightRangeM[1])) {
    issues.push({ severity: "error", code: "invalid_height_range", message: "Et objekt har omvendt højdeinterval." });
  }
  if (model.alignment.mode !== "scan-anchored" && model.alignment.mode !== "elevation-model" && model.quality.grade === "strong") {
    issues.push({ severity: "warning", code: "strong_quality_requires_scan", message: "Strong kvalitet bør kræve scan-anchored eller højdemodel-alignment." });
  }
  if (model.terrain.elevation) {
    const elevation = model.terrain.elevation;
    if (!Array.isArray(elevation.terrain) || elevation.terrain.length !== elevation.rows) {
      issues.push({ severity: "warning", code: "elevation_grid_mismatch", message: "Højdegitterets rækker matcher ikke metadata." });
    }
  }
  if (model.alignment.mode === "scan-anchored" && model.alignment.anchorCount < 2 && (model.alignment.routePoseCount ?? 0) < 4) {
    issues.push({ severity: "error", code: "scan_alignment_requires_anchors_or_route_poses", message: "Scan-alignment kræver mindst 2 ankre eller 4 route-poser." });
  }

  return {
    model,
    issues,
    readyForSave: !issues.some((issue) => issue.severity === "error"),
  };
}

export function summarizeDepthModel(model: GardenDepthModel) {
  const validation = inspectGardenDepthModel(model);
  const highConfidenceObjects = model.objects.filter((object) => object.confidence >= 0.72).length;
  const estimatedObjects = model.objects.length - highConfidenceObjects;
  const maxHeight = model.objects.reduce((best, object) => {
    const height = object.heightM ?? object.heightRangeM?.[1] ?? 0;
    return Math.max(best, height);
  }, 0);
  return {
    objectCount: model.objects.length,
    highConfidenceObjects,
    estimatedObjects,
    maxHeightM: Number(maxHeight.toFixed(1)),
    qualityScore: model.quality.score,
    nextBestAction: model.quality.nextBestAction,
    validationErrorCount: validation.issues.filter((issue) => issue.severity === "error").length,
    validationWarningCount: validation.issues.filter((issue) => issue.severity === "warning").length,
  };
}

export function depthPipelineStage(model: GardenDepthModel | null) {
  if (!model) return "missing_2d_geometry";
  if (model.alignment.mode === "scan-anchored" && model.quality.grade === "strong") return "scan_verified";
  if (model.alignment.mode === "scan-anchored") return "scan_needs_review";
  if (model.alignment.mode === "elevation-model") return "elevation_built";
  if (model.terrain.lawnRings.length > 0) return "satellite_preview";
  return "outline_only";
}

export function depthPipelineStageLabel(stage: ReturnType<typeof depthPipelineStage>) {
  if (stage === "scan_verified") return "Scan-verificeret";
  if (stage === "scan_needs_review") return "Scan kræver tjek";
  if (stage === "elevation_built") return "3D-have bygget";
  if (stage === "satellite_preview") return "Flad kort-preview";
  if (stage === "outline_only") return "Kun havegrænse";
  return "Mangler geometri";
}

export function centerFromRings(rings: Ring[]): LngLat | null {
  const points = rings.flat().filter(isLngLat);
  if (!points.length) return null;
  const lngs = points.map(([lng]) => lng);
  const lats = points.map(([, lat]) => lat);
  return [
    (Math.min(...lngs) + Math.max(...lngs)) / 2,
    (Math.min(...lats) + Math.max(...lats)) / 2,
  ];
}

export function lngLatToLocal(point: LngLat, center: LngLat): LocalPoint {
  const midLat = (point[1] + center[1]) / 2;
  return {
    x: (point[0] - center[0]) * METERS_PER_DEG * Math.cos((midLat * Math.PI) / 180),
    z: (point[1] - center[1]) * METERS_PER_DEG,
  };
}

export function localToLngLat(point: LocalPoint, center: LngLat): LngLat {
  return [
    center[0] + point.x / (METERS_PER_DEG * Math.cos((center[1] * Math.PI) / 180)),
    center[1] + point.z / METERS_PER_DEG,
  ];
}

export function generateGardenDepthModel(input: GenerateDepthModelInput): GardenDepthModel | null {
  const lawnRings = input.lawnRings.filter((ring) => ring.length >= 3);
  if (!lawnRings.length) return null;

  const boundary = input.matrikel && input.matrikel.length >= 3 ? input.matrikel : lawnRings[0];
  const center = input.center ?? centerFromRings([boundary, ...lawnRings]) ?? boundary[0];
  const areaM2 = input.areaM2 ?? safeArea(lawnRings);
  const objects = exclusionObjects(input.exclusions ?? [], center);
  const anchorSuggestions = anchorSuggestionsForBoundary(boundary, center);
  const quality = qualityForModel({
    objectCount: objects.length,
    anchorCount: 0,
    hasMatrikel: Boolean(input.matrikel?.length),
    hasExclusions: Boolean(input.exclusions?.length),
  });
  const warnings = [
    "satellite_only_depth",
    "heights_are_estimated_ranges",
    "mobile_scan_required_for_camera_aligned_depth",
    ...(objects.length ? [] : ["no_depth_objects_detected"]),
  ];

  return {
    version: 1,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    gardenId: input.gardenId ?? null,
    name: input.name ?? null,
    center,
    units: "meters",
    alignment: {
      mode: "satellite-only",
      anchorCount: 0,
      residualM: null,
      confidence: 0.42,
      notes: "Flat lawn preview from Havemåler geometry. Add a mobile web scan before trusting depth, height, or obstacle alignment.",
    },
    quality,
    twin: baseTwinContract({
      status: "draft",
      updatedBy: "havemaaler_2d",
      modelName: "havemaaler-satellite-preview",
      modelVersion: "garden-twin-v1",
      provider: "havekongen",
      license: "commercial-approved",
      commercialUseApproved: true,
      evidence: {
        ortofoto: true,
        cadastralBoundary: Boolean(input.matrikel?.length),
        manualGeometry: true,
        mobileScan: false,
        warnings,
      },
    }),
    captureReadiness: {
      minimumAnchors: 2,
      recommendedAnchors: 4,
      recommendedSeconds: [45, 90],
      anchorSuggestions,
    },
    terrain: {
      boundary,
      localBoundary: boundary.map((point) => lngLatToLocal(point, center)),
      lawnRings,
      localLawnRings: lawnRings.map((ring) => ring.map((point) => lngLatToLocal(point, center))),
      areaM2,
      slopeHint: "unknown",
      elevationConfidence: 0.25,
      unknownRegions: [],
    },
    objects,
    warnings,
    privacy: {
      rawMediaRetentionDays: 14,
      derivedGeometryStored: true,
      rawMediaUserDeletable: true,
    },
  };
}

export type GardenObjectInput = {
  type: DepthObjectType;
  label: string;
  footprint: Ring;
  heightM: number;
  confidence: number;
  source: DepthSource;
  notes?: string;
};

type BuildTwinInput = {
  gardenId?: string | null;
  name?: string | null;
  center?: LngLat | null;
  lawnRings: Ring[];
  exclusions?: Ring[];
  matrikel?: Ring | null;
  areaM2?: number | null;
  elevation?: GardenElevationSummary | null;
  objects: GardenObjectInput[];
  generatedAt?: string;
};

/**
 * Build the full garden twin for Havemåler Part 2: real terrain from the DHM
 * elevation model (when available) plus objects the user placed and height-set
 * in the 3D builder. Output is the same GardenDepthModel contract Part 1 writes,
 * so Havekompagnon/watering/wildlife keep reading it — just richer and aligned
 * with `elevation-model` mode under truthful confidence.
 */
export function buildGardenTwinModel(input: BuildTwinInput): GardenDepthModel | null {
  const lawnRings = input.lawnRings.filter((ring) => ring.length >= 3);
  if (!lawnRings.length) return null;

  const boundary = input.matrikel && input.matrikel.length >= 3 ? input.matrikel : lawnRings[0];
  const center = input.center ?? centerFromRings([boundary, ...lawnRings]) ?? boundary[0];
  const areaM2 = input.areaM2 ?? safeArea(lawnRings);
  // Normalize to a lean summary (drop any extra fields like the DSM surface grid)
  // so the saved depth_model stays compact.
  const elevation: GardenElevationSummary | null = input.elevation
    ? {
        source: "dhm",
        cols: input.elevation.cols,
        rows: input.elevation.rows,
        bbox: input.elevation.bbox,
        terrain: input.elevation.terrain,
        stats: input.elevation.stats,
        resolutionM: input.elevation.resolutionM,
        confidence: input.elevation.confidence,
      }
    : null;

  const builtObjects: GardenDepthObject[] = input.objects
    .filter((object) => object.footprint.length >= 3)
    .map((object, index) => {
      const confidence = clamp01(object.confidence);
      return {
        id: `built-${object.type}-${index + 1}`,
        type: object.type,
        label: object.label,
        footprint: object.footprint,
        localFootprint: object.footprint.map((point) => lngLatToLocal(point, center)),
        areaM2: safeArea([object.footprint]),
        dimensionsM: dimensionsForRing(object.footprint, center),
        heightM: Number(object.heightM.toFixed(2)),
        heightRangeM: heightRangeForConfidence(object.heightM, confidence),
        confidence,
        source: object.source,
        notes: object.notes,
      };
    });

  const objects = [...builtObjects, ...exclusionObjects(input.exclusions ?? [], center)];

  const reliefM = elevation?.stats.reliefM ?? 0;
  const slopeHint: GardenDepthModel["terrain"]["slopeHint"] = elevation
    ? (reliefM < 0.25 ? "flat" : "gentle")
    : "unknown";
  const elevationConfidence = elevation?.confidence ?? 0.25;
  const verifiedObjects = builtObjects.filter((object) => object.confidence >= 0.7).length;
  const quality = qualityForBuiltModel({
    objectCount: builtObjects.length,
    verifiedObjects,
    hasElevation: Boolean(elevation),
    reliefM,
    hasMatrikel: Boolean(input.matrikel?.length),
  });
  const alignmentConfidence = elevation ? Math.min(0.9, 0.6 + elevationConfidence * 0.3) : 0.55;

  const warnings = [
    elevation ? "terrain_from_dhm_elevation" : "elevation_unavailable_flat_terrain",
    ...(builtObjects.some((object) => object.source === "elevation_model") ? ["object_heights_partly_from_dhm"] : []),
    ...(builtObjects.length ? [] : ["no_objects_placed"]),
  ];

  return {
    version: 1,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    gardenId: input.gardenId ?? null,
    name: input.name ?? null,
    center,
    units: "meters",
    alignment: {
      mode: "elevation-model",
      anchorCount: 0,
      residualM: null,
      confidence: alignmentConfidence,
      notes: elevation
        ? `Terræn fra Danmarks Højdemodel (DHM) med ${reliefM.toFixed(2)} m relief. Objekter placeret og højdesat i 3D-byggeren.`
        : "Fladt terræn (ingen højdedata for adressen). Objekter placeret manuelt i 3D-byggeren.",
    },
    quality,
    twin: baseTwinContract({
      status: "evidence_ready",
      updatedBy: "manual_review",
      modelName: elevation ? "havemaaler-3d-builder-dhm" : "havemaaler-3d-builder",
      modelVersion: "garden-twin-v1",
      provider: "havekongen",
      license: "commercial-approved",
      commercialUseApproved: true,
      evidence: {
        ortofoto: true,
        cadastralBoundary: Boolean(input.matrikel?.length),
        manualGeometry: true,
        mobileScan: false,
        coverageScore: elevation ? elevation.confidence : null,
        warnings,
      },
    }),
    captureReadiness: {
      minimumAnchors: 2,
      recommendedAnchors: 4,
      recommendedSeconds: [45, 90],
      anchorSuggestions: anchorSuggestionsForBoundary(boundary, center),
    },
    terrain: {
      boundary,
      localBoundary: boundary.map((point) => lngLatToLocal(point, center)),
      lawnRings,
      localLawnRings: lawnRings.map((ring) => ring.map((point) => lngLatToLocal(point, center))),
      areaM2,
      slopeHint,
      elevationConfidence,
      unknownRegions: [],
      elevation,
    },
    objects,
    warnings,
    privacy: {
      rawMediaRetentionDays: 14,
      derivedGeometryStored: true,
      rawMediaUserDeletable: true,
    },
  };
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function heightRangeForConfidence(heightM: number, confidence: number): [number, number] {
  const spread = Math.max(0.1, heightM * (1 - confidence) * 0.6);
  return [Number(Math.max(0, heightM - spread).toFixed(2)), Number((heightM + spread).toFixed(2))];
}

function qualityForBuiltModel(input: { objectCount: number; verifiedObjects: number; hasElevation: boolean; reliefM: number; hasMatrikel: boolean }): GardenDepthModel["quality"] {
  let score = 48;
  const reasons: string[] = ["Objekter placeret og højdesat i 3D-byggeren."];
  if (input.hasElevation) {
    score += 22;
    reasons.push("Terræn og objekt-højder understøttet af Danmarks Højdemodel.");
    if (input.reliefM >= 0.25) {
      score += 4;
      reasons.push(`Reelt terrænfald på ${input.reliefM.toFixed(1)} m i haven.`);
    }
  } else {
    reasons.push("Fladt terræn — ingen højdedata for adressen.");
  }
  if (input.hasMatrikel) score += 4;
  if (input.objectCount >= 3) score += 6;
  if (input.verifiedObjects >= 3) score += 8;
  const finalScore = Math.min(100, score);
  const grade = finalScore >= 76 ? "strong" : finalScore >= 52 ? "usable" : "draft";
  return {
    score: finalScore,
    grade,
    reasons,
    nextBestAction: grade === "strong" ? "ready" : "review_objects",
  };
}

export function depthConfidenceLabel(confidence: number) {
  if (confidence >= 0.78) return "høj";
  if (confidence >= 0.55) return "middel";
  return "estimat";
}

function upgradeLegacyDepthModel(value: unknown): GardenDepthModel | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<GardenDepthModel>;
  if (row.version !== 1 || row.units !== "meters" || !Array.isArray(row.center) || !row.terrain || !Array.isArray(row.objects)) {
    return null;
  }
  if (row.quality && row.captureReadiness && row.privacy && row.twin) return null;
  const center = row.center as LngLat;
  const terrain = row.terrain as GardenDepthModel["terrain"];
  const objects = row.objects.map((object) => ({
    ...object,
    areaM2: object.areaM2 ?? safeArea([object.footprint]),
    dimensionsM: object.dimensionsM ?? dimensionsForRing(object.footprint, center),
  }));
  return {
    version: 1,
    generatedAt: row.generatedAt ?? new Date().toISOString(),
    gardenId: row.gardenId ?? null,
    name: row.name ?? null,
    center,
    units: "meters",
    alignment: row.alignment ?? {
      mode: "satellite-only",
      anchorCount: 0,
      residualM: null,
      confidence: 0.35,
    },
    quality: row.quality ?? qualityForModel({
      objectCount: objects.length,
      anchorCount: row.alignment?.anchorCount ?? 0,
      hasMatrikel: Boolean(terrain.boundary?.length),
      hasExclusions: objects.some((object) => object.source === "manual"),
    }),
    twin: row.twin ?? baseTwinContract({
      status: row.alignment?.mode === "scan-anchored" ? "needs_review" : "draft",
      updatedBy: row.alignment?.mode === "scan-anchored" ? "ai_reconstruction_worker" : "havemaaler_2d",
      modelName: row.alignment?.mode === "scan-anchored" ? "legacy-scan-reconstruction" : "legacy-satellite-preview",
      modelVersion: "garden-twin-v1",
      provider: "havekongen",
      license: "commercial-approved",
      commercialUseApproved: true,
      evidence: {
        ortofoto: true,
        cadastralBoundary: Boolean(terrain.boundary?.length),
        manualGeometry: Boolean(terrain.lawnRings?.length),
        mobileScan: row.alignment?.mode === "scan-anchored",
        residualM: row.alignment?.residualM ?? null,
        warnings: row.warnings ?? [],
      },
    }),
    captureReadiness: row.captureReadiness ?? {
      minimumAnchors: 2,
      recommendedAnchors: 4,
      recommendedSeconds: [45, 90],
      anchorSuggestions: anchorSuggestionsForBoundary(terrain.boundary ?? [], center),
    },
    terrain,
    objects,
    warnings: row.warnings ?? [],
    privacy: row.privacy ?? {
      rawMediaRetentionDays: 14,
      derivedGeometryStored: true,
      rawMediaUserDeletable: true,
    },
    scan: row.scan,
  };
}

function isLngLat(value: unknown): value is LngLat {
  return Array.isArray(value)
    && value.length >= 2
    && typeof value[0] === "number"
    && typeof value[1] === "number"
    && Number.isFinite(value[0])
    && Number.isFinite(value[1]);
}

function safeArea(rings: Ring[]) {
  return Math.round(rings.reduce((sum, ring) => {
    try {
      return sum + turf.area(turf.polygon([[...ring, ring[0]]]));
    } catch {
      return sum;
    }
  }, 0));
}

function exclusionObjects(exclusions: Ring[], center: LngLat): GardenDepthObject[] {
  return exclusions
    .filter((ring) => ring.length >= 3)
    .slice(0, 12)
    .map((ring, index) => ({
      id: `exclusion-${index + 1}`,
      type: "patio" as const,
      label: "Udeladt område",
      footprint: ring,
      localFootprint: ring.map((point) => lngLatToLocal(point, center)),
      areaM2: safeArea([ring]),
      dimensionsM: dimensionsForRing(ring, center),
      heightRangeM: [0, 0.25],
      confidence: 0.62,
      source: "manual" as const,
      notes: "Fra Havemåler-udeladelse. Vises som lavt område, ikke som scannet forhindring.",
    }));
}

function anchorSuggestionsForBoundary(boundary: Ring, center: LngLat) {
  return boundary
    .slice(0, 8)
    .map((point, index) => ({
      id: `anchor-${index + 1}`,
      label: index === 0 ? "Start-hjørne" : `Kortanker ${index + 1}`,
      kind: "boundary_corner" as const,
      lngLat: point,
      local: lngLatToLocal(point, center),
      priority: index < 4 ? index + 1 : 6,
    }))
    .sort((a, b) => a.priority - b.priority)
    .slice(0, 4);
}

function qualityForModel(input: { objectCount: number; anchorCount: number; hasMatrikel: boolean; hasExclusions: boolean }): GardenDepthModel["quality"] {
  let score = 34;
  const reasons: string[] = ["Kort-preview giver skala og havegrænse."];
  if (input.hasMatrikel) {
    score += 8;
    reasons.push("Matrikelgrænse er med i modellen.");
  }
  if (input.hasExclusions) {
    score += 8;
    reasons.push("Udeladelser bruges som faste lave objekter.");
  }
  if (input.objectCount >= 4) score += 6;
  if (input.anchorCount >= 2) score += 18;
  const grade = score >= 76 ? "strong" : score >= 52 ? "usable" : "draft";
  return {
    score: Math.min(100, score),
    grade,
    reasons,
    nextBestAction: input.anchorCount >= 2 ? "review_objects" : "mobile_scan",
  };
}

function baseTwinContract(input: {
  status: GardenTwinContract["status"];
  updatedBy: GardenTwinContract["updatedBy"];
  modelName: string;
  modelVersion: string;
  provider: GardenTwinContract["model"]["provider"];
  license: GardenTwinContract["model"]["license"];
  commercialUseApproved: boolean;
  evidence: Partial<GardenTwinContract["evidence"]>;
}): GardenTwinContract {
  return {
    scope: "full",
    role: {
      visual: true,
      operational: true,
    },
    status: input.status,
    confidencePolicy: "truthful-confidence",
    updatedBy: input.updatedBy,
    model: {
      name: input.modelName,
      version: input.modelVersion,
      provider: input.provider,
      license: input.license,
      commercialUseApproved: input.commercialUseApproved,
    },
    evidence: {
      ortofoto: input.evidence.ortofoto ?? false,
      cadastralBoundary: input.evidence.cadastralBoundary ?? false,
      manualGeometry: input.evidence.manualGeometry ?? false,
      mobileScan: input.evidence.mobileScan ?? false,
      keyframeCount: input.evidence.keyframeCount ?? 0,
      usableKeyframeCount: input.evidence.usableKeyframeCount ?? null,
      routeStepCount: input.evidence.routeStepCount ?? 0,
      alignableAnchorCount: input.evidence.alignableAnchorCount ?? 0,
      anchorSpreadM: input.evidence.anchorSpreadM ?? null,
      routePoseCount: input.evidence.routePoseCount ?? null,
      routePoseSpreadM: input.evidence.routePoseSpreadM ?? null,
      coverageScore: input.evidence.coverageScore ?? null,
      deviceQualityScore: input.evidence.deviceQualityScore ?? null,
      motionScore: input.evidence.motionScore ?? null,
      parallaxScore: input.evidence.parallaxScore ?? null,
      residualM: input.evidence.residualM ?? null,
      warnings: input.evidence.warnings ?? [],
    },
  };
}

function dimensionsForRing(ring: Ring, center: LngLat) {
  const bounds = localBounds(ring.map((point) => lngLatToLocal(point, center)));
  return {
    width: Number(bounds.width.toFixed(1)),
    depth: Number(bounds.depth.toFixed(1)),
  };
}

function localBounds(points: LocalPoint[]) {
  const xs = points.map((point) => point.x);
  const zs = points.map((point) => point.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    width: Math.max(0, maxX - minX),
    depth: Math.max(0, maxZ - minZ),
  };
}
