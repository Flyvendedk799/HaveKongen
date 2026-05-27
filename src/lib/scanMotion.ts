export type DeviceMotionVector = {
  x: number | null;
  y: number | null;
  z: number | null;
};

export type DeviceMotionSample = {
  t: number;
  acceleration?: DeviceMotionVector;
  rotationRate?: {
    alpha: number | null;
    beta: number | null;
    gamma: number | null;
  };
  interval?: number | null;
};

export type DeviceMotionSummary = {
  sampleCount: number;
  durationSeconds: number;
  sampleRateHz: number;
  rotationCoverageDeg: number;
  translationSignal: number;
  shakeScore: number;
  parallaxScore: number;
  motionScore: number;
  usable: boolean;
  warnings: string[];
};

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function rounded(value: number, decimals = 3) {
  return Number(value.toFixed(decimals));
}

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function vectorMagnitude(vector: DeviceMotionVector | undefined) {
  if (!vector) return null;
  const values = [finite(vector.x), finite(vector.y), finite(vector.z)].filter((value): value is number => value !== null);
  if (!values.length) return null;
  return Math.hypot(...values);
}

function rotationMagnitude(rotation: DeviceMotionSample["rotationRate"]) {
  if (!rotation) return null;
  const values = [finite(rotation.alpha), finite(rotation.beta), finite(rotation.gamma)].filter((value): value is number => value !== null);
  if (!values.length) return null;
  return Math.hypot(...values);
}

function average(values: number[]) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return 0;
  const mean = average(values);
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

function percentile(values: number[], percentileValue: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * percentileValue)));
  return sorted[index];
}

export function summarizeDeviceMotion(samples: DeviceMotionSample[]): DeviceMotionSummary {
  const ordered = samples
    .filter((sample) => Number.isFinite(sample.t))
    .sort((a, b) => a.t - b.t);

  if (ordered.length < 3) {
    return {
      sampleCount: ordered.length,
      durationSeconds: 0,
      sampleRateHz: 0,
      rotationCoverageDeg: 0,
      translationSignal: 0,
      shakeScore: 0,
      parallaxScore: 0,
      motionScore: 0,
      usable: false,
      warnings: ["no_motion_samples"],
    };
  }

  const durationSeconds = Math.max(0, (ordered[ordered.length - 1].t - ordered[0].t) / 1000);
  const sampleRateHz = durationSeconds > 0 ? ordered.length / durationSeconds : 0;
  const accelerationMags: number[] = [];
  let rotationCoverageDeg = 0;

  for (let index = 0; index < ordered.length; index += 1) {
    const sample = ordered[index];
    const accelerationMag = vectorMagnitude(sample.acceleration);
    if (accelerationMag !== null) accelerationMags.push(accelerationMag);

    if (index === 0) continue;
    const previous = ordered[index - 1];
    const deltaSeconds = Math.max(0.001, Math.min(0.25, (sample.t - previous.t) / 1000));
    const rotationMag = rotationMagnitude(sample.rotationRate);
    if (rotationMag !== null) rotationCoverageDeg += rotationMag * deltaSeconds;
  }

  const accelerationStd = standardDeviation(accelerationMags);
  const accelerationP90 = percentile(accelerationMags, 0.9);
  const translationSignal = clamp01(accelerationStd / 0.65);
  const shakeScore = clamp01((accelerationP90 - 2.2) / 4.8);
  const durationScore = clamp01(durationSeconds / 35);
  const sampleDensityScore = clamp01(sampleRateHz / 12);
  const rotationScore = clamp01(rotationCoverageDeg / 110);
  const parallaxScore = clamp01(rotationScore * 0.42 + translationSignal * 0.4 + durationScore * 0.18 - shakeScore * 0.16);
  const motionScore = clamp01(durationScore * 0.2 + sampleDensityScore * 0.14 + rotationScore * 0.28 + translationSignal * 0.26 + (1 - shakeScore) * 0.12);
  const warnings: string[] = [];

  if (durationSeconds < 20) warnings.push("short_motion_track");
  if (sampleRateHz < 2) warnings.push("low_motion_sample_rate");
  if (rotationCoverageDeg < 25) warnings.push("low_rotation_coverage");
  if (translationSignal < 0.12) warnings.push("low_translation_signal");
  if (shakeScore > 0.55) warnings.push("shaky_capture");
  if (parallaxScore < 0.35) warnings.push("weak_motion_parallax");

  return {
    sampleCount: ordered.length,
    durationSeconds: rounded(durationSeconds, 1),
    sampleRateHz: rounded(sampleRateHz, 1),
    rotationCoverageDeg: rounded(rotationCoverageDeg, 1),
    translationSignal: rounded(translationSignal),
    shakeScore: rounded(shakeScore),
    parallaxScore: rounded(parallaxScore),
    motionScore: rounded(motionScore),
    usable: motionScore >= 0.38 && parallaxScore >= 0.28 && shakeScore <= 0.7,
    warnings,
  };
}

export function scanMotionLabel(summary: DeviceMotionSummary) {
  if (summary.motionScore >= 0.72 && summary.parallaxScore >= 0.55) return "stærk";
  if (summary.motionScore >= 0.42 && summary.parallaxScore >= 0.3) return "brugbar";
  return "svag";
}
