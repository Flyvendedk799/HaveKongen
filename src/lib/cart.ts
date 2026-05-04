import { create } from "zustand";
import { persist } from "zustand/middleware";

export type CartItem = {
  productId: string;
  variantId?: string;
  name: string;
  variantName?: string;
  unitPriceDkk: number;
  qty: number;
  imageGradient?: string;
  imageSvg?: string;
};

type CartState = {
  items: CartItem[];
  add: (item: CartItem) => void;
  remove: (productId: string, variantId?: string) => void;
  setQty: (productId: string, qty: number, variantId?: string) => void;
  clear: () => void;
  total: () => number;
  count: () => number;
};

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],
      add: (item) =>
        set((s) => {
          const idx = s.items.findIndex((i) => i.productId === item.productId && i.variantId === item.variantId);
          if (idx >= 0) {
            const copy = [...s.items];
            copy[idx] = { ...copy[idx], qty: copy[idx].qty + item.qty };
            return { items: copy };
          }
          return { items: [...s.items, item] };
        }),
      remove: (productId, variantId) =>
        set((s) => ({ items: s.items.filter((i) => !(i.productId === productId && i.variantId === variantId)) })),
      setQty: (productId, qty, variantId) =>
        set((s) => ({
          items: s.items
            .map((i) => (i.productId === productId && i.variantId === variantId ? { ...i, qty } : i))
            .filter((i) => i.qty > 0),
        })),
      clear: () => set({ items: [] }),
      total: () => get().items.reduce((sum, i) => sum + i.unitPriceDkk * i.qty, 0),
      count: () => get().items.reduce((sum, i) => sum + i.qty, 0),
    }),
    { name: "havelandet-cart" }
  )
);

export const formatDkk = (oere: number) => {
  // We store base_price_dkk in DKK already (whole kroner) for most items, but klipper uses øre
  // Convention: values < 100000 are kroner, larger are øre. Simpler: treat the raw int as DKK.
  // We'll keep DKK as the unit everywhere.
  return new Intl.NumberFormat("da-DK").format(oere) + " kr";
};
