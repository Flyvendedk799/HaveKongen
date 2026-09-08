import { beforeEach, describe, expect, it, vi } from "vitest";

// The consent store writes an audit copy through Supabase. That is best-effort
// and irrelevant to the behaviour under test, so it is stubbed out — a failing
// insert must never change what the visitor chose.
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getUser: async () => ({ data: { user: null } }) },
    from: () => ({ insert: async () => ({ error: null }) }),
  },
}));

import { POLICY_VERSION, anonId, hasConsent, useConsent } from "@/lib/consent";
import { clearEvents, getEvents, track } from "@/lib/analytics";

function resetStore() {
  localStorage.clear();
  useConsent.setState({ choice: null, needsDecision: true });
}

describe("consent store", () => {
  beforeEach(resetStore);

  it("starts undecided, with nothing but necessary allowed", () => {
    expect(useConsent.getState().needsDecision).toBe(true);
    expect(hasConsent("analytics")).toBe(false);
    expect(hasConsent("marketing")).toBe(false);
    expect(hasConsent("functional")).toBe(false);
  });

  it("records an accept-all and stops asking", async () => {
    await useConsent.getState().acceptAll();
    const { choice, needsDecision } = useConsent.getState();

    expect(needsDecision).toBe(false);
    expect(choice?.analytics).toBe(true);
    expect(choice?.marketing).toBe(true);
    expect(choice?.necessary).toBe(true);
    expect(choice?.version).toBe(POLICY_VERSION);
    expect(hasConsent("analytics")).toBe(true);
  });

  it("records a reject-all as a real decision, not a non-answer", async () => {
    await useConsent.getState().rejectAll();
    const { choice, needsDecision } = useConsent.getState();

    expect(needsDecision).toBe(false);
    expect(choice?.analytics).toBe(false);
    expect(hasConsent("analytics")).toBe(false);
  });

  it("stores a partial choice", async () => {
    await useConsent.getState().save({ analytics: true, marketing: false, functional: true });
    expect(hasConsent("analytics")).toBe(true);
    expect(hasConsent("marketing")).toBe(false);
    expect(hasConsent("functional")).toBe(true);
  });

  it("persists the choice to localStorage", async () => {
    await useConsent.getState().acceptAll();
    const raw = localStorage.getItem("havekongen-consent");
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).analytics).toBe(true);
  });

  it("ignores a stored answer from an older policy version", async () => {
    localStorage.setItem(
      "havekongen-consent",
      JSON.stringify({ necessary: true, analytics: true, marketing: true, functional: true, version: "1999-01", decidedAt: "" }),
    );
    // hasConsent falls back to the stored copy when the store is empty; an
    // outdated version must not count as consent.
    useConsent.setState({ choice: null, needsDecision: true });
    expect(hasConsent("analytics")).toBe(false);
  });

  it("reopen asks again without discarding the stored answer", async () => {
    await useConsent.getState().acceptAll();
    useConsent.getState().reopen();
    expect(useConsent.getState().needsDecision).toBe(true);
    expect(useConsent.getState().choice?.analytics).toBe(true);
  });

  it("keeps a stable anonymous id per browser", () => {
    const first = anonId();
    expect(first).toBeTruthy();
    expect(anonId()).toBe(first);
  });
});

describe("analytics gating", () => {
  beforeEach(() => {
    resetStore();
    clearEvents();
  });

  it("drops ordinary events before a decision is made", () => {
    track("page_view", { path: "/webshop" });
    expect(getEvents()).toHaveLength(0);
  });

  it("still records operational events without consent", () => {
    // We need to know when the till is broken even from visitors who said no;
    // these carry no identifiers.
    track("checkout_error", { reason: "insufficient_stock" });
    const events = getEvents();
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe("checkout_error");
  });

  it("records ordinary events once analytics consent is given", async () => {
    await useConsent.getState().acceptAll();
    track("page_view", { path: "/webshop" });
    expect(getEvents().map((e) => e.name)).toContain("page_view");
  });

  it("stops recording again after consent is withdrawn", async () => {
    await useConsent.getState().acceptAll();
    track("page_view", { path: "/a" });
    await useConsent.getState().rejectAll();
    track("page_view", { path: "/b" });

    const paths = getEvents().map((e) => (e.props as { path?: string } | undefined)?.path);
    expect(paths).toContain("/a");
    expect(paths).not.toContain("/b");
  });
});
