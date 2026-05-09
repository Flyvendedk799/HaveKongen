import { useEffect, useRef, useState, useMemo, useCallback } from "react";
import mapboxgl from "mapbox-gl";
import * as turf from "@turf/turf";
import "mapbox-gl/dist/mapbox-gl.css";
import { AppNav, SiteFooter } from "@/components/layout/SiteChrome";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { toast } from "sonner";
import { Link, useNavigate } from "react-router-dom";

import { unionRings, subtractRings, pixelDistance } from "@/lib/polygonOps";
import PinpointSequence from "@/components/havemaaler/PinpointSequence";

type Suggestion = { id: string; place_name: string; center: [number, number]; text: string };
type LngLat = [number, number];
type Ring = LngLat[];
type Mode = "draw" | "exclude" | "edit" | "wand";
type WandOp = "replace" | "add" | "subtract";
type Imagery = "ortofoto" | "mapbox";

const AUTOSAVE_KEY = "havemaaler:draft:v2";

const TIERS = [
  { name: "Klipper R1 Mini",   tier: "Indgangsmodel", max: 600,  price: "6.299 kr",  battery: "90 min",  noise: "52 dB" },
  { name: "Klipper R2 Plus",   tier: "Familie",       max: 1200, price: "9.499 kr",  battery: "140 min", noise: "55 dB" },
  { name: "Klipper R3 Pro",    tier: "Stor have",     max: 2500, price: "12.499 kr", battery: "180 min", noise: "58 dB" },
  { name: "Klipper R4 Estate", tier: "Erhverv",       max: 5000, price: "18.999 kr", battery: "240 min", noise: "60 dB" },
];

