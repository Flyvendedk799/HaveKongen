import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, useLocation } from "react-router-dom";
import { Suspense, lazy, useEffect } from "react";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth";
import { track } from "@/lib/analytics";
import Index from "./pages/Index.tsx";
import { MobileTabBar } from "./components/layout/MobileTabBar.tsx";
import { ScrollToTop } from "./components/layout/ScrollToTop.tsx";
import { CommandPalette } from "./components/CommandPalette.tsx";
import { RouteTransition } from "./components/layout/RouteTransition.tsx";
import { MiniCart } from "./components/MiniCart.tsx";
import { OnboardingWizard } from "./components/OnboardingWizard.tsx";
import { ErrorBoundary } from "./components/layout/ErrorBoundary.tsx";
import { CookieConsent } from "./components/CookieConsent.tsx";
import { RouteLoader } from "./components/layout/RouteLoader.tsx";

// Lazy-loaded routes — each ships in its own chunk so the landing page stays light.
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const Webshop = lazy(() => import("./pages/Webshop.tsx"));
const ProductDetail = lazy(() => import("./pages/ProductDetail.tsx"));
const CartPage = lazy(() => import("./pages/CartPage.tsx"));
const AuthPage = lazy(() => import("./pages/AuthPage.tsx"));
const ResetPassword = lazy(() => import("./pages/ResetPassword.tsx"));
const GardenSizer = lazy(() => import("./pages/GardenSizer.tsx"));
const GardenMobileScan = lazy(() => import("./pages/GardenMobileScan.tsx"));
const GardenTwinBuilder = lazy(() => import("./pages/GardenTwinBuilder.tsx"));
const GardenCompanion = lazy(() => import("./pages/GardenCompanion.tsx"));
const GardenWildlife = lazy(() => import("./pages/GardenWildlife.tsx"));
const PlantCareAI = lazy(() => import("./pages/PlantCareAI.tsx"));
const MinHave = lazy(() => import("./pages/MinHave.tsx"));
const Account = lazy(() => import("./pages/Account.tsx"));
const Checkout = lazy(() => import("./pages/Checkout.tsx"));
const OrderConfirmation = lazy(() => import("./pages/OrderConfirmation.tsx"));
const AdminLayout = lazy(() => import("./pages/admin/AdminLayout.tsx"));
const AdminDashboard = lazy(() => import("./pages/admin/AdminDashboard.tsx"));
const AdminProducts = lazy(() => import("./pages/admin/AdminProducts.tsx"));
const AdminProductEditor = lazy(() => import("./pages/admin/AdminProductEditor.tsx"));
const AdminPlants = lazy(() => import("./pages/admin/AdminPlants.tsx"));
const AdminPlantEditor = lazy(() => import("./pages/admin/AdminPlantEditor.tsx"));
const AdminOrders = lazy(() => import("./pages/admin/AdminOrders.tsx"));
const AdminOrderDetail = lazy(() => import("./pages/admin/AdminOrderDetail.tsx"));
const AdminUsers = lazy(() => import("./pages/admin/AdminUsers.tsx"));
const AdminMedia = lazy(() => import("./pages/admin/AdminMedia.tsx"));
const AdminContent = lazy(() => import("./pages/admin/AdminContent.tsx"));
const AdminNotifications = lazy(() => import("./pages/admin/AdminNotifications.tsx"));
const AdminAnalytics = lazy(() => import("./pages/admin/AdminAnalytics.tsx"));
const AdminAudit = lazy(() => import("./pages/admin/AdminAudit.tsx"));
const AdminReviews = lazy(() => import("./pages/admin/AdminReviews.tsx"));
const AdminInbox = lazy(() => import("./pages/admin/AdminInbox.tsx"));
const AdminDiscounts = lazy(() => import("./pages/admin/AdminDiscounts.tsx"));

