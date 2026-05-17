import type {
  LawnCropMetadata,
  LawnCropPayload,
  LawnSegmentationResult,
  LngLat,
  PixelPoint,
  PixelRing,
  Ring,
  SegmentationOptions,
  SegmentationSeed,
} from "./types";

export type {
  ImagerySource,
  LawnCropMetadata,
  LawnCropPayload,
  LawnSegmentationDiagnostics,
  LawnSegmentationResult,
  LngLat,
  PixelPoint,
  PixelRing,
  Ring,
  SegmentationOptions,
  SegmentationSeed,
} from "./types";

export const LAWN_SEGMENTATION_VERSION = "lawn-cv-v2";

type FeatureMaps = {
  grass: Float32Array;
  hardscape: Float32Array;
  edge: Float32Array;
  texture: Float32Array;
  luminance: Float32Array;
  seedSimilarity: Float32Array;
  negative: Uint8Array;
  parcel?: Uint8Array;
};

type PixelSeed = { kind: "positive" | "negative"; px: PixelPoint };

const NEIGHBORS_8 = [
  [-1, -1], [0, -1], [1, -1],
  [-1, 0], [1, 0],
  [-1, 1], [0, 1], [1, 1],
] as const;

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function sigmoid(x: number) {
  return 1 / (1 + Math.exp(-x));
}

function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp((x - edge0) / (edge1 - edge0 || 1), 0, 1);
  return t * t * (3 - 2 * t);
}

function colorToHsv(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === rn) h = 60 * (((gn - bn) / d) % 6);
    else if (max === gn) h = 60 * ((bn - rn) / d + 2);
    else h = 60 * ((rn - gn) / d + 4);
  }
  if (h < 0) h += 360;
  const s = max === 0 ? 0 : d / max;
  return [h, s, max];
}

export function lngLatToPixel(
  point: LngLat,
  bbox: [number, number, number, number],
  width: number,
  height: number,
): PixelPoint {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  return [
    ((point[0] - minLng) / (maxLng - minLng || 1)) * width,
    ((maxLat - point[1]) / (maxLat - minLat || 1)) * height,
  ];
}

export function pixelToLngLat(
  point: PixelPoint,
  bbox: [number, number, number, number],
  width: number,
  height: number,
): LngLat {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  return [
    minLng + (clamp(point[0], 0, width) / width) * (maxLng - minLng),
    maxLat - (clamp(point[1], 0, height) / height) * (maxLat - minLat),
  ];
}

function pointInPoly(px: number, py: number, poly: PixelRing): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    const intersect = ((yi > py) !== (yj > py))
      && px < ((xj - xi) * (py - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function signedAreaPx(poly: PixelRing): number {
  let area = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    area += poly[j][0] * poly[i][1] - poly[i][0] * poly[j][1];
  }
  return area / 2;
}

function pointOnSegment(px: number, py: number, a: PixelPoint, b: PixelPoint): boolean {
  const cross = (px - a[0]) * (b[1] - a[1]) - (py - a[1]) * (b[0] - a[0]);
  if (Math.abs(cross) > 1e-7) return false;
  const dot = (px - a[0]) * (b[0] - a[0]) + (py - a[1]) * (b[1] - a[1]);
  if (dot < -1e-7) return false;
  const lenSq = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
  return dot <= lenSq + 1e-7;
}

function pointInOrOnPoly(px: number, py: number, poly: PixelRing): boolean {
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    if (pointOnSegment(px, py, poly[j], poly[i])) return true;
  }
  return pointInPoly(px, py, poly);
}

function orientation(a: PixelPoint, b: PixelPoint, c: PixelPoint): number {
  const value = (b[1] - a[1]) * (c[0] - b[0]) - (b[0] - a[0]) * (c[1] - b[1]);
  if (Math.abs(value) < 1e-7) return 0;
  return value > 0 ? 1 : 2;
}

function segmentsIntersect(a: PixelPoint, b: PixelPoint, c: PixelPoint, d: PixelPoint): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && pointOnSegment(c[0], c[1], a, b)) return true;
  if (o2 === 0 && pointOnSegment(d[0], d[1], a, b)) return true;
  if (o3 === 0 && pointOnSegment(a[0], a[1], c, d)) return true;
  if (o4 === 0 && pointOnSegment(b[0], b[1], c, d)) return true;
  return false;
}

