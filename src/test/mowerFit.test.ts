import { describe, expect, it } from "vitest";
import {
  computeMowerProfile,
  describeProfile,
  judgeMower,
  matchMowers,
  polygonDistance,
  slopeFromElevation,
  type MowerProfile,
  type MowerSpec,
} from "@/lib/mowerFit";
import type { GardenDepthModel, LocalPoint } from "@/lib/gardenDepth";

// ------------------------------------------------------------------ helpers

/** Axis-aligned rectangle in local metres, centred on (cx, cz). */
function box(cx: number, cz: number, w: number, d: number): LocalPoint[] {
  const hw = w / 2;
  const hd = d / 2;
  return [
    { x: cx - hw, z: cz - hd },
    { x: cx + hw, z: cz - hd },
    { x: cx + hw, z: cz + hd },
    { x: cx - hw, z: cz + hd },
  ];
}

function model(over: Partial<GardenDepthModel> = {}): GardenDepthModel {
  return {
    version: 1,
    generatedAt: "2026-09-08T10:00:00Z",
    center: [12.57, 55.68],
    units: "meters",
    alignment: { mode: "elevation-model", anchorCount: 0, confidence: 0.7 },
    quality: { score: 70, grade: "usable", reasons: [], nextBestAction: "ready" },
    twin: {} as GardenDepthModel["twin"],
    captureReadiness: { minimumAnchors: 0, recommendedAnchors: 0, recommendedSeconds: [0, 0], anchorSuggestions: [] },
    terrain: {
      boundary: [],
      localBoundary: [],
      lawnRings: [],
      // A 20 × 20 m lawn = 400 m².
      localLawnRings: [box(0, 0, 20, 20)],
      areaM2: 400,
      slopeHint: "gentle",
      elevationConfidence: 0.8,
      unknownRegions: [],
      elevation: null,
    },
    objects: [],
    warnings: [],
    privacy: { rawMediaRetentionDays: 0, derivedGeometryStored: true, rawMediaUserDeletable: true },
    ...over,
  } as GardenDepthModel;
}

function obstacle(id: string, type: string, footprint: LocalPoint[]) {
  return {
    id,
    type,
    label: id,
    footprint: [],
    localFootprint: footprint,
    confidence: 0.8,
    source: "manual",
  } as unknown as GardenDepthModel["objects"][number];
}

const SPEC: MowerSpec = { maxAreaM2: 600, maxSlopePct: 35, minPassageCm: 60, zones: 1 };

const profile = (over: Partial<MowerProfile> = {}): MowerProfile => ({
  areaM2: 400,
  zoneCount: 1,
  perimeterM: 80,
  maxSlopePct: 8,
  avgSlopePct: 3,
  reliefM: 1.2,
  obstacleCount: 2,
  obstaclesByType: {},
  narrowestPassageM: 2,
  hasWater: false,
  hasLevelChange: false,
  slopeUnknown: false,
  ...over,
});

// ----------------------------------------------------------------- geometry

describe("polygonDistance", () => {
  it("measures the gap between two separated boxes", () => {
    // Edges at x=1 and x=4 → a 3 m gap.
    expect(polygonDistance(box(0, 0, 2, 2), box(5, 0, 2, 2))).toBeCloseTo(3, 5);
  });

  it("returns 0 for overlapping polygons", () => {
    expect(polygonDistance(box(0, 0, 4, 4), box(1, 1, 4, 4))).toBe(0);
  });

  it("measures diagonally between corners", () => {
    // Corners at (1,1) and (4,4) → 3√2.
    expect(polygonDistance(box(0, 0, 2, 2), box(5, 5, 2, 2))).toBeCloseTo(Math.hypot(3, 3), 5);
  });

  it("is symmetric", () => {
    const a = box(0, 0, 2, 3);
    const b = box(7, 2, 4, 2);
    expect(polygonDistance(a, b)).toBeCloseTo(polygonDistance(b, a), 6);
  });

  it("treats a degenerate polygon as infinitely far", () => {
    expect(polygonDistance([{ x: 0, z: 0 }], box(5, 5, 2, 2))).toBe(Infinity);
  });
});

