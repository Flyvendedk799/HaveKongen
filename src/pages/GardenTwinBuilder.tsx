import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  Layers3,
  Loader2,
  MapPin,
  Mountain,
  PenLine,
  Redo2,
  RotateCw,
  Ruler,
  Save,
  Sparkles,
  Trash2,
  Undo2,
  Wand2,
  X,
} from "lucide-react";

import { AppNav, SiteFooter } from "@/components/layout/SiteChrome";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useAuth } from "@/lib/auth";
import { useActiveGarden } from "@/lib/activeGarden";
import { MAP_GLYPHS, ORTOFOTO_ATTRIBUTION, ortofotoTileTemplate } from "@/lib/ortofoto";
import GardenTwinViewer from "@/components/havemaaler/GardenTwinViewer";
import {
  buildGardenTwinModel,
  coerceGardenDepthModel,
  depthModelToJson,
  summarizeDepthModel,
  type GardenObjectInput,
} from "@/lib/gardenDepth";
import {
  centerFromRings,
  exclusionRingsFromJson,
  ringsFromGeoJson,
  type LngLat,
  type Ring,
} from "@/lib/havemaalerGeometry";
import * as turf from "@turf/turf";
import {
  detectObjectsFromElevation,
  fetchElevationField,
  measuredObjectHeight,
  slopeLabel,
  terrainSlopeStats,
  type ElevationField,
} from "@/lib/gardenElevation";
import {
  BUILDER_PALETTE,
  OBJECT_SPECS,
  applyHandleDrag,
  clampHeight,
  createLinearObject,
  createPlacedObject,
  makeFootprint,
  metersBetween,
  nudgeObject,
  placedFromSuggestion,
  placedObjectFootprint,
  segmentRotationDeg,
  suggestionFootprint,
  suggestionsFromDetections,
  transformHandlesFor,
  updatePlacedObject,
  type BuilderObjectType,
  type ObjectSuggestion,
  type PlacedObject,
  type TransformHandleKind,
} from "@/lib/gardenBuilder";

type SavedGarden = Pick<Tables<"gardens">, "id" | "name" | "address" | "latitude" | "longitude" | "area_m2" | "polygon" | "exclusions" | "imagery_source" | "depth_model">;
type ElevationStatus = "idle" | "loading" | "ready" | "unavailable";

function ringCentroid(ring: Ring): LngLat {
  let lng = 0;
  let lat = 0;
  for (const [x, y] of ring) {
    lng += x;
    lat += y;
  }
  return [lng / ring.length, lat / ring.length];
}

function placedToInput(object: PlacedObject): GardenObjectInput {
  return {
    id: object.id,
    type: object.type,
    label: object.label,
    footprint: placedObjectFootprint(object),
    heightM: object.heightM,
    confidence: object.confidence,
    source: object.heightSource === "dhm_measured" ? "elevation_model" : "manual",
  };
}

// Reconstruct editable objects from a previously saved twin so re-editing works.
function placedFromSavedModel(value: unknown): PlacedObject[] {
  const model = coerceGardenDepthModel(value);
  if (!model || model.alignment.mode !== "elevation-model") return [];
  return model.objects
    .filter((object) => object.footprint.length >= 3 && object.label !== "Udeladt område")
    .map((object) => {
      const type = (object.type in OBJECT_SPECS ? object.type : "unknown_obstacle") as BuilderObjectType;
      const dims = object.dimensionsM ?? { width: OBJECT_SPECS[type].widthM, depth: OBJECT_SPECS[type].depthM };
      // Rectangular footprints start with the width edge, so its direction is the rotation.
      const rotationDeg = object.footprint.length === 4
        ? Math.round(segmentRotationDeg(object.footprint[0], object.footprint[1]))
        : 0;
      return createPlacedObject(type, ringCentroid(object.footprint), {
        id: object.id,
        widthM: dims.width,
        depthM: dims.depth,
        heightM: object.heightM ?? OBJECT_SPECS[type].heightM,
        rotationDeg,
        heightSource: object.source === "elevation_model" ? "dhm_measured" : "user",
        confidence: object.confidence,
      });
    });
}

