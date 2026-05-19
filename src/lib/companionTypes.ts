import type { Json } from "@/integrations/supabase/types";

export type CompanionView =
  | "today"
  | "map"
  | "scan"
  | "plan"
  | "plants"
  | "water"
  | "journal"
  | "devices"
  | "insights";

export type ObservationKind =
  | "photo"
  | "identify"
  | "diagnosis"
  | "growth"
  | "bed_scan"
  | "harvest"
  | "watering"
  | "sensor";

export type AutomationMode = "manual" | "assisted" | "autopilot" | "device_autopilot";

export type CompanionPreferences = {
  goals: string[];
  weekly_time_budget_minutes: number;
  automation_mode: AutomationMode;
  notification_preference: "none" | "urgent" | "daily" | "all";
  watering_method: string | null;
  device_ownership: string[];
  device_autopilot_confirmed: boolean;
  onboarding_done: boolean;
};

export const DEFAULT_COMPANION_PREFERENCES: CompanionPreferences = {
  goals: [],
  weekly_time_budget_minutes: 120,
  automation_mode: "assisted",
  notification_preference: "daily",
  watering_method: null,
  device_ownership: [],
  device_autopilot_confirmed: false,
  onboarding_done: false,
};

export type MapAnchor = {
  garden_id: string;
  zone_id?: string | null;
  plant_id?: string | null;
  point?: Json;
  normalized_x?: number | null;
  normalized_y?: number | null;
  accuracy?: "manual" | "zone_center" | "map_tap" | "gps" | "unknown";
};

export type GardenObservation = {
  id: string;
  kind: ObservationKind;
  image_url?: string | null;
  anchor: MapAnchor;
  ai_result: Record<string, unknown>;
  confidence?: number | null;
  created_at: string;
};

export type CareAction = {
  id: string;
  kind: string;
  title: string;
  reason?: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  due_at?: string | null;
  status: "open" | "done" | "dismissed" | "snoozed";
  source: "manual" | "ai" | "weather" | "sensor" | "season" | "scan";
  confidence?: number | null;
  garden_id: string;
  zone_id?: string | null;
  plant_id?: string | null;
  observation_id?: string | null;
  payload?: Json;
};

export type GrowthSnapshot = {
  plant_id: string | null;
  observation_id: string | null;
  stage?: string | null;
  vigor?: string | null;
  estimated_height_cm?: number | null;
  flowering?: boolean | null;
  fruiting?: boolean | null;
  harvest_readiness?: string | null;
  anomaly_flags: string[];
};

export type HealthScore = {
  score: number;
  status: "good" | "watch" | "risk" | "critical";
  factors: string[];
  primary_risk: string | null;
  explanation: string;
};

export type GardenRoundStep = {
  zone_id: string;
  status: "pending" | "active" | "done";
  observations: string[];
  completed_task_ids: string[];
};

export type TimelineEvent = {
  id: string;
  type: "photo" | "diagnosis" | "growth" | "harvest" | "watering" | "task" | "journal" | "note";
  title: string;
  subtitle: string;
  image_url?: string | null;
  created_at: string;
  source_id: string;
  payload?: Json;
};

export type ZoneInsight = {
  title: string;
  reason: string;
  priority: "low" | "normal" | "high" | "urgent";
  action_kind: string;
  confidence: number;
  source: "weather" | "sensor" | "scan" | "season" | "task" | "growth";
};

export type ProblemResolutionState = "open" | "watching" | "improving" | "resolved";

export type NormalizedScanResult = {
  title: string;
  severity: "low" | "medium" | "high";
  confidence: number | null;
  symptoms: string[];
  causes: string[];
  treatment: string;
  prevention: string | null;
  raw: Record<string, unknown>;
};

export function clampNormalizedPoint(x: number, y: number) {
  return {
    normalized_x: Math.max(0.03, Math.min(0.97, x)),
    normalized_y: Math.max(0.03, Math.min(0.97, y)),
  };
}

export function mapAnchor(
  gardenId: string,
  zoneId?: string | null,
  plantId?: string | null,
  x = 0.5,
  y = 0.5,
  accuracy: MapAnchor["accuracy"] = "manual",
): MapAnchor {
  const point = clampNormalizedPoint(x, y);
  return {
    garden_id: gardenId,
    zone_id: zoneId ?? null,
    plant_id: plantId ?? null,
    normalized_x: point.normalized_x,
    normalized_y: point.normalized_y,
    accuracy,
  };
}

export function asNumberConfidence(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.min(1, value));
  }
  if (value === "high") return 0.86;
  if (value === "medium") return 0.62;
  if (value === "low") return 0.34;
  return null;
}

export function readCompanionPreferences(value: unknown): CompanionPreferences {
  const raw = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const automation = raw.automation_mode;
  const notifications = raw.notification_preference;
  return {
    goals: Array.isArray(raw.goals) ? raw.goals.map(String) : DEFAULT_COMPANION_PREFERENCES.goals,
    weekly_time_budget_minutes: typeof raw.weekly_time_budget_minutes === "number"
      ? Math.max(15, Math.min(720, raw.weekly_time_budget_minutes))
      : DEFAULT_COMPANION_PREFERENCES.weekly_time_budget_minutes,
    automation_mode: automation === "manual" || automation === "assisted" || automation === "autopilot" || automation === "device_autopilot"
      ? automation
      : DEFAULT_COMPANION_PREFERENCES.automation_mode,
    notification_preference: notifications === "none" || notifications === "urgent" || notifications === "daily" || notifications === "all"
      ? notifications
      : DEFAULT_COMPANION_PREFERENCES.notification_preference,
    watering_method: typeof raw.watering_method === "string" ? raw.watering_method : null,
    device_ownership: Array.isArray(raw.device_ownership) ? raw.device_ownership.map(String) : [],
    device_autopilot_confirmed: raw.device_autopilot_confirmed === true,
    onboarding_done: raw.onboarding_done === true,
  };
}

export function normalizeScanResult(raw: Record<string, unknown>): NormalizedScanResult {
  const severity = raw.severity === "high" || raw.severity === "medium" || raw.severity === "low"
    ? raw.severity
    : "low";
  return {
    title: String(raw.diagnosis || raw.name_da || raw.summary || "Observation gemt"),
    severity,
    confidence: asNumberConfidence(raw.confidence),
    symptoms: Array.isArray(raw.symptoms) ? raw.symptoms.map(String) : [],
    causes: Array.isArray(raw.causes) ? raw.causes.map(String) : [],
    treatment: String(raw.treatment || raw.care_tip || raw.next_action || ""),
    prevention: raw.prevention ? String(raw.prevention) : null,
    raw,
  };
}
