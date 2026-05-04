import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { AppNav, SiteFooter } from "@/components/layout/SiteChrome";
import { toast } from "sonner";

type Mode = "login" | "signup" | "reset";

export default function AuthPage({ initialMode }: { initialMode: Mode }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next") || "/konto";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: window.location.origin + next,
            data: { name },
          },
        });
        if (error) throw error;
        toast.success("Konto oprettet — du er logget ind.");
        nav(next);
      } else if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        toast.success("Velkommen tilbage.");
        nav(next);
      } else {
        const { error } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: window.location.origin + "/reset-password",
        });
        if (error) throw error;
        toast.success("Tjek din mail for nulstillingslink.");
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Noget gik galt");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <AppNav active="account" />
      <div className="container" style={{ maxWidth: 480, padding: "80px 32px" }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>
          {mode === "signup" ? "Opret konto" : mode === "login" ? "Log ind" : "Glemt kodeord"}
        </div>
        <h1 style={{ fontSize: 40, marginBottom: 28 }}>
          {mode === "signup"
            ? "Velkommen til Havelandet."
            : mode === "login"
            ? "Log ind på din have."
            : "Nulstil dit kodeord."}
        </h1>

        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {mode === "signup" && (
            <div className="field">
              <label>Navn</label>
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </div>
          )}
          <div className="field">
            <label>Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </div>
          {mode !== "reset" && (
            <div className="field">
              <label>Kodeord</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} />
            </div>
          )}
          <button className="btn btn-primary" disabled={busy} style={{ marginTop: 8, height: 48 }}>
            {busy ? "Et øjeblik…" : mode === "signup" ? "Opret konto" : mode === "login" ? "Log ind" : "Send nulstillingslink"}
          </button>
        </form>

        <div style={{ marginTop: 28, fontSize: 13, color: "var(--ink-500)", display: "flex", flexDirection: "column", gap: 8 }}>
          {mode === "login" && (
            <>
              <button type="button" onClick={() => setMode("signup")} style={{ color: "var(--forest-800)", textAlign: "left" }}>
                Har du ikke en konto? <strong>Opret én</strong>
              </button>
              <button type="button" onClick={() => setMode("reset")} style={{ color: "var(--ink-500)", textAlign: "left" }}>
                Glemt kodeord?
              </button>
            </>
          )}
          {mode === "signup" && (
            <button type="button" onClick={() => setMode("login")} style={{ color: "var(--forest-800)", textAlign: "left" }}>
              Har du allerede en konto? <strong>Log ind</strong>
            </button>
          )}
          {mode === "reset" && (
            <button type="button" onClick={() => setMode("login")} style={{ color: "var(--forest-800)", textAlign: "left" }}>
              ← Tilbage til log ind
            </button>
          )}
          <Link to="/" style={{ marginTop: 16 }}>← Tilbage til forsiden</Link>
        </div>
      </div>
      <SiteFooter />
    </>
  );
}
