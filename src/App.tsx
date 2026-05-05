import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/lib/auth";
import Index from "./pages/Index.tsx";
import NotFound from "./pages/NotFound.tsx";
import Placeholder from "./pages/Placeholder.tsx";
import Webshop from "./pages/Webshop.tsx";
import ProductDetail from "./pages/ProductDetail.tsx";
import CartPage from "./pages/CartPage.tsx";
import AuthPage from "./pages/AuthPage.tsx";
import ResetPassword from "./pages/ResetPassword.tsx";
import GardenSizer from "./pages/GardenSizer.tsx";
import WateringPlan from "./pages/WateringPlan.tsx";
import PlantCareAI from "./pages/PlantCareAI.tsx";
import Account from "./pages/Account.tsx";
import { MobileTabBar } from "./components/layout/MobileTabBar.tsx";
import { ScrollToTop } from "./components/layout/ScrollToTop.tsx";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <ScrollToTop />
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
            <Route path="*" element={<NotFound />} />
          </Routes>
          <MobileTabBar />
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
