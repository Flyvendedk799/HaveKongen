import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import * as turf from "@turf/turf";
import "mapbox-gl/dist/mapbox-gl.css";
import { AppNav, SiteFooter } from "@/components/layout/SiteChrome";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { useAuth } from "@/lib/auth";
import { useActiveGarden } from "@/lib/activeGarden";
import { toast } from "sonner";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { addRingToSet, pixelDistance } from "@/lib/polygonOps";
import {
  buildSegmentationCacheKey,
  isBlockingLawnSegmentationWarning,
  readAcceptedSegmentationCache,
  scoreLawnSegmentationResult,
  segmentLawnFromCrop,
  writeAcceptedSegmentationCache,
  type LawnCropPayload,
  type LawnSegmentationResult,
  type SegmentationOptions,
  type SegmentationSeed,
} from "@/lib/lawnSegmentation";
import { logHavemaalerSegmentationEvent } from "@/lib/lawnSegmentation/telemetry";
import PinpointSequence from "@/components/havemaaler/PinpointSequence";
import GardenTwinViewer from "@/components/havemaaler/GardenTwinViewer";
import GardenScanPanel from "@/components/havemaaler/GardenScanPanel";
import {
  coerceGardenDepthModel,
  depthModelToJson,
  generateGardenDepthModel,
  type GardenDepthModel,
} from "@/lib/gardenDepth";
import { isTerminalScanStatus, scanCanStartNewSession, webGardenScanUrl } from "@/lib/gardenScan";
import type { GardenScanSession, ScanUploadTarget } from "@/lib/gardenScan";

type Suggestion = { id: string; place_name: string; center: [number, number]; text: string; source?: "dawa" | "mapbox" };
type LngLat = [number, number];
type Ring = LngLat[];
type Mode = "draw" | "exclude" | "edit" | "wand";
type WandOp = "replace" | "add" | "subtract";
type WandReviewMode = "none" | "add" | "remove";
type WandStage = "idle" | "Henter billede" | "Finder græs" | "Tegner kant" | "Klar til tjek";
type Imagery = "ortofoto" | "mapbox";
type MapView = "map" | "twin";
type EditableRingId = "main" | `lawn:${number}` | `excl:${number}`;
type SavedGarden = Pick<Tables<"gardens">, "id" | "name" | "address" | "latitude" | "longitude" | "polygon" | "exclusions" | "imagery_source" | "thumbnail_url" | "depth_model" | "depth_model_updated_at">;
type SavedLawnZone = Pick<Tables<"garden_zones">, "id" | "polygon">;

const AUTOSAVE_KEY = "havemaaler:draft:v2";
const WAND_CROP_METERS = 36;
const WAND_IMAGE_SIZE = 512;
const WAND_TIMEOUT_MS = 30000;

function parseMaybeJson(value: unknown) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function isLngLat(value: unknown): value is LngLat {
  return Array.isArray(value) && value.length >= 2 && typeof value[0] === "number" && typeof value[1] === "number";
}

function sameLngLat(a: LngLat, b: LngLat) {
  return Math.abs(a[0] - b[0]) < 1e-10 && Math.abs(a[1] - b[1]) < 1e-10;
}

function normalizeRing(coords: unknown): Ring | null {
  if (!Array.isArray(coords)) return null;
  const ring = coords.filter(isLngLat).map((point) => [point[0], point[1]] as LngLat);
  if (ring.length >= 2 && sameLngLat(ring[0], ring[ring.length - 1])) ring.pop();
  return ring.length >= 3 ? ring : null;
}

function ringsFromGeoJson(value: unknown): Ring[] {
  const data = parseMaybeJson(value);
  if (!data || typeof data !== "object") return [];
  const obj = data as { type?: unknown; coordinates?: unknown };
  if (obj.type === "Polygon" && Array.isArray(obj.coordinates)) {
    const ring = normalizeRing(obj.coordinates[0]);
    return ring ? [ring] : [];
  }
  if (obj.type === "MultiPolygon" && Array.isArray(obj.coordinates)) {
    return obj.coordinates
      .map((polygon) => {
        if (!Array.isArray(polygon)) return null;
        return normalizeRing(polygon[0]) ?? (Array.isArray(polygon[0]) ? normalizeRing(polygon[0][0]) : null);
      })
      .filter((ring): ring is Ring => Boolean(ring));
  }
  if (Array.isArray(data)) {
    const direct = normalizeRing(data);
    if (direct) return [direct];
    const polygonRing = normalizeRing(data[0]);
    return polygonRing ? [polygonRing] : [];
  }
  return [];
}

function exclusionRingsFromJson(value: unknown): Ring[] {
  const data = parseMaybeJson(value);
  if (!Array.isArray(data)) return ringsFromGeoJson(data);
  return data.flatMap((item) => {
    const rings = ringsFromGeoJson(item);
    if (rings.length) return rings;
    const ring = normalizeRing(item);
    return ring ? [ring] : [];
  });
}

function centerFromRings(rings: Ring[]): LngLat | null {
  const points = rings.flat();
  if (!points.length) return null;
  const lngs = points.map((point) => point[0]);
  const lats = points.map((point) => point[1]);
  return [
    (Math.min(...lngs) + Math.max(...lngs)) / 2,
    (Math.min(...lats) + Math.max(...lats)) / 2,
  ];
}

function safeInternalPath(value: string | null) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return null;
  return value;
}

