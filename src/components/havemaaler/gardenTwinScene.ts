/**
 * Scene construction for the garden twin viewer.
 *
 * Split out of the component so the React side owns only the renderer, camera
 * and controls — which now survive a model change instead of being rebuilt on
 * every edit. Everything here is pure Three.js: given a scene and a model, fill
 * the scene; given nothing, dispose it.
 *
 * Targets three 0.149, so it is `outputEncoding`/`sRGBEncoding` throughout —
 * `outputColorSpace` does not exist in this version.
 */

import * as THREE from "three";
import type { GardenDepthModel, GardenDepthObject, LocalPoint } from "@/lib/gardenDepth";
import { lngLatToLocal, localToLngLat } from "@/lib/gardenDepth";
import { sampleTerrain, type ElevationField } from "@/lib/gardenElevation";

export type ViewerToggles = {
  objects: boolean;
  heights: boolean;
  confidence: boolean;
  unknown: boolean;
};

// Late-afternoon garden palette. Chosen to sit together under ACES tone mapping
// rather than as raw hex values that look right in a colour picker.
const PALETTE = {
  lawn: 0x6f9950,
  lawnStripe: 0x7ea45c,
  apron: 0x9aa38b,
  soil: 0x6b5138,
  bark: 0x5f4632,
  foliage: 0x4a7a3f,
  foliageAlt: 0x568a45,
  hedge: 0x3f6b3a,
  timber: 0xa8845c,
  stone: 0x9d9c96,
  water: 0x3f7fa6,
  boundary: 0xf0d9a8,
  selection: 0xf3c96b,
};

const OBJECT_COLORS: Record<string, number> = {
  tree: PALETTE.foliage,
  hedge: PALETTE.hedge,
  shed: PALETTE.timber,
  fence: PALETTE.timber,
  patio: PALETTE.stone,
  bed: PALETTE.soil,
  steps: PALETTE.stone,
  retaining_wall: PALETTE.stone,
  water: PALETTE.water,
  furniture: 0xc98b52,
  unknown_obstacle: 0x7c8290,
};

export function objectColor(type: string): number {
  return OBJECT_COLORS[type] ?? OBJECT_COLORS.unknown_obstacle;
}

// ------------------------------------------------------------------ helpers

/** Deterministic 0..1 from an id, so a given tree always looks the same. */
function hash01(seed: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

export function boundsForPoints(points: LocalPoint[]) {
  if (!points.length) {
    return { minX: -10, maxX: 10, minZ: -10, maxZ: 10, width: 20, depth: 20, cx: 0, cz: 0, size: 20 };
  }
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  const width = Math.max(1, maxX - minX);
  const depth = Math.max(1, maxZ - minZ);
  return {
    minX, maxX, minZ, maxZ, width, depth,
    cx: (minX + maxX) / 2,
    cz: (minZ + maxZ) / 2,
    size: Math.max(width, depth),
  };
}

export function boundsForModel(model: GardenDepthModel) {
  return boundsForPoints([
    ...model.terrain.localBoundary,
    ...model.terrain.localLawnRings.flat(),
    ...model.objects.flatMap((o) => o.localFootprint),
  ]);
}

function elevationFieldFromModel(model: GardenDepthModel): ElevationField | null {
  const e = model.terrain.elevation;
  if (!e || !Array.isArray(e.terrain) || !e.terrain.length) return null;
  return {
    source: "dhm",
    cols: e.cols,
    rows: e.rows,
    bbox: e.bbox,
    terrain: e.terrain,
    surface: null,
    stats: e.stats,
    resolutionM: e.resolutionM,
    confidence: e.confidence,
  };
}

/** Ground height relative to the garden's lowest point, at a local x/z offset. */
function makeGroundSampler(model: GardenDepthModel, field: ElevationField | null) {
  if (!field) return () => 0;
  const minM = field.stats.minM;
  // Go through localToLngLat rather than re-deriving the projection: it is the
  // exact inverse of the one the footprints were built with, so the terrain
  // cannot drift out of alignment with the objects standing on it.
  return (x: number, z: number) => {
    const [lng, lat] = localToLngLat({ x, z }, model.center);
    return sampleTerrain(field, lng, lat) - minM;
  };
}

// ------------------------------------------------------------------- sky

/**
 * A vertical gradient standing in for sky. Cheaper and calmer than a real
 * skybox, and it gives the render a horizon — the flat beige fill it had before
 * read as a blank document rather than outdoors.
 */
export function makeSkyTexture(): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 2;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createLinearGradient(0, 0, 0, 256);
  gradient.addColorStop(0, "#8fb4d8");
  gradient.addColorStop(0.55, "#cfdbe4");
  gradient.addColorStop(1, "#eee6d6");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 2, 256);
  const texture = new THREE.CanvasTexture(canvas);
  texture.encoding = THREE.sRGBEncoding;
  return texture;
}

