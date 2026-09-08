// Cookie/consent state.
//
// ePrivacy says analytics and marketing storage need opt-in *before* it happens,
// so this module is deliberately the first thing analytics asks. Until a visitor
// has answered, everything except "necessary" is off, and track() drops events
// on the floor rather than queuing them for later.
//
// The choice is mirrored to the consents table (an audit trail we can produce if
// anyone asks what was agreed and when); the browser copy in localStorage is
// what actually gates behaviour, so the site works with the database offline.

import { create } from "zustand";
import { supabase } from "@/integrations/supabase/client";

export const POLICY_VERSION = "2026-09";

const STORAGE_KEY = "havekongen-consent";
const ANON_KEY = "havekongen-anon-id";

export type ConsentChoice = {
  necessary: true;
  analytics: boolean;
  marketing: boolean;
  functional: boolean;
  version: string;
  decidedAt: string;
};

export const DENY_ALL: Omit<ConsentChoice, "decidedAt"> = {
  necessary: true,
  analytics: false,
  marketing: false,
  functional: false,
  version: POLICY_VERSION,
};

function readStored(): ConsentChoice | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ConsentChoice;
    // A new policy version invalidates the old answer — that is the point of
    // versioning it.
    if (parsed.version !== POLICY_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** Stable per-browser id so an anonymous consent record can be superseded. */
export function anonId(): string {
  try {
    let id = localStorage.getItem(ANON_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(ANON_KEY, id);
    }
    return id;
  } catch {
    return "no-storage";
  }
}

type ConsentState = {
  choice: ConsentChoice | null;
  /** True until the visitor has answered; drives the banner. */
  needsDecision: boolean;
  save: (partial: Omit<ConsentChoice, "decidedAt" | "version" | "necessary">) => Promise<void>;
  acceptAll: () => Promise<void>;
  rejectAll: () => Promise<void>;
  reopen: () => void;
};

export const useConsent = create<ConsentState>((set, get) => {
  const initial = readStored();
  return {
    choice: initial,
    needsDecision: !initial,

    save: async (partial) => {
      const choice: ConsentChoice = {
        necessary: true,
        analytics: partial.analytics,
        marketing: partial.marketing,
        functional: partial.functional,
        version: POLICY_VERSION,
        decidedAt: new Date().toISOString(),
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(choice));
      } catch {
        /* private mode: the choice then lasts for this tab only */
      }
      set({ choice, needsDecision: false });

      // Best-effort audit copy. A failure here must not undo the decision the
      // visitor just made in the UI.
      try {
        const { data } = await supabase.auth.getUser();
        await supabase.from("consents").insert({
          user_id: data.user?.id ?? null,
          anon_id: anonId(),
          necessary: true,
          analytics: choice.analytics,
          marketing: choice.marketing,
          functional: choice.functional,
          policy_version: POLICY_VERSION,
          user_agent: navigator.userAgent.slice(0, 500),
        });
      } catch {
        /* ignore */
      }
    },

    acceptAll: () => get().save({ analytics: true, marketing: true, functional: true }),
    rejectAll: () => get().save({ analytics: false, marketing: false, functional: false }),
    reopen: () => set({ needsDecision: true }),
  };
});

/**
 * Read the current answer without subscribing — for non-React callers such as
 * analytics.track(), which runs on every page view.
 */
export function hasConsent(kind: "analytics" | "marketing" | "functional"): boolean {
  const choice = useConsent.getState().choice ?? readStored();
  return Boolean(choice?.[kind]);
}
