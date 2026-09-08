/**
 * Turning a garden twin into a robot-mower recommendation.
 *
 * This is the payoff step 2 of Havemåler was always meant to have. The builder
 * collects exactly what decides whether a mower can do the job — how much lawn,
 * how steep, what is in the way, and how tight the gaps are — and until now it
 * threw all of it at a 3D render and stopped.
 *
 * Everything here works in the model's *local* coordinates, which are already
 * metres on a flat plane (`localLawnRings`, `localFootprint`). No projection
 * maths, no turf: a garden is small enough that the flat approximation is well
 * inside the error of the underlying measurement.
 */

import type { GardenDepthModel, GardenDepthObject, LocalPoint } from "@/lib/gardenDepth";

// --------------------------------------------------------------- the profile

/** Obstacles the mower has to drive around, as opposed to edges it follows. */
const ISLAND_OBSTACLES = new Set(["tree", "shed", "bed", "water", "furniture", "unknown_obstacle"]);

/** Things that stop a mower dead rather than merely deflecting it. */
const IMPASSABLE = new Set(["steps", "retaining_wall"]);

export type MowerProfile = {
  areaM2: number;
  /** Separate lawn surfaces. More than one means the mower needs help crossing. */
  zoneCount: number;
  perimeterM: number;
  maxSlopePct: number | null;
  avgSlopePct: number | null;
  /** Height difference across the garden, in metres. */
  reliefM: number | null;
  obstacleCount: number;
  obstaclesByType: Record<string, number>;
  /**
   * Tightest gap the mower must fit through, in metres — between two obstacles,
   * or between an obstacle and the lawn edge. Null when there is nothing to
   * squeeze past.
   */
  narrowestPassageM: number | null;
  hasWater: boolean;
  hasLevelChange: boolean;
  /** True when the terrain grid was missing, so slope is unknown rather than flat. */
  slopeUnknown: boolean;
};

// ------------------------------------------------------------------ geometry

function distance(a: LocalPoint, b: LocalPoint): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Shortest distance from a point to a line segment. */
function pointToSegment(p: LocalPoint, a: LocalPoint, b: LocalPoint): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq === 0) return distance(p, a);
  // Projection of p onto ab, clamped to the segment.
  let t = ((p.x - a.x) * dx + (p.z - a.z) * dz) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
}

function segmentsIntersect(a1: LocalPoint, a2: LocalPoint, b1: LocalPoint, b2: LocalPoint): boolean {
  const cross = (o: LocalPoint, p: LocalPoint, q: LocalPoint) =>
    (p.x - o.x) * (q.z - o.z) - (p.z - o.z) * (q.x - o.x);
  const d1 = cross(b1, b2, a1);
  const d2 = cross(b1, b2, a2);
  const d3 = cross(a1, a2, b1);
  const d4 = cross(a1, a2, b2);
  return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
}

/** Shortest distance between the outlines of two polygons; 0 if they touch or cross. */
export function polygonDistance(a: LocalPoint[], b: LocalPoint[]): number {
  if (a.length < 2 || b.length < 2) return Infinity;

  let min = Infinity;
  for (let i = 0; i < a.length; i += 1) {
    const a1 = a[i];
    const a2 = a[(i + 1) % a.length];
    for (let j = 0; j < b.length; j += 1) {
      const b1 = b[j];
      const b2 = b[(j + 1) % b.length];
      if (segmentsIntersect(a1, a2, b1, b2)) return 0;
      min = Math.min(
        min,
        pointToSegment(a1, b1, b2),
        pointToSegment(a2, b1, b2),
        pointToSegment(b1, a1, a2),
        pointToSegment(b2, a1, a2),
      );
    }
  }
  return min;
}

function ringPerimeter(ring: LocalPoint[]): number {
  if (ring.length < 2) return 0;
  let total = 0;
  for (let i = 0; i < ring.length; i += 1) {
    total += distance(ring[i], ring[(i + 1) % ring.length]);
  }
  return total;
}

/** Shoelace area, always positive. */
function ringArea(ring: LocalPoint[]): number {
  if (ring.length < 3) return 0;
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    sum += p.x * q.z - q.x * p.z;
  }
  return Math.abs(sum) / 2;
}

