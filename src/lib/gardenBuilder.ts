// The interactive 3D builder is Havemåler Part 2: the user drops and sizes real
// garden objects (trees, hedges, sheds, terraces…) on the satellite, and we
// pre-fill heights from the DHM elevation model when available. This module is
// the pure data layer — object specs, footprint geometry, and create/update
// helpers — so it can be unit tested without React or Mapbox.
import type { LngLat, Ring } from "@/lib/havemaalerGeometry";
import type { DepthObjectType } from "@/lib/gardenDepth";

const METERS_PER_DEG = 111_320;

export type BuilderObjectType = Exclude<DepthObjectType, "unknown_obstacle"> | "unknown_obstacle";

export type PlacedObject = {
  id: string;
  type: BuilderObjectType;
  label: string;
  center: LngLat;
  /** Footprint width (m) along the object's local x, before rotation. */
  widthM: number;
  /** Footprint depth (m) along the object's local y, before rotation. */
  depthM: number;
  heightM: number;
  rotationDeg: number;
  /** Where the height came from — drives the truthful confidence we store. */
  heightSource: "dhm_measured" | "default" | "user";
  confidence: number;
};

export type ObjectSpec = {
  type: BuilderObjectType;
  label: string;
  widthM: number;
  depthM: number;
  heightM: number;
  /** Hex color for map markers / 3D, mirrors GardenTwinViewer's palette. */
  color: string;
  /** Whether DHM surface height is meaningful for this type (trees/hedges yes, flat beds no). */
  measurable: boolean;
  /** Plausible height range for the slider, in metres. */
  heightRange: [number, number];
  hint: string;
};

export const OBJECT_SPECS: Record<BuilderObjectType, ObjectSpec> = {
  tree: { type: "tree", label: "Træ", widthM: 4, depthM: 4, heightM: 6, color: "#4f8a54", measurable: true, heightRange: [1.5, 25], hint: "Kronens bredde og højde. DHM måler ofte træhøjden automatisk." },
  hedge: { type: "hedge", label: "Hæk", widthM: 4, depthM: 0.6, heightM: 1.6, color: "#315c3a", measurable: true, heightRange: [0.3, 4], hint: "Træk langs hækken. Højden bruges til læ og privatliv." },
  shed: { type: "shed", label: "Skur", widthM: 3, depthM: 2.4, heightM: 2.3, color: "#9b7653", measurable: true, heightRange: [1.8, 5], hint: "Redskabsskur eller udhus." },
  fence: { type: "fence", label: "Hegn", widthM: 4, depthM: 0.1, heightM: 1.6, color: "#c6a96d", measurable: false, heightRange: [0.4, 2.2], hint: "Plankeværk eller raftehegn langs skel." },
  patio: { type: "patio", label: "Terrasse", widthM: 4, depthM: 3, heightM: 0.12, color: "#8a9295", measurable: false, heightRange: [0, 0.6], hint: "Fliser eller trædæk. Lav flade." },
  bed: { type: "bed", label: "Bed", widthM: 2.5, depthM: 1.2, heightM: 0.3, color: "#7b5f45", measurable: false, heightRange: [0, 1], hint: "Stauder, køkkenhave eller blomsterbed." },
  steps: { type: "steps", label: "Trappe", widthM: 1.6, depthM: 1.2, heightM: 0.6, color: "#d4c3a3", measurable: false, heightRange: [0.1, 2], hint: "Havetrappe eller niveauspring." },
  retaining_wall: { type: "retaining_wall", label: "Støttemur", widthM: 3, depthM: 0.4, heightM: 0.8, color: "#9c8f7f", measurable: true, heightRange: [0.2, 2.5], hint: "Mur der holder på en skråning." },
  water: { type: "water", label: "Vand", widthM: 2.5, depthM: 1.5, heightM: 0.1, color: "#4a8fb4", measurable: false, heightRange: [0, 0.4], hint: "Bassin, dam eller pool." },
  furniture: { type: "furniture", label: "Havemøbler", widthM: 2, depthM: 1.2, heightM: 0.8, color: "#d88f4d", measurable: false, heightRange: [0.3, 1.6], hint: "Loungesæt, trampolin eller legehus." },
  unknown_obstacle: { type: "unknown_obstacle", label: "Forhindring", widthM: 1.5, depthM: 1.5, heightM: 1, color: "#6c7180", measurable: false, heightRange: [0.2, 4], hint: "Andet fast objekt robotten skal udenom." },
};

/** Palette order for the builder toolbar — most common first. */
export const BUILDER_PALETTE: BuilderObjectType[] = [
  "tree", "hedge", "shed", "patio", "bed", "fence", "water", "furniture", "steps", "retaining_wall", "unknown_obstacle",
];

function metersToLngLat(center: LngLat, dxMeters: number, dyMeters: number): LngLat {
  const lat = center[1] + dyMeters / METERS_PER_DEG;
  const lng = center[0] + dxMeters / (METERS_PER_DEG * Math.cos((center[1] * Math.PI) / 180));
  return [lng, lat];
}

/** Axis-aligned-then-rotated rectangular footprint around a center point. */
export function makeFootprint(center: LngLat, widthM: number, depthM: number, rotationDeg = 0): Ring {
  const hw = Math.max(0.2, widthM) / 2;
  const hd = Math.max(0.05, depthM) / 2;
  const a = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const corners: Array<[number, number]> = [
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
  ];
  return corners.map(([x, y]) => metersToLngLat(center, x * cos - y * sin, x * sin + y * cos));
}

let placedObjectCounter = 0;

export function createPlacedObject(
  type: BuilderObjectType,
  center: LngLat,
  overrides: Partial<Pick<PlacedObject, "widthM" | "depthM" | "heightM" | "rotationDeg" | "label" | "id" | "heightSource" | "confidence">> = {},
): PlacedObject {
  const spec = OBJECT_SPECS[type];
  placedObjectCounter += 1;
  const widthM = overrides.widthM ?? spec.widthM;
  const depthM = overrides.depthM ?? spec.depthM;
  const heightSource = overrides.heightSource ?? "default";
  return {
    id: overrides.id ?? `obj-${type}-${placedObjectCounter}`,
    type,
    label: overrides.label ?? spec.label,
    center,
    widthM,
    depthM,
    heightM: overrides.heightM ?? spec.heightM,
    rotationDeg: overrides.rotationDeg ?? 0,
    heightSource,
    confidence: overrides.confidence ?? confidenceForHeightSource(heightSource),
  };
}

export function confidenceForHeightSource(source: PlacedObject["heightSource"]): number {
  if (source === "dhm_measured") return 0.82;
  if (source === "user") return 0.7;
  return 0.5;
}

export function updatePlacedObject(object: PlacedObject, patch: Partial<PlacedObject>): PlacedObject {
  const next = { ...object, ...patch };
  if (patch.heightM != null && patch.heightSource == null) {
    next.heightSource = "user";
    next.confidence = confidenceForHeightSource("user");
  }
  if (patch.heightSource && patch.confidence == null) {
    next.confidence = confidenceForHeightSource(patch.heightSource);
  }
  return next;
}

export function placedObjectFootprint(object: PlacedObject): Ring {
  return makeFootprint(object.center, object.widthM, object.depthM, object.rotationDeg);
}

/** Clamp a height into the type's plausible slider range. */
export function clampHeight(type: BuilderObjectType, heightM: number): number {
  const [min, max] = OBJECT_SPECS[type].heightRange;
  return Number(Math.max(min, Math.min(max, heightM)).toFixed(2));
}
