import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AppNav, SiteFooter } from "@/components/layout/SiteChrome";
import { supabase } from "@/integrations/supabase/client";
import { useCart, formatDkk, CartItem } from "@/lib/cart";
import { useWishlist } from "@/lib/wishlist";
import { useAuth } from "@/lib/auth";
import { usePageMeta } from "@/hooks/usePageMeta";
import { toast } from "sonner";
import { Heart, Search, Star, X } from "lucide-react";

type Product = {
  id: string;
  slug: string;
  name: string;
  category: string;
  short_description: string | null;
  base_price_dkk: number;
  gradient: string | null;
  svg_art: string | null;
  meta: string | null;
  in_stock: boolean;
  stock_qty: number;
  track_inventory: boolean;
  low_stock_threshold: number;
  rating_avg: number;
  rating_count: number;
  active: boolean;
  featured?: boolean;
  created_at?: string;
};

/**
 * Whether a product can be put in a basket, using the same rule as the pricing
 * engine: track_inventory decides whether stock_qty means anything, and an
 * uncounted product falls back to the in_stock flag.
 */
export function isSellable(p: Pick<Product, "in_stock" | "stock_qty" | "track_inventory">): boolean {
  return p.track_inventory ? p.stock_qty > 0 : p.in_stock;
}

const CATS = [
  { key: "all", label: "Alt" },
  { key: "froe", label: "Frø & planter" },
  { key: "jord", label: "Jord & gødning" },
  { key: "robot", label: "Robotplæneklippere" },
  { key: "vanding", label: "Vanding" },
];

type Sort = "featured" | "newest" | "price-asc" | "price-desc" | "rating";

export default function Webshop() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [params, setParams] = useSearchParams();
  const cat = params.get("cat") || "all";
  const sort = (params.get("sort") || "featured") as Sort;
  const inStockOnly = params.get("stock") === "1";
  const q = params.get("q") ?? "";
  const minP = Number(params.get("min") || 0);
  const maxP = Number(params.get("max") || 0);
  const cart = useCart();
  const { user } = useAuth();
  const wishlist = useWishlist();

  usePageMeta({
    title: "Webshop · Havekongen",
    description: "Frø, planter, jord og smarte værktøjer fra danske leverandører — testet i dansk klima.",
  });

  useEffect(() => {
    supabase.from("products").select("*").eq("active", true).order("featured", { ascending: false }).then(({ data }) => {
      setProducts((data as Product[]) || []);
      setLoading(false);
    });
  }, []);

  useEffect(() => { if (user) wishlist.load(); }, [user]); // eslint-disable-line

  const updateParam = (k: string, v: string | null) => {
    const np = new URLSearchParams(params);
    if (!v) np.delete(k); else np.set(k, v);
    setParams(np, { replace: true });
  };

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let list = products.filter((p) => cat === "all" || p.category === cat);
    if (needle) {
      list = list.filter((p) =>
        [p.name, p.short_description, p.meta, p.category]
          .some((field) => (field ?? "").toLowerCase().includes(needle)),
      );
    }
    if (inStockOnly) list = list.filter(isSellable);
    if (minP > 0) list = list.filter((p) => p.base_price_dkk >= minP);
    if (maxP > 0) list = list.filter((p) => p.base_price_dkk <= maxP);
    if (sort === "price-asc") list = [...list].sort((a, b) => a.base_price_dkk - b.base_price_dkk);
    else if (sort === "price-desc") list = [...list].sort((a, b) => b.base_price_dkk - a.base_price_dkk);
    else if (sort === "newest") list = [...list].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    else if (sort === "rating") {
      // Unrated products sink rather than tying at zero with genuinely bad ones.
      list = [...list].sort(
        (a, b) => b.rating_avg - a.rating_avg || b.rating_count - a.rating_count,
      );
    }
    return list;
  }, [products, cat, sort, inStockOnly, minP, maxP, q]);

  return (
    <>
      <AppNav active="shop" />
      <div className="container">
        <header className="page-head">
          <div className="eyebrow" style={{ marginBottom: 14 }}>Webshop</div>
          <h1>Frø, planter, jord og smarte værktøjer.</h1>
          <p className="lede">Et nøje udvalgt sortiment fra danske leverandører — alt sammen testet i dansk klima.</p>
        </header>

        <div className="tabs">
          {CATS.map((c) => (
            <div
              key={c.key}
              className={`tab ${cat === c.key ? "is-active" : ""}`}
              onClick={() => updateParam("cat", c.key === "all" ? null : c.key)}
            >
              {c.label}
            </div>
          ))}
        </div>

        <div className="shop-filterbar">
          <div className="shop-search">
            <Search size={15} />
            <input
              type="search"
              value={q}
              onChange={(e) => updateParam("q", e.target.value || null)}
              placeholder="Søg i sortimentet…"
              aria-label="Søg i sortimentet"
            />
            {q && (
              <button type="button" className="clear" onClick={() => updateParam("q", null)} aria-label="Ryd søgning">
                <X size={14} />
              </button>
            )}
          </div>
          <label className="chip" style={{ cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={inStockOnly}
              onChange={(e) => updateParam("stock", e.target.checked ? "1" : null)}
              style={{ marginRight: 6 }}
            />
            På lager
          </label>
          <div className="range-input">
            <span>Pris:</span>
            <input
              type="number"
              placeholder="min"
              value={minP || ""}
              onChange={(e) => updateParam("min", e.target.value || null)}
            />
            <span>–</span>
            <input
              type="number"
              placeholder="maks"
              value={maxP || ""}
              onChange={(e) => updateParam("max", e.target.value || null)}
            />
            <span>kr</span>
          </div>
          <div className="grow" />
          <div style={{ fontSize: 13, color: "var(--ink-500)" }}>{visible.length} produkter</div>
          <select
            value={sort}
            onChange={(e) => updateParam("sort", e.target.value === "featured" ? null : e.target.value)}
            style={{ padding: "8px 12px", borderRadius: 999, border: "1px solid rgba(20,39,29,0.15)", background: "var(--paper)", fontSize: 13 }}
          >
            <option value="featured">Fremhævede</option>
            <option value="newest">Nyeste</option>
            <option value="price-asc">Pris: lav → høj</option>
            <option value="price-desc">Pris: høj → lav</option>
            <option value="rating">Bedst bedømt</option>
          </select>
        </div>

        {loading ? (
          <div className="shop-grid" style={{ marginBottom: 80 }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="product product-skeleton" aria-hidden="true">
                <div className="product-img skeleton-block" />
                <div className="skeleton-line" style={{ width: "70%" }} />
                <div className="skeleton-line" style={{ width: "40%", height: 10 }} />
                <div className="skeleton-line" style={{ width: "30%", height: 14 }} />
              </div>
            ))}
          </div>
        ) : visible.length === 0 ? (
          <div style={{ padding: "60px 0", textAlign: "center", color: "var(--ink-500)" }}>
            {q ? `Ingen produkter matcher "${q}".` : "Ingen produkter matcher filtrene."}{" "}
            <button className="btn btn-ghost btn-sm" onClick={() => setParams({})}>Nulstil</button>
          </div>
        ) : (
          <div className="shop-grid" style={{ marginBottom: 80 }}>
            {visible.map((p) => (
              <ProductCard
                key={p.id}
                product={p}
                onAdd={() => {
                  const item: CartItem = {
                    productId: p.id,
                    name: p.name,
                    unitPriceDkk: p.base_price_dkk,
                    qty: 1,
                    imageGradient: p.gradient || undefined,
                    imageSvg: p.svg_art || undefined,
                  };
                  cart.add(item);
                  toast.success(`${p.name} tilføjet`);
                }}
                onWish={async () => {
                  if (!user) { toast("Log ind for at gemme favoritter."); return; }
                  await wishlist.toggle(p.id);
                }}
                wished={wishlist.has(p.id)}
              />
            ))}
          </div>
        )}
      </div>
      <SiteFooter />
    </>
  );
}

