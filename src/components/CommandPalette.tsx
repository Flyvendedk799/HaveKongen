import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { create } from "zustand";
import { Command } from "cmdk";
import { searchCatalog, type SearchHit } from "@/lib/shop";
import {
  ShoppingBag,
  Ruler,
  Sparkles,
  User as UserIcon,
  ShoppingCart,
  Home,
  Leaf,
  PawPrint,
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



const PAGES: { label: string; to: string; hint?: string; icon: JSX.Element }[] = [
  { label: "Forsiden", to: "/", icon: <Home size={16} /> },
  { label: "Webshop", to: "/webshop", icon: <ShoppingBag size={16} /> },
  { label: "Havemåler", to: "/havemaaler", hint: "Mål din have", icon: <Ruler size={16} /> },
  { label: "Havekompagnon", to: "/havekompagnon", hint: "Kort, scan og plejeplan", icon: <Leaf size={16} /> },
  { label: "Dyreliv", to: "/dyreliv", hint: "Planter, insekter og dyr", icon: <PawPrint size={16} /> },
  { label: "Plantepleje AI", to: "/ai", hint: "Spørg AI'en", icon: <Sparkles size={16} /> },
  { label: "Min konto", to: "/konto", icon: <UserIcon size={16} /> },
  { label: "Kurv", to: "/cart", icon: <ShoppingCart size={16} /> },
  { label: "Kontakt", to: "/kontakt", hint: "Skriv til os", icon: <UserIcon size={16} /> },
  { label: "Levering og retur", to: "/levering-og-retur", hint: "Fragt, retur, reklamation", icon: <ShoppingBag size={16} /> },
  { label: "Handelsbetingelser", to: "/handelsbetingelser", icon: <ShoppingBag size={16} /> },
];

export function CommandPalette() {
  const { isOpen, open, close, toggle } = useCommandPalette();
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searching, setSearching] = useState(false);

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

  // Search runs in the database via search_catalog(), which uses Danish
  // stemming — so "planter" finds "plante" — and covers the whole catalogue
  // rather than the first 200 rows we happened to download.
  useEffect(() => {
    if (!isOpen) return;
    const term = query.trim();
    if (term.length < 2) {
      setHits([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let cancelled = false;
    const timer = setTimeout(() => {
      searchCatalog(term, 16)
        .then((rows) => {
          // A slow response for an old query must not overwrite a newer one.
          if (!cancelled) setHits(rows);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, isOpen]);

  // Pages are filtered locally; there is no point round-tripping for eight
  // static entries.
  const pageHits = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return PAGES;
    return PAGES.filter((p) => `${p.label} ${p.hint ?? ""}`.toLowerCase().includes(needle));
  }, [query]);

  const productHits = useMemo(() => hits.filter((h) => h.kind === "product"), [hits]);
  const plantHits = useMemo(() => hits.filter((h) => h.kind === "plant"), [hits]);

  if (!isOpen) return null;

  const go = (to: string) => {
    close();
    navigate(to);
  };

  return (
    <div className="cmdk-backdrop" onClick={close} role="presentation">
      <div className="cmdk-shell" onClick={(e) => e.stopPropagation()}>
        <Command shouldFilter={false} label="Global søgning">
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
            {pageHits.length === 0 && hits.length === 0 && (
              <div className="cmdk-empty">
                {searching ? "Søger…" : query.trim().length < 2 ? "Skriv for at søge." : "Intet match."}
              </div>
            )}

            {pageHits.length > 0 && (
            <Command.Group heading="Sider" className="cmdk-group">
              {pageHits.map((p) => (
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
            )}

            {productHits.length > 0 && (
              <Command.Group heading="Produkter" className="cmdk-group">
                {productHits.map((p) => (
                  <Command.Item
                    key={p.id}
                    value={p.id}
                    onSelect={() => go(`/webshop/${p.slug}`)}
                    className="cmdk-item"
                  >
                    <span className="cmdk-icon"><ShoppingBag size={16} /></span>
                    <span className="cmdk-label">{p.title}</span>
                    <span className="cmdk-hint">
                      {p.price_dkk != null ? `${p.price_dkk} kr` : p.category}
                    </span>
                  </Command.Item>
                ))}
              </Command.Group>
            )}

            {plantHits.length > 0 && (
              <Command.Group heading="Planter" className="cmdk-group">
                {plantHits.map((p) => (
                  <Command.Item
                    key={p.slug}
                    value={p.slug}
                    onSelect={() => go(`/ai?plant=${encodeURIComponent(p.slug)}`)}
                    className="cmdk-item"
                  >
                    <span className="cmdk-icon"><Leaf size={16} /></span>
                    <span className="cmdk-label">{p.title}</span>
                    {p.subtitle && <span className="cmdk-hint">{p.subtitle}</span>}
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
