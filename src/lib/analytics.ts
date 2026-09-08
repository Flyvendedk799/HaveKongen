// Lightweight first-party analytics.
//
// Events are kept in localStorage for the admin analytics page and forwarded to
// window.dataLayer / gtag when a tag manager is present. Nothing leaves the
// browser on its own.
//
// v2: the whole thing is gated on consent. Before a visitor has opted in,
// track() records nothing and forwards nothing — the events are dropped, not
// buffered, because a buffer that replays on consent is still processing you
// did not agree to.

import { hasConsent } from "@/lib/consent";

export type AnalyticsEvent = {
  name: string;
  ts: number;
  props?: Record<string, unknown>;
};

const KEY = "havekongen-analytics";
const MAX = 500;

/**
 * Events that describe the shop working rather than the person using it. These
 * are recorded regardless of consent because they carry no identifier and we
 * need them to know whether checkout is broken.
 */
const OPERATIONAL = new Set(["order_placed", "checkout_error", "payment_prepared", "app_error"]);

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
  if (!OPERATIONAL.has(name) && !hasConsent("analytics")) {
    if (import.meta.env.DEV) {
      // eslint-disable-next-line no-console
      console.debug("[analytics] dropped (no consent)", name);
    }
    return;
  }

  const evt: AnalyticsEvent = { name, ts: Date.now(), props };
  write([...read(), evt]);

  // Fan out to gtag/dataLayer if the site adds one later — but only for events
  // the visitor has actually consented to.
  if (hasConsent("analytics")) {
    const w = window as unknown as {
      dataLayer?: unknown[];
      gtag?: (...args: unknown[]) => void;
    };
    w.dataLayer?.push({ event: name, ...props });
    w.gtag?.("event", name, props ?? {});
  }

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