function hasSelfIntersection(poly: PixelRing): boolean {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    for (let j = i + 1; j < poly.length; j++) {
      const adjacent = j === i || j === (i + 1) % poly.length || i === (j + 1) % poly.length;
      if (adjacent) continue;
      const c = poly[j];
      const d = poly[(j + 1) % poly.length];
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return false;
}

function normalizeSeeds(seeds: SegmentationSeed[], metadata: LawnCropMetadata): PixelSeed[] {
  const out: PixelSeed[] = [{ kind: "positive", px: metadata.clickPx }];
  for (const seed of seeds) {
    const px = seed.px ?? (seed.lngLat ? lngLatToPixel(seed.lngLat, metadata.bbox, metadata.width, metadata.height) : null);
    if (!px) continue;
    if (px[0] < -2 || px[1] < -2 || px[0] > metadata.width + 2 || px[1] > metadata.height + 2) continue;
    out.push({ kind: seed.kind, px: [clamp(px[0], 0, metadata.width - 1), clamp(px[1], 0, metadata.height - 1)] });
  }
  return out;
}

function buildParcelMask(width: number, height: number, parcelPx?: PixelRing | null): Uint8Array | undefined {
  if (!parcelPx || parcelPx.length < 3) return undefined;
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pointInOrOnPoly(x + 0.5, y + 0.5, parcelPx)) mask[y * width + x] = 1;
    }
  }
  return mask;
}

function buildNegativeSeedMask(width: number, height: number, seeds: PixelSeed[], radius: number): Uint8Array {
  const negative = new Uint8Array(width * height);
  const radiusSq = radius * radius;
  for (const seed of seeds) {
    if (seed.kind !== "negative") continue;
    const sx = Math.round(seed.px[0]);
    const sy = Math.round(seed.px[1]);
    const x0 = clamp(sx - radius, 0, width - 1);
    const x1 = clamp(sx + radius, 0, width - 1);
    const y0 = clamp(sy - radius, 0, height - 1);
    const y1 = clamp(sy + radius, 0, height - 1);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if ((x - sx) ** 2 + (y - sy) ** 2 <= radiusSq) negative[y * width + x] = 1;
      }
    }
  }
  return negative;
}

