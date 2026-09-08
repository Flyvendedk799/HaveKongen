import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { Layers3, Maximize2, Mountain, Sun } from "lucide-react";
import type { GardenDepthModel } from "@/lib/gardenDepth";
import {
  addLighting,
  boundsForModel,
  buildGardenScene,
  disposeGroup,
  makeSkyTexture,
  type ViewerToggles,
} from "./gardenTwinScene";

type Props = {
  model: GardenDepthModel | null;
  className?: string;
  compact?: boolean;
  /** Object id to highlight (matches GardenDepthObject.id) — used by the builder. */
  selectedId?: string | null;
};

/**
 * The garden twin.
 *
 * The renderer, camera and orbit controls are created once and kept. Only the
 * scene *contents* are rebuilt when the model changes, so placing an object no
 * longer throws away the viewpoint — previously the whole WebGL context was
 * disposed and recreated on every edit, and even on selecting an object, which
 * snapped the camera back to its default angle each time.
 */
export default function GardenTwinViewer({ model, className, compact = false, selectedId = null }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<THREE.Group | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<{ target: THREE.Vector3; update: () => void; dispose: () => void } | null>(null);
  const sunRef = useRef<THREE.DirectionalLight | null>(null);
  const framedRef = useRef(false);

  const [toggles, setToggles] = useState<ViewerToggles>({
    objects: true,
    heights: true,
    confidence: true,
    unknown: true,
  });

  const stats = useMemo(() => {
    if (!model) return null;
    return {
      objects: model.objects.length,
      areaM2: model.terrain.areaM2 ? Math.round(model.terrain.areaM2) : null,
      reliefM: model.terrain.elevation?.stats.reliefM ?? null,
      hasElevation: Boolean(model.terrain.elevation),
    };
  }, [model]);

  /** Point the camera at the whole garden. Called on first build and on demand. */
  const frame = useRef<() => void>(() => {});

  // ---- one-time setup: renderer, camera, controls, lights, sky -------------
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.background = makeSkyTexture();
    sceneRef.current = scene;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    // Without these the whole render is washed out: three 0.149 defaults to
    // linear output, so every sRGB colour is displayed too bright and chalky.
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 2000);
    cameraRef.current = camera;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    // Stop the camera dropping below the ground plane.
    controls.maxPolarAngle = Math.PI * 0.49;
    controlsRef.current = controls;

    const content = new THREE.Group();
    scene.add(content);
    contentRef.current = content;

    frame.current = () => {
      if (!model || !cameraRef.current) return;
      const bounds = boundsForModel(model);
      const size = Math.max(18, bounds.size);
      // A three-quarter view from above: enough angle to read heights, enough
      // height to see the whole plot.
      cameraRef.current.position.set(bounds.cx + size * 0.62, size * 0.62, bounds.cz + size * 0.82);
      controls.target.set(bounds.cx, 0, bounds.cz);
      controls.minDistance = Math.max(6, size * 0.28);
      controls.maxDistance = size * 3;
      controls.update();
    };

    const resize = () => {
      const rect = host.getBoundingClientRect();
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
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
      if (contentRef.current) disposeGroup(contentRef.current);
      sunRef.current?.dispose();
      sunRef.current = null;
      scene.background = null;
      renderer.dispose();
      renderer.domElement.remove();
      sceneRef.current = null;
      cameraRef.current = null;
      controlsRef.current = null;
      contentRef.current = null;
    };
    // Deliberately mount-only: rebuilding the renderer on every model change is
    // the bug this component had.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- contents: rebuilt when the garden or the toggles change -------------
  useEffect(() => {
    const scene = sceneRef.current;
    const content = contentRef.current;
    if (!scene || !content || !model) return;

    // The sun's shadow frustum is sized to the garden, so it is re-attached
    // whenever the garden's extent changes.
    const previousSun = sunRef.current;
    if (previousSun) {
      scene.remove(previousSun.target);
      scene.remove(previousSun);
      previousSun.dispose();
    }
    sunRef.current = addLighting(scene, boundsForModel(model));

    disposeGroup(content);
    buildGardenScene(content, model, toggles, selectedId);

    // Frame the garden the first time it appears, then leave the camera alone —
    // the whole point is that the user's viewpoint survives their edits.
    if (!framedRef.current) {
      framedRef.current = true;
      frame.current();
    }
  }, [model, toggles, selectedId]);

  if (!model || !stats) {
    return (
      <div className={`garden-twin-viewer garden-twin-viewer--empty ${className ?? ""}`}>
        <Layers3 size={22} />
        <span>3D-modellen bygges, når haven har en lukket græsflade.</span>
      </div>
    );
  }

  return (
    <div className={`garden-twin-viewer ${compact ? "garden-twin-viewer--compact" : ""} ${className ?? ""}`}>
      <div ref={hostRef} className="garden-twin-canvas" />

      {/* Facts a gardener cares about. The old HUD showed keyframe counts,
          route poses, motion scores and licence status — debug telemetry that
          had no business on a customer's screen. */}
      <div className="garden-twin-facts">
        {stats.areaM2 != null && <span>{stats.areaM2} m²</span>}
        <span>{stats.objects} {stats.objects === 1 ? "objekt" : "objekter"}</span>
        {stats.hasElevation && stats.reliefM != null && (
          <span><Mountain size={12} /> {stats.reliefM.toFixed(1)} m fald</span>
        )}
        {!stats.hasElevation && <span className="is-muted">fladt terræn — ingen højdedata</span>}
      </div>

      <div className="garden-twin-toggles" aria-label="3D-visning">
        <button
          type="button"
          className={toggles.heights ? "active" : ""}
          onClick={() => setToggles((prev) => ({ ...prev, heights: !prev.heights }))}
          title="Vis terrænfald og objekthøjder"
        >
          <Mountain size={13} /><span>Højder</span>
        </button>
        <button
          type="button"
          className={toggles.objects ? "active" : ""}
          onClick={() => setToggles((prev) => ({ ...prev, objects: !prev.objects }))}
          title="Vis objekter"
        >
          <Layers3 size={13} /><span>Objekter</span>
        </button>
        <button type="button" onClick={() => frame.current()} title="Centrér kameraet om haven">
          <Maximize2 size={13} /><span>Centrér</span>
        </button>
      </div>

      {!stats.hasElevation && (
        <div className="garden-twin-hint">
          <Sun size={13} /> Hent højdedata for rigtigt terrænfald og målte objekthøjder.
        </div>
      )}
    </div>
  );
}
