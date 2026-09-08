import { useCallback, useEffect, useState } from "react";
import { Loader2, MapPin, Plus, Star, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import type { Tables } from "@/integrations/supabase/types";
import { toast } from "sonner";

type Address = Tables<"addresses">;

type Draft = {
  label: string;
  name: string;
  street: string;
  street2: string;
  postal_code: string;
  city: string;
  phone: string;
};

const EMPTY: Draft = { label: "", name: "", street: "", street2: "", postal_code: "", city: "", phone: "" };

/**
 * Saved delivery addresses. The single-default-per-kind rule is enforced by a
 * trigger, so this component just asks and re-reads rather than trying to keep
 * the invariant itself.
 */
export function AddressBook() {
  const { user } = useAuth();
  const [rows, setRows] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("addresses")
      .select("*")
      .order("is_default_shipping", { ascending: false })
      .order("created_at", { ascending: false });
    setRows(data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    if (!draft.name.trim() || !draft.street.trim() || !draft.postal_code.trim() || !draft.city.trim()) {
      toast.error("Navn, adresse, postnummer og by er påkrævet.");
      return;
    }
    setSaving(true);
    const { error } = await supabase.from("addresses").insert({
      user_id: user.id,
      label: draft.label.trim() || null,
      name: draft.name.trim(),
      street: draft.street.trim(),
      street2: draft.street2.trim() || null,
      postal_code: draft.postal_code.trim(),
      city: draft.city.trim(),
      phone: draft.phone.trim() || null,
      is_default_shipping: rows.length === 0,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Adresse gemt");
    setDraft(EMPTY);
    setAdding(false);
    void load();
  }

  async function makeDefault(id: string) {
    const { error } = await supabase.from("addresses").update({ is_default_shipping: true }).eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    void load();
  }

  async function remove(id: string) {
    if (!confirm("Slet adressen?")) return;
    const { error } = await supabase.from("addresses").delete().eq("id", id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setRows((prev) => prev.filter((r) => r.id !== id));
  }

  if (loading) {
    return <div style={{ padding: "16px 0", color: "var(--ink-500)" }}><Loader2 size={15} className="spin" /> Henter…</div>;
  }

  return (
    <>
      {rows.length === 0 && !adding && (
        <div style={{ padding: "14px 0", textAlign: "center", color: "var(--ink-500)" }}>
          <MapPin size={20} style={{ marginBottom: 8 }} />
          <p style={{ margin: "0 0 12px", fontSize: 14 }}>Ingen gemte adresser. Vi husker den, du bruger i kassen.</p>
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ display: "grid", gap: 10 }}>
          {rows.map((a) => (
            <div key={a.id} className="acct-order">
              <div>
                <strong>
                  {a.label || a.name}
                  {a.is_default_shipping && (
                    <span className="status-pill is-paid" style={{ marginLeft: 8 }}>Standard</span>
                  )}
                </strong>
                <div className="who">
                  {a.name} · {a.street}{a.street2 ? `, ${a.street2}` : ""} · {a.postal_code} {a.city}
                  {a.phone && ` · ${a.phone}`}
                </div>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {!a.is_default_shipping && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => void makeDefault(a.id)}
                    aria-label="Gør til standardadresse"
                  >
                    <Star size={13} />
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => void remove(a.id)}
                  aria-label="Slet adresse"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {adding ? (
        <form onSubmit={save} style={{ marginTop: 14, display: "grid", gap: 12 }}>
          <div className="checkout-fields">
            <Field label="Navn på adressen (fx Hjem)" value={draft.label} onChange={(v) => setDraft({ ...draft, label: v })} />
            <Field label="Modtager" value={draft.name} onChange={(v) => setDraft({ ...draft, name: v })} required />
            <Field label="Adresse" value={draft.street} onChange={(v) => setDraft({ ...draft, street: v })} required full />
            <Field label="Etage, dør" value={draft.street2} onChange={(v) => setDraft({ ...draft, street2: v })} full />
            <Field label="Postnummer" value={draft.postal_code} onChange={(v) => setDraft({ ...draft, postal_code: v })} required />
            <Field label="By" value={draft.city} onChange={(v) => setDraft({ ...draft, city: v })} required />
            <Field label="Telefon" value={draft.phone} onChange={(v) => setDraft({ ...draft, phone: v })} full />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="submit" className="btn btn-primary btn-sm" disabled={saving}>
              {saving ? "Gemmer…" : "Gem adresse"}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setAdding(false); setDraft(EMPTY); }}>
              Fortryd
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => setAdding(true)}>
          <Plus size={14} /> Tilføj adresse
        </button>
      )}
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
  full,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
  full?: boolean;
}) {
  return (
    <div className="field" style={{ gridColumn: full ? "1 / -1" : undefined }}>
      <label>{label}</label>
      <input value={value} onChange={(e) => onChange(e.target.value)} required={required} />
    </div>
  );
}
