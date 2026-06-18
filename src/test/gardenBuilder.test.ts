import { describe, expect, it } from "vitest";
import * as turf from "@turf/turf";
import {
  OBJECT_SPECS,
  clampHeight,
  createPlacedObject,
  makeFootprint,
  placedObjectFootprint,
  updatePlacedObject,
} from "@/lib/gardenBuilder";
import {
  buildGardenTwinModel,
  inspectGardenDepthModel,
  validateGardenDepthModel,
  depthPipelineStage,
  type GardenElevationSummary,
  type GardenObjectInput,
} from "@/lib/gardenDepth";
import type { LngLat, Ring } from "@/lib/havemaalerGeometry";

const center: LngLat = [12.0003, 55.0002];
const lawn: Ring = [
  [12.0000, 55.0000],
  [12.0006, 55.0000],
  [12.0006, 55.0004],
  [12.0000, 55.0004],
];

const elevation: GardenElevationSummary = {
  source: "dhm",
  cols: 2,
  rows: 2,
  bbox: [12.0, 55.0, 12.0006, 55.0004],
  terrain: [[10.2, 10.8], [11.6, 12.4]],
  stats: { minM: 10.2, maxM: 12.4, meanM: 11.25, reliefM: 2.2 },
  resolutionM: 1.1,
  confidence: 0.82,
};

describe("gardenBuilder geometry", () => {
  it("creates objects with type defaults and confidence by height source", () => {
    const tree = createPlacedObject("tree", center);
    expect(tree.heightM).toBe(OBJECT_SPECS.tree.heightM);
    expect(tree.heightSource).toBe("default");
    expect(tree.confidence).toBeCloseTo(0.5, 5);

    const measured = createPlacedObject("tree", center, { heightM: 9, heightSource: "dhm_measured" });
    expect(measured.confidence).toBeGreaterThan(tree.confidence);
  });

  it("builds a rectangular footprint with the requested area", () => {
    const ring = makeFootprint(center, 4, 2, 0);
    expect(ring).toHaveLength(4);
    const area = turf.area(turf.polygon([[...ring, ring[0]]]));
    expect(area).toBeGreaterThan(7);
    expect(area).toBeLessThan(9); // ~8 m²
  });

  it("marks height as user-set when patched and clamps to range", () => {
    const hedge = createPlacedObject("hedge", center);
    const taller = updatePlacedObject(hedge, { heightM: 2 });
    expect(taller.heightSource).toBe("user");
    expect(clampHeight("hedge", 99)).toBe(OBJECT_SPECS.hedge.heightRange[1]);
    expect(clampHeight("hedge", -5)).toBe(OBJECT_SPECS.hedge.heightRange[0]);
  });
});

describe("buildGardenTwinModel", () => {
  const objects: GardenObjectInput[] = [
    { type: "tree", label: "Træ", footprint: placedObjectFootprint(createPlacedObject("tree", center)), heightM: 7, confidence: 0.82, source: "elevation_model" },
    { type: "hedge", label: "Hæk", footprint: placedObjectFootprint(createPlacedObject("hedge", [12.0002, 55.0001])), heightM: 1.6, confidence: 0.7, source: "manual" },
    { type: "shed", label: "Skur", footprint: placedObjectFootprint(createPlacedObject("shed", [12.0004, 55.0003])), heightM: 2.4, confidence: 0.8, source: "elevation_model" },
  ];

  it("produces an elevation-aligned twin that validates cleanly", () => {
    const model = buildGardenTwinModel({ gardenId: "g1", name: "Testhave", center, lawnRings: [lawn], areaM2: 500, elevation, objects });
    expect(model).not.toBeNull();
    expect(model!.alignment.mode).toBe("elevation-model");
    expect(model!.terrain.elevation?.stats.reliefM).toBe(2.2);
    expect(model!.terrain.slopeHint).toBe("gentle");
    expect(model!.objects.length).toBe(3);
    expect(model!.objects.some((object) => object.source === "elevation_model")).toBe(true);
    expect(validateGardenDepthModel(model)).toEqual([]);
    expect(inspectGardenDepthModel(model).readyForSave).toBe(true);
    expect(depthPipelineStage(model)).toBe("elevation_built");
    expect(model!.quality.grade === "usable" || model!.quality.grade === "strong").toBe(true);
  });

  it("includes Part 1 exclusions as low objects and works without elevation", () => {
    const exclusion: Ring = [[12.00015, 55.00015], [12.00025, 55.00015], [12.00025, 55.00025], [12.00015, 55.00025]];
    const flat = buildGardenTwinModel({ name: "Flad", center, lawnRings: [lawn], exclusions: [exclusion], objects });
    expect(flat).not.toBeNull();
    expect(flat!.terrain.elevation).toBeFalsy();
    expect(flat!.terrain.slopeHint).toBe("unknown");
    expect(flat!.objects.some((object) => object.label === "Udeladt område")).toBe(true);
    expect(flat!.warnings).toContain("elevation_unavailable_flat_terrain");
    expect(validateGardenDepthModel(flat)).toEqual([]);
  });

  it("returns null without a lawn ring", () => {
    expect(buildGardenTwinModel({ center, lawnRings: [], objects: [] })).toBeNull();
  });
});