function sampleSeedModel(imageData: ImageData, seeds: PixelSeed[]) {
  const { width, height, data } = imageData;
  const samples: Array<[number, number, number, number]> = [];
  for (const seed of seeds) {
    if (seed.kind !== "positive") continue;
    const sx = Math.round(seed.px[0]);
    const sy = Math.round(seed.px[1]);
    for (let dy = -5; dy <= 5; dy++) {
      for (let dx = -5; dx <= 5; dx++) {
        if (dx * dx + dy * dy > 25) continue;
        const x = sx + dx;
        const y = sy + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const i = (y * width + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const sum = r + g + b + 1;
        const exg = (2 * g - r - b) / 255;
        samples.push([r / sum, g / sum, b / sum, exg]);
      }
    }
  }

  if (!samples.length) return { mean: [0.32, 0.39, 0.29, 0.12], sigma: 0.08 };
  const mean = [0, 0, 0, 0];
  for (const sample of samples) {
    for (let i = 0; i < 4; i++) mean[i] += sample[i];
  }
  for (let i = 0; i < 4; i++) mean[i] /= samples.length;
  let variance = 0;
  for (const sample of samples) {
    variance += sample.reduce((acc, value, i) => acc + (value - mean[i]) ** 2, 0);
  }
  variance /= Math.max(1, samples.length * 4);
  return { mean, sigma: clamp(Math.sqrt(variance) * 2.7 + 0.035, 0.05, 0.16) };
}

function buildFeatureMaps(
  imageData: ImageData,
  metadata: LawnCropMetadata,
  seeds: PixelSeed[],
  options: SegmentationOptions,
): FeatureMaps {
  const { width, height, data } = imageData;
  const n = width * height;
  const grass = new Float32Array(n);
  const hardscape = new Float32Array(n);
  const edge = new Float32Array(n);
  const texture = new Float32Array(n);
  const luminance = new Float32Array(n);
  const seedSimilarity = new Float32Array(n);
  const parcel = buildParcelMask(width, height, metadata.parcelPx);
  const negative = buildNegativeSeedMask(width, height, seeds, options.highPrecision ? 13 : 16);
  const seedModel = sampleSeedModel(imageData, seeds);

  const exg = new Float32Array(n);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      const i = p * 4;
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const [hue, sat, value] = colorToHsv(r, g, b);
      const sum = r + g + b + 1;
      const rn = r / sum;
      const gn = g / sum;
      const bn = b / sum;
      const exGreen = (2 * g - r - b) / 255;
      const ngrdi = (g - r) / (g + r + 1);
      exg[p] = exGreen;
      luminance[p] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

      const hueGrass = hue >= 35 && hue <= 175 ? 1 : smoothstep(15, 35, hue) * (1 - smoothstep(175, 220, hue));
      const vegetation = 0.52 * sigmoid((exGreen - 0.03) * 8.5) + 0.28 * sigmoid((ngrdi - 0.02) * 8) + 0.2 * sigmoid((gn - rn) * 18);
      const saturationScore = smoothstep(0.035, 0.24, sat);
      const greenDominance = sigmoid((g - Math.max(r, b) - 2) * 0.08);
      const seedDist = Math.sqrt(
        (rn - seedModel.mean[0]) ** 2
        + (gn - seedModel.mean[1]) ** 2
        + (bn - seedModel.mean[2]) ** 2
        + ((exGreen - seedModel.mean[3]) * 0.65) ** 2,
      );
      const seedScore = Math.exp(-(seedDist * seedDist) / (2 * seedModel.sigma * seedModel.sigma));
      seedSimilarity[p] = seedScore;

      const grayHard = sat < 0.12 && value > 0.34 ? smoothstep(0.34, 0.82, value) : 0;
      const roofBrown = r > g * 1.08 && r > b * 1.06 && sat > 0.16 ? smoothstep(0.16, 0.42, sat) : 0;
      const blueWater = b > g + 8 && b > r + 10 && hue >= 175 && hue <= 255 ? smoothstep(0.12, 0.42, sat) : 0;
      const veryDark = value < 0.13 && sat < 0.32 ? 0.6 : 0;
      const brightConcrete = sat < 0.08 && value > 0.58 ? 0.85 : 0;
      const hard = clamp(Math.max(grayHard, roofBrown * 0.82, blueWater, veryDark, brightConcrete), 0, 1);
      hardscape[p] = hard;

      grass[p] = clamp(
        0.22 * hueGrass
        + 0.32 * vegetation
        + 0.14 * saturationScore
        + 0.18 * greenDominance
        + 0.26 * seedScore
        - 0.48 * hard,
        0,
        1,
      );
    }
  }

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const p = y * width + x;
      const ldx = luminance[p + 1] - luminance[p - 1];
      const ldy = luminance[p + width] - luminance[p - width];
      const gdx = exg[p + 1] - exg[p - 1];
      const gdy = exg[p + width] - exg[p - width];
      edge[p] = clamp(Math.hypot(ldx + gdx * 0.55, ldy + gdy * 0.55), 0, 1);
    }
  }

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const p = y * width + x;
      let meanLum = 0;
      let meanExg = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const np = (y + dy) * width + x + dx;
          meanLum += luminance[np];
          meanExg += exg[np];
        }
      }
      meanLum /= 9;
      meanExg /= 9;
      let variance = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const np = (y + dy) * width + x + dx;
          variance += (luminance[np] - meanLum) ** 2 + ((exg[np] - meanExg) * 0.85) ** 2;
        }
      }
      texture[p] = clamp(Math.sqrt(variance / 9) * 3.2 + edge[p] * 0.35, 0, 1);
    }
  }

  for (let p = 0; p < n; p++) {
    const roughVegetation = texture[p] > 0.14;
    const deepShadowDifferent = luminance[p] < 0.26 && seedSimilarity[p] < 0.48;
    const texturePenalty = roughVegetation
      ? smoothstep(0.12, 0.34, texture[p]) * (seedSimilarity[p] > 0.74 ? 0.2 : 0.36)
      : texture[p] * 0.08;
    const shadowPenalty = deepShadowDifferent ? smoothstep(0.28, 0.12, luminance[p]) * 0.2 : 0;
    grass[p] = clamp(grass[p] - texturePenalty - shadowPenalty, 0, 1);
    if (texture[p] > 0.22 && seedSimilarity[p] < 0.82) hardscape[p] = Math.max(hardscape[p], 0.52);
  }

  return { grass, hardscape, edge, texture, luminance, seedSimilarity, negative, parcel };
}