// Legal and company pages. A Danish webshop is required to publish most of
// these, and the checkout links straight into them.
const Terms = lazy(() => import("./pages/legal/Terms.tsx"));
const Privacy = lazy(() => import("./pages/legal/Privacy.tsx"));
const Cookies = lazy(() => import("./pages/legal/Cookies.tsx"));
const Shipping = lazy(() => import("./pages/legal/Shipping.tsx"));
const Contact = lazy(() => import("./pages/legal/Contact.tsx"));
const About = lazy(() => import("./pages/legal/About.tsx"));

const queryClient = new QueryClient();

function PageviewTracker() {
  const { pathname } = useLocation();
  useEffect(() => {
    track("page_view", { path: pathname });
  }, [pathname]);
  return null;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <a href="#main" className="skip-link">Spring til indhold</a>
          <ScrollToTop />
          <PageviewTracker />
          <ErrorBoundary>
            <RouteTransition>
              <main id="main" tabIndex={-1}>
                <Suspense fallback={<RouteLoader />}>
                  <Routes>
                    <Route path="/" element={<Index />} />
                    <Route path="/webshop" element={<Webshop />} />
                    <Route path="/webshop/:slug" element={<ProductDetail />} />
                    <Route path="/cart" element={<CartPage />} />
                    <Route path="/login" element={<AuthPage initialMode="login" />} />
                    <Route path="/signup" element={<AuthPage initialMode="signup" />} />
                    <Route path="/reset-password" element={<ResetPassword />} />
                    <Route path="/min-have" element={<MinHave />} />
                    <Route path="/havemaaler" element={<GardenSizer />} />
                    <Route path="/havemaaler/3d" element={<GardenTwinBuilder />} />
                    <Route path="/havemaaler/scan" element={<GardenTwinBuilder />} />
                    <Route path="/havekompagnon" element={<GardenCompanion />} />
                    <Route path="/dyreliv" element={<GardenWildlife />} />
                    <Route path="/vanding" element={<GardenCompanion />} />
                    <Route path="/ai" element={<PlantCareAI />} />
                    <Route path="/konto" element={<Account />} />
                    <Route path="/checkout" element={<Checkout />} />
                    <Route path="/order/:id" element={<OrderConfirmation />} />
                    <Route path="/om" element={<About />} />
                    <Route path="/kontakt" element={<Contact />} />
                    <Route path="/handelsbetingelser" element={<Terms />} />
                    <Route path="/privatliv" element={<Privacy />} />
                    <Route path="/cookies" element={<Cookies />} />
                    <Route path="/levering-og-retur" element={<Shipping />} />
                    <Route path="/admin" element={<AdminLayout />}>
                      <Route index element={<AdminDashboard />} />
                      <Route path="products" element={<AdminProducts />} />
                      <Route path="products/:id" element={<AdminProductEditor />} />
                      <Route path="plants" element={<AdminPlants />} />
                      <Route path="plants/:slug" element={<AdminPlantEditor />} />
                      <Route path="orders" element={<AdminOrders />} />
                      <Route path="orders/:id" element={<AdminOrderDetail />} />
                      <Route path="users" element={<AdminUsers />} />
                      <Route path="media" element={<AdminMedia />} />
                      <Route path="content" element={<AdminContent />} />
                      <Route path="notifications" element={<AdminNotifications />} />
                      <Route path="reviews" element={<AdminReviews />} />
                      <Route path="inbox" element={<AdminInbox />} />
                      <Route path="discounts" element={<AdminDiscounts />} />
                      <Route path="analytics" element={<AdminAnalytics />} />
                      <Route path="audit" element={<AdminAudit />} />
                    </Route>
                    <Route path="*" element={<NotFound />} />
                  </Routes>
                </Suspense>
              </main>
            </RouteTransition>
          </ErrorBoundary>
          <MobileTabBar />
          <CommandPalette />
          <MiniCart />
          <OnboardingWizard />
          <CookieConsent />
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