export default function GardenTwinBuilder() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setActive } = useActiveGarden();
  const gardenId = searchParams.get("garden") ?? searchParams.get("gardenId") ?? searchParams.get("garden_id");

  const [ortoCfg, setOrtoCfg] = useState<{ wmsTemplate: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [garden, setGarden] = useState<SavedGarden | null>(null);
  const [lawnRings, setLawnRings] = useState<Ring[]>([]);
  const [exclusions, setExclusions] = useState<Ring[]>([]);
  const [center, setCenter] = useState<LngLat | null>(null);

  const [elevation, setElevation] = useState<ElevationField | null>(null);
  const [elevationStatus, setElevationStatus] = useState<ElevationStatus>("idle");

  const [objects, setObjects] = useState<PlacedObject[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [placingType, setPlacingType] = useState<BuilderObjectType | null>(null);
  const [lineStart, setLineStart] = useState<LngLat | null>(null);
  const [view, setView] = useState<"map" | "3d">("map");

  // Auto-detected objects waiting for the user's accept/dismiss verdict.
  const [suggestions, setSuggestions] = useState<ObjectSuggestion[]>([]);
  const [selectedSuggestionId, setSelectedSuggestionId] = useState<string | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectionRan, setDetectionRan] = useState(false);
  const dismissedRef = useRef<LngLat[]>([]);

  const [dirty, setDirty] = useState(false);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  // Bumped when a handle drag ends, so the map re-syncs without an object change.
  const [handleTick, setHandleTick] = useState(0);

  const mapRef = useRef<maplibregl.Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef<string | null>(null);
  // Active transform-handle drag (resize/rotate/endpoint) on the selected object.
  const transformRef = useRef<{ id: string; kind: TransformHandleKind } | null>(null);
  // Snapshot lazily on the first real move, so a plain click-to-select never
  // pollutes undo history; suppress the click that follows a finished drag.
  const dragMovedRef = useRef(false);
  const suppressClickRef = useRef(false);
  const lastCursorRef = useRef<LngLat | null>(null);

  const areaM2 = garden?.area_m2 ?? (lawnRings.length ? Math.round(lawnRings.reduce((sum, ring) => sum + turf.area(turf.polygon([[...ring, ring[0]]])), 0)) : null);

  const model = useMemo(() => {
    if (!lawnRings.length || !center) return null;
    return buildGardenTwinModel({
      gardenId: garden?.id ?? null,
      name: garden?.name ?? "Min have",
      center,
      lawnRings,
      exclusions,
      areaM2,
      elevation,
      objects: objects.map(placedToInput),
    });
  }, [garden?.id, garden?.name, center, lawnRings, exclusions, areaM2, elevation, objects]);

  const selected = objects.find((object) => object.id === selectedId) ?? null;
  const selectedSuggestion = suggestions.find((suggestion) => suggestion.id === selectedSuggestionId) ?? null;
  const summary = model ? summarizeDepthModel(model) : null;
  const slope = useMemo(() => (elevation ? terrainSlopeStats(elevation) : null), [elevation]);

  // ----- Imagery config -----
  useEffect(() => {
    const template = ortofotoTileTemplate();
    if (!template) {
      toast.error("Kortet er ikke konfigureret");
      return;
    }
    supabase.functions.invoke("get-ortofoto-config").then(({ data, error }) => {
      if (error || data?.available === false) {
        toast.error("Kunne ikke hente luftfoto");
        return;
      }
      setOrtoCfg({ wmsTemplate: template });
    }).catch(() => toast.error("Kunne ikke hente luftfoto"));
  }, []);

  // ----- Auth gate -----
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      const next = encodeURIComponent(window.location.pathname + window.location.search);
      navigate(`/login?next=${next}`);
    }
  }, [authLoading, user, navigate]);

  // ----- Load the saved garden -----
  useEffect(() => {
    if (!user || !gardenId) {
      if (!gardenId) setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("gardens")
        .select("id, name, address, latitude, longitude, area_m2, polygon, exclusions, imagery_source, depth_model")
        .eq("id", gardenId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) {
        toast.error("Kunne ikke hente haven");
        setLoading(false);
        return;
      }
      const saved = data as SavedGarden;
      const rings = ringsFromGeoJson(saved.polygon);
      if (!rings.length) {
        toast.error("Haven mangler en tegnet græsflade. Tegn den i Havemåler først.");
        setLoading(false);
        return;
      }
      const savedCenter = saved.longitude != null && saved.latitude != null
        ? [saved.longitude, saved.latitude] as LngLat
        : centerFromRings(rings);
      setGarden(saved);
      setLawnRings(rings);
      setExclusions(exclusionRingsFromJson(saved.exclusions));
      setCenter(savedCenter);
      setActive(saved.id);
      const restored = placedFromSavedModel(saved.depth_model);
      setObjects(restored);
      if (restored.length) setSavedAt(new Date());
      // Reuse elevation from a previous build instead of re-fetching when present.
      const previous = coerceGardenDepthModel(saved.depth_model);
      if (previous?.terrain.elevation) {
        const e = previous.terrain.elevation;
        setElevation({ source: "dhm", cols: e.cols, rows: e.rows, bbox: e.bbox, terrain: e.terrain, surface: null, stats: e.stats, resolutionM: e.resolutionM, confidence: e.confidence });
        setElevationStatus("ready");
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, gardenId]);

  // ----- Fetch DHM elevation once the lawn is known -----
  const loadElevation = useCallback(async (silent = false): Promise<ElevationField | null> => {
    if (!lawnRings.length) return null;
    setElevationStatus("loading");
    const polygon = lawnRings[0];
    const result = await fetchElevationField(polygon, (body) => supabase.functions.invoke("get-elevation", { body }));
    if (result.available) {
      setElevation(result.field);
      setElevationStatus("ready");
      // Re-measure heights for measurable objects that the user hasn't overridden.
      setObjects((prev) => prev.map((object) => {
        if (object.heightSource === "user" || !OBJECT_SPECS[object.type].measurable) return object;
        const measured = measuredObjectHeight(result.field, placedObjectFootprint(object));
        if (measured == null) return object;
        return updatePlacedObject(object, { heightM: clampHeight(object.type, measured), heightSource: "dhm_measured" });
      }));
      if (!silent) {
        toast.success("Højdedata hentet", {
          description: `${slopeLabel(result.field.stats.reliefM)} · ${result.field.stats.reliefM.toFixed(2)} m terrænfald i haven.`,
        });
      }
      return result.field;
    }
    setElevationStatus("unavailable");
    if (!silent) {
      toast("Ingen højdedata for adressen", { description: "Du kan stadig bygge haven — terrænet vises fladt og højder sættes manuelt." });
    }
    return null;
  }, [lawnRings]);

  useEffect(() => {
    if (lawnRings.length && elevationStatus === "idle") {
      void loadElevation(true);
    }
  }, [lawnRings, elevationStatus, loadElevation]);

  // Auto-detect once, the first time fresh DHM surface data arrives for a garden
  // with no objects yet. Detection only *suggests* — the user reviews every find.
  const autoDetectedRef = useRef(false);
  useEffect(() => {
    if (autoDetectedRef.current) return;
    if (elevationStatus === "ready" && elevation?.surface && stateRef.current.objects.length === 0) {
      autoDetectedRef.current = true;
      void runDetection(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elevationStatus, elevation]);

  // ----- Map setup -----
  const buildStyle = useCallback((): maplibregl.StyleSpecification => ({
    version: 8,
    glyphs: MAP_GLYPHS,
    sources: ortoCfg
      ? {
        orto: {
          type: "raster",
          tiles: [ortoCfg.wmsTemplate],
          tileSize: 512,
          attribution: ORTOFOTO_ATTRIBUTION,
        },
      }
      : {},
    layers: [
      { id: "ground", type: "background", paint: { "background-color": "#0f1f18" } },
      ...(ortoCfg
        ? [{ id: "orto", type: "raster" as const, source: "orto", paint: { "raster-opacity": 1 } }]
        : []),
    ],
  }), [ortoCfg]);

  // The map is created once and stays alive while the user peeks at 3D, so
  // camera position and loaded tiles survive view switches.
  useEffect(() => {
    if (!center || !ortoCfg || !containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildStyle(),
      center,
      zoom: 19,
      minZoom: 14,
      maxZoom: 21,
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;
    map.on("load", () => {
      addLayers();
      syncMap();
      const bounds = new maplibregl.LngLatBounds();
      lawnRings.flat().forEach((point) => bounds.extend(point));
      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 70, maxZoom: 20.2, duration: 0 });
    });
    map.on("click", onMapClick);
    // Handle listeners are registered before the object listeners so a grab on
    // a handle that overlaps the footprint wins.
    map.on("mousedown", "handle-pt", onHandlePointerDown);
    map.on("touchstart", "handle-pt", onHandlePointerDown);
    map.on("mousedown", "obj-pt-circle", onObjectPointerDown);
    map.on("mousedown", "obj-foot-fill", onObjectPointerDown);
    map.on("touchstart", "obj-pt-circle", onObjectPointerDown);
    map.on("touchstart", "obj-foot-fill", onObjectPointerDown);
    map.on("mousemove", onMapMouseMove);
    map.on("touchmove", onMapTouchMove);
    map.on("mouseup", endDrag);
    map.on("touchend", endDrag);
    map.on("touchcancel", endDrag);
    map.on("mouseout", () => updateGhost(null));
    const canvas = map.getCanvas();
    const hoverOn = () => { if (!stateRef.current.placingType && !draggingRef.current && !transformRef.current) canvas.style.cursor = "move"; };
    const hoverOff = () => { canvas.style.cursor = stateRef.current.placingType ? "crosshair" : ""; };
    map.on("mouseenter", "obj-foot-fill", hoverOn);
    map.on("mouseleave", "obj-foot-fill", hoverOff);
    map.on("mouseenter", "obj-pt-circle", hoverOn);
    map.on("mouseleave", "obj-pt-circle", hoverOff);
    map.on("mouseenter", "sug-fill", () => { if (!stateRef.current.placingType) canvas.style.cursor = "pointer"; });
    map.on("mouseleave", "sug-fill", hoverOff);
    map.on("mouseenter", "handle-pt", (e) => {
      if (stateRef.current.placingType) return;
      const kind = e.features?.[0]?.properties?.kind as TransformHandleKind | undefined;
      canvas.style.cursor = kind === "rotate" ? "grab"
        : kind === "end-a" || kind === "end-b" ? "move"
        : kind === "edge-e" || kind === "edge-w" ? "ew-resize"
        : kind === "edge-n" || kind === "edge-s" ? "ns-resize"
        : "nwse-resize";
    });
    map.on("mouseleave", "handle-pt", hoverOff);
    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center, ortoCfg]);

  function addLayers() {
    const map = mapRef.current;
    if (!map) return;
    const empty: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
    if (!map.getSource("lawn")) {
      map.addSource("lawn", { type: "geojson", data: empty });
      map.addLayer({ id: "lawn-fill", type: "fill", source: "lawn", paint: { "fill-color": "#7fa07e", "fill-opacity": 0.28 } });
      map.addLayer({ id: "lawn-line", type: "line", source: "lawn", paint: { "line-color": "#edc88b", "line-width": 2 } });
    }
    if (!map.getSource("excl")) {
      map.addSource("excl", { type: "geojson", data: empty });
      map.addLayer({ id: "excl-fill", type: "fill", source: "excl", paint: { "fill-color": "#14271d", "fill-opacity": 0.45 } });
    }
    if (!map.getSource("obj-foot")) {
      map.addSource("obj-foot", { type: "geojson", data: empty });
      map.addLayer({ id: "obj-foot-fill", type: "fill", source: "obj-foot", paint: { "fill-color": ["get", "color"], "fill-opacity": ["case", ["get", "selected"], 0.5, 0.3] } });
      map.addLayer({ id: "obj-foot-line", type: "line", source: "obj-foot", paint: { "line-color": ["case", ["get", "selected"], "#fff0a8", ["get", "color"]], "line-width": ["case", ["get", "selected"], 2.5, 1.4] } });
    }
    // Auto-detected suggestions: dashed gold, visually "pending" until accepted.
    if (!map.getSource("sug")) {
      map.addSource("sug", { type: "geojson", data: empty });
      map.addLayer({ id: "sug-fill", type: "fill", source: "sug", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": ["get", "color"], "fill-opacity": ["case", ["get", "selected"], 0.32, 0.16] } });
      map.addLayer({ id: "sug-line", type: "line", source: "sug", filter: ["==", ["geometry-type"], "Polygon"], paint: { "line-color": ["case", ["get", "selected"], "#fff0a8", "#edc88b"], "line-width": ["case", ["get", "selected"], 2.6, 1.8], "line-dasharray": [2, 1.6] } });
      map.addLayer({
        id: "sug-label",
        type: "symbol",
        source: "sug",
        filter: ["==", ["geometry-type"], "Point"],
        layout: { "text-field": ["get", "label"], "text-size": 11, "text-offset": [0, 1.1], "text-anchor": "top", "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"] },
        paint: { "text-color": "#ffe9b8", "text-halo-color": "#14271d", "text-halo-width": 1.4 },
      });
    }
    if (!map.getSource("obj-pt")) {
      map.addSource("obj-pt", { type: "geojson", data: empty });
      map.addLayer({
        id: "obj-pt-circle",
        type: "circle",
        source: "obj-pt",
        paint: {
          "circle-radius": ["case", ["get", "selected"], 9, 7],
          "circle-color": ["get", "color"],
          "circle-stroke-color": ["case", ["get", "selected"], "#fff0a8", "#14271d"],
          "circle-stroke-width": 2,
        },
      });
      map.addLayer({
        id: "obj-pt-label",
        type: "symbol",
        source: "obj-pt",
        layout: { "text-field": ["get", "label"], "text-size": 11, "text-offset": [0, 1.2], "text-anchor": "top", "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"] },
        paint: { "text-color": "#fff7e0", "text-halo-color": "#14271d", "text-halo-width": 1.4 },
      });
    }
    // Transform handles for the selected object (rendered above everything).
    if (!map.getSource("handles")) {
      map.addSource("handles", { type: "geojson", data: empty });
      map.addLayer({
        id: "handle-connector",
        type: "line",
        source: "handles",
        filter: ["==", ["geometry-type"], "LineString"],
        paint: { "line-color": "#fff0a8", "line-width": 1.4, "line-dasharray": [1.2, 1.2] },
      });
      map.addLayer({
        id: "handle-pt",
        type: "circle",
        source: "handles",
        filter: ["all", ["==", ["geometry-type"], "Point"], ["!=", ["get", "kind"], "label"]],
        paint: {
          "circle-radius": ["match", ["get", "role"], "rotate", 7, "end", 7, "corner", 6, 5],
          "circle-color": ["match", ["get", "role"], "rotate", "#edc88b", "end", "#edc88b", "#ffffff"],
          "circle-stroke-color": "#14271d",
          "circle-stroke-width": 2,
        },
      });
      map.addLayer({
        id: "handle-label",
        type: "symbol",
        source: "handles",
        filter: ["all", ["==", ["geometry-type"], "Point"], ["==", ["get", "kind"], "label"]],
        layout: {
          "text-field": ["get", "label"],
          "text-size": 13,
          "text-offset": [0, -1.4],
          "text-anchor": "bottom",
          "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
          "text-allow-overlap": true,
        },
        paint: { "text-color": "#fff7e0", "text-halo-color": "#14271d", "text-halo-width": 1.6 },
      });
    }
    // Live preview of the object about to be placed (follows the cursor).
    if (!map.getSource("ghost")) {
      map.addSource("ghost", { type: "geojson", data: empty });
      map.addLayer({ id: "ghost-fill", type: "fill", source: "ghost", filter: ["==", ["geometry-type"], "Polygon"], paint: { "fill-color": ["get", "color"], "fill-opacity": 0.22 } });
      map.addLayer({ id: "ghost-line", type: "line", source: "ghost", filter: ["any", ["==", ["geometry-type"], "Polygon"], ["==", ["geometry-type"], "LineString"]], paint: { "line-color": "#edc88b", "line-width": 1.8, "line-dasharray": [1.6, 1.4] } });
      map.addLayer({ id: "ghost-pt", type: "circle", source: "ghost", filter: ["==", ["geometry-type"], "Point"], paint: { "circle-radius": 5, "circle-color": "#edc88b", "circle-stroke-color": "#14271d", "circle-stroke-width": 1.5 } });
    }
  }

  const stateRef = useRef({ objects, selectedId, placingType, suggestions, selectedSuggestionId, lineStart });
  useEffect(() => { stateRef.current = { objects, selectedId, placingType, suggestions, selectedSuggestionId, lineStart }; });
  // Map event handlers are registered once, so read elevation via a ref to avoid
  // a stale closure when DHM data arrives after the map is created.
  const elevationRef = useRef<ElevationField | null>(elevation);
  useEffect(() => { elevationRef.current = elevation; }, [elevation]);

  // ----- Undo / redo over the object list -----
  const pastRef = useRef<PlacedObject[][]>([]);
  const futureRef = useRef<PlacedObject[][]>([]);
  const [historyTick, setHistoryTick] = useState(0);
  function snapshot() {
    pastRef.current.push(stateRef.current.objects.map((o) => ({ ...o })));
    if (pastRef.current.length > 80) pastRef.current.shift();
    futureRef.current = [];
    setHistoryTick((t) => t + 1);
    setDirty(true);
  }
  function commit(next: PlacedObject[]) {
    snapshot();
    setObjects(next);
  }
  function undo() {
    if (!pastRef.current.length) return;
    futureRef.current.push(stateRef.current.objects.map((o) => ({ ...o })));
    setObjects(pastRef.current.pop()!);
    setHistoryTick((t) => t + 1);
    setDirty(true);
  }
  function redo() {
    if (!futureRef.current.length) return;
    pastRef.current.push(stateRef.current.objects.map((o) => ({ ...o })));
    setObjects(futureRef.current.pop()!);
    setHistoryTick((t) => t + 1);
    setDirty(true);
  }
  const canUndo = pastRef.current.length > 0;
  const canRedo = futureRef.current.length > 0;
  void historyTick;

  // ----- Ghost preview -----
  function updateGhost(cursor: LngLat | null) {
    const map = mapRef.current;
    if (!map || !map.getSource("ghost")) return;
    lastCursorRef.current = cursor ?? lastCursorRef.current;
    const s = stateRef.current;
    const features: GeoJSON.Feature[] = [];
    if (cursor && s.placingType && !draggingRef.current) {
      const spec = OBJECT_SPECS[s.placingType];
      if (spec.placement === "line") {
        if (s.lineStart) {
          const lengthM = Math.max(0.5, metersBetween(s.lineStart, cursor));
          const mid: LngLat = [(s.lineStart[0] + cursor[0]) / 2, (s.lineStart[1] + cursor[1]) / 2];
          const ring = makeFootprint(mid, lengthM, spec.depthM, segmentRotationDeg(s.lineStart, cursor));
          features.push({ type: "Feature", properties: { color: spec.color }, geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] } });
          features.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [s.lineStart, cursor] } });
        } else {
          features.push({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: cursor } });
        }
      } else {
        const ring = makeFootprint(cursor, spec.widthM, spec.depthM, 0);
        features.push({ type: "Feature", properties: { color: spec.color }, geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] } });
      }
    }
    if (s.lineStart && s.placingType) {
      features.push({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: s.lineStart } });
    }
    (map.getSource("ghost") as maplibregl.GeoJSONSource)?.setData({ type: "FeatureCollection", features });
  }

  // Placement mode changed: reset any half-drawn line, refresh cursor + ghost.
  useEffect(() => {
    setLineStart(null);
    const canvas = mapRef.current?.getCanvas();
    if (canvas) canvas.style.cursor = placingType ? "crosshair" : "";
  }, [placingType]);
  useEffect(() => {
    updateGhost(placingType ? lastCursorRef.current : null);
  }, [placingType, lineStart]);

  // ----- Map interactions -----
  function queryIds(map: maplibregl.Map, point: maplibregl.PointLike, layerIds: string[]): string | null {
    const present = layerIds.filter((id) => map.getLayer(id));
    if (!present.length) return null;
    const hit = map.queryRenderedFeatures(point, { layers: present });
    return hit.map((f) => f.properties?.id).find((value): value is string => typeof value === "string") ?? null;
  }

  function onMapClick(e: maplibregl.MapMouseEvent) {
    if (suppressClickRef.current) return;
    const map = mapRef.current!;
    const ll: LngLat = [e.lngLat.lng, e.lngLat.lat];
    const s = stateRef.current;
    if (s.placingType) {
      const spec = OBJECT_SPECS[s.placingType];
      if (spec.placement === "line") {
        if (!s.lineStart) {
          setLineStart(ll);
          return;
        }
        if (metersBetween(s.lineStart, ll) < 0.4) return;
        placeLinear(s.placingType, s.lineStart, ll);
        setLineStart(ll); // chain the next segment from here (fences follow the skel)
        return;
      }
      placeObject(s.placingType, ll);
      return;
    }
    // A click on a handle (grab without moving) must not change the selection.
    if (map.getLayer("handle-pt") && map.queryRenderedFeatures(e.point, { layers: ["handle-pt"] }).length) return;
    const sugId = queryIds(map, e.point, ["sug-fill"]);
    if (sugId) {
      setSelectedSuggestionId(sugId);
      setSelectedId(null);
      return;
    }
    const id = queryIds(map, e.point, ["obj-pt-circle", "obj-foot-fill"]);
    setSelectedId(id);
    setSelectedSuggestionId(null);
  }

  function onHandlePointerDown(e: maplibregl.MapLayerMouseEvent | maplibregl.MapLayerTouchEvent) {
    const map = mapRef.current!;
    if (stateRef.current.placingType || draggingRef.current || transformRef.current) return;
    const id = stateRef.current.selectedId;
    const kind = e.features?.[0]?.properties?.kind as TransformHandleKind | undefined;
    if (!id || !kind) return;
    transformRef.current = { id, kind };
    dragMovedRef.current = false;
    map.dragPan.disable();
    e.preventDefault();
  }

  function applyTransform(ll: LngLat, snap: boolean) {
    const transform = transformRef.current;
    if (!transform) return;
    if (!dragMovedRef.current) {
      dragMovedRef.current = true;
      snapshot(); // one undo step restores the pre-transform shape
    }
    setObjects((prev) => prev.map((object) => object.id === transform.id
      ? applyHandleDrag(object, transform.kind, ll, { snap })
      : object));
  }

  function onObjectPointerDown(e: maplibregl.MapLayerMouseEvent | maplibregl.MapLayerTouchEvent) {
    const map = mapRef.current!;
    if (stateRef.current.placingType || draggingRef.current || transformRef.current) return;
    const id = (e.features ?? []).map((f) => f.properties?.id).find((value): value is string => typeof value === "string");
    if (!id) return;
    draggingRef.current = id;
    dragMovedRef.current = false;
    setSelectedId(id);
    setSelectedSuggestionId(null);
    map.dragPan.disable();
    e.preventDefault();
  }

  function moveDragged(id: string, ll: LngLat) {
    if (!dragMovedRef.current) {
      dragMovedRef.current = true;
      snapshot(); // one undo step restores the pre-drag position
    }
    setObjects((prev) => prev.map((object) => object.id === id ? { ...object, center: ll } : object));
  }

  function onMapMouseMove(e: maplibregl.MapMouseEvent) {
    const ll: LngLat = [e.lngLat.lng, e.lngLat.lat];
    if (transformRef.current) {
      applyTransform(ll, e.originalEvent.shiftKey);
      return;
    }
    const id = draggingRef.current;
    if (id) {
      moveDragged(id, ll);
      return;
    }
    if (stateRef.current.placingType) updateGhost(ll);
  }

  function onMapTouchMove(e: maplibregl.MapTouchEvent) {
    if (transformRef.current) {
      e.preventDefault();
      applyTransform([e.lngLat.lng, e.lngLat.lat], false);
      return;
    }
    const id = draggingRef.current;
    if (!id) return;
    e.preventDefault();
    moveDragged(id, [e.lngLat.lng, e.lngLat.lat]);
  }

  function endDrag() {
    if (!draggingRef.current && !transformRef.current) return;
    draggingRef.current = null;
    transformRef.current = null;
    if (dragMovedRef.current) {
      // The mouseup that ends a drag also fires a click — don't let it change selection.
      suppressClickRef.current = true;
      window.setTimeout(() => { suppressClickRef.current = false; }, 150);
    }
    dragMovedRef.current = false;
    const map = mapRef.current;
    if (map) {
      map.dragPan.enable();
      map.getCanvas().style.cursor = stateRef.current.placingType ? "crosshair" : "";
    }
    setHandleTick((t) => t + 1); // re-sync so the live dimension label disappears
  }

  function placeObject(type: BuilderObjectType, ll: LngLat) {
    const created = createPlacedObject(type, ll);
    let next = created;
    const field = elevationRef.current;
    if (field && OBJECT_SPECS[type].measurable) {
      const measured = measuredObjectHeight(field, placedObjectFootprint(created));
      if (measured != null) {
        next = updatePlacedObject(created, { heightM: clampHeight(type, measured), heightSource: "dhm_measured" });
      }
    }
    commit([...stateRef.current.objects, next]);
    setSelectedId(next.id);
    setSelectedSuggestionId(null);
  }

  function placeLinear(type: BuilderObjectType, start: LngLat, end: LngLat) {
    let created = createLinearObject(type, start, end);
    const field = elevationRef.current;
    if (field && OBJECT_SPECS[type].measurable) {
      const measured = measuredObjectHeight(field, placedObjectFootprint(created));
      if (measured != null) {
        created = updatePlacedObject(created, { heightM: clampHeight(type, measured), heightSource: "dhm_measured" });
      }
    }
    commit([...stateRef.current.objects, created]);
    setSelectedId(created.id);
    setSelectedSuggestionId(null);
  }

  // ----- Auto-detection: DHM surface model -> reviewable suggestions -----
  const detectingRef = useRef(false);
  async function runDetection(auto: boolean) {
    if (detectingRef.current) return;
    detectingRef.current = true;
    setDetecting(true);
    try {
      let field = elevationRef.current;
      // A twin re-opened from the database only stores the terrain grid; fetch a
      // fresh field (with the DSM surface) before detecting.
      if (!field?.surface) {
        field = await loadElevation(true);
      }
      if (!field?.surface) {
        setDetectionRan(true);
        if (!auto) toast("Ingen overflademodel for adressen", { description: "Automatisk objektfund kræver DHM-overflademodel. Placér objekterne manuelt." });
        return;
      }
      const detected = detectObjectsFromElevation(field, { boundary: lawnRings[0], boundaryMarginM: 4 });
      const fresh = suggestionsFromDetections(detected, stateRef.current.objects, stateRef.current.suggestions, dismissedRef.current);
      setDetectionRan(true);
      if (!fresh.length) {
        if (!auto) toast("Ingen nye objekter fundet", { description: "DHM fandt ikke flere tydelige træer, hække eller skure." });
        return;
      }
      setSuggestions((prev) => [...prev, ...fresh]);
      setSelectedSuggestionId(fresh[0].id);
      toast.success(`Fandt ${fresh.length} mulige objekt${fresh.length === 1 ? "" : "er"}`, {
        description: "Godkend eller afvis hvert fund i panelet — intet gemmes uden dit ok.",
      });
    } finally {
      detectingRef.current = false;
      setDetecting(false);
    }
  }

  function acceptSuggestion(id: string) {
    const suggestion = stateRef.current.suggestions.find((s) => s.id === id);
    if (!suggestion) return;
    const placed = placedFromSuggestion(suggestion);
    commit([...stateRef.current.objects, placed]);
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
    setSelectedSuggestionId((prev) => (prev === id ? null : prev));
    setSelectedId(placed.id);
  }

  function dismissSuggestion(id: string) {
    const suggestion = stateRef.current.suggestions.find((s) => s.id === id);
    if (!suggestion) return;
    dismissedRef.current.push(suggestion.center);
    setSuggestions((prev) => prev.filter((s) => s.id !== id));
    setSelectedSuggestionId((prev) => (prev === id ? null : prev));
  }

  function acceptAllSuggestions() {
    const list = stateRef.current.suggestions;
    if (!list.length) return;
    commit([...stateRef.current.objects, ...list.map(placedFromSuggestion)]);
    setSuggestions([]);
    setSelectedSuggestionId(null);
    toast.success(`${list.length} objekt${list.length === 1 ? "" : "er"} tilføjet`);
  }

  function dismissAllSuggestions() {
    const list = stateRef.current.suggestions;
    if (!list.length) return;
    dismissedRef.current.push(...list.map((s) => s.center));
    setSuggestions([]);
    setSelectedSuggestionId(null);
  }

  function focusSuggestion(suggestion: ObjectSuggestion) {
    setSelectedSuggestionId(suggestion.id);
    setSelectedId(null);
    setView("map");
    mapRef.current?.easeTo({ center: suggestion.center, duration: 450 });
  }

  // ----- Sync map sources whenever objects/lawn/suggestions change -----
  function syncMap() {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const lawnData: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: lawnRings.map((ring) => ({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] } })),
    };
    (map.getSource("lawn") as maplibregl.GeoJSONSource)?.setData(lawnData);
    const exclData: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: exclusions.map((ring) => ({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] } })),
    };
    (map.getSource("excl") as maplibregl.GeoJSONSource)?.setData(exclData);

    const footData: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
    const ptData: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
    for (const object of objects) {
      const ring = placedObjectFootprint(object);
      const color = OBJECT_SPECS[object.type].color;
      const isSelected = object.id === selectedId;
      footData.features.push({ type: "Feature", properties: { id: object.id, color, selected: isSelected }, geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] } });
      ptData.features.push({ type: "Feature", properties: { id: object.id, color, selected: isSelected, label: `${object.label} ${object.heightM.toFixed(1)}m` }, geometry: { type: "Point", coordinates: object.center } });
    }
    (map.getSource("obj-foot") as maplibregl.GeoJSONSource)?.setData(footData);
    (map.getSource("obj-pt") as maplibregl.GeoJSONSource)?.setData(ptData);

    const sugData: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
    for (const suggestion of suggestions) {
      const ring = suggestionFootprint(suggestion);
      const color = OBJECT_SPECS[suggestion.type].color;
      const isSelected = suggestion.id === selectedSuggestionId;
      sugData.features.push({ type: "Feature", properties: { id: suggestion.id, color, selected: isSelected }, geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] } });
      sugData.features.push({ type: "Feature", properties: { id: suggestion.id, selected: isSelected, label: `${OBJECT_SPECS[suggestion.type].label}? ${suggestion.heightM.toFixed(1)}m` }, geometry: { type: "Point", coordinates: suggestion.center } });
    }
    (map.getSource("sug") as maplibregl.GeoJSONSource)?.setData(sugData);

    // Transform handles on the selected object (hidden while placing).
    const handleData: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
    const sel = objects.find((object) => object.id === selectedId);
    if (sel && !placingType) {
      const handles = transformHandlesFor(sel);
      for (const handle of handles) {
        const role = handle.kind === "rotate" ? "rotate"
          : handle.kind.startsWith("end") ? "end"
          : handle.kind.startsWith("corner") ? "corner"
          : "edge";
        handleData.features.push({ type: "Feature", properties: { kind: handle.kind, role }, geometry: { type: "Point", coordinates: handle.lngLat } });
      }
      const rotate = handles.find((h) => h.kind === "rotate");
      const top = handles.find((h) => h.kind === "edge-n");
      if (rotate && top) {
        handleData.features.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [top.lngLat, rotate.lngLat] } });
      }
      const transform = transformRef.current;
      if (transform && transform.id === sel.id && dragMovedRef.current) {
        const label = transform.kind === "rotate"
          ? `${Math.round(sel.rotationDeg)}°`
          : OBJECT_SPECS[sel.type].placement === "line" && transform.kind.startsWith("end")
            ? `${sel.widthM.toFixed(1)} m`
            : `${sel.widthM.toFixed(1)} × ${sel.depthM.toFixed(1)} m`;
        handleData.features.push({ type: "Feature", properties: { kind: "label", label }, geometry: { type: "Point", coordinates: sel.center } });
      }
    }
    (map.getSource("handles") as maplibregl.GeoJSONSource)?.setData(handleData);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { syncMap(); }, [objects, selectedId, lawnRings, exclusions, suggestions, selectedSuggestionId, view, placingType, handleTick]);

  // ----- Keyboard shortcuts -----
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const meta = e.ctrlKey || e.metaKey;
      if (meta && (e.key === "z" || e.key === "Z") && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (meta && ((e.key === "z" || e.key === "Z") && e.shiftKey || e.key === "y" || e.key === "Y")) { e.preventDefault(); redo(); return; }
      const s = stateRef.current;
      if (e.key === "Escape") {
        if (s.lineStart) setLineStart(null);
        else if (s.placingType) setPlacingType(null);
        else { setSelectedId(null); setSelectedSuggestionId(null); }
        return;
      }
      if (s.selectedSuggestionId) {
        if (e.key === "Enter" || e.key === "a" || e.key === "A") { e.preventDefault(); acceptSuggestion(s.selectedSuggestionId); return; }
        if (e.key === "Delete" || e.key === "Backspace" || e.key === "x" || e.key === "X") { e.preventDefault(); dismissSuggestion(s.selectedSuggestionId); return; }
      }
      if (!s.selectedId) return;
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSelected(); return; }
      if (e.key === "d" || e.key === "D") { e.preventDefault(); duplicateSelected(); return; }
      if (e.key === "r" || e.key === "R") {
        e.preventDefault();
        if (!e.repeat) snapshot();
        const delta = e.shiftKey ? -15 : 15;
        setObjects((prev) => prev.map((object) => object.id === s.selectedId
          ? updatePlacedObject(object, { rotationDeg: ((object.rotationDeg + delta) % 180 + 180) % 180 })
          : object));
        return;
      }
      if (e.key.startsWith("Arrow")) {
        e.preventDefault();
        if (!e.repeat) snapshot();
        const step = e.shiftKey ? 1 : 0.25;
        const dx = e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0;
        const dy = e.key === "ArrowUp" ? step : e.key === "ArrowDown" ? -step : 0;
        setObjects((prev) => prev.map((object) => object.id === s.selectedId ? nudgeObject(object, dx, dy) : object));
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Warn before the tab closes with unsaved work.
  useEffect(() => {
    if (!dirty) return;
    const handler = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  // ----- Editor actions -----
  // Slider edits mutate in place; one history snapshot is taken when a slider is
  // grabbed (beginEdit) so a whole drag is a single undo step.
  function patchSelected(patch: Partial<PlacedObject>) {
    if (!selectedId) return;
    setObjects((prev) => prev.map((object) => object.id === selectedId ? updatePlacedObject(object, patch) : object));
  }

  function deleteSelected() {
    const id = stateRef.current.selectedId;
    if (!id) return;
    commit(stateRef.current.objects.filter((object) => object.id !== id));
    setSelectedId(null);
  }

  function duplicateSelected() {
    const sel = stateRef.current.objects.find((object) => object.id === stateRef.current.selectedId);
    if (!sel) return;
    const copy = createPlacedObject(sel.type, [sel.center[0] + 0.00002, sel.center[1] - 0.00001], {
      widthM: sel.widthM,
      depthM: sel.depthM,
      heightM: sel.heightM,
      rotationDeg: sel.rotationDeg,
      heightSource: sel.heightSource,
      confidence: sel.confidence,
    });
    commit([...stateRef.current.objects, copy]);
    setSelectedId(copy.id);
  }

  function remeasureSelected() {
    if (!selected || !elevation) return;
    const measured = measuredObjectHeight(elevation, placedObjectFootprint(selected));
    if (measured == null) {
      toast("DHM måler ikke en højde her", { description: "Objektet er fladt eller skjult i overflademodellen. Sæt højden manuelt." });
      return;
    }
    snapshot();
    patchSelected({ heightM: clampHeight(selected.type, measured), heightSource: "dhm_measured" });
    toast.success(`Højde målt: ${measured.toFixed(1)} m`);
  }

  async function save() {
    if (!model || !garden || !user) return;
    setSaving(true);
    try {
      const payload = {
        depth_model: depthModelToJson({ ...model, generatedAt: new Date().toISOString() }),
        depth_model_updated_at: new Date().toISOString(),
      };
      const { error } = await supabase.from("gardens").update(payload).eq("id", garden.id).eq("user_id", user.id);
      if (error) throw error;
      setDirty(false);
      setSavedAt(new Date());
      toast.success("3D-have gemt", {
        description: `${summary?.objectCount ?? 0} objekter · ${model.quality.score}/100 kvalitet. Havekompagnon, vanding og robotguide bruger nu modellen.`,
        action: { label: "Åbn Havekompagnon", onClick: () => navigate("/havekompagnon") },
        duration: 6000,
      });
    } catch (error) {
      toast.error("Kunne ikke gemme 3D-haven", { description: error instanceof Error ? error.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  // ----- Contextual help text on the map -----
  function helpText(): string {
    if (view === "3d") return "Træk for at dreje. 3D-haven viser rigtige højder og terrænfald.";
    if (placingType) {
      const spec = OBJECT_SPECS[placingType];
      if (spec.placement === "line") {
        return lineStart
          ? `${spec.label}: klik hvor linjen slutter — klik videre for hvert knæk. Esc afslutter.`
          : `${spec.label}: klik hvor linjen begynder, og tegn fra ende til ende.`;
      }
      return `Klik på kortet for at placere ${spec.label.toLowerCase()}. Esc for at stoppe.`;
    }
    if (selectedSuggestion) return "Godkend eller afvis det stiplede forslag i panelet — A godkender, X afviser.";
    if (selected) {
      return OBJECT_SPECS[selected.type].placement === "line"
        ? "Træk i enderne for at forlænge eller dreje. Træk i siderne for bredden. Træk midten for at flytte."
        : "Træk i hjørner og kanter for størrelsen, den gyldne prik drejer. Træk objektet for at flytte.";
    }
    if (suggestions.length) return "Stiplede felter er automatiske fund — klik på et for at godkende eller afvise.";
    return "Klik et objekt for at redigere, eller vælg en type nedenfor og klik på kortet.";
  }

  // ----- Render -----
  if (!gardenId) {
    return (
      <>
        <AppNav active="sizer" />
        <div className="container" style={{ padding: "60px 0", textAlign: "center" }}>
          <h1>Vælg en have</h1>
          <p className="lede">Byg din 3D-have ud fra en måling. Gå til Havemåler, tegn græsfladen og gem først.</p>
          <Link to="/havemaaler" className="btn btn-primary">Åbn Havemåler</Link>
        </div>
        <SiteFooter />
      </>
    );
  }

  const stepSaved = Boolean(savedAt) && !dirty;

  return (
    <>
      <AppNav active="sizer" />
      <div className="container havemaaler-page is-measuring">
        <header className="page-head">
          <nav className="builder-steps" aria-label="Havemåler trin">
            <Link className="builder-step is-done" to={`/havemaaler?garden=${garden?.id ?? ""}`} title="Tilbage til målingen">
              <span className="num"><Check size={12} /></span> Græsflade
            </Link>
            <span className="builder-step-arrow" aria-hidden>→</span>
            <span className="builder-step is-active"><span className="num">2</span> Byg i 3D</span>
            <span className="builder-step-arrow" aria-hidden>→</span>
            <span className={`builder-step ${stepSaved ? "is-done" : ""}`}>
              <span className="num">{stepSaved ? <Check size={12} /> : 3}</span> Gem &amp; brug
            </span>
          </nav>
          <h1>Byg din 3D-have.</h1>
          <p className="lede">
            Vi finder træer, hække og skure automatisk i Danmarks Højdemodel — du godkender dem med ét klik.
            Tegn selv hække og hegn fra ende til ende, og se haven i 3D med rigtigt terræn.
          </p>
        </header>

        {loading ? (
          <div className="addr-step" style={{ minHeight: 220, alignItems: "center" }}>
            <div>
              <div className="addr-eyebrow"><span className="num">2</span> Henter have</div>
              <h2>Åbner din måling…</h2>
            </div>
          </div>
        ) : !model ? (
          <div className="addr-step" style={{ minHeight: 220 }}>
            <div>
              <h2>Ingen græsflade fundet</h2>
              <p className="addr-lede">Tegn og gem en græsflade i Havemåler, før du bygger 3D-haven.</p>
              <Link to="/havemaaler" className="btn btn-primary">Åbn Havemåler</Link>
            </div>
          </div>
        ) : (
          <section>
            <div className="topview-header">
              <div className="addr-display">
                <div className="pin-badge"><MapPin size={16} /></div>
                <div className="txt">
                  <strong>{garden?.name ?? "Min have"}</strong>
                  <span>{areaM2 ? `${areaM2} M²` : ""}{objects.length ? ` · ${objects.length} OBJEKTER` : ""}{dirty ? " · UGEMT" : ""}</span>
                </div>
              </div>
              <div className="topview-actions" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div className="imagery-toggle" style={{ display: "flex", border: "1px solid var(--ink-200)", borderRadius: 8, overflow: "hidden", fontSize: 12 }}>
                  <button onClick={() => setView("map")} style={{ padding: "6px 10px", background: view === "map" ? "var(--gold)" : "transparent", color: view === "map" ? "#14271d" : "inherit", border: 0 }}>Placér</button>
                  <button onClick={() => setView("3d")} style={{ padding: "6px 10px", background: view === "3d" ? "var(--gold)" : "transparent", color: view === "3d" ? "#14271d" : "inherit", border: 0 }}>3D</button>
                </div>
                <Link to={`/havemaaler?garden=${garden?.id ?? ""}`} className="change-addr">Tilbage til måling</Link>
              </div>
            </div>

            <div className="sizer-layout">
              <div>
                <div className="canvas-host topview" style={{ position: "relative" }}>
                  <div ref={containerRef} style={{ width: "100%", height: "100%", position: "absolute", inset: 0, borderRadius: "inherit", opacity: view === "map" ? 1 : 0, pointerEvents: view === "map" ? "auto" : "none" }} />
                  {view === "3d" && <GardenTwinViewer model={model} selectedId={selectedId} className="garden-twin-map-overlay" />}

                  <div className="help" style={{ zIndex: 2 }}>
                    <span className="dot" />
                    <span>{helpText()}</span>
                  </div>

                  {(elevationStatus === "loading" || detecting) && view === "map" && (
                    <div className="builder-scan-banner" style={{ zIndex: 2 }}>
                      <Loader2 size={14} className="spin" />
                      <span>{detecting ? "Leder efter træer, hække og skure…" : "Henter Danmarks Højdemodel…"}</span>
                    </div>
                  )}

                  <div className="area-pill" style={{ zIndex: 2 }}>
                    <div>
                      <div className="lbl">Terræn</div>
                      <div>
                        {elevationStatus === "loading" ? "henter…"
                          : elevation ? `${elevation.stats.reliefM.toFixed(2)} m fald`
                          : "fladt"}
                      </div>
                    </div>
                    {elevation && <div style={{ marginTop: 4, fontSize: 10, color: "var(--gold)", letterSpacing: 0.5 }}>{slopeLabel(elevation.stats.reliefM)}{slope ? ` · maks ${slope.maxSlopePct}%` : ""} · DHM</div>}
                  </div>
                </div>

                {view === "map" && (
                  <>
                  <div className="builder-toolbar">
                    <button className="tool-btn is-active" onClick={() => void runDetection(false)} disabled={detecting || elevationStatus === "loading"} title="Find træer, hække og skure automatisk fra Danmarks Højdemodel">
                      {detecting ? <Loader2 size={14} className="spin" /> : <Wand2 size={14} />} Find objekter (DHM)
                    </button>
                    <button className="tool-btn" onClick={undo} disabled={!canUndo} title="Fortryd (Cmd+Z)"><Undo2 size={14} /></button>
                    <button className="tool-btn" onClick={redo} disabled={!canRedo} title="Gentag (Cmd+Shift+Z)"><Redo2 size={14} /></button>
                  </div>
                  <div className="builder-palette" style={{ zIndex: 2 }}>
                    {BUILDER_PALETTE.map((type) => {
                      const spec = OBJECT_SPECS[type];
                      return (
                        <button
                          key={type}
                          className={`tool-btn builder-palette-btn ${placingType === type ? "is-active" : ""}`}
                          onClick={() => setPlacingType((prev) => prev === type ? null : type)}
                          title={spec.hint}
                          style={{ borderLeft: `3px solid ${spec.color}` }}
                        >
                          {spec.label}
                          {spec.placement === "line" && <PenLine size={11} className="builder-palette-line-icon" aria-label="Tegnes som linje" />}
                        </button>
                      );
                    })}
                  </div>
                  </>
                )}

                <div className="map-primary-actions" style={{ marginTop: 10 }}>
                  <button className="tool-btn scan-primary" onClick={save} disabled={saving || !model}>
                    <Save size={14} /> {saving ? "Gemmer…" : dirty || !savedAt ? "Gem 3D-have" : "Gemt ✓"}
                  </button>
                  <button className="tool-btn" onClick={() => setView(view === "3d" ? "map" : "3d")}>
                    <Layers3 size={14} /> {view === "3d" ? "Placér objekter" : "Vis i 3D"}
                  </button>
                  {elevationStatus !== "ready" ? (
                    <button className="tool-btn" onClick={() => loadElevation(false)} disabled={elevationStatus === "loading"}>
                      <Mountain size={14} /> {elevationStatus === "loading" ? "Henter højder…" : "Hent højdedata"}
                    </button>
                  ) : (
                    <button className="tool-btn" onClick={() => navigate("/havekompagnon")} disabled={!savedAt || dirty} title={!savedAt || dirty ? "Gem 3D-haven først" : "Åbn Havekompagnon med din nye model"}>
                      Videre <ArrowRight size={14} />
                    </button>
                  )}
                </div>
                {stepSaved && (
                  <div className="builder-saved-note">
                    <CheckCircle2 size={14} />
                    <span>Gemt {savedAt!.toLocaleTimeString("da-DK", { hour: "2-digit", minute: "2-digit" })} — Havekompagnon, vandingsplan og robotguide bruger nu din 3D-have.</span>
                  </div>
                )}
              </div>

              <aside className="recommendation">
                <div className="eyebrow" style={{ marginBottom: 14 }}>3D Garden Twin</div>

                <div className="garden-scan-panel__metrics" style={{ marginBottom: 16 }}>
                  <div><Layers3 size={14} /><strong>{objects.length}</strong><span>objekter</span></div>
                  <div><Mountain size={14} /><strong>{elevation ? `${elevation.stats.reliefM.toFixed(1)}m` : "—"}</strong><span>terrænfald</span></div>
                  <div><Ruler size={14} /><strong>{model.quality.score}</strong><span>/100 kvalitet</span></div>
                </div>

                {suggestions.length > 0 && (
                  <div className="suggestion-panel">
                    <div className="suggestion-panel__head">
                      <Wand2 size={15} />
                      <div>
                        <strong>Vi fandt {suggestions.length} objekt{suggestions.length === 1 ? "" : "er"} i din have</strong>
                        <span>Fra Danmarks Højdemodel. Godkend dem, der passer — intet gemmes uden dit ok.</span>
                      </div>
                    </div>
                    <div className="suggestion-list">
                      {suggestions.map((suggestion) => {
                        const spec = OBJECT_SPECS[suggestion.type];
                        return (
                          <div
                            key={suggestion.id}
                            className={`suggestion-row ${suggestion.id === selectedSuggestionId ? "is-selected" : ""}`}
                            onClick={() => focusSuggestion(suggestion)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") focusSuggestion(suggestion); }}
                          >
                            <i style={{ background: spec.color }} />
                            <div className="txt">
                              <strong>{spec.label}</strong>
                              <span>{suggestion.heightM.toFixed(1)} m høj · {Math.round(suggestion.confidence * 100)}% sikker</span>
                            </div>
                            <button className="sug-accept" onClick={(e) => { e.stopPropagation(); acceptSuggestion(suggestion.id); }} title="Tilføj til haven (A)"><Check size={14} /></button>
                            <button className="sug-dismiss" onClick={(e) => { e.stopPropagation(); dismissSuggestion(suggestion.id); }} title="Afvis (X)"><X size={14} /></button>
                          </div>
                        );
                      })}
                    </div>
                    <div className="suggestion-panel__actions">
                      <button onClick={acceptAllSuggestions}><Check size={13} /> Tilføj alle</button>
                      <button onClick={dismissAllSuggestions}><X size={13} /> Afvis alle</button>
                    </div>
                  </div>
                )}

                {selected ? (
                  <div className="rec-mower" style={{ textAlign: "left" }}>
                    <div className="tier" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <span>{selected.label}</span>
                      <span style={{ display: "flex", gap: 4 }}>
                        <button className="tool-btn" onClick={duplicateSelected} title="Dublér (D)" style={{ padding: "2px 8px" }}><Copy size={14} /></button>
                        <button className="tool-btn" onClick={deleteSelected} title="Fjern objekt (Delete)" style={{ padding: "2px 8px" }}><Trash2 size={14} /></button>
                      </span>
                    </div>
                    <p style={{ fontSize: 11, color: "var(--ink-500)", margin: "4px 0 12px" }}>{OBJECT_SPECS[selected.type].hint}</p>

                    <SliderRow label={`Højde · ${selected.heightM.toFixed(1)} m`} min={OBJECT_SPECS[selected.type].heightRange[0]} max={OBJECT_SPECS[selected.type].heightRange[1]} step={0.1} value={selected.heightM} onChange={(v) => patchSelected({ heightM: Number(v.toFixed(2)) })} onEditStart={snapshot} />
                    <SliderRow label={`${OBJECT_SPECS[selected.type].placement === "line" ? "Længde" : "Bredde"} · ${selected.widthM.toFixed(1)} m`} min={0.3} max={OBJECT_SPECS[selected.type].placement === "line" ? 40 : 20} step={0.1} value={selected.widthM} onChange={(v) => patchSelected({ widthM: Number(v.toFixed(2)) })} onEditStart={snapshot} />
                    <SliderRow label={`${OBJECT_SPECS[selected.type].placement === "line" ? "Bredde" : "Dybde"} · ${selected.depthM.toFixed(1)} m`} min={0.1} max={20} step={0.1} value={selected.depthM} onChange={(v) => patchSelected({ depthM: Number(v.toFixed(2)) })} onEditStart={snapshot} />
                    <SliderRow label={`Drejning · ${Math.round(selected.rotationDeg)}°`} min={0} max={180} step={1} value={selected.rotationDeg} onChange={(v) => patchSelected({ rotationDeg: v })} onEditStart={snapshot} icon={<RotateCw size={12} />} />

                    <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                      {OBJECT_SPECS[selected.type].measurable && elevation && (
                        <button className="tool-btn" onClick={remeasureSelected}><Sparkles size={13} /> Mål højde (DHM)</button>
                      )}
                      <span style={{ fontSize: 10, color: "var(--gold)", alignSelf: "center", letterSpacing: 0.4 }}>
                        {selected.heightSource === "dhm_measured" ? "Højde målt fra DHM" : selected.heightSource === "user" ? "Højde sat manuelt" : "Standardhøjde"}
                      </span>
                    </div>
                    <p style={{ fontSize: 10.5, color: "var(--ink-500)", marginTop: 10, lineHeight: 1.6 }}>
                      {OBJECT_SPECS[selected.type].placement === "line"
                        ? <>Træk i <strong>enderne</strong> på kortet for længde og retning, i siderne for bredden.</>
                        : <>Træk i <strong>hjørner/kanter</strong> for størrelse, den <strong>gyldne prik</strong> drejer (Shift = 15°-trin).</>}
                      {" "}Piletaster finjusterer · <strong>R</strong> drejer · <strong>D</strong> dublerer.
                    </p>
                  </div>
                ) : (
                  <div className="rec-mower" style={{ textAlign: "left" }}>
                    <div className="tier">Sådan bygger du</div>
                    {elevationStatus === "loading" && (
                      <p style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--ink-500)", margin: "10px 0 0" }}>
                        <Loader2 size={13} className="spin" /> Henter Danmarks Højdemodel og leder efter dine træer og hække…
                      </p>
                    )}
                    <ol style={{ fontSize: 12.5, color: "var(--ink-500)", lineHeight: 1.7, paddingLeft: 18, margin: "8px 0 0" }}>
                      <li><strong>Godkend</strong> de objekter, vi finder automatisk — de vises stiplede på kortet.</li>
                      <li><strong>Tilføj flere</strong>: vælg en type og klik på kortet. Hække og hegn ({<PenLine size={10} style={{ display: "inline" }} />}) tegner du fra ende til ende.</li>
                      <li><strong>Justér</strong>: træk i hjørnerne for størrelse, den gyldne prik drejer. Højden hentes fra DHM hvor den kan måles.</li>
                      <li><strong>Se i 3D</strong> og gem — Havekompagnon, vanding og robotguide bruger modellen.</li>
                    </ol>
                    {detectionRan && !suggestions.length && !objects.length && (
                      <p style={{ fontSize: 11, color: "var(--ink-500)", marginTop: 12 }}>
                        Vi fandt ingen tydelige objekter automatisk i denne have. Tilføj dem selv fra paletten — det tager et øjeblik.
                      </p>
                    )}
                    {elevationStatus === "unavailable" && (
                      <p style={{ fontSize: 11, color: "var(--ink-500)", marginTop: 12 }}>
                        Ingen højdedata for denne adresse — terrænet vises fladt, og du sætter højderne selv. Resten virker som normalt.
                      </p>
                    )}
                  </div>
                )}

                {slope?.exceedsRobotLimit && (
                  <div style={{ display: "flex", gap: 8, alignItems: "flex-start", marginTop: 14, padding: "10px 12px", borderRadius: 10, background: "rgba(216,143,77,0.12)", border: "1px solid rgba(216,143,77,0.4)", fontSize: 11.5, lineHeight: 1.5 }}>
                    <AlertTriangle size={15} style={{ color: "var(--ochre-600, #d88f4d)", flexShrink: 0, marginTop: 1 }} />
                    <span>Stejleste hældning er <strong>{slope.maxSlopePct}%</strong> — over de ~35% mange robotklippere klarer. Vælg en model med høj hældningsevne, eller del plænen op.</span>
                  </div>
                )}

                {objects.length > 0 && (
                  <details className="garden-scan-history" open style={{ marginTop: 14 }}>
                    <summary>
                      <span>Objekter</span>
                      <b>{objects.length}</b>
                    </summary>
                    <div className="garden-scan-history-list">
                      {objects.map((object) => (
                        <button
                          key={object.id}
                          onClick={() => { setSelectedId(object.id); setSelectedSuggestionId(null); mapRef.current?.easeTo({ center: object.center, duration: 450 }); }}
                          style={{
                            display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left",
                            padding: "6px 8px", borderRadius: 8, border: "1px solid",
                            borderColor: object.id === selectedId ? "var(--gold)" : "transparent",
                            background: object.id === selectedId ? "rgba(237,200,139,0.12)" : "transparent",
                            cursor: "pointer", color: "inherit",
                          }}
                        >
                          <i style={{ width: 10, height: 10, borderRadius: 3, background: OBJECT_SPECS[object.type].color, flexShrink: 0 }} />
                          <span style={{ flex: 1, fontSize: 12.5 }}>{object.label}</span>
                          <span style={{ fontSize: 11, color: "var(--ink-500)" }}>{object.heightM.toFixed(1)} m</span>
                          {object.heightSource === "dhm_measured" && <Sparkles size={11} style={{ color: "var(--gold)" }} />}
                        </button>
                      ))}
                    </div>
                  </details>
                )}

                <div style={{ fontSize: 11, color: "var(--ink-500)", marginTop: 18, lineHeight: 1.5 }}>
                  Terræn og højder: Danmarks Højdemodel (DHM) © SDFI / Dataforsyningen. Højderne er estimater under truthful-confidence og kan altid rettes.
                </div>
              </aside>
            </div>
          </section>
        )}
      </div>
      <SiteFooter />
    </>
  );
}

function SliderRow({ label, min, max, step, value, onChange, onEditStart, icon }: { label: string; min: number; max: number; step: number; value: number; onChange: (value: number) => void; onEditStart?: () => void; icon?: ReactNode }) {
  return (
    <label style={{ display: "block", margin: "10px 0" }}>
      <span style={{ fontSize: 11, color: "var(--ink-600, var(--ink-500))", display: "flex", alignItems: "center", gap: 4, marginBottom: 4 }}>{icon}{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onPointerDown={onEditStart} onKeyDown={onEditStart} onChange={(e) => onChange(Number(e.target.value))} style={{ width: "100%", accentColor: "var(--gold)" }} />
    </label>
  );
}