// -------------------------------------------------------------------- slope

describe("slopeFromElevation", () => {
  it("returns null when there is no terrain grid", () => {
    expect(slopeFromElevation(null)).toBeNull();
    expect(slopeFromElevation({ terrain: [] } as never)).toBeNull();
  });

  it("reports a flat garden as zero", () => {
    const flat = {
      source: "dhm",
      cols: 3,
      rows: 3,
      bbox: [0, 0, 1, 1],
      terrain: [
        [10, 10, 10],
        [10, 10, 10],
        [10, 10, 10],
      ],
      stats: { minM: 10, maxM: 10, meanM: 10, reliefM: 0 },
      resolutionM: 1,
      confidence: 0.9,
    } as never;
    expect(slopeFromElevation(flat)).toEqual({ maxPct: 0, avgPct: 0, reliefM: 0 });
  });

  it("computes rise over run as a percentage", () => {
    // 0.5 m rise per 1 m cell = 50%.
    const ramp = {
      source: "dhm",
      cols: 3,
      rows: 1,
      bbox: [0, 0, 1, 1],
      terrain: [[10, 10.5, 11]],
      stats: { minM: 10, maxM: 11, meanM: 10.5, reliefM: 1 },
      resolutionM: 1,
      confidence: 0.9,
    } as never;
    const slope = slopeFromElevation(ramp);
    expect(slope?.maxPct).toBe(50);
    expect(slope?.avgPct).toBe(50);
  });

  it("scales with cell resolution", () => {
    // The same rise spread over 2 m cells is half the slope.
    const coarse = {
      source: "dhm",
      cols: 2,
      rows: 1,
      bbox: [0, 0, 1, 1],
      terrain: [[10, 11]],
      stats: { minM: 10, maxM: 11, meanM: 10.5, reliefM: 1 },
      resolutionM: 2,
      confidence: 0.9,
    } as never;
    expect(slopeFromElevation(coarse)?.maxPct).toBe(50);
  });

  it("survives a zero resolution instead of reporting infinite slope", () => {
    const broken = {
      source: "dhm",
      cols: 2,
      rows: 1,
      bbox: [0, 0, 1, 1],
      terrain: [[10, 11]],
      stats: { minM: 10, maxM: 11, meanM: 10.5, reliefM: 1 },
      resolutionM: 0,
      confidence: 0.5,
    } as never;
    expect(Number.isFinite(slopeFromElevation(broken)!.maxPct)).toBe(true);
  });
});

// ------------------------------------------------------------------ profile

