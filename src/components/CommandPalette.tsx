import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { create } from "zustand";
import { Command } from "cmdk";
import { supabase } from "@/integrations/supabase/client";
import {
  ShoppingBag,
  Ruler,
  Droplets,
  Sparkles,
  User as UserIcon,
  ShoppingCart,
  Home,
  Leaf,
} from "lucide-react";

type PaletteState = {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
};

export const useCommandPalette = create<PaletteState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
  toggle: () => set((s) => ({ isOpen: !s.isOpen })),
}));

type ProductHit = { id: string; name: string; slug: string; category: string };
type PlantHit = { slug: string; name_da: string; latin: string | null };

const PAGES: { label: string; to: string; hint?: string; icon: JSX.Element }[] = [
  { label: "Forsiden", to: "/", icon: <Home size={16} /> },
  { label: "Webshop", to: "/webshop", icon: <ShoppingBag size={16} /> },
  { label: "Havemåler", to: "/havemaaler", hint: "Mål din have", icon: <Ruler size={16} /> },
  { label: "Vandingsplan", to: "/vanding", hint: "Planlæg vanding", icon: <Droplets size={16} /> },
  { label: "Plantepleje AI", to: "/ai", hint: "Spørg AI'en", icon: <Sparkles size={16} /> },
  { label: "Min konto", to: "/konto", icon: <UserIcon size={16} /> },
  { label: "Kurv", to: "/cart", icon: <ShoppingCart size={16} /> },
];

export function CommandPalette() {
  const { isOpen, open, close, toggle } = useCommandPalette();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [products, setProducts] = useState<ProductHit[]>([]);
  const [plants, setPlants] = useState<PlantHit[]>([]);

  // Global ⌘K / Ctrl+K toggle
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        toggle();
      }
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, close]);

  // Reset query on close
  useEffect(() => {
    if (!isOpen) setQuery("");
  }, [isOpen]);

  // Load lightweight catalogs once when first opened
  useEffect(() => {
    if (!isOpen) return;
    if (products.length === 0) {
      supabase
        .from("products")
        .select("id, name, slug, category")
        .limit(200)
        .then(({ data }) => setProducts((data as ProductHit[]) || []));
    }
    if (plants.length === 0) {
      supabase
        .from("plants_catalog")
        .select("slug, name_da, latin")
        .limit(200)
        .then(({ data }) => setPlants((data as PlantHit[]) || []));
    }
  }, [isOpen, products.length, plants.length]);

  if (!isOpen) return null;

  const go = (to: string) => {
    close();
    navigate(to);
  };

  return (
    <div className="cmdk-backdrop" onClick={close} role="presentation">
      <div className="cmdk-shell" onClick={(e) => e.stopPropagation()}>
        <Command shouldFilter label="Global søgning">
          <div className="cmdk-input-row">
            <Command.Input
              autoFocus
              value={query}
              onValueChange={setQuery}
              placeholder="Søg sider, produkter, planter…"
              className="cmdk-input"
            />
            <kbd className="cmdk-esc">esc</kbd>
          </div>
          <Command.List className="cmdk-list">
            <Command.Empty className="cmdk-empty">Intet match.</Command.Empty>

            <Command.Group heading="Sider" className="cmdk-group">
              {PAGES.map((p) => (
                <Command.Item
                  key={p.to}
                  value={`page ${p.label} ${p.hint ?? ""}`}
                  onSelect={() => go(p.to)}
                  className="cmdk-item"
                >
                  <span className="cmdk-icon">{p.icon}</span>
                  <span className="cmdk-label">{p.label}</span>
                  {p.hint && <span className="cmdk-hint">{p.hint}</span>}
                </Command.Item>
              ))}
            </Command.Group>

            {products.length > 0 && (
              <Command.Group heading="Produkter" className="cmdk-group">
                {products.slice(0, 12).map((p) => (
                  <Command.Item
                    key={p.id}
                    value={`product ${p.name} ${p.category}`}
                    onSelect={() => go(`/webshop/${p.slug}`)}
                    className="cmdk-item"
                  >
                    <span className="cmdk-icon"><ShoppingBag size={16} /></span>
                    <span className="cmdk-label">{p.name}</span>
                    <span className="cmdk-hint">{p.category}</span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {plants.length > 0 && (
              <Command.Group heading="Planter" className="cmdk-group">
                {plants.slice(0, 12).map((p) => (
                  <Command.Item
                    key={p.slug}
                    value={`plant ${p.name_da} ${p.latin ?? ""}`}
                    onSelect={() => go(`/ai?plant=${encodeURIComponent(p.slug)}`)}
                    className="cmdk-item"
                  >
                    <span className="cmdk-icon"><Leaf size={16} /></span>
                    <span className="cmdk-label">{p.name_da}</span>
                    {p.latin && <span className="cmdk-hint">{p.latin}</span>}
                  </Command.Item>
                ))}
              </Command.Group>
            )}
          </Command.List>
          <div className="cmdk-foot">
            <span><kbd>↑↓</kbd> naviger</span>
            <span><kbd>↵</kbd> vælg</span>
            <span><kbd>⌘K</kbd> åbn/luk</span>
          </div>
        </Command>
      </div>
    </div>
  );
}

// Re-export the opener so other modules don't need to import zustand directly
export const openCommandPalette = () => useCommandPalette.getState().open();
