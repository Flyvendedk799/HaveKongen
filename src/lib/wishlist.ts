import { create } from "zustand";
import { supabase } from "@/integrations/supabase/client";

type State = {
  ids: Set<string>;
  loaded: boolean;
  load: () => Promise<void>;
  toggle: (productId: string) => Promise<boolean>;
  has: (productId: string) => boolean;
  clear: () => void;
};

export const useWishlist = create<State>((set, get) => ({
  ids: new Set(),
  loaded: false,
  load: async () => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) {
      set({ ids: new Set(), loaded: true });
      return;
    }
    const { data } = await supabase.from("wishlists").select("product_id");
    set({ ids: new Set((data ?? []).map((r: any) => r.product_id)), loaded: true });
  },
  toggle: async (productId) => {
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return false;
    const has = get().ids.has(productId);
    const next = new Set(get().ids);
    if (has) {
      next.delete(productId);
      set({ ids: next });
      await supabase.from("wishlists").delete().eq("product_id", productId).eq("user_id", u.user.id);
      return false;
    } else {
      next.add(productId);
      set({ ids: next });
      await supabase.from("wishlists").insert({ product_id: productId, user_id: u.user.id });
      return true;
    }
  },
  has: (id) => get().ids.has(id),
  clear: () => set({ ids: new Set(), loaded: false }),
}));
