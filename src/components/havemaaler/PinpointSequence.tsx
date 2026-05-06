import { useEffect, useRef, useState } from "react";
import mapboxgl from "mapbox-gl";
import { useIsMobile } from "@/hooks/use-mobile";
import "./pinpoint.css";

type LngLat = [number, number];

type Stage =
  | "intro"
  | "globe"
  | "approach"
  | "descent"
  | "drop"
  | "impact"
  | "settle"
  | "handoff";

type Props = {
  address: string;
  center: LngLat;
  mapboxToken: string;
  ortoWmsTemplate: string | null;
  onDone: (camera: { center: LngLat; zoom: number }) => void;
};

const STEPS: { id: string; label: string; stages: Stage[] }[] = [
  { id: "find",  label: "Finder adresse",   stages: ["intro", "globe"] },
  { id: "orto",  label: "Henter ortofoto",  stages: ["approach", "descent"] },
  { id: "place", label: "Placerer pin",     stages: ["drop", "impact"] },
  { id: "ready", label: "Klar",             stages: ["settle", "handoff"] },
];

// Centralised timings — tweak in one place. Mobile gets a small shave (~15%).
function makeTimings(mobile: boolean) {
  const k = mobile ? 0.85 : 1;
  const r = (n: number) => Math.round(n * k);
  return {
    introHold:    r(600),
    globeDur:     r(900),
    approachDur:  r(1800),
    descentDur:   r(1400),
    // pin drop overlaps tail of descent
    dropOffset:   r(-200), // start 200ms before descent ends
    dropDur:      r(750),
    impactDur:    r(320),
    settleDur:    r(700),
    handoffDur:   r(650),
  };
}

