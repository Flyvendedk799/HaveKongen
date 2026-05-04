import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AppNav, SiteFooter } from "@/components/layout/SiteChrome";
import { supabase } from "@/integrations/supabase/client";
import { useCart, formatDkk, CartItem } from "@/lib/cart";
import { toast } from "sonner";
import { ShoppingCart } from "lucide-react";

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
};

const CATS = [
  { key: "all", label: "Alt" },
  { key: "froe", label: "Frø & planter" },
  { key: "jord", label: "Jord & gødning" },
  { key: "robot", label: "Robotplæneklippere" },
  { key: "vanding", label: "Vanding" },
];

export default function Webshop() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [params, setParams] = useSearchParams();
  const cat = params.get("cat") || "all";
  const cart = useCart();

  useEffect(() => {
    document.title = "Webshop · Havelandet";
    supabase.from("products").select("*").order("featured", { ascending: false }).then(({ data }) => {
      setProducts((data as Product[]) || []);
      setLoading(false);
    });
  }, []);

  const visible = useMemo(() => products.filter((p) => cat === "all" || p.category === cat), [products, cat]);

  return (
    <>
      <AppNav active="shop" />
      <div className="container">
        <header className="page-head">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 24 }}>
            <div>
              <div className="eyebrow" style={{ marginBottom: 14 }}>Webshop</div>
              <h1>Frø, planter, jord og smarte værktøjer.</h1>
              <p className="lede">Et nøje udvalgt sortiment fra danske leverandører — alt sammen testet i dansk klima.</p>
            </div>
            <Link to="/cart" className="btn btn-ghost btn-sm" style={{ marginTop: 8 }}>
              <ShoppingCart size={14} /> Kurv ({cart.count()})
            </Link>
          </div>
        </header>

        <div className="tabs">
          {CATS.map((c) => (
            <div
              key={c.key}
              className={`tab ${cat === c.key ? "is-active" : ""}`}
              onClick={() => setParams(c.key === "all" ? {} : { cat: c.key })}
            >
              {c.label}
            </div>
          ))}
        </div>

        {loading ? (
          <p style={{ color: "var(--ink-500)", padding: "40px 0" }}>Henter sortiment…</p>
        ) : (
          <div className="shop-grid" style={{ marginBottom: 80 }}>
            {visible.map((p) => (
              <ProductCard key={p.id} product={p} onAdd={() => {
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
              }} />
            ))}
          </div>
        )}
      </div>
      <SiteFooter />
    </>
  );
}

function ProductCard({ product, onAdd }: { product: Product; onAdd: () => void }) {
  return (
    <div className="product">
      <Link to={`/webshop/${product.slug}`}>
        <div className="product-img" style={{ background: product.gradient || "var(--mist-100)" }}>
          {product.svg_art && <div dangerouslySetInnerHTML={{ __html: product.svg_art }} />}
        </div>
      </Link>
      <div className="name">{product.name}</div>
      <div className="meta">{product.meta}</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
        <div className="price">{formatDkk(product.base_price_dkk)}</div>
        <button className="btn btn-ghost btn-sm" onClick={onAdd}>Læg i kurv</button>
      </div>
    </div>
  );
}
