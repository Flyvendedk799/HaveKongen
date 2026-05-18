import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, Crosshair, Flower2, Loader2, MapPin, Sprout, Upload, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { Json, Tables } from "@/integrations/supabase/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { fileToDataUrl, uploadPlantPhoto } from "@/lib/plantPhotos";
import { actionFromScan, actionsFromBedScan, actionsFromGrowth } from "@/lib/companionActions";
import { asNumberConfidence, mapAnchor, normalizeScanResult, type CareAction, type ObservationKind } from "@/lib/companionTypes";

type ScanMode = "identify" | "diagnosis" | "growth" | "bed_scan" | "photo" | "harvest";

type Garden = Pick<Tables<"gardens">, "id" | "name">;
type Zone = Pick<Tables<"garden_zones">, "id" | "name" | "type" | "soil" | "sun_exposure">;
type Plant = Tables<"user_plants"> & {
  plants_catalog?: { name_da: string | null; water_need: string | null; image_url: string | null } | null;
};
type Observation = Tables<"garden_observations">;
type ScanResult = Record<string, unknown>;

type Props = {
  userId: string;
  garden: Garden;
  zones: Zone[];
  plants: Plant[];
  observations: Observation[];
  defaultZoneId?: string | null;
  onSaved: () => void;
};

const MODES: { key: ScanMode; label: string; hint: string; kind: ObservationKind }[] = [
  { key: "identify", label: "Identificér", hint: "Find planten og opret den på kortet.", kind: "identify" },
  { key: "diagnosis", label: "Sygdom", hint: "Symptomer, årsag og behandling.", kind: "diagnosis" },
  { key: "growth", label: "Vækst", hint: "Sammenlign med tidligere fotos.", kind: "growth" },
  { key: "bed_scan", label: "Bedscan", hint: "Helhedsvurdering af bedet.", kind: "bed_scan" },
  { key: "photo", label: "Foto", hint: "Gem et kortplaceret foto.", kind: "photo" },
  { key: "harvest", label: "Høst", hint: "Log høst eller blomstring.", kind: "harvest" },
];

function plantLabel(p: Plant) {
  return p.custom_name || p.plants_catalog?.name_da || p.plant_slug || "Plante";
}