function keepComponentContainingSeeds(mask: Uint8Array, width: number, height: number, seeds: PixelSeed[]): Uint8Array {
  const out = new Uint8Array(width * height);
  const queue: number[] = [];
  for (const seed of seeds) {
    if (seed.kind !== "positive") continue;
    const x = Math.round(seed.px[0]);
    const y = Math.round(seed.px[1]);
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const p = y * width + x;
    if (!mask[p] || out[p]) continue;
    out[p] = 1;
    queue.push(p);
  }

  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi];
    const x = p % width;
    const y = Math.floor(p / width);
    for (const [dx, dy] of NEIGHBORS_8) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const np = ny * width + nx;
      if (mask[np] && !out[np]) {
        out[np] = 1;
        queue.push(np);
      }
    }
  }
  return out;
}

function growMask(maps: FeatureMaps, metadata: LawnCropMetadata, seeds: PixelSeed[], options: SegmentationOptions) {
  const { width, height } = metadata;
  const start = metadata.clickPx;
  const startIdx = Math.round(clamp(start[1], 0, height - 1)) * width + Math.round(clamp(start[0], 0, width - 1));
  const startScore = maps.grass[startIdx] || 0;
  const strongClick = startScore >= 0.55;
  const threshold = strongClick
    ? (options.highPrecision ? 0.52 : 0.48)
    : clamp(startScore * 0.72, options.highPrecision ? 0.36 : 0.32, options.highPrecision ? 0.52 : 0.48);
  const softThreshold = Math.max(options.highPrecision ? 0.31 : 0.28, threshold - (options.highPrecision ? 0.04 : 0.06));
  const strongEdge = options.highPrecision ? 0.08 : 0.1;
  const seedFloor = options.highPrecision ? 0.24 : 0.17;
  const mask = new Uint8Array(width * height);
  const visited = new Uint8Array(width * height);
  const queue: number[] = [];

  const trySeed = (seed: PixelSeed) => {
    if (seed.kind !== "positive") return;
    const x = Math.round(seed.px[0]);
    const y = Math.round(seed.px[1]);
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x;
    if (maps.negative[p] || (maps.parcel && !maps.parcel[p])) return;
    if (maps.grass[p] < 0.18 || maps.hardscape[p] > 0.82) return;
    visited[p] = 1;
    mask[p] = 1;
    queue.push(p);
  };
  seeds.forEach(trySeed);

  for (let qi = 0; qi < queue.length; qi++) {
    const p = queue[qi];
    const x = p % width;
    const y = Math.floor(p / width);
    for (const [dx, dy] of NEIGHBORS_8) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const np = ny * width + nx;
      if (visited[np]) continue;
      visited[np] = 1;
      if (maps.negative[np]) continue;
      if (maps.parcel && !maps.parcel[np]) continue;
      if (maps.hardscape[np] > (options.highPrecision ? 0.58 : 0.64)) continue;
      if (maps.texture[np] > (options.highPrecision ? 0.18 : 0.22) && maps.seedSimilarity[np] < 0.78) continue;
      if (maps.edge[np] > strongEdge && maps.seedSimilarity[np] < 0.82 && maps.grass[np] < threshold + 0.28) continue;
      if (maps.seedSimilarity[np] < seedFloor && maps.grass[np] < threshold + 0.16) continue;
      if (maps.grass[np] >= threshold || (maps.grass[np] >= softThreshold && maps.seedSimilarity[np] >= 0.58)) {
        mask[np] = 1;
        queue.push(np);
      }
    }
  }

  return { mask, threshold };
}

