import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AppNav, SiteFooter } from "@/components/layout/SiteChrome";
import { supabase } from "@/integrations/supabase/client";
import { useCart, formatDkk, CartItem } from "@/lib/cart";
import { useWishlist } from "@/lib/wishlist";
import { useAuth } from "@/lib/auth";
import { usePageMeta } from "@/hooks/usePageMeta";
import { toast } from "sonner";
import { Heart } from "lucide-react";

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
  featured?: boolean;
  created_at?: string;
};

const CATS = [
  { key: "all", label: "Alt" },
  { key: "froe", label: "Frø & planter" },
  { key: "jord", label: "Jord & gødning" },
  { key: "robot", label: "Robotplæneklippere" },
  { key: "vanding", label: "Vanding" },
];

type Sort = "featured" | "newest" | "price-asc" | "price-desc";

export default function Webshop() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [params, setParams] = useSearchParams();
  const cat = params.get("cat") || "all";
  const sort = (params.get("sort") || "featured") as Sort;
  const inStockOnly = params.get("stock") === "1";
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
    supabase.from("products").select("*").order("featured", { ascending: false }).then(({ data }) => {
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
    let list = products.filter((p) => cat === "all" || p.category === cat);
    if (inStockOnly) list = list.filter((p) => p.in_stock);
    if (minP > 0) list = list.filter((p) => p.base_price_dkk >= minP);
    if (maxP > 0) list = list.filter((p) => p.base_price_dkk <= maxP);
    if (sort === "price-asc") list = [...list].sort((a, b) => a.base_price_dkk - b.base_price_dkk);
    else if (sort === "price-desc") list = [...list].sort((a, b) => b.base_price_dkk - a.base_price_dkk);
    else if (sort === "newest") list = [...list].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    return list;
  }, [products, cat, sort, inStockOnly, minP, maxP]);

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
            Ingen produkter matcher filtrene. <button className="btn btn-ghost btn-sm" onClick={() => setParams({})}>Nulstil</button>
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
        {!product.in_stock && <span className="stock-pill out">Udsolgt</span>}
      </div>
      <div className="meta">{product.meta}</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
        <div className="price">{formatDkk(product.base_price_dkk)}</div>
        <button className="btn btn-ghost btn-sm" onClick={onAdd} disabled={!product.in_stock}>
          Læg i kurv
        </button>
      </div>
    </div>
  );
}
