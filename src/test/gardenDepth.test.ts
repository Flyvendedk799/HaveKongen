import { describe, expect, it } from "vitest";
import {
  coerceGardenDepthModel,
  depthConfidenceLabel,
  depthPipelineStage,
  depthPipelineStageLabel,
  generateGardenDepthModel,
  inspectGardenDepthModel,
  lngLatToLocal,
  localToLngLat,
  summarizeDepthModel,
  validateGardenDepthModel,
  type Ring,
} from "@/lib/gardenDepth";
import {
  anchorSpreadMeters,
  buildUploadTargets,
  canTransitionScanStatus,
  countAlignableAnchors,
  expectedArtifactPaths,
  inspectScanManifest,
  scanCanStartNewSession,
  scanProgress,
  scanStatusLabel,
  scanStatusTone,
  validateScanManifest,
  webGardenScanUrl,
  type GardenScanSession,
} from "@/lib/gardenScan";

const lawn: Ring = [
  [12.0000, 55.0000],
  [12.0006, 55.0000],
  [12.0006, 55.0004],
  [12.0000, 55.0004],
];

describe("gardenDepth", () => {
  it("generates a satellite-only model from Havemåler rings", () => {
    const model = generateGardenDepthModel({
      gardenId: "garden-1",
      name: "Testhave",
      lawnRings: [lawn],
      exclusions: [[
        [12.0001, 55.0001],
        [12.0002, 55.0001],
        [12.0002, 55.0002],
        [12.0001, 55.0002],
      ]],
      areaM2: 500,
      generatedAt: "2026-05-24T00:00:00.000Z",
    });

    expect(model?.version).toBe(1);
    expect(model?.alignment.mode).toBe("satellite-only");
    expect(model?.terrain.areaM2).toBe(500);
    expect(model?.objects.some((object) => object.type === "patio")).toBe(true);
    expect(model?.quality.nextBestAction).toBe("mobile_scan");
    expect(model?.captureReadiness.anchorSuggestions.length).toBeGreaterThan(0);
    expect(model?.warnings).toContain("satellite_only_depth");
  });

  it("round trips lng/lat through local meters", () => {
    const center: [number, number] = [12.0003, 55.0002];
    const point: [number, number] = [12.00045, 55.00033];
    const local = lngLatToLocal(point, center);
    const next = localToLngLat(local, center);
    expect(next[0]).toBeCloseTo(point[0], 6);
    expect(next[1]).toBeCloseTo(point[1], 6);
  });

  it("rejects invalid model JSON and labels confidence", () => {
    expect(coerceGardenDepthModel({ version: 1 })).toBeNull();
    expect(depthConfidenceLabel(0.8)).toBe("høj");
    expect(depthConfidenceLabel(0.6)).toBe("middel");
    expect(depthConfidenceLabel(0.2)).toBe("estimat");
  });

  it("validates and summarizes generated models", () => {
    const model = generateGardenDepthModel({ lawnRings: [lawn] });
    expect(validateGardenDepthModel(model)).toEqual([]);
    expect(summarizeDepthModel(model!).objectCount).toBe(0);
    expect(summarizeDepthModel(model!).nextBestAction).toBe("mobile_scan");
    expect(inspectGardenDepthModel(model).readyForSave).toBe(true);
    expect(depthPipelineStage(model)).toBe("satellite_preview");
    expect(depthPipelineStageLabel("satellite_preview")).toBe("Flad kort-preview");
  });

  it("builds the mobile web scan URL", () => {
    expect(webGardenScanUrl("garden id", "session id")).toContain("/havemaaler/scan?");
    expect(webGardenScanUrl("garden id", "session id")).toContain("garden_id=garden+id");
  });

  it("describes scan lifecycle states and upload targets", () => {
    expect(scanStatusLabel("processing")).toBe("Bygger 3D-model");
    expect(scanStatusTone("needs_anchor_correction")).toBe("warning");
    expect(scanProgress("ready")).toBe(100);
    expect(buildUploadTargets("user/session").filter((target) => target.required)).toHaveLength(3);
    expect(expectedArtifactPaths("user/session").manifest).toBe("user/session/manifest.json");
    expect(canTransitionScanStatus("uploaded", "processing")).toBe(true);
    expect(canTransitionScanStatus("ready", "processing")).toBe(false);
  });

  it("validates mobile web scan manifests before worker processing", () => {
    const valid = {
      version: 1,
      session_id: "session-1",
      garden_id: "garden-1",
      device: { model: "iPhone 14 web", supports_lidar: false, supports_camera: true },
      capture: {
        duration_seconds: 62,
        tracking_quality: "normal",
        frame_count: 900,
        keyframe_count: 42,
        coverage_score: 0.72,
      },
      anchors: [
        { id: "a1", mapLngLat: lawn[0], imagePoint: { x: 0.25, y: 0.42 }, confidence: 0.8 },
        { id: "a2", mapLngLat: lawn[1], imagePoint: { x: 0.72, y: 0.38 }, confidence: 0.76 },
      ],
      files: {
        tracking: "user/session/tracking.json",
        keyframes: "user/session/keyframes.json",
      },
    };
    expect(inspectScanManifest(valid).ready).toBe(true);
    expect(countAlignableAnchors(valid.anchors)).toBe(2);
    expect(anchorSpreadMeters(valid.anchors)).toBeGreaterThan(3);
    expect(validateScanManifest({ ...valid, anchors: [] })).toContain("route_or_anchors_required");
    expect(validateScanManifest({
      ...valid,
      anchors: valid.anchors.map((anchor) => ({ id: anchor.id, mapLngLat: anchor.mapLngLat, confidence: anchor.confidence })),
    })).toContain("route_or_anchors_required");
    expect(validateScanManifest({
      ...valid,
      anchors: [
        { ...valid.anchors[0], mapLngLat: lawn[0] },
        { ...valid.anchors[1], mapLngLat: lawn[0] },
      ],
    })).toContain("weak_anchor_spread");
    expect(validateScanManifest({ ...valid, capture: { ...valid.capture, keyframe_count: 4 } })).toContain("too_few_keyframes");
  });

  it("blocks duplicate active scan sessions", () => {
    const base = {
      id: "session-1",
      user_id: "user-1",
      garden_id: "garden-1",
      created_at: "2026-05-24T00:00:00.000Z",
      updated_at: "2026-05-24T00:00:00.000Z",
      last_status_at: "2026-05-24T00:00:00.000Z",
      media_retention_until: "2026-06-07T00:00:00.000Z",
      anchors: [],
      capture_metadata: {},
      confidence: null,
      device_capabilities: {},
      device_model: null,
      error_code: null,
      error_detail: null,
      manifest_path: null,
      capture_client_version: null,
      pipeline_version: "garden-twin-v1",
      processing_attempts: 0,
      processing_finished_at: null,
      processing_started_at: null,
      source: null,
      result_json: null,
      status: "created",
      status_history: [],
      upload_prefix: null,
      warnings: [],
      claimed_by: null,
    } satisfies GardenScanSession;
    expect(scanCanStartNewSession([{ ...base, status: "processing" }])).toBe(false);
    expect(scanCanStartNewSession([{ ...base, status: "ready" }])).toBe(true);
  });
});
