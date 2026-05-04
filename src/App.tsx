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

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/webshop" element={<Webshop />} />
            <Route path="/webshop/:slug" element={<ProductDetail />} />
            <Route path="/cart" element={<CartPage />} />
            <Route path="/login" element={<AuthPage initialMode="login" />} />
            <Route path="/signup" element={<AuthPage initialMode="signup" />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/havemaaler" element={<Placeholder active="sizer" eyebrow="Havemåler" title="Tegn din have. Få en plæneklipper-anbefaling." description="Indtast din adresse og tegn dine bede og plæner direkte på satellitkortet. Bygges i fase 4 med Mapbox." />} />
            <Route path="/vanding" element={<Placeholder active="water" eyebrow="Vandingsplan" title="Vanding der følger vejret." description="Lav timere for hvert bed. AI'en justerer efter regn og planternes behov. Bygges i fase 5." />} />
            <Route path="/ai" element={<Placeholder active="ai" eyebrow="Plantepleje AI" title="Spørg om alt. Den kender din have." description="Få råd om beskæring, gødning, sygdomme og daglig pleje. Bygges i fase 6 med Lovable AI." />} />
            <Route path="/konto" element={<Placeholder active="account" eyebrow="Min konto" title="Din have, dine ordrer." description="Samlet overblik over alt du har gang i. Login fungerer allerede — dashboard bygges i fase 7." />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
