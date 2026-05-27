import { describe, expect, it } from "vitest";
import {
  exclusionRingsFromJson,
  gardenGeometryFingerprint,
  polygonForRings,
  ringsFromGeoJson,
  serializeExclusions,
  type Ring,
} from "@/lib/havemaalerGeometry";

const lawnA: Ring = [
  [12, 55],
  [12.001, 55],
  [12.001, 55.001],
  [12, 55.001],
];

const lawnB: Ring = [
  [12.002, 55],
  [12.003, 55],
  [12.003, 55.001],
  [12.002, 55.001],
];

describe("havemaalerGeometry", () => {
  it("parses Polygon and MultiPolygon rings without duplicate closing points", () => {
    const polygon = { type: "Polygon", coordinates: [[...lawnA, lawnA[0]]] };
    const multi = { type: "MultiPolygon", coordinates: [[[...lawnA, lawnA[0]]], [[...lawnB, lawnB[0]]]] };

    expect(ringsFromGeoJson(polygon)).toEqual([lawnA]);
    expect(ringsFromGeoJson(multi)).toEqual([lawnA, lawnB]);
  });

  it("serializes multiple lawns and exclusions as GeoJSON", () => {
    expect(polygonForRings([lawnA]).type).toBe("Polygon");
    expect(polygonForRings([lawnA, lawnB]).type).toBe("MultiPolygon");
    expect(serializeExclusions([lawnB])).toEqual([{ type: "Polygon", coordinates: [[...lawnB, lawnB[0]]] }]);
    expect(exclusionRingsFromJson(serializeExclusions([lawnB]))).toEqual([lawnB]);
  });

  it("changes geometry fingerprint when measured geometry changes", () => {
    const base = gardenGeometryFingerprint({
      name: "Have",
      center: [12, 55],
      lawns: [lawnA],
      exclusions: [],
      matrikel: null,
      imagery: "ortofoto",
      areaM2: 100,
    });
    const edited = gardenGeometryFingerprint({
      name: "Have",
      center: [12, 55],
      lawns: [[...lawnA, [12.0005, 55.0012]]],
      exclusions: [],
      matrikel: null,
      imagery: "ortofoto",
      areaM2: 101,
    });

    expect(edited).not.toEqual(base);
  });
});
