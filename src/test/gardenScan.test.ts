import { describe, expect, it } from "vitest";
import {
  inspectScanManifest,
  MIN_ROUTE_STEPS,
  type GardenScanManifest,
} from "@/lib/gardenScan";

function routeStep(index: number) {
  return {
    id: `step-${index}`,
    label: `Step ${index}`,
    completedAt: "2026-05-24T10:00:00.000Z",
    captureSeconds: index * 8,
    evidenceFrameId: `frame-${index}`,
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
      low_light: false,
    },
    anchors: [],
    route: {
      mode: "guided_center_route",
      camera_target: "garden_center",
      required_step_count: MIN_ROUTE_STEPS,
      steps,
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
});
