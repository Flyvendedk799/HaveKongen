// Watering decision engine + volume math + week computation.
// Pure helpers, no React.

export type Forecast = {
  date: string;            // YYYY-MM-DD
  precip_mm: number;
  temp_max: number;
  temp_min?: number;
  et0: number;             // mm/day FAO ET0 (Open-Meteo)
  wind_max?: number;
};

export type Zone = {
  id: string;
  name: string;
  type: string;            // lawn|bed|greenhouse|terrace|pond|tree
  area_m2: number | null;
  sun_exposure?: string | null; // sun|part|shade
  soil?: string | null;         // sand|loam|clay
};

export type Schedule = {
  id: string;
  zone_id: string;
  name: string;
  weekday_mask: number;
  start_time: string;
  duration_min: number;
  enabled: boolean;
  ai_adjusted: boolean;
};

export type Decision = {
  action: "water" | "skip" | "reduce" | "boost";
  reason: string;
  effectiveMin: number;       // adjusted duration
  mmExpected: number;         // forecast precip on the day
  confidence: "high" | "medium" | "low";
};

// L per m² per session by zone type
const VOL_COEFF: Record<string, number> = {
  lawn: 4,
  bed: 6,
  greenhouse: 8,
  terrace: 1,
  pond: 0,
  tree: 8,
};

// soil-aware skip threshold (mm forecast precip)
const SOIL_SKIP_MM: Record<string, number> = {
  sand: 5,
  loam: 4,
  clay: 3,
};

export function maskHas(mask: number, day: number) {
  return (mask & (1 << day)) !== 0;
}
export function maskToggle(mask: number, day: number) {
  return mask ^ (1 << day);
}

/** Day-of-week 0=Mon..6=Sun. */
export function dowMon0(d: Date): number {
  return (d.getDay() + 6) % 7;
}

/** Estimate liters delivered for a session of `min` minutes on a zone. */
export function litersForSession(zone: Zone, min: number): number {
  const base = VOL_COEFF[zone.type] ?? 4;
  // Assume schedule duration of 15 min ≈ 1× session volume; scale linearly.
  const factor = min / 15;
  return Math.round((zone.area_m2 ?? 0) * base * factor);
}