describe("computeMowerProfile", () => {
  it("reads area and zone count off the lawn", () => {
    const p = computeMowerProfile(model());
    expect(p.areaM2).toBe(400);
    expect(p.zoneCount).toBe(1);
    expect(p.perimeterM).toBe(80);
  });

  it("counts separate lawn surfaces", () => {
    const p = computeMowerProfile(model({
      terrain: { ...model().terrain, localLawnRings: [box(0, 0, 10, 10), box(40, 0, 8, 8)] },
    } as never));
    expect(p.zoneCount).toBe(2);
  });

  it("counts island obstacles but not edges", () => {
    const p = computeMowerProfile(model({
      objects: [
        obstacle("t1", "tree", box(0, 0, 2, 2)),
        obstacle("b1", "bed", box(6, 0, 2, 2)),
        // A hedge is an edge the mower follows, not an island it circles.
        obstacle("h1", "hedge", box(0, 9, 12, 0.5)),
      ],
    }));
    expect(p.obstacleCount).toBe(2);
    expect(p.obstaclesByType.hedge).toBe(1);
  });

  it("finds the tightest gap between two obstacles", () => {
    const p = computeMowerProfile(model({
      objects: [
        obstacle("t1", "tree", box(0, 0, 2, 2)),
        obstacle("t2", "tree", box(3.5, 0, 2, 2)),   // 1.5 m from t1
        // Kept well clear of the lawn edge (x = ±10): a tree parked against the
        // boundary would legitimately be the tightest gap and mask this case.
        obstacle("t3", "tree", box(-5, 0, 2, 2)),    // 3 m from t1, 4 m from the edge
      ],
    }));
    expect(p.narrowestPassageM).toBeCloseTo(1.5, 2);
  });

  it("counts the gap to the lawn edge as a passage", () => {
    // Lawn spans x ∈ [-10, 10]; a tree at x=9 leaves 0.5 m to the edge.
    const p = computeMowerProfile(model({
      objects: [obstacle("t1", "tree", box(8.5, 0, 1, 1))],
    }));
    expect(p.narrowestPassageM).toBeCloseTo(1, 2);
  });

  it("ignores overlapping footprints rather than reporting a zero-width passage", () => {
    const p = computeMowerProfile(model({
      objects: [
        obstacle("t1", "tree", box(0, 0, 3, 3)),
        obstacle("t2", "tree", box(1, 0, 3, 3)), // overlaps t1
      ],
    }));
    // The only real measurement left is the distance to the lawn edge.
    expect(p.narrowestPassageM).not.toBe(0);
  });

  it("reports no passage when there is nothing to squeeze past", () => {
    expect(computeMowerProfile(model()).narrowestPassageM).toBeNull();
  });

  it("flags water and level changes", () => {
    const p = computeMowerProfile(model({
      objects: [obstacle("w", "water", box(0, 0, 3, 3)), obstacle("s", "steps", box(8, 8, 2, 1))],
    }));
    expect(p.hasWater).toBe(true);
    expect(p.hasLevelChange).toBe(true);
  });

  it("marks slope as unknown rather than flat when there is no DHM", () => {
    const p = computeMowerProfile(model());
    expect(p.slopeUnknown).toBe(true);
    expect(p.maxSlopePct).toBeNull();
  });
});

// ----------------------------------------------------------------- matching

describe("judgeMower", () => {
  it("passes a garden well inside the spec", () => {
    const { verdict } = judgeMower(profile(), SPEC);
    expect(verdict).toBe("good");
  });

  it("rejects a garden larger than the model handles", () => {
    const { verdict, reasons } = judgeMower(profile({ areaM2: 900 }), SPEC);
    expect(verdict).toBe("unsuitable");
    expect(reasons.some((r) => r.tone === "bad" && r.text.includes("900 m²"))).toBe(true);
  });

  it("warns when the garden nearly fills the model's capacity", () => {
    expect(judgeMower(profile({ areaM2: 550 }), SPEC).verdict).toBe("tight");
  });

  it("rejects a slope the model is not rated for", () => {
    const { verdict, reasons } = judgeMower(profile({ maxSlopePct: 45 }), SPEC);
    expect(verdict).toBe("unsuitable");
    expect(reasons.some((r) => r.text.includes("45%"))).toBe(true);
  });

  it("warns when the slope is close to the limit", () => {
    expect(judgeMower(profile({ maxSlopePct: 33 }), SPEC).verdict).toBe("tight");
  });

  it("rejects a passage the machine cannot fit through", () => {
    // 45 cm gap, 60 cm machine — it would never reach past it.
    const { verdict, reasons } = judgeMower(profile({ narrowestPassageM: 0.45 }), SPEC);
    expect(verdict).toBe("unsuitable");
    expect(reasons.some((r) => r.text.includes("45 cm"))).toBe(true);
  });

  it("warns on a passage that only just fits", () => {
    expect(judgeMower(profile({ narrowestPassageM: 0.65 }), SPEC).verdict).toBe("tight");
  });

  it("flags separate lawns a single-zone model cannot reach", () => {
    const { verdict, reasons } = judgeMower(profile({ zoneCount: 2 }), SPEC);
    expect(verdict).toBe("tight");
    expect(reasons.some((r) => r.text.includes("adskilte"))).toBe(true);
  });

  it("accepts separate lawns on a multi-zone model", () => {
    expect(judgeMower(profile({ zoneCount: 2 }), { ...SPEC, zones: 2 }).verdict).toBe("good");
  });

  it("suggests sensors for a busy garden on a bump-only machine", () => {
    const { verdict, reasons } = judgeMower(profile({ obstacleCount: 10 }), SPEC);
    expect(verdict).toBe("tight");
    expect(reasons.some((r) => r.text.includes("sensorer"))).toBe(true);
  });

  it("does not penalise a busy garden on a machine that senses obstacles", () => {
    const spec = { ...SPEC, obstacleAvoidance: "lidar" as const };
    expect(judgeMower(profile({ obstacleCount: 10 }), spec).verdict).toBe("good");
  });

  it("mentions water and level changes without failing the model on them", () => {
    const { verdict, reasons } = judgeMower(profile({ hasWater: true, hasLevelChange: true }), SPEC);
    expect(verdict).toBe("good");
    expect(reasons.filter((r) => r.tone === "warn")).toHaveLength(2);
  });

  it("says so when the slope could not be measured", () => {
    const { reasons } = judgeMower(profile({ slopeUnknown: true, maxSlopePct: null }), SPEC);
    expect(reasons.some((r) => r.text.includes("kunne ikke måle"))).toBe(true);
  });

  it("keeps the worst verdict when several things are wrong", () => {
    const { verdict } = judgeMower(profile({ areaM2: 900, maxSlopePct: 50 }), SPEC);
    expect(verdict).toBe("unsuitable");
  });
});

