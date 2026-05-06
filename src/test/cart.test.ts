import { describe, it, expect, beforeEach } from "vitest";
import { useCart, formatDkk } from "@/lib/cart";

const item = (over: Partial<Parameters<typeof useCart.getState>["0"] extends never ? never : never> = {}) => ({
  productId: "p1",
  name: "Test",
  unitPriceDkk: 100,
  qty: 1,
  ...over,
});

describe("cart store", () => {
  beforeEach(() => {
    useCart.setState({ items: [], isOpen: false });
  });

  it("adds items and computes totals", () => {
    useCart.getState().add(item());
    useCart.getState().add({ productId: "p2", name: "Two", unitPriceDkk: 250, qty: 2 });
    expect(useCart.getState().count()).toBe(3);
    expect(useCart.getState().total()).toBe(100 + 250 * 2);
  });

  it("merges quantities for same productId+variant", () => {
    useCart.getState().add(item({ qty: 1 }));
    useCart.getState().add(item({ qty: 2 }));
    expect(useCart.getState().items).toHaveLength(1);
    expect(useCart.getState().items[0].qty).toBe(3);
  });

  it("setQty=0 removes the line", () => {
    useCart.getState().add(item());
    useCart.getState().setQty("p1", 0);
    expect(useCart.getState().items).toHaveLength(0);
  });

  it("clear empties the cart", () => {
    useCart.getState().add(item());
    useCart.getState().clear();
    expect(useCart.getState().count()).toBe(0);
  });
});

describe("formatDkk", () => {
  it("formats whole kroner with Danish thousands separator", () => {
    expect(formatDkk(1000)).toMatch(/1\.000\s?kr/);
    expect(formatDkk(0)).toMatch(/0\s?kr/);
  });
});
