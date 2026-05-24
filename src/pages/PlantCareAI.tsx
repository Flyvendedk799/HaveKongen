import { useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  CalendarPlus,
  CalendarDays,
  Camera,
  Check,
  ClipboardCheck,
  ClipboardList,
  ImagePlus,
  Leaf,
  Loader2,
  MapPinned,
  MessageCircle,
  NotebookPen,
  Plus,
  RefreshCcw,
  Ruler,
  Search,
  Send,
  Share2,
  Sparkles,
  Sprout,
  Stethoscope,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { AppNav, SiteFooter } from "@/components/layout/SiteChrome";
import DiagnosisCard, { type Diagnosis } from "@/components/plantcare/DiagnosisCard";
import { supabase } from "@/integrations/supabase/client";
import type { Json, Tables } from "@/integrations/supabase/types";
import { useActiveGarden } from "@/lib/activeGarden";
import { useAuth } from "@/lib/auth";
import { actionFromScan, actionsFromGrowth } from "@/lib/companionActions";
import { asNumberConfidence, mapAnchor, normalizeScanResult, type CareAction } from "@/lib/companionTypes";
import { fileToDataUrl, uploadPlantPhoto } from "@/lib/plantPhotos";
import "@/styles/plant-care-ai.css";

type ContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
type Msg = { role: "user" | "assistant"; content: string | ContentPart[]; diagnosis?: Diagnosis; scan?: ScanBundle | null };
type Conv = { id: string; title: string; updated_at: string };

type Garden = Pick<Tables<"gardens">, "id" | "name" | "address" | "area_m2" | "thumbnail_url" | "latitude" | "longitude">;
type Zone = Pick<Tables<"garden_zones">, "id" | "garden_id" | "name" | "type" | "area_m2" | "sun_exposure" | "soil">;
type Plant = Tables<"user_plants"> & {
  plants_catalog?: { name_da: string | null; water_need: string | null; image_url: string | null } | null;
};
type Task = Pick<Tables<"task_log">, "id" | "title" | "kind" | "due_at" | "done" | "priority" | "reason" | "source" | "zone_id" | "plant_id" | "observation_id">;
type Observation = Pick<Tables<"garden_observations">, "id" | "kind" | "image_url" | "caption" | "confidence" | "created_at" | "zone_id" | "plant_id" | "ai_result" | "anchor">;
type HealthLog = Pick<Tables<"plant_health_log">, "id" | "diagnosis" | "severity" | "confidence" | "created_at" | "symptoms" | "treatment" | "prevention" | "zone_id" | "plant_id" | "observation_id">;
type DeviceReading = Pick<Tables<"device_readings">, "id" | "kind" | "value" | "unit" | "observed_at" | "zone_id" | "device_id" | "data">;

type CareMode = "coach" | "diagnose" | "identify" | "growth" | "season";

type IdentifyResult = {
  name_da?: string;
  latin?: string;
  category?: string;
  confidence?: "high" | "medium" | "low" | number;
  candidate_slugs?: string[];
  care_tip?: string;
  water_need?: "low" | "medium" | "high";
  sun?: "sun" | "part" | "shade";
  suggested_zone_fit?: string;
};

type GrowthResult = Record<string, unknown>;

type ScanBundle = {
  mode: CareMode;
  gardenId: string | null;
  zoneId: string | null;
  plantId: string | null;
  observationId: string | null;
  imageUrl: string | null;
  diagnosis?: Diagnosis | null;
  identify?: IdentifyResult | null;
  growth?: GrowthResult | null;
  taskId?: string | null;
  plantCreatedId?: string | null;
};

type CarePlanItem = {
  title: string;
  reason: string;
  kind: string;
  priority: "low" | "normal" | "high" | "urgent";
  dueDays: number;
};

type ContextFact = {
  label: string;
  value: string;
  hint: string;
  tone?: "ok" | "warn" | "risk";
};

const CARE_MODES: { key: CareMode; label: string; hint: string; icon: LucideIcon }[] = [
  { key: "coach", label: "Spørg", hint: "Råd med havekontekst", icon: Bot },
  { key: "diagnose", label: "Sygdom", hint: "Foto, symptomer og behandling", icon: Stethoscope },
  { key: "identify", label: "Identificér", hint: "Find planten og gem den", icon: Search },
  { key: "growth", label: "Vækst", hint: "Sammenlign udvikling", icon: Activity },
  { key: "season", label: "Sæson", hint: "Denne uge og måned", icon: CalendarDays },
];

const STARTERS: Record<CareMode, string[]> = {
  coach: [
    "Hvad bør jeg gøre i haven de næste 30 minutter?",
    "Hvilke planter skal jeg holde ekstra øje med lige nu?",
    "Lav en enkel plejeplan for weekenden.",
  ],
  diagnose: [
    "Bladene gulner og får brune kanter. Hvad gør jeg?",
    "Er dette svamp, skadedyr eller næringsmangel?",
    "Lav en behandlingsplan med opfølgning om tre dage.",
  ],
  identify: [
    "Identificér planten og foreslå hvor den passer i haven.",
    "Hvad er dette, og hvordan passer jeg den?",
    "Tilføj denne plante som observation og foreslå pleje.",
  ],
  growth: [
    "Sammenlign væksten med tidligere billeder og fortæl om den trives.",
    "Er planten tæt på blomstring eller høst?",
    "Hvilken opfølgning skal jeg tage efter dette vækstfoto?",
  ],
  season: [
    "Hvad skal jeg så, beskære og gøde i denne måned?",
    "Hvilke sæsonopgaver mangler jeg i mine bede?",
    "Lav en prioriteret ugeplan ud fra mine planter og åbne opgaver.",
  ],
};

function plantLabel(plant: Plant | null | undefined) {
  if (!plant) return "Ingen plante valgt";
  return plant.custom_name || plant.plants_catalog?.name_da || plant.plant_slug || "Plante";
}

function zoneLabel(zone: Zone | null | undefined) {
  return zone?.name ?? "Hele haven";
}

function modeLabel(mode: CareMode) {
  return CARE_MODES.find((item) => item.key === mode)?.label ?? "AI";
}

function messageText(content: Msg["content"]) {
  if (typeof content === "string") return content;
  const part = content.find((item) => item.type === "text");
  return part && "text" in part ? part.text : "";
}

function messageImage(content: Msg["content"]) {
  if (typeof content === "string") return null;
  const part = content.find((item) => item.type === "image_url");
  return part && "image_url" in part ? part.image_url.url : null;
}

function serializeMessages(messages: Msg[]) {
  return messages.map((message) => ({ role: message.role, content: message.content }));
}

function defaultPromptForMode(mode: CareMode) {
  if (mode === "diagnose") return "Analyser billedet og lav en konkret behandlingsplan.";
  if (mode === "identify") return "Identificér planten, foreslå pleje og hvor den passer i haven.";
  if (mode === "growth") return "Vurder vækststatus og hvad jeg skal følge op på.";
  if (mode === "season") return "Lav en konkret sæsonplan baseret på min have.";
  return "Giv mig konkret plantepleje med udgangspunkt i min have.";
}

function formatDate(value?: string | null) {
  if (!value) return "Ingen dato";
  return new Date(value).toLocaleDateString("da-DK", { day: "numeric", month: "short" });
}

function compactTitle(text: string, fallback = "AI-råd fra plantepleje") {
  const cleaned = text
    .replace(/[#*_`>-]/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  if (!cleaned) return fallback;
  return cleaned.length > 68 ? `${cleaned.slice(0, 65)}...` : cleaned;
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

function scanKind(mode: CareMode) {
  if (mode === "identify") return "identify";
  if (mode === "growth") return "growth";
  return "diagnosis";
}

function scanConfidence(scan: ScanBundle | null) {
  if (!scan) return null;
  return asNumberConfidence(scan.diagnosis?.confidence ?? scan.identify?.confidence ?? scan.growth?.confidence);
}

function scanSummary(scan: ScanBundle | null) {
  if (!scan) return "Ingen scan gemt endnu";
  if (scan.diagnosis?.diagnosis) return scan.diagnosis.diagnosis;
  if (scan.identify?.name_da) return scan.identify.name_da;
  if (typeof scan.growth?.summary === "string") return scan.growth.summary;
  return "Observation gemt";
}

function fallbackAssistant(scan: ScanBundle | null, mode: CareMode) {
  if (!scan) return "AI-tjenesten svarede ikke lige nu, men du kan stadig gemme en opgave eller journalnote manuelt.";
  if (scan.diagnosis) {
    const d = scan.diagnosis;
    return [
      `Jeg har gemt diagnosen **${d.diagnosis ?? "planteproblem"}** i Havekompagnon.`,
      d.treatment ? `**Næste skridt:** ${d.treatment}` : "Opret gerne en opfølgningsopgave og tag et nyt foto om få dage.",
      d.prevention ? `**Forebyg:** ${d.prevention}` : "",
    ].filter(Boolean).join("\n\n");
  }
  if (scan.identify) {
    return `Jeg har gemt identifikationen **${scan.identify.name_da ?? "ukendt plante"}** som observation. Du kan tilføje den som plante i haven fra handlingspanelet.`;
  }
  if (scan.growth) {
    return `Væksttjekket er gemt. ${String(scan.growth.next_action ?? "Tag et nyt foto fra samme vinkel om nogle dage for bedre trend.")}`;
  }
  return `Observationen er gemt. Brug handlingspanelet til at koble den videre til ${modeLabel(mode)}.`;
}

function latestAssistantContent(messages: Msg[]) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].role === "assistant") return messageText(messages[index].content);
  }
  return "";
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function addCarePlanItem(items: CarePlanItem[], item: CarePlanItem) {
  if (!item.title.trim() || items.some((existing) => normalizeKey(existing.title) === normalizeKey(item.title))) return;
  items.push({
    ...item,
    title: compactTitle(item.title, "Plantepleje-opgave"),
    reason: item.reason.trim().slice(0, 1000),
  });
}

function extractActionLines(text: string) {
  return text
    .split("\n")
    .map((line) => line.replace(/^[-*•\d.()\s]+/, "").trim())
    .filter((line) => line.length >= 18)
    .filter((line) => /(skal|bør|vand|beskær|gød|fjern|tjek|tag|så|plant|dæk|flyt|klip|høst|følg)/i.test(line))
    .slice(0, 5);
}

function buildCarePlanItems(args: {
  scan: ScanBundle | null;
  assistantText: string;
  mode: CareMode;
  zoneName: string;
  plantName: string;
}) {
  const items: CarePlanItem[] = [];
  const { scan, assistantText, mode, zoneName, plantName } = args;

  if (scan?.diagnosis) {
    const diagnosis = scan.diagnosis.diagnosis ?? "planteproblem";
    const priority = scan.diagnosis.severity === "high" ? "urgent" : scan.diagnosis.severity === "medium" ? "high" : "normal";
    if (scan.diagnosis.treatment) {
      addCarePlanItem(items, {
        kind: "diagnose",
        title: `Behandl: ${diagnosis}`,
        reason: scan.diagnosis.treatment,
        priority,
        dueDays: scan.diagnosis.severity === "high" ? 0 : 1,
      });
    }
    addCarePlanItem(items, {
      kind: "issue_resolution",
      title: `Tag kontrolfoto: ${diagnosis}`,
      reason: `Følg op på ${plantName} i ${zoneName}, og vurder om symptomerne er bedre.`,
      priority: scan.diagnosis.severity === "high" ? "high" : "normal",
      dueDays: 3,
    });
    if (scan.diagnosis.prevention) {
      addCarePlanItem(items, {
        kind: "prevention",
        title: `Forebyg gentagelse: ${diagnosis}`,
        reason: scan.diagnosis.prevention,
        priority: "normal",
        dueDays: 7,
      });
    }
  }

  if (scan?.identify) {
    const name = scan.identify.name_da ?? plantName;
    addCarePlanItem(items, {
      kind: "plant_setup",
      title: `Placér og plej: ${name}`,
      reason: scan.identify.care_tip ?? `Tjek lys, jord og vandbehov for ${name} i ${zoneName}.`,
      priority: "normal",
      dueDays: 1,
    });
    if (scan.identify.suggested_zone_fit) {
      addCarePlanItem(items, {
        kind: "zone_fit",
        title: `Tjek placering for ${name}`,
        reason: scan.identify.suggested_zone_fit,
        priority: "normal",
        dueDays: 2,
      });
    }
  }

  if (scan?.growth) {
    const readiness = String(scan.growth.harvest_readiness ?? "").toLowerCase();
    if (readiness.includes("klar") || readiness.includes("ready")) {
      addCarePlanItem(items, {
        kind: "harvest_ready",
        title: `Høstklar: ${plantName}`,
        reason: String(scan.growth.next_action ?? "Væksttjekket vurderer planten som klar til høst."),
        priority: "high",
        dueDays: 1,
      });
    }
    addCarePlanItem(items, {
      kind: "growth_rescan",
      title: `Gentag vækstfoto: ${plantName}`,
      reason: String(scan.growth.next_action ?? "Tag et nyt foto fra samme vinkel for at forbedre væksttrenden."),
      priority: "normal",
      dueDays: 5,
    });
  }

  for (const line of extractActionLines(assistantText)) {
    addCarePlanItem(items, {
      kind: mode === "season" ? "season" : "ai_advice",
      title: compactTitle(line, "Plantepleje-opgave"),
      reason: line,
      priority: mode === "diagnose" ? "high" : "normal",
      dueDays: items.length === 0 ? 1 : Math.min(7, items.length + 1),
    });
  }

  return items.slice(0, 6);
}

function dueDateFromDays(days: number) {
  return new Date(Date.now() + days * 86400_000).toISOString();
}

function escapeIcs(value: string) {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function icsDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return icsDate(new Date().toISOString());
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

export default function PlantCareAI() {
  const { user, session, loading: authLoading } = useAuth();
  const { activeGardenId, setActive } = useActiveGarden();
  const navigate = useNavigate();

  const [conversations, setConversations] = useState<Conv[]>([]);
  const [activeConv, setActiveConv] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [pendingImage, setPendingImage] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [careMode, setCareMode] = useState<CareMode>("coach");
  const [gardens, setGardens] = useState<Garden[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  const [plants, setPlants] = useState<Plant[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [healthLogs, setHealthLogs] = useState<HealthLog[]>([]);
  const [deviceReadings, setDeviceReadings] = useState<DeviceReading[]>([]);
  const [selectedGardenId, setSelectedGardenId] = useState<string | null>(activeGardenId);
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(null);
  const [selectedPlantId, setSelectedPlantId] = useState<string | null>(null);
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [lastScan, setLastScan] = useState<ScanBundle | null>(null);
  const [lastAssistantText, setLastAssistantText] = useState("");
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const cameraInputRef = useRef<HTMLInputElement>(null);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const selectedGarden = useMemo(
    () => gardens.find((garden) => garden.id === selectedGardenId) ?? null,
    [gardens, selectedGardenId],
  );
  const selectedZone = useMemo(
    () => zones.find((zone) => zone.id === selectedZoneId) ?? null,
    [zones, selectedZoneId],
  );
  const visiblePlants = useMemo(
    () => plants.filter((plant) => !selectedZoneId || plant.zone_id === selectedZoneId),
    [plants, selectedZoneId],
  );
  const selectedPlant = useMemo(
    () => plants.find((plant) => plant.id === selectedPlantId) ?? null,
    [plants, selectedPlantId],
  );
  const openTasks = useMemo(() => tasks.filter((task) => !task.done), [tasks]);
  const urgentIssues = useMemo(
    () => healthLogs.filter((log) => log.severity === "high" || log.severity === "medium").slice(0, 4),
    [healthLogs],
  );
  const latestPhotos = useMemo(
    () => observations.filter((observation) => observation.image_url).slice(0, 4),
    [observations],
  );
  const selectedOpenTasks = useMemo(() => openTasks.filter((task) => {
    if (selectedPlantId) return task.plant_id === selectedPlantId;
    if (selectedZoneId) return task.zone_id === selectedZoneId;
    return true;
  }), [openTasks, selectedPlantId, selectedZoneId]);
  const selectedObservations = useMemo(() => observations.filter((observation) => {
    if (selectedPlantId) return observation.plant_id === selectedPlantId;
    if (selectedZoneId) return observation.zone_id === selectedZoneId;
    return true;
  }), [observations, selectedPlantId, selectedZoneId]);
  const selectedIssue = useMemo(() => healthLogs.find((log) => {
    if (selectedPlantId) return log.plant_id === selectedPlantId;
    if (selectedZoneId) return log.zone_id === selectedZoneId;
    return log.severity === "high" || log.severity === "medium";
  }) ?? null, [healthLogs, selectedPlantId, selectedZoneId]);
  const latestReading = useMemo(() => deviceReadings.find((reading) => {
    if (!selectedZoneId) return true;
    return reading.zone_id === selectedZoneId;
  }) ?? null, [deviceReadings, selectedZoneId]);
  const contextFacts = useMemo<ContextFact[]>(() => {
    const facts: ContextFact[] = [];
    facts.push({
      label: "Valgt område",
      value: selectedPlant ? plantLabel(selectedPlant) : zoneLabel(selectedZone),
      hint: selectedPlant ? `I ${zoneLabel(zones.find((zone) => zone.id === selectedPlant.zone_id))}` : `${selectedObservations.length} observationer matcher`,
      tone: selectedIssue ? "warn" : "ok",
    });
    facts.push({
      label: "Plejestatus",
      value: selectedIssue?.diagnosis ?? selectedPlant?.health_status ?? (urgentIssues.length ? `${urgentIssues.length} risici` : "Stabil"),
      hint: selectedIssue?.treatment ?? `${selectedOpenTasks.length} åbne opgaver i fokus`,
      tone: selectedIssue?.severity === "high" ? "risk" : selectedIssue ? "warn" : "ok",
    });
    if (selectedZone) {
      facts.push({
        label: "Bedmiljø",
        value: [selectedZone.sun_exposure || "lys ukendt", selectedZone.soil || "jord ukendt"].join(" · "),
        hint: selectedZone.area_m2 ? `${Math.round(selectedZone.area_m2)} m2 registreret` : "Bruges aktivt i AI-rådet",
      });
    }
    if (latestReading) {
      facts.push({
        label: "Seneste måling",
        value: `${latestReading.kind}${latestReading.value !== null ? ` ${Math.round(latestReading.value)}${latestReading.unit ?? ""}` : ""}`,
        hint: `Målt ${formatDate(latestReading.observed_at)}`,
        tone: latestReading.kind.includes("moisture") && typeof latestReading.value === "number" && latestReading.value < 28 ? "warn" : "ok",
      });
    }
    return facts.slice(0, 4);
  }, [latestReading, selectedIssue, selectedObservations.length, selectedOpenTasks.length, selectedPlant, selectedZone, urgentIssues.length, zones]);
  const carePlanPreview = useMemo(() => buildCarePlanItems({
    scan: lastScan,
    assistantText: lastAssistantText || latestAssistantContent(messages),
    mode: careMode,
    zoneName: zoneLabel(selectedZone),
    plantName: plantLabel(selectedPlant),
  }).slice(0, 4), [careMode, lastAssistantText, lastScan, messages, selectedPlant, selectedZone]);
  const starters = STARTERS[careMode];
  const contextSnapshot = useMemo(() => ({
    garden: selectedGarden ? {
      id: selectedGarden.id,
      name: selectedGarden.name,
      address: selectedGarden.address,
      area_m2: selectedGarden.area_m2,
    } : null,
    selected_zone: selectedZone ? {
      id: selectedZone.id,
      name: selectedZone.name,
      type: selectedZone.type,
      sun: selectedZone.sun_exposure,
      soil: selectedZone.soil,
    } : null,
    selected_plant: selectedPlant ? {
      id: selectedPlant.id,
      name: plantLabel(selectedPlant),
      health_status: selectedPlant.health_status,
      lifecycle_status: selectedPlant.lifecycle_status,
      last_observed_at: selectedPlant.last_observed_at,
    } : null,
    counts: {
      zones: zones.length,
      plants: plants.length,
      open_tasks: openTasks.length,
      recent_issues: urgentIssues.length,
      device_readings: deviceReadings.length,
    },
    recent_tasks: openTasks.slice(0, 6).map((task) => ({
      title: task.title,
      kind: task.kind,
      due_at: task.due_at,
      priority: task.priority,
      zone_id: task.zone_id,
      plant_id: task.plant_id,
    })),
    recent_issues: urgentIssues.map((issue) => ({
      diagnosis: issue.diagnosis,
      severity: issue.severity,
      confidence: issue.confidence,
      symptoms: issue.symptoms,
      zone_id: issue.zone_id,
      plant_id: issue.plant_id,
    })),
    recent_observations: observations.slice(0, 8).map((observation) => ({
      kind: observation.kind,
      caption: observation.caption,
      confidence: observation.confidence,
      created_at: observation.created_at,
      zone_id: observation.zone_id,
      plant_id: observation.plant_id,
    })),
    device_readings: deviceReadings.slice(0, 8).map((reading) => ({
      kind: reading.kind,
      value: reading.value,
      unit: reading.unit,
      observed_at: reading.observed_at,
      zone_id: reading.zone_id,
    })),
  }), [selectedGarden, selectedZone, selectedPlant, zones.length, plants.length, openTasks, urgentIssues, observations, deviceReadings]);

  useEffect(() => {
    if (user) {
      void loadWorkspace(activeGardenId);
      void loadConversations();
    }
  }, [user?.id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, streaming]);

  useEffect(() => {
    if (selectedPlantId && !visiblePlants.some((plant) => plant.id === selectedPlantId)) {
      setSelectedPlantId(null);
    }
  }, [selectedPlantId, visiblePlants]);

  async function loadWorkspace(preferredGardenId?: string | null) {
    if (!user) return;
    setWorkspaceLoading(true);
    try {
      const { data: gardenRows, error } = await supabase
        .from("gardens")
        .select("id,name,address,area_m2,thumbnail_url,latitude,longitude")
        .eq("user_id", user.id)
        .order("updated_at", { ascending: false });
      if (error) throw error;

      const nextGardens = (gardenRows ?? []) as Garden[];
      setGardens(nextGardens);
      const nextGardenId =
        nextGardens.find((garden) => garden.id === preferredGardenId)?.id ??
        nextGardens.find((garden) => garden.id === activeGardenId)?.id ??
        nextGardens[0]?.id ??
        null;
      setSelectedGardenId(nextGardenId);
      if (nextGardenId) {
        setActive(nextGardenId);
        await loadGardenDetails(nextGardenId);
      } else {
        setZones([]);
        setPlants([]);
        setTasks([]);
        setObservations([]);
        setHealthLogs([]);
        setDeviceReadings([]);
      }
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Kunne ikke hente haven");
    } finally {
      setWorkspaceLoading(false);
    }
  }

  async function loadGardenDetails(gardenId: string) {
    if (!user) return;
    const [
      { data: zoneRows },
      { data: plantRows },
      { data: taskRows },
      { data: observationRows },
      { data: healthRows },
      { data: deviceRows },
    ] = await Promise.all([
      supabase
        .from("garden_zones")
        .select("id,garden_id,name,type,area_m2,sun_exposure,soil")
        .eq("garden_id", gardenId)
        .order("name"),
      supabase
        .from("user_plants")
        .select("*,plants_catalog(name_da,water_need,image_url)")
        .eq("garden_id", gardenId)
        .order("last_observed_at", { ascending: false, nullsFirst: false }),
      supabase
        .from("task_log")
        .select("id,title,kind,due_at,done,priority,reason,source,zone_id,plant_id,observation_id")
        .eq("garden_id", gardenId)
        .order("due_at", { ascending: true, nullsFirst: false })
        .limit(80),
      supabase
        .from("garden_observations")
        .select("id,kind,image_url,caption,confidence,created_at,zone_id,plant_id,ai_result,anchor")
        .eq("garden_id", gardenId)
        .order("created_at", { ascending: false })
        .limit(80),
      supabase
        .from("plant_health_log")
        .select("id,diagnosis,severity,confidence,created_at,symptoms,treatment,prevention,zone_id,plant_id,observation_id")
        .eq("garden_id", gardenId)
        .order("created_at", { ascending: false })
        .limit(60),
      supabase
        .from("device_readings")
        .select("id,kind,value,unit,observed_at,zone_id,device_id,data")
        .eq("garden_id", gardenId)
        .order("observed_at", { ascending: false })
        .limit(30),
    ]);

    const nextZones = (zoneRows ?? []) as Zone[];
    const nextPlants = (plantRows ?? []) as Plant[];
    setZones(nextZones);
    setPlants(nextPlants);
    setTasks((taskRows ?? []) as Task[]);
    setObservations((observationRows ?? []) as Observation[]);
    setHealthLogs((healthRows ?? []) as HealthLog[]);
    setDeviceReadings((deviceRows ?? []) as DeviceReading[]);

    setSelectedZoneId((current) => current && nextZones.some((zone) => zone.id === current) ? current : null);
    setSelectedPlantId((current) => current && nextPlants.some((plant) => plant.id === current) ? current : null);
  }

  async function loadConversations() {
    const { data } = await supabase
      .from("chat_conversations")
      .select("id, title, updated_at")
      .order("updated_at", { ascending: false });
    setConversations(data ?? []);
  }

  async function loadMessages(convId: string) {
    setActiveConv(convId);
    setLastScan(null);
    setLastAssistantText("");
    const { data } = await supabase
      .from("chat_messages")
      .select("role, content")
      .eq("conversation_id", convId)
      .order("created_at");
    setMessages((data ?? []) as Msg[]);
  }

  function newConversation() {
    setActiveConv(null);
    setMessages([]);
    setLastScan(null);
    setLastAssistantText("");
  }

  async function handleGardenChange(gardenId: string) {
    setSelectedGardenId(gardenId);
    setSelectedZoneId(null);
    setSelectedPlantId(null);
    setActive(gardenId);
    setWorkspaceLoading(true);
    try {
      await loadGardenDetails(gardenId);
    } finally {
      setWorkspaceLoading(false);
    }
  }

  async function onPickImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      toast.error("Billedet er for stort. Maksimum er 8 MB.");
      event.target.value = "";
      return;
    }
    try {
      setPendingFile(file);
      setPendingImage(await fileToDataUrl(file));
      if (careMode === "coach" || careMode === "season") setCareMode("diagnose");
    } catch {
      toast.error("Kunne ikke læse billedet");
    } finally {
      event.target.value = "";
    }
  }

  async function analyzeAndPersistImage(imageDataUrl: string, file: File | null, note: string, mode: CareMode): Promise<ScanBundle> {
    const effectiveMode = mode === "identify" || mode === "growth" || mode === "diagnose" ? mode : "diagnose";
    let imageUrl: string | null = null;
    let observationId: string | null = null;
    const garden = selectedGarden;
    const zone = selectedZone;
    const plant = selectedPlant;

    if (file) {
      try {
        imageUrl = await uploadPlantPhoto(user!.id, file);
      } catch (error: unknown) {
        toast.error(error instanceof Error ? error.message : "Billedet blev analyseret, men kunne ikke gemmes");
      }
    }

    const anchor = garden
      ? mapAnchor(garden.id, zone?.id ?? null, plant?.id ?? null, 0.5, 0.5, zone ? "zone_center" : "unknown")
      : null;

    if (garden) {
      const { data, error } = await supabase
        .from("garden_observations")
        .insert({
          user_id: user!.id,
          garden_id: garden.id,
          zone_id: zone?.id ?? null,
          plant_id: plant?.id ?? null,
          kind: scanKind(effectiveMode),
          image_url: imageUrl,
          anchor: (anchor ?? {}) as Json,
          ai_result: { status: "analyzing", mode: effectiveMode, note } as Json,
          caption: note || defaultPromptForMode(effectiveMode),
        })
        .select("id")
        .single();
      if (error) throw error;
      observationId = data.id;
    }

    const context = {
      garden_id: garden?.id ?? null,
      garden_name: garden?.name ?? null,
      zone_id: zone?.id ?? null,
      zone_name: zone?.name ?? null,
      plant_id: plant?.id ?? null,
      plant_name: plantLabel(plant),
      observation_id: observationId,
      image_url: imageUrl,
      selected_context: contextSnapshot,
    };

    const scan: ScanBundle = {
      mode: effectiveMode,
      gardenId: garden?.id ?? null,
      zoneId: zone?.id ?? null,
      plantId: plant?.id ?? null,
      observationId,
      imageUrl,
    };

    if (effectiveMode === "identify") {
      const { data: catalog } = await supabase.from("plants_catalog").select("slug,name_da,latin").limit(300);
      const { data, error } = await supabase.functions.invoke("identify-plant", {
        body: { image: imageDataUrl, catalog: catalog ?? [], context },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      scan.identify = data as IdentifyResult;
      if (observationId) {
        await supabase
          .from("garden_observations")
          .update({
            ai_result: scan.identify as Json,
            confidence: asNumberConfidence(scan.identify?.confidence),
            caption: scan.identify?.name_da ?? note ?? "Identificeret plante",
          })
          .eq("id", observationId);
      }
      return scan;
    }

    if (effectiveMode === "growth") {
      const previous = observations
        .filter((observation) =>
          observation.kind === "growth" &&
          (plant ? observation.plant_id === plant.id : zone ? observation.zone_id === zone.id : true)
        )
        .slice(0, 6)
        .map((observation) => ({
          created_at: observation.created_at,
          caption: observation.caption,
          ai_result: observation.ai_result,
        }));
      const { data, error } = await supabase.functions.invoke("analyze-growth", {
        body: { imageDataUrl, note, context: { ...context, previous } },
      });
      if (error) throw error;
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      scan.growth = (data ?? {}) as GrowthResult;
      if (observationId) {
        await supabase
          .from("garden_observations")
          .update({
            ai_result: scan.growth as Json,
            confidence: asNumberConfidence(scan.growth.confidence),
            caption: String(scan.growth.summary || note || "Væksttjek"),
          })
          .eq("id", observationId);
      }
      if (garden) {
        await supabase.from("plant_growth_snapshots").insert({
          user_id: user!.id,
          garden_id: garden.id,
          zone_id: zone?.id ?? null,
          plant_id: plant?.id ?? null,
          observation_id: observationId,
          stage: scan.growth.stage ? String(scan.growth.stage) : null,
          vigor: scan.growth.vigor ? String(scan.growth.vigor) : null,
          estimated_height_cm: typeof scan.growth.estimated_height_cm === "number" ? scan.growth.estimated_height_cm : null,
          flowering: typeof scan.growth.flowering === "boolean" ? scan.growth.flowering : null,
          fruiting: typeof scan.growth.fruiting === "boolean" ? scan.growth.fruiting : null,
          harvest_readiness: scan.growth.harvest_readiness ? String(scan.growth.harvest_readiness) : null,
          anomaly_flags: Array.isArray(scan.growth.anomaly_flags) ? scan.growth.anomaly_flags.map(String) : [],
          ai_result: scan.growth as Json,
        });
        if (plant) {
          await supabase.from("user_plants").update({
            lifecycle_status: scan.growth.stage ? String(scan.growth.stage) : "observed",
            last_observed_at: new Date().toISOString(),
          }).eq("id", plant.id);
        }
        if (observationId) {
          const growthActions = actionsFromGrowth(garden.id, scan.growth, observationId, zone?.id ?? null, plant?.id ?? null);
          if (growthActions.length > 0) {
            const { data: insertedTasks } = await supabase
              .from("task_log")
              .insert(taskRowsFromActions(user!.id, growthActions))
              .select("id");
            scan.taskId = insertedTasks?.[0]?.id ?? null;
          }
        }
      }
      return scan;
    }

    const { data, error } = await supabase.functions.invoke("plant-diagnose", {
      body: { imageDataUrl, note, context },
    });
    if (error) throw error;
    if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
    scan.diagnosis = data as Diagnosis;
    if (observationId) {
      await supabase
        .from("garden_observations")
        .update({
          ai_result: scan.diagnosis as Json,
          confidence: asNumberConfidence(scan.diagnosis.confidence),
          caption: scan.diagnosis.diagnosis ?? note ?? "Plantesygdom analyseret",
        })
        .eq("id", observationId);
    }
    if (garden && observationId && scan.diagnosis) {
      const normalized = normalizeScanResult(scan.diagnosis as Record<string, unknown>);
      if (plant) {
        await supabase.from("user_plants").update({
          health_status: normalized.severity === "low" ? "ok" : "watch",
          last_observed_at: new Date().toISOString(),
        }).eq("id", plant.id);
      }
      const task = actionFromScan(garden.id, normalized, observationId, zone?.id ?? null, plant?.id ?? null);
      if (task) {
        const { data: insertedTask } = await supabase
          .from("task_log")
          .insert(taskRowsFromActions(user!.id, [task])[0])
          .select("id")
          .single();
        scan.taskId = insertedTask?.id ?? null;
      }
    }
    return scan;
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if ((!trimmed && !pendingImage) || streaming || !user) return;
    const prompt = trimmed || defaultPromptForMode(careMode);
    setInput("");
    const imageDataUrl = pendingImage;
    const imageFile = pendingFile;
    setPendingImage(null);
    setPendingFile(null);

    const content: string | ContentPart[] = imageDataUrl
      ? [
          { type: "text", text: prompt },
          { type: "image_url", image_url: { url: imageDataUrl } },
        ]
      : prompt;

    const userMsg: Msg = { role: "user", content };
    const history = [...messages, userMsg];
    setMessages(history);
    setStreaming(true);

    let convId = activeConv;
    let scan: ScanBundle | null = null;

    try {
      if (!convId) {
        const { data, error } = await supabase
          .from("chat_conversations")
          .insert({ user_id: user.id, title: compactTitle(prompt, imageDataUrl ? "Plantefoto" : "Plantepleje") })
          .select("id")
          .single();
        if (error) throw error;
        convId = data.id;
        setActiveConv(convId);
      }

      await supabase.from("chat_messages").insert({
        conversation_id: convId,
        user_id: user.id,
        role: "user",
        content: imageDataUrl ? `[Foto: ${modeLabel(careMode)}] ${prompt}` : prompt,
      });

      if (imageDataUrl) {
        scan = await analyzeAndPersistImage(imageDataUrl, imageFile, prompt, careMode);
        setLastScan(scan);
        if (selectedGardenId) await loadGardenDetails(selectedGardenId);
      }

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/plant-care-chat`;
      const accessToken = session?.access_token ?? import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          messages: serializeMessages(history),
          hasImage: !!imageDataUrl,
          mode: careMode,
          diagnosis: scan?.diagnosis ?? null,
          identify: scan?.identify ?? null,
          growth: scan?.growth ?? null,
          uiContext: contextSnapshot,
        }),
      });

      if (!resp.ok || !resp.body) {
        if (resp.status === 429) toast.error("For mange beskeder. Prøv igen om lidt.");
        else if (resp.status === 402) toast.error("AI-kreditter er opbrugt.");
        else toast.error("AI-tjenesten svarer ikke. Jeg gemte det lokale resultat.");
        const fallback = fallbackAssistant(scan, careMode);
        setMessages((prev) => [...prev, { role: "assistant", content: fallback, diagnosis: scan?.diagnosis ?? undefined, scan }]);
        setLastAssistantText(fallback);
        if (convId) {
          await supabase.from("chat_messages").insert({
            conversation_id: convId,
            user_id: user.id,
            role: "assistant",
            content: fallback,
          });
        }
        return;
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let assistantText = "";
      let done = false;

      setMessages((prev) => [...prev, { role: "assistant", content: "", diagnosis: scan?.diagnosis ?? undefined, scan }]);

      while (!done) {
        const { done: streamDone, value } = await reader.read();
        if (streamDone) break;
        buffer += decoder.decode(value, { stream: true });

        let nl: number;
        while ((nl = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, nl);
          buffer = buffer.slice(nl + 1);
          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (!line.startsWith("data: ")) continue;
          const json = line.slice(6).trim();
          if (json === "[DONE]") {
            done = true;
            break;
          }
          try {
            const parsed = JSON.parse(json);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              assistantText += delta;
              setMessages((prev) => prev.map((message, index) =>
                index === prev.length - 1 ? { ...message, content: assistantText } : message
              ));
            }
          } catch {
            buffer = `${line}\n${buffer}`;
            break;
          }
        }
      }

      if (assistantText && convId) {
        setLastAssistantText(assistantText);
        await supabase.from("chat_messages").insert({
          conversation_id: convId,
          user_id: user.id,
          role: "assistant",
          content: assistantText,
        });
        await supabase
          .from("chat_conversations")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", convId);
        void loadConversations();
      }
    } catch (error: unknown) {
      console.error(error);
      toast.error(error instanceof Error ? error.message : "Noget gik galt");
    } finally {
      setStreaming(false);
    }
  }

  async function deleteConv(id: string) {
    await supabase.from("chat_messages").delete().eq("conversation_id", id);
    await supabase.from("chat_conversations").delete().eq("id", id);
    if (activeConv === id) newConversation();
    void loadConversations();
  }

  async function addIdentifiedPlant(scan = lastScan) {
    if (!user || !scan?.identify) return;
    const gardenId = scan.gardenId ?? selectedGardenId;
    if (!gardenId) {
      toast.error("Opret en have først");
      return;
    }
    setActionBusy("add-plant");
    try {
      const candidateSlug = scan.identify.candidate_slugs?.[0] ?? null;
      const anchor = mapAnchor(gardenId, scan.zoneId, null, 0.5, 0.5, scan.zoneId ? "zone_center" : "unknown");
      const { data, error } = await supabase
        .from("user_plants")
        .insert({
          user_id: user.id,
          garden_id: gardenId,
          zone_id: scan.zoneId,
          plant_slug: candidateSlug,
          custom_name: candidateSlug ? null : scan.identify.name_da ?? "Ny plante",
          qty: 1,
          image_url: scan.imageUrl,
          notes: scan.identify.care_tip ?? scan.identify.suggested_zone_fit ?? null,
          map_position: anchor as Json,
          lifecycle_status: "observed",
          health_status: "unknown",
          last_observed_at: new Date().toISOString(),
        })
        .select("id")
        .single();
      if (error) throw error;
      if (scan.observationId) {
        await supabase
          .from("garden_observations")
          .update({ plant_id: data.id, anchor: mapAnchor(gardenId, scan.zoneId, data.id, 0.5, 0.5, scan.zoneId ? "zone_center" : "unknown") as Json })
          .eq("id", scan.observationId);
      }
      setLastScan({ ...scan, plantCreatedId: data.id });
      await loadGardenDetails(gardenId);
      toast.success("Planten er tilføjet til haven");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Kunne ikke tilføje planten");
    } finally {
      setActionBusy(null);
    }
  }

  async function createTaskFromAdvice(source: "assistant" | "followup" = "assistant") {
    if (!user || !selectedGardenId) {
      toast.error("Vælg en have først");
      return;
    }
    const text = source === "followup"
      ? `Følg op på ${scanSummary(lastScan)} med et nyt foto og vurder om problemet er bedre.`
      : lastAssistantText || latestAssistantContent(messages);
    if (!text.trim()) {
      toast.error("Der er ikke noget AI-råd at gemme endnu");
      return;
    }
    setActionBusy(source === "followup" ? "followup" : "task");
    try {
      const dueDays = source === "followup" ? 3 : 1;
      const { data, error } = await supabase
        .from("task_log")
        .insert({
          user_id: user.id,
          garden_id: selectedGardenId,
          zone_id: selectedZoneId,
          plant_id: selectedPlantId,
          observation_id: lastScan?.observationId ?? null,
          kind: source === "followup" ? "issue_resolution" : "ai_advice",
          title: source === "followup" ? `Følg op: ${scanSummary(lastScan)}` : compactTitle(text),
          notes: text.slice(0, 1200),
          due_at: new Date(Date.now() + dueDays * 86400_000).toISOString(),
          priority: source === "followup" || lastScan?.diagnosis?.severity === "high" ? "high" : "normal",
          source: lastScan ? "scan" : "ai",
          reason: source === "followup" ? "Plantepleje AI anbefaler at lukke løkken med et nyt tjek." : "Oprettet fra Plantepleje AI-råd.",
          confidence: scanConfidence(lastScan),
          payload: {
            mode: careMode,
            resolution_state: source === "followup" ? "watching" : undefined,
            scan_summary: scanSummary(lastScan),
          } as Json,
        })
        .select("id")
        .single();
      if (error) throw error;
      setTasks((prev) => [{
        id: data.id,
        title: source === "followup" ? `Følg op: ${scanSummary(lastScan)}` : compactTitle(text),
        kind: source === "followup" ? "issue_resolution" : "ai_advice",
        due_at: new Date(Date.now() + dueDays * 86400_000).toISOString(),
        done: false,
        priority: source === "followup" ? "high" : "normal",
        reason: null,
        source: lastScan ? "scan" : "ai",
        zone_id: selectedZoneId,
        plant_id: selectedPlantId,
        observation_id: lastScan?.observationId ?? null,
      }, ...prev]);
      toast.success(source === "followup" ? "Opfølgning er oprettet" : "Opgaven er oprettet");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Kunne ikke oprette opgave");
    } finally {
      setActionBusy(null);
    }
  }

  async function saveAdviceToJournal() {
    if (!user || !selectedGardenId) {
      toast.error("Vælg en have først");
      return;
    }
    const text = lastAssistantText || latestAssistantContent(messages);
    if (!text.trim() && !lastScan) {
      toast.error("Der er ikke noget at gemme endnu");
      return;
    }
    setActionBusy("journal");
    try {
      const { error } = await supabase.from("garden_journal").insert({
        user_id: user.id,
        garden_id: selectedGardenId,
        zone_id: selectedZoneId,
        plant_id: selectedPlantId,
        kind: lastScan?.diagnosis ? "disease" : "note",
        caption: compactTitle(text || scanSummary(lastScan), scanSummary(lastScan)),
        image_url: lastScan?.imageUrl ?? null,
        data: {
          source: "plant-care-ai",
          mode: careMode,
          assistant_text: text,
          scan: lastScan,
          observation_id: lastScan?.observationId ?? null,
        } as Json,
      });
      if (error) throw error;
      toast.success("Gemt i journalen");
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Kunne ikke gemme i journalen");
    } finally {
      setActionBusy(null);
    }
  }

  async function createCarePlanFromAdvice() {
    if (!user || !selectedGardenId) {
      toast.error("Vælg en have først");
      return;
    }
    const assistantText = lastAssistantText || latestAssistantContent(messages);
    const items = buildCarePlanItems({
      scan: lastScan,
      assistantText,
      mode: careMode,
      zoneName: zoneLabel(selectedZone),
      plantName: plantLabel(selectedPlant),
    });
    if (items.length === 0) {
      toast.error("Jeg mangler et AI-råd eller en scan at lave plan ud fra");
      return;
    }

    const existingTitles = new Set(openTasks.map((task) => normalizeKey(task.title)));
    const rows = items
      .filter((item) => !existingTitles.has(normalizeKey(item.title)))
      .map((item) => ({
        user_id: user.id,
        garden_id: selectedGardenId,
        zone_id: selectedZoneId,
        plant_id: selectedPlantId,
        observation_id: lastScan?.observationId ?? null,
        kind: item.kind,
        title: item.title,
        notes: item.reason,
        due_at: dueDateFromDays(item.dueDays),
        priority: item.priority,
        source: lastScan ? "scan" : "ai",
        reason: item.reason,
        confidence: scanConfidence(lastScan),
        payload: {
          source: "plant-care-ai-plan",
          mode: careMode,
          scan_summary: scanSummary(lastScan),
        } as Json,
      }));

    if (rows.length === 0) {
      toast.info("Handlingsplanen findes allerede i opgaverne");
      return;
    }

    setActionBusy("plan");
    try {
      const { error } = await supabase.from("task_log").insert(rows);
      if (error) throw error;
      await loadGardenDetails(selectedGardenId);
      toast.success(`${rows.length} plejehandlinger er oprettet`);
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : "Kunne ikke oprette handlingsplan");
    } finally {
      setActionBusy(null);
    }
  }

  function openCompanion(view: "today" | "map" | "scan" | "plan" | "plants" | "journal" | "devices" | "coach" = "map") {
    if (selectedGardenId) setActive(selectedGardenId);
    try {
      localStorage.setItem("companion.view", view);
      localStorage.setItem("companion.handoff", JSON.stringify({
        source: "plant-care-ai",
        gardenId: selectedGardenId,
        zoneId: selectedZoneId,
        plantId: selectedPlantId,
        view,
        scanMode: careMode === "identify" ? "identify" : careMode === "growth" ? "growth" : "diagnosis",
        createdAt: new Date().toISOString(),
      }));
    } catch {
      // localStorage can be unavailable in private browsing; navigation still works.
    }
    navigate("/havekompagnon");
  }

  function exportCareCalendar() {
    const tasksForExport = (selectedOpenTasks.length ? selectedOpenTasks : openTasks).slice(0, 12);
    const assistantText = lastAssistantText || latestAssistantContent(messages);
    const fallbackItems = tasksForExport.length === 0
      ? buildCarePlanItems({
          scan: lastScan,
          assistantText,
          mode: careMode,
          zoneName: zoneLabel(selectedZone),
          plantName: plantLabel(selectedPlant),
        })
      : [];

    const events = tasksForExport.length > 0
      ? tasksForExport.map((task) => ({
          uid: task.id,
          title: task.title,
          description: task.reason ?? `Fra Plantepleje AI · ${zoneLabel(selectedZone)} · ${plantLabel(selectedPlant)}`,
          dueAt: task.due_at ?? dueDateFromDays(1),
        }))
      : fallbackItems.map((item, index) => ({
          uid: `plant-care-ai-${Date.now()}-${index}`,
          title: item.title,
          description: item.reason,
          dueAt: dueDateFromDays(item.dueDays),
        }));

    if (events.length === 0) {
      toast.error("Der er ingen opgaver eller plan at eksportere endnu");
      return;
    }

    const body = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Havekongen//Plantepleje AI//DA",
      "CALSCALE:GREGORIAN",
      ...events.flatMap((event) => [
        "BEGIN:VEVENT",
        `UID:${escapeIcs(event.uid)}@havekongen.dk`,
        `DTSTAMP:${icsDate(new Date().toISOString())}`,
        `DTSTART:${icsDate(event.dueAt)}`,
        "DURATION:PT30M",
        `SUMMARY:${escapeIcs(event.title)}`,
        `DESCRIPTION:${escapeIcs(event.description)}`,
        "END:VEVENT",
      ]),
      "END:VCALENDAR",
    ].join("\r\n");

    const blob = new Blob([body], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `plantepleje-${new Date().toISOString().slice(0, 10)}.ics`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 500);
    toast.success("Kalenderfil klar");
  }

  async function shareCareSummary() {
    const assistantText = lastAssistantText || latestAssistantContent(messages);
    const lines = [
      `Plantepleje AI · ${selectedGarden?.name ?? "Min have"}`,
      `Fokus: ${zoneLabel(selectedZone)} · ${plantLabel(selectedPlant)}`,
      lastScan ? `Scan: ${scanSummary(lastScan)}` : null,
      assistantText ? assistantText.slice(0, 900) : null,
      selectedOpenTasks.length ? `Åbne opgaver: ${selectedOpenTasks.slice(0, 4).map((task) => task.title).join(", ")}` : null,
    ].filter(Boolean).join("\n\n");

    if (!lines.trim()) {
      toast.error("Der er ikke noget at dele endnu");
      return;
    }

    try {
      if (navigator.share) {
        await navigator.share({ title: "Plantepleje AI", text: lines });
        return;
      }
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(lines);
        toast.success("Plejerådet er kopieret");
        return;
      }
      toast.info("Deling understøttes ikke i denne browser");
    } catch (error: unknown) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      toast.error(error instanceof Error ? error.message : "Kunne ikke dele");
    }
  }

  if (authLoading) return null;

  if (!user) {
    return (
      <>
        <AppNav active="ai" />
        <main className="plant-ai-page container">
          <section className="plant-ai-auth">
            <Sparkles size={28} />
            <span className="plant-ai-eyebrow">Plantepleje AI</span>
            <h1>Log ind for at få plantepleje med din have som kontekst.</h1>
            <p>AI'en kan gemme diagnoser, opgaver og journalnoter, når den kender din have.</p>
            <Link to="/login" className="btn btn-primary">Log ind</Link>
          </section>
        </main>
        <SiteFooter />
      </>
    );
  }

  return (
    <>
      <AppNav active="ai" />
      <main className="plant-ai-page container">
        <header className="plant-ai-hero">
          <div>
            <span className="plant-ai-eyebrow"><Sparkles size={14} /> Plantepleje AI</span>
            <h1>Et plantepleje-center der kan se, forstå og handle i din have.</h1>
            <p>
              Tag et foto, vælg bed eller plante, og få råd der kan gemmes direkte som observation,
              opgave, journalnote eller plante i Havekompagnon.
            </p>
            <div className="plant-ai-hero-actions">
              <button className="btn btn-primary" onClick={() => cameraInputRef.current?.click()}>
                <Camera size={16} /> Tag foto
              </button>
              <button className="btn btn-ghost" onClick={() => openCompanion("map")}>
                <MapPinned size={16} /> Havekompagnon
              </button>
              <button className="btn btn-ghost" onClick={() => navigate("/havemaaler")}>
                <Ruler size={16} /> Havemåler
              </button>
            </div>
          </div>
          <div className="plant-ai-live-panel">
            <div className="plant-ai-live-top">
              <Leaf size={18} />
              <span>{selectedGarden?.name ?? "Ingen have valgt"}</span>
            </div>
            <div className="plant-ai-metrics">
              <Metric label="Planter" value={plants.length} />
              <Metric label="Åbne opgaver" value={openTasks.length} tone={openTasks.length > 6 ? "warn" : "ok"} />
              <Metric label="Risici" value={urgentIssues.length} tone={urgentIssues.length ? "risk" : "ok"} />
              <Metric label="Sensorer" value={deviceReadings.length} />
            </div>
          </div>
        </header>

        {workspaceLoading && gardens.length === 0 ? (
          <div className="plant-ai-loading">
            <Loader2 className="spin" size={20} /> Henter din havekontekst...
          </div>
        ) : gardens.length === 0 ? (
          <section className="plant-ai-empty">
            <Sprout size={30} />
            <h2>Opret en have for at aktivere den fulde AI.</h2>
            <p>Du kan stadig chatte, men Plantepleje AI bliver langt bedre, når den kan bruge dine bede, planter, opgaver og fotos.</p>
            <button className="btn btn-primary" onClick={() => navigate("/havemaaler")}>
              <Ruler size={16} /> Start med Havemåler
            </button>
          </section>
        ) : (
          <div className="plant-ai-shell">
            <aside className="plant-ai-sidebar">
              <button onClick={newConversation} className="plant-ai-new">
                <Plus size={16} /> Ny samtale
              </button>

              <div className="plant-ai-field">
                <label>Have</label>
                <select value={selectedGardenId ?? ""} onChange={(event) => void handleGardenChange(event.target.value)}>
                  {gardens.map((garden) => <option key={garden.id} value={garden.id}>{garden.name}</option>)}
                </select>
              </div>

              <div className="plant-ai-field">
                <label>Bed eller zone</label>
                <select
                  value={selectedZoneId ?? "all"}
                  onChange={(event) => {
                    const value = event.target.value;
                    setSelectedZoneId(value === "all" ? null : value);
                    setSelectedPlantId(null);
                  }}
                >
                  <option value="all">Hele haven</option>
                  {zones.map((zone) => <option key={zone.id} value={zone.id}>{zone.name}</option>)}
                </select>
              </div>

              <div className="plant-ai-field">
                <label>Plante</label>
                <select
                  value={selectedPlantId ?? "all"}
                  onChange={(event) => setSelectedPlantId(event.target.value === "all" ? null : event.target.value)}
                >
                  <option value="all">Ingen specifik plante</option>
                  {visiblePlants.map((plant) => <option key={plant.id} value={plant.id}>{plantLabel(plant)}</option>)}
                </select>
              </div>

              <div className="plant-ai-mode-list" aria-label="AI tilstande">
                {CARE_MODES.map(({ key, label, hint, icon: Icon }) => (
                  <button
                    key={key}
                    type="button"
                    className={careMode === key ? "active" : ""}
                    onClick={() => setCareMode(key)}
                  >
                    <Icon size={16} />
                    <span>
                      <strong>{label}</strong>
                      <small>{hint}</small>
                    </span>
                  </button>
                ))}
              </div>

              <div className="plant-ai-history-head">
                <span>Historik</span>
                <button type="button" onClick={() => void loadConversations()} aria-label="Genindlæs historik">
                  <RefreshCcw size={13} />
                </button>
              </div>
              <div className="plant-ai-history">
                {conversations.length === 0 && <p>Ingen samtaler endnu.</p>}
                {conversations.map((conversation) => (
                  <button
                    key={conversation.id}
                    type="button"
                    className={activeConv === conversation.id ? "active" : ""}
                    onClick={() => void loadMessages(conversation.id)}
                  >
                    <MessageCircle size={14} />
                    <span>{conversation.title}</span>
                    <i
                      role="button"
                      tabIndex={0}
                      aria-label="Slet samtale"
                      onClick={(event) => {
                        event.stopPropagation();
                        void deleteConv(conversation.id);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          event.stopPropagation();
                          void deleteConv(conversation.id);
                        }
                      }}
                    >
                      <X size={13} />
                    </i>
                  </button>
                ))}
              </div>
            </aside>

            <section className="plant-ai-chat-card">
              <div className="plant-ai-chat-head">
                <div>
                  <span>{modeLabel(careMode)}</span>
                  <strong>{zoneLabel(selectedZone)} · {plantLabel(selectedPlant)}</strong>
                </div>
                <button className="btn btn-ghost btn-sm" onClick={() => openCompanion("map")}>
                  <MapPinned size={14} /> Åbn kort
                </button>
              </div>

              <div ref={scrollRef} className="plant-ai-chat-scroll">
                {messages.length === 0 ? (
                  <div className="plant-ai-start">
                    <div className="plant-ai-start-icon"><Leaf size={28} /></div>
                    <h2>Hvad skal vi hjælpe planten med?</h2>
                    <p>Vælg en arbejdsgang, tag et foto eller start med et af forslagene.</p>
                    <div className="plant-ai-starters">
                      {starters.map((starter) => (
                        <button key={starter} type="button" onClick={() => void send(starter)} disabled={streaming}>
                          <ArrowRight size={15} />
                          <span>{starter}</span>
                        </button>
                      ))}
                    </div>
                    <div className="plant-ai-context-chips">
                      <span><MapPinned size={13} /> {zoneLabel(selectedZone)}</span>
                      <span><Sprout size={13} /> {plantLabel(selectedPlant)}</span>
                      <span><ClipboardList size={13} /> {openTasks.length} åbne opgaver</span>
                    </div>
                  </div>
                ) : (
                  messages.map((message, index) => {
                    const textValue = messageText(message.content);
                    const img = messageImage(message.content);
                    const isLastAssistant = message.role === "assistant" && index === messages.length - 1 && !streaming && textValue;
                    return (
                      <article key={`${message.role}-${index}`} className={`plant-ai-message ${message.role}`}>
                        <div className="plant-ai-avatar">
                          {message.role === "user" ? "Du" : <Leaf size={16} />}
                        </div>
                        <div className="plant-ai-bubble">
                          {img && <img src={img} alt="Vedhæftet plantefoto" className="plant-ai-message-image" />}
                          {message.diagnosis && <DiagnosisCard d={message.diagnosis} />}
                          {message.scan?.identify && (
                            <IdentifyCard
                              result={message.scan.identify}
                              created={Boolean(message.scan.plantCreatedId)}
                              busy={actionBusy === "add-plant"}
                              onAdd={() => void addIdentifiedPlant(message.scan)}
                            />
                          )}
                          {message.scan?.growth && <GrowthCard result={message.scan.growth} />}
                          <div className="prose-chat">
                            {message.role === "assistant"
                              ? <ReactMarkdown>{textValue || (message.diagnosis || message.scan ? "" : "...")}</ReactMarkdown>
                              : <div>{textValue}</div>}
                          </div>
                          {isLastAssistant && (
                            <div className="plant-ai-inline-actions">
                              <button type="button" onClick={() => void createTaskFromAdvice("assistant")} disabled={Boolean(actionBusy)}>
                                <ClipboardList size={14} /> Opret opgave
                              </button>
                              <button type="button" onClick={() => void createCarePlanFromAdvice()} disabled={Boolean(actionBusy)}>
                                <ClipboardCheck size={14} /> Handlingsplan
                              </button>
                              <button type="button" onClick={() => void saveAdviceToJournal()} disabled={Boolean(actionBusy)}>
                                <NotebookPen size={14} /> Gem journal
                              </button>
                              <button type="button" onClick={exportCareCalendar}>
                                <CalendarPlus size={14} /> Kalender
                              </button>
                              <button type="button" onClick={() => openCompanion("map")}>
                                <MapPinned size={14} /> Se i Havekompagnon
                              </button>
                            </div>
                          )}
                        </div>
                      </article>
                    );
                  })
                )}
              </div>

              {pendingImage && (
                <div className="plant-ai-pending">
                  <img src={pendingImage} alt="Klar til analyse" />
                  <div>
                    <strong>Foto klar til {modeLabel(careMode).toLowerCase()}</strong>
                    <span>{zoneLabel(selectedZone)} · {plantLabel(selectedPlant)}</span>
                  </div>
                  <button type="button" onClick={() => { setPendingImage(null); setPendingFile(null); }}>
                    <X size={15} /> Fjern
                  </button>
                </div>
              )}

              <form className="plant-ai-composer" onSubmit={(event) => { event.preventDefault(); void send(input); }}>
                <input
                  ref={cameraInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={onPickImage}
                  hidden
                />
                <input
                  ref={uploadInputRef}
                  type="file"
                  accept="image/*"
                  onChange={onPickImage}
                  hidden
                />
                <button type="button" onClick={() => cameraInputRef.current?.click()} disabled={streaming} aria-label="Tag foto">
                  <Camera size={18} />
                </button>
                <button type="button" onClick={() => uploadInputRef.current?.click()} disabled={streaming} aria-label="Upload foto">
                  <Upload size={18} />
                </button>
                <input
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  placeholder={pendingImage ? "Beskriv symptomer, placering eller hvad du vil have vurderet..." : "Spørg om beskæring, sygdom, jord, vækst, sæson eller pleje..."}
                  disabled={streaming}
                />
                <button type="submit" className="send" disabled={streaming || (!input.trim() && !pendingImage)}>
                  {streaming ? <Loader2 size={18} className="spin" /> : <Send size={18} />}
                </button>
              </form>
            </section>

            <aside className="plant-ai-rail">
              <section>
                <h3>AI-forberedelse</h3>
                <div className="plant-ai-fact-grid">
                  {contextFacts.map((fact) => (
                    <article key={`${fact.label}-${fact.value}`} className={fact.tone ? `tone-${fact.tone}` : ""}>
                      <span>{fact.label}</span>
                      <strong>{fact.value}</strong>
                      <small>{fact.hint}</small>
                    </article>
                  ))}
                </div>
              </section>

              <section>
                <h3>Havekontekst</h3>
                <div className="plant-ai-context-card">
                  <MapPinned size={18} />
                  <div>
                    <strong>{selectedGarden?.name}</strong>
                    <span>{selectedGarden?.address ?? `${zones.length} zoner · ${plants.length} planter`}</span>
                  </div>
                </div>
                <div className="plant-ai-mini-list">
                  <span><Sprout size={14} /> {zoneLabel(selectedZone)}</span>
                  <span><Leaf size={14} /> {plantLabel(selectedPlant)}</span>
                  <span><ClipboardList size={14} /> {openTasks.length} åbne opgaver</span>
                </div>
              </section>

              <section>
                <h3>Seneste scan</h3>
                <div className="plant-ai-scan-card">
                  {lastScan?.imageUrl ? <img src={lastScan.imageUrl} alt="Seneste scan" /> : <ImagePlus size={22} />}
                  <div>
                    <strong>{scanSummary(lastScan)}</strong>
                    <span>{lastScan ? `${modeLabel(lastScan.mode)} · ${scanConfidence(lastScan) ? Math.round(scanConfidence(lastScan)! * 100) + "% sikkerhed" : "gemt observation"}` : "Tag et foto for at starte"}</span>
                  </div>
                </div>
                {lastScan?.diagnosis && (
                  <button className="plant-ai-action" onClick={() => void createTaskFromAdvice("followup")} disabled={Boolean(actionBusy)}>
                    {actionBusy === "followup" ? <Loader2 className="spin" size={15} /> : <AlertTriangle size={15} />}
                    Følg op om 3 dage
                  </button>
                )}
                {lastScan?.identify && !lastScan.plantCreatedId && (
                  <button className="plant-ai-action" onClick={() => void addIdentifiedPlant()} disabled={Boolean(actionBusy)}>
                    {actionBusy === "add-plant" ? <Loader2 className="spin" size={15} /> : <Plus size={15} />}
                    Tilføj plante
                  </button>
                )}
              </section>

              <section>
                <h3>Foreslået handlingsplan</h3>
                <div className="plant-ai-plan-preview">
                  {carePlanPreview.length === 0 && <p>Send et råd eller tag en scan, så samler AI'en næste trin her.</p>}
                  {carePlanPreview.map((item) => (
                    <article key={`${item.kind}-${item.title}`}>
                      <span>{item.dueDays === 0 ? "I dag" : `Om ${item.dueDays} dage`}</span>
                      <strong>{item.title}</strong>
                      <small>{item.reason}</small>
                    </article>
                  ))}
                </div>
                {carePlanPreview.length > 0 && (
                  <button className="plant-ai-action" onClick={() => void createCarePlanFromAdvice()} disabled={Boolean(actionBusy)}>
                    {actionBusy === "plan" ? <Loader2 className="spin" size={15} /> : <ClipboardCheck size={15} />}
                    Opret hele planen
                  </button>
                )}
              </section>

              <section>
                <h3>Gem videre</h3>
                <div className="plant-ai-action-grid">
                  <button onClick={() => void createTaskFromAdvice("assistant")} disabled={Boolean(actionBusy)}>
                    <ClipboardList size={15} /> Opgave
                  </button>
                  <button onClick={() => void createCarePlanFromAdvice()} disabled={Boolean(actionBusy)}>
                    <ClipboardCheck size={15} /> Plan
                  </button>
                  <button onClick={() => void saveAdviceToJournal()} disabled={Boolean(actionBusy)}>
                    <NotebookPen size={15} /> Journal
                  </button>
                  <button onClick={exportCareCalendar}>
                    <CalendarPlus size={15} /> Kalender
                  </button>
                  <button onClick={() => void shareCareSummary()}>
                    <Share2 size={15} /> Del
                  </button>
                  <button onClick={() => openCompanion("map")}>
                    <MapPinned size={15} /> Kort
                  </button>
                  <button onClick={() => openCompanion("plan")}>
                    <Leaf size={15} /> Plejeplan
                  </button>
                </div>
              </section>

              <section>
                <h3>Næste opgaver</h3>
                <div className="plant-ai-task-list">
                  {openTasks.length === 0 && <p>Ingen åbne opgaver i denne have.</p>}
                  {openTasks.slice(0, 5).map((task) => (
                    <div key={task.id}>
                      <Check size={14} />
                      <span>{task.title}</span>
                      <small>{formatDate(task.due_at)}</small>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h3>Seneste fotos</h3>
                <div className="plant-ai-photo-grid">
                  {latestPhotos.length === 0 && <p>Ingen fotos endnu.</p>}
                  {latestPhotos.map((photo) => (
                    <img key={photo.id} src={photo.image_url ?? ""} alt={photo.caption ?? "Havefoto"} />
                  ))}
                </div>
              </section>
            </aside>
          </div>
        )}
      </main>
      <SiteFooter />
    </>
  );
}

function Metric({ label, value, tone }: { label: string; value: number; tone?: "ok" | "warn" | "risk" }) {
  return (
    <div className={tone ? `tone-${tone}` : ""}>
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function IdentifyCard({
  result,
  created,
  busy,
  onAdd,
}: {
  result: IdentifyResult;
  created: boolean;
  busy: boolean;
  onAdd: () => void;
}) {
  return (
    <div className="plant-ai-result-card">
      <div className="plant-ai-result-head">
        <Sprout size={17} />
        <div>
          <span>Identifikation</span>
          <strong>{result.name_da ?? "Ukendt plante"}</strong>
          {result.latin && <small>{result.latin}</small>}
        </div>
      </div>
      <p>{result.care_tip ?? "Gem observationen og tag et ekstra foto, hvis du er i tvivl."}</p>
      <div className="plant-ai-result-tags">
        {result.category && <span>{result.category}</span>}
        {result.water_need && <span>Vand: {result.water_need}</span>}
        {result.sun && <span>Lys: {result.sun}</span>}
      </div>
      <button type="button" onClick={onAdd} disabled={created || busy}>
        {busy ? <Loader2 className="spin" size={14} /> : created ? <Check size={14} /> : <Plus size={14} />}
        {created ? "Tilføjet til haven" : "Tilføj som plante"}
      </button>
    </div>
  );
}

function GrowthCard({ result }: { result: GrowthResult }) {
  const flags = Array.isArray(result.anomaly_flags) ? result.anomaly_flags.map(String) : [];
  return (
    <div className="plant-ai-result-card">
      <div className="plant-ai-result-head">
        <Activity size={17} />
        <div>
          <span>Væksttjek</span>
          <strong>{String(result.summary ?? result.trend ?? "Observation gemt")}</strong>
          <small>{result.stage ? `Stadie: ${String(result.stage)}` : "Gentag foto fra samme vinkel for bedre trend"}</small>
        </div>
      </div>
      <div className="plant-ai-growth-grid">
        <span><strong>{String(result.vigor ?? "ukendt")}</strong> Vigor</span>
        <span><strong>{String(result.harvest_readiness ?? "ikke vurderet")}</strong> Høst</span>
      </div>
      {flags.length > 0 && (
        <div className="plant-ai-result-tags">
          {flags.map((flag) => <span key={flag}>{flag}</span>)}
        </div>
      )}
      {result.next_action && <p>{String(result.next_action)}</p>}
    </div>
  );
}
