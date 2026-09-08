import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async () => ({ data: null, error: null }),
    from: () => ({ select: () => ({ eq: () => ({ order: async () => ({ data: [], error: null }) }) }) }),
    auth: { getUser: async () => ({ data: { user: null } }) },
  },
}));

import { cartToItems } from "@/lib/shop";
import { deriveSteps, type TimelineOrder } from "@/components/order/OrderTimeline";
import type { CartItem } from "@/lib/cart";

const item = (over: Partial<CartItem> = {}): CartItem => ({
  productId: "p1",
  name: "Æbletræ 'Discovery'",
  unitPriceDkk: 349,
  qty: 1,
  ...over,
});

describe("cartToItems", () => {
  it("sends identity and quantity only — never a price", () => {
    const payload = cartToItems([item({ unitPriceDkk: 349 })]) as unknown as Record<string, unknown>[];

    expect(payload).toHaveLength(1);
    expect(Object.keys(payload[0]).sort()).toEqual(["product_id", "qty", "variant_id"]);
    // The whole point of v2: the browser cannot state a price.
    expect(JSON.stringify(payload)).not.toContain("349");
  });

  it("passes a variant through, and null when there is none", () => {
    const payload = cartToItems([
      item({ variantId: "v9" }),
      item({ productId: "p2" }),
    ]) as unknown as Record<string, unknown>[];

    expect(payload[0].variant_id).toBe("v9");
    expect(payload[1].variant_id).toBeNull();
  });

  it("keeps quantities as entered — clamping is the database's job", () => {
    const payload = cartToItems([item({ qty: 7 })]) as unknown as Record<string, unknown>[];
    expect(payload[0].qty).toBe(7);
  });

  it("maps an empty cart to an empty array", () => {
    expect(cartToItems([])).toEqual([]);
  });
});

const baseOrder: TimelineOrder = {
  created_at: "2026-09-01T10:00:00Z",
  placed_at: "2026-09-01T10:00:00Z",
  paid_at: null,
  shipped_at: null,
  delivered_at: null,
  cancelled_at: null,
  refunded_at: null,
  status: "pending",
};

describe("order timeline", () => {
  it("waits on payment for a fresh order", () => {
    const { steps, nextIndex } = deriveSteps(baseOrder);
    expect(steps.map((s) => s.key)).toEqual(["placed", "paid", "shipped", "delivered"]);
    expect(steps[nextIndex].key).toBe("paid");
  });

  it("advances as milestones are stamped", () => {
    const { steps, nextIndex } = deriveSteps({
      ...baseOrder,
      status: "shipped",
      paid_at: "2026-09-01T11:00:00Z",
      shipped_at: "2026-09-02T09:00:00Z",
    });
    expect(steps.filter((s) => s.at)).toHaveLength(3);
    expect(steps[nextIndex].key).toBe("delivered");
  });

  it("shows no outstanding step once delivered", () => {
    const { nextIndex } = deriveSteps({
      ...baseOrder,
      status: "delivered",
      paid_at: "2026-09-01T11:00:00Z",
      shipped_at: "2026-09-02T09:00:00Z",
      delivered_at: "2026-09-04T14:00:00Z",
    });
    expect(nextIndex).toBe(-1);
  });

  it("collapses a cancelled order instead of promising a payment that will not come", () => {
    const { steps } = deriveSteps({
      ...baseOrder,
      status: "cancelled",
      cancelled_at: "2026-09-01T12:00:00Z",
    });
    expect(steps.map((s) => s.key)).toEqual(["placed", "cancelled"]);
    expect(steps.every((s) => s.at)).toBe(true);
  });

  it("treats a cancelled_at stamp as cancelled even if the status lags", () => {
    const { steps } = deriveSteps({ ...baseOrder, cancelled_at: "2026-09-01T12:00:00Z" });
    expect(steps.map((s) => s.key)).toEqual(["placed", "cancelled"]);
  });

  it("appends a refund step when one happened", () => {
    const { steps } = deriveSteps({
      ...baseOrder,
      status: "refunded",
      paid_at: "2026-09-01T11:00:00Z",
      shipped_at: "2026-09-02T09:00:00Z",
      delivered_at: "2026-09-04T14:00:00Z",
      refunded_at: "2026-09-10T08:00:00Z",
    });
    expect(steps[steps.length - 1].key).toBe("refunded");
  });

  it("falls back to created_at for orders placed before placed_at existed", () => {
    const { steps } = deriveSteps({ ...baseOrder, placed_at: null });
    expect(steps[0].at).toBe(baseOrder.created_at);
  });
});