function dilate(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const p = y * width + x;
      if (mask[p]) continue;
      for (const [dx, dy] of NEIGHBORS_8) {
        if (mask[(y + dy) * width + x + dx]) {
          out[p] = 1;
          break;
        }
      }
    }
  }
  return out;
}

function erode(mask: Uint8Array, width: number, height: number): Uint8Array {
  const out = new Uint8Array(mask);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const p = y * width + x;
      if (!mask[p]) continue;
      for (const [dx, dy] of NEIGHBORS_8) {
        if (!mask[(y + dy) * width + x + dx]) {
          out[p] = 0;
          break;
        }
      }
    }
  }
  return out;
}

function smoothMask(mask: Uint8Array, width: number, height: number, seeds: PixelSeed[], highPrecision = false) {
  let out = mask;
  out = erode(out, width, height);
  out = dilate(out, width, height);
  if (!highPrecision) out = dilate(out, width, height);
  out = erode(out, width, height);
  out = keepComponentContainingSeeds(out, width, height, seeds);
  return out;
}

function constrainMask(
  mask: Uint8Array,
  maps: FeatureMaps,
  metadata: LawnCropMetadata,
  threshold: number,
  seeds: PixelSeed[],
  options: SegmentationOptions,
): Uint8Array {
  const out = new Uint8Array(mask);
  for (let i = 0; i < out.length; i++) {
    if (!out[i]) continue;
    if (maps.negative[i]) out[i] = 0;
    else if (maps.parcel && !maps.parcel[i]) out[i] = 0;
    else if (maps.hardscape[i] > (options.highPrecision ? 0.56 : 0.62)) out[i] = 0;
    else if (maps.texture[i] > (options.highPrecision ? 0.2 : 0.25) && maps.seedSimilarity[i] < 0.76) out[i] = 0;
    else if (maps.grass[i] < threshold - 0.05 && maps.seedSimilarity[i] < 0.68) out[i] = 0;
  }
  return keepComponentContainingSeeds(out, metadata.width, metadata.height, seeds);
}

function buildContours(mask: Uint8Array, width: number, height: number): PixelRing[] {
  const next = new Map<string, string[]>();
  const segments: Array<[string, string]> = [];
  const addSegment = (a: PixelPoint, b: PixelPoint) => {
    const ak = `${a[0]},${a[1]}`;
    const bk = `${b[0]},${b[1]}`;
    segments.push([ak, bk]);
    const list = next.get(ak);
    if (list) list.push(bk);
    else next.set(ak, [bk]);
  };
  const isOn = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && mask[y * width + x] === 1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isOn(x, y)) continue;
      if (!isOn(x, y - 1)) addSegment([x, y], [x + 1, y]);
      if (!isOn(x + 1, y)) addSegment([x + 1, y], [x + 1, y + 1]);
      if (!isOn(x, y + 1)) addSegment([x + 1, y + 1], [x, y + 1]);
      if (!isOn(x - 1, y)) addSegment([x, y + 1], [x, y]);
    }
  }

  const used = new Set<string>();
  const contours: PixelRing[] = [];
  for (const [start, end] of segments) {
    const segmentKey = `${start}>${end}`;
    if (used.has(segmentKey)) continue;
    const ringKeys = [start];
    let curStart = start;
    let curEnd = end;
    let guard = 0;
    while (guard++ < segments.length + 4) {
      used.add(`${curStart}>${curEnd}`);
      ringKeys.push(curEnd);
      if (curEnd === start) break;
      const candidates = next.get(curEnd) ?? [];
      const candidate = candidates.find((c) => !used.has(`${curEnd}>${c}`));
      if (!candidate) break;
      curStart = curEnd;
      curEnd = candidate;
    }
    if (ringKeys.length >= 4 && ringKeys[ringKeys.length - 1] === start) {
      const ring = ringKeys.slice(0, -1).map((key) => key.split(",").map(Number) as PixelPoint);
      if (Math.abs(signedAreaPx(ring)) >= 4) contours.push(ring);
    }
  }
  return contours;
}

