// Lightweight client-side analytics. Stores events in localStorage and
// also forwards to window.dataLayer / gtag if present (no external SDK).

export type AnalyticsEvent = {
  name: string;
  ts: number;
  props?: Record<string, unknown>;
};

const KEY = "havelandet-analytics";
const MAX = 500;

function read(): AnalyticsEvent[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "[]");
  } catch {
    return [];
  }
}

function write(events: AnalyticsEvent[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(events.slice(-MAX)));
  } catch {
    /* ignore quota */
  }
}

export function track(name: string, props?: Record<string, unknown>) {
  const evt: AnalyticsEvent = { name, ts: Date.now(), props };
  const next = [...read(), evt];
  write(next);
  // Fan out to gtag/dataLayer if site adds one later.
  const w = window as unknown as {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  };
  w.dataLayer?.push({ event: name, ...props });
  w.gtag?.("event", name, props ?? {});
  if (import.meta.env.DEV) {
    // eslint-disable-next-line no-console
    console.debug("[analytics]", name, props ?? {});
  }
}

export function getEvents(): AnalyticsEvent[] {
  return read();
}

export function clearEvents() {
  write([]);
}