export default function GardenSizer() {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [mapboxToken, setMapboxToken] = useState<string | null>(null);
  const [ortoCfg, setOrtoCfg] = useState<{ wmsTemplate: string } | null>(null);

  const [step, setStep] = useState<1 | 2>(1);
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<{ name: string; center: LngLat } | null>(null);

  const [imagery, setImagery] = useState<Imagery>("ortofoto");
  const [mode, setMode] = useState<Mode>("draw");

  // Polygon state
  const [main, setMain] = useState<Ring>([]);
  const [mainClosed, setMainClosed] = useState(false);
  const [exclusions, setExclusions] = useState<Ring[]>([]);
  const [currentExclusion, setCurrentExclusion] = useState<Ring>([]);
  const [hover, setHover] = useState<LngLat | null>(null);
  const [draggingVertex, setDraggingVertex] = useState<{ ring: "main" | number; idx: number } | null>(null);

  const [matrikel, setMatrikel] = useState<Ring | null>(null);
  const [wandLoading, setWandLoading] = useState(false);
  const [wandOp, setWandOp] = useState<WandOp>("replace");
  const [wandConfidence, setWandConfidence] = useState<number | null>(null);
  const [wandBbox, setWandBbox] = useState<[number, number, number, number] | null>(null);
  const [wandHoverPos, setWandHoverPos] = useState<LngLat | null>(null);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [snapIndicator, setSnapIndicator] = useState<LngLat | null>(null);
  const [saving, setSaving] = useState(false);
  const [pinpointing, setPinpointing] = useState<{ name: string; center: LngLat } | null>(null);

  // History (undo/redo)
  type Snap = { main: Ring; mainClosed: boolean; exclusions: Ring[] };
  const historyRef = useRef<{ past: Snap[]; future: Snap[] }>({ past: [], future: [] });
  const skipHistoryRef = useRef(false);

  const mapRef = useRef<mapboxgl.Map | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

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
    });
  }, []);

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
    if (!mapboxToken || query.trim().length < 2) { setSuggestions([]); return; }
    const t = setTimeout(async () => {
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json?country=dk&language=da&limit=6&access_token=${mapboxToken}`;
      try {
        const r = await fetch(url); const j = await r.json();
        setSuggestions((j.features ?? []).map((f: any) => ({
          id: f.id, place_name: f.place_name, center: f.center as LngLat, text: f.text,
        })));
      } catch { /* ignore */ }
    }, 220);
    return () => clearTimeout(t);
  }, [query, mapboxToken]);

  function chooseAddress(s: Suggestion) {
    setQuery(s.place_name); setOpen(false);
    setMain([]); setMainClosed(false); setExclusions([]); setCurrentExclusion([]);
    setMatrikel(null);
    // Trigger cinematic pinpoint; finalises into step 2 in onDone
    setPinpointing({ name: s.place_name, center: s.center });
  }

  // ----- Build style for current imagery choice -----
  const buildStyle = useCallback((): mapboxgl.Style => {
    if (imagery === "ortofoto" && ortoCfg) {
      return {
        version: 8,
        sources: {
          orto: {
            type: "raster",
            tiles: [ortoCfg.wmsTemplate],
            tileSize: 512,
            attribution: "© SDFE / Dataforsyningen",
          },
        },
        layers: [{ id: "orto", type: "raster", source: "orto" }],
      } as any;
    }
    return "mapbox://styles/mapbox/satellite-streets-v12" as any;
  }, [imagery, ortoCfg]);

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
    syncMap();
  }

  // ----- Map event handlers (read latest state via refs) -----
  const stateRef = useRef({ mode, main, mainClosed, exclusions, currentExclusion, draggingVertex });
  useEffect(() => { stateRef.current = { mode, main, mainClosed, exclusions, currentExclusion, draggingVertex }; });

  function onMapClick(e: mapboxgl.MapMouseEvent) {
    const map = mapRef.current!;
    let ll: LngLat = [e.lngLat.lng, e.lngLat.lat];
    const s = stateRef.current;

    if (s.mode === "wand") { runMagicWand(ll); return; }

    // Snap when drawing or editing
    if (s.mode === "draw" || s.mode === "exclude") ll = snapPoint(ll);

    if (s.mode === "edit") {
      // insert vertex on midpoint click
      const feats = map.queryRenderedFeatures(e.point, { layers: ["vertices-circle"] });
      const mid = feats.find(f => (f.properties as any)?.midpoint);
      if (mid) {
        const idx = (mid.properties as any).insertAt as number;
        const ring = (mid.properties as any).ring as string;
        if (ring === "main") {
          setMain(p => { const n = [...p]; n.splice(idx, 0, ll); return n; });
        } else {
          const ri = parseInt(ring, 10);
          setExclusions(prev => prev.map((r, i) => i === ri ? (() => { const n = [...r]; n.splice(idx, 0, ll); return n; })() : r));
        }
      }
      return;
    }

    if (s.mode === "draw") {
      if (s.mainClosed) return;
      if (s.main.length >= 3) {
        const start = map.project(s.main[0] as any);
        const cur = map.project(ll as any);
        if (Math.hypot(start.x - cur.x, start.y - cur.y) < 14) { setMainClosed(true); return; }
      }
      setMain(p => [...p, ll]);
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
    const ring = (real.properties as any).ring as string;
    const idx = (real.properties as any).idx as number;
    deleteVertex(ring === "main" ? "main" : parseInt(ring, 10), idx);
    if ((navigator as any).vibrate) (navigator as any).vibrate(20);
  }

  function onMapMouseDown(e: mapboxgl.MapMouseEvent) {
    const s = stateRef.current; if (s.mode !== "edit") return;
    const map = mapRef.current!;
    const feats = map.queryRenderedFeatures(e.point, { layers: ["vertices-circle"] });
    const real = feats.find(f => !(f.properties as any)?.midpoint);
    if (!real) return;
    const ring = (real.properties as any).ring as string;
    const idx = (real.properties as any).idx as number;
    setDraggingVertex({ ring: ring === "main" ? "main" : parseInt(ring, 10), idx });
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
      if (s.draggingVertex.ring === "main") {
        setMain(p => p.map((v, i) => i === s.draggingVertex!.idx ? dragLL : v));
      } else {
        const ri = s.draggingVertex.ring as number;
        setExclusions(prev => prev.map((r, i) => i === ri ? r.map((v, j) => j === s.draggingVertex!.idx ? dragLL : v) : r));
      }
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

    // Main polygon (or live preview line)
    const liveRing = mainClosed ? [...main, main[0]]
      : (hover && main.length > 0 && mode === "draw") ? [...main, hover] : main;
    const polyData: any = { type: "FeatureCollection", features: [] };
    if (main.length >= 2) {
      polyData.features.push({
        type: "Feature", properties: {},
        geometry: mainClosed
          ? { type: "Polygon", coordinates: [liveRing] }
          : { type: "LineString", coordinates: liveRing },
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
    exclusions.forEach((r, i) => pushRing(r, String(i)));
    (map.getSource("vertices") as mapboxgl.GeoJSONSource)?.setData(vData);

    // Edge labels (only when actively drawing or editing main, and >=2 pts)
    const labelData: any = { type: "FeatureCollection", features: [] };
    if (main.length >= 2 && (mode === "draw" || mode === "edit")) {
      const ring = mainClosed ? [...main, main[0]] : main;
      for (let i = 0; i < ring.length - 1; i++) {
        const a = ring[i], b = ring[i + 1];
        const len = turf.distance(a, b, { units: "kilometers" }) * 1000;
        labelData.features.push({
          type: "Feature",
          properties: { label: `${len.toFixed(1)} m` },
          geometry: { type: "Point", coordinates: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] },
        });
      }
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
      const m = 25 / 111320; const lng = 25 / (111320 * Math.cos(wandHoverPos[1] * Math.PI / 180));
      return [wandHoverPos[0] - lng, wandHoverPos[1] - m, wandHoverPos[0] + lng, wandHoverPos[1] + m] as [number, number, number, number];
    })() : (mode === "wand" ? wandBbox : null);
    if (previewBbox) {
      const [w, s, e, n] = previewBbox;
      wandData.features.push({
        type: "Feature", properties: {},
        geometry: { type: "Polygon", coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] },
      });
    }
    (map.getSource("wand-area") as mapboxgl.GeoJSONSource)?.setData(wandData);
  }

  useEffect(() => { syncMap(); }, [main, mainClosed, exclusions, currentExclusion, hover, mode, matrikel, snapIndicator, wandHoverPos, wandBbox]);

  // ----- Area / perimeter (with exclusions subtracted) -----
  const { area, perim } = useMemo(() => {
    if (!mainClosed || main.length < 3) return { area: 0, perim: 0 };
    let poly: any = turf.polygon([[...main, main[0]]]);
    exclusions.forEach(r => {
      if (r.length < 3) return;
      try {
        const ex = turf.polygon([[...r, r[0]]]);
        const diff = turf.difference(turf.featureCollection([poly, ex]) as any);
        if (diff) poly = diff;
      } catch {}
    });
    const a = turf.area(poly);
    const ringLen = turf.length(turf.lineString([...main, main[0]]), { units: "kilometers" }) * 1000;
    return { area: a, perim: ringLen };
  }, [main, mainClosed, exclusions]);

  const tier = TIERS.find((t) => area <= t.max) ?? TIERS[TIERS.length - 1];

  // ----- History (undo/redo) -----
  type Snap2 = { main: Ring; mainClosed: boolean; exclusions: Ring[] };
  const lastSerialized = useRef<string>("");
  function applySnap(s: Snap2) {
    skipHistoryRef.current = true;
    setMain(s.main); setMainClosed(s.mainClosed); setExclusions(s.exclusions);
    requestAnimationFrame(() => { skipHistoryRef.current = false; });
  }
  function undo() {
    const h = historyRef.current;
    if (!h.past.length) return;
    h.future.push({ main: [...main], mainClosed, exclusions: exclusions.map(r => [...r]) });
    applySnap(h.past.pop()!);
  }
  function redo() {
    const h = historyRef.current;
    if (!h.future.length) return;
    h.past.push({ main: [...main], mainClosed, exclusions: exclusions.map(r => [...r]) });
    applySnap(h.future.pop()!);
  }
  useEffect(() => {
    const ser = JSON.stringify({ main, mainClosed, exclusions });
    if (ser === lastSerialized.current) return;
    if (!skipHistoryRef.current && lastSerialized.current) {
      try {
        historyRef.current.past.push(JSON.parse(lastSerialized.current));
        if (historyRef.current.past.length > 50) historyRef.current.past.shift();
        historyRef.current.future = [];
      } catch {}
    }
    lastSerialized.current = ser;
  }, [main, mainClosed, exclusions]);

  function clear() {
    setMain([]); setMainClosed(false); setExclusions([]); setCurrentExclusion([]);
    setWandConfidence(null); setWandBbox(null);
  }

  // ----- Snap helper -----
  function snapPoint(ll: LngLat): LngLat {
    if (!snapEnabled) return ll;
    const map = mapRef.current; if (!map) return ll;
    const candidates: LngLat[] = [];
    main.forEach(p => candidates.push(p));
    exclusions.forEach(r => r.forEach(p => candidates.push(p)));
    if (matrikel) matrikel.forEach(p => candidates.push(p));
    let best: { p: LngLat; d: number } | null = null;
    for (const c of candidates) {
      const d = pixelDistance(map, ll, c);
      if (d < 12 && (!best || d < best.d)) best = { p: c, d };
    }
    if (best) { setSnapIndicator(best.p); return best.p; }
    setSnapIndicator(null);
    return ll;
  }

  function deleteVertex(ring: "main" | number, idx: number) {
    if (ring === "main") {
      setMain(p => p.length > 3 ? p.filter((_, i) => i !== idx) : p);
    } else {
      setExclusions(prev => prev.map((r, i) => i === ring ? (r.length > 3 ? r.filter((_, j) => j !== idx) : r) : r));
    }
  }

  // ----- Matrikel lookup -----
  async function loadMatrikel() {
    if (!chosen) return;
    const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/get-matrikel?lng=${chosen.center[0]}&lat=${chosen.center[1]}`;
    try {
      const r = await fetch(url, { headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY } });
      const j = await r.json();
      const feat = j?.features?.[0];
      const coords = feat?.geometry?.coordinates;
      if (!coords) { toast("Ingen matrikel fundet"); return; }
      const outer: LngLat[] = (coords[0][0] && Array.isArray(coords[0][0][0])) ? coords[0][0] : coords[0];
      setMatrikel(outer.map((p: any) => [p[0], p[1]]));
      toast.success("Matrikel hentet");
    } catch { toast.error("Matrikel-opslag fejlede"); }
  }

  function useMatrikelAsBase() {
    if (!matrikel) return;
    setMain(matrikel); setMainClosed(true); setExclusions([]); setCurrentExclusion([]);
    setMode("edit");
  }

  // ----- Magic wand (AI) -----
  async function runMagicWand(click: LngLat) {
    setWandLoading(true);
    try {
      // If we have a matrikel (cadastral parcel) loaded, send its bbox so the AI
      // focuses only on the user's actual property — never neighbours' lawns.
      let parcelBbox: [number, number, number, number] | undefined;
      if (matrikel && matrikel.length >= 3) {
        let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
        for (const [lng, lat] of matrikel) {
          if (lng < minLng) minLng = lng; if (lng > maxLng) maxLng = lng;
          if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
        }
        parcelBbox = [minLng, minLat, maxLng, maxLat];
      }
      const { data, error } = await supabase.functions.invoke("segment-lawn", {
        body: { click, cropMeters: 50, width: 1024, height: 1024, parcelBbox },
      });
      if (error || !data?.polygon) {
        const msg = (error as any)?.message || (data as any)?.error || "";
        if ((data as any)?.fallback) toast.error("AI-tjenesten er midlertidigt utilgængelig — prøv igen om lidt eller tegn manuelt");
        else toast.error(msg.includes("402") ? "AI-kreditter brugt op" : msg.includes("429") ? "Travl gateway — prøv igen om lidt" : "AI-opmåling fejlede");
        return;
      }
      const ring = data.polygon as LngLat[];
      let simplified: LngLat[] = ring;
      try {
        const simp = turf.simplify(turf.polygon([[...ring, ring[0]]]), { tolerance: 0.00001, highQuality: true });
        simplified = simp.geometry.coordinates[0].slice(0, -1) as LngLat[];
      } catch {}

      if (wandOp === "add" && main.length >= 3 && mainClosed) {
        const merged = unionRings(main, simplified);
        if (merged) setMain(merged); else toast("Områderne overlapper ikke");
      } else if (wandOp === "subtract" && main.length >= 3 && mainClosed) {
        const sub = subtractRings(main, simplified);
        if (sub) setMain(sub); else toast("Kunne ikke trække fra");
      } else {
        setMain(simplified); setMainClosed(true); setMode("edit");
        // Also import any AI-detected exclusions (flowerbeds, decks, ponds inside lawn)
        const aiExc = Array.isArray((data as any).exclusions) ? (data as any).exclusions as LngLat[][] : [];
        if (aiExc.length) {
          setExclusions(aiExc.filter((r) => Array.isArray(r) && r.length >= 3));
        }
      }
      setWandConfidence(data.confidence ?? null);
      setWandBbox(data.bbox ?? null);
      const conf = Math.round((data.confidence ?? 0.7) * 100);
      const exCount = Array.isArray((data as any).exclusions) ? (data as any).exclusions.length : 0;
      toast.success(
        data.cached ? "Hentet fra cache" :
        `AI-forslag klar (${conf}% sikker)${exCount ? ` · ${exCount} udeladt` : ""}`,
      );
    } catch {
      toast.error("AI-opmåling fejlede");
    } finally { setWandLoading(false); }
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
        else if (mode === "draw" && main.length && !mainClosed) { setMain(p => p.slice(0, -1)); e.preventDefault(); }
        return;
      }
      if (e.key === "Escape") {
        if (mode === "exclude" && currentExclusion.length) setCurrentExclusion([]);
        else if (!mainClosed) setMain([]);
      } else if (e.key === "Enter") {
        if (mode === "draw" && main.length >= 3 && !mainClosed) setMainClosed(true);
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
  }, [step, mode, main, mainClosed, currentExclusion, exclusions]);

  // ----- Autosave to localStorage -----
  useEffect(() => {
    if (step !== 2 || !chosen) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify({
          chosen, main, mainClosed, exclusions, imagery, savedAt: Date.now(),
        }));
      } catch {}
    }, 800);
    return () => clearTimeout(t);
  }, [step, chosen, main, mainClosed, exclusions, imagery]);

  // Restore draft on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return;
      const d = JSON.parse(raw);
      if (!d?.chosen || Date.now() - (d.savedAt ?? 0) > 1000 * 60 * 60 * 24 * 3) return;
      setChosen(d.chosen);
      setMain(d.main ?? []); setMainClosed(!!d.mainClosed);
      setExclusions(d.exclusions ?? []);
      if (d.imagery) setImagery(d.imagery);
      setStep(2);
      toast("Gendannet kladde", { description: "Din tidligere måling er hentet frem" });
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ----- Save -----
  async function saveGarden() {
    if (!user) { toast("Log ind for at gemme din have"); navigate("/login?redirect=/havemaaler"); return; }
    if (!chosen || area === 0) return;
    setSaving(true);

    // Thumbnail upload
    let thumbnail_url: string | null = null;
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

    const polyGeo = { type: "Polygon", coordinates: [[...main, main[0]]] };
    const { data: g, error } = await supabase.from("gardens").insert({
      user_id: user.id,
      name: chosen.name.split(",")[0],
      address: chosen.name,
      latitude: chosen.center[1],
      longitude: chosen.center[0],
      area_m2: Math.round(area),
      polygon: polyGeo,
      exclusions: exclusions.map(r => ({ type: "Polygon", coordinates: [[...r, r[0]]] })),
      imagery_source: imagery,
      thumbnail_url,
    }).select().single();
    if (error || !g) { toast.error("Kunne ikke gemme have"); setSaving(false); return; }
    await supabase.from("garden_zones").insert({
      user_id: user.id, garden_id: g.id, name: "Græsplæne", type: "lawn",
      polygon: polyGeo, area_m2: Math.round(area),
    });
    const { useActiveGarden } = await import("@/lib/activeGarden");
    useActiveGarden.getState().setActive(g.id);
    try { localStorage.removeItem(AUTOSAVE_KEY); } catch {}
    toast.success("Have gemt", {
      action: { label: "Lav vandingsplan", onClick: () => navigate("/vanding") },
      duration: 6000,
    });
    navigate("/konto");
  }

  // ----- Render -----
  return (
    <>
      <style>{`@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.7)}}`}</style>
      <AppNav active="sizer" />
      <div className="container">
        <header className="page-head">
          <div className="eyebrow" style={{ marginBottom: 14 }}>Værktøj · Havemåler</div>
          <h1>Tegn din græsplæne. Få den rette robotklipper.</h1>
          <p className="lede">Indtast din adresse, og vi henter et 12,5 cm satellit-billede af din matrikel. Tegn — eller lad AI'en foreslå plænen.</p>
        </header>

        {step === 1 && (
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
                  <button onClick={() => suggestions[0] && chooseAddress(suggestions[0])}>
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
                  <span>AI-magic-wand</span>
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

        {step === 2 && chosen && (
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
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div style={{ display: "flex", gap: 0, border: "1px solid var(--ink-200)", borderRadius: 8, overflow: "hidden", fontSize: 12 }}>
                  <button onClick={() => setImagery("ortofoto")} style={{ padding: "6px 10px", background: imagery === "ortofoto" ? "var(--gold)" : "transparent", color: imagery === "ortofoto" ? "#14271d" : "inherit", border: 0 }}>Ortofoto 12cm</button>
                  <button onClick={() => setImagery("mapbox")} style={{ padding: "6px 10px", background: imagery === "mapbox" ? "var(--gold)" : "transparent", color: imagery === "mapbox" ? "#14271d" : "inherit", border: 0 }}>Mapbox</button>
                </div>
                <button className="change-addr" onClick={() => { setStep(1); clear(); }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 6h8M2 6l3-3M2 6l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
                  Skift adresse
                </button>
              </div>
            </div>

            <div className="sizer-layout">
              <div>
                <div className="canvas-host topview" style={{ position: "relative" }}>
                  <div ref={containerRef} style={{ width: "100%", height: "100%", position: "absolute", inset: 0, borderRadius: "inherit" }} />
                  <div className="help" style={{ zIndex: 2 }}>
                    <span className="dot"></span>
                    <span>
                      {mode === "wand" ? (wandLoading ? "AI analyserer plænen…" : wandOp === "add" ? "Klik for at TILFØJE et område til plænen" : wandOp === "subtract" ? "Klik for at TRÆKKE et område fra plænen" : "Klik midt på græsset — AI sporer plænen automatisk")
                        : mode === "edit" ? "Træk hjørner. Klik et lille punkt for at indsætte. Højreklik = slet hjørne."
                        : mode === "exclude" ? "Tegn et område der trækkes fra (terrasse, bed). Dobbeltklik for at lukke."
                        : mainClosed ? "Færdig — gem din have, eller skift til Rediger."
                        : "Klik for hjørner. Luk ved at klikke første punkt eller Enter. (Cmd/Ctrl+Z = fortryd, S = snap, Del = slet sidste)"}
                    </span>
                  </div>

                  {/* Loading overlay */}
                  {wandLoading && (
                    <div style={{ position: "absolute", inset: 0, zIndex: 3, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(20,39,29,0.35)", backdropFilter: "blur(2px)", borderRadius: "inherit", pointerEvents: "none" }}>
                      <div style={{ background: "rgba(20,39,29,0.85)", border: "1px solid var(--gold)", color: "var(--gold)", padding: "14px 22px", borderRadius: 12, fontSize: 13, letterSpacing: 0.4, fontFamily: "JetBrains Mono, monospace", display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: "var(--gold)", animation: "pulse 1.2s ease-in-out infinite" }} />
                        AI ANALYSERER · GEMINI 2.5 PRO
                      </div>
                    </div>
                  )}

                  <div className="area-pill" style={{ zIndex: 2 }}>
                    <div>
                      <div className="lbl">Areal{exclusions.length ? ` (- ${exclusions.length} ekskl.)` : ""}</div>
                      <div>{area.toFixed(0)} m²</div>
                    </div>
                    {wandConfidence != null && (
                      <div style={{ marginTop: 4, fontSize: 10, color: "var(--gold)", letterSpacing: 0.5 }}>
                        AI {Math.round(wandConfidence * 100)}% sikker
                      </div>
                    )}
                  </div>

                  <div className="tools" style={{ zIndex: 2, flexWrap: "wrap" }}>
                    <button className={`tool-btn ${mode === "draw" ? "is-active" : ""}`} onClick={() => setMode("draw")} title="Tegn (1)">Tegn</button>
                    <button className={`tool-btn ${mode === "edit" ? "is-active" : ""}`} onClick={() => setMode("edit")} disabled={!main.length} title="Rediger (2)">Rediger</button>
                    <button className={`tool-btn ${mode === "exclude" ? "is-active" : ""}`} onClick={() => setMode("exclude")} disabled={!mainClosed} title="Udeluk (3)">− Udeluk</button>
                    <button className={`tool-btn ${mode === "wand" ? "is-active" : ""}`} onClick={() => { setMode("wand"); setWandOp("replace"); }} disabled={wandLoading} title="AI-magic-wand (4)">{wandLoading ? "AI…" : "✨ AI"}</button>
                    {mode === "wand" && mainClosed && (
                      <>
                        <button className={`tool-btn ${wandOp === "add" ? "is-active" : ""}`} onClick={() => setWandOp("add")} disabled={wandLoading} title="AI tilføj område">+ AI</button>
                        <button className={`tool-btn ${wandOp === "subtract" ? "is-active" : ""}`} onClick={() => setWandOp("subtract")} disabled={wandLoading} title="AI træk fra">− AI</button>
                      </>
                    )}
                    <button className="tool-btn" onClick={undo} title="Fortryd (Cmd+Z)">↶</button>
                    <button className="tool-btn" onClick={redo} title="Gentag (Cmd+Shift+Z)">↷</button>
                    <button className={`tool-btn ${snapEnabled ? "is-active" : ""}`} onClick={() => setSnapEnabled(v => !v)} title="Snap (S)">Snap</button>
                    <button className="tool-btn" onClick={clear} title="Ryd alt">Ryd</button>
                  </div>
                </div>

                <div style={{ display: "flex", gap: 10, marginTop: 16, flexWrap: "wrap" }}>
                  <button className="tool-btn" onClick={loadMatrikel}>Hent matrikel</button>
                  {matrikel && <button className="tool-btn" onClick={useMatrikelAsBase}>Brug matrikel som plæne</button>}
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

                <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 16, marginTop: 24 }}>
                  <div className="acct-stat"><div className="v">{main.length}</div><div className="l">Hjørner</div></div>
                  <div className="acct-stat"><div className="v">{perim.toFixed(0)} m</div><div className="l">Omkreds</div></div>
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
                  <div className="cell"><div className="v">{area.toFixed(0)} m²</div><div className="l">Din plæne</div></div>
                  <div className="cell"><div className="v">{tier.max} m²</div><div className="l">Klippekapacitet</div></div>
                  <div className="cell"><div className="v">{tier.battery}</div><div className="l">Batteritid</div></div>
                  <div className="cell"><div className="v">{tier.noise}</div><div className="l">Lydniveau</div></div>
                </div>

                <button className="btn btn-primary" style={{ width: "100%", justifyContent: "center" }} onClick={saveGarden} disabled={saving || area === 0}>
                  {saving ? "Gemmer…" : "Gem have og fortsæt"}
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
          }}
        />
      )}
    </>
  );
}