function perpendicularDistance(p: PixelPoint, a: PixelPoint, b: PixelPoint): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  return Math.abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / Math.hypot(dx, dy);
}

function rdp(points: PixelRing, epsilon: number): PixelRing {
  if (points.length <= 2) return points;
  let maxDist = 0;
  let index = 0;
  const last = points.length - 1;
  for (let i = 1; i < last; i++) {
    const d = perpendicularDistance(points[i], points[0], points[last]);
    if (d > maxDist) {
      index = i;
      maxDist = d;
    }
  }
  if (maxDist > epsilon) {
    const left = rdp(points.slice(0, index + 1), epsilon);
    const right = rdp(points.slice(index), epsilon);
    return [...left.slice(0, -1), ...right];
  }
  return [points[0], points[last]];
}

function simplifyClosedRing(ring: PixelRing, epsilon: number): PixelRing {
  if (ring.length <= 4) return ring;
  let anchor = 0;
  for (let i = 1; i < ring.length; i++) {
    if (ring[i][0] < ring[anchor][0] || (ring[i][0] === ring[anchor][0] && ring[i][1] < ring[anchor][1])) anchor = i;
  }
  const rotated = [...ring.slice(anchor), ...ring.slice(0, anchor), ring[anchor]];
  const simplified = rdp(rotated, epsilon).slice(0, -1);
  return simplified.length >= 4 ? simplified : ring;
}

function snapRingToEdges(ring: PixelRing, edge: Float32Array, width: number, height: number, radius: number): PixelRing {
  return ring.map(([x, y]) => {
    let best: PixelPoint = [x, y];
    let bestScore = 0;
    const cx = Math.round(x);
    const cy = Math.round(y);
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx > width || ny > height) continue;
        const px = clamp(nx, 0, width - 1);
        const py = clamp(ny, 0, height - 1);
        const score = edge[py * width + px] - 0.015 * Math.hypot(dx, dy);
        if (score > bestScore) {
          bestScore = score;
          best = [nx, ny];
        }
      }
    }
    return best;
  });
}

function createMaskPreview(mask: Uint8Array, width: number, height: number): string | undefined {
  if (typeof document === "undefined") return undefined;
  try {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    const image = ctx.createImageData(width, height);
    for (let i = 0; i < mask.length; i++) {
      if (!mask[i]) continue;
      const j = i * 4;
      image.data[j] = 83;
      image.data[j + 1] = 168;
      image.data[j + 2] = 94;
      image.data[j + 3] = 120;
    }
    ctx.putImageData(image, 0, 0);
    return canvas.toDataURL("image/png");
  } catch {
    return undefined;
  }
}

function decodeImageBase64(imageBase64: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = image.naturalWidth || image.width;
        canvas.height = image.naturalHeight || image.height;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) throw new Error("Canvas unavailable");
        ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
        resolve(ctx.getImageData(0, 0, canvas.width, canvas.height));
      } catch (e) {
        reject(e);
      }
    };
    image.onerror = () => reject(new Error("Could not decode lawn crop image"));
    image.src = imageBase64.startsWith("data:") ? imageBase64 : `data:image/jpeg;base64,${imageBase64}`;
  });
}

function emptyResult(metadata: LawnCropMetadata, threshold = 0, warnings: string[] = ["no_connected_lawn_component"]): LawnSegmentationResult {
  return {
    polygon: [],
    exclusions: [],
    confidence: 0,
    needsReview: true,
    diagnostics: {
      algorithmVersion: LAWN_SEGMENTATION_VERSION,
      maskAreaPx: 0,
      areaM2: 0,
      threshold,
      meanGrassScore: 0,
      hardscapeLeakage: 1,
      edgeSupport: 0,
      contourPoints: 0,
      simplifiedPoints: 0,
      imagerySource: metadata.imagerySource,
      warnings,
    },
  };
}

