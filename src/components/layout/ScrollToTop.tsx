import { useEffect } from "react";
import { useLocation } from "react-router-dom";

/**
 * Resets scroll position to top on every route change.
 * Without this, navigating via the mobile tab bar (or any <Link>) while
 * scrolled down can leave the new page mounted off-screen, making it look
 * blank until the user refreshes.
 */
export function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    // Use 'auto' to avoid a smooth-scroll animation on navigation.
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [pathname]);
  return null;
}