// ------------------------------------------------------------------- slope

/**
 * Steepest and mean slope across the DHM grid, as rise/run percentages.
 *
 * Reads the elevation summary stored on the model rather than re-fetching, so
 * the profile can be computed offline from a saved garden.
 */
export function slopeFromElevation(
  elevation: GardenDepthModel["terrain"]["elevation"],
): { maxPct: number; avgPct: number; reliefM: number } | null {
  if (!elevation?.terrain?.length) return null;

  const { terrain, rows, cols, resolutionM } = elevation;
  // resolutionM is metres per cell; fall back to a sane default rather than
  // dividing by zero and reporting an infinite slope.
  const step = resolutionM && resolutionM > 0 ? resolutionM : 1;

  let max = 0;
  let sum = 0;
  let count = 0;

  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const here = terrain[r]?.[c];
      if (!Number.isFinite(here)) continue;

      const right = terrain[r]?.[c + 1];
      if (Number.isFinite(right)) {
        const slope = Math.abs(right - here) / step;
        max = Math.max(max, slope);
        sum += slope;
        count += 1;
      }

      const below = terrain[r + 1]?.[c];
      if (Number.isFinite(below)) {
        const slope = Math.abs(below - here) / step;
        max = Math.max(max, slope);
        sum += slope;
        count += 1;
      }
    }
  }

  if (count === 0) return null;

  return {
    maxPct: Number((max * 100).toFixed(1)),
    avgPct: Number(((sum / count) * 100).toFixed(1)),
    reliefM: Number((elevation.stats?.reliefM ?? 0).toFixed(2)),
  };
}

// ------------------------------------------------------------- the profile

export function computeMowerProfile(model: GardenDepthModel): MowerProfile {
  const lawnRings = (model.terrain.localLawnRings ?? []).filter((ring) => ring.length >= 3);

  const areaM2 = Number(
    (model.terrain.areaM2 ?? lawnRings.reduce((sum, ring) => sum + ringArea(ring), 0)).toFixed(0),
  );
  const perimeterM = Number(lawnRings.reduce((sum, ring) => sum + ringPerimeter(ring), 0).toFixed(1));

  const objects = model.objects ?? [];
  const islands = objects.filter(
    (o): o is GardenDepthObject => ISLAND_OBSTACLES.has(o.type) && (o.localFootprint?.length ?? 0) >= 3,
  );

  const obstaclesByType: Record<string, number> = {};
  for (const object of objects) {
    obstaclesByType[object.type] = (obstaclesByType[object.type] ?? 0) + 1;
  }

  // The tightest gap the machine has to fit through: obstacle-to-obstacle, and
  // obstacle-to-lawn-edge. Overlapping footprints report 0 and are ignored —
  // that is a modelling artefact, not a real passage.
  let narrowest = Infinity;

  for (let i = 0; i < islands.length; i += 1) {
    for (let j = i + 1; j < islands.length; j += 1) {
      const gap = polygonDistance(islands[i].localFootprint, islands[j].localFootprint);
      if (gap > 0.01 && gap < narrowest) narrowest = gap;
    }
    for (const ring of lawnRings) {
      const gap = polygonDistance(islands[i].localFootprint, ring);
      if (gap > 0.01 && gap < narrowest) narrowest = gap;
    }
  }

  const slope = slopeFromElevation(model.terrain.elevation);

  return {
    areaM2,
    zoneCount: lawnRings.length,
    perimeterM,
    maxSlopePct: slope?.maxPct ?? null,
    avgSlopePct: slope?.avgPct ?? null,
    reliefM: slope?.reliefM ?? null,
    obstacleCount: islands.length,
    obstaclesByType,
    narrowestPassageM: Number.isFinite(narrowest) ? Number(narrowest.toFixed(2)) : null,
    hasWater: objects.some((o) => o.type === "water"),
    hasLevelChange: objects.some((o) => IMPASSABLE.has(o.type)),
    slopeUnknown: slope === null,
  };
}

// ------------------------------------------------------------------ matching

