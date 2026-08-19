import { describe, expect, it } from "vitest";
import * as turf from "@turf/turf";
import {
  OBJECT_SPECS,
  clampHeight,
  createLinearObject,
  createPlacedObject,
  makeFootprint,
  metersBetween,
  nudgeObject,
  placedFromSuggestion,
  placedObjectFootprint,
  segmentRotationDeg,
  suggestionsFromDetections,
  updatePlacedObject,
} from "@/lib/gardenBuilder";
import type { DetectedObject } from "@/lib/gardenElevation";
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

  it("marks hedges, fences and walls as line-placed", () => {
    expect(OBJECT_SPECS.hedge.placement).toBe("line");
    expect(OBJECT_SPECS.fence.placement).toBe("line");
    expect(OBJECT_SPECS.retaining_wall.placement).toBe("line");
    expect(OBJECT_SPECS.tree.placement).toBe("point");
  });

  it("creates linear objects with length and rotation from the drawn segment", () => {
    const start: LngLat = [12.0, 55.0];
    const eastM = 10 / (111_320 * Math.cos((55 * Math.PI) / 180));
    const eastEnd: LngLat = [12.0 + eastM, 55.0];
    const hedge = createLinearObject("hedge", start, eastEnd);
    expect(hedge.widthM).toBeCloseTo(10, 1);
    expect(hedge.rotationDeg).toBe(0);
    expect(hedge.depthM).toBe(OBJECT_SPECS.hedge.depthM);
    expect(hedge.center[0]).toBeCloseTo((start[0] + eastEnd[0]) / 2, 9);

    const northEnd: LngLat = [12.0, 55.0 + 10 / 111_320];
    const fence = createLinearObject("fence", start, northEnd);
    expect(fence.rotationDeg).toBe(90);
    expect(fence.widthM).toBeCloseTo(10, 1);

    expect(segmentRotationDeg(start, eastEnd)).toBeCloseTo(0, 3);
    expect(segmentRotationDeg(eastEnd, start)).toBeCloseTo(0, 3); // normalized to [0, 180)
  });

  it("nudges objects by metre offsets", () => {
    const tree = createPlacedObject("tree", center);
    const moved = nudgeObject(tree, 2, -3);
    expect(metersBetween(tree.center, moved.center)).toBeCloseTo(Math.hypot(2, 3), 1);
  });
});

describe("detection suggestions", () => {
  const nearbyM = (origin: LngLat, dxM: number): LngLat => [origin[0] + dxM / (111_320 * Math.cos((origin[1] * Math.PI) / 180)), origin[1]];

  it("skips detections that overlap placed objects, pending suggestions or dismissed spots", () => {
    const existing = createPlacedObject("tree", center);
    const dismissed = nearbyM(center, 30);
    const detections: DetectedObject[] = [
      { type: "tree", center: nearbyM(center, 0.5), widthM: 4, depthM: 4, heightM: 6, confidence: 0.8 }, // on the existing tree
      { type: "tree", center: nearbyM(center, 30.4), widthM: 4, depthM: 4, heightM: 6, confidence: 0.8 }, // dismissed spot
      { type: "hedge", center: nearbyM(center, 12), widthM: 6, depthM: 0.7, heightM: 1.8, rotationDeg: 40, confidence: 0.74 },
    ];
    const fresh = suggestionsFromDetections(detections, [existing], [], [dismissed]);
    expect(fresh).toHaveLength(1);
    expect(fresh[0].type).toBe("hedge");
    expect(fresh[0].rotationDeg).toBe(40);
    const again = suggestionsFromDetections(detections, [existing], fresh, [dismissed]);
    expect(again).toHaveLength(0); // pending suggestion blocks a re-find
  });

  it("accepted suggestions become DHM-measured placed objects", () => {
    const [suggestion] = suggestionsFromDetections(
      [{ type: "hedge", center, widthM: 7.5, depthM: 0.7, heightM: 1.9, rotationDeg: 130, confidence: 0.74 }],
      [], [], [],
    );
    const placed = placedFromSuggestion(suggestion);
    expect(placed.type).toBe("hedge");
    expect(placed.widthM).toBe(7.5);
    expect(placed.rotationDeg).toBe(130);
    expect(placed.heightM).toBeCloseTo(1.9, 5);
    expect(placed.heightSource).toBe("dhm_measured");
    expect(placed.confidence).toBe(0.74);
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
