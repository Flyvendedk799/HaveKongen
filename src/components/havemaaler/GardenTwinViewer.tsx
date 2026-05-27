import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Box, Eye, Layers3, Map, Mountain, ShieldCheck } from "lucide-react";
import type { GardenDepthModel, GardenDepthObject, LocalPoint } from "@/lib/gardenDepth";
import { depthConfidenceLabel, lngLatToLocal } from "@/lib/gardenDepth";

type Props = {
  model: GardenDepthModel | null;
  className?: string;
  compact?: boolean;
};

type ViewerToggles = {
  objects: boolean;
  heights: boolean;
  confidence: boolean;
  unknown: boolean;
};

const OBJECT_COLORS: Record<string, number> = {
  tree: 0x4f8a54,
  hedge: 0x315c3a,
  shed: 0x9b7653,
  fence: 0xc6a96d,
  patio: 0x8a9295,
  bed: 0x7b5f45,
  steps: 0xd4c3a3,
  retaining_wall: 0x9c8f7f,
  water: 0x4a8fb4,
  furniture: 0xd88f4d,
  unknown_obstacle: 0x6c7180,
};

export default function GardenTwinViewer({ model, className, compact = false }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [toggles, setToggles] = useState<ViewerToggles>({
    objects: true,
    heights: true,
    confidence: true,
    unknown: true,
  });

  const stats = useMemo(() => {
    if (!model) return null;
    const scanObjects = model.objects.filter((object) => object.source === "user_scan" || object.source === "ai_reconstruction").length;
    const scanAligned = model.alignment.mode === "scan-anchored";
    const twinStatus = model.twin.status === "scan_aligned"
      ? "Scan-aligned"
      : model.twin.status === "needs_review"
        ? "Kræver review"
        : model.twin.status === "evidence_ready"
          ? "Evidens klar"
          : "Draft";
    return {
      objects: model.objects.length,
      confidence: Math.round(model.alignment.confidence * 100),
      quality: model.quality.score,
      grade: model.quality.grade,
      source: scanAligned || scanObjects ? "Full garden twin" : "Flad kort-preview",
      scanAligned,
      twinStatus,
      keyframes: model.twin.evidence.keyframeCount,
      routePoses: model.twin.evidence.routePoseCount ?? 0,
      motionScore: model.twin.evidence.motionScore ?? 0,
      unknownRegions: model.terrain.unknownRegions.length,
      modelName: model.twin.model.name,
      licenseReady: model.twin.model.commercialUseApproved,
      area: model.terrain.areaM2 ? `${Math.round(model.terrain.areaM2)} m2` : "ukendt areal",
    };
  }, [model]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !model) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf3f1ea);
    scene.fog = new THREE.Fog(0xf3f1ea, 120, 260);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 500);
    const bounds = boundsForModel(model);
    const size = Math.max(28, bounds.size);
    camera.position.set(bounds.cx + size * 0.7, size * 0.72, bounds.cz + size * 0.9);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.target.set(bounds.cx, 0, bounds.cz);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI * 0.48;
    controls.minDistance = Math.max(12, size * 0.35);
    controls.maxDistance = Math.max(70, size * 2.2);

    scene.add(new THREE.HemisphereLight(0xfaf3df, 0x64756a, 2.1));
    const sun = new THREE.DirectionalLight(0xfff1c2, 2.5);
    sun.position.set(bounds.cx - 22, 45, bounds.cz + 28);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    scene.add(sun);

    addGround(scene, model);
    addBoundary(scene, model.terrain.localBoundary, 0xedc88b);
    model.terrain.localLawnRings.forEach((ring) => addRingLine(scene, ring, 0x2d6c42, 0.08));
    model.captureReadiness.anchorSuggestions.forEach((anchor) => addAnchorMarker(scene, anchor.local));

    if (toggles.objects) {
      model.objects.forEach((object) => addObject(scene, object, toggles));
    }
    if (toggles.unknown) {
      model.terrain.unknownRegions.forEach((ring) => addUnknownRegion(scene, ring.map((point) => lngLatToLocal(point, model.center))));
    }

    const grid = new THREE.GridHelper(Math.max(40, Math.ceil(size / 10) * 10), Math.max(8, Math.ceil(size / 5)), 0xd8c99e, 0xe7dfc8);
    grid.position.set(bounds.cx, -0.03, bounds.cz);
    scene.add(grid);

    const resize = () => {
      const rect = host.getBoundingClientRect();
      renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
      camera.aspect = Math.max(1, rect.width) / Math.max(1, rect.height);
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(host);

    let raf = 0;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      raf = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line) {
          object.geometry?.dispose();
          const material = object.material;
          if (Array.isArray(material)) material.forEach((m) => m.dispose());
          else material?.dispose();
        }
      });
      renderer.domElement.remove();
    };
  }, [model, toggles]);

  if (!model || !stats) {
    return (
      <div className={`garden-twin-viewer garden-twin-viewer--empty ${className ?? ""}`}>
        <Layers3 size={22} />
        <span>3D-modellen bygges, når haven har en lukket græsflade.</span>
      </div>
    );
  }

  const warningCount = model.warnings.length;

  return (
    <div className={`garden-twin-viewer ${compact ? "garden-twin-viewer--compact" : ""} ${className ?? ""}`}>
      <div ref={hostRef} className="garden-twin-canvas" />
      <div className="garden-twin-hud">
        <div>
          <div className="garden-twin-eyebrow">3D Garden Twin</div>
          <strong>{model.name || "Din have"}</strong>
          <span>{stats.source} · {stats.twinStatus} · {stats.area} · {stats.grade}</span>
        </div>
        <div className="garden-twin-kpis">
          <span><Box size={13} /> {stats.objects} objekter</span>
          <span><ShieldCheck size={13} /> {stats.scanAligned ? `${stats.confidence}% alignment` : "ikke scannet"}</span>
          <span><Mountain size={13} /> {stats.quality}/100 kvalitet</span>
          {stats.keyframes > 0 && <span><Layers3 size={13} /> {stats.keyframes} keyframes</span>}
          {stats.routePoses > 0 && <span><Map size={13} /> {stats.routePoses} route-poser</span>}
          {stats.motionScore > 0 && <span><Eye size={13} /> {Math.round(stats.motionScore * 100)}% motion</span>}
          {warningCount > 0 && <span><Eye size={13} /> {warningCount} estimater</span>}
        </div>
      </div>
      {!stats.scanAligned && (
        <div className="garden-twin-unscanned">
          Flad preview fra 2D-kortet. Højder, træer, hegn og forhindringer kommer først efter en scan-anchored garden twin.
        </div>
      )}
      {stats.scanAligned && (model.twin.status === "needs_review" || stats.unknownRegions > 0 || !stats.licenseReady) && (
        <div className="garden-twin-unscanned">
          Truthful confidence: {stats.unknownRegions} ukendte regioner · model {stats.modelName}{stats.licenseReady ? "" : " · licens mangler prod-godkendelse"}.
        </div>
      )}
      <div className="garden-twin-toggles" aria-label="3D lag">
        <Toggle active={toggles.objects} icon={<Layers3 size={14} />} label="Objekter" onClick={() => setToggles((prev) => ({ ...prev, objects: !prev.objects }))} />
        <Toggle active={toggles.heights} icon={<Mountain size={14} />} label="Højde" onClick={() => setToggles((prev) => ({ ...prev, heights: !prev.heights }))} />
        <Toggle active={toggles.confidence} icon={<ShieldCheck size={14} />} label="Sikkerhed" onClick={() => setToggles((prev) => ({ ...prev, confidence: !prev.confidence }))} />
        <Toggle active={toggles.unknown} icon={<Eye size={14} />} label="Ukendt" onClick={() => setToggles((prev) => ({ ...prev, unknown: !prev.unknown }))} />
      </div>
      {!compact && (
        <div className="garden-twin-legend">
          {model.objects.slice(0, 4).map((object) => (
            <span key={object.id}>
              <i style={{ background: `#${(OBJECT_COLORS[object.type] ?? 0x6c7180).toString(16).padStart(6, "0")}` }} />
              {object.label} · {depthConfidenceLabel(object.confidence)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Toggle({ active, icon, label, onClick }: { active: boolean; icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button className={active ? "active" : ""} onClick={onClick} type="button">
      {icon}
      <span>{label}</span>
    </button>
  );
}

function addGround(scene: THREE.Scene, model: GardenDepthModel) {
  for (const ring of model.terrain.localLawnRings) {
    if (ring.length < 3) continue;
    const shape = new THREE.Shape(ring.map((point) => new THREE.Vector2(point.x, point.z)));
    const geometry = new THREE.ShapeGeometry(shape);
    geometry.rotateX(Math.PI / 2);
    const material = new THREE.MeshStandardMaterial({
      color: 0x7fa07e,
      roughness: 0.95,
      metalness: 0,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    scene.add(mesh);
  }
}

function addObject(scene: THREE.Scene, object: GardenDepthObject, toggles: ViewerToggles) {
  const bounds = boundsForPoints(object.localFootprint);
  if (!Number.isFinite(bounds.width) || bounds.width <= 0 || bounds.depth <= 0) return;
  const height = toggles.heights
    ? object.heightM ?? ((object.heightRangeM?.[0] ?? 0.4) + (object.heightRangeM?.[1] ?? 1.2)) / 2
    : 0.12;
  const color = OBJECT_COLORS[object.type] ?? OBJECT_COLORS.unknown_obstacle;
  const opacity = toggles.confidence ? 0.34 + object.confidence * 0.55 : 0.82;
  if (object.type === "tree" && toggles.heights) {
    const trunkHeight = Math.max(0.7, height * 0.32);
    const canopyRadius = Math.max(0.65, Math.min(bounds.width, bounds.depth, height * 0.42));
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.24, trunkHeight, 8),
      new THREE.MeshStandardMaterial({ color: 0x6f5135, roughness: 0.9 }),
    );
    trunk.position.set(bounds.cx, trunkHeight / 2, bounds.cz);
    trunk.castShadow = true;
    scene.add(trunk);
    const canopy = new THREE.Mesh(
      new THREE.SphereGeometry(canopyRadius, 18, 12),
      new THREE.MeshStandardMaterial({ color, transparent: true, opacity, roughness: 0.95 }),
    );
    canopy.scale.y = 0.72;
    canopy.position.set(bounds.cx, trunkHeight + canopyRadius * 0.52, bounds.cz);
    canopy.castShadow = true;
    canopy.receiveShadow = true;
    scene.add(canopy);
    return;
  }

  if (object.type === "water") {
    const water = new THREE.Mesh(
      new THREE.BoxGeometry(Math.max(0.35, bounds.width), 0.04, Math.max(0.35, bounds.depth)),
      new THREE.MeshStandardMaterial({ color, transparent: true, opacity: 0.68, roughness: 0.25, metalness: 0.15 }),
    );
    water.position.set(bounds.cx, 0.03, bounds.cz);
    scene.add(water);
    return;
  }

  const geometry = new THREE.BoxGeometry(Math.max(0.35, bounds.width), Math.max(0.08, height), Math.max(0.35, bounds.depth));
  const material = new THREE.MeshStandardMaterial({
    color,
    transparent: opacity < 1,
    opacity,
    roughness: 0.82,
    metalness: 0.02,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(bounds.cx, Math.max(0.08, height) / 2, bounds.cz);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
}

function addAnchorMarker(scene: THREE.Scene, point: LocalPoint) {
  const geometry = new THREE.CylinderGeometry(0.28, 0.28, 0.08, 16);
  const material = new THREE.MeshBasicMaterial({ color: 0xedc88b, transparent: true, opacity: 0.82 });
  const marker = new THREE.Mesh(geometry, material);
  marker.position.set(point.x, 0.12, point.z);
  scene.add(marker);
  const ring = new THREE.RingGeometry(0.42, 0.52, 24);
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xedc88b, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
  const halo = new THREE.Mesh(ring, ringMat);
  halo.rotation.x = -Math.PI / 2;
  halo.position.set(point.x, 0.15, point.z);
  scene.add(halo);
}

function addBoundary(scene: THREE.Scene, ring: LocalPoint[], color: number) {
  addRingLine(scene, ring, color, 0.16);
}

function addRingLine(scene: THREE.Scene, ring: LocalPoint[], color: number, y: number) {
  if (ring.length < 2) return;
  const points = [...ring, ring[0]].map((point) => new THREE.Vector3(point.x, y, point.z));
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({ color, linewidth: 2 });
  scene.add(new THREE.Line(geometry, material));
}

function addUnknownRegion(scene: THREE.Scene, ring: LocalPoint[]) {
  const bounds = boundsForPoints(ring);
  const geometry = new THREE.BoxGeometry(Math.max(0.3, bounds.width), 0.05, Math.max(0.3, bounds.depth));
  const material = new THREE.MeshBasicMaterial({ color: 0x3f4650, transparent: true, opacity: 0.22 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(bounds.cx, 0.05, bounds.cz);
  scene.add(mesh);
}

function boundsForModel(model: GardenDepthModel) {
  const points = [
    ...model.terrain.localBoundary,
    ...model.terrain.localLawnRings.flat(),
    ...model.objects.flatMap((object) => object.localFootprint),
  ];
  return boundsForPoints(points);
}

function boundsForPoints(points: LocalPoint[]) {
  if (!points.length) return { minX: -10, maxX: 10, minZ: -10, maxZ: 10, width: 20, depth: 20, cx: 0, cz: 0, size: 20 };
  const xs = points.map((point) => point.x);
  const zs = points.map((point) => point.z);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const width = Math.max(1, maxX - minX);
  const depth = Math.max(1, maxZ - minZ);
  return {
    minX,
    maxX,
    minZ,
    maxZ,
    width,
    depth,
    cx: (minX + maxX) / 2,
    cz: (minZ + maxZ) / 2,
    size: Math.max(width, depth),
  };
}