/**
 * Mown stripes. Two things at once: it makes the ground unmistakably a lawn
 * rather than a green polygon, and it is a quiet nod to what this whole step is
 * for.
 */
function makeLawnTexture(sizeM: number): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = `#${PALETTE.lawn.toString(16).padStart(6, "0")}`;
  ctx.fillRect(0, 0, 512, 512);

  ctx.fillStyle = `#${PALETTE.lawnStripe.toString(16).padStart(6, "0")}`;
  const stripe = 32;
  for (let y = 0; y < 512; y += stripe * 2) ctx.fillRect(0, y, 512, stripe);

  // Break up the regularity so it does not read as a printed pattern.
  for (let i = 0; i < 5000; i += 1) {
    ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`;
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  // One texture tile per ~8 m of garden keeps the stripes a believable width.
  const repeat = Math.max(1, Math.round(sizeM / 8));
  texture.repeat.set(repeat, repeat);
  texture.encoding = THREE.sRGBEncoding;
  texture.anisotropy = 4;
  return texture;
}

// ---------------------------------------------------------------- lighting

export function addLighting(scene: THREE.Scene, bounds: ReturnType<typeof boundsForPoints>): THREE.DirectionalLight {
  scene.add(new THREE.HemisphereLight(0xdcecff, 0x6b7358, 0.55));

  const sun = new THREE.DirectionalLight(0xfff0d4, 2.1);
  // Low and to one side: gardens read best in late-afternoon light, and long
  // shadows are what make heights legible.
  const reach = Math.max(24, bounds.size);
  sun.position.set(bounds.cx - reach * 0.7, reach * 0.85, bounds.cz + reach * 0.55);
  sun.target.position.set(bounds.cx, 0, bounds.cz);
  scene.add(sun.target);

  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  // The default shadow frustum is ±5 units. A garden is 20-40 m across and
  // rarely centred on the origin, so with the default the shadows simply were
  // not there. Fit it to the garden.
  const half = reach * 0.85;
  const cam = sun.shadow.camera as THREE.OrthographicCamera;
  cam.left = -half;
  cam.right = half;
  cam.top = half;
  cam.bottom = -half;
  cam.near = 1;
  cam.far = reach * 3;
  cam.updateProjectionMatrix();
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.02;
  scene.add(sun);

  return sun;
}

// ------------------------------------------------------------------ ground

function addGround(scene: THREE.Scene, model: GardenDepthModel, field: ElevationField | null, groundY: (x: number, z: number) => number, bounds: ReturnType<typeof boundsForPoints>) {
  const lawnTexture = makeLawnTexture(bounds.size);

  // An apron beyond the garden so the lawn has something to sit in and the
  // model does not end in mid-air.
  const apron = new THREE.Mesh(
    new THREE.PlaneGeometry(bounds.size * 4, bounds.size * 4),
    new THREE.MeshStandardMaterial({ color: PALETTE.apron, roughness: 1 }),
  );
  apron.rotation.x = -Math.PI / 2;
  apron.position.set(bounds.cx, -0.12, bounds.cz);
  apron.receiveShadow = true;
  scene.add(apron);

  if (field) {
    addTerrainMesh(scene, model, groundY, lawnTexture);
    return;
  }

  for (const ring of model.terrain.localLawnRings) {
    if (ring.length < 3) continue;
    const shape = new THREE.Shape(ring.map((p) => new THREE.Vector2(p.x, p.z)));
    const geometry = new THREE.ShapeGeometry(shape);
    geometry.rotateX(Math.PI / 2);
    // ShapeGeometry lays UVs out in world units; scale them into texture space.
    const uv = geometry.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i += 1) {
      uv.setXY(i, uv.getX(i) / 8, uv.getY(i) / 8);
    }
    uv.needsUpdate = true;
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ map: lawnTexture, roughness: 0.95, side: THREE.DoubleSide }),
    );
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
}

function addTerrainMesh(scene: THREE.Scene, model: GardenDepthModel, groundY: (x: number, z: number) => number, lawnTexture: THREE.Texture) {
  const points = [...model.terrain.localBoundary, ...model.terrain.localLawnRings.flat()];
  const bounds = boundsForPoints(points);
  const pad = 2;
  const width = bounds.width + pad * 2;
  const depth = bounds.depth + pad * 2;
  const segX = Math.max(16, Math.min(96, Math.round(width)));
  const segZ = Math.max(16, Math.min(96, Math.round(depth)));

  const geometry = new THREE.PlaneGeometry(width, depth, segX, segZ);
  geometry.rotateX(-Math.PI / 2);
  const position = geometry.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < position.count; i += 1) {
    position.setY(i, groundY(position.getX(i) + bounds.cx, position.getZ(i) + bounds.cz));
  }
  position.needsUpdate = true;
  geometry.computeVertexNormals();

  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({ map: lawnTexture, roughness: 0.95 }),
  );
  mesh.position.set(bounds.cx, 0, bounds.cz);
  mesh.receiveShadow = true;
  scene.add(mesh);
}

// ----------------------------------------------------------------- objects

function addTree(scene: THREE.Scene, object: GardenDepthObject, bounds: ReturnType<typeof boundsForPoints>, baseY: number, height: number, selected: boolean) {
  const seed = object.id;
  const trunkHeight = Math.max(0.6, height * (0.28 + hash01(seed, 1) * 0.1));
  const spread = Math.max(0.8, Math.min(bounds.width, bounds.depth)) / 2;
  const canopyR = Math.max(0.7, Math.min(spread, height * 0.44));

  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(canopyR * 0.09, canopyR * 0.15, trunkHeight, 8),
    new THREE.MeshStandardMaterial({ color: PALETTE.bark, roughness: 0.95 }),
  );
  trunk.position.set(bounds.cx, baseY + trunkHeight / 2, bounds.cz);
  trunk.castShadow = true;
  scene.add(trunk);

  // Three overlapping lobes rather than one sphere: a canopy has a silhouette,
  // and a lone squashed ball reads as a lollipop.
  const lobes = 3;
  for (let i = 0; i < lobes; i += 1) {
    const r = canopyR * (0.62 + hash01(seed, i + 2) * 0.4);
    const angle = (i / lobes) * Math.PI * 2 + hash01(seed, i + 9) * 1.2;
    const off = canopyR * 0.3;
    const geometry = new THREE.IcosahedronGeometry(r, 1);
    // Nudge the vertices so the lobes are not obviously spheres.
    const pos = geometry.attributes.position as THREE.BufferAttribute;
    for (let v = 0; v < pos.count; v += 1) {
      const j = 1 + (hash01(seed, v + i * 31) - 0.5) * 0.22;
      pos.setXYZ(v, pos.getX(v) * j, pos.getY(v) * j * 0.86, pos.getZ(v) * j);
    }
    pos.needsUpdate = true;
    geometry.computeVertexNormals();

    const lobe = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: i % 2 ? PALETTE.foliageAlt : PALETTE.foliage,
        roughness: 0.92,
        flatShading: true,
      }),
    );
    lobe.position.set(
      bounds.cx + Math.cos(angle) * off,
      baseY + trunkHeight + canopyR * (0.5 + hash01(seed, i + 20) * 0.35),
      bounds.cz + Math.sin(angle) * off,
    );
    lobe.castShadow = true;
    lobe.receiveShadow = true;
    scene.add(lobe);
  }

  if (selected) addSelectionRing(scene, bounds, baseY, Math.max(spread, canopyR));
}

function addSelectionRing(scene: THREE.Scene, bounds: ReturnType<typeof boundsForPoints>, baseY: number, radius: number) {
  const r = Math.max(0.9, radius + 0.35);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(r, r + 0.18, 40),
    new THREE.MeshBasicMaterial({ color: PALETTE.selection, transparent: true, opacity: 0.9, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(bounds.cx, baseY + 0.05, bounds.cz);
  scene.add(ring);
}

function addObject(scene: THREE.Scene, object: GardenDepthObject, toggles: ViewerToggles, groundY: (x: number, z: number) => number, selected: boolean) {
  const bounds = boundsForPoints(object.localFootprint);
  if (!Number.isFinite(bounds.width) || bounds.width <= 0 || bounds.depth <= 0) return;

  const baseY = groundY(bounds.cx, bounds.cz);
  const height = toggles.heights
    ? object.heightM ?? ((object.heightRangeM?.[0] ?? 0.4) + (object.heightRangeM?.[1] ?? 1.2)) / 2
    : 0.12;
  const color = objectColor(object.type);

  if (object.type === "tree" && toggles.heights) {
    addTree(scene, object, bounds, baseY, height, selected);
    return;
  }

  if (object.type === "water") {
    const water = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(0.4, bounds.width), 0.06, Math.max(0.4, bounds.depth)),
      new THREE.MeshStandardMaterial({ color, roughness: 0.12, metalness: 0.4, transparent: true, opacity: 0.85 }),
    );
    water.position.set(bounds.cx, baseY + 0.04, bounds.cz);
    water.receiveShadow = true;
    scene.add(water);
    if (selected) addSelectionRing(scene, bounds, baseY, Math.max(bounds.width, bounds.depth) / 2);
    return;
  }

  const h = Math.max(0.08, height);
  const w = Math.max(0.35, bounds.width);
  const d = Math.max(0.35, bounds.depth);

  // Hedges and beds are soft-edged; built structures are not. Rounding the
  // planting is most of what stops the scene looking like a bar chart.
  const soft = object.type === "hedge" || object.type === "bed";
  const geometry = soft
    ? roundedBox(w, h, d, Math.min(0.28, Math.min(w, d) * 0.3))
    : new THREE.BoxGeometry(w, h, d);

  const mesh = new THREE.Mesh(
    geometry,
    new THREE.MeshStandardMaterial({
      color,
      roughness: object.type === "patio" || object.type === "steps" ? 0.7 : 0.94,
      metalness: 0,
      flatShading: soft,
    }),
  );
  mesh.position.set(bounds.cx, baseY + h / 2, bounds.cz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  if (selected) addSelectionRing(scene, bounds, baseY, Math.max(w, d) / 2);
}

/** A box with bevelled edges — no dependency on three's addons. */
function roundedBox(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  const radius = Math.max(0.02, Math.min(r, Math.min(w, h, d) / 2 - 0.01));
  const shape = new THREE.Shape();
  const x = w / 2 - radius;
  const z = d / 2 - radius;
  shape.moveTo(-x, -d / 2);
  shape.lineTo(x, -d / 2);
  shape.quadraticCurveTo(w / 2, -d / 2, w / 2, -z);
  shape.lineTo(w / 2, z);
  shape.quadraticCurveTo(w / 2, d / 2, x, d / 2);
  shape.lineTo(-x, d / 2);
  shape.quadraticCurveTo(-w / 2, d / 2, -w / 2, z);
  shape.lineTo(-w / 2, -z);
  shape.quadraticCurveTo(-w / 2, -d / 2, -x, -d / 2);

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.02, h - radius * 0.6),
    bevelEnabled: true,
    bevelThickness: radius * 0.5,
    bevelSize: radius * 0.4,
    bevelSegments: 2,
    curveSegments: 6,
  });
  geometry.rotateX(-Math.PI / 2);
  geometry.center();
  return geometry;
}

function addRingLine(scene: THREE.Scene, ring: LocalPoint[], color: number, y: number, groundY: (x: number, z: number) => number) {
  if (ring.length < 2) return;
  const points = [...ring, ring[0]].map((p) => new THREE.Vector3(p.x, groundY(p.x, p.z) + y, p.z));
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  scene.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color })));
}

function addUnknownRegion(scene: THREE.Scene, ring: LocalPoint[], groundY: (x: number, z: number) => number) {
  const bounds = boundsForPoints(ring);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.max(0.3, bounds.width), Math.max(0.3, bounds.depth)),
    new THREE.MeshBasicMaterial({ color: 0x3f4650, transparent: true, opacity: 0.16 }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(bounds.cx, groundY(bounds.cx, bounds.cz) + 0.04, bounds.cz);
  scene.add(mesh);
}

// -------------------------------------------------------------- public API

/**
 * Fill `group` with the garden. Everything goes in one group so a model change
 * disposes and rebuilds only the contents, leaving the renderer, camera and
 * orbit controls — and therefore the viewpoint — untouched.
 */
export function buildGardenScene(group: THREE.Group, model: GardenDepthModel, toggles: ViewerToggles, selectedId: string | null) {
  const bounds = boundsForModel(model);
  const field = toggles.heights ? elevationFieldFromModel(model) : null;
  const groundY = makeGroundSampler(model, field);

  const scene = group as unknown as THREE.Scene; // add* helpers only call .add
  addGround(scene, model, field, groundY, bounds);
  addRingLine(scene, model.terrain.localBoundary, PALETTE.boundary, 0.14, groundY);
  model.terrain.localLawnRings.forEach((ring) => addRingLine(scene, ring, 0x2f6b3f, 0.07, groundY));

  if (toggles.objects) {
    model.objects.forEach((object) => addObject(scene, object, toggles, groundY, object.id === selectedId));
  }
  if (toggles.unknown) {
    model.terrain.unknownRegions.forEach((ring) =>
      addUnknownRegion(scene, ring.map((p) => lngLatToLocal(p, model.center)), groundY),
    );
  }
}

/** Free every geometry and material under `group`, then empty it. */
export function disposeGroup(group: THREE.Object3D) {
  group.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(material)) {
      material.forEach((m) => {
        (m as THREE.MeshStandardMaterial).map?.dispose();
        m.dispose();
      });
    } else if (material) {
      (material as THREE.MeshStandardMaterial).map?.dispose();
      material.dispose();
    }
  });
  group.clear();
}
