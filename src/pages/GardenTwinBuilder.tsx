import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Mountain, Layers3, Trash2, RotateCw, Ruler, Sparkles, Save, MapPin, Copy, Undo2, Redo2, Wand2, AlertTriangle } from "lucide-react";

import { AppNav, SiteFooter } from "@/components/layout/SiteChrome";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useAuth } from "@/lib/auth";
import { useActiveGarden } from "@/lib/activeGarden";
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
  clampHeight,
  createPlacedObject,
  placedObjectFootprint,
  updatePlacedObject,
  type BuilderObjectType,
  type PlacedObject,
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

function metersBetween(a: LngLat, b: LngLat): number {
  const midLat = ((a[1] + b[1]) / 2) * Math.PI / 180;
  const dx = (b[0] - a[0]) * 111_320 * Math.cos(midLat);
  const dy = (b[1] - a[1]) * 111_320;
  return Math.hypot(dx, dy);
}

function placedToInput(object: PlacedObject): GardenObjectInput {
  return {
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
      return createPlacedObject(type, ringCentroid(object.footprint), {
        id: object.id,
        widthM: dims.width,
        depthM: dims.depth,
        heightM: object.heightM ?? OBJECT_SPECS[type].heightM,
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

  const [mapboxToken, setMapboxToken] = useState<string | null>(null);
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
  const [view, setView] = useState<"map" | "3d">("map");

  const mapRef = useRef<mapboxgl.Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef<string | null>(null);

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
  const summary = model ? summarizeDepthModel(model) : null;
  const slope = useMemo(() => (elevation ? terrainSlopeStats(elevation) : null), [elevation]);

  // ----- Tokens & imagery config -----
  useEffect(() => {
    supabase.functions.invoke("get-mapbox-token").then(({ data, error }) => {
      if (!error && data?.token) {
        setMapboxToken(data.token);
        mapboxgl.accessToken = data.token;
      } else {
        toast.error("Kunne ikke hente kort-token");
      }
    });
    supabase.functions.invoke("get-ortofoto-config").then(({ data }) => {
      if (data?.wmsTemplate) setOrtoCfg({ wmsTemplate: data.wmsTemplate });
    }).catch(() => { /* ortofoto is optional; Mapbox satellite is the fallback */ });
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
      setObjects(placedFromSavedModel(saved.depth_model));
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
  const loadElevation = useCallback(async (silent = false) => {
    if (!lawnRings.length) return;
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
    } else {
      setElevationStatus("unavailable");
      if (!silent) {
        toast("Ingen højdedata for adressen", { description: "Du kan stadig bygge haven — terrænet vises fladt og højder sættes manuelt." });
      }
    }
  }, [lawnRings]);

  useEffect(() => {
    if (lawnRings.length && elevationStatus === "idle") {
      void loadElevation(true);
    }
  }, [lawnRings, elevationStatus, loadElevation]);

  // Auto-detect objects once, the first time fresh DHM surface data arrives for a
  // garden that has no objects yet. This is the "we found your trees" moment.
  const autoDetectedRef = useRef(false);
  useEffect(() => {
    if (autoDetectedRef.current) return;
    if (elevationStatus === "ready" && elevation?.surface && stateRef.current.objects.length === 0) {
      autoDetectedRef.current = true;
      runDetection(elevation, true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [elevationStatus, elevation]);

  // ----- Map setup -----
  const buildStyle = useCallback((): mapboxgl.Style | string => {
    if (ortoCfg && mapboxToken) {
      return {
        version: 8,
        glyphs: "mapbox://fonts/mapbox/{fontstack}/{range}.pbf",
        sources: {
          sat: { type: "raster", tiles: [`https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token=${mapboxToken}`], tileSize: 256, maxzoom: 19 },
          orto: { type: "raster", tiles: [ortoCfg.wmsTemplate], tileSize: 512, attribution: "© SDFE / Dataforsyningen" },
        },
        layers: [
          { id: "sat", type: "raster", source: "sat" },
          { id: "orto", type: "raster", source: "orto", paint: { "raster-opacity": 0.88 } },
        ],
      };
    }
    return "mapbox://styles/mapbox/satellite-streets-v12";
  }, [ortoCfg, mapboxToken]);

  useEffect(() => {
    if (view !== "map" || !center || !mapboxToken || !containerRef.current || mapRef.current) return;
    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: buildStyle(),
      center,
      zoom: 19,
      minZoom: 14,
      maxZoom: 21,
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;
    map.on("load", () => { addLayers(); syncMap(); });
    map.on("click", onMapClick);
    map.on("mousedown", onMapMouseDown);
    map.on("mousemove", onMapMouseMove);
    map.on("mouseup", () => { draggingRef.current = null; map.dragPan.enable(); });
    return () => { map.remove(); mapRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, center, mapboxToken, ortoCfg]);

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
  }

  const stateRef = useRef({ objects, selectedId, placingType });
  useEffect(() => { stateRef.current = { objects, selectedId, placingType }; });
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
  }
  function redo() {
    if (!futureRef.current.length) return;
    pastRef.current.push(stateRef.current.objects.map((o) => ({ ...o })));
    setObjects(futureRef.current.pop()!);
    setHistoryTick((t) => t + 1);
  }
  const canUndo = pastRef.current.length > 0;
  const canRedo = futureRef.current.length > 0;
  void historyTick;

  function onMapClick(e: mapboxgl.MapMouseEvent) {
    const map = mapRef.current!;
    const ll: LngLat = [e.lngLat.lng, e.lngLat.lat];
    const s = stateRef.current;
    if (s.placingType) {
      placeObject(s.placingType, ll);
      return;
    }
    const hit = map.queryRenderedFeatures(e.point, { layers: ["obj-pt-circle", "obj-foot-fill"] });
    const id = hit.map((f) => f.properties?.id).find((value) => typeof value === "string");
    setSelectedId(id ?? null);
  }

  function onMapMouseDown(e: mapboxgl.MapMouseEvent) {
    const map = mapRef.current!;
    const s = stateRef.current;
    if (s.placingType) return;
    const hit = map.queryRenderedFeatures(e.point, { layers: ["obj-pt-circle"] });
    const id = hit.map((f) => f.properties?.id).find((value) => typeof value === "string");
    if (!id) return;
    snapshot(); // one undo step restores the pre-drag position
    draggingRef.current = id;
    setSelectedId(id);
    map.dragPan.disable();
    e.preventDefault();
  }

  function onMapMouseMove(e: mapboxgl.MapMouseEvent) {
    const id = draggingRef.current;
    if (!id) return;
    const ll: LngLat = [e.lngLat.lng, e.lngLat.lat];
    setObjects((prev) => prev.map((object) => object.id === id ? { ...object, center: ll } : object));
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
  }

  // ----- Auto-detect objects from the DHM surface model -----
  function runDetection(field: ElevationField | null, auto: boolean) {
    if (!field?.surface) {
      if (!auto) toast("Ingen overflademodel for adressen", { description: "Automatisk objektfund kræver DHM-overflademodel. Placér objekterne manuelt." });
      return;
    }
    const detected = detectObjectsFromElevation(field);
    const existing = stateRef.current.objects;
    const fresh = detected.filter((d) => !existing.some((o) => metersBetween(o.center, d.center) < 1.5));
    if (!fresh.length) {
      if (!auto) toast("Ingen nye objekter fundet", { description: "DHM fandt ikke flere tydelige træer, hække eller skure." });
      return;
    }
    const created = fresh.map((d) => createPlacedObject(d.type, d.center, {
      widthM: d.widthM,
      depthM: d.depthM,
      heightM: clampHeight(d.type, d.heightM),
      heightSource: "dhm_measured",
      confidence: d.confidence,
    }));
    commit([...existing, ...created]);
    setSelectedId(created[0].id);
    toast.success(`Fandt ${created.length} objekt${created.length === 1 ? "" : "er"} automatisk`, {
      description: "Tjek og justér dem — slet dem du ikke vil have.",
    });
  }

  // ----- Sync map sources whenever objects/lawn change -----
  function syncMap() {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const lawnData: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: lawnRings.map((ring) => ({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] } })),
    };
    (map.getSource("lawn") as mapboxgl.GeoJSONSource)?.setData(lawnData);
    const exclData: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features: exclusions.map((ring) => ({ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] } })),
    };
    (map.getSource("excl") as mapboxgl.GeoJSONSource)?.setData(exclData);

    const footData: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
    const ptData: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
    for (const object of objects) {
      const ring = placedObjectFootprint(object);
      const color = OBJECT_SPECS[object.type].color;
      const isSelected = object.id === selectedId;
      footData.features.push({ type: "Feature", properties: { id: object.id, color, selected: isSelected }, geometry: { type: "Polygon", coordinates: [[...ring, ring[0]]] } });
      ptData.features.push({ type: "Feature", properties: { id: object.id, color, selected: isSelected, label: `${object.label} ${object.heightM.toFixed(1)}m` }, geometry: { type: "Point", coordinates: object.center } });
    }
    (map.getSource("obj-foot") as mapboxgl.GeoJSONSource)?.setData(footData);
    (map.getSource("obj-pt") as mapboxgl.GeoJSONSource)?.setData(ptData);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { syncMap(); }, [objects, selectedId, lawnRings, exclusions, view]);

  // ----- Keyboard: Esc stops placing / deselects, Delete removes selection -----
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const meta = e.ctrlKey || e.metaKey;
      if (meta && (e.key === "z" || e.key === "Z") && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (meta && ((e.key === "z" || e.key === "Z") && e.shiftKey || e.key === "y" || e.key === "Y")) { e.preventDefault(); redo(); return; }
      if (e.key === "Escape") {
        if (placingType) setPlacingType(null);
        else setSelectedId(null);
      } else if ((e.key === "Delete" || e.key === "Backspace") && selectedId) {
        e.preventDefault();
        deleteSelected();
      } else if ((e.key === "d" || e.key === "D") && selectedId) {
        e.preventDefault();
        duplicateSelected();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placingType, selectedId]);

  // ----- Editor actions -----
  // Slider edits mutate in place; one history snapshot is taken when a slider is
  // grabbed (beginEdit) so a whole drag is a single undo step.
  function patchSelected(patch: Partial<PlacedObject>) {
    if (!selectedId) return;
    setObjects((prev) => prev.map((object) => object.id === selectedId ? updatePlacedObject(object, patch) : object));
  }

  function deleteSelected() {
    if (!selectedId) return;
    commit(stateRef.current.objects.filter((object) => object.id !== selectedId));
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
      toast.success("3D-have gemt", {
        description: `${summary?.objectCount ?? 0} objekter · ${model.quality.score}/100 kvalitet.`,
        action: { label: "Åbn Havekompagnon", onClick: () => navigate("/havekompagnon") },
        duration: 6000,
      });
      navigate("/havekompagnon");
    } catch (error) {
      toast.error("Kunne ikke gemme 3D-haven", { description: error instanceof Error ? error.message : undefined });
    } finally {
      setSaving(false);
    }
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

  return (
    <>
      <AppNav active="sizer" />
      <div className="container havemaaler-page is-measuring">
        <header className="page-head">
          <div className="eyebrow" style={{ marginBottom: 14 }}>Værktøj · Havemåler · Trin 2</div>
          <h1>Byg din 3D-have.</h1>
          <p className="lede">
            Placér træer, hække, skure, terrasser og bede direkte på satellitbilledet. Vi henter terrænets højdeforskelle og
            træ-/hækhøjder fra Danmarks Højdemodel — så modellen bliver mere præcis end et fladt kort. Justér højderne, og gem.
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
                  <span>{areaM2 ? `${areaM2} M²` : ""}{objects.length ? ` · ${objects.length} OBJEKTER` : ""}</span>
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
                  {view === "3d" && <GardenTwinViewer model={model} className="garden-twin-map-overlay" />}

                  <div className="help" style={{ zIndex: 2 }}>
                    <span className="dot" />
                    <span>
                      {view === "3d"
                        ? "Træk for at dreje. 3D-haven viser rigtige højder og terrænfald."
                        : placingType
                          ? `Klik på kortet for at placere ${OBJECT_SPECS[placingType].label.toLowerCase()}. Esc for at stoppe.`
                          : "Vælg et objekt nedenfor og klik på kortet. Klik et objekt for at redigere, eller træk det for at flytte."}
                    </span>
                  </div>

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
                  <div className="tools measurement-tools" style={{ zIndex: 2, flexWrap: "wrap", marginTop: 10 }}>
                    <button className="tool-btn is-active" onClick={() => runDetection(elevationRef.current, false)} disabled={!elevation?.surface} title="Find træer, hække og skure automatisk fra Danmarks Højdemodel">
                      <Wand2 size={14} /> Find objekter (DHM)
                    </button>
                    <button className="tool-btn" onClick={undo} disabled={!canUndo} title="Fortryd (Cmd+Z)"><Undo2 size={14} /></button>
                    <button className="tool-btn" onClick={redo} disabled={!canRedo} title="Gentag (Cmd+Shift+Z)"><Redo2 size={14} /></button>
                  </div>
                  <div className="tools measurement-tools" style={{ zIndex: 2, flexWrap: "wrap", marginTop: 8 }}>
                    {BUILDER_PALETTE.map((type) => (
                      <button
                        key={type}
                        className={`tool-btn ${placingType === type ? "is-active" : ""}`}
                        onClick={() => setPlacingType((prev) => prev === type ? null : type)}
                        title={OBJECT_SPECS[type].hint}
                        style={{ borderLeft: `3px solid ${OBJECT_SPECS[type].color}` }}
                      >
                        {OBJECT_SPECS[type].label}
                      </button>
                    ))}
                  </div>
                  </>
                )}

                <div className="map-primary-actions" style={{ marginTop: 10 }}>
                  <button className="tool-btn scan-primary" onClick={save} disabled={saving || !model}>
                    <Save size={14} /> {saving ? "Gemmer…" : "Gem 3D-have"}
                  </button>
                  <button className="tool-btn" onClick={() => setView(view === "3d" ? "map" : "3d")}>
                    <Layers3 size={14} /> {view === "3d" ? "Placér objekter" : "Vis i 3D"}
                  </button>
                  {elevationStatus !== "ready" && (
                    <button className="tool-btn" onClick={() => loadElevation(false)} disabled={elevationStatus === "loading"}>
                      <Mountain size={14} /> {elevationStatus === "loading" ? "Henter højder…" : "Hent højdedata"}
                    </button>
                  )}
                </div>
              </div>

              <aside className="recommendation">
                <div className="eyebrow" style={{ marginBottom: 14 }}>3D Garden Twin</div>

                <div className="garden-scan-panel__metrics" style={{ marginBottom: 16 }}>
                  <div><Layers3 size={14} /><strong>{objects.length}</strong><span>objekter</span></div>
                  <div><Mountain size={14} /><strong>{elevation ? `${elevation.stats.reliefM.toFixed(1)}m` : "—"}</strong><span>terrænfald</span></div>
                  <div><Ruler size={14} /><strong>{model.quality.score}</strong><span>/100 kvalitet</span></div>
                </div>

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
                    <SliderRow label={`Bredde · ${selected.widthM.toFixed(1)} m`} min={0.3} max={20} step={0.1} value={selected.widthM} onChange={(v) => patchSelected({ widthM: Number(v.toFixed(2)) })} onEditStart={snapshot} />
                    <SliderRow label={`Dybde · ${selected.depthM.toFixed(1)} m`} min={0.1} max={20} step={0.1} value={selected.depthM} onChange={(v) => patchSelected({ depthM: Number(v.toFixed(2)) })} onEditStart={snapshot} />
                    <SliderRow label={`Drejning · ${Math.round(selected.rotationDeg)}°`} min={0} max={180} step={1} value={selected.rotationDeg} onChange={(v) => patchSelected({ rotationDeg: v })} onEditStart={snapshot} icon={<RotateCw size={12} />} />

                    <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
                      {OBJECT_SPECS[selected.type].measurable && elevation && (
                        <button className="tool-btn" onClick={remeasureSelected}><Sparkles size={13} /> Mål højde (DHM)</button>
                      )}
                      <span style={{ fontSize: 10, color: "var(--gold)", alignSelf: "center", letterSpacing: 0.4 }}>
                        {selected.heightSource === "dhm_measured" ? "Højde målt fra DHM" : selected.heightSource === "user" ? "Højde sat manuelt" : "Standardhøjde"}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="rec-mower" style={{ textAlign: "left" }}>
                    <div className="tier">Sådan bygger du</div>
                    <ol style={{ fontSize: 12.5, color: "var(--ink-500)", lineHeight: 1.7, paddingLeft: 18, margin: "8px 0 0" }}>
                      <li><strong>Find objekter (DHM)</strong> finder automatisk træer, hække og skure.</li>
                      <li>Tilføj selv flere: vælg fx <strong>Træ</strong> i paletten og klik på kortet.</li>
                      <li>Højden hentes fra Danmarks Højdemodel, hvor det kan måles.</li>
                      <li>Finjustér, se i 3D, og gem.</li>
                    </ol>
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
                          onClick={() => setSelectedId(object.id)}
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
