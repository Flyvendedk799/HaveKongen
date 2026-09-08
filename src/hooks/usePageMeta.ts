import { useEffect } from "react";

type PageMeta = {
  title: string;
  description?: string;
  canonical?: string;
  /** Absolute URL for og:image / twitter:image. */
  image?: string;
  /** Keep the page out of search results — carts, checkouts, account pages. */
  noindex?: boolean;
  /** schema.org document injected as application/ld+json for this page only. */
  jsonLd?: Record<string, unknown> | null;
};

const setMeta = (name: string, content: string, attr: "name" | "property" = "name") => {
  if (!content) return;
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${name}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
};

const setLink = (rel: string, href: string) => {
  if (!href) return;
  let el = document.head.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!el) {
    el = document.createElement("link");
    el.setAttribute("rel", rel);
    document.head.appendChild(el);
  }
  el.setAttribute("href", href);
};

const ROBOTS_ID = "page-robots";
const JSONLD_ID = "page-jsonld";

/**
 * Lightweight per-page meta updater. Sets <title>, meta description, canonical
 * URL, Open Graph tags and — new in v2 — a robots directive and page-scoped
 * JSON-LD.
 *
 * The robots tag and the JSON-LD block *are* removed on unmount, unlike the
 * rest: leaving a stale noindex behind would quietly de-index the next page,
 * and leaving a product's structured data on the contact page is worse than
 * having none.
 */
export function usePageMeta({ title, description, canonical, image, noindex, jsonLd }: PageMeta) {
  useEffect(() => {
    if (title) document.title = title;
    if (description) {
      setMeta("description", description);
      setMeta("og:description", description, "property");
      setMeta("twitter:description", description);
    }
    if (title) {
      setMeta("og:title", title, "property");
      setMeta("twitter:title", title);
    }
    if (image) {
      setMeta("og:image", image, "property");
      setMeta("twitter:image", image);
    }
    const url = canonical || (typeof window !== "undefined" ? window.location.origin + window.location.pathname : "");
    if (url) {
      setLink("canonical", url);
      setMeta("og:url", url, "property");
    }
  }, [title, description, canonical, image]);

  useEffect(() => {
    if (!noindex) return;
    const el = document.createElement("meta");
    el.setAttribute("name", "robots");
    el.setAttribute("content", "noindex, nofollow");
    el.setAttribute("data-id", ROBOTS_ID);
    document.head.appendChild(el);
    return () => el.remove();
  }, [noindex]);

  useEffect(() => {
    if (!jsonLd) return;
    const el = document.createElement("script");
    el.type = "application/ld+json";
    el.setAttribute("data-id", JSONLD_ID);
    el.textContent = JSON.stringify(jsonLd);
    document.head.appendChild(el);
    return () => el.remove();
  }, [jsonLd]);
}