function uniqueSuggestions(items: Suggestion[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = `${item.place_name.toLowerCase()}|${item.center[0].toFixed(6)},${item.center[1].toFixed(6)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function describeSupabaseError(error: unknown) {
  if (!error) return undefined;
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error !== "object") return undefined;

  const record = error as Record<string, unknown>;
  const message = typeof record.message === "string" ? record.message : null;
  const details = typeof record.details === "string" ? record.details : null;
  const hint = typeof record.hint === "string" ? record.hint : null;
  const code = typeof record.code === "string" ? record.code : null;
  return [message, details, hint, code ? `Kode: ${code}` : null].filter(Boolean).join(" · ") || undefined;
}

function isDepthModelSchemaError(error: unknown) {
  const description = describeSupabaseError(error)?.toLowerCase() ?? "";
  return description.includes("depth_model")
    || description.includes("depth_model_updated_at")
    || (description.includes("schema cache") && description.includes("depth"));
}

function ringBbox(ring?: Ring | null): [number, number, number, number] | undefined {
  if (!ring || ring.length < 3) return undefined;
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
  for (const [lng, lat] of ring) {
    if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
  }
  return [minLng, minLat, maxLng, maxLat];
}

function clipBboxToParcel(bbox: [number, number, number, number], parcel?: Ring | null): [number, number, number, number] {
  const parcelBox = ringBbox(parcel);
  if (!parcelBox) return bbox;
  return [Math.max(bbox[0], parcelBox[0]), Math.max(bbox[1], parcelBox[1]), Math.min(bbox[2], parcelBox[2]), Math.min(bbox[3], parcelBox[3])];
}

const TIERS = [
  { name: "Klipper R1 Mini",   tier: "Indgangsmodel", max: 600,  price: "6.299 kr",  battery: "90 min",  noise: "52 dB" },
  { name: "Klipper R2 Plus",   tier: "Familie",       max: 1200, price: "9.499 kr",  battery: "140 min", noise: "55 dB" },
  { name: "Klipper R3 Pro",    tier: "Stor have",     max: 2500, price: "12.499 kr", battery: "180 min", noise: "58 dB" },
  { name: "Klipper R4 Estate", tier: "Erhverv",       max: 5000, price: "18.999 kr", battery: "240 min", noise: "60 dB" },
];

export default function GardenSizer() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { setActive } = useActiveGarden();
  const gardenIdParam = searchParams.get("garden") ?? searchParams.get("gardenId");
  const returnTo = safeInternalPath(searchParams.get("next"));

  const [mapboxToken, setMapboxToken] = useState<string | null>(null);
  const [ortoCfg, setOrtoCfg] = useState<{ wmsTemplate: string } | null>(null);

  const [step, setStep] = useState<1 | 2>(1);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<{ name: string; center: LngLat } | null>(null);

  const [imagery, setImagery] = useState<Imagery>("ortofoto");
  const [mode, setMode] = useState<Mode>("draw");
  const [mapView, setMapView] = useState<MapView>("map");

  // Polygon state
  const [main, setMain] = useState<Ring>([]);
  const [mainClosed, setMainClosed] = useState(false);
  const [additionalLawns, setAdditionalLawns] = useState<Ring[]>([]);
  const [currentLawn, setCurrentLawn] = useState<Ring>([]);
  const [exclusions, setExclusions] = useState<Ring[]>([]);
  const [currentExclusion, setCurrentExclusion] = useState<Ring>([]);
  const [hover, setHover] = useState<LngLat | null>(null);
  const [draggingVertex, setDraggingVertex] = useState<{ ring: EditableRingId; idx: number } | null>(null);

  const [matrikel, setMatrikel] = useState<Ring | null>(null);
  const [wandLoading, setWandLoading] = useState(false);
  const [wandOp, setWandOp] = useState<WandOp>("replace");
  const [wandConfidence, setWandConfidence] = useState<number | null>(null);
  const [wandBbox, setWandBbox] = useState<[number, number, number, number] | null>(null);
  const [wandHoverPos, setWandHoverPos] = useState<LngLat | null>(null);
  const [wandStage, setWandStage] = useState<WandStage>("idle");
  const [wandPreview, setWandPreview] = useState<LawnSegmentationResult | null>(null);
  const [wandCrop, setWandCrop] = useState<LawnCropPayload | null>(null);
  const [wandSeeds, setWandSeeds] = useState<SegmentationSeed[]>([]);
  const [wandReviewMode, setWandReviewMode] = useState<WandReviewMode>("none");
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [snapIndicator, setSnapIndicator] = useState<LngLat | null>(null);
  const [saving, setSaving] = useState(false);
  const [startingScan, setStartingScan] = useState(false);
  const [savedDepthModel, setSavedDepthModel] = useState<GardenDepthModel | null>(null);
  const [scanLaunch, setScanLaunch] = useState<{ sessionId: string; scanUrl: string; uploadPrefix?: string | null; uploadTargets?: ScanUploadTarget[] } | null>(null);
  const [scanSessions, setScanSessions] = useState<GardenScanSession[]>([]);
  const [pinpointing, setPinpointing] = useState<{ name: string; center: LngLat } | null>(null);
  const [loadingSavedGarden, setLoadingSavedGarden] = useState(Boolean(gardenIdParam));
  const [editingGarden, setEditingGarden] = useState<SavedGarden | null>(null);

  // History (undo/redo)
  type Snap = { main: Ring; mainClosed: boolean; additionalLawns: Ring[]; currentLawn: Ring; exclusions: Ring[] };
  const historyRef = useRef<{ past: Snap[]; future: Snap[] }>({ past: [], future: [] });
  const skipHistoryRef = useRef(false);

  const mapRef = useRef<mapboxgl.Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const completedLawns = useMemo(
    () => (mainClosed && main.length >= 3 ? [main, ...additionalLawns] : []),
    [main, mainClosed, additionalLawns],
  );
  const lawnZoneCount = completedLawns.length;
  const totalLawnCorners = completedLawns.reduce((sum, ring) => sum + ring.length, 0) + (!mainClosed ? main.length : currentLawn.length);

  useEffect(() => {
    document.body.classList.toggle("is-havemaaler-measuring", step === 2);
    return () => document.body.classList.remove("is-havemaaler-measuring");
  }, [step]);

  // ----- Tokens -----
  useEffect(() => {
    supabase.functions.invoke("get-mapbox-token").then(({ data, error }) => {
      if (!error && data?.token) {
        setMapboxToken(data.token);
        mapboxgl.accessToken = data.token;
      } else toast.error("Kunne ikke hente kort-token");
    });
    supabase.functions.invoke("get-ortofoto-config").then(({ data }) => {
      if (data?.wmsTemplate) setOrtoCfg({ wmsTemplate: data.wmsTemplate });
      else setImagery("mapbox");
    }).catch(() => setImagery("mapbox"));
  }, []);

  useEffect(() => {
    if (!gardenIdParam || authLoading || user) return;
    const next = encodeURIComponent(`/havemaaler?garden=${gardenIdParam}`);
    navigate(`/login?next=${next}`);
  }, [authLoading, gardenIdParam, navigate, user]);

  // ----- Pre-connect warm-up so the pinpoint overlay boots without a freeze -----
  useEffect(() => {
    const hosts = ["https://api.mapbox.com", "https://api.dataforsyningen.dk"];
    const links: HTMLLinkElement[] = [];
    hosts.forEach((href) => {
      const l = document.createElement("link");
      l.rel = "preconnect"; l.href = href; l.crossOrigin = "";
      document.head.appendChild(l); links.push(l);
    });
    return () => { links.forEach((l) => l.remove()); };
  }, []);

  // ----- Geocode (debounced) -----
  useEffect(() => {
    if (query.trim().length < 2) { setSuggestions([]); return; }
    const t = setTimeout(async () => {
      const dawaUrl = `https://api.dataforsyningen.dk/adresser/autocomplete?q=${encodeURIComponent(query)}&type=adresse&per_side=6`;
      try {
        const r = await fetch(dawaUrl); const j = await r.json();
        const exact = (Array.isArray(j) ? j : [])
          .map((item: any) => item?.adresse)
          .filter((a: any) => Number.isFinite(a?.x) && Number.isFinite(a?.y))
          .map((a: any) => ({
            id: a.id,
            place_name: `${a.vejnavn} ${a.husnr}, ${a.postnr} ${a.postnrnavn}`,
            center: [a.x, a.y] as LngLat,
            text: `${a.vejnavn} ${a.husnr}`,
            source: "dawa" as const,
          }));
        if (exact.length) { setSuggestions(uniqueSuggestions(exact)); return; }
        if (!mapboxToken) return;
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?country=dk&language=da&limit=6&access_token=${mapboxToken}`;
        const mr = await fetch(url); const mj = await mr.json();
        setSuggestions(uniqueSuggestions((mj.features ?? []).map((f: any) => ({
          id: f.id, place_name: f.place_name, center: f.center as LngLat, text: f.text, source: "mapbox" as const,
        }))));
      } catch { /* ignore */ }
    }, 220);
    return () => clearTimeout(t);
  }, [query, mapboxToken]);

  function chooseAddress(s: Suggestion) {
    setQuery(s.place_name); setOpen(false);
    setMain([]); setMainClosed(false); setAdditionalLawns([]); setCurrentLawn([]); setExclusions([]); setCurrentExclusion([]);
    clearWandPreview();
    setMatrikel(null);
    setSavedDepthModel(null);
    setScanLaunch(null);
    setMapView("map");
    // Trigger cinematic pinpoint; finalises into step 2 in onDone
    setPinpointing({ name: s.place_name, center: s.center });
  }

  function chooseFirstAddress() {
    if (suggestions[0]) {
      chooseAddress(suggestions[0]);
      return;
    }
    toast(query.trim().length < 2 ? "Indtast en adresse først" : "Vælg en adresse fra listen");
  }

  // ----- Build style for current imagery choice -----
  const buildStyle = useCallback((): mapboxgl.Style => {
    if (imagery === "ortofoto" && ortoCfg) {
      return {
        version: 8,
        glyphs: "mapbox://fonts/mapbox/{fontstack}/{range}.pbf",
        sources: {
          sat: {
            type: "raster",
            tiles: [`https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token=${mapboxToken}`],
            tileSize: 256,
            attribution: "© Mapbox",
            maxzoom: 19,
          },
          orto: {
            type: "raster",
            tiles: [ortoCfg.wmsTemplate],
            tileSize: 512,
            attribution: "© SDFE / Dataforsyningen",
          },
        },
        layers: [
          { id: "sat", type: "raster", source: "sat" },
          { id: "orto", type: "raster", source: "orto", paint: { "raster-opacity": 0.88 } },
        ],
      } as any;
    }
    return "mapbox://styles/mapbox/satellite-streets-v12" as any;
  }, [imagery, ortoCfg, mapboxToken]);

  // ----- Init / re-init map -----
  useEffect(() => {
    if (step !== 2 || !chosen || !mapboxToken || !containerRef.current) return;
    if (imagery === "ortofoto" && !ortoCfg) return; // wait for config

    if (mapRef.current) {
      mapRef.current.setStyle(buildStyle() as any);
      // Re-add overlay sources after style swap
      mapRef.current.once("style.load", addOverlayLayers);
      return;
    }

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: buildStyle() as any,
      center: chosen.center,
      zoom: 19, minZoom: 14, maxZoom: 21,
      pitch: 0,
      preserveDrawingBuffer: true, // needed for magic wand pixel readback
    });
    map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "top-right");
    mapRef.current = map;
    map.on("load", addOverlayLayers);
    map.on("click", onMapClick);
    map.on("mousemove", onMapMove);
    map.on("mousedown", onMapMouseDown);
    map.on("mouseup", () => setDraggingVertex(null));
    map.on("dblclick", onMapDblClick);
    map.on("contextmenu", onMapContextMenu);

    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, mapboxToken, ortoCfg, chosen?.center?.[0], chosen?.center?.[1]]);

  // Style swap when imagery changes
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    map.setStyle(buildStyle() as any);
    map.once("style.load", addOverlayLayers);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imagery, ortoCfg]);

  function addOverlayLayers() {
    const map = mapRef.current; if (!map) return;
    const empty = { type: "FeatureCollection", features: [] } as any;
    if (!map.getSource("matrikel")) {
      map.addSource("matrikel", { type: "geojson", data: empty });
      map.addLayer({ id: "matrikel-line", type: "line", source: "matrikel",
        paint: { "line-color": "#d8a651", "line-width": 1.5, "line-dasharray": [2, 2], "line-opacity": 0.8 } });
    }
    if (!map.getSource("polygon")) {
      map.addSource("polygon", { type: "geojson", data: empty });
      map.addLayer({ id: "polygon-fill", type: "fill", source: "polygon",
        paint: { "fill-color": "#7fa07e", "fill-opacity": 0.35 } });
      map.addLayer({ id: "polygon-line", type: "line", source: "polygon",
        paint: { "line-color": "#d8a651", "line-width": 2.5 } });
    }
    if (!map.getSource("exclusions")) {
      map.addSource("exclusions", { type: "geojson", data: empty });
      map.addLayer({ id: "excl-fill", type: "fill", source: "exclusions",
        paint: { "fill-color": "#14271d", "fill-opacity": 0.55 } });
      map.addLayer({ id: "excl-line", type: "line", source: "exclusions",
        paint: { "line-color": "#ff7a59", "line-width": 1.6, "line-dasharray": [3, 2] } });
    }
    if (!map.getSource("vertices")) {
      map.addSource("vertices", { type: "geojson", data: empty });
      map.addLayer({ id: "vertices-circle", type: "circle", source: "vertices",
        paint: {
          "circle-radius": ["case", ["==", ["get", "midpoint"], true], 4, 6],
          "circle-color": ["case", ["==", ["get", "midpoint"], true], "#edc88b", "#d8a651"],
          "circle-stroke-color": "#14271d", "circle-stroke-width": 1.5,
          "circle-opacity": ["case", ["==", ["get", "midpoint"], true], 0.7, 1],
        } });
    }
    if (!map.getSource("edge-labels")) {
      map.addSource("edge-labels", { type: "geojson", data: empty });
      map.addLayer({ id: "edge-labels", type: "symbol", source: "edge-labels",
        layout: { "text-field": ["get", "label"], "text-size": 11, "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"], "text-allow-overlap": true },
        paint: { "text-color": "#edcf95", "text-halo-color": "#14271d", "text-halo-width": 1.5 } });
    }
    if (!map.getSource("snap")) {
      map.addSource("snap", { type: "geojson", data: empty });
      map.addLayer({ id: "snap-ring", type: "circle", source: "snap",
        paint: { "circle-radius": 9, "circle-color": "transparent", "circle-stroke-color": "#fff7d6", "circle-stroke-width": 2 } });
    }
    if (!map.getSource("wand-area")) {
      map.addSource("wand-area", { type: "geojson", data: empty });
      map.addLayer({ id: "wand-area-fill", type: "fill", source: "wand-area",
        paint: { "fill-color": "#edcf95", "fill-opacity": 0.08 } });
      map.addLayer({ id: "wand-area-line", type: "line", source: "wand-area",
        paint: { "line-color": "#edcf95", "line-width": 1.5, "line-dasharray": [2, 3], "line-opacity": 0.8 } });
    }
    if (!map.getSource("wand-preview")) {
      map.addSource("wand-preview", { type: "geojson", data: empty });
      map.addLayer({ id: "wand-preview-fill", type: "fill", source: "wand-preview",
        paint: { "fill-color": "#86d67d", "fill-opacity": 0.28 } });
      map.addLayer({ id: "wand-preview-line", type: "line", source: "wand-preview",
        paint: { "line-color": "#fff0a8", "line-width": 3, "line-opacity": 0.95 } });
    }
    if (!map.getSource("wand-preview-exclusions")) {
      map.addSource("wand-preview-exclusions", { type: "geojson", data: empty });
      map.addLayer({ id: "wand-preview-exclusions-fill", type: "fill", source: "wand-preview-exclusions",
        paint: { "fill-color": "#12251b", "fill-opacity": 0.5 } });
      map.addLayer({ id: "wand-preview-exclusions-line", type: "line", source: "wand-preview-exclusions",
        paint: { "line-color": "#ff8f6d", "line-width": 1.5, "line-dasharray": [2, 2] } });
    }
    syncMap();
  }

  // ----- Map event handlers (read latest state via refs) -----
  const stateRef = useRef({
    mode, main, mainClosed, additionalLawns, currentLawn, exclusions, currentExclusion, draggingVertex,
    matrikel, wandLoading, wandOp, wandPreview, wandCrop, wandSeeds, wandReviewMode, wandStage, snapEnabled,
  });
  useEffect(() => {
    stateRef.current = {
      mode, main, mainClosed, additionalLawns, currentLawn, exclusions, currentExclusion, draggingVertex,
      matrikel, wandLoading, wandOp, wandPreview, wandCrop, wandSeeds, wandReviewMode, wandStage, snapEnabled,
    };
  });

  function setCompletedLawnRings(rings: Ring[]) {
    const clean = rings.filter((r) => r.length >= 3);
    if (!clean.length) {
      setMain([]);
      setMainClosed(false);
      setAdditionalLawns([]);
      setCurrentLawn([]);
      return;
    }
    setMain(clean[0]);
    setMainClosed(true);
    setAdditionalLawns(clean.slice(1));
    setCurrentLawn([]);
  }

  function addCompletedLawn(ring: Ring) {
    const s = stateRef.current;
    const base = s.mainClosed && s.main.length >= 3 ? [s.main, ...s.additionalLawns] : [];
    setCompletedLawnRings(addRingToSet(base, ring));
  }

  function updateEditableRing(ring: EditableRingId, updater: (ring: Ring) => Ring) {
    if (ring === "main") {
      setMain((prev) => updater(prev));
    } else if (ring.startsWith("lawn:")) {
      const idx = Number(ring.slice(5));
      setAdditionalLawns((prev) => prev.map((r, i) => i === idx ? updater(r) : r));
    } else {
      const idx = Number(ring.slice(5));
      setExclusions((prev) => prev.map((r, i) => i === idx ? updater(r) : r));
    }
  }

  function onMapClick(e: mapboxgl.MapMouseEvent) {
    const map = mapRef.current!;
    let ll: LngLat = [e.lngLat.lng, e.lngLat.lat];
    const s = stateRef.current;

    if (s.mode === "wand") {
      if (s.wandPreview && s.wandCrop && (s.wandReviewMode === "add" || s.wandReviewMode === "remove")) {
        refineWandFromClick(ll, s.wandReviewMode);
      } else {
        runMagicWand(ll);
      }
      return;
    }

    // Snap when drawing or editing
    if (s.mode === "draw" || s.mode === "exclude") ll = snapPoint(ll);

    if (s.mode === "edit") {
      // insert vertex on midpoint click
      const feats = map.queryRenderedFeatures(e.point, { layers: ["vertices-circle"] });
      const mid = feats.find(f => (f.properties as any)?.midpoint);
      if (mid) {
        const idx = (mid.properties as any).insertAt as number;
        const ring = (mid.properties as any).ring as EditableRingId;
        updateEditableRing(ring, (prev) => { const n = [...prev]; n.splice(idx, 0, ll); return n; });
      }
      return;
    }

    if (s.mode === "draw") {
      const drawingRing = s.mainClosed ? s.currentLawn : s.main;
      if (drawingRing.length >= 3) {
        const start = map.project(drawingRing[0] as any);
        const cur = map.project(ll as any);
        if (Math.hypot(start.x - cur.x, start.y - cur.y) < 14) {
          if (s.mainClosed) addCompletedLawn(drawingRing);
          else setMainClosed(true);
          return;
        }
      }
      if (s.mainClosed) setCurrentLawn(p => [...p, ll]);
      else setMain(p => [...p, ll]);
    } else if (s.mode === "exclude") {
      if (!s.mainClosed) { toast("Tegn græsplænen først"); return; }
      if (s.currentExclusion.length >= 3) {
        const start = map.project(s.currentExclusion[0] as any);
        const cur = map.project(ll as any);
        if (Math.hypot(start.x - cur.x, start.y - cur.y) < 14) {
          setExclusions(prev => [...prev, s.currentExclusion]);
          setCurrentExclusion([]);
          return;
        }
      }
      setCurrentExclusion(p => [...p, ll]);
    }
  }

  function onMapDblClick(e: mapboxgl.MapMouseEvent) {
    e.preventDefault();
    const s = stateRef.current;
    if (s.mode === "draw" && s.main.length >= 3 && !s.mainClosed) setMainClosed(true);
    else if (s.mode === "draw" && s.mainClosed && s.currentLawn.length >= 3) {
      addCompletedLawn(s.currentLawn);
    }
    else if (s.mode === "exclude" && s.currentExclusion.length >= 3) {
      setExclusions(prev => [...prev, s.currentExclusion]);
      setCurrentExclusion([]);
    }
  }

  function onMapContextMenu(e: mapboxgl.MapMouseEvent) {
    const s = stateRef.current;
    if (s.mode !== "edit") return;
    const map = mapRef.current!;
    const feats = map.queryRenderedFeatures(e.point, { layers: ["vertices-circle"] });
    const real = feats.find(f => !(f.properties as any)?.midpoint);
    if (!real) return;
    e.preventDefault();
    const ring = (real.properties as any).ring as EditableRingId;
    const idx = (real.properties as any).idx as number;
    deleteVertex(ring, idx);
    if ((navigator as any).vibrate) (navigator as any).vibrate(20);
  }

  function onMapMouseDown(e: mapboxgl.MapMouseEvent) {
    const s = stateRef.current; if (s.mode !== "edit") return;
    const map = mapRef.current!;
    const feats = map.queryRenderedFeatures(e.point, { layers: ["vertices-circle"] });
    const real = feats.find(f => !(f.properties as any)?.midpoint);
    if (!real) return;
    const ring = (real.properties as any).ring as EditableRingId;
    const idx = (real.properties as any).idx as number;
    setDraggingVertex({ ring, idx });
    map.dragPan.disable();
    e.preventDefault();
  }

  function onMapMove(e: mapboxgl.MapMouseEvent) {
    const ll: LngLat = [e.lngLat.lng, e.lngLat.lat];
    const s = stateRef.current;
    if (s.mode === "wand") setWandHoverPos(ll);
    if (s.mode === "draw" || s.mode === "exclude") {
      const snapped = snapPoint(ll);
      setHover(snapped);
    } else {
      setHover(ll);
    }
    if (s.draggingVertex) {
      let dragLL = ll;
      if (s.mode === "edit") dragLL = snapPoint(ll);
      updateEditableRing(s.draggingVertex.ring, (ring) => ring.map((v, i) => i === s.draggingVertex!.idx ? dragLL : v));
    }
  }

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (draggingVertex) map.dragPan.disable(); else map.dragPan.enable();
  }, [draggingVertex]);

  // ----- Sync map sources with state -----
  function syncMap() {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;

    // Lawn polygons (completed rings plus the live ring currently being drawn)
    const polyData: any = { type: "FeatureCollection", features: [] };
    if (mainClosed && main.length >= 3) {
      [main, ...additionalLawns].forEach((r, i) => {
        polyData.features.push({
          type: "Feature",
          properties: { lawnIndex: i },
          geometry: { type: "Polygon", coordinates: [[...r, r[0]]] },
        });
      });
    } else if (main.length >= 2) {
      const liveRing = (hover && mode === "draw") ? [...main, hover] : main;
      polyData.features.push({
        type: "Feature", properties: {},
        geometry: { type: "LineString", coordinates: liveRing },
      });
    }
    if (mainClosed && currentLawn.length >= 2) {
      const liveLawn = (hover && mode === "draw") ? [...currentLawn, hover] : currentLawn;
      polyData.features.push({
        type: "Feature", properties: { draft: true },
        geometry: { type: "LineString", coordinates: liveLawn },
      });
    }
    (map.getSource("polygon") as mapboxgl.GeoJSONSource)?.setData(polyData);

    // Exclusions
    const exclData: any = { type: "FeatureCollection", features: [] };
    exclusions.forEach(r => exclData.features.push({
      type: "Feature", properties: {},
      geometry: { type: "Polygon", coordinates: [[...r, r[0]]] },
    }));
    if (currentExclusion.length >= 2) {
      const liveExcl = (hover && mode === "exclude") ? [...currentExclusion, hover] : currentExclusion;
      exclData.features.push({
        type: "Feature", properties: {},
        geometry: { type: "LineString", coordinates: liveExcl },
      });
    }
    (map.getSource("exclusions") as mapboxgl.GeoJSONSource)?.setData(exclData);

    // Vertices (real + midpoints in edit mode)
    const vData: any = { type: "FeatureCollection", features: [] };
    const pushRing = (r: Ring, ringId: string) => {
      r.forEach((p, i) => vData.features.push({
        type: "Feature", properties: { ring: ringId, idx: i, midpoint: false },
        geometry: { type: "Point", coordinates: p },
      }));
      if (mode === "edit" && r.length >= 2) {
        const looped = [...r, r[0]];
        for (let i = 0; i < looped.length - 1; i++) {
          const a = looped[i], b = looped[i + 1];
          vData.features.push({
            type: "Feature",
            properties: { ring: ringId, idx: i, midpoint: true, insertAt: i + 1 },
            geometry: { type: "Point", coordinates: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] },
          });
        }
      }
    };
    if (main.length) pushRing(main, "main");
    additionalLawns.forEach((r, i) => pushRing(r, `lawn:${i}`));
    if (mode === "draw" && mainClosed && currentLawn.length) pushRing(currentLawn, "draft");
    exclusions.forEach((r, i) => pushRing(r, `excl:${i}`));
    (map.getSource("vertices") as mapboxgl.GeoJSONSource)?.setData(vData);

    // Edge labels for the active drawing ring or all completed lawns in edit mode.
    const labelData: any = { type: "FeatureCollection", features: [] };
    const pushLabels = (sourceRing: Ring, closedRing: boolean) => {
      if (sourceRing.length < 2) return;
      const ring = closedRing ? [...sourceRing, sourceRing[0]] : sourceRing;
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i], b = ring[i + 1];
        const len = turf.distance(a, b, { units: "kilometers" }) * 1000;
        labelData.features.push({
          type: "Feature",
          properties: { label: `${len.toFixed(1)} m` },
          geometry: { type: "Point", coordinates: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] },
        });
      }
    };
    if (mode === "draw") {
      pushLabels(mainClosed ? currentLawn : main, false);
    } else if (mode === "edit") {
      if (mainClosed) [main, ...additionalLawns].forEach((r) => pushLabels(r, true));
      else pushLabels(main, false);
    }
    (map.getSource("edge-labels") as mapboxgl.GeoJSONSource)?.setData(labelData);

    // Matrikel
    const matrData: any = { type: "FeatureCollection", features: [] };
    if (matrikel && matrikel.length >= 3) {
      matrData.features.push({
        type: "Feature", properties: {},
        geometry: { type: "Polygon", coordinates: [[...matrikel, matrikel[0]]] },
      });
    }
    (map.getSource("matrikel") as mapboxgl.GeoJSONSource)?.setData(matrData);

    // Snap indicator
    const snapData: any = { type: "FeatureCollection", features: [] };
    if (snapIndicator) snapData.features.push({ type: "Feature", properties: {}, geometry: { type: "Point", coordinates: snapIndicator } });
    (map.getSource("snap") as mapboxgl.GeoJSONSource)?.setData(snapData);

    // Wand area preview / analyzed bbox
    const wandData: any = { type: "FeatureCollection", features: [] };
    const previewBbox = mode === "wand" && wandHoverPos ? (() => {
      const half = WAND_CROP_METERS / 2;
      const lat = half / 111320; const lng = half / (111320 * Math.cos(wandHoverPos[1] * Math.PI / 180));
      return clipBboxToParcel([wandHoverPos[0] - lng, wandHoverPos[1] - lat, wandHoverPos[0] + lng, wandHoverPos[1] + lat], matrikel);
    })() : (mode === "wand" ? wandBbox : null);
    if (previewBbox) {
      const [w, s, e, n] = previewBbox;
      wandData.features.push({
        type: "Feature", properties: {},
        geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
      });
    }
    (map.getSource("wand-area") as mapboxgl.GeoJSONSource)?.setData(wandData);

    const wandPreviewData: any = { type: "FeatureCollection", features: [] };
    const wandPreviewExclusionsData: any = { type: "FeatureCollection", features: [] };
    if (mode === "wand" && wandPreview?.polygon?.length >= 3) {
      const closeRing = (r: Ring) => [...r, r[0]];
      wandPreviewData.features.push({
        type: "Feature",
        properties: { confidence: wandPreview.confidence, needsReview: wandPreview.needsReview },
        geometry: { type: "Polygon", coordinates: [closeRing(wandPreview.polygon), ...wandPreview.exclusions.map(closeRing)] },
      });
      wandPreview.exclusions.forEach((r) => {
        if (r.length < 3) return;
        wandPreviewExclusionsData.features.push({
          type: "Feature",
          properties: {},
          geometry: { type: "Polygon", coordinates: [closeRing(r)] },
        });
      });
    }
    (map.getSource("wand-preview") as mapboxgl.GeoJSONSource)?.setData(wandPreviewData);
    (map.getSource("wand-preview-exclusions") as mapboxgl.GeoJSONSource)?.setData(wandPreviewExclusionsData);
  }

  useEffect(() => { syncMap(); }, [main, mainClosed, additionalLawns, currentLawn, exclusions, currentExclusion, hover, mode, matrikel, snapIndicator, wandHoverPos, wandBbox, wandPreview]);

  // ----- Area / perimeter (multiple lawns with exclusions subtracted) -----
  const { area, perim, lawnAreas } = useMemo(() => {
    const areas = completedLawns.map((ring) => {
      let poly: any = turf.polygon([[...ring, ring[0]]]);
      exclusions.forEach(r => {
        if (r.length < 3) return;
        try {
          const ex = turf.polygon([[...r, r[0]]]);
          const diff = turf.difference(turf.featureCollection([poly, ex]) as any);
          if (diff) poly = diff;
        } catch {}
      });
      return turf.area(poly);
    });
    const totalArea = areas.reduce((sum, value) => sum + value, 0);
    const totalPerim = completedLawns.reduce((sum, ring) => (
      sum + turf.length(turf.lineString([...ring, ring[0]]), { units: "kilometers" }) * 1000
    ), 0);
    return { area: totalArea, perim: totalPerim, lawnAreas: areas };
  }, [completedLawns, exclusions]);

  const tier = TIERS.find((t) => area <= t.max) ?? TIERS[TIERS.length - 1];
  const generatedDepthModel = useMemo(() => generateGardenDepthModel({
    gardenId: editingGarden?.id ?? null,
    name: chosen?.name ?? editingGarden?.name ?? "Min have",
    center: chosen?.center ?? null,
    lawnRings: completedLawns,
    exclusions,
    matrikel,
    areaM2: area > 0 ? Math.round(area) : null,
  }), [area, chosen?.center, chosen?.name, completedLawns, editingGarden?.id, editingGarden?.name, exclusions, matrikel]);
  const activeDepthModel = savedDepthModel ?? generatedDepthModel;
  const depthObjectCount = activeDepthModel?.objects.length ?? 0;
  const canStartNewScan = scanCanStartNewSession(scanSessions);
  const scanActionLabel = startingScan || saving
    ? "Klargør scan..."
    : !generatedDepthModel
      ? "Tegn plæne først"
      : canStartNewScan
        ? (editingGarden?.id ? "Scan haven i 3D" : "Gem & scan haven")
        : "Fortsæt 3D-scan";
  const scanPanelButtonLabel = !generatedDepthModel ? "Tegn først" : !editingGarden?.id ? "Gem & scan" : undefined;

  function requireLoginForHavemaaler(message: string) {
    toast(message);
    navigate(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  }

  // ----- History (undo/redo) -----
  type Snap2 = { main: Ring; mainClosed: boolean; additionalLawns: Ring[]; currentLawn: Ring; exclusions: Ring[] };
  const lastSerialized = useRef<string>("");
  function applySnap(s: Snap2) {
    skipHistoryRef.current = true;
    setMain(s.main); setMainClosed(s.mainClosed); setAdditionalLawns(s.additionalLawns ?? []); setCurrentLawn(s.currentLawn ?? []); setExclusions(s.exclusions);
    requestAnimationFrame(() => { skipHistoryRef.current = false; });
  }
  function undo() {
    const h = historyRef.current;
    if (!h.past.length) return;
    h.future.push({ main: [...main], mainClosed, additionalLawns: additionalLawns.map(r => [...r]), currentLawn: [...currentLawn], exclusions: exclusions.map(r => [...r]) });
    applySnap(h.past.pop()!);
  }
  function redo() {
    const h = historyRef.current;
    if (!h.future.length) return;
    h.past.push({ main: [...main], mainClosed, additionalLawns: additionalLawns.map(r => [...r]), currentLawn: [...currentLawn], exclusions: exclusions.map(r => [...r]) });
    applySnap(h.future.pop()!);
  }
  useEffect(() => {
    const ser = JSON.stringify({ main, mainClosed, additionalLawns, currentLawn, exclusions });
    if (ser === lastSerialized.current) return;
    if (!skipHistoryRef.current && lastSerialized.current) {
      try {
        historyRef.current.past.push(JSON.parse(lastSerialized.current));
        if (historyRef.current.past.length > 50) historyRef.current.past.shift();
        historyRef.current.future = [];
      } catch {}
    }
    lastSerialized.current = ser;
  }, [main, mainClosed, additionalLawns, currentLawn, exclusions]);

  function clear() {
    setMain([]); setMainClosed(false); setAdditionalLawns([]); setCurrentLawn([]); setExclusions([]); setCurrentExclusion([]);
    setWandConfidence(null); setWandBbox(null); clearWandPreview();
    setSavedDepthModel(null); setScanLaunch(null); setScanSessions([]); setMapView("map");
  }

  function refreshDepthPreview() {
    if (!generatedDepthModel) {
      toast("Tegn eller hent en græsflade først");
      return;
    }
    setSavedDepthModel(generatedDepthModel);
    setMapView("twin");
    toast.success("Flad 3D-preview vist", {
      description: "Dette er kun plænefladen fra 2D-kortet. Højder og forhindringer kræver mobilscan.",
    });
  }

  async function loadScanSessions(gardenId = editingGarden?.id) {
    if (!gardenId || !user) {
      setScanSessions([]);
      return;
    }
    const { data, error } = await supabase
      .from("garden_scan_sessions")
      .select("*")
      .eq("garden_id", gardenId)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(8);
    if (!error) setScanSessions((data ?? []) as GardenScanSession[]);
  }

  async function saveGardenForScan(): Promise<SavedGarden | null> {
    if (!user) {
      requireLoginForHavemaaler("Log ind for at starte mobilscan");
      return null;
    }
    if (!chosen || area === 0 || !generatedDepthModel) {
      toast("Tegn eller hent en græsflade først");
      return null;
    }
    setSaving(true);
    try {
      const gardenPolygon = completedLawns.length === 1
        ? polygonForRing(completedLawns[0])
        : { type: "MultiPolygon", coordinates: completedLawns.map((ring) => [[...ring, ring[0]]]) };
      const depthModelForSave = {
        ...generatedDepthModel,
        gardenId: editingGarden?.id ?? generatedDepthModel.gardenId ?? null,
        name: chosen.name.split(",")[0],
        generatedAt: new Date().toISOString(),
      };
      const depthModelUpdatedAt = new Date().toISOString();
      const gardenPayloadBase = {
        name: chosen.name.split(",")[0],
        address: chosen.name,
        latitude: chosen.center[1],
        longitude: chosen.center[0],
        area_m2: Math.round(area),
        polygon: gardenPolygon,
        exclusions: exclusions.map(r => ({ type: "Polygon", coordinates: [[...r, r[0]]] })),
        imagery_source: imagery,
        thumbnail_url: editingGarden?.thumbnail_url ?? null,
      };
      const gardenPayloadWithDepth = {
        ...gardenPayloadBase,
        depth_model: depthModelToJson(depthModelForSave),
        depth_model_updated_at: depthModelUpdatedAt,
      };

      let garden: unknown = null;
      let saveError: unknown = null;
      let depthPreviewSavedWithGarden = true;
      const saveWithDepthResult = editingGarden
        ? await supabase
          .from("gardens")
          .update(gardenPayloadWithDepth)
          .eq("id", editingGarden.id)
          .eq("user_id", user.id)
          .select()
          .single()
        : await supabase
          .from("gardens")
          .insert({ user_id: user.id, ...gardenPayloadWithDepth })
          .select()
          .single();

      garden = saveWithDepthResult.data;
      saveError = saveWithDepthResult.error;

      if ((saveError || !garden) && isDepthModelSchemaError(saveError)) {
        depthPreviewSavedWithGarden = false;
        console.warn("saveGardenForScan retrying without depth preview fields", saveError);
        const saveCoreResult = editingGarden
          ? await supabase
            .from("gardens")
            .update(gardenPayloadBase)
            .eq("id", editingGarden.id)
            .eq("user_id", user.id)
            .select()
            .single()
          : await supabase
            .from("gardens")
            .insert({ user_id: user.id, ...gardenPayloadBase })
            .select()
            .single();
        garden = saveCoreResult.data;
        saveError = saveCoreResult.error;
      }

      if (saveError || !garden) {
        console.error("saveGardenForScan failed", saveError);
        toast.error("Kunne ikke gemme haven før mobilscan", {
          description: describeSupabaseError(saveError) ?? "Prøv igen om lidt.",
        });
        return null;
      }

      const savedGarden = garden as SavedGarden;
      const depthModelWithGardenId = { ...depthModelForSave, gardenId: savedGarden.id };
      const softWarnings: string[] = [];

      if (depthPreviewSavedWithGarden) {
        const { error: depthError } = await supabase.from("gardens").update({
          depth_model: depthModelToJson(depthModelWithGardenId),
          depth_model_updated_at: new Date().toISOString(),
        }).eq("id", savedGarden.id).eq("user_id", user.id);
        if (depthError) {
          console.warn("saveGardenForScan depth model update failed", depthError);
          softWarnings.push("3D-preview gemmes efter selve scanningen.");
        }
      } else {
        softWarnings.push("3D-preview gemmes efter selve scanningen.");
      }

      const zoneError = await syncLawnZones(savedGarden.id, Boolean(editingGarden));
      if (zoneError) {
        console.warn("saveGardenForScan lawn zone sync failed", zoneError);
        softWarnings.push("Plænezonen gemmes igen efter scan.");
      }

      setEditingGarden(savedGarden);
      setSavedDepthModel(depthModelWithGardenId);
      setActive(savedGarden.id);
      try { localStorage.removeItem(AUTOSAVE_KEY); } catch {}
      if (softWarnings.length) {
        toast.success("Have gemt. Starter mobilscan...", {
          description: softWarnings.join(" "),
        });
      } else {
        toast.success("Have gemt. Starter mobilscan...");
      }
      return savedGarden;
    } catch (error) {
      console.error("saveGardenForScan crashed", error);
      toast.error("Kunne ikke gemme haven før mobilscan", {
        description: describeSupabaseError(error) ?? "Prøv igen om lidt.",
      });
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function startGardenScan() {
    if (!generatedDepthModel) {
      toast("Haven mangler en lukket græsflade");
      return;
    }
    if (!user) {
      requireLoginForHavemaaler("Log ind for at starte mobilscan");
      return;
    }
    setStartingScan(true);
    const gardenForScan = await saveGardenForScan();
    if (!gardenForScan?.id) {
      setStartingScan(false);
      return;
    }
    let currentScanSessions = scanSessions.filter((session) => session.garden_id === gardenForScan.id);
    const { data: freshScanSessions, error: scanSessionError } = await supabase
      .from("garden_scan_sessions")
      .select("*")
      .eq("garden_id", gardenForScan.id)
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(8);
    if (scanSessionError) {
      console.warn("startGardenScan could not refresh scan sessions", scanSessionError);
    } else {
      currentScanSessions = (freshScanSessions ?? []) as GardenScanSession[];
      setScanSessions(currentScanSessions);
    }
    const activeSession = currentScanSessions.find((session) => !isTerminalScanStatus(session.status));
    if (activeSession) {
      const scanUrl = webGardenScanUrl(gardenForScan.id, activeSession.id);
      setScanLaunch({
        sessionId: activeSession.id,
        scanUrl,
        uploadPrefix: activeSession.upload_prefix,
      });
      toast("Fortsæt eksisterende 3D-scan", {
        description: "Der er allerede en aktiv pipeline-session. Brug den, så worker og upload ikke får dubletter.",
        action: { label: "Åbn", onClick: () => { navigate(scanUrl); } },
        duration: 7000,
      });
      navigate(scanUrl);
      setStartingScan(false);
      return;
    }
    try {
      const { data, error } = await supabase.functions.invoke("create-garden-scan-session", {
        body: {
          garden_id: gardenForScan.id,
          source: "havemaaler",
          capture_client_version: "mobile-web-v1",
          capture_metadata: {
            depth_model_version: generatedDepthModel.version,
            alignment_mode: "scan-anchored",
            capture_surface: "mobile_web",
            map_anchor_targets: generatedDepthModel.captureReadiness.anchorSuggestions,
            map_frame: {
              center: generatedDepthModel.center,
              boundary: generatedDepthModel.terrain.boundary,
              local_boundary: generatedDepthModel.terrain.localBoundary,
              lawn_rings: generatedDepthModel.terrain.lawnRings,
              local_lawn_rings: generatedDepthModel.terrain.localLawnRings,
              area_m2: generatedDepthModel.terrain.areaM2,
            },
          },
        },
      });
      if (error) throw error;
      const sessionId = String(data?.session?.id ?? "");
      if (!sessionId) throw new Error("Scan-session manglede id");
      const scanUrl = String(data?.scan_url || data?.mobile_web_url || webGardenScanUrl(gardenForScan.id, sessionId));
      setScanLaunch({
        sessionId,
        scanUrl,
        uploadPrefix: typeof data?.upload_prefix === "string" ? data.upload_prefix : null,
        uploadTargets: Array.isArray(data?.upload_targets) ? data.upload_targets as ScanUploadTarget[] : undefined,
      });
      setScanSessions((prev) => data?.session ? [data.session as GardenScanSession, ...prev.filter((row) => row.id !== sessionId)] : prev);
      toast.success("Mobilscan er klar", {
        description: "Kamera-flowet åbner nu. Vælg et kortanker og tryk det samme punkt i kameraet.",
        action: { label: "Åbn", onClick: () => { navigate(scanUrl); } },
        duration: 7000,
      });
      navigate(scanUrl);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Kunne ikke starte 3D-scan");
    } finally {
      setStartingScan(false);
    }
  }

  useEffect(() => {
    if (!editingGarden?.id || !user) return;
    void loadScanSessions(editingGarden.id);
    const t = window.setInterval(() => { void loadScanSessions(editingGarden.id); }, 15000);
    return () => window.clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingGarden?.id, user?.id]);

  function clearWandPreview() {
    setWandPreview(null);
    setWandCrop(null);
    setWandSeeds([]);
    setWandReviewMode("none");
    setWandStage("idle");
    setWandBbox(null);
  }

  // ----- Snap helper -----
  function snapPoint(ll: LngLat): LngLat {
    const map = mapRef.current; if (!map) return ll;
    const s = stateRef.current;
    if (!s.snapEnabled) return ll;
    const candidates: LngLat[] = [];
    s.main.forEach(p => candidates.push(p));
    s.additionalLawns.forEach(r => r.forEach(p => candidates.push(p)));
    s.currentLawn.forEach(p => candidates.push(p));
    s.exclusions.forEach(r => r.forEach(p => candidates.push(p)));
    if (s.matrikel) s.matrikel.forEach(p => candidates.push(p));
    let best: { p: LngLat; d: number } | null = null;
    for (const c of candidates) {
      const d = pixelDistance(map, ll, c);
      if (d < 12 && (!best || d < best.d)) best = { p: c, d };
    }
    if (best) { setSnapIndicator(best.p); return best.p; }
    setSnapIndicator(null);
    return ll;
  }

  function deleteVertex(ring: EditableRingId, idx: number) {
    updateEditableRing(ring, (prev) => prev.length > 3 ? prev.filter((_, i) => i !== idx) : prev);
  }

  // ----- Matrikel lookup -----
  async function loadMatrikel(center = chosen?.center, opts: { silent?: boolean } = {}) {
    if (!center) return;
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-matrikel?lng=${center[0]}&lat=${center[1]}`;
    try {
      const r = await fetch(url, { headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY } });
      const j = await r.json();
      const feat = j?.features?.[0];
      const coords = feat?.geometry?.coordinates;
      if (!coords) { if (!opts.silent) toast("Ingen matrikel fundet"); return; }
      const outer: LngLat[] = (coords[0][0] && Array.isArray(coords[0][0][0])) ? coords[0][0] : coords[0];
      setMatrikel(outer.map((p: any) => [p[0], p[1]]));
      if (!opts.silent) toast.success("Matrikel hentet");
    } catch { if (!opts.silent) toast.error("Matrikel-opslag fejlede"); }
  }

  function useMatrikelAsBase() {
    if (!matrikel) return;
    setMain(matrikel); setMainClosed(true); setAdditionalLawns([]); setCurrentLawn([]); setExclusions([]); setCurrentExclusion([]);
    setMode("edit");
  }

  // ----- Magic wand (deterministic lawn segmentation) -----
  function showWandFailure(data: any, response?: Response) {
    const code = String(data?.error || "");
    const msg = String(data?.detail || data?.error || response?.statusText || "");
    logHavemaalerSegmentationEvent("havemaaler_wand_failure", null, null, [], {
      errorCode: code || String(response?.status ?? "unknown"),
      errorDetail: msg,
    });
    if (code === "outside_parcel") toast.error("Klik inden for den markerede matrikel");
    else if (code === "imagery_fetch_failed") toast.error("Kunne ikke hente billede — prøv igen om lidt, eller tegn manuelt");
    else if (code === "invalid_request") toast.error("Klikket kunne ikke bruges — prøv igen på selve plænen");
    else if (response?.status === 504 || msg.toLowerCase().includes("abort")) toast.error("Billedhentning tog for lang tid — prøv igen om lidt");
    else toast.error("Kunne ikke analysere billedet — prøv igen eller tegn manuelt");
  }

  function canAcceptWandResult(result: LawnSegmentationResult | null) {
    if (!result?.polygon?.length) return false;
    if (result.confidence < 0.4) return false;
    return !result.diagnostics.warnings.some(isBlockingLawnSegmentationWarning);
  }

  function shouldRejectRefinedWandResult(previous: LawnSegmentationResult | null, next: LawnSegmentationResult) {
    if (!previous?.polygon?.length || !next.polygon.length) return false;
    const previousBlocking = previous.diagnostics.warnings.some(isBlockingLawnSegmentationWarning);
    const nextBlocking = next.diagnostics.warnings.some(isBlockingLawnSegmentationWarning);
    if (!previousBlocking && nextBlocking) return true;
    if (next.confidence < Math.max(0.4, previous.confidence - 0.22)) return true;
    if (scoreLawnSegmentationResult(next) < scoreLawnSegmentationResult(previous) - 0.35) return true;
    const areaGrowth = next.diagnostics.areaM2 / Math.max(1, previous.diagnostics.areaM2);
    return areaGrowth > 1.45 && next.diagnostics.warnings.some((warning) => warning === "self_intersection" || warning === "touches_crop_edge");
  }

  async function setWandSegmentationResult(crop: LawnCropPayload, seeds: SegmentationSeed[], result: LawnSegmentationResult, cached = false) {
    if (!result.polygon.length) {
      setWandPreview(null);
      setWandConfidence(0);
      setWandStage("idle");
      toast.error("Klik på et tydeligt stykke græs, så finder vi kanten derfra");
      return;
    }
    setWandPreview(result);
    setWandCrop(crop);
    setWandSeeds(seeds);
    setWandConfidence(result.confidence);
    setWandBbox(crop.bbox);
    setWandStage("Klar til tjek");
    logHavemaalerSegmentationEvent("havemaaler_wand_result", crop, result, seeds, {
      cached,
      candidateCount: result.diagnostics.candidateCount,
    });
    const conf = Math.round(result.confidence * 100);
    const providerNote = crop.imagerySource === "mapbox" ? "Ortofoto fejlede, så Mapbox blev brugt." : undefined;
    if (result.needsReview) {
      toast("Forslag klar til tjek", {
        description: providerNote ?? `AI er ${conf}% sikker. Klik på græs der mangler, eller område der skal væk.`,
      });
    } else {
      toast.success(cached ? "Hentet fra godkendt cache" : `Forslag klar (${conf}% sikker)`, {
        description: providerNote,
      });
    }
  }

  async function computeWandSegmentation(crop: LawnCropPayload, seeds: SegmentationSeed[], opts: { highPrecision?: boolean; strictness?: "normal" | "strict" | "ultra" } = {}) {
    const highPrecision = opts.highPrecision ?? true;
    setWandLoading(true);
    setWandStage(opts.strictness === "ultra" ? "Tegner kant" : highPrecision ? "Tegner kant" : "Finder græs");
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const segmentationOptions: SegmentationOptions = {
      highPrecision,
      createMaskPreview: true,
    };
    if (opts.strictness || !highPrecision) {
      segmentationOptions.strictness = opts.strictness ?? "normal";
    }
    const result = await segmentLawnFromCrop(crop, seeds, segmentationOptions);
    if (result.diagnostics.recoveredBy === "ultra-strict") {
      logHavemaalerSegmentationEvent("havemaaler_wand_retry", crop, result, seeds, {
        action: "auto_ultra_strict_selected",
        candidateCount: result.diagnostics.candidateCount,
      });
    }
    return result;
  }

  async function recomputeWandSegmentation(crop: LawnCropPayload, seeds: SegmentationSeed[], opts: { highPrecision?: boolean; cached?: boolean; strictness?: "normal" | "strict" | "ultra" } = {}) {
    const result = await computeWandSegmentation(crop, seeds, opts);
    setWandStage("Tegner kant");
    await new Promise((resolve) => requestAnimationFrame(resolve));
    await setWandSegmentationResult(crop, seeds, result, !!opts.cached);
    setWandLoading(false);
    return result;
  }

  async function runMagicWand(click: LngLat) {
    const s = stateRef.current;
    if (s.wandLoading) return;
    setWandLoading(true);
    setWandStage("Henter billede");
    setWandReviewMode("none");
    setWandPreview(null);
    setWandConfidence(null);
    let completed = false;
    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), WAND_TIMEOUT_MS);
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/lawn-crop`, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
        body: JSON.stringify({
          click,
          cropMeters: WAND_CROP_METERS,
          imageSize: WAND_IMAGE_SIZE,
          parcelPolygon: s.matrikel ?? undefined,
        }),
      }).finally(() => window.clearTimeout(timeout));
      const data = await response.json().catch(() => null);
      if (!response.ok || !data?.imageBase64 || !data?.bbox || !data?.clickPx) {
        showWandFailure(data, response);
        return;
      }

      const crop = data as LawnCropPayload;
      setWandCrop(crop);
      setWandBbox(crop.bbox);
      const seeds: SegmentationSeed[] = [];
      const cacheKey = buildSegmentationCacheKey(crop, seeds);
      const cached = readAcceptedSegmentationCache(cacheKey);
      if (cached) {
        await setWandSegmentationResult(crop, seeds, cached, true);
      } else {
        await recomputeWandSegmentation(crop, seeds);
      }
      completed = true;
    } catch (e: any) {
      toast.error(e?.name === "AbortError" ? "Billedhentning tog for lang tid — prøv igen om lidt" : "Kunne ikke analysere plænen");
    } finally {
      setWandLoading(false);
      if (!completed) setWandStage("idle");
    }
  }

  async function refineWandFromClick(click: LngLat, reviewMode: WandReviewMode) {
    const s = stateRef.current;
    if (!s.wandCrop || s.wandLoading || reviewMode === "none") return;
    const nextSeeds: SegmentationSeed[] = [
      ...s.wandSeeds,
      { kind: reviewMode === "add" ? "positive" : "negative", lngLat: click },
    ];
    const previousResult = s.wandPreview;
    const previousSeeds = s.wandSeeds;
    logHavemaalerSegmentationEvent("havemaaler_wand_refine", s.wandCrop, previousResult, nextSeeds, { action: reviewMode });
    try {
      const result = await computeWandSegmentation(s.wandCrop, nextSeeds);
      if (shouldRejectRefinedWandResult(previousResult, result)) {
        logHavemaalerSegmentationEvent("havemaaler_wand_refine", s.wandCrop, result, nextSeeds, { action: `${reviewMode}_rejected` });
        setWandSeeds(previousSeeds);
        setWandStage("Klar til tjek");
        setWandLoading(false);
        toast("Det klik gjorde kanten mere usikker", {
          description: "Prøv et klik tættere på den manglende kant, eller brug manuel redigering.",
        });
        return;
      }
      setWandStage("Tegner kant");
      await new Promise((resolve) => requestAnimationFrame(resolve));
      await setWandSegmentationResult(s.wandCrop, nextSeeds, result);
      setWandLoading(false);
    } catch {
      toast.error("Kunne ikke opdatere forslaget — prøv et andet klik");
      setWandLoading(false);
    }
  }

  async function tryHighPrecisionWand() {
    const s = stateRef.current;
    if (!s.wandCrop || s.wandLoading) return;
    try {
      logHavemaalerSegmentationEvent("havemaaler_wand_retry", s.wandCrop, s.wandPreview, s.wandSeeds, { action: "manual_ultra_strict" });
      await recomputeWandSegmentation(s.wandCrop, s.wandSeeds, { highPrecision: true, strictness: "ultra" });
    } catch {
      toast.error("Strammere kant kunne ikke beregnes");
      setWandLoading(false);
    }
  }

  function acceptWandPreview() {
    const s = stateRef.current;
    const result = s.wandPreview;
    if (!result?.polygon?.length) return;
    if (!canAcceptWandResult(result)) {
      toast.error("Forslaget er for usikkert til at gemme — klik på græs der mangler, fjern fejlområder, eller tegn manuelt");
      return;
    }
    const ring = result.polygon;
    const cleanExclusions = result.exclusions.filter((r) => r.length >= 3);
    if (s.wandOp === "add" && s.main.length >= 3 && s.mainClosed) {
      addCompletedLawn(ring);
      if (cleanExclusions.length) setExclusions((prev) => [...prev, ...cleanExclusions]);
    } else if (s.wandOp === "subtract" && s.main.length >= 3 && s.mainClosed) {
      setExclusions((prev) => [...prev, ring]);
    } else {
      setCompletedLawnRings([ring]);
      setExclusions(cleanExclusions);
    }
    if (s.wandCrop) {
      writeAcceptedSegmentationCache(buildSegmentationCacheKey(s.wandCrop, s.wandSeeds), result);
    }
    logHavemaalerSegmentationEvent("havemaaler_wand_accept", s.wandCrop, result, s.wandSeeds, { accepted: true, action: s.wandOp });
    setWandConfidence(result.confidence);
    clearWandPreview();
    setMode(s.wandOp === "replace" ? "edit" : "wand");
    toast.success(s.wandOp === "add" ? "Græszonen er tilføjet" : s.wandOp === "subtract" ? "Området er udeladt" : "Plænen er sat ind og klar til redigering");
  }

  function manualEditFromWand() {
    const result = stateRef.current.wandPreview;
    if (canAcceptWandResult(result)) acceptWandPreview();
    else {
      clearWandPreview();
      setMode(mainClosed ? "edit" : "draw");
      toast("AI-forslaget var for usikkert — tegn plænen manuelt");
    }
  }

  // ----- Keyboard -----
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (step !== 2) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const meta = e.ctrlKey || e.metaKey;
      if (meta && (e.key === "z" || e.key === "Z") && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (meta && ((e.key === "z" || e.key === "Z") && e.shiftKey || e.key === "y" || e.key === "Y")) { e.preventDefault(); redo(); return; }
      if (e.key === "z" || e.key === "Z") { e.preventDefault(); undo(); return; }
      if (e.key === "Delete" || e.key === "Backspace") {
        if (mode === "exclude" && currentExclusion.length) { setCurrentExclusion(p => p.slice(0, -1)); e.preventDefault(); }
        else if (mode === "draw" && mainClosed && currentLawn.length) { setCurrentLawn(p => p.slice(0, -1)); e.preventDefault(); }
        else if (mode === "draw" && main.length && !mainClosed) { setMain(p => p.slice(0, -1)); e.preventDefault(); }
        return;
      }
      if (e.key === "Escape") {
        if (mode === "wand" && wandPreview) clearWandPreview();
        else if (mode === "exclude" && currentExclusion.length) setCurrentExclusion([]);
        else if (mode === "draw" && currentLawn.length) setCurrentLawn([]);
        else if (!mainClosed) setMain([]);
      } else if (e.key === "Enter") {
        if (mode === "draw" && main.length >= 3 && !mainClosed) setMainClosed(true);
        else if (mode === "draw" && mainClosed && currentLawn.length >= 3) addCompletedLawn(currentLawn);
        else if (mode === "exclude" && currentExclusion.length >= 3) {
          setExclusions(prev => [...prev, currentExclusion]); setCurrentExclusion([]);
        }
      } else if (e.key === "1") setMode("draw");
      else if (e.key === "2") setMode("edit");
      else if (e.key === "3") setMode("exclude");
      else if (e.key === "4") setMode("wand");
      else if (e.key === "s" || e.key === "S") setSnapEnabled(v => !v);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, mode, main, mainClosed, currentLawn, currentExclusion, exclusions, wandPreview]);

  // ----- Autosave to localStorage -----
  useEffect(() => {
    if (step !== 2 || !chosen || editingGarden) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({
          chosen, main, mainClosed, additionalLawns, currentLawn, exclusions, imagery, savedAt: Date.now(),
        }));
      } catch {}
    }, 800);
    return () => clearTimeout(t);
  }, [step, chosen, main, mainClosed, additionalLawns, currentLawn, exclusions, imagery, editingGarden]);

  // Restore draft on mount
  useEffect(() => {
    try {
      if (gardenIdParam) return;
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (!d?.chosen || Date.now() - (d.savedAt ?? 0) > 1000 * 60 * 60 * 24 * 3) return;
      setChosen(d.chosen);
      setMain(d.main ?? []); setMainClosed(!!d.mainClosed);
      setAdditionalLawns(d.additionalLawns ?? []);
      setCurrentLawn(d.currentLawn ?? []);
      setExclusions(d.exclusions ?? []);
      if (d.imagery) setImagery(d.imagery);
      setStep(2);
      toast("Gendannet kladde", { description: "Din tidligere måling er hentet frem" });
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!gardenIdParam) {
      setEditingGarden(null);
      return;
    }
    if (!user) return;

    let cancelled = false;
    async function loadSavedGarden() {
      setLoadingSavedGarden(true);
      const gardenFieldsWithDepth = "id, name, address, latitude, longitude, polygon, exclusions, imagery_source, thumbnail_url, depth_model, depth_model_updated_at";
      const gardenFieldsBase = "id, name, address, latitude, longitude, polygon, exclusions, imagery_source, thumbnail_url";
      const gardenQuery = supabase
        .from("gardens")
        .select(gardenFieldsWithDepth)
        .eq("id", gardenIdParam)
        .eq("user_id", user.id)
        .maybeSingle()
        .then(async (result) => {
          if (result.error && isDepthModelSchemaError(result.error)) {
            console.warn("loadSavedGarden retrying without depth preview fields", result.error);
            return supabase
              .from("gardens")
              .select(gardenFieldsBase)
              .eq("id", gardenIdParam)
              .eq("user_id", user.id)
              .maybeSingle();
          }
          return result;
        });

      const [{ data: gardenData, error: gardenError }, { data: zoneRows, error: zoneError }] = await Promise.all([
        gardenQuery,
        supabase
          .from("garden_zones")
          .select("id, polygon")
          .eq("garden_id", gardenIdParam)
          .eq("user_id", user.id)
          .eq("type", "lawn")
          .order("created_at", { ascending: true }),
      ]);

      if (cancelled) return;
      setLoadingSavedGarden(false);
      if (gardenError || zoneError || !gardenData) {
        toast.error("Kunne ikke hente den gemte måling");
        return;
      }

      const savedGarden = gardenData as SavedGarden;
      const ringsFromGarden = ringsFromGeoJson(savedGarden.polygon);
      const ringsFromZones = ((zoneRows ?? []) as SavedLawnZone[]).flatMap((zone) => ringsFromGeoJson(zone.polygon));
      const savedRings = ringsFromGarden.length ? ringsFromGarden : ringsFromZones;
      if (!savedRings.length) {
        toast.error("Den gemte have har ingen plænegeometri at redigere");
        return;
      }

      const center = savedGarden.longitude != null && savedGarden.latitude != null
        ? [savedGarden.longitude, savedGarden.latitude] as LngLat
        : centerFromRings(savedRings);
      if (!center) {
        toast.error("Kunne ikke placere den gemte måling på kortet");
        return;
      }

      const label = savedGarden.address || savedGarden.name || "Min have";
      setEditingGarden(savedGarden);
      setActive(savedGarden.id);
      setChosen({ name: label, center });
      setQuery(label);
      setCompletedLawnRings(savedRings);
      setExclusions(exclusionRingsFromJson(savedGarden.exclusions));
      setCurrentExclusion([]);
      setMatrikel(null);
      setSavedDepthModel(coerceGardenDepthModel(savedGarden.depth_model));
      setScanLaunch(null);
      clearWandPreview();
      setImagery(savedGarden.imagery_source === "mapbox" ? "mapbox" : "ortofoto");
      setMode("edit");
      setMapView("map");
      setStep(2);
      historyRef.current = { past: [], future: [] };
      toast.success("Måling hentet til redigering");
      setTimeout(() => { loadMatrikel(center, { silent: true }).catch(() => {}); }, 50);
    }

    void loadSavedGarden();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gardenIdParam, user?.id, setActive]);

  // ----- Save -----
  function polygonForRing(ring: Ring) {
    return { type: "Polygon", coordinates: [[...ring, ring[0]]] };
  }

  async function syncLawnZones(gardenId: string, updateExisting: boolean) {
    const zoneRows = completedLawns.map((ring, i) => ({
      user_id: user!.id,
      garden_id: gardenId,
      name: completedLawns.length === 1 ? "Græsplæne" : `Græsplæne ${i + 1}`,
      type: "lawn" as const,
      polygon: polygonForRing(ring),
      area_m2: Math.round(lawnAreas[i] ?? turf.area(turf.polygon([[...ring, ring[0]]]))),
    }));

    if (!updateExisting) {
      const { error } = await supabase.from("garden_zones").insert(zoneRows);
      return error;
    }

    const { data: existingRows, error: existingError } = await supabase
      .from("garden_zones")
      .select("id")
      .eq("garden_id", gardenId)
      .eq("user_id", user!.id)
      .eq("type", "lawn")
      .order("created_at", { ascending: true });
    if (existingError) return existingError;

    const existing = (existingRows ?? []) as { id: string }[];
    for (let i = 0; i < zoneRows.length; i += 1) {
      const row = zoneRows[i];
      const existingZone = existing[i];
      if (existingZone) {
        const { error } = await supabase.from("garden_zones").update({
          name: row.name,
          polygon: row.polygon,
          area_m2: row.area_m2,
          type: row.type,
        }).eq("id", existingZone.id);
        if (error) return error;
      } else {
        const { error } = await supabase.from("garden_zones").insert(row);
        if (error) return error;
      }
    }

    const staleZoneIds = existing.slice(zoneRows.length).map((zone) => zone.id);
    if (staleZoneIds.length) {
      const { error } = await supabase.from("garden_zones").delete().in("id", staleZoneIds);
      if (error) return error;
    }
    return null;
  }

  async function saveGarden() {
    if (!chosen || area === 0) return;
    if (!user) { requireLoginForHavemaaler("Log ind for at gemme din have"); return; }
    setSaving(true);

    // Thumbnail upload
    let thumbnail_url: string | null = editingGarden?.thumbnail_url ?? null;
    try {
      const map = mapRef.current!;
      const dataUrl = map.getCanvas().toDataURL("image/jpeg", 0.78);
      const blob = await (await fetch(dataUrl)).blob();
      const path = `${user.id}/${Date.now()}.jpg`;
      const { error: upErr } = await supabase.storage.from("garden-thumbnails").upload(path, blob, { contentType: "image/jpeg", upsert: true });
      if (!upErr) {
        const { data: pub } = supabase.storage.from("garden-thumbnails").getPublicUrl(path);
        thumbnail_url = pub.publicUrl;
      }
    } catch {}

    const gardenPolygon = completedLawns.length === 1
      ? polygonForRing(completedLawns[0])
      : { type: "MultiPolygon", coordinates: completedLawns.map((ring) => [[...ring, ring[0]]]) };
    const depthModelForSave = generatedDepthModel
      ? {
        ...generatedDepthModel,
        gardenId: editingGarden?.id ?? generatedDepthModel.gardenId ?? null,
        name: chosen.name.split(",")[0],
        generatedAt: new Date().toISOString(),
      }
      : null;

    const depthModelUpdatedAt = new Date().toISOString();
    const gardenPayloadBase = {
      name: chosen.name.split(",")[0],
      address: chosen.name,
      latitude: chosen.center[1],
      longitude: chosen.center[0],
      area_m2: Math.round(area),
      polygon: gardenPolygon,
      exclusions: exclusions.map(r => ({ type: "Polygon", coordinates: [[...r, r[0]]] })),
      imagery_source: imagery,
      thumbnail_url,
    };
    const gardenPayloadWithDepth = {
      ...gardenPayloadBase,
      depth_model: depthModelForSave ? depthModelToJson(depthModelForSave) : null,
      depth_model_updated_at: depthModelForSave ? depthModelUpdatedAt : null,
    };

    let savedGardenRecord: unknown = null;
    let saveError: unknown = null;
    let depthColumnsAvailable = true;
    const saveWithDepthResult = editingGarden
      ? await supabase
        .from("gardens")
        .update(gardenPayloadWithDepth)
        .eq("id", editingGarden.id)
        .eq("user_id", user.id)
        .select()
        .single()
      : await supabase.from("gardens").insert({
        user_id: user.id,
        ...gardenPayloadWithDepth,
      }).select().single();

    savedGardenRecord = saveWithDepthResult.data;
    saveError = saveWithDepthResult.error;

    if ((saveError || !savedGardenRecord) && isDepthModelSchemaError(saveError)) {
      depthColumnsAvailable = false;
      console.warn("saveGarden retrying without depth preview fields", saveError);
      const saveCoreResult = editingGarden
        ? await supabase
          .from("gardens")
          .update(gardenPayloadBase)
          .eq("id", editingGarden.id)
          .eq("user_id", user.id)
          .select()
          .single()
        : await supabase.from("gardens").insert({
          user_id: user.id,
          ...gardenPayloadBase,
        }).select().single();
      savedGardenRecord = saveCoreResult.data;
      saveError = saveCoreResult.error;
    }

    if (saveError || !savedGardenRecord) {
      console.error("saveGarden failed", saveError);
      toast.error("Kunne ikke gemme have", {
        description: describeSupabaseError(saveError) ?? "Prøv igen om lidt.",
      });
      setSaving(false);
      return;
    }

    const g = savedGardenRecord as SavedGarden;
    const softWarnings: string[] = [];
    if (!editingGarden && depthModelForSave && depthColumnsAvailable) {
      const depthModelWithGardenId = { ...depthModelForSave, gardenId: g.id };
      const { error: depthError } = await supabase.from("gardens").update({
        depth_model: depthModelToJson(depthModelWithGardenId),
        depth_model_updated_at: new Date().toISOString(),
      }).eq("id", g.id).eq("user_id", user.id);
      if (depthError) {
        console.warn("saveGarden depth model update failed", depthError);
        softWarnings.push("3D-preview gemmes efter selve scanningen.");
      }
      setSavedDepthModel(depthModelWithGardenId);
    } else {
      if (depthModelForSave && !depthColumnsAvailable) {
        softWarnings.push("3D-preview gemmes efter selve scanningen.");
      }
      setSavedDepthModel(depthModelForSave);
    }
    const zoneError = await syncLawnZones(g.id, Boolean(editingGarden));
    if (zoneError) { toast.error("Have gemt, men zonerne kunne ikke gemmes"); setSaving(false); return; }
    setActive(g.id);
    try { localStorage.removeItem(AUTOSAVE_KEY); } catch {}
    toast.success(editingGarden ? "Måling opdateret" : "Have gemt", {
      action: { label: "Åbn Havekompagnon", onClick: () => navigate("/havekompagnon") },
      description: softWarnings.length ? softWarnings.join(" ") : undefined,
      duration: 6000,
    });
    navigate(returnTo ?? (editingGarden ? "/havekompagnon" : "/konto"));
  }

  // ----- Render -----
  return (
    <>
      <style>{`@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.7)}}`}</style>
      <AppNav active="sizer" />
      <div className={`container havemaaler-page ${step === 2 ? "is-measuring" : "is-addressing"}`}>
        <header className="page-head">
          <div className="eyebrow" style={{ marginBottom: 14 }}>Værktøj · Havemåler</div>
          <h1>{gardenIdParam ? "Rediger din gemte græsflade." : "Tegn dine græsflader. Få den rette robotklipper."}</h1>
          <p className="lede">
            {gardenIdParam
              ? "Finjuster hjørner, tilføj græszoner eller udelad terrasser og bede. Når du gemmer, opdateres den eksisterende have."
              : "Indtast din adresse, og vi henter et 12,5 cm satellit-billede af din matrikel. Tegn flere græszoner — eller klik hver separat plæne med AI."}
          </p>
        </header>

        {loadingSavedGarden && (
          <section>
            <div className="addr-step" style={{ minHeight: 220, alignItems: "center" }}>
              <div>
                <div className="addr-eyebrow"><span className="num">1</span> Henter måling</div>
                <h2>Åbner din gemte have.</h2>
                <p className="addr-lede">Vi læser plænegeometri, udeladelser og kortbillede, så du kan redigere direkte i Havemåleren.</p>
              </div>
            </div>
          </section>
        )}

        {!loadingSavedGarden && step === 1 && (
          <section>
            <div className="addr-step">
              <div>
                <div className="addr-eyebrow"><span className="num">1</span> Find din matrikel</div>
                <h2>Hvor ligger <em>din have?</em></h2>
                <p className="addr-lede">Indtast vejnavn og husnummer i Danmark. Vi henter et 12,5 cm ortofoto fra Dataforsyningen.</p>

                <div className="addr-form" style={{ position: "relative" }}>
                  <svg className="pin" width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <path d="M9 16s6-5.5 6-9.5A6 6 0 003 6.5C3 10.5 9 16 9 16z" stroke="currentColor" strokeWidth="1.4" />
                    <circle cx="9" cy="6.5" r="2" stroke="currentColor" strokeWidth="1.4" />
                  </svg>
                  <input
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
                    onFocus={() => setOpen(true)}
                    onBlur={() => setTimeout(() => setOpen(false), 180)}
                    placeholder="F.eks. Søndergade 14, 8000 Aarhus C"
                    autoComplete="off"
                  />
                  <button onClick={chooseFirstAddress}>
                    Hent kort
                    <svg width="12" height="10" viewBox="0 0 14 10" fill="none"><path d="M1 5h12m0 0L9 1m4 4L9 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
                  </button>
                  {open && suggestions.length > 0 && (
                    <div className="addr-suggest open">
                      {suggestions.map((s) => (
                        <button key={s.id} onMouseDown={(e) => { e.preventDefault(); chooseAddress(s); }}>
                          <span className="ico">
                            <svg width="13" height="13" viewBox="0 0 18 18" fill="none">
                              <path d="M9 16s6-5.5 6-9.5A6 6 0 003 6.5C3 10.5 9 16 9 16z" stroke="currentColor" strokeWidth="1.4" />
                              <circle cx="9" cy="6.5" r="2" stroke="currentColor" strokeWidth="1.4" />
                            </svg>
                          </span>
                          {s.text}
                          <span className="city">{s.place_name.replace(s.text + ", ", "")}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="addr-meta">
                  <span>Dataforsyningen · 12,5 cm</span>
                  <span>AI-græszoner</span>
                  <span>Matrikel-overlay</span>
                </div>
              </div>

              <div className="addr-preview">
                <svg viewBox="0 0 400 400" preserveAspectRatio="xMidYMid slice">
                  <defs>
                    <pattern id="grid-bg" width="20" height="20" patternUnits="userSpaceOnUse">
                      <path d="M20 0H0V20" stroke="rgba(237,232,223,0.06)" strokeWidth="1" />
                    </pattern>
                  </defs>
                  <rect width="400" height="400" fill="url(#grid-bg)" />
                  <rect x="80" y="80" width="240" height="240" fill="none" stroke="rgba(216,166,81,0.5)" strokeWidth="1.5" strokeDasharray="4 4" />
                  <path d="M110 180 L290 175 L295 290 L120 295 Z" fill="rgba(127,160,126,0.3)" stroke="rgba(216,166,81,0.6)" strokeWidth="1.5" />
                  <text x="200" y="208" textAnchor="middle" fontFamily="JetBrains Mono" fontSize="9" fill="rgba(237,232,223,0.6)" letterSpacing="2">VENTER PÅ ADRESSE</text>
                </svg>
                <div className="scan"></div>
                <div className="crosshair">
                  <span className="corner tl"></span><span className="corner tr"></span>
                  <span className="corner bl"></span><span className="corner br"></span>
                </div>
                <div className="stamp">DK · MATRIKEL · 1:200</div>
              </div>
            </div>
          </section>
        )}

        {!loadingSavedGarden && step === 2 && chosen && (
          <section>
            <div className="topview-header">
              <div className="addr-display">
                <div className="pin-badge">
                  <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
                    <path d="M9 16s6-5.5 6-9.5A6 6 0 003 6.5C3 10.5 9 16 9 16z" stroke="currentColor" strokeWidth="1.4" />
                    <circle cx="9" cy="6.5" r="2" stroke="currentColor" strokeWidth="1.4" />
                  </svg>
                </div>
                <div className="txt">
                  <strong>{chosen.name.split(",")[0]}</strong>
                  <span>{chosen.name.split(",").slice(1).join(",").toUpperCase()}</span>
                </div>
              </div>
              <div className="topview-actions" style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div className="imagery-toggle" style={{ display: "flex", gap: 0, border: "1px solid var(--ink-200)", borderRadius: 8, overflow: "hidden", fontSize: 12 }}>
                  <button onClick={() => setMapView("map")} style={{ padding: "6px 10px", background: mapView === "map" ? "var(--gold)" : "transparent", color: mapView === "map" ? "#14271d" : "inherit", border: 0 }}>2D kort</button>
                  <button onClick={() => { if (!activeDepthModel) refreshDepthPreview(); else setMapView("twin"); }} disabled={!generatedDepthModel} style={{ padding: "6px 10px", background: mapView === "twin" ? "var(--gold)" : "transparent", color: mapView === "twin" ? "#14271d" : "inherit", border: 0, opacity: generatedDepthModel ? 1 : 0.45 }}>3D preview</button>
                </div>
                <div className="imagery-toggle" style={{ display: "flex", gap: 0, border: "1px solid var(--ink-200)", borderRadius: 8, overflow: "hidden", fontSize: 12 }}>
                  <button onClick={() => ortoCfg && setImagery("ortofoto")} disabled={!ortoCfg} style={{ padding: "6px 10px", background: imagery === "ortofoto" ? "var(--gold)" : "transparent", color: imagery === "ortofoto" ? "#14271d" : "inherit", border: 0, opacity: ortoCfg ? 1 : 0.45 }}>Ortofoto 12cm</button>
                  <button onClick={() => setImagery("mapbox")} style={{ padding: "6px 10px", background: imagery === "mapbox" ? "var(--gold)" : "transparent", color: imagery === "mapbox" ? "#14271d" : "inherit", border: 0 }}>Mapbox</button>
                </div>
                <button className="change-addr" aria-label="Skift adresse" title="Skift adresse" onClick={() => { setStep(1); clear(); }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6h8M2 6l3-3M2 6l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
                  Skift adresse
                </button>
              </div>
            </div>

            <div className="sizer-layout">
              <div>
                <div className="canvas-host topview" style={{ position: "relative" }}>
                  <div ref={containerRef} style={{ width: "100%", height: "100%", position: "absolute", inset: 0, borderRadius: "inherit", opacity: mapView === "map" ? 1 : 0, pointerEvents: mapView === "map" ? "auto" : "none" }} />
                  {mapView === "twin" && (
                    <GardenTwinViewer model={activeDepthModel} className="garden-twin-map-overlay" />
                  )}
                  <div className="help" style={{ zIndex: 2 }}>
                    <span className="dot"></span>
                    <span>
                      {mapView === "twin" ? "Flad 3D-preview fra 2D-kortet. Start mobilscan for rigtige kamera-keyframes, ankre og senere højde/forhindringer."
                        : mode === "wand" ? (wandLoading ? wandStage : wandPreview ? (
                          wandReviewMode === "add" ? "Klik på græs der mangler"
                            : wandReviewMode === "remove" ? "Klik på område der skal væk"
                            : "Tjek kanten. Godkend, forfin eller skift til manuel redigering."
                        ) : wandOp === "add" ? "Klik midt på en separat græsflade for at tilføje den som ny zone" : wandOp === "subtract" ? "Klik på fliser, terrasse eller bygning for at udelukke området" : "Klik midt på græsset — vi finder plænekanten")
                        : mode === "edit" ? "Træk hjørner. Klik et lille punkt for at indsætte. Højreklik = slet hjørne."
                        : mode === "exclude" ? "Tegn et område der trækkes fra (terrasse, bed). Dobbeltklik for at lukke."
                        : mainClosed ? (currentLawn.length ? "Tegn den næste græszone. Luk ved første punkt, dobbeltklik eller Enter." : "Klik for at tegne en ekstra græszone, eller brug AI-zone til adskilte plæner.")
                        : "Klik for hjørner. Luk ved at klikke første punkt eller Enter. (Cmd/Ctrl+Z = fortryd, S = snap, Del = slet sidste)"}
                    </span>
                  </div>

                  {/* Loading overlay */}
	                  {wandLoading && (
	                    <div style={{ position: "absolute", inset: 0, zIndex: 3, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(20,39,29,0.35)", backdropFilter: "blur(2px)", borderRadius: "inherit", pointerEvents: "none" }}>
	                      <div style={{ background: "rgba(20,39,29,0.85)", border: "1px solid var(--gold)", color: "var(--gold)", padding: "14px 22px", borderRadius: 12, fontSize: 13, letterSpacing: 0.4, fontFamily: "JetBrains Mono, monospace", display: "flex", alignItems: "center", gap: 10 }}>
	                        <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "var(--gold)", animation: "pulse 1.2s ease-in-out infinite" }} />
	                        {wandStage.toUpperCase()}
	                      </div>
	                    </div>
	                  )}

                    {mode === "wand" && wandPreview && (
                      <div className="wand-review-bar" style={{ position: "absolute", left: 16, right: 16, bottom: 76, zIndex: 2, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
                        <div className="wand-review-panel" style={{ pointerEvents: "auto", display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", justifyContent: "center", maxWidth: "calc(100% - 24px)", background: "rgba(12,26,19,0.78)", border: "1px solid rgba(237,207,149,0.42)", color: "var(--mist-25)", borderRadius: 12, padding: "8px 10px", backdropFilter: "blur(12px)", boxShadow: "var(--sh-2)" }}>
                          <span style={{ fontSize: 11, color: "var(--gold)", fontFamily: "JetBrains Mono, monospace", marginRight: 4 }}>
                            {Math.round(wandPreview.confidence * 100)}% {wandPreview.needsReview ? "TJEK" : "KLAR"}
                          </span>
                          <button className="tool-btn is-active" onClick={acceptWandPreview} disabled={wandLoading || !canAcceptWandResult(wandPreview)}>Accept</button>
                          <button className={`tool-btn ${wandReviewMode === "add" ? "is-active" : ""}`} onClick={() => setWandReviewMode(v => v === "add" ? "none" : "add")} disabled={wandLoading}>Add grass</button>
                          <button className={`tool-btn ${wandReviewMode === "remove" ? "is-active" : ""}`} onClick={() => setWandReviewMode(v => v === "remove" ? "none" : "remove")} disabled={wandLoading}>Remove area</button>
                          <button className="tool-btn" onClick={tryHighPrecisionWand} disabled={wandLoading}>Try tighter</button>
                          <button className="tool-btn" onClick={manualEditFromWand} disabled={wandLoading}>Manual edit</button>
                        </div>
                      </div>
                    )}

                  <div className="area-pill" style={{ zIndex: 2 }}>
                    <div>
                      <div className="lbl">{lawnZoneCount} græszone{lawnZoneCount === 1 ? "" : "r"}{exclusions.length ? ` · ${exclusions.length} udeladt` : ""}</div>
                      <div>{area.toFixed(0)} m²</div>
                    </div>
	                    {wandConfidence != null && (
	                      <div style={{ marginTop: 4, fontSize: 10, color: "var(--gold)", letterSpacing: 0.5 }}>
	                        AI {Math.round(wandConfidence * 100)}% sikker{wandPreview?.needsReview ? " · tjek kant" : ""}
	                      </div>
	                    )}
                  </div>

                  {mapView === "map" && (
                  <div className="tools measurement-tools" style={{ zIndex: 2, flexWrap: "wrap" }}>
                    {mainClosed && (
                      <button className="tool-btn scan-primary mobile-scan-tool" onClick={startGardenScan} disabled={startingScan || saving} title="Start mobilscan">
                        {startingScan || saving ? "Klargør..." : editingGarden?.id ? "Scan 3D" : "Gem & scan"}
                      </button>
                    )}
	                    <button className={`tool-btn ${mode === "draw" ? "is-active" : ""}`} onClick={() => { clearWandPreview(); setMode("draw"); }} title="Tegn græszone (1)">{mainClosed ? "+ Græszone" : "Tegn"}</button>
	                    <button className={`tool-btn ${mode === "edit" ? "is-active" : ""}`} onClick={() => { clearWandPreview(); setMode("edit"); }} disabled={!main.length} title="Rediger (2)">Rediger</button>
	                    <button className={`tool-btn ${mode === "exclude" ? "is-active" : ""}`} onClick={() => { clearWandPreview(); setMode("exclude"); }} disabled={!mainClosed} title="Udeluk (3)">− Udeluk</button>
	                    <button className={`tool-btn ${mode === "wand" ? "is-active" : ""}`} onClick={() => { setMode("wand"); setWandOp(mainClosed ? "add" : "replace"); clearWandPreview(); }} disabled={wandLoading} title="AI-magic-wand (4)">{wandLoading ? "AI…" : mainClosed ? "✨ AI-zone" : "✨ AI"}</button>
	                    {mode === "wand" && mainClosed && (
	                      <>
	                        <button className={`tool-btn ${wandOp === "replace" ? "is-active" : ""}`} onClick={() => { setWandOp("replace"); clearWandPreview(); }} disabled={wandLoading} title="AI erstat alle zoner">Erstat</button>
	                        <button className={`tool-btn ${wandOp === "add" ? "is-active" : ""}`} onClick={() => { setWandOp("add"); clearWandPreview(); }} disabled={wandLoading} title="AI tilføj græszone">+ Zone</button>
	                        <button className={`tool-btn ${wandOp === "subtract" ? "is-active" : ""}`} onClick={() => { setWandOp("subtract"); clearWandPreview(); }} disabled={wandLoading} title="AI udeluk område">− Udeluk</button>
	                      </>
	                    )}
                    <button className="tool-btn" onClick={undo} title="Fortryd (Cmd+Z)">↶</button>
                    <button className="tool-btn" onClick={redo} title="Gentag (Cmd+Shift+Z)">↷</button>
                    <button className={`tool-btn ${snapEnabled ? "is-active" : ""}`} onClick={() => setSnapEnabled(v => !v)} title="Snap (S)">Snap</button>
                    <button className="tool-btn" onClick={clear} title="Ryd alt">Ryd</button>
                  </div>
                  )}
                </div>

                <div className="map-secondary-actions" style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
                  <button className="tool-btn scan-primary" onClick={startGardenScan} disabled={startingScan || saving}>
                    {scanActionLabel}
                  </button>
                  <button className="tool-btn" onClick={() => loadMatrikel()}>Hent matrikel</button>
                  {matrikel && <button className="tool-btn" onClick={useMatrikelAsBase}>Brug matrikel som plæne</button>}
                  <button className="tool-btn" onClick={refreshDepthPreview} disabled={!generatedDepthModel}>Vis flad 3D</button>
                  {scanLaunch && (
                    <a className="tool-btn" href={scanLaunch.scanUrl}>Åbn mobilscan</a>
                  )}
                  <button className="tool-btn" onClick={() => {
                    if (!navigator.geolocation) { toast("Geolocation ikke tilgængelig"); return; }
                    navigator.geolocation.getCurrentPosition(
                      (pos) => {
                        const c: LngLat = [pos.coords.longitude, pos.coords.latitude];
                        setChosen({ name: "Min position", center: c });
                        clear(); setMatrikel(null);
                        if (mapRef.current) mapRef.current.flyTo({ center: c, zoom: 19 });
                        toast.success("Centreret på din position");
                      },
                      () => toast.error("Kunne ikke hente position"),
                      { enableHighAccuracy: true, timeout: 8000 },
                    );
                  }}>📍 Find mig</button>
                </div>

                <div className="sizer-stats" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 16, marginTop: 24 }}>
                  <div className="acct-stat"><div className="v">{lawnZoneCount}</div><div className="l">Græszoner</div></div>
                  <div className="acct-stat"><div className="v">{totalLawnCorners}</div><div className="l">Hjørner</div></div>
                  <div className="acct-stat"><div className="v">{perim.toFixed(0)} m</div><div className="l">Omkreds</div></div>
                  <div className="acct-stat"><div className="v">{depthObjectCount}</div><div className="l">3D objekter</div></div>
                  <div className="acct-stat"><div className="v">{area > 0 ? Math.ceil(area / 8) + " min" : "— min"}</div><div className="l">Estimeret klippetid</div></div>
                </div>
              </div>

              <aside className="recommendation">
                <div className="eyebrow" style={{ marginBottom: 14 }}>Anbefaling</div>
                <div className="rec-mower">
                  <div className="tier">{tier.tier}</div>
                  <h3>{tier.name}</h3>
                  <div className="sub">Op til {tier.max} m²</div>
                  <div className="price">{tier.price}</div>
                </div>

                <div className="rec-meta">
                  <div className="cell"><div className="v">{area.toFixed(0)} m²</div><div className="l">Dine plæner</div></div>
                  <div className="cell"><div className="v">{tier.max} m²</div><div className="l">Klippekapacitet</div></div>
                  <div className="cell"><div className="v">{tier.battery}</div><div className="l">Batteritid</div></div>
                  <div className="cell"><div className="v">{tier.noise}</div><div className="l">Lydniveau</div></div>
                </div>

                <GardenScanPanel
                  depthModel={activeDepthModel}
                  sessions={scanSessions}
                  scanLaunch={scanLaunch}
                  starting={startingScan || saving}
                  canPreview={Boolean(generatedDepthModel)}
                  canStartScan
                  scanButtonLabel={scanPanelButtonLabel}
                  onBuildPreview={refreshDepthPreview}
                  onStartScan={startGardenScan}
                  onShowTwin={() => { if (!activeDepthModel) refreshDepthPreview(); else setMapView("twin"); }}
                />

                <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} onClick={saveGarden} disabled={saving || area === 0}>
                  {saving ? (editingGarden ? "Opdaterer…" : "Gemmer…") : editingGarden ? "Opdater måling" : "Gem have og fortsæt"}
                </button>
                <Link to="/webshop?cat=robot" className="btn btn-ghost" style={{ width: "100%", justifyContent: "center", marginTop: 10 }}>Se alle robotklippere</Link>

                <div style={{ fontSize: 11, color: "var(--ink-500)", marginTop: 18, lineHeight: 1.5 }}>
                  Inkl. installationsguide og 5 års garanti. Gratis fragt over 999 kr.
                </div>
              </aside>
            </div>
          </section>
        )}
      </div>
      <SiteFooter />
      {pinpointing && mapboxToken && (
        <PinpointSequence
          address={pinpointing.name}
          center={pinpointing.center}
          mapboxToken={mapboxToken}
          ortoWmsTemplate={ortoCfg?.wmsTemplate ?? null}
          onDone={() => {
            setChosen({ name: pinpointing.name, center: pinpointing.center });
            setStep(2);
            setPinpointing(null);
            // Auto-load the cadastral parcel so AI is constrained to the user's property.
            setTimeout(() => { loadMatrikel(pinpointing.center, { silent: true }).catch(() => {}); }, 50);
          }}
        />
      )}
    </>
  );
}
