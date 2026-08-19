import { describe, expect, it } from "vitest";
import {
  detectObjectsFromElevation,
  elevationStatsFromGrid,
  measuredObjectHeight,
  parseElevationResponse,
  relativeTerrainHeight,
  sampleSurface,
  sampleTerrain,
  slopeBand,
  slopeLabel,
  terrainSlopeStats,
  type ElevationField,
} from "@/lib/gardenElevation";
import type { Ring } from "@/lib/havemaalerGeometry";

// 2x2 grid over the unit lng/lat box. Row 0 = north (lat = 1).
function field(terrain: number[][], surface: number[][] | null = null): ElevationField {
  const stats = elevationStatsFromGrid(terrain);
  return { source: "dhm", cols: 2, rows: 2, bbox: [0, 0, 1, 1], terrain, surface, stats, resolutionM: 1, confidence: 0.8 };
}

describe("gardenElevation", () => {
  it("samples terrain bilinearly with north at row 0", () => {
    const f = field([[10, 12], [14, 18]]);
    expect(sampleTerrain(f, 0, 1)).toBeCloseTo(10, 5); // NW corner
    expect(sampleTerrain(f, 1, 0)).toBeCloseTo(18, 5); // SE corner
    expect(sampleTerrain(f, 0.5, 0.5)).toBeCloseTo(13.5, 5); // center average
  });

  it("computes stats and relative height from the lowest point", () => {
    const f = field([[10, 12], [14, 18]]);
    expect(f.stats.minM).toBe(10);
    expect(f.stats.maxM).toBe(18);
    expect(f.stats.reliefM).toBe(8);
    expect(relativeTerrainHeight(f, 1, 0)).toBeCloseTo(8, 3);
    expect(relativeTerrainHeight(f, 0, 1)).toBeCloseTo(0, 3);
  });

  it("derives object height from DSM minus DTM and ignores ground-flush noise", () => {
    const terrain = [[10, 10], [10, 10]];
    const surface = [[16, 16], [16, 16]]; // 6m of canopy everywhere
    const f = field(terrain, surface);
    const ring: Ring = [[0.4, 0.4], [0.6, 0.4], [0.6, 0.6], [0.4, 0.6]];
    expect(measuredObjectHeight(f, ring)).toBeCloseTo(6, 1);

    const flat = field([[10, 10], [10, 10]], [[10.1, 10.1], [10.1, 10.1]]);
    expect(measuredObjectHeight(flat, ring)).toBeNull(); // below 0.4m noise floor

    expect(measuredObjectHeight(field([[10, 10], [10, 10]]), ring)).toBeNull(); // no surface model
  });

  it("returns surface samples only when a surface grid exists", () => {
    expect(sampleSurface(field([[1, 1], [1, 1]]), 0.5, 0.5)).toBeNull();
    expect(sampleSurface(field([[1, 1], [1, 1]], [[2, 2], [2, 2]]), 0.5, 0.5)).toBeCloseTo(2, 5);
  });

  it("bands and labels slope by relief", () => {
    expect(slopeBand(0.1)).toBe("flat");
    expect(slopeBand(0.5)).toBe("gentle");
    expect(slopeBand(1.2)).toBe("moderate");
    expect(slopeBand(3)).toBe("steep");
    expect(slopeLabel(0.1)).toBe("Stort set fladt");
    expect(slopeLabel(3)).toBe("Stejlt terræn");
  });

  it("parses valid edge-function responses and rejects bad ones", () => {
    const good = parseElevationResponse({
      available: true,
      source: "dhm",
      cols: 2,
      rows: 2,
      bbox: [0, 0, 1, 1],
      terrain: [[1, 2], [3, 4]],
      surface: null,
      resolutionM: 1.2,
    });
    expect(good.available).toBe(true);
    if (good.available) {
      expect(good.field.stats.reliefM).toBe(3);
      expect(good.field.confidence).toBeGreaterThan(0.4);
    }

    expect(parseElevationResponse({ available: false, detail: "no token" }).available).toBe(false);
    expect(parseElevationResponse({ available: true, source: "dhm", cols: 2, rows: 2, bbox: [0, 0, 1, 1], terrain: [[1, 2]] }).available).toBe(false);
  });

  it("reports terrain slope as rise/run percentages", () => {
    // 10m fall over a 10m-wide cell span (bbox sized so cells are ~10m).
    const flat = field([[10, 10], [10, 10]]);
    expect(terrainSlopeStats(flat).maxSlopePct).toBe(0);
    const steep: ElevationField = { ...field([[10, 20], [10, 20]]), bbox: [0, 0, 0.00016, 0.00009] };
    const stats = terrainSlopeStats(steep);
    expect(stats.maxSlopePct).toBeGreaterThan(35);
    expect(stats.exceedsRobotLimit).toBe(true);
  });

  it("detects trees and hedges from the surface model and skips flat ground", () => {
    // ~1m cells: bbox sized so each of the 10 columns/rows is ~1m apart.
    const cols = 10;
    const rows = 10;
    const bbox: [number, number, number, number] = [12.0, 55.0, 12.000141, 55.0000808];
    const terrain = Array.from({ length: rows }, () => Array.from({ length: cols }, () => 10));
    const surface = terrain.map((row) => [...row]);
    // Compact 3x3 tall block (tree, 5m).
    for (let r = 4; r <= 6; r += 1) for (let c = 4; c <= 6; c += 1) surface[r][c] = 15;
    // Elongated 1x5 strip (hedge, 1.5m).
    for (let c = 1; c <= 5; c += 1) surface[1][c] = 11.5;
    const f: ElevationField = { source: "dhm", cols, rows, bbox, terrain, surface, stats: elevationStatsFromGrid(terrain), resolutionM: 1, confidence: 0.85 };

    const detected = detectObjectsFromElevation(f);
    expect(detected.length).toBeGreaterThanOrEqual(2);
    expect(detected.some((o) => o.type === "tree" && o.heightM >= 4)).toBe(true);
    expect(detected.some((o) => o.type === "hedge")).toBe(true);

    // No surface model -> nothing to detect.
    expect(detectObjectsFromElevation({ ...f, surface: null })).toEqual([]);
  });

  it("measures diagonal hedges along their principal axis with a rotation", () => {
    const cols = 10;
    const rows = 10;
    const bbox: [number, number, number, number] = [12.0, 55.0, 12.000141, 55.0000808];
    const terrain = Array.from({ length: rows }, () => Array.from({ length: cols }, () => 10));
    const surface = terrain.map((row) => [...row]);
    // Diagonal NW->SE strip of 1.5m greenery: rows/cols 2..7.
    for (let i = 2; i <= 7; i += 1) surface[i][i] = 11.5;
    const f: ElevationField = { source: "dhm", cols, rows, bbox, terrain, surface, stats: elevationStatsFromGrid(terrain), resolutionM: 1, confidence: 0.85 };

    const detected = detectObjectsFromElevation(f);
    const hedge = detected.find((o) => o.type === "hedge");
    expect(hedge).toBeTruthy();
    expect(hedge!.widthM).toBeGreaterThan(6); // ~5*sqrt(2)+1 along the diagonal
    expect(hedge!.depthM).toBeLessThan(2.5);
    expect(hedge!.rotationDeg).toBeGreaterThan(125);
    expect(hedge!.rotationDeg).toBeLessThan(145);
  });

  it("filters detections outside the garden boundary", () => {
    const cols = 10;
    const rows = 10;
    const bbox: [number, number, number, number] = [12.0, 55.0, 12.000141, 55.0000808];
    const terrain = Array.from({ length: rows }, () => Array.from({ length: cols }, () => 10));
    const surface = terrain.map((row) => [...row]);
    for (let r = 4; r <= 6; r += 1) for (let c = 4; c <= 6; c += 1) surface[r][c] = 15; // tree inside
    for (let c = 1; c <= 5; c += 1) surface[1][c] = 11.5; // hedge in the far north (outside)
    const f: ElevationField = { source: "dhm", cols, rows, bbox, terrain, surface, stats: elevationStatsFromGrid(terrain), resolutionM: 1, confidence: 0.85 };

    // Boundary rectangle around the tree only.
    const boundary: Ring = [
      [12.00005, 55.00002],
      [12.00011, 55.00002],
      [12.00011, 55.00005],
      [12.00005, 55.00005],
    ];
    const detected = detectObjectsFromElevation(f, { boundary, boundaryMarginM: 0.5 });
    expect(detected.some((o) => o.type === "tree")).toBe(true);
    expect(detected.some((o) => o.type === "hedge")).toBe(false);
  });
});
