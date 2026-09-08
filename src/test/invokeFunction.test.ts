import { beforeEach, describe, expect, it, vi } from "vitest";

// One mutable stub the tests reconfigure per case.
const invoke = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
    rpc: async () => ({ data: null, error: null }),
    auth: { getUser: async () => ({ data: { user: null } }) },
  },
}));

import { invokeFunction } from "@/lib/shop";

/** A FunctionsHttpError-shaped rejection: generic message, real body on .context. */
function httpError(body: unknown, status = 400) {
  return {
    data: null,
    error: Object.assign(new Error("Edge Function returned a non-2xx status code"), {
      context: new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }),
    }),
  };
}

describe("invokeFunction", () => {
  beforeEach(() => invoke.mockReset());

  it("returns the payload on success", async () => {
    invoke.mockResolvedValue({ data: { ok: true, order_no: "HK-260908-01042" }, error: null });
    await expect(invokeFunction("checkout-payment", {})).resolves.toEqual({
      ok: true,
      order_no: "HK-260908-01042",
    });
  });

  it("surfaces the function's own Danish message, not the transport one", async () => {
    invoke.mockResolvedValue(
      httpError({ error: "quota_exceeded", message: "Du har brugt dagens 30 AI-svar. Prøv igen i morgen." }, 429),
    );
    await expect(invokeFunction("plant-diagnose", {})).rejects.toThrow(
      "Du har brugt dagens 30 AI-svar. Prøv igen i morgen.",
    );
  });

  it("falls back to the machine code when there is no human message", async () => {
    invoke.mockResolvedValue(httpError({ error: "provider_unavailable" }, 503));
    await expect(invokeFunction("checkout-payment", {})).rejects.toThrow("provider_unavailable");
  });

  it("falls back to the transport message when the body is not JSON", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: Object.assign(new Error("Edge Function returned a non-2xx status code"), {
        context: new Response("<html>502 Bad Gateway</html>", { status: 502 }),
      }),
    });
    await expect(invokeFunction("checkout-payment", {})).rejects.toThrow(
      "Edge Function returned a non-2xx status code",
    );
  });

  it("falls back to the transport message when there is no response at all", async () => {
    invoke.mockResolvedValue({ data: null, error: new Error("Failed to fetch") });
    await expect(invokeFunction("checkout-payment", {})).rejects.toThrow("Failed to fetch");
  });

  it("passes the body straight through to the function", async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null });
    await invokeFunction("account-delete", { confirm: "SLET MIN KONTO" });
    expect(invoke).toHaveBeenCalledWith("account-delete", { body: { confirm: "SLET MIN KONTO" } });
  });
});