/** What a mower can cope with. Stored per product in `products.mower_specs`. */
export type MowerSpec = {
  maxAreaM2: number;
  maxSlopePct: number;
  /** Narrowest corridor the machine can drive through, in centimetres. */
  minPassageCm: number;
  /** Separate lawn areas it can handle unaided. 1 = single zone only. */
  zones?: number;
  obstacleAvoidance?: "bump" | "sensor" | "camera" | "lidar";
  needsGuideWire?: boolean;
  cuttingWidthCm?: number;
};

export type FitVerdict = "good" | "tight" | "unsuitable";

export type FitReason = {
  tone: "good" | "warn" | "bad";
  text: string;
};

export type MowerMatch = {
  productId: string;
  slug: string;
  name: string;
  priceDkk: number;
  spec: MowerSpec;
  verdict: FitVerdict;
  /** Higher is better. Used to order the recommendations. */
  score: number;
  reasons: FitReason[];
};

export function isMowerSpec(value: unknown): value is MowerSpec {
  if (!value || typeof value !== "object") return false;
  const spec = value as Record<string, unknown>;
  return (
    typeof spec.maxAreaM2 === "number" &&
    typeof spec.maxSlopePct === "number" &&
    typeof spec.minPassageCm === "number"
  );
}

const pct = (n: number) => `${Number(n.toFixed(0))}%`;

/**
 * Judge one mower against one garden.
 *
 * The verdict is deliberately conservative: anything that would leave part of
 * the lawn uncut, or put the machine on a slope it is not rated for, is
 * "unsuitable" rather than "tight". Selling someone a mower that cannot reach
 * the back half of their garden is worse than selling them nothing.
 */
export function judgeMower(profile: MowerProfile, spec: MowerSpec): { verdict: FitVerdict; score: number; reasons: FitReason[] } {
  const reasons: FitReason[] = [];
  let verdict: FitVerdict = "good";
  let score = 100;

  const worsen = (next: FitVerdict) => {
    if (next === "unsuitable") verdict = "unsuitable";
    else if (next === "tight" && verdict !== "unsuitable") verdict = "tight";
  };

  // ---- area
  if (profile.areaM2 > spec.maxAreaM2) {
    worsen("unsuitable");
    score -= 60;
    reasons.push({
      tone: "bad",
      text: `Din have er ${profile.areaM2} m² — modellen er beregnet til ${spec.maxAreaM2} m².`,
    });
  } else if (profile.areaM2 > spec.maxAreaM2 * 0.85) {
    worsen("tight");
    score -= 15;
    reasons.push({
      tone: "warn",
      text: `${profile.areaM2} m² af modellens ${spec.maxAreaM2} m² — den skal køre næsten hele tiden.`,
    });
  } else {
    reasons.push({
      tone: "good",
      text: `${profile.areaM2} m² ligger godt inden for modellens ${spec.maxAreaM2} m².`,
    });
    // Prefer a mower sized for the garden over a far larger one.
    score -= Math.round((1 - profile.areaM2 / spec.maxAreaM2) * 12);
  }

  // ---- slope
  if (profile.slopeUnknown) {
    reasons.push({ tone: "warn", text: "Vi kunne ikke måle terrænhældningen — tjek selv de stejleste steder." });
    score -= 5;
  } else if (profile.maxSlopePct != null) {
    if (profile.maxSlopePct > spec.maxSlopePct) {
      worsen("unsuitable");
      score -= 50;
      reasons.push({
        tone: "bad",
        text: `Stejleste fald er ${pct(profile.maxSlopePct)} — modellen klarer ${pct(spec.maxSlopePct)}.`,
      });
    } else if (profile.maxSlopePct > spec.maxSlopePct - 5) {
      worsen("tight");
      score -= 12;
      reasons.push({
        tone: "warn",
        text: `Stejleste fald er ${pct(profile.maxSlopePct)}, tæt på modellens grænse på ${pct(spec.maxSlopePct)}.`,
      });
    } else {
      reasons.push({
        tone: "good",
        text: `Stejleste fald ${pct(profile.maxSlopePct)} — klart inden for modellens ${pct(spec.maxSlopePct)}.`,
      });
    }
  }

  // ---- passages
  if (profile.narrowestPassageM != null) {
    const passageCm = Math.round(profile.narrowestPassageM * 100);
    if (passageCm < spec.minPassageCm) {
      worsen("unsuitable");
      score -= 40;
      reasons.push({
        tone: "bad",
        text: `Smalleste passage er ${passageCm} cm — modellen skal bruge ${spec.minPassageCm} cm og kommer ikke forbi.`,
      });
    } else if (passageCm < spec.minPassageCm + 15) {
      worsen("tight");
      score -= 10;
      reasons.push({
        tone: "warn",
        text: `Smalleste passage er ${passageCm} cm mod modellens ${spec.minPassageCm} cm — den kan sætte sig fast.`,
      });
    } else {
      reasons.push({ tone: "good", text: `Kommer forbi den smalleste passage på ${passageCm} cm.` });
    }
  }

  // ---- separate lawns
  const zones = spec.zones ?? 1;
  if (profile.zoneCount > zones) {
    worsen("tight");
    score -= 14;
    reasons.push({
      tone: "warn",
      text:
        profile.zoneCount === 2
          ? "Haven har to adskilte græsflader — du skal flytte den manuelt, eller lægge en passage imellem."
          : `Haven har ${profile.zoneCount} adskilte græsflader; modellen håndterer ${zones}.`,
    });
  }

  // ---- obstacles
  if (profile.obstacleCount >= 8 && (spec.obstacleAvoidance ?? "bump") === "bump") {
    worsen("tight");
    score -= 8;
    reasons.push({
      tone: "warn",
      text: `${profile.obstacleCount} forhindringer, og modellen finder vej ved at støde ind i dem. Overvej en med sensorer.`,
    });
  } else if (profile.obstacleCount >= 8) {
    reasons.push({ tone: "good", text: `Klarer havens ${profile.obstacleCount} forhindringer med aktiv registrering.` });
  }

  if (profile.hasWater) {
    reasons.push({
      tone: "warn",
      text: "Der er vand i haven — læg begrænsningskabel med god afstand uanset model.",
    });
  }

  if (profile.hasLevelChange) {
    reasons.push({
      tone: "warn",
      text: "Haven har trin eller støttemur. En robotklipper kan ikke forcere niveauspring.",
    });
  }

  return { verdict, score: Math.max(0, score), reasons };
}

