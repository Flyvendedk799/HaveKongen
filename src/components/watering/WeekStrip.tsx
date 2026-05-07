import { Schedule, Zone, Forecast, decide, upcomingOccurrences, dowMon0 } from "@/lib/wateringAI";

const DAYS = ["M", "T", "O", "T", "F", "L", "S"];

const ICON: Record<string, string> = {
  water: "✓", skip: "🌧", boost: "🔥", reduce: "•", off: "—",
};
const COLOR: Record<string, string> = {
  water: "#1a6b3a", skip: "#2d5a8a", boost: "#a3540a", reduce: "#5a5a6a", off: "rgba(20,39,29,0.3)",
};

export default function WeekStrip({ schedules, zone, forecasts }: { schedules: Schedule[]; zone: Zone; forecasts: Forecast[] }) {
  const today = new Date();
  const days: { date: Date; label: string; action: string; tooltip: string }[] = [];
  const last48 = forecasts.slice(0, 2).reduce((a, b) => a + b.precip_mm, 0);

  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const dow = dowMon0(d);
    let action = "off";
    let tooltip = "Ingen vanding";
    for (const s of schedules) {
      const occs = upcomingOccurrences(s, 8);
      const match = occs.find(o => o.toDateString() === d.toDateString());
      if (match) {
        const dec = decide(s, zone, match, forecasts, last48);
        action = dec.action;
        tooltip = `${s.start_time.slice(0,5)} · ${dec.reason}`;
        break;
      }
    }
    days.push({ date: d, label: DAYS[dow], action, tooltip });
  }

  return (
    <div className="flex gap-1.5 overflow-x-auto -mx-1 px-1 snap-x">
      {days.map((d, i) => {
        const isToday = i === 0;
        return (
          <div key={i} title={d.tooltip}
            className={`flex-shrink-0 snap-start flex flex-col items-center justify-center w-12 h-14 rounded-xl border text-[11px] font-medium transition-all hover:scale-105 cursor-default ${isToday ? "ring-2 ring-offset-1" : ""}`}
            style={{
              borderColor: "rgba(20,39,29,0.10)",
              background: d.action === "off" ? "rgba(20,39,29,0.03)" : "#fff",
              color: "var(--ink-500)",
              ...(isToday ? { boxShadow: "0 0 0 2px var(--forest-800)" as any } : {}),
            }}>
            <span style={{ color: "var(--ink-500)" }}>{d.label}</span>
            <span className="text-base mt-0.5" style={{ color: COLOR[d.action] }}>{ICON[d.action]}</span>
          </div>
        );
      })}
    </div>
  );
}