export function segmentLawnImageData(
  imageData: ImageData,
  crop: Omit<LawnCropMetadata, "width" | "height"> & Partial<Pick<LawnCropMetadata, "width" | "height">>,
  seeds: SegmentationSeed[] = [],
  options: SegmentationOptions = {},
): LawnSegmentationResult {
  const metadata: LawnCropMetadata = {
    ...crop,
    width: imageData.width,
    height: imageData.height,
  };
  const pixelSeeds = normalizeSeeds(seeds, metadata);
  const maps = buildFeatureMaps(imageData, metadata, pixelSeeds, options);
  const grown = growMask(maps, metadata, pixelSeeds, options);
  const smoothedMask = smoothMask(grown.mask, metadata.width, metadata.height, pixelSeeds, !!options.highPrecision);
  const mask = constrainMask(smoothedMask, maps, metadata, grown.threshold, pixelSeeds, options);
  let maskAreaPx = 0;
  let grassSum = 0;
  let hardSum = 0;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    maskAreaPx++;
    grassSum += maps.grass[i];
    hardSum += maps.hardscape[i];
  }
  if (maskAreaPx < Math.max(64, 5 / Math.max(0.01, metadata.metersPerPx ** 2))) {
    return emptyResult(metadata, grown.threshold, ["mask_too_small"]);
  }

  const contours = buildContours(mask, metadata.width, metadata.height);
  if (!contours.length) return emptyResult(metadata, grown.threshold);

  const positiveContours = contours
    .filter((ring) => signedAreaPx(ring) > 0)
    .sort((a, b) => Math.abs(signedAreaPx(b)) - Math.abs(signedAreaPx(a)));
  if (!positiveContours.length) return emptyResult(metadata, grown.threshold, ["outer_contour_missing"]);

  const outerRaw = positiveContours[0];
  const outerArea = Math.abs(signedAreaPx(outerRaw));
  const simplifyPx = clamp((options.highPrecision ? 0.28 : 0.45) / Math.max(0.035, metadata.metersPerPx), 1.4, options.highPrecision ? 4 : 7);
  let outer = simplifyClosedRing(outerRaw, simplifyPx);
  outer = snapRingToEdges(outer, maps.edge, metadata.width, metadata.height, options.highPrecision ? 2 : 3);
  outer = simplifyClosedRing(outer, Math.max(1.1, simplifyPx * 0.45));

  const holes = contours
    .filter((ring) => signedAreaPx(ring) < 0 && Math.abs(signedAreaPx(ring)) > Math.max(48, outerArea * 0.006))
    .sort((a, b) => Math.abs(signedAreaPx(b)) - Math.abs(signedAreaPx(a)))
    .slice(0, 8)
    .map((ring) => simplifyClosedRing(ring.reverse(), simplifyPx))
    .filter((ring) => ring.length >= 4 && Math.abs(signedAreaPx(ring)) * metadata.metersPerPx ** 2 >= 1.5);

  const warnings: string[] = [];
  const click = metadata.clickPx;
  if (!pointInOrOnPoly(click[0], click[1], outer)) warnings.push("click_outside_polygon");
  if (hasSelfIntersection(outer)) warnings.push("self_intersection");
  if (outer.length < 4) warnings.push("too_few_vertices");
  if (metadata.parcelPx?.length && outer.some(([x, y]) => !pointInOrOnPoly(x, y, metadata.parcelPx!))) warnings.push("parcel_leak");
  const cropLeak = outer.some(([x, y]) => x <= 1 || y <= 1 || x >= metadata.width - 1 || y >= metadata.height - 1);
  if (cropLeak) warnings.push("touches_crop_edge");

  const meanGrassScore = grassSum / Math.max(1, maskAreaPx);
  const hardscapeLeakage = hardSum / Math.max(1, maskAreaPx);
  let edgeSamples = 0;
  let edgeSum = 0;
  for (const [x, y] of outer) {
    const px = clamp(Math.round(x), 0, metadata.width - 1);
    const py = clamp(Math.round(y), 0, metadata.height - 1);
    edgeSamples++;
    edgeSum += maps.edge[py * metadata.width + px];
  }
  const edgeSupport = edgeSum / Math.max(1, edgeSamples);
  if (hardscapeLeakage > 0.12) warnings.push("hardscape_heavy_mask");

  const areaM2 = maskAreaPx * metadata.metersPerPx ** 2;
  if (areaM2 < 5) warnings.push("area_too_small");
  if (areaM2 > 5000) warnings.push("area_too_large");

  let confidence = 0.25
    + meanGrassScore * 0.42
    + clamp(edgeSupport * 2.2, 0, 0.22)
    - hardscapeLeakage * 0.45
    - (cropLeak ? 0.14 : 0)
    - (warnings.includes("click_outside_polygon") ? 0.3 : 0)
    - (warnings.includes("self_intersection") ? 0.4 : 0);
  if (metadata.imagerySource === "mapbox") confidence -= 0.05;
  const blockingWarnings = new Set(["self_intersection", "area_too_small", "area_too_large", "click_outside_polygon", "parcel_leak", "hardscape_heavy_mask"]);
  const hasBlockingWarning = warnings.some((warning) => blockingWarnings.has(warning));
  if (options.highPrecision && !hasBlockingWarning && outer.length >= 4) {
    confidence = Math.max(confidence, 0.4);
  }
  confidence = clamp(confidence, 0, 0.98);

  const needsReview = confidence < 0.74 || warnings.length > 0;
  const polygon = outer.map((point) => pixelToLngLat(point, metadata.bbox, metadata.width, metadata.height));
  const exclusions = holes.map((ring) => ring.map((point) => pixelToLngLat(point, metadata.bbox, metadata.width, metadata.height)));

  return {
    polygon,
    exclusions,
    confidence,
    maskPreview: options.createMaskPreview === false ? undefined : createMaskPreview(mask, metadata.width, metadata.height),
    needsReview,
    diagnostics: {
      algorithmVersion: options.algorithmVersion ?? LAWN_SEGMENTATION_VERSION,
      maskAreaPx,
      areaM2,
      threshold: grown.threshold,
      meanGrassScore,
      hardscapeLeakage,
      edgeSupport,
      contourPoints: outerRaw.length,
      simplifiedPoints: outer.length,
      imagerySource: metadata.imagerySource,
      warnings,
    },
  };
}