/** Given a schedule, return the next N occurrences as Date objects. */
export function upcomingOccurrences(s: Schedule, days = 7): Date[] {
  const out: Date[] = [];
  const now = new Date();
  const [h, m] = s.start_time.split(":").map(Number);
  for (let i = 0; i < days; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    d.setHours(h, m, 0, 0);
    if (maskHas(s.weekday_mask, dowMon0(d)) && d.getTime() >= now.getTime() - 60_000) {
      out.push(d);
    }
  }
  return out;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export type DecideOpts = {
  pauseUntil?: Date | null;
  snoozedKeys?: Set<string>; // `${schedule_id}:${YYYY-MM-DD}`
};

/** Decide what should happen for a planned occurrence. */
export function decide(
  s: Schedule,
  zone: Zone,
  occ: Date,
  forecasts: Forecast[],
  recentMm48h: number,
  opts: DecideOpts = {},
): Decision {
  const key = isoDate(occ);
  const fc = forecasts.find((f) => f.date === key);
  const precip = fc?.precip_mm ?? 0;
  const temp = fc?.temp_max ?? 18;
  const tmin = fc?.temp_min ?? 10;
  const wind = fc?.wind_max ?? 0;
  const et0 = fc?.et0 ?? 3;

  // Frost guard — never irrigate when night drops below ~2 °C; risk of root/leaf damage.
  if (tmin <= 2) {
    return { action: "skip", reason: `Frostrisiko · nat ${Math.round(tmin)} °C`, effectiveMin: 0, mmExpected: precip, confidence: "high" };
  }
  // High-wind guard — sprinklers waste >40% above 8 m/s; reschedule by skipping today.
  if (wind >= 9) {
    return { action: "skip", reason: `For meget vind · ${Math.round(wind)} m/s`, effectiveMin: 0, mmExpected: precip, confidence: "medium" };
  }

  if (opts.pauseUntil && occ.getTime() < opts.pauseUntil.getTime()) {
    return { action: "skip", reason: `Pauseret til ${opts.pauseUntil.toLocaleDateString("da-DK", { day: "numeric", month: "short" })}`, effectiveMin: 0, mmExpected: precip, confidence: "high" };
  }
  if (opts.snoozedKeys?.has(`${s.id}:${key}`)) {
    return { action: "skip", reason: "Sprunget over manuelt", effectiveMin: 0, mmExpected: precip, confidence: "high" };
  }

  if (!s.enabled) {
    return { action: "skip", reason: "Pause", effectiveMin: 0, mmExpected: precip, confidence: "high" };
  }

  if (!s.ai_adjusted) {
    return { action: "water", reason: "Manuel timer", effectiveMin: s.duration_min, mmExpected: precip, confidence: "high" };
  }

  const soil = (zone.soil ?? "loam").toLowerCase();
  const skipMm = SOIL_SKIP_MM[soil] ?? 4;

  if (recentMm48h > 10) {
    return { action: "skip", reason: `Jorden er våd · ${recentMm48h.toFixed(1)} mm sidste 48 t`, effectiveMin: 0, mmExpected: precip, confidence: "high" };
  }
  if (precip >= skipMm) {
    return { action: "skip", reason: `Springer over · ${precip.toFixed(1)} mm regn ventet`, effectiveMin: 0, mmExpected: precip, confidence: "high" };
  }

  let min = s.duration_min;
  let action: Decision["action"] = "water";
  let reason = `Vand som planlagt · ${min} min`;

  const fullSun = (zone.sun_exposure ?? "sun").toLowerCase().startsWith("sun");
  // Heatwave: sustained >30 °C
  const heatwave = forecasts.slice(0, 3).filter((f) => (f.temp_max ?? 0) >= 30).length >= 2;
  if (heatwave && fullSun) {
    min = Math.round(min * 1.35);
    action = "boost";
    reason = `Hedebølge · øger til ${min} min`;
  } else if (temp > 28 && fullSun) {
    min = Math.round(min * 1.2);
    action = "boost";
    reason = `Øger til ${min} min · varme ${Math.round(temp)} °C`;
  } else if (et0 < 1.2) {
    min = Math.max(5, Math.round(min * 0.75));
    action = "reduce";
    reason = `Sænker til ${min} min · lav fordampning`;
  }

  return { action, reason, effectiveMin: min, mmExpected: precip, confidence: "medium" };
}

/** Compute weekly water summary across all zones+schedules. */
export function weekSummary(
  schedules: Schedule[],
  zones: Zone[],
  forecasts: Forecast[],
  opts: DecideOpts = {},
) {
  let plannedL = 0;
  let savedL = 0;
  let waterCount = 0;
  let skipCount = 0;
  const last48Mm = forecasts.slice(0, 2).reduce((a, b) => a + b.precip_mm, 0); // crude proxy

  for (const s of schedules) {
    const zone = zones.find((z) => z.id === s.zone_id);
    if (!zone) continue;
    const occs = upcomingOccurrences(s, 7);
    for (const o of occs) {
      const d = decide(s, zone, o, forecasts, last48Mm, opts);
      if (d.action === "skip") {
        skipCount++;
        savedL += litersForSession(zone, s.duration_min);
      } else {
        waterCount++;
        plannedL += litersForSession(zone, d.effectiveMin);
      }
    }
  }
  return { plannedL, savedL, waterCount, skipCount };
}

/** Soil deficit estimate for a zone (0=saturated, 1=very dry). Uses last 7d ET0 - precip. */
export function moistureDeficit(zone: Zone, forecasts: Forecast[], wateredMmLast7d = 0): number {
  // forecasts[0..6] is "today + 6 next days"; we don't have past data here, so use a rolling
  // estimate based on next-day ET0 vs already-fallen rain proxy.
  const past = forecasts.slice(0, 7);
  const et0 = past.reduce((a, b) => a + (b.et0 ?? 3), 0);
  const rain = past.reduce((a, b) => a + (b.precip_mm ?? 0), 0);
  const sunBoost = (zone.sun_exposure ?? "sun").startsWith("sun") ? 1.15 : 0.85;
  const soilHold = zone.soil === "sand" ? 0.7 : zone.soil === "clay" ? 1.25 : 1.0;
  const need = et0 * sunBoost;
  const supply = (rain + wateredMmLast7d) * soilHold;
  const ratio = Math.max(0, Math.min(1, 1 - supply / Math.max(1, need)));
  return ratio;
}

// ===== FAO-56 lite soil-water balance =====
// Maintains a per-zone "depletion" (mm) — how dry the root zone is — by simulating
// daily inputs (rain + irrigation) minus outputs (ETc = ET0 * Kc * sun adj).
// Field capacity (TAW) defaults vary by soil. Irrigate when depletion > MAD * TAW.
const TAW_BY_SOIL: Record<string, number> = { sand: 30, loam: 45, clay: 60 };
const MAD = 0.5; // allow 50% depletion before stress

export type BalanceDay = {
  date: string;
  rain: number;
  et0: number;
  irrigationMm: number;
};

export type BalanceState = {
  depletion: number;   // mm depleted from field capacity (0 = wet, TAW = wilting)
  taw: number;         // total available water (mm)
  stress: boolean;     // depletion > MAD*TAW
};

export function initialBalance(zone: Zone): BalanceState {
  const taw = TAW_BY_SOIL[(zone.soil ?? "loam").toLowerCase()] ?? 45;
  return { depletion: taw * 0.3, taw, stress: false };
}

export function stepBalance(
  state: BalanceState,
  zone: Zone,
  day: BalanceDay,
  kc = 1,
): BalanceState {
  const sun = (zone.sun_exposure ?? "sun").toLowerCase().startsWith("sun") ? 1.1 : 0.85;
  const etc = (day.et0 ?? 3) * kc * sun;
  // Inputs reduce depletion, capped at 0 (no overflow stored)
  const next = Math.max(0, state.depletion - day.rain - day.irrigationMm + etc);
  const dep = Math.min(state.taw, next);
  return { depletion: dep, taw: state.taw, stress: dep > state.taw * MAD };
}

/** Project per-zone depletion across the next N days using forecasts + planned schedules. */
export function projectBalance(
  zone: Zone,
  schedules: Schedule[],
  forecasts: Forecast[],
  opts: DecideOpts = {},
): { day: string; depletion: number; pct: number; stress: boolean }[] {
  let state = initialBalance(zone);
  const last48 = forecasts.slice(0, 2).reduce((a, b) => a + b.precip_mm, 0);
  return forecasts.slice(0, 7).map((f) => {
    const date = new Date(f.date + "T12:00:00");
    let irrigationMm = 0;
    for (const s of schedules.filter((x) => x.zone_id === zone.id)) {
      if (!maskHas(s.weekday_mask, dowMon0(date))) continue;
      const dec = decide(s, zone, date, forecasts, last48, opts);
      if (dec.action === "skip") continue;
      // Convert minutes→mm via volume coefficient (rough): area-independent mm equivalent
      const mm = (VOL_COEFF[zone.type] ?? 4) * (dec.effectiveMin / 15) * 0.6;
      irrigationMm += mm;
    }
    state = stepBalance(state, zone, { date: f.date, rain: f.precip_mm, et0: f.et0 ?? 3, irrigationMm });
    const pct = Math.round((state.depletion / state.taw) * 100);
    return { day: f.date, depletion: state.depletion, pct, stress: state.stress };
  });
}

/** Total expected precip in next `hours` hours (uses daily granularity, weighted). */
export function precipNextHours(forecasts: Forecast[], hours = 24): number {
  if (forecasts.length === 0) return 0;
  const days = hours / 24;
  let mm = 0;
  for (let i = 0; i < Math.ceil(days); i++) {
    const w = i + 1 <= days ? 1 : days - i;
    mm += (forecasts[i]?.precip_mm ?? 0) * Math.max(0, w);
  }
  return mm;
}

/** Build an ICS calendar string for the next 14 days of non-skipped occurrences. */
export function buildICS(
  schedules: Schedule[],
  zones: Zone[],
  forecasts: Forecast[],
  opts: DecideOpts = {},
): string {
  const last48 = forecasts.slice(0, 2).reduce((a, b) => a + b.precip_mm, 0);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Lovable//Vandingsplan//DA"];
  const fmt = (d: Date) =>
    d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  for (const s of schedules) {
    const z = zones.find((zz) => zz.id === s.zone_id);
    if (!z) continue;
    const occs = upcomingOccurrences(s, 14);
    for (const o of occs) {
      const d = decide(s, z, o, forecasts, last48, opts);
      if (d.action === "skip") continue;
      const end = new Date(o.getTime() + d.effectiveMin * 60_000);
      lines.push(
        "BEGIN:VEVENT",
        `UID:${s.id}-${o.getTime()}@lovable`,
        `DTSTAMP:${fmt(new Date())}`,
        `DTSTART:${fmt(o)}`,
        `DTEND:${fmt(end)}`,
        `SUMMARY:💧 ${z.name} · ${d.effectiveMin} min`,
        `DESCRIPTION:${d.reason} · ~${litersForSession(z, d.effectiveMin)} L`,
        "END:VEVENT",
      );
    }
  }
  lines.push("END:VCALENDAR");
  return lines.join("\r\n");
}

const FC_CACHE_KEY = "watering.forecast.v1";

export function loadCachedForecast(lat: number, lng: number): Forecast[] | null {
  try {
    const raw = sessionStorage.getItem(FC_CACHE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (j.lat === lat && j.lng === lng && Date.now() - j.t < 6 * 3600_000) return j.data as Forecast[];
  } catch {}
  return null;
}
export function saveCachedForecast(lat: number, lng: number, data: Forecast[]) {
  try { sessionStorage.setItem(FC_CACHE_KEY, JSON.stringify({ lat, lng, t: Date.now(), data })); } catch {}
}

export async function fetchForecast(lat: number, lng: number): Promise<Forecast[]> {
  const cached = loadCachedForecast(lat, lng);
  if (cached) return cached;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&daily=precipitation_sum,temperature_2m_max,temperature_2m_min,et0_fao_evapotranspiration,wind_speed_10m_max&timezone=Europe%2FCopenhagen&forecast_days=14`;
  const j = await fetch(url).then((r) => r.json());
  const dates: string[] = j?.daily?.time ?? [];
  const out: Forecast[] = dates.map((d, i) => ({
    date: d,
    precip_mm: j.daily.precipitation_sum?.[i] ?? 0,
    temp_max: j.daily.temperature_2m_max?.[i] ?? 18,
    temp_min: j.daily.temperature_2m_min?.[i] ?? 10,
    et0: j.daily.et0_fao_evapotranspiration?.[i] ?? 3,
    wind_max: j.daily.wind_speed_10m_max?.[i] ?? 0,
  }));
  saveCachedForecast(lat, lng, out);
  return out;
}
