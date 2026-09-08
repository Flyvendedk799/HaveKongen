import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Download, Loader2, ShieldCheck, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useConsent } from "@/lib/consent";
import { toast } from "sonner";

const CONFIRM_PHRASE = "SLET MIN KONTO";

/**
 * GDPR self-service: export everything (art. 20) and erase the account
 * (art. 17), both executed rather than promised. Export runs entirely in the
 * browser from a single RPC; deletion goes through the account-delete edge
 * function, which holds the service role and anonymises the order rows that
 * bookkeeping law requires us to keep.
 */
export function PrivacyCard() {
  const { user, signOut } = useAuth();
  const { choice, reopen } = useConsent();
  const [exporting, setExporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [marketing, setMarketing] = useState(false);
  const [pendingDeletion, setPendingDeletion] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("marketing_opt_in, deletion_requested_at")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        setMarketing(Boolean(data?.marketing_opt_in));
        setPendingDeletion(data?.deletion_requested_at ?? null);
      });
  }, [user]);

  async function exportData() {
    setExporting(true);
    try {
      const { data, error } = await supabase.rpc("export_my_data");
      if (error) throw new Error(error.message);

      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `havekongen-mine-data-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      // Revoke on the next tick so the download has definitely started.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success("Dine data er hentet som JSON.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kunne ikke hente dine data.");
    } finally {
      setExporting(false);
    }
  }

  async function toggleMarketing(next: boolean) {
    if (!user) return;
    setMarketing(next);
    const { error } = await supabase.from("profiles").update({ marketing_opt_in: next }).eq("id", user.id);
    if (error) {
      setMarketing(!next);
      toast.error(error.message);
      return;
    }
    if (next) await supabase.rpc("subscribe_newsletter", { p_email: user.email ?? "", p_source: "konto" });
    toast.success(next ? "Tilmeldt nyhedsbrevet." : "Afmeldt nyhedsbrevet.");
  }

  async function deleteAccount() {
    if (phrase.trim().toUpperCase() !== CONFIRM_PHRASE) {
      toast.error(`Skriv "${CONFIRM_PHRASE}" for at bekræfte.`);
      return;
    }
    setDeleting(true);
    try {
      const { data, error } = await supabase.functions.invoke("account-delete", {
        body: { confirm: CONFIRM_PHRASE },
      });
      if (error) {
        const detail = (data as { message?: string } | null)?.message;
        throw new Error(detail || error.message);
      }
      toast.success("Din konto og dine persondata er slettet.");
      await signOut();
      window.location.href = "/";
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Kontoen kunne ikke slettes.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div>
        <h3 style={{ fontSize: 15, margin: "0 0 6px" }}><ShieldCheck size={15} style={{ verticalAlign: -2 }} /> Dine data</h3>
        <p style={{ fontSize: 13.5, color: "var(--ink-500)", margin: "0 0 10px", lineHeight: 1.6 }}>
          Hent alt, hvad Havekongen har registreret om dig — konto, haver, planter, ordrer,
          observationer og samtykker — som én JSON-fil.
        </p>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void exportData()} disabled={exporting}>
          {exporting ? <Loader2 size={14} className="spin" /> : <Download size={14} />} Hent mine data
        </button>
      </div>

      <div>
        <h3 style={{ fontSize: 15, margin: "0 0 6px" }}>Samtykke</h3>
        <p style={{ fontSize: 13.5, color: "var(--ink-500)", margin: "0 0 10px", lineHeight: 1.6 }}>
          Cookievalg:{" "}
          {choice
            ? [
                "nødvendige",
                choice.functional && "funktionelle",
                choice.analytics && "statistik",
                choice.marketing && "marketing",
              ]
                .filter(Boolean)
                .join(", ")
            : "ikke taget stilling"}
          . <button type="button" className="linkish" onClick={reopen}>Skift valg</button>
        </p>
        <label className="check-line">
          <input type="checkbox" checked={marketing} onChange={(e) => void toggleMarketing(e.target.checked)} />
          <span>Send mig nyhedsbrevet med sæsonens opgaver og nye varer.</span>
        </label>
      </div>

      <div className="danger-zone">
        <h3><Trash2 size={15} style={{ verticalAlign: -2 }} /> Slet konto</h3>
        <p style={{ fontSize: 13.5, color: "var(--ink-700)", margin: "0 0 12px", lineHeight: 1.6 }}>
          Sletter din konto, dine haver, planter og observationer permanent. Ordrer bevares i fem år
          som bogføringsloven kræver, men anonymiseres, så de ikke længere kan knyttes til dig.
          {pendingDeletion && " Du har allerede anmodet om sletning."}
        </p>

        {confirmOpen ? (
          <div style={{ display: "grid", gap: 10 }}>
            <div className="field">
              <label htmlFor="delete-confirm">Skriv <strong>{CONFIRM_PHRASE}</strong> for at bekræfte</label>
              <input
                id="delete-confirm"
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                autoComplete="off"
                placeholder={CONFIRM_PHRASE}
              />
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={() => void deleteAccount()}
                disabled={deleting || phrase.trim().toUpperCase() !== CONFIRM_PHRASE}
              >
                {deleting ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />} Slet permanent
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setConfirmOpen(false); setPhrase(""); }}>
                Fortryd
              </button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmOpen(true)}>
            Slet min konto
          </button>
        )}
      </div>

      <p style={{ fontSize: 12, color: "var(--ink-500)", margin: 0 }}>
        Læs mere i <Link to="/privatliv">privatlivspolitikken</Link>. Har du brug for indsigt,
        berigtigelse eller begrænsning, så <Link to="/kontakt">skriv til os</Link>.
      </p>
    </div>
  );
}