function ProductCard({ product, onAdd, onWish, wished }: { product: Product; onAdd: () => void; onWish: () => void; wished: boolean }) {
  const sellable = isSellable(product);
  return (
    <div className="product">
      <button
        type="button"
        className={`wish-btn ${wished ? "is-on" : ""}`}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onWish(); }}
        aria-label={wished ? "Fjern fra favoritter" : "Gem som favorit"}
      >
        <Heart size={16} fill={wished ? "currentColor" : "none"} />
      </button>
      <Link to={`/webshop/${product.slug}`}>
        <div className="product-img" style={{ background: product.gradient || "var(--mist-100)" }}>
          {product.svg_art && <div dangerouslySetInnerHTML={{ __html: product.svg_art }} />}
        </div>
      </Link>
      <div className="name">
        {product.name}
        {!sellable && <span className="stock-pill out">Udsolgt</span>}
      </div>
      <div className="meta">{product.meta}</div>
      {product.rating_count > 0 && (
        <div className="rating-inline" aria-label={`${product.rating_avg.toFixed(1)} ud af 5`}>
          <Star size={12} fill="currentColor" style={{ color: "var(--gold-600)" }} />
          {product.rating_avg.toFixed(1)} ({product.rating_count})
        </div>
      )}
      {sellable && product.track_inventory && product.stock_qty <= product.low_stock_threshold && (
        <div className="stock-line low">Kun {product.stock_qty} tilbage</div>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
        <div className="price">{formatDkk(product.base_price_dkk)}</div>
        <button className="btn btn-ghost btn-sm" onClick={onAdd} disabled={!sellable}>
          Læg i kurv
        </button>
      </div>
    </div>
  );
}
