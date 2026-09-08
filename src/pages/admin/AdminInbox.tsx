import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, Mail, MailOpen, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { toast } from "sonner";

type Message = Tables<"contact_messages">;

const STATUSES = ["new", "open", "answered", "closed", "spam", "all"] as const;

const LABEL: Record<string, string> = {
  new: "Nye",
  open: "Åbne",
  answered: "Besvaret",
  closed: "Lukket",
  spam: "Spam",
  all: "Alle",
};

/** Support inbox for messages submitted through /kontakt. */
export default function AdminInbox() {
  const [rows, setRows] = useState<Message[]>([]);
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("new");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    let query = supabase.from("contact_messages").select("*").order("created_at", { ascending: false }).limit(300);
    if (status !== "all") query = query.eq("status", status);
    const { data, error } = await query;
    if (error) toast.error(error.message);
    setRows(data ?? []);
    setLoading(false);
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setMessageStatus(id: string, next: string, adminNote?: string) {
    const { error } = await supabase
      .from("contact_messages")
      .update({ status: next, admin_note: adminNote ?? undefined, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(`Markeret som ${LABEL[next]?.toLowerCase() ?? next}`);
    setRows((prev) => (status === "all" ? prev.map((r) => (r.id === id ? { ...r, status: next } : r)) : prev.filter((r) => r.id !== id)));
    setOpenId(null);
    setNote("");
  }

  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (r) =>
        r.name.toLowerCase().includes(needle) ||
        r.email.toLowerCase().includes(needle) ||
        r.subject.toLowerCase().includes(needle) ||
        r.body.toLowerCase().includes(needle) ||
        (r.order_no ?? "").toLowerCase().includes(needle),
    );
  }, [rows, q]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight">Indbakke</h1>
        <p className="text-muted-foreground">{visible.length} henvendelser fra kontaktformularen</p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          placeholder="Søg navn, mail, ordrenr. eller tekst…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="flex-1 min-w-[220px]"
        />
        <div className="flex flex-wrap gap-1">
          {STATUSES.map((s) => (
            <Button key={s} size="sm" variant={status === s ? "default" : "outline"} onClick={() => setStatus(s)}>
              {LABEL[s]}
            </Button>
          ))}
        </div>
      </div>

      {loading ? (
        <Card className="p-10 flex justify-center"><Loader2 className="h-5 w-5 animate-spin" /></Card>
      ) : visible.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">Indbakken er tom.</Card>
      ) : (
        <div className="space-y-3">
          {visible.map((m) => {
            const expanded = openId === m.id;
            return (
              <Card key={m.id} className="p-5">
                <button
                  type="button"
                  className="flex w-full items-start justify-between gap-4 text-left"
                  onClick={() => {
                    setOpenId(expanded ? null : m.id);
                    setNote(m.admin_note ?? "");
                    // Opening a `new` message is the natural moment to mark it
                    // as being worked on.
                    if (!expanded && m.status === "new") void setMessageStatus(m.id, "open");
                  }}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      {m.status === "new" ? <Mail className="h-4 w-4" /> : <MailOpen className="h-4 w-4 text-muted-foreground" />}
                      <span className="font-medium">{m.subject}</span>
                      {m.order_no && <span className="text-xs rounded-full bg-muted px-2 py-0.5">{m.order_no}</span>}
                    </div>
                    <div className="mt-1 text-sm text-muted-foreground truncate">
                      {m.name} · {m.email}
                    </div>
                  </div>
                  <time className="text-xs text-muted-foreground shrink-0">
                    {new Intl.DateTimeFormat("da-DK", { dateStyle: "short", timeStyle: "short" }).format(new Date(m.created_at))}
                  </time>
                </button>

                {expanded && (
                  <div className="mt-4 space-y-3 border-t pt-4">
                    <p className="text-sm whitespace-pre-line">{m.body}</p>

                    <Textarea
                      rows={3}
                      placeholder="Intern note (ses ikke af kunden)"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                    />

                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" asChild>
                        <a href={`mailto:${m.email}?subject=${encodeURIComponent("Re: " + m.subject)}`}>Svar på mail</a>
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => void setMessageStatus(m.id, "answered", note)}>
                        Markér besvaret
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => void setMessageStatus(m.id, "closed", note)}>
                        Luk
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => void setMessageStatus(m.id, "spam", note)}>
                        <Trash2 className="h-4 w-4" /> Spam
                      </Button>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
