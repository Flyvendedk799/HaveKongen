import { useEffect, useMemo, useState } from "react";
import { Search, Shield, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

type AdminUser = {
  id: string; email: string | null; created_at: string;
  last_sign_in_at: string | null; name: string | null;
  address: string | null; roles: string[];
};

export default function AdminUsers() {
  const [rows, setRows] = useState<AdminUser[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase.functions.invoke("admin-users", {
      body: { action: "list", page: 1, perPage: 200 },
    });
    if (error) toast.error(error.message);
    setRows((data?.users ?? []) as AdminUser[]);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => rows.filter((u) =>
    q === "" ||
    (u.email ?? "").toLowerCase().includes(q.toLowerCase()) ||
    (u.name ?? "").toLowerCase().includes(q.toLowerCase())
  ), [rows, q]);

  async function toggleAdmin(u: AdminUser) {
    const isAdmin = u.roles.includes("admin");
    const { error } = await supabase.functions.invoke("admin-users", {
      body: { action: "setRole", userId: u.id, role: "admin", grant: !isAdmin },
    });
    if (error) return toast.error(error.message);
    toast.success(isAdmin ? "Admin fjernet" : "Admin tildelt");
    load();
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Brugere</h1>
        <p className="text-muted-foreground">{rows.length} brugere</p>
      </div>

      <div className="relative max-w-md">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Søg email eller navn…" value={q} onChange={(e) => setQ(e.target.value)} className="pl-9" />
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr className="text-left">
                <th className="p-3">Email</th>
                <th className="p-3">Navn</th>
                <th className="p-3">Oprettet</th>
                <th className="p-3">Sidst logget ind</th>
                <th className="p-3">Roller</th>
                <th className="p-3 text-right">Handling</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Indlæser…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="p-6 text-center text-muted-foreground">Ingen brugere.</td></tr>
              ) : filtered.map((u) => {
                const isAdmin = u.roles.includes("admin");
                return (
                  <tr key={u.id} className="border-t hover:bg-muted/30">
                    <td className="p-3 font-medium">{u.email}</td>
                    <td className="p-3">{u.name ?? "—"}</td>
                    <td className="p-3 text-muted-foreground">{new Date(u.created_at).toLocaleDateString("da-DK")}</td>
                    <td className="p-3 text-muted-foreground">{u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleDateString("da-DK") : "—"}</td>
                    <td className="p-3">
                      {u.roles.length === 0 ? <span className="text-muted-foreground">user</span> :
                        u.roles.map((r) => (
                          <span key={r} className="text-xs px-2 py-0.5 bg-primary/10 text-primary rounded mr-1">{r}</span>
                        ))}
                    </td>
                    <td className="p-3 text-right">
                      <Button size="sm" variant={isAdmin ? "outline" : "default"} onClick={() => toggleAdmin(u)}>
                        {isAdmin ? <><ShieldOff className="h-3 w-3" /> Fjern admin</> : <><Shield className="h-3 w-3" /> Gør til admin</>}
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
