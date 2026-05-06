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
import { RouteLoader } from "./components/layout/RouteLoader.tsx";

// Lazy-loaded routes — each ships in its own chunk so the landing page stays light.
const NotFound = lazy(() => import("./pages/NotFound.tsx"));
const Webshop = lazy(() => import("./pages/Webshop.tsx"));
const ProductDetail = lazy(() => import("./pages/ProductDetail.tsx"));
const CartPage = lazy(() => import("./pages/CartPage.tsx"));
const AuthPage = lazy(() => import("./pages/AuthPage.tsx"));
const ResetPassword = lazy(() => import("./pages/ResetPassword.tsx"));
const GardenSizer = lazy(() => import("./pages/GardenSizer.tsx"));
const WateringPlan = lazy(() => import("./pages/WateringPlan.tsx"));
const PlantCareAI = lazy(() => import("./pages/PlantCareAI.tsx"));
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
const AdminStub = lazy(() => import("./pages/admin/AdminStub.tsx").then((m) => ({ default: m.AdminStub })));

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
                    <Route path="/havemaaler" element={<GardenSizer />} />
                    <Route path="/vanding" element={<WateringPlan />} />
                    <Route path="/ai" element={<PlantCareAI />} />
                    <Route path="/konto" element={<Account />} />
                    <Route path="/checkout" element={<Checkout />} />
                    <Route path="/order/:id" element={<OrderConfirmation />} />
                    <Route path="/admin" element={<AdminLayout />}>
                      <Route index element={<AdminDashboard />} />
                      <Route path="products" element={<AdminProducts />} />
                      <Route path="products/:id" element={<AdminProductEditor />} />
                      <Route path="plants" element={<AdminStub title="Plante-katalog" />} />
                      <Route path="orders" element={<AdminStub title="Ordrer" />} />
                      <Route path="orders/:id" element={<AdminStub title="Ordre" />} />
                      <Route path="users" element={<AdminStub title="Brugere" />} />
                      <Route path="media" element={<AdminStub title="Mediebibliotek" />} />
                      <Route path="content" element={<AdminStub title="Indhold" />} />
                      <Route path="notifications" element={<AdminStub title="Notifikationer" />} />
                      <Route path="analytics" element={<AdminStub title="Analyse" />} />
                      <Route path="audit" element={<AdminStub title="Audit log" />} />
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
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
