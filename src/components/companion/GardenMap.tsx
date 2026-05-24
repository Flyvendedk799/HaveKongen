import { useMemo, useRef, useState } from "react";
import { Camera, Droplets, Leaf, MapPin, Move, Radio, Sprout } from "lucide-react";
import type { Tables } from "@/integrations/supabase/types";
import { clampNormalizedPoint, type HealthScore, type ZoneInsight } from "@/lib/companionTypes";
import { coerceGardenDepthModel } from "@/lib/gardenDepth";
import GardenTwinViewer from "@/components/havemaaler/GardenTwinViewer";

type Garden = Pick<Tables<"gardens">, "id" | "name" | "thumbnail_url" | "area_m2" | "depth_model" | "depth_model_updated_at">;
type Zone = Pick<Tables<"garden_zones">, "id" | "name" | "type" | "area_m2" | "soil" | "sun_exposure">;
type Plant = Tables<"user_plants"> & {
  plants_catalog?: { name_da: string | null; water_need: string | null; image_url: string | null } | null;
};
type Observation = Tables<"garden_observations">;
type Device = Tables<"devices">;

type Pin =
  | { type: "plant"; id: string; label: string; x: number; y: number; tone: string; zone_id: string | null }
  | { type: "observation"; id: string; label: string; x: number; y: number; tone: string; zone_id: string | null }
  | { type: "device"; id: string; label: string; x: number; y: number; tone: string; zone_id: string | null };

type Props = {
  garden: Garden;
  zones: Zone[];
  plants: Plant[];
  observations: Observation[];
  devices: Device[];
  zoneScores?: Record<string, HealthScore>;
  zoneInsights?: Record<string, ZoneInsight[]>;
  selectedZoneId?: string | null;
  onSelectZone: (zoneId: string | null) => void;
  onSelectPlant?: (plantId: string) => void;
  onMovePlant: (id: string, x: number, y: number) => void;
  onMoveObservation: (id: string, x: number, y: number) => void;
  onMoveDevice: (id: string, x: number, y: number) => void;
};

function readPosition(value: unknown): { x: number; y: number } | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const x = typeof obj.normalized_x === "number" ? obj.normalized_x : null;
  const y = typeof obj.normalized_y === "number" ? obj.normalized_y : null;
  if (x === null || y === null) return null;
  const point = clampNormalizedPoint(x, y);
  return { x: point.normalized_x, y: point.normalized_y };
}

function readZoneId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const zoneId = (value as Record<string, unknown>).zone_id;
  return typeof zoneId === "string" ? zoneId : null;
}

function fallbackForIndex(index: number, total: number) {
  const cols = Math.ceil(Math.sqrt(Math.max(1, total)));
  const row = Math.floor(index / cols);
  const col = index % cols;
  return {
    x: (col + 1) / (cols + 1),
    y: (row + 1) / (Math.ceil(total / cols) + 1),
  };
}

function labelPlant(p: Plant) {
  return p.custom_name || p.plants_catalog?.name_da || p.plant_slug || "Plante";
}

