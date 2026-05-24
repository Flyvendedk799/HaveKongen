import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  LayoutDashboard, Package, Leaf, ShoppingBag, Users, Image as ImageIcon,
  FileText, Bell, BarChart3, History, ArrowLeft,
} from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger,
} from "@/components/ui/sidebar";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";

const items = [
  { to: "/admin", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/admin/products", label: "Produkter", icon: Package },
  { to: "/admin/plants", label: "Plante-katalog", icon: Leaf },
  { to: "/admin/orders", label: "Ordrer", icon: ShoppingBag },
  { to: "/admin/users", label: "Brugere", icon: Users },
  { to: "/admin/media", label: "Mediebibliotek", icon: ImageIcon },
  { to: "/admin/content", label: "Indhold", icon: FileText },
  { to: "/admin/notifications", label: "Notifikationer", icon: Bell },
  { to: "/admin/analytics", label: "Analyse", icon: BarChart3 },
  { to: "/admin/audit", label: "Audit log", icon: History },
];

function AdminSidebar() {
  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Havekongen CMS</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items.map((it) => (
                <SidebarMenuItem key={it.to}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={it.to}
                      end={it.end}
                      className={({ isActive }) =>
                        `flex items-center gap-2 ${isActive ? "bg-muted font-medium" : ""}`
                      }
                    >
                      <it.icon className="h-4 w-4" />
                      <span>{it.label}</span>
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
    </Sidebar>
  );
}

export default function AdminLayout() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);

  useEffect(() => {
    if (loading) return;
    if (!user) { nav("/login?next=/admin"); return; }
    (async () => {
      const { data } = await supabase
        .from("user_roles").select("role")
        .eq("user_id", user.id).eq("role", "admin").maybeSingle();
      setIsAdmin(!!data);
    })();
  }, [user, loading, nav]);

  if (loading || isAdmin === null) {
    return <div className="p-10 text-sm text-muted-foreground">Indlæser…</div>;
  }
  if (!isAdmin) {
    return (
      <div className="p-10">
        <h1 className="text-2xl font-semibold">Adgang nægtet</h1>
        <p className="text-muted-foreground mt-2">Du har ikke admin-rettigheder.</p>
      </div>
    );
  }

  // Build a breadcrumb from path segments
  const parts = loc.pathname.split("/").filter(Boolean); // ["admin", ...]
  const crumbs = parts.slice(1);

  return (
    <SidebarProvider>
      <div className="min-h-screen flex w-full bg-background">
        <AdminSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-14 flex items-center gap-3 border-b px-3 bg-card">
            <SidebarTrigger />
            <button
              onClick={() => nav("/")}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              <ArrowLeft className="h-3 w-3" /> Forlad admin
            </button>
            <div className="text-sm text-muted-foreground ml-2">
              <span className="font-medium text-foreground">Admin</span>
              {crumbs.map((c, i) => (
                <span key={i}> / {c}</span>
              ))}
            </div>
          </header>
          <main className="flex-1 overflow-auto">
            <div className="p-6 max-w-7xl mx-auto">
              <Outlet />
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}
