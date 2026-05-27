import { describe, expect, it } from "vitest";
import { analyzeDeviceFrameQuality, scanQualityLabel, summarizeDeviceScanQuality } from "@/lib/scanQuality";

function solidFrame(width: number, height: number, rgb: [number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = rgb[0];
    data[i + 1] = rgb[1];
    data[i + 2] = rgb[2];
    data[i + 3] = 255;
  }
  return { data, width, height };
}

function checkerFrame(width: number, height: number) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const bright = (x + y) % 2 === 0 ? 230 : 30;
      const i = (y * width + x) * 4;
      data[i] = bright;
      data[i + 1] = bright;
      data[i + 2] = bright;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

describe("scanQuality", () => {
  it("marks flat dark frames as unusable", () => {
    const quality = analyzeDeviceFrameQuality(solidFrame(64, 64, [12, 12, 12]));

    expect(quality.usable).toBe(false);
    expect(quality.warnings).toContain("low_light_frame");
    expect(quality.warnings).toContain("blurry_frame");
  });

  it("detects high-contrast sharp frames as usable", () => {
    const quality = analyzeDeviceFrameQuality(checkerFrame(64, 64));

    expect(quality.usable).toBe(true);
    expect(quality.sharpness).toBeGreaterThan(0.03);
    expect(quality.contrast).toBeGreaterThan(0.1);
  });

  it("summarizes usable frames and labels scan quality", () => {
    const usable = analyzeDeviceFrameQuality(checkerFrame(64, 64));
    const weak = analyzeDeviceFrameQuality(solidFrame(64, 64, [20, 20, 20]));
    const summary = summarizeDeviceScanQuality([usable, usable, usable, usable, usable, weak, weak, weak]);

    expect(summary.frameCount).toBe(8);
    expect(summary.usableFrameCount).toBe(5);
    expect(summary.lowLightFrameCount).toBe(3);
    expect(summary.warnings).toContain("low_light_capture");
    expect(scanQualityLabel(summary)).toBe("brugbar");
  });
});