export default function PinpointSequence({ address, center, mapboxToken, ortoWmsTemplate, onDone }: Props) {
  const [stage, setStage] = useState<Stage>("intro");
  const [calmDown, setCalmDown] = useState(false); // start hiding HUD/atmosphere before map fade
  const [fadingOut, setFadingOut] = useState(false);
  const [pinPx, setPinPx] = useState<{ x: number; y: number } | null>(null);
  const [mapReady, setMapReady] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const timersRef = useRef<number[]>([]);
  const rafRef = useRef<number | null>(null);
  const finishedRef = useRef(false);
  const mobile = useIsMobile();

  const reduced = typeof window !== "undefined"
    && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  function clearTimers() { timersRef.current.forEach(clearTimeout); timersRef.current = []; }
  function at(ms: number, fn: () => void) { timersRef.current.push(window.setTimeout(fn, ms)); }

  function finish() {
    if (finishedRef.current) return;
    finishedRef.current = true;
    const map = mapRef.current;
    const cam = map
      ? { center: [map.getCenter().lng, map.getCenter().lat] as LngLat, zoom: map.getZoom() }
      : { center, zoom: 19 };
    // Fade HUD/atmosphere first, then the whole stage — gives the impression
    // step 2's map is the same map we were just looking at.
    setCalmDown(true);
    window.setTimeout(() => setFadingOut(true), 220);
    window.setTimeout(() => onDone(cam), 220 + 600);
  }

  // Build dual-source style: satellite (global) + ortofoto (DK), zoom-cross-faded
  function buildStyle(): mapboxgl.Style {
    const sources: any = {
      sat: {
        type: "raster",
        tiles: [
          `https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}@2x.jpg90?access_token=${mapboxToken}`,
        ],
        tileSize: 256,
        attribution: "© Mapbox",
        maxzoom: 22,
      },
    };
    // Cap satellite at z19 so Mapbox doesn't request overzoomed/stretched tiles
    sources.sat.maxzoom = 19;
    const layers: any[] = [
      {
        id: "sat-layer",
        type: "raster",
        source: "sat",
        paint: {
          // Hand off to ortofoto earlier (and over a tighter window) so the
          // pitched descent is always rendered from sharp source data.
          "raster-opacity": [
            "interpolate", ["linear"], ["zoom"],
            13, 1, 15.5, 0,
          ],
          "raster-fade-duration": 300,
        },
      },
    ];
    if (ortoWmsTemplate) {
      sources.orto = {
        type: "raster",
        tiles: [ortoWmsTemplate],
        tileSize: 512,
        attribution: "© SDFE / Dataforsyningen",
      };
      layers.push({
        id: "orto-layer",
        type: "raster",
        source: "orto",
        paint: {
          "raster-opacity": [
            "interpolate", ["linear"], ["zoom"],
            13, 0, 15.5, 1,
          ],
          "raster-fade-duration": 300,
        },
      });
    }
    return { version: 8, sources, layers } as any;
  }

  // Mount Mapbox — deferred to next frame so the overlay paints first
  // (eliminates the perceived freeze right after clicking the address)
  useEffect(() => {
    if (!containerRef.current || !mapboxToken) return;
    mapboxgl.accessToken = mapboxToken;

    let map: mapboxgl.Map | null = null;
    let cancelled = false;

    // Double-RAF: wait for one paint of the overlay chrome before WebGL boot
    const raf1 = requestAnimationFrame(() => {
      const raf2 = requestAnimationFrame(() => {
        if (cancelled || !containerRef.current) return;
        map = new mapboxgl.Map({
          container: containerRef.current,
          style: buildStyle(),
          center,
          zoom: 3.6,
          pitch: 0,
          bearing: 0,
          interactive: false,
          attributionControl: false,
          antialias: true,
          fadeDuration: 300,
        });
        mapRef.current = map;
        // Notify so the orchestration effect can attach its 'load' handler
        setMapReady((n) => n + 1);
      });
      // store inner raf so we can cancel it
      (rafRef.current as any) = raf2;
    });
    rafRef.current = raf1;

    return () => {
      cancelled = true;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      clearTimers();
      try { map?.remove(); } catch {}
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapboxToken]);

  // Project pin position to screen on every map move
  useEffect(() => {
    const map = mapRef.current; if (!map) return;
    const update = () => {
      try {
        const p = map.project(center as any);
        setPinPx({ x: p.x, y: p.y });
      } catch {}
    };
    update();
    map.on("move", update);
    map.on("resize", update);
    return () => { map.off("move", update); map.off("resize", update); };
  }, [center, mapReady]);

  // Orchestrate stages
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    const T = makeTimings(mobile);

    if (reduced) {
      map.once("load", () => {
        map.jumpTo({ center, zoom: 18.5, pitch: 0, bearing: 0 });
        setStage("handoff");
        at(900, finish);
      });
      return;
    }

    // easeInOutCubic — smoother both ends than easeOutCubic
    const easeInOutCubic = (t: number) =>
      t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    // Wait until the map is idle (all tiles loaded) OR a safety timeout fires
    const waitIdle = (maxMs: number) => new Promise<void>((resolve) => {
      let done = false;
      const finish = () => { if (done) return; done = true; map.off("idle", finish); resolve(); };
      map.once("idle", finish);
      window.setTimeout(finish, maxMs);
    });

    map.once("load", () => {
      // INTRO — fade map in, HUD slides in
      setStage("intro");
      // Pre-warm high-res ortofoto tiles around the destination so the
      // descent (zoom 15.5 → 18.7) renders crisp on the very first frame.
      prewarmOrtoTiles(ortoWmsTemplate, center);

      at(T.introHold, () => {
        // GLOBE — gentle drift + slight zoom
        setStage("globe");
        map.easeTo({
          zoom: 6.5,
          bearing: 6,
          duration: T.globeDur,
          easing: easeInOutCubic,
        });

        at(T.globeDur, () => {
          // APPROACH — long flyTo from globe to neighbourhood
          setStage("approach");
          map.flyTo({
            center,
            zoom: 15,
            pitch: 30,
            bearing: -6,
            duration: T.approachDur,
            curve: 1.42,
            speed: 0.9,
            essential: true,
            easing: easeInOutCubic,
          });

          at(T.approachDur, async () => {
            // Hold briefly for ortofoto tiles to load before pitching steeply.
            // Guarantees the descent never renders against blurry/missing tiles.
            await waitIdle(600);
            // DESCENT — slow easeTo into the property
            setStage("descent");
            map.easeTo({
              center,
              zoom: 18.7,
              pitch: 58,
              bearing: -10,
              duration: T.descentDur,
              easing: easeInOutCubic,
            });

            // Pin drops late in the descent — overlapping
            const dropStart = Math.max(0, T.descentDur + T.dropOffset);
            at(dropStart, () => setStage("drop"));

            at(dropStart + T.dropDur, () => {
              setStage("impact");
              if ((navigator as any).vibrate) (navigator as any).vibrate(10);
            });

            at(dropStart + T.dropDur + T.impactDur, () => {
              setStage("settle");
              map.easeTo({
                pitch: 0,
                bearing: 0,
                duration: T.settleDur,
                easing: easeInOutCubic,
              });
            });

            at(dropStart + T.dropDur + T.impactDur + T.settleDur, () => {
              setStage("handoff");
              finish();
            });
          });
        });
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mobile, mapReady]);

  // Esc to skip
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const shake = stage === "impact";
  const activeStepIdx = STEPS.findIndex(s => s.stages.includes(stage));
  const addrName = address.split(",")[0];
  const addrMeta = address.split(",").slice(1).join(",").trim();

  return (
    <div
      className={`pp-stage ${shake ? "shake" : ""} ${calmDown ? "calm-down" : ""} ${fadingOut ? "fading-out" : ""}`}
      data-stage={stage}
    >
      <div ref={containerRef} className="pp-map" />
      <div className="pp-aurora" />
      <div className="pp-grain" />
      <div className="pp-vignette" />
      <div className="pp-clouds" />

      {/* Pin scene anchored at projected coordinate */}
      <div className="pp-pin-scene">
        {pinPx && (
          <div
            className="pp-pin-anchor"
            style={{ left: pinPx.x, top: pinPx.y }}
          >
            <div className="pp-beam" />
            <div className="pp-trail" />
            <div className="pp-pin">
              <svg className="pp-pin-svg" viewBox="0 0 100 140" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <radialGradient id="pp-hl" cx="32%" cy="28%" r="40%">
                    <stop offset="0%" stopColor="#ffffff" stopOpacity="0.55" />
                    <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
                  </radialGradient>
                </defs>
                <path
                  d="M50 8 C 28 8, 12 24, 12 46 C 12 72, 50 130, 50 130 C 50 130, 88 72, 88 46 C 88 24, 72 8, 50 8 Z"
                  fill="currentColor"
                  stroke="rgba(0,0,0,0.45)"
                  strokeWidth="1.2"
                />
                <path
                  d="M50 8 C 28 8, 12 24, 12 46 C 12 72, 50 130, 50 130 C 50 130, 88 72, 88 46 C 88 24, 72 8, 50 8 Z"
                  fill="url(#pp-hl)"
                />
                <circle cx="50" cy="44" r="14" fill="#fff8f3" />
                <circle cx="50" cy="44" r="6" fill="currentColor" />
                <ellipse cx="46" cy="22" rx="10" ry="4" fill="#fff" opacity="0.4" />
              </svg>
            </div>
            <div className="pp-pin-shadow" />
            <div className="pp-shock-flash" />
            <div className="pp-dust" />
            <div className="pp-ripple pp-r1" />
            <div className="pp-ripple pp-r2" />
            <div className="pp-ripple pp-r3" />
            <div className="pp-sparkles">
              {Array.from({ length: 14 }).map((_, i) => (
                <span
                  key={i}
                  className="pp-spark"
                  style={{
                    ["--a" as any]: `${(i / 14) * 360}deg`,
                    ["--d" as any]: `${(i % 5) * 0.04}s`,
                    ["--dist" as any]: `${70 + (i % 3) * 30}px`,
                  } as React.CSSProperties}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* HUD */}
      <div className="pp-hud" role="status" aria-live="polite">
        <div className="pp-hud-row">
          {STEPS.map((s, i) => (
            <div
              key={s.id}
              className={`pp-step ${i === activeStepIdx ? "active" : i < activeStepIdx ? "done" : ""}`}
            >
              <span className="pp-dot" />
              <span>{s.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Address card */}
      <div className="pp-addr-card">
        <span className="pp-addr-pin">
          <svg width="16" height="16" viewBox="0 0 18 18" fill="none">
            <path d="M9 16s6-5.5 6-9.5A6 6 0 003 6.5C3 10.5 9 16 9 16z" stroke="currentColor" strokeWidth="1.5" />
            <circle cx="9" cy="6.5" r="2" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </span>
        <span className="pp-addr-name">{addrName}</span>
        {addrMeta && <div className="pp-addr-meta">{addrMeta}</div>}
      </div>

      {/* Skip */}
      <button className="pp-skip" onClick={finish} type="button">
        Spring over →
      </button>
    </div>
  );
}
