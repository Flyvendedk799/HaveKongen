import { describe, expect, it } from "vitest";
import {
  buildSegmentationCacheKey,
  lngLatToPixel,
  pixelToLngLat,
  segmentLawnImageData,
  type LawnCropPayload,
  type LngLat,
  type PixelPoint,
} from "@/lib/lawnSegmentation";

function makeImageData(width: number, height: number, fill: [number, number, number]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4] = fill[0];
    data[i * 4 + 1] = fill[1];
    data[i * 4 + 2] = fill[2];
    data[i * 4 + 3] = 255;
  }
  return { data, width, height, colorSpace: "srgb" } as ImageData;
}

function rect(image: ImageData, x0: number, y0: number, x1: number, y1: number, color: [number, number, number]) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * image.width + x) * 4;
      image.data[i] = color[0];
      image.data[i + 1] = color[1];
      image.data[i + 2] = color[2];
      image.data[i + 3] = 255;
    }
  }
}

function circle(image: ImageData, cx: number, cy: number, radius: number, color: [number, number, number]) {
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      if (x < 0 || y < 0 || x >= image.width || y >= image.height) continue;
      if ((x - cx) ** 2 + (y - cy) ** 2 > radius ** 2) continue;
      const i = (y * image.width + x) * 4;
      image.data[i] = color[0];
      image.data[i + 1] = color[1];
      image.data[i + 2] = color[2];
      image.data[i + 3] = 255;
    }
  }
}

function pointInRing(point: LngLat, ring: LngLat[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersect = ((yi > point[1]) !== (yj > point[1]))
      && point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi + 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function crop(clickPx: PixelPoint, parcelPx?: PixelPoint[]): Omit<LawnCropPayload, "imageBase64"> {
  return {
    bbox: [0, 0, 96, 96],
    clickPx,
    metersPerPx: 0.1,
    parcelPx,
    imagerySource: "dataforsyningen",
    diagnostics: {},
  };
}

describe("lawnSegmentation", () => {
  it("extracts the connected lawn component from the clicked grass", () => {
    const image = makeImageData(96, 96, [156, 156, 150]);
    rect(image, 16, 16, 74, 80, [70, 136, 68]);
    rect(image, 74, 16, 94, 80, [160, 160, 154]);
    rect(image, 45, 58, 74, 80, [145, 142, 132]);

    const result = segmentLawnImageData(image, crop([30, 40]), [], { createMaskPreview: false });
    expect(result.polygon.length).toBeGreaterThanOrEqual(4);
    expect(result.confidence).toBeGreaterThan(0.55);
    expect(pointInRing(pixelToLngLat([30, 40], [0, 0, 96, 96], 96, 96), result.polygon)).toBe(true);
    expect(pointInRing(pixelToLngLat([84, 40], [0, 0, 96, 96], 96, 96), result.polygon)).toBe(false);
    expect(result.diagnostics.hardscapeLeakage).toBeLessThan(0.2);
  });

  it("turns negative refinement clicks into remove constraints", () => {
    const image = makeImageData(96, 96, [155, 155, 150]);
    rect(image, 12, 12, 84, 84, [73, 135, 66]);

    const loose = segmentLawnImageData(image, crop([30, 40]), [], { createMaskPreview: false });
    const refined = segmentLawnImageData(image, crop([30, 40]), [{ kind: "negative", px: [70, 70] }], { createMaskPreview: false });
    const removed = pixelToLngLat([70, 70], [0, 0, 96, 96], 96, 96);

    expect(pointInRing(removed, loose.polygon)).toBe(true);
    expect(
      !pointInRing(removed, refined.polygon)
        || refined.exclusions.some((ring) => pointInRing(removed, ring)),
    ).toBe(true);
  });

  it("clips growth to parcel pixels when available", () => {
    const image = makeImageData(96, 96, [70, 136, 68]);
    const parcel: PixelPoint[] = [[8, 8], [54, 8], [54, 88], [8, 88]];
    const result = segmentLawnImageData(image, crop([30, 40], parcel), [], { createMaskPreview: false });

    expect(result.polygon.length).toBeGreaterThanOrEqual(4);
    expect(pointInRing(pixelToLngLat([72, 40], [0, 0, 96, 96], 96, 96), result.polygon)).toBe(false);
  });

  it("does not cross a visible hedge or shadow barrier into neighboring grass", () => {
    const image = makeImageData(96, 96, [150, 150, 145]);
    rect(image, 12, 12, 84, 44, [72, 136, 68]);
    rect(image, 12, 48, 84, 84, [72, 136, 68]);
    rect(image, 12, 44, 84, 48, [55, 72, 48]);

    const result = segmentLawnImageData(image, crop([30, 30]), [], { createMaskPreview: false });
    expect(result.polygon.length).toBeGreaterThanOrEqual(4);
    expect(pointInRing(pixelToLngLat([30, 70], [0, 0, 96, 96], 96, 96), result.polygon)).toBe(false);
  });

  it("keeps coordinate conversion stable", () => {
    const bbox: [number, number, number, number] = [12, 56, 12.001, 56.001];
    const px = lngLatToPixel([12.0005, 56.00075], bbox, 512, 512);
    expect(px[0]).toBeCloseTo(256, 2);
    expect(px[1]).toBeCloseTo(128, 2);
    expect(pixelToLngLat(px, bbox, 512, 512)[0]).toBeCloseTo(12.0005, 6);
  });

  it("versions accepted cache keys by seed set", () => {
    const payload: LawnCropPayload = {
      ...crop([30, 40]),
      imageBase64: "abc123".repeat(200),
    };
    const plain = buildSegmentationCacheKey(payload, []);
    const refined = buildSegmentationCacheKey(payload, [{ kind: "positive", px: [33, 41] }]);
    expect(plain).not.toEqual(refined);
  });

  it("detects hardscape holes as exclusions", () => {
    const image = makeImageData(96, 96, [155, 155, 150]);
    rect(image, 12, 12, 84, 84, [73, 135, 66]);
    circle(image, 48, 48, 9, [162, 160, 154]);

    const result = segmentLawnImageData(image, crop([28, 38]), [], { createMaskPreview: false });
    expect(result.exclusions.length).toBeGreaterThanOrEqual(1);
  });
});
