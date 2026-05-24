import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AppNav, SiteFooter } from "@/components/layout/SiteChrome";
import { supabase } from "@/integrations/supabase/client";
import { useCart } from "@/lib/cart";
import { useWishlist } from "@/lib/wishlist";
import { useAuth } from "@/lib/auth";
import { usePageMeta } from "@/hooks/usePageMeta";
import { track } from "@/lib/analytics";
import { toast } from "sonner";
import { HeroStage } from "@/components/pdp/HeroStage";
import { StickyMediaStage } from "@/components/pdp/StickyMediaStage";
import { StickyBuyBar } from "@/components/pdp/StickyBuyBar";
import { FitInGarden } from "@/components/pdp/FitInGarden";
import { SpecsGrid } from "@/components/pdp/SpecsGrid";
import { StoryBand } from "@/components/pdp/StoryBand";
import { ReviewsBlock } from "@/components/pdp/ReviewsBlock";
import { BundleRow } from "@/components/pdp/BundleRow";
import { ProductCarousel } from "@/components/pdp/ProductCarousel";

type Product = {
  id: string;
  slug: string;
  name: string;
  category: string;
  short_description: string | null;
  description: string | null;
  base_price_dkk: number;
  gradient: string | null;
  svg_art: string | null;
  meta: string | null;
  in_stock: boolean;
};

const RV_KEY = "havekongen-recently-viewed";
function pushRecent(slug: string) {
  try {
    const arr: string[] = JSON.parse(localStorage.getItem(RV_KEY) || "[]");
    const next = [slug, ...arr.filter((s) => s !== slug)].slice(0, 6);
    localStorage.setItem(RV_KEY, JSON.stringify(next));
  } catch {}
}

export default function ProductDetail() {
  const { slug } = useParams();
  const [p, setP] = useState<Product | null>(null);
  const [related, setRelated] = useState<Product[]>([]);
  const [recent, setRecent] = useState<Product[]>([]);
  const [qty, setQty] = useState(1);
  const cart = useCart();
  const wishlist = useWishlist();
  const { user } = useAuth();
  const nav = useNavigate();

  usePageMeta({
    title: p ? `${p.name} · Havekongen` : "Produkt · Havekongen",
    description: p?.short_description || p?.meta || undefined,
  });

  useEffect(() => {
    if (!slug) return;
    setP(null);
    supabase.from("products").select("*").eq("slug", slug).maybeSingle().then(async ({ data }) => {
      const prod = data as Product | null;
      setP(prod);
      if (prod) {
        track("pdp_view", { slug: prod.slug, category: prod.category });
        pushRecent(prod.slug);
        const { data: rel } = await supabase
          .from("products")
          .select("*")
          .eq("category", prod.category)
          .neq("id", prod.id)
          .limit(6);
        setRelated((rel as Product[]) || []);
        const slugs: string[] = JSON.parse(localStorage.getItem(RV_KEY) || "[]");
        const others = slugs.filter((s) => s !== prod.slug).slice(0, 6);
        if (others.length) {
          const { data: rv } = await supabase.from("products").select("*").in("slug", others);
          setRecent((rv as Product[]) || []);
        } else setRecent([]);
        window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
      }
    });
  }, [slug]);

  useEffect(() => { if (user) wishlist.load(); }, [user]); // eslint-disable-line

  const specs = useMemo(() => {
    if (!p) return [];
    return [
      { label: "Kategori", value: p.category },
      { label: "Lager", value: p.in_stock ? "På lager" : "Udsolgt" },
      { label: "Egnet til", value: p.meta || "Have & terrasse" },
      { label: "Oprindelse", value: "Designet i Danmark" },
      { label: "Garanti", value: "5 års garanti" },
      { label: "Fragt", value: "1–3 hverdage" },
    ];
  }, [p]);

  if (!p) {
    return (
      <>
        <AppNav active="shop" />
        <div className="container" style={{ padding: "120px 32px" }}>Henter…</div>
        <SiteFooter />
      </>
    );
  }

  const addToCart = () => {
    cart.add({
      productId: p.id,
      name: p.name,
      unitPriceDkk: p.base_price_dkk,
      qty,
      imageGradient: p.gradient || undefined,
      imageSvg: p.svg_art || undefined,
    });
    toast.success(`${p.name} tilføjet`);
  };
  const buyNow = () => { addToCart(); nav("/checkout"); };

  const wished = wishlist.has(p.id);
  const onWish = async () => {
    if (!user) { toast("Log ind for at gemme favoritter."); return; }
    await wishlist.toggle(p.id);
  };

  // JSON-LD
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: p.name,
    description: p.description || p.short_description || undefined,
    category: p.category,
    offers: {
      "@type": "Offer",
      price: p.base_price_dkk,
      priceCurrency: "DKK",
      availability: p.in_stock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    },
  };

  const bundleItems = related.slice(0, 2).length === 2
    ? [{ id: p.id, name: p.name, base_price_dkk: p.base_price_dkk, gradient: p.gradient, svg_art: p.svg_art }, ...related.slice(0, 2)]
    : [];

  return (
    <>
      <AppNav active="shop" />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />

      <div className="pdp-crumbs container">
        <Link to="/webshop">← Webshop</Link>
        <span> / {p.category} / {p.name}</span>
      </div>

      <HeroStage
        name={p.name}
        category={p.category}
        meta={p.meta}
        short={p.short_description}
        price={p.base_price_dkk}
        inStock={p.in_stock}
        gradient={p.gradient}
        svg={p.svg_art}
        qty={qty}
        setQty={setQty}
        onAdd={addToCart}
        onBuy={buyNow}
        onWish={onWish}
        wished={wished}
      />

      <StickyMediaStage gradient={p.gradient} svg={p.svg_art} />

      <div className="container">
        <FitInGarden productName={p.name} />
        <SpecsGrid specs={specs} />
      </div>

      <StoryBand gradient={p.gradient} name={p.name} body={p.description || p.short_description} />

      <div className="container">
        <ReviewsBlock />
        {bundleItems.length > 0 && <BundleRow items={bundleItems} />}
        <ProductCarousel title="Relaterede produkter" items={related.slice(0, 6)} />
        {recent.length > 0 && <ProductCarousel title="Set for nylig" items={recent} />}
      </div>

      <StickyBuyBar
        name={p.name}
        price={p.base_price_dkk}
        qty={qty}
        setQty={setQty}
        onAdd={addToCart}
        onBuy={buyNow}
        inStock={p.in_stock}
      />

      <SiteFooter />
    </>
  );
}
