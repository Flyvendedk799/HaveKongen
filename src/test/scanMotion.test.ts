import { describe, expect, it } from "vitest";
import { scanMotionLabel, summarizeDeviceMotion, type DeviceMotionSample } from "@/lib/scanMotion";

function motionSample(t: number, accel: number, rotation: number): DeviceMotionSample {
  return {
    t,
    acceleration: { x: accel, y: accel * 0.4, z: accel * 0.2 },
    rotationRate: { alpha: rotation, beta: rotation * 0.5, gamma: rotation * 0.25 },
    interval: 100,
  };
}

describe("scanMotion", () => {
  it("marks missing motion as unusable but explicit", () => {
    const summary = summarizeDeviceMotion([]);

    expect(summary.usable).toBe(false);
    expect(summary.motionScore).toBe(0);
    expect(summary.warnings).toContain("no_motion_samples");
  });

  it("scores route motion with rotation and translation parallax", () => {
    const samples = Array.from({ length: 360 }, (_, index) => {
      const t = index * 100;
      const accel = 0.18 + Math.sin(index / 8) * 0.26;
      return motionSample(t, accel, 5.6);
    });

    const summary = summarizeDeviceMotion(samples);

    expect(summary.durationSeconds).toBeGreaterThan(30);
    expect(summary.motionScore).toBeGreaterThan(0.42);
    expect(summary.parallaxScore).toBeGreaterThan(0.3);
    expect(summary.usable).toBe(true);
    expect(scanMotionLabel(summary)).not.toBe("svag");
  });

  it("warns when a phone is almost static", () => {
    const samples = Array.from({ length: 80 }, (_, index) => motionSample(index * 150, 0.01, 0.2));

    const summary = summarizeDeviceMotion(samples);

    expect(summary.usable).toBe(false);
    expect(summary.warnings).toContain("low_rotation_coverage");
    expect(summary.warnings).toContain("low_translation_signal");
  });
});