export default function GardenMap({
  garden,
  zones,
  plants,
  observations,
  devices,
  zoneScores = {},
  zoneInsights = {},
  selectedZoneId,
  onSelectZone,
  onSelectPlant,
  onMovePlant,
  onMoveObservation,
  onMoveDevice,
}: Props) {
  const mapRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Pin | null>(null);
  const [draft, setDraft] = useState<{ x: number; y: number } | null>(null);
  const [mapMode, setMapMode] = useState<"living" | "twin">("living");
  const depthModel = useMemo(() => coerceGardenDepthModel(garden.depth_model), [garden.depth_model]);

  const zoneFallback = useMemo(() => {
    const out: Record<string, { x: number; y: number }> = {};
    zones.forEach((zone, index) => {
      out[zone.id] = fallbackForIndex(index, zones.length);
    });
    return out;
  }, [zones]);

  const pins = useMemo<Pin[]>(() => {
    const plantPins = plants.map((plant, index): Pin => {
      const stored = readPosition(plant.map_position);
      const zonePoint = plant.zone_id ? zoneFallback[plant.zone_id] : null;
      const fallback = fallbackForIndex(index, plants.length);
      return {
        type: "plant",
        id: plant.id,
        label: labelPlant(plant),
        x: stored?.x ?? zonePoint?.x ?? fallback.x,
        y: stored?.y ?? zonePoint?.y ?? fallback.y,
        tone: plant.health_status === "watch" ? "warn" : "plant",
        zone_id: plant.zone_id,
      };
    });

    const observationPins = observations.slice(0, 80).map((obs, index): Pin => {
      const stored = readPosition(obs.anchor);
      const zonePoint = obs.zone_id ? zoneFallback[obs.zone_id] : null;
      const fallback = fallbackForIndex(index + plants.length, observations.length + plants.length);
      return {
        type: "observation",
        id: obs.id,
        label: obs.caption || obs.kind,
        x: stored?.x ?? zonePoint?.x ?? fallback.x,
        y: stored?.y ?? zonePoint?.y ?? fallback.y,
        tone: obs.kind === "diagnosis" ? "warn" : obs.kind === "growth" ? "growth" : "photo",
        zone_id: obs.zone_id,
      };
    });

    const devicePins = devices.map((device, index): Pin => {
      const stored = readPosition(device.map_position || device.metadata);
      const zoneId = readZoneId(device.metadata);
      const zonePoint = zoneId ? zoneFallback[zoneId] : null;
      const fallback = fallbackForIndex(index + plants.length + observations.length, devices.length + plants.length + observations.length);
      return {
        type: "device",
        id: device.id,
        label: device.name,
        x: stored?.x ?? zonePoint?.x ?? fallback.x,
        y: stored?.y ?? zonePoint?.y ?? fallback.y,
        tone: device.status === "online" || device.status === "running" ? "device" : "muted",
        zone_id: zoneId,
      };
    });

    return [...plantPins, ...observationPins, ...devicePins];
  }, [devices, observations, plants, zoneFallback]);

  function pointFromEvent(e: React.PointerEvent) {
    const rect = mapRef.current?.getBoundingClientRect();
    if (!rect) return null;
    return clampNormalizedPoint((e.clientX - rect.left) / rect.width, (e.clientY - rect.top) / rect.height);
  }

  function startDrag(pin: Pin, e: React.PointerEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag(pin);
    setDraft({ x: pin.x, y: pin.y });
  }

  function moveDrag(e: React.PointerEvent) {
    if (!drag) return;
    const point = pointFromEvent(e);
    if (point) setDraft({ x: point.normalized_x, y: point.normalized_y });
  }

  function endDrag() {
    if (!drag || !draft) {
      setDrag(null);
      setDraft(null);
      return;
    }
    if (drag.type === "plant") onMovePlant(drag.id, draft.x, draft.y);
    if (drag.type === "observation") onMoveObservation(drag.id, draft.x, draft.y);
    if (drag.type === "device") onMoveDevice(drag.id, draft.x, draft.y);
    setDrag(null);
    setDraft(null);
  }

  const visiblePins = selectedZoneId ? pins.filter((p) => p.zone_id === selectedZoneId || p.type === "device") : pins;
  const selectedZone = selectedZoneId ? zones.find((zone) => zone.id === selectedZoneId) ?? null : null;
  const zonePlants = selectedZoneId ? plants.filter((plant) => plant.zone_id === selectedZoneId) : plants;
  const zoneObservations = selectedZoneId ? observations.filter((obs) => obs.zone_id === selectedZoneId) : observations;
  const zoneDevices = selectedZoneId
    ? devices.filter((device) => readZoneId(device.metadata) === selectedZoneId)
    : devices;
  const latestDiagnosis = zoneObservations.find((obs) => obs.kind === "diagnosis" || obs.kind === "bed_scan");
  const latestGrowth = zoneObservations.find((obs) => obs.kind === "growth");
  const selectedScore = selectedZoneId ? zoneScores[selectedZoneId] : null;
  const selectedInsights = selectedZoneId ? zoneInsights[selectedZoneId] ?? [] : [];

  return (
    <div className="companion-map-shell">
      <div className="companion-map-toolbar">
        <div>
          <div className="companion-eyebrow">Levende kort</div>
          <h2>{garden.name}</h2>
        </div>
        <div className="companion-zone-filter" aria-label="Filtrer kortet efter zone">
          <button className={mapMode === "living" ? "active" : ""} onClick={() => setMapMode("living")}>Kort</button>
          <button className={mapMode === "twin" ? "active" : ""} onClick={() => setMapMode("twin")}>3D</button>
          <button className={!selectedZoneId ? "active" : ""} onClick={() => onSelectZone(null)}>Alle</button>
          {zones.slice(0, 6).map((zone) => (
            <button key={zone.id} className={selectedZoneId === zone.id ? "active" : ""} onClick={() => onSelectZone(zone.id)}>
              {zone.name}
            </button>
          ))}
        </div>
      </div>

      <div
        ref={mapRef}
        className="companion-map"
        onPointerMove={moveDrag}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {mapMode === "twin" ? (
          depthModel ? (
            <GardenTwinViewer model={depthModel} className="companion-twin-viewer" compact />
          ) : (
            <div className="companion-map-placeholder companion-map-placeholder--depth">
              <MapPin size={36} />
              <span>Byg en 3D Garden Twin i Havemåler for at se højder, objekter og mobilscan her.</span>
              <a className="btn btn-primary btn-sm" href={`/havemaaler?garden=${garden.id}&next=${encodeURIComponent("/havekompagnon")}`}>Åbn Havemåler</a>
            </div>
          )
        ) : (
          <>
            {garden.thumbnail_url ? (
              <img src={garden.thumbnail_url} alt="" className="companion-map-image" />
            ) : (
              <div className="companion-map-placeholder">
                <MapPin size={36} />
                <span>Mål haven for ortofoto. Indtil da kan du stadig placere planter og fotos visuelt.</span>
              </div>
            )}

            <div className="companion-map-zones">
              {zones.map((zone, index) => {
                const point = zoneFallback[zone.id] ?? fallbackForIndex(index, zones.length);
                return (
                  <button
                    key={zone.id}
                    className={`companion-zone-chip ${selectedZoneId === zone.id ? "active" : ""}`}
                    style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }}
                    onClick={() => onSelectZone(selectedZoneId === zone.id ? null : zone.id)}
                  >
                    {zone.name}
                  </button>
                );
              })}
            </div>

            {visiblePins.map((pin) => {
              const isDragging = drag?.type === pin.type && drag.id === pin.id;
              const x = isDragging && draft ? draft.x : pin.x;
              const y = isDragging && draft ? draft.y : pin.y;
              return (
                <button
                  key={`${pin.type}-${pin.id}`}
                  className={`companion-pin companion-pin--${pin.tone} ${isDragging ? "dragging" : ""}`}
                  style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
                  onPointerDown={(e) => startDrag(pin, e)}
                  onClick={() => pin.type === "plant" && onSelectPlant?.(pin.id)}
                  title={`${pin.label} · træk for at flytte`}
                >
                  {pin.type === "plant" && <Sprout size={15} />}
                  {pin.type === "observation" && (pin.tone === "photo" ? <Camera size={15} /> : <Leaf size={15} />)}
                  {pin.type === "device" && (pin.tone === "device" ? <Radio size={15} /> : <Droplets size={15} />)}
                  <span>{pin.label}</span>
                  <Move size={11} className="companion-pin-move" />
                </button>
              );
            })}

            <div className="companion-map-legend" aria-label="Kortlag">
              <span><i className="plant" /> Plante</span>
              <span><i className="photo" /> Foto</span>
              <span><i className="warn" /> Risiko</span>
              <span><i className="device" /> Sensor</span>
            </div>
          </>
        )}
      </div>

      <div className="companion-zone-memory">
        <article className="companion-memory-summary">
          <div>
            <div className="companion-eyebrow">{selectedZone ? "Zonehukommelse" : "Havehukommelse"}</div>
            <h3>{selectedZone?.name ?? "Hele haven"}</h3>
            <p>
              {selectedZone
                ? `${selectedZone.type} · ${selectedZone.area_m2 ? `${Math.round(selectedZone.area_m2)} m2` : "areal ukendt"} · ${selectedZone.soil || "jord ukendt"}`
                : "Vælg en zone på kortet for at se lokal historik og anbefalingsgrundlag."}
            </p>
          </div>
          <div className="companion-memory-kpis">
            <span><Sprout size={14} /> {zonePlants.length} planter</span>
            <span><Camera size={14} /> {zoneObservations.length} scans</span>
            <span><Radio size={14} /> {zoneDevices.length} enheder</span>
          </div>
        </article>

        <div className="companion-memory-grid">
          <MemoryCard
            icon={<Leaf size={15} />}
            title="Sundhed"
            value={selectedScore ? `${selectedScore.score}/100 · ${selectedScore.status}` : "Vælg en zone"}
            meta={selectedScore?.explanation || "Scoren beregnes fra scans, opgaver og sensorer"}
          />
          <MemoryCard
            icon={<Leaf size={15} />}
            title="Seneste diagnose"
            value={latestDiagnosis?.caption || resultTitle(latestDiagnosis?.ai_result) || "Ingen diagnose endnu"}
            meta={latestDiagnosis ? dateLabel(latestDiagnosis.created_at) : "Scan en plante eller et bed"}
          />
          <MemoryCard
            icon={<Sprout size={15} />}
            title="Seneste vækst"
            value={latestGrowth?.caption || resultTitle(latestGrowth?.ai_result) || "Ingen vækstlinje endnu"}
            meta={latestGrowth ? dateLabel(latestGrowth.created_at) : "Kræver mindst to observationer for trend"}
          />
          <MemoryCard
            icon={<Droplets size={15} />}
            title="Sensorlag"
            value={zoneDevices.length ? `${zoneDevices.length} enheder placeret` : "Ingen enheder placeret"}
            meta={zoneDevices[0]?.status || "Tilføj sensor eller ventil"}
          />
        </div>

        {selectedInsights.length > 0 && (
          <div className="companion-zone-insights">
            {selectedInsights.map((insight) => (
              <article key={`${insight.action_kind}-${insight.title}`}>
                <span>{insight.priority}</span>
                <strong>{insight.title}</strong>
                <p>{insight.reason}</p>
              </article>
            ))}
          </div>
        )}

        {zoneObservations.length > 0 && (
          <div className="companion-memory-timeline">
            {zoneObservations.slice(0, 5).map((obs) => (
              <div key={obs.id}>
                {obs.image_url ? <img src={obs.image_url} alt="" /> : <Camera size={15} />}
                <div>
                  <strong>{obs.caption || resultTitle(obs.ai_result) || obs.kind}</strong>
                  <span>{obs.kind} · {dateLabel(obs.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function dateLabel(iso?: string | null) {
  if (!iso) return "uden dato";
  return new Date(iso).toLocaleDateString("da-DK", { day: "numeric", month: "short" });
}

function resultTitle(value: unknown) {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  return String(row.diagnosis || row.summary || row.name_da || row.stage || "");
}

function MemoryCard({ icon, title, value, meta }: { icon: React.ReactNode; title: string; value: string; meta: string }) {
  return (
    <article className="companion-memory-card">
      <div className="companion-metric-icon">{icon}</div>
      <div>
        <span>{title}</span>
        <strong>{value}</strong>
        <small>{meta}</small>
      </div>
    </article>
  );
}