function severityText(value: unknown) {
  if (value === "high") return "Akut";
  if (value === "medium") return "Bemærk";
  if (value === "low") return "Lav risiko";
  return "Observation";
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function taskRowsFromActions(userId: string, actions: Omit<CareAction, "id">[]) {
  return actions.map((action) => ({
    user_id: userId,
    garden_id: action.garden_id,
    zone_id: action.zone_id ?? null,
    plant_id: action.plant_id ?? null,
    observation_id: action.observation_id ?? null,
    kind: action.kind,
    title: action.title,
    notes: action.reason ?? null,
    due_at: action.due_at ?? null,
    priority: action.priority,
    source: action.source,
    reason: action.reason ?? null,
    confidence: action.confidence ?? null,
    payload: action.payload ?? {},
  }));
}

export default function GardenCamera({ userId, garden, zones, plants, observations, defaultZoneId, onSaved }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<ScanMode>("identify");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [zoneId, setZoneId] = useState<string>(defaultZoneId || zones[0]?.id || "none");
  const [plantId, setPlantId] = useState<string>("none");
  const [note, setNote] = useState("");
  const [pos, setPos] = useState({ x: 0.5, y: 0.5 });

  useEffect(() => {
    setZoneId(defaultZoneId || zones[0]?.id || "none");
  }, [defaultZoneId, zones]);

  const selectedZone = zoneId === "none" ? null : zones.find((z) => z.id === zoneId) ?? null;
  const selectedPlant = plantId === "none" ? null : plants.find((p) => p.id === plantId) ?? null;
  const modeMeta = MODES.find((m) => m.key === mode)!;

  const previousPlantObservations = useMemo(() => {
    if (!selectedPlant) return [];
    return observations.filter((o) => o.plant_id === selectedPlant.id).slice(0, 5);
  }, [observations, selectedPlant]);

  async function handleFile(next: File) {
    if (next.size > 9 * 1024 * 1024) {
      toast.error("Billedet er for stort (max 9 MB)");
      return;
    }
    setFile(next);
    setPreview(await fileToDataUrl(next));
    setResult(null);
  }

  async function analyze() {
    if (!preview) return;
    setAnalyzing(true);
    try {
      let data: ScanResult | null = null;
      if (mode === "identify") {
        const { data: catalog } = await supabase.from("plants_catalog").select("slug,name_da,latin").limit(350);
        const res = await supabase.functions.invoke("identify-plant", {
          body: {
            image: preview,
            catalog: catalog ?? [],
            context: { garden_id: garden.id, zone_id: selectedZone?.id ?? null, note },
          },
        });
        if (res.error) throw res.error;
        data = (res.data ?? null) as ScanResult | null;
      } else if (mode === "growth") {
        const res = await supabase.functions.invoke("analyze-growth", {
          body: {
            imageDataUrl: preview,
            note,
            context: {
              garden_id: garden.id,
              zone_id: selectedZone?.id ?? null,
              plant_id: selectedPlant?.id ?? null,
              plant_name: selectedPlant ? plantLabel(selectedPlant) : null,
              previous: previousPlantObservations.map((o) => ({ created_at: o.created_at, ai_result: o.ai_result })),
            },
          },
        });
        if (res.error) throw res.error;
        data = (res.data ?? null) as ScanResult | null;
      } else if (mode === "bed_scan") {
        const res = await supabase.functions.invoke("analyze-bed-scan", {
          body: {
            imageDataUrl: preview,
            note,
            context: {
              garden_id: garden.id,
              zone: selectedZone,
              plants: plants.filter((p) => p.zone_id === selectedZone?.id).map(plantLabel),
            },
          },
        });
        if (res.error) throw res.error;
        data = (res.data ?? null) as ScanResult | null;
      } else if (mode === "diagnosis") {
        const res = await supabase.functions.invoke("plant-diagnose", {
          body: {
            imageDataUrl: preview,
            note,
            context: {
              garden_id: garden.id,
              zone_id: selectedZone?.id ?? null,
              plant_id: selectedPlant?.id ?? null,
              plant_name: selectedPlant ? plantLabel(selectedPlant) : null,
            },
          },
        });
        if (res.error) throw res.error;
        data = (res.data ?? null) as ScanResult | null;
      }

      if (data?.error) throw new Error(data.error);
      setResult(data || { summary: mode === "photo" ? "Foto klar til kortet" : "Observation klar" });
    } catch (e: unknown) {
      toast.error(errorMessage(e, "AI kunne ikke analysere billedet"));
    } finally {
      setAnalyzing(false);
    }
  }

  async function save() {
    if (!file || !preview) {
      toast.error("Tilføj et foto først");
      return;
    }
    if ((mode === "diagnosis" || mode === "growth") && !result) {
      toast.error("Analyser billedet først");
      return;
    }
    setSaving(true);
    try {
      const imageUrl = await uploadPlantPhoto(userId, file);
      const anchor = mapAnchor(garden.id, selectedZone?.id ?? null, selectedPlant?.id ?? null, pos.x, pos.y, "manual");
      const rawResult = result || {
        summary: mode === "harvest" ? "Høst logget" : "Foto gemt",
        note,
      };
      const confidence = asNumberConfidence(rawResult.confidence);
      const { data: observation, error } = await supabase.from("garden_observations").insert({
        user_id: userId,
        garden_id: garden.id,
        zone_id: selectedZone?.id ?? null,
        plant_id: selectedPlant?.id ?? null,
        kind: modeMeta.kind,
        image_url: imageUrl,
        anchor,
        ai_result: rawResult as Json,
        confidence,
        caption: note || String(rawResult.diagnosis || rawResult.name_da || rawResult.summary || modeMeta.label),
      }).select().single();
      if (error || !observation) throw error || new Error("Observation blev ikke gemt");

      if (mode === "identify" && rawResult.name_da) {
        const candidateSlugs = Array.isArray(rawResult.candidate_slugs) ? rawResult.candidate_slugs.map(String) : [];
        const matchedSlug = candidateSlugs[0] || null;
        await supabase.from("user_plants").insert({
          user_id: userId,
          garden_id: garden.id,
          zone_id: selectedZone?.id ?? null,
          plant_slug: matchedSlug,
          custom_name: matchedSlug ? null : String(rawResult.name_da),
          qty: 1,
          image_url: imageUrl,
          notes: String(rawResult.care_tip || ""),
          map_position: anchor as Json,
          lifecycle_status: "observed",
          health_status: "unknown",
          last_observed_at: new Date().toISOString(),
        });
      }

      if (mode === "diagnosis") {
        const normalized = normalizeScanResult(rawResult);
        await supabase.from("plant_health_log").insert({
          user_id: userId,
          garden_id: garden.id,
          zone_id: selectedZone?.id ?? null,
          plant_id: selectedPlant?.id ?? null,
          observation_id: observation.id,
          image_url: imageUrl,
          diagnosis: normalized.title,
          severity: normalized.severity,
          confidence: normalized.confidence,
          symptoms: normalized.symptoms,
          causes: normalized.causes,
          treatment: normalized.treatment,
          prevention: normalized.prevention,
          product_suggestions: (rawResult.product_suggestions || []) as Json,
          raw: rawResult as Json,
        });

        if (selectedPlant) {
          await supabase.from("user_plants").update({
            health_status: normalized.severity === "low" ? "ok" : "watch",
            last_observed_at: new Date().toISOString(),
          }).eq("id", selectedPlant.id);
        }

        const task = actionFromScan(garden.id, normalized, observation.id, selectedZone?.id ?? null, selectedPlant?.id ?? null);
        if (task) {
          await supabase.from("task_log").insert({
            user_id: userId,
            garden_id: garden.id,
            zone_id: task.zone_id,
            plant_id: task.plant_id,
            kind: task.kind,
            title: task.title,
            notes: task.reason,
            due_at: task.due_at,
            priority: task.priority,
            source: task.source,
            reason: task.reason,
            confidence: task.confidence,
            observation_id: observation.id,
            payload: task.payload || {},
          });
        }
      }

      if (mode === "growth") {
        await supabase.from("plant_growth_snapshots").insert({
          user_id: userId,
          garden_id: garden.id,
          zone_id: selectedZone?.id ?? null,
          plant_id: selectedPlant?.id ?? null,
          observation_id: observation.id,
          stage: rawResult.stage ? String(rawResult.stage) : null,
          vigor: rawResult.vigor ? String(rawResult.vigor) : null,
          estimated_height_cm: typeof rawResult.estimated_height_cm === "number" ? rawResult.estimated_height_cm : null,
          flowering: typeof rawResult.flowering === "boolean" ? rawResult.flowering : null,
          fruiting: typeof rawResult.fruiting === "boolean" ? rawResult.fruiting : null,
          harvest_readiness: rawResult.harvest_readiness ? String(rawResult.harvest_readiness) : null,
          anomaly_flags: Array.isArray(rawResult.anomaly_flags) ? rawResult.anomaly_flags.map(String) : [],
          ai_result: rawResult as Json,
        });
        if (selectedPlant) {
          await supabase.from("user_plants").update({
            lifecycle_status: rawResult.stage ? String(rawResult.stage) : "observed",
            last_observed_at: new Date().toISOString(),
          }).eq("id", selectedPlant.id);
        }

        const growthActions = actionsFromGrowth(garden.id, rawResult, observation.id, selectedZone?.id ?? null, selectedPlant?.id ?? null);
        if (growthActions.length > 0) {
          await supabase.from("task_log").insert(taskRowsFromActions(userId, growthActions));
        }
      }

      if (mode === "bed_scan") {
        const bedActions = actionsFromBedScan(garden.id, rawResult, observation.id, selectedZone?.id ?? null, selectedPlant?.id ?? null);
        if (bedActions.length > 0) {
          await supabase.from("task_log").insert(taskRowsFromActions(userId, bedActions));
        }
      }

      if (mode === "harvest") {
        await supabase.from("garden_journal").insert({
          user_id: userId,
          garden_id: garden.id,
          zone_id: selectedZone?.id ?? null,
          plant_id: selectedPlant?.id ?? null,
          kind: "harvest",
          caption: note || "Høst eller blomstring logget",
          image_url: imageUrl,
          data: { observation_id: observation.id },
        });
      }

      toast.success("Gemt i Havekompagnonen");
      setFile(null);
      setPreview(null);
      setResult(null);
      setNote("");
      onSaved();
    } catch (e: unknown) {
      toast.error(errorMessage(e, "Kunne ikke gemme observationen"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="companion-camera">
      <section className="companion-band companion-camera-stage">
        <div>
          <div className="companion-eyebrow">Scan</div>
          <h2>Tag et foto. Placer det. Gør det handlingsklart.</h2>
        </div>

        <div className="companion-mode-grid">
          {MODES.map((item) => (
            <button key={item.key} className={mode === item.key ? "active" : ""} onClick={() => { setMode(item.key); setResult(null); }}>
              {item.key === "identify" && <Sprout size={16} />}
              {item.key === "diagnosis" && <Crosshair size={16} />}
              {item.key === "growth" && <Flower2 size={16} />}
              {(item.key === "bed_scan" || item.key === "photo" || item.key === "harvest") && <Camera size={16} />}
              <span>{item.label}</span>
              <small>{item.hint}</small>
            </button>
          ))}
        </div>

        <div className="companion-camera-grid">
          <div>
            {!preview ? (
              <div className="companion-upload">
                <Camera size={34} />
                <h3>Start med et billede</h3>
                <p>Kameraet er den hurtigste måde at tilføje planter, sygdomme, vækst og høst til kortet.</p>
                <div className="companion-upload-actions">
                  <Button onClick={() => camRef.current?.click()}><Camera size={15} className="mr-1.5" /> Tag foto</Button>
                  <Button variant="outline" onClick={() => fileRef.current?.click()}><Upload size={15} className="mr-1.5" /> Upload</Button>
                </div>
              </div>
            ) : (
              <div className="companion-preview">
                <img src={preview} alt="Scan" />
                <button onClick={() => { setFile(null); setPreview(null); setResult(null); }} aria-label="Fjern billede">
                  <X size={15} />
                </button>
              </div>
            )}
            <input ref={camRef} hidden type="file" accept="image/*" capture="environment" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
            <input ref={fileRef} hidden type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
          </div>

          <div className="companion-scan-controls">
            <div className="grid gap-2">
              <Label>Zone</Label>
              <Select value={zoneId} onValueChange={(v) => { setZoneId(v); setPlantId("none"); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Hele haven</SelectItem>
                  {zones.map((zone) => <SelectItem key={zone.id} value={zone.id}>{zone.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>Plante</Label>
              <Select value={plantId} onValueChange={setPlantId}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Ingen bestemt plante</SelectItem>
                  {plants
                    .filter((plant) => zoneId === "none" || plant.zone_id === zoneId)
                    .map((plant) => <SelectItem key={plant.id} value={plant.id}>{plantLabel(plant)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label>Note</Label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Hvad vil du huske eller spørge AI om?" rows={3} />
            </div>

            <div className="companion-position-box">
              <div>
                <MapPin size={15} />
                <span>Foreløbig placering på kortet</span>
              </div>
              <label>
                X
                <input type="range" min="3" max="97" value={Math.round(pos.x * 100)} onChange={(e) => setPos((p) => ({ ...p, x: Number(e.target.value) / 100 }))} />
              </label>
              <label>
                Y
                <input type="range" min="3" max="97" value={Math.round(pos.y * 100)} onChange={(e) => setPos((p) => ({ ...p, y: Number(e.target.value) / 100 }))} />
              </label>
              <small>Gem først her. Finjuster bagefter ved at trække pinnen på kortet.</small>
            </div>

            <div className="companion-scan-actions">
              {mode !== "photo" && mode !== "harvest" && (
                <Button onClick={analyze} disabled={!preview || analyzing}>
                  {analyzing ? <Loader2 size={15} className="mr-1.5 animate-spin" /> : <Crosshair size={15} className="mr-1.5" />}
                  Analyser
                </Button>
              )}
              <Button variant={result || mode === "photo" || mode === "harvest" ? "default" : "outline"} onClick={save} disabled={!preview || saving}>
                {saving ? <Loader2 size={15} className="mr-1.5 animate-spin" /> : <Check size={15} className="mr-1.5" />}
                Gem på kortet
              </Button>
            </div>
          </div>
        </div>
      </section>

      {result && (
        <section className="companion-band companion-result">
          <div className="companion-section-head">
            <div>
              <div className="companion-eyebrow">{severityText(result.severity)} · {result.confidence ? `${Math.round((asNumberConfidence(result.confidence) ?? 0) * 100)}% sikker` : "AI-resultat"}</div>
              <h2>{String(result.diagnosis || result.name_da || result.summary || result.stage || "Observation")}</h2>
            </div>
          </div>
          <div className="companion-result-grid">
            {result.latin && <Info label="Latin" value={String(result.latin)} />}
            {result.category && <Info label="Kategori" value={String(result.category)} />}
            {result.water_need && <Info label="Vandbehov" value={String(result.water_need)} />}
            {result.stage && <Info label="Vækststadie" value={String(result.stage)} />}
            {result.vigor && <Info label="Vigor" value={String(result.vigor)} />}
            {result.harvest_readiness && <Info label="Høst" value={String(result.harvest_readiness)} />}
          </div>
          {(result.treatment || result.care_tip || result.next_action) && (
            <p>{String(result.treatment || result.care_tip || result.next_action)}</p>
          )}
          {Array.isArray(result.symptoms) && result.symptoms.length > 0 && (
            <div className="companion-tags">
              {result.symptoms.slice(0, 6).map((s, i) => <span key={i}>{String(s)}</span>)}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
