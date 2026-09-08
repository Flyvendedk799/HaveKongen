import { useEffect, useState } from "react";
import { AppNav, SiteFooter } from "@/components/layout/SiteChrome";
import { usePageMeta } from "@/hooks/usePageMeta";
import { fetchCompany, type ShopCompany } from "@/lib/shop";

/** Fallback used until shop_settings answers — and if it never does. */
export const FALLBACK_COMPANY: ShopCompany = {
  name: "Havekongen ApS",
  cvr: "44881230",
  address: "Havnegade 12, 1058 København K",
  email: "hej@havekongen.dk",
  phone: "+45 71 99 12 30",
  support_hours: "Man-fre 9-16",
};

/**
 * Company details are read from shop_settings rather than hard-coded into six
 * different pages, so a change of address or CVR is one row, not a deploy.
 */
export function useCompany(): ShopCompany {
  const [company, setCompany] = useState<ShopCompany>(FALLBACK_COMPANY);
  useEffect(() => {
    fetchCompany()
      .then((c) => c && setCompany(c))
      .catch(() => {
        /* keep the fallback */
      });
  }, []);
  return company;
}

export function LegalPage({
  title,
  description,
  updated,
  toc,
  children,
}: {
  title: string;
  description: string;
  updated: string;
  toc?: { id: string; label: string }[];
  children: React.ReactNode;
}) {
  usePageMeta({ title: `${title} · Havekongen`, description });

  return (
    <>
      <AppNav />
      <div className="container legal-page">
        <header className="page-head">
          <div className="eyebrow" style={{ marginBottom: 14 }}>Havekongen</div>
          <h1>{title}</h1>
          <p className="legal-updated">Senest opdateret {updated}</p>
        </header>

        {toc && toc.length > 0 && (
          <nav className="legal-toc" aria-label="Indhold">
            <ul>
              {toc.map((t) => (
                <li key={t.id}>
                  <a href={`#${t.id}`}>{t.label}</a>
                </li>
              ))}
            </ul>
          </nav>
        )}

        {children}
      </div>
      <SiteFooter />
    </>
  );
}