describe("matchMowers", () => {
  const products = [
    { id: "1", slug: "lille", name: "Lille", base_price_dkk: 4000, mower_specs: { maxAreaM2: 300, maxSlopePct: 25, minPassageCm: 60 } },
    { id: "2", slug: "mellem", name: "Mellem", base_price_dkk: 7000, mower_specs: { maxAreaM2: 600, maxSlopePct: 35, minPassageCm: 60 } },
    { id: "3", slug: "stor", name: "Stor", base_price_dkk: 12000, mower_specs: { maxAreaM2: 3000, maxSlopePct: 45, minPassageCm: 70 } },
    { id: "4", slug: "uden-specs", name: "Uden specs", base_price_dkk: 5000, mower_specs: null },
  ];

  it("skips products with no specs rather than guessing", () => {
    const matches = matchMowers(profile(), products);
    expect(matches.map((m) => m.slug)).not.toContain("uden-specs");
  });

  it("puts a fitting mower ahead of an unsuitable one", () => {
    const matches = matchMowers(profile({ areaM2: 400 }), products);
    expect(matches[0].verdict).toBe("good");
    expect(matches[matches.length - 1].slug).toBe("lille"); // 400 m² > its 300
  });

  it("prefers a right-sized model over a much larger one", () => {
    const matches = matchMowers(profile({ areaM2: 400 }), products);
    const good = matches.filter((m) => m.verdict === "good");
    expect(good[0].slug).toBe("mellem");
  });

  it("still returns unsuitable models, so the customer can see why", () => {
    const matches = matchMowers(profile({ areaM2: 400 }), products);
    expect(matches).toHaveLength(3);
    const lille = matches.find((m) => m.slug === "lille")!;
    expect(lille.verdict).toBe("unsuitable");
    expect(lille.reasons.some((r) => r.tone === "bad")).toBe(true);
  });

  it("returns nothing when the catalogue has no specs at all", () => {
    expect(matchMowers(profile(), [products[3]])).toEqual([]);
  });
});

describe("describeProfile", () => {
  it("summarises the garden in Danish", () => {
    expect(describeProfile(profile())).toBe("400 m² · op til 8% fald · 2 forhindringer");
  });

  it("omits slope it could not measure", () => {
    expect(describeProfile(profile({ slopeUnknown: true, maxSlopePct: null }))).toBe("400 m² · 2 forhindringer");
  });

  it("uses the singular for one obstacle and mentions several surfaces", () => {
    expect(describeProfile(profile({ obstacleCount: 1, zoneCount: 3 }))).toContain("1 forhindring ·");
    expect(describeProfile(profile({ obstacleCount: 1, zoneCount: 3 }))).toContain("3 flader");
  });
});
