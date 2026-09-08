import { useEffect, useState } from "react";
import { Mail, MapPin, Phone, Send, Clock } from "lucide-react";
import { AppNav, SiteFooter } from "@/components/layout/SiteChrome";
import { usePageMeta } from "@/hooks/usePageMeta";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useCompany } from "./LegalLayout";
import { toast } from "sonner";

type Form = { name: string; email: string; subject: string; body: string; order_no: string };

const EMPTY: Form = { name: "", email: "", subject: "", body: "", order_no: "" };

const SUBJECTS = [
  "Spørgsmål til en ordre",
  "Levering",
  "Returnering eller reklamation",
  "Spørgsmål om en plante",
  "Havemåler eller 3D-haven",
  "Andet",
];

export default function Contact() {
  const company = useCompany();
  const { user } = useAuth();
  const [form, setForm] = useState<Form>({ ...EMPTY, subject: SUBJECTS[0] });
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  usePageMeta({
    title: "Kontakt · Havekongen",
    description: "Skriv til Havekongen om ordrer, levering, returnering eller planter. Vi svarer inden for 1-2 hverdage.",
  });

  // Pre-fill from the session so a logged-in customer does not retype what we
  // already know.
  useEffect(() => {
    if (!user) return;
    setForm((f) => ({ ...f, email: f.email || user.email || "" }));
    supabase
      .from("profiles")
      .select("name")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => data?.name && setForm((f) => ({ ...f, name: f.name || data.name! })));
  }, [user]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (sending) return;
    setSending(true);
    try {
      const { data, error } = await supabase.rpc("submit_contact_message", {
        p_name: form.name,
        p_email: form.email,
        p_subject: form.subject,
        p_body: form.body,
        p_order_no: form.order_no || null,
      });
      if (error) throw new Error(error.message);

      const result = data as unknown as { ok: boolean; message: string };
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      setSent(true);
      setForm({ ...EMPTY, subject: SUBJECTS[0] });
      toast.success(result.message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Beskeden kunne ikke sendes.");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <AppNav />
      <div className="container">
        <header className="page-head">
          <div className="eyebrow" style={{ marginBottom: 14 }}>Kontakt</div>
          <h1>Skriv til os.</h1>
          <p className="lede">
            Vi er en lille flok, og vi svarer selv. Regn med svar inden for 1-2 hverdage — hurtigere,
            hvis det handler om en ordre, der er på vej.
          </p>
        </header>

        <div className="contact-grid">
          <section className="card" style={{ padding: 26 }}>
            {sent ? (
              <div style={{ textAlign: "center", padding: "30px 0" }}>
                <Send size={34} color="var(--forest-700)" />
                <h2 style={{ fontSize: 22, margin: "14px 0 8px" }}>Tak — beskeden er sendt</h2>
                <p className="muted-note">Vi vender tilbage på den e-mail, du angav.</p>
                <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 18 }} onClick={() => setSent(false)}>
                  Skriv en til
                </button>
              </div>
            ) : (
              <form className="contact-form" onSubmit={submit}>
                <div className="field">
                  <label htmlFor="c-name">Navn</label>
                  <input
                    id="c-name"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    required
                    autoComplete="name"
                  />
                </div>
                <div className="field">
                  <label htmlFor="c-email">E-mail</label>
                  <input
                    id="c-email"
                    type="email"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                    required
                    autoComplete="email"
                  />
                </div>
                <div className="field">
                  <label htmlFor="c-subject">Emne</label>
                  <select
                    id="c-subject"
                    value={form.subject}
                    onChange={(e) => setForm({ ...form, subject: e.target.value })}
                  >
                    {SUBJECTS.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="c-order">Ordrenummer (hvis relevant)</label>
                  <input
                    id="c-order"
                    value={form.order_no}
                    onChange={(e) => setForm({ ...form, order_no: e.target.value })}
                    placeholder="HK-260908-01042"
                  />
                </div>
                <div className="field">
                  <label htmlFor="c-body">Besked</label>
                  <textarea
                    id="c-body"
                    rows={7}
                    value={form.body}
                    onChange={(e) => setForm({ ...form, body: e.target.value.slice(0, 4000) })}
                    required
                    minLength={10}
                    placeholder="Beskriv gerne hvad der er sket, og hvad du gerne vil have os til at gøre."
                  />
                  <div className="muted-note" style={{ textAlign: "right", marginTop: 4 }}>
                    {form.body.length}/4000
                  </div>
                </div>
                <button type="submit" className="btn btn-primary" disabled={sending} style={{ justifyContent: "center" }}>
                  {sending ? "Sender…" : "Send besked"}
                </button>
                <p className="order-legal">
                  Vi bruger kun oplysningerne til at besvare din henvendelse og gemmer dem i to år.
                </p>
              </form>
            )}
          </section>

          <aside className="card" style={{ padding: 24 }}>
            <h2 style={{ fontSize: 18, marginBottom: 18 }}>Direkte</h2>
            <dl className="contact-facts">
              <div>
                <dt><Mail size={13} style={{ verticalAlign: -2 }} /> E-mail</dt>
                <dd><a href={`mailto:${company.email}`}>{company.email}</a></dd>
              </div>
              <div>
                <dt><Phone size={13} style={{ verticalAlign: -2 }} /> Telefon</dt>
                <dd>{company.phone}</dd>
              </div>
              <div>
                <dt><Clock size={13} style={{ verticalAlign: -2 }} /> Åbningstid</dt>
                <dd>{company.support_hours}</dd>
              </div>
              <div>
                <dt><MapPin size={13} style={{ verticalAlign: -2 }} /> Adresse</dt>
                <dd>{company.name}<br />{company.address}<br />CVR {company.cvr}</dd>
              </div>
            </dl>
          </aside>
        </div>
      </div>
      <SiteFooter />
    </>
  );
}