export type MowerProduct = {
  id: string;
  slug: string;
  name: string;
  base_price_dkk: number;
  mower_specs: unknown;
};

/**
 * Rank a catalogue against a garden. Unsuitable models are kept — knowing *why*
 * something does not fit is the useful half of a recommendation — but they sort
 * last.
 */
export function matchMowers(profile: MowerProfile, products: MowerProduct[]): MowerMatch[] {
  const order: Record<FitVerdict, number> = { good: 0, tight: 1, unsuitable: 2 };

  return products
    .filter((p) => isMowerSpec(p.mower_specs))
    .map((p) => {
      const spec = p.mower_specs as MowerSpec;
      const { verdict, score, reasons } = judgeMower(profile, spec);
      return {
        productId: p.id,
        slug: p.slug,
        name: p.name,
        priceDkk: p.base_price_dkk,
        spec,
        verdict,
        score,
        reasons,
      };
    })
    .sort((a, b) => order[a.verdict] - order[b.verdict] || b.score - a.score || a.priceDkk - b.priceDkk);
}

// ------------------------------------------------------------- presentation

/** One-line plain-Danish summary of the garden, for the results header. */
export function describeProfile(profile: MowerProfile): string {
  const parts = [`${profile.areaM2} m²`];
  if (!profile.slopeUnknown && profile.maxSlopePct != null) {
    parts.push(`op til ${pct(profile.maxSlopePct)} fald`);
  }
  if (profile.obstacleCount > 0) {
    parts.push(`${profile.obstacleCount} ${profile.obstacleCount === 1 ? "forhindring" : "forhindringer"}`);
  }
  if (profile.zoneCount > 1) parts.push(`${profile.zoneCount} flader`);
  return parts.join(" · ");
}

/** Danish label for an obstacle type, for the review list and the summary. */
export const OBSTACLE_LABELS: Record<string, string> = {
  tree: "træ",
  hedge: "hæk",
  shed: "skur",
  fence: "hegn",
  patio: "terrasse",
  bed: "bed",
  steps: "trin",
  retaining_wall: "støttemur",
  water: "vand",
  furniture: "havemøbler",
  unknown_obstacle: "forhindring",
};
