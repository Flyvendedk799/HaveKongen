export type DeviceFrameQuality = {
  brightness: number;
  contrast: number;
  sharpness: number;
  usable: boolean;
  warnings: string[];
};

export type DeviceScanQualitySummary = {
  frameCount: number;
  usableFrameCount: number;
  blurryFrameCount: number;
  lowLightFrameCount: number;
  overexposedFrameCount: number;
  averageBrightness: number;
  averageContrast: number;
  averageSharpness: number;
  qualityScore: number;
  warnings: string[];
};

type PixelBuffer = {
  data: Uint8ClampedArray;
  width: number;
  height: number;
};

const MIN_USABLE_BRIGHTNESS = 0.16;
const MAX_USABLE_BRIGHTNESS = 0.94;
const MIN_USABLE_CONTRAST = 0.055;
const MIN_USABLE_SHARPNESS = 0.032;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function rounded(value: number, decimals = 3) {
  return Number(value.toFixed(decimals));
}

function lumaAt(buffer: PixelBuffer, x: number, y: number) {
  const idx = (y * buffer.width + x) * 4;
  return (buffer.data[idx] * 0.2126 + buffer.data[idx + 1] * 0.7152 + buffer.data[idx + 2] * 0.0722) / 255;
}

export function analyzeDeviceFrameQuality(buffer: PixelBuffer): DeviceFrameQuality {
  const width = Math.max(1, Math.floor(buffer.width));
  const height = Math.max(1, Math.floor(buffer.height));
  const step = Math.max(2, Math.floor(Math.min(width, height) / 96));
  const neighborOffset = Math.max(1, Math.floor(step / 2));
  const samples: number[] = [];
  let gradientSum = 0;
  let gradientCount = 0;

  for (let y = step; y < height - step; y += step) {
    for (let x = step; x < width - step; x += step) {
      const y0 = lumaAt(buffer, x, y);
      const yRight = lumaAt(buffer, x + neighborOffset, y);
      const yDown = lumaAt(buffer, x, y + neighborOffset);
      samples.push(y0, yRight, yDown);
      const dx = Math.abs(y0 - yRight);
      const dy = Math.abs(y0 - yDown);
      gradientSum += dx + dy;
      gradientCount += 2;
    }
  }

  if (!samples.length) {
    return {
      brightness: 0,
      contrast: 0,
      sharpness: 0,
      usable: false,
      warnings: ["empty_frame"],
    };
  }

  const brightness = samples.reduce((sum, value) => sum + value, 0) / samples.length;
  const variance = samples.reduce((sum, value) => sum + (value - brightness) ** 2, 0) / samples.length;
  const contrast = Math.sqrt(variance);
  const sharpness = gradientCount ? gradientSum / gradientCount : 0;
  const warnings: string[] = [];
  if (brightness < MIN_USABLE_BRIGHTNESS) warnings.push("low_light_frame");
  if (brightness > MAX_USABLE_BRIGHTNESS) warnings.push("overexposed_frame");
  if (contrast < MIN_USABLE_CONTRAST) warnings.push("low_contrast_frame");
  if (sharpness < MIN_USABLE_SHARPNESS) warnings.push("blurry_frame");

  return {
    brightness: rounded(brightness),
    contrast: rounded(contrast),
    sharpness: rounded(sharpness),
    usable: warnings.length === 0,
    warnings,
  };
}

export function summarizeDeviceScanQuality(frames: DeviceFrameQuality[]): DeviceScanQualitySummary {
  const frameCount = frames.length;
  if (!frameCount) {
    return {
      frameCount: 0,
      usableFrameCount: 0,
      blurryFrameCount: 0,
      lowLightFrameCount: 0,
      overexposedFrameCount: 0,
      averageBrightness: 0,
      averageContrast: 0,
      averageSharpness: 0,
      qualityScore: 0,
      warnings: ["no_quality_frames"],
    };
  }

  const count = (warning: string) => frames.filter((frame) => frame.warnings.includes(warning)).length;
  const average = (selector: (frame: DeviceFrameQuality) => number) => frames.reduce((sum, frame) => sum + selector(frame), 0) / frameCount;
  const usableFrameCount = frames.filter((frame) => frame.usable).length;
  const blurryFrameCount = count("blurry_frame");
  const lowLightFrameCount = count("low_light_frame");
  const overexposedFrameCount = count("overexposed_frame");
  const averageBrightness = average((frame) => frame.brightness);
  const averageContrast = average((frame) => frame.contrast);
  const averageSharpness = average((frame) => frame.sharpness);
  const usableRatio = usableFrameCount / frameCount;
  const exposureScore = 1 - Math.min(1, (lowLightFrameCount + overexposedFrameCount) / frameCount);
  const contrastScore = clamp01((averageContrast - 0.035) / 0.11);
  const sharpnessScore = clamp01((averageSharpness - 0.02) / 0.08);
  const qualityScore = clamp01(usableRatio * 0.5 + exposureScore * 0.18 + contrastScore * 0.16 + sharpnessScore * 0.16);
  const warnings: string[] = [];
  if (usableFrameCount < Math.min(8, frameCount)) warnings.push("few_usable_keyframes");
  if (blurryFrameCount / frameCount >= 0.35) warnings.push("many_blurry_frames");
  if (lowLightFrameCount / frameCount >= 0.25) warnings.push("low_light_capture");
  if (overexposedFrameCount / frameCount >= 0.25) warnings.push("overexposed_capture");
  if (averageContrast < MIN_USABLE_CONTRAST) warnings.push("low_contrast_capture");

  return {
    frameCount,
    usableFrameCount,
    blurryFrameCount,
    lowLightFrameCount,
    overexposedFrameCount,
    averageBrightness: rounded(averageBrightness),
    averageContrast: rounded(averageContrast),
    averageSharpness: rounded(averageSharpness),
    qualityScore: rounded(qualityScore),
    warnings,
  };
}

export function scanQualityLabel(summary: DeviceScanQualitySummary) {
  if (summary.qualityScore >= 0.72 && summary.usableFrameCount >= 8) return "stærk";
  if (summary.qualityScore >= 0.48 && summary.usableFrameCount >= 5) return "brugbar";
  return "svag";
}
