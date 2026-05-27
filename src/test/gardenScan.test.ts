import { describe, expect, it } from "vitest";
import {
  inspectScanManifest,
  latestUsefulScan,
  MIN_ROUTE_STEPS,
  scanCanStartNewSession,
  scanEvidenceSummary,
  type GardenScanManifest,
  type GardenScanSession,
} from "@/lib/gardenScan";

function routeStep(index: number) {
  return {
    id: `step-${index}`,
    label: `Step ${index}`,
    completedAt: "2026-05-24T10:00:00.000Z",
    captureSeconds: index * 8,
    evidenceFrameId: `frame-${index}`,
    mapLngLat: [12 + index * 0.00008, 55 + index * 0.00002] as [number, number],
    local: { x: index * 5, z: index * 2 },
    poseConfidence: 0.52,
    motionScore: 0.48,
    deviceQualityScore: 0.7,
  };
}

function manifest(overrides: Partial<GardenScanManifest> = {}): GardenScanManifest {
  const steps = Array.from({ length: MIN_ROUTE_STEPS }, (_, index) => routeStep(index + 1));
  return {
    version: 1,
    session_id: "session-1",
    garden_id: "garden-1",
    device: {
      model: "iPhone web",
      client_version: "mobile-web-v1",
      supports_camera: true,
      supports_device_motion: true,
      supports_lidar: false,
    },
    capture: {
      duration_seconds: 55,
      tracking_quality: "normal",
      frame_count: 10,
      keyframe_count: 10,
      automatic_keyframes: true,
      frame_interval_seconds: 2.8,
      anchor_count: 0,
      aligned_anchor_count: 0,
      route_guided: true,
      route_step_count: MIN_ROUTE_STEPS,
      completed_route_steps: MIN_ROUTE_STEPS,
      route_progress: 1,
      coverage_score: 0.82,
      route_pose_count: MIN_ROUTE_STEPS,
      route_pose_spread_m: 15,
      motion_score: 0.48,
      parallax_score: 0.36,
      low_light: false,
    },
    anchors: [],
    route: {
      mode: "guided_center_route",
      camera_target: "garden_center",
      required_step_count: MIN_ROUTE_STEPS,
      steps,
      pose_hints: steps.map((step) => ({
        id: step.id,
        label: step.label,
        source: "guided_route" as const,
        mapLngLat: step.mapLngLat,
        local: step.local,
        confidence: step.poseConfidence,
        evidenceFrameId: step.evidenceFrameId,
      })),
    },
    files: {
      manifest: "user/session/manifest.json",
      tracking: "user/session/tracking.json",
      keyframes: "user/session/keyframes.json",
      preview: "user/session/preview.jpg",
    },
    ...overrides,
  };
}

describe("garden scan manifest route gates", () => {
  it("accepts a completed guided route without manual anchors", () => {
    const result = inspectScanManifest(manifest());

    expect(result.ready).toBe(true);
    expect(result.issues.some((issue) => issue.code === "manual_anchors_missing" && issue.severity === "warning")).toBe(true);
    expect(result.issues.some((issue) => issue.severity === "error")).toBe(false);
  });

  it("rejects route-first uploads until the guided route is complete", () => {
    const result = inspectScanManifest(manifest({
      capture: {
        ...manifest().capture,
        completed_route_steps: MIN_ROUTE_STEPS - 1,
        route_progress: 0.75,
      },
      route: {
        ...manifest().route!,
        steps: manifest().route!.steps.slice(0, MIN_ROUTE_STEPS - 1),
      },
    }));

    expect(result.ready).toBe(false);
    expect(result.issues.some((issue) => issue.code === "route_incomplete" && issue.severity === "error")).toBe(true);
  });

  it("warns about weak manual anchors without blocking completed route uploads", () => {
    const result = inspectScanManifest(manifest({
      anchors: [
        { id: "a1", mapLngLat: [12, 55], imagePoint: { x: 0.2, y: 0.4 } },
        { id: "a2", mapLngLat: [12, 55], imagePoint: { x: 0.7, y: 0.4 } },
      ],
    }));

    expect(result.ready).toBe(true);
    expect(result.issues.some((issue) => issue.code === "weak_anchor_spread" && issue.severity === "warning")).toBe(true);
  });

  it("summarizes route-first evidence from a scan session", () => {
    const session = scanSession({
      status: "uploaded",
      upload_prefix: "user/session",
      capture_metadata: {
        keyframe_count: 12,
        route_step_count: MIN_ROUTE_STEPS,
        completed_route_steps: MIN_ROUTE_STEPS,
        route_pose_count: MIN_ROUTE_STEPS,
        route_pose_spread_m: 15,
      },
      warnings: ["manual_anchors_missing"],
    });

    const summary = scanEvidenceSummary(session);

    expect(summary.readyToUpload).toBe(true);
    expect(summary.routeReady).toBe(true);
    expect(summary.keyframesReady).toBe(true);
    expect(summary.alignableAnchorCount).toBe(0);
    expect(summary.warningCodes).toEqual(["manual_anchors_missing"]);
  });

  it("prefers active sessions and blocks duplicate non-terminal scans", () => {
    const ready = scanSession({ id: "ready", status: "ready" });
    const uploaded = scanSession({ id: "uploaded", status: "uploaded" });
    const active = scanSession({ id: "active", status: "capturing" });

    expect(latestUsefulScan([uploaded, ready, active])?.id).toBe("active");
    expect(scanCanStartNewSession([ready])).toBe(true);
    expect(scanCanStartNewSession([ready, active])).toBe(false);
  });
});

function scanSession(overrides: Partial<GardenScanSession> = {}): GardenScanSession {
  return {
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
    source: "havemaaler",
    result_json: null,
    status: "created",
    status_history: [],
    upload_prefix: null,
    warnings: [],
    claimed_by: null,
    ...overrides,
  };
}