export async function segmentLawnFromCrop(
  crop: LawnCropPayload,
  seeds: SegmentationSeed[] = [],
  options: SegmentationOptions = {},
): Promise<LawnSegmentationResult> {
  const imageData = await decodeImageBase64(crop.imageBase64);
  return segmentLawnImageData(imageData, {
    bbox: crop.bbox,
    clickPx: crop.clickPx,
    metersPerPx: crop.metersPerPx,
    parcelPx: crop.parcelPx,
    imagerySource: crop.imagerySource,
    diagnostics: crop.diagnostics,
  }, seeds, options);
}

function hashString(input: string): string {
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h) ^ input.charCodeAt(i);
  return (h >>> 0).toString(36);
}

export function buildSegmentationCacheKey(crop: LawnCropPayload, seeds: SegmentationSeed[], version = LAWN_SEGMENTATION_VERSION): string {
  const seedKey = seeds.map((seed) => ({
    kind: seed.kind,
    px: seed.px ? seed.px.map((n) => Math.round(n)) : undefined,
    lngLat: seed.lngLat ? seed.lngLat.map((n) => Number(n.toFixed(7))) : undefined,
  }));
  const imageHash = hashString(crop.imageBase64.slice(0, 256) + crop.imageBase64.slice(-256));
  return `havemaaler:lawn-cache:${version}:${hashString(JSON.stringify({
    imageHash,
    bbox: crop.bbox.map((n) => Number(n.toFixed(8))),
    clickPx: crop.clickPx.map((n) => Math.round(n)),
    seeds: seedKey,
  }))}`;
}

export function readAcceptedSegmentationCache(key: string): LawnSegmentationResult | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed?.polygon) || typeof parsed?.confidence !== "number") return null;
    return parsed as LawnSegmentationResult;
  } catch {
    return null;
  }
}

export function writeAcceptedSegmentationCache(key: string, result: LawnSegmentationResult) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify({ ...result, maskPreview: undefined, cachedAt: Date.now() }));
  } catch {
    // Accepted polygons are a speed-up only. Storage quota must never block measuring.
  }
}
