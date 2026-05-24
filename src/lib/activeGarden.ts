import { create } from "zustand";
import { persist } from "zustand/middleware";

type State = {
  activeGardenId: string | null;
  setActive: (id: string | null) => void;
};

export const useActiveGarden = create<State>()(
  persist(
    (set) => ({
      activeGardenId: null,
      setActive: (id) => set({ activeGardenId: id }),
    }),
    { name: "havekongen-active-garden" }
  )
);
