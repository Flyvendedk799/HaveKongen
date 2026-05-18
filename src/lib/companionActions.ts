import type { Forecast } from "@/lib/wateringAI";
import type { CareAction, NormalizedScanResult } from "@/lib/companionTypes";

type ZoneLike = {
  id: string;
  name: string;
  type?: string | null;
  sun_exposure?: string | null;
  soil?: string | null;
};

type DeviceLike = {
  id: string;
  name: string;
  kind: string;
  status: string;
  battery: number | null;
  metadata?: Record<string, unknown> | null;
  zone_id?: string | null;
};

function metadataZoneId(device: DeviceLike) {
  const zoneId = device.metadata?.zone_id;
  return typeof zoneId === "string" ? zoneId : device.zone_id ?? null;
}

function metadataMoisture(device: DeviceLike) {
  const moisture = device.metadata?.moisture_pct;
  return typeof moisture === "number" ? moisture : null;
}

function dueInHours(hours: number) {
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function strings(value: unknown) {
  return Array.isArray(value) ? value.map(String).filter(Boolean) : [];
}

function priority(value: unknown): CareAction["priority"] {
  if (value === "urgent" || value === "high" || value === "normal" || value === "low") return value;
  if (value === "medium") return "high";
  return "normal";
}

function confidence(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : null;
}

export function actionFromScan(
  gardenId: string,
  result: NormalizedScanResult,
  observationId: string,
  zoneId?: string | null,
  plantId?: string | null,
): Omit<CareAction, "id"> | null {
  if (result.severity === "low" || !result.treatment.trim()) return null;

  return {
    kind: "diagnose",
    title: result.severity === "high" ? `Akut: ${result.title}` : `Følg op: ${result.title}`,
    reason: result.treatment,
    priority: result.severity === "high" ? "urgent" : "high",
    due_at: result.severity === "high" ? dueInHours(6) : dueInHours(24),
    status: "open",
    source: "scan",
    confidence: result.confidence,
    garden_id: gardenId,
    zone_id: zoneId ?? null,
    plant_id: plantId ?? null,
    observation_id: observationId,
    payload: {
      symptoms: result.symptoms,
      causes: result.causes,
      prevention: result.prevention,
      severity: result.severity,
    },
  };
}

export function actionsFromBedScan(
  gardenId: string,
  result: Record<string, unknown>,
  observationId: string,
  zoneId?: string | null,
  plantId?: string | null,
): Omit<CareAction, "id">[] {
  const taskSuggestions = Array.isArray(result.task_suggestions) ? result.task_suggestions : [];
  const actions = taskSuggestions.slice(0, 6).map((item, index) => {
    const row = item && typeof item === "object" ? item as Record<string, unknown> : { title: item };
    const title = text(row.title, text(row.action, `Følg op på bedscan ${index + 1}`));
    const hours = typeof row.due_hours === "number" ? row.due_hours : 24 + index * 12;
    return {
      kind: text(row.kind, "bed_followup"),
      title,
      reason: text(row.reason, text(row.description, text(result.next_action, "Bedscanningen anbefaler en praktisk opfølgning."))),
      priority: priority(row.priority),
      due_at: dueInHours(hours),
      status: "open",
      source: "scan",
      confidence: confidence(row.confidence) ?? confidence(result.confidence),
      garden_id: gardenId,
      zone_id: zoneId ?? null,
      plant_id: plantId ?? null,
      observation_id: observationId,
      payload: {
        scan_kind: "bed_scan",
        raw_suggestion: row,
        density: result.density,
        dryness: result.dryness,
        disease_pressure: result.disease_pressure,
      },
    } satisfies Omit<CareAction, "id">;
  });

  if (actions.length > 0) return actions;

  const severity = result.severity;
  const followUp = text(result.next_action, text(result.treatment));
  if ((severity === "high" || severity === "medium") && followUp) {
    return [{
      kind: "bed_followup",
      title: severity === "high" ? "Akut opfølgning på bedscan" : "Følg op på bedscan",
      reason: followUp,
      priority: severity === "high" ? "urgent" : "high",
      due_at: dueInHours(severity === "high" ? 6 : 24),
      status: "open",
      source: "scan",
      confidence: confidence(result.confidence),
      garden_id: gardenId,
      zone_id: zoneId ?? null,
      plant_id: plantId ?? null,
      observation_id: observationId,
      payload: { scan_kind: "bed_scan", symptoms: strings(result.symptoms), causes: strings(result.causes) },
    }];
  }

  return [];
}

export function actionsFromGrowth(
  gardenId: string,
  result: Record<string, unknown>,
  observationId: string,
  zoneId?: string | null,
  plantId?: string | null,
): Omit<CareAction, "id">[] {
  const actions: Omit<CareAction, "id">[] = [];
  const flags = strings(result.anomaly_flags);
  const resultConfidence = confidence(result.confidence);
  const readiness = text(result.harvest_readiness).toLowerCase();
  const trend = text(result.trend).toLowerCase();

  if (flags.length > 0 || trend.includes("tilbage") || trend.includes("decline")) {
    actions.push({
      kind: "growth_anomaly",
      title: "Tjek vækstafvigelse",
      reason: flags.length > 0
        ? `Scanningen markerer: ${flags.join(", ")}. Sammenlign med jordfugt, lys og sygdomstegn.`
        : "Væksttrenden ser svagere ud end tidligere observationer.",
      priority: "high",
      due_at: dueInHours(24),
      status: "open",
      source: "scan",
      confidence: resultConfidence,
      garden_id: gardenId,
      zone_id: zoneId ?? null,
      plant_id: plantId ?? null,
      observation_id: observationId,
      payload: { scan_kind: "growth", anomaly_flags: flags, trend: result.trend },
    });
  }

  if (readiness.includes("klar") || readiness.includes("ready")) {
    actions.push({
      kind: "harvest_ready",
      title: "Høstklar plante registreret",
      reason: text(result.next_action, "Vækstscanningen vurderer planten som høstklar."),
      priority: "high",
      due_at: dueInHours(24),
      status: "open",
      source: "scan",
      confidence: resultConfidence,
      garden_id: gardenId,
      zone_id: zoneId ?? null,
      plant_id: plantId ?? null,
      observation_id: observationId,
      payload: { scan_kind: "growth", harvest_readiness: result.harvest_readiness },
    });
  }

  if ((result.needs_another_photo === true || (resultConfidence !== null && resultConfidence < 0.45)) && actions.length === 0) {
    actions.push({
      kind: "growth_rescan",
      title: "Tag et sammenligneligt vækstfoto",
      reason: "AI'en mangler et tydeligere eller mere gentageligt foto for at vurdere væksttrenden.",
      priority: "normal",
      due_at: dueInHours(72),
      status: "open",
      source: "scan",
      confidence: resultConfidence,
      garden_id: gardenId,
      zone_id: zoneId ?? null,
      plant_id: plantId ?? null,
      observation_id: observationId,
      payload: { scan_kind: "growth", needs_another_photo: true },
    });
  }

  return actions.slice(0, 3);
}

export function generateWeatherActions(
  gardenId: string,
  zones: ZoneLike[],
  forecasts: Forecast[],
): Omit<CareAction, "id">[] {
  const today = forecasts[0];
  if (!today) return [];
  const actions: Omit<CareAction, "id">[] = [];

  if ((today.temp_min ?? 10) <= 2) {
    actions.push({
      kind: "frost_watch",
      title: "Beskyt frostfølsomme planter i nat",
      reason: `Nattetemperaturen nærmer sig ${Math.round(today.temp_min ?? 0)} °C.`,
      priority: "high",
      due_at: dueInHours(8),
      status: "open",
      source: "weather",
      confidence: 0.8,
      garden_id: gardenId,
      payload: { temp_min: today.temp_min },
    });
  }

  const hotDays = forecasts.slice(0, 3).filter((f) => (f.temp_max ?? 0) >= 28).length;
  if (hotDays >= 2) {
    for (const zone of zones.filter((z) => z.sun_exposure === "sun").slice(0, 4)) {
      actions.push({
        kind: "heat_watch",
        title: `Tjek varme-stress i ${zone.name}`,
        reason: "Flere varme dage i træk kan give slappe blade og hurtig udtørring.",
        priority: "high",
        due_at: dueInHours(18),
        status: "open",
        source: "weather",
        confidence: 0.72,
        garden_id: gardenId,
        zone_id: zone.id,
        payload: { hot_days: hotDays },
      });
    }
  }

  if ((today.precip_mm ?? 0) >= 8) {
    actions.push({
      kind: "rain_check",
      title: "Tjek dræn og snegle efter regn",
      reason: `${today.precip_mm.toFixed(1)} mm regn kan give våd jord og sneglepres i tætte bede.`,
      priority: "normal",
      due_at: dueInHours(30),
      status: "open",
      source: "weather",
      confidence: 0.66,
      garden_id: gardenId,
      payload: { precip_mm: today.precip_mm },
    });
  }

  return actions;
}

export function generateDeviceActions(
  gardenId: string,
  devices: DeviceLike[],
): Omit<CareAction, "id">[] {
  return devices.flatMap((device) => {
    const actions: Omit<CareAction, "id">[] = [];
    if (typeof device.battery === "number" && device.battery <= 20) {
      actions.push({
        kind: "device_battery",
        title: `Skift batteri på ${device.name}`,
        reason: `Batteriet er nede på ${device.battery}%.`,
        priority: "normal",
        due_at: dueInHours(48),
        status: "open",
        source: "sensor",
        confidence: 0.95,
        garden_id: gardenId,
        zone_id: metadataZoneId(device),
        payload: { device_id: device.id, battery: device.battery },
      });
    }
    const moisture = metadataMoisture(device);
    if (device.kind === "sensor" && moisture !== null && moisture < 28) {
      actions.push({
        kind: "sensor_dry",
        title: `${device.name} melder tør jord`,
        reason: `Jordfugt er ${Math.round(moisture)}%. Bekræft med fingeren før vanding.`,
        priority: "high",
        due_at: dueInHours(4),
        status: "open",
        source: "sensor",
        confidence: 0.78,
        garden_id: gardenId,
        zone_id: metadataZoneId(device),
        payload: { device_id: device.id, moisture_pct: moisture },
      });
    }
    return actions;
  });
}
