import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppNav, SiteFooter } from "@/components/layout/SiteChrome";
import { toast } from "sonner";

export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    // Supabase fires PASSWORD_RECOVERY event when the recovery link is opened
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") setReady(true);
    });
    supabase.auth.getSession().then(({ data: s }) => {
      if (s.session) setReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Kodeord opdateret.");
    nav("/konto");
  }

  return (
    <>
      <AppNav />
      <div className="container" style={{ maxWidth: 480, padding: "80px 32px" }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Nulstil kodeord</div>
        <h1 style={{ fontSize: 40, marginBottom: 28 }}>Vælg et nyt kodeord.</h1>
        {ready ? (
          <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            <div className="field">
              <label>Nyt kodeord</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} autoFocus />
            </div>
            <button className="btn btn-primary" disabled={busy} style={{ height: 48 }}>
              {busy ? "Gemmer…" : "Gem kodeord"}
            </button>
          </form>
        ) : (
          <p style={{ color: "var(--ink-500)" }}>Åbn linket fra mailen for at fortsætte.</p>
        )}
      </div>
      <SiteFooter />
    </>
  );
}
