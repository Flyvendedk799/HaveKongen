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
  | "manual"
  | "fallback";

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

export type GardenDepthModel = {
  version: 1;
  generatedAt: string;
  gardenId?: string | null;
  name?: string | null;
  center: LngLat;
  units: "meters";
  alignment: {
    mode: "satellite-only" | "scan-anchored" | "manual";
    anchorCount: number;
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
  if (model.alignment.mode !== "scan-anchored" && model.quality.grade === "strong") {
    issues.push({ severity: "warning", code: "strong_quality_requires_scan", message: "Strong kvalitet bør kræve scan-anchored alignment." });
  }
  if (model.alignment.mode === "scan-anchored" && model.alignment.anchorCount < 2) {
    issues.push({ severity: "error", code: "scan_alignment_requires_anchors", message: "Scan-alignment kræver mindst 2 ankre." });
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
  if (model.objects.length > 0) return "satellite_preview";
  return "outline_only";
}

export function depthPipelineStageLabel(stage: ReturnType<typeof depthPipelineStage>) {
  if (stage === "scan_verified") return "Scan-verificeret";
  if (stage === "scan_needs_review") return "Scan kræver tjek";
  if (stage === "satellite_preview") return "Satellit-preview";
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
  const objects = [
    ...perimeterObjects(boundary, center),
    ...exclusionObjects(input.exclusions ?? [], center),
    ...generatedCanopyHints(lawnRings, center),
  ];
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
      notes: "Generated from Havemåler geometry. Add a mobile web scan for anchored depth.",
    },
    quality,
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
  if (row.quality && row.captureReadiness && row.privacy) return null;
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

function perimeterObjects(boundary: Ring, center: LngLat): GardenDepthObject[] {
  const out: GardenDepthObject[] = [];
  if (boundary.length < 3) return out;
  const loop = [...boundary, boundary[0]];
  for (let i = 0; i < loop.length - 1 && out.length < 10; i += 1) {
    const a = lngLatToLocal(loop[i], center);
    const b = lngLatToLocal(loop[i + 1], center);
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 4) continue;
    const strip = edgeStrip(a, b, 0.7).map((point) => localToLngLat(point, center));
    out.push({
      id: `perimeter-${i + 1}`,
      type: i % 3 === 0 ? "hedge" : "fence",
      label: i % 3 === 0 ? "Mulig hæk/skel" : "Muligt hegn/skel",
      footprint: strip,
      localFootprint: strip.map((point) => lngLatToLocal(point, center)),
      areaM2: Number((len * 0.7).toFixed(1)),
      dimensionsM: { width: Number(len.toFixed(1)), depth: 0.7 },
      heightRangeM: i % 3 === 0 ? [1.0, 1.8] : [0.8, 1.4],
      confidence: 0.34,
      source: "satellite",
      notes: "Skelobjekt foreslået fra havegrænsen. Bekræft med mobilscan.",
    });
  }
  return out;
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
      notes: "Fra Havemåler-udeladelse. Brug 3D-scan for præcis objekttype.",
    }));
}

function generatedCanopyHints(lawnRings: Ring[], center: LngLat): GardenDepthObject[] {
  const out: GardenDepthObject[] = [];
  lawnRings.slice(0, 3).forEach((ring, ringIndex) => {
    const localRing = ring.map((point) => lngLatToLocal(point, center));
    const bounds = localBounds(localRing);
    if (bounds.width < 10 || bounds.depth < 10) return;
    const radius = Math.max(1.8, Math.min(3.6, Math.min(bounds.width, bounds.depth) * 0.12));
    const localCenter = {
      x: bounds.minX + bounds.width * 0.72,
      z: bounds.minZ + bounds.depth * 0.32,
    };
    const localFootprint = circleFootprint(localCenter, radius, 12);
    out.push({
      id: `canopy-hint-${ringIndex + 1}`,
      type: "tree",
      label: "Mulig trækrone",
      footprint: localFootprint.map((point) => localToLngLat(point, center)),
      localFootprint,
      areaM2: Number((Math.PI * radius * radius).toFixed(1)),
      dimensionsM: { width: Number((radius * 2).toFixed(1)), depth: Number((radius * 2).toFixed(1)) },
      heightRangeM: [2.5, 5.5],
      confidence: 0.26,
      source: "fallback",
      notes: "Placeholder for canopy/obstacle layer until scan or AI reconstruction confirms the object.",
    });
  });
  return out;
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
  const reasons: string[] = ["Satellitmodellen giver skala og havegrænse."];
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

function circleFootprint(center: LocalPoint, radius: number, segments: number): LocalPoint[] {
  return Array.from({ length: segments }, (_, index) => {
    const a = (index / segments) * Math.PI * 2;
    return {
      x: center.x + Math.cos(a) * radius,
      z: center.z + Math.sin(a) * radius,
    };
  });
}

function edgeStrip(a: LocalPoint, b: LocalPoint, widthM: number): LocalPoint[] {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz) || 1;
  const nx = (-dz / len) * widthM * 0.5;
  const nz = (dx / len) * widthM * 0.5;
  return [
    { x: a.x - nx, z: a.z - nz },
    { x: b.x - nx, z: b.z - nz },
    { x: b.x + nx, z: b.z + nz },
    { x: a.x + nx, z: a.z + nz },
  ];
}
