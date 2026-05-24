import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable";
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
  const next = params.get("next") || "/min-have";

  async function googleSignIn() {
    setBusy(true);
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin + next,
    });
    if (result.error) {
      toast.error("Google login fejlede.");
      setBusy(false);
      return;
    }
    if (result.redirected) return;
    nav(next);
  }

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
            ? "Velkommen til Havekongen."
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

        {mode !== "reset" && (
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 12, margin: "24px 0", color: "var(--ink-500)", fontSize: 12 }}>
              <div style={{ flex: 1, height: 1, background: "var(--ink-100)" }} />
              eller
              <div style={{ flex: 1, height: 1, background: "var(--ink-100)" }} />
            </div>
            <button
              type="button"
              onClick={googleSignIn}
              disabled={busy}
              className="btn btn-ghost"
              style={{ width: "100%", height: 48, display: "flex", alignItems: "center", justifyContent: "center", gap: 10, border: "1px solid var(--ink-100)" }}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
                <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.79 2.72v2.26h2.9c1.7-1.56 2.69-3.87 2.69-6.62z"/>
                <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.81.54-1.83.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.96v2.33A8.99 8.99 0 0 0 9 18z"/>
                <path fill="#FBBC05" d="M3.95 10.7A5.4 5.4 0 0 1 3.65 9c0-.59.1-1.16.3-1.7V4.97H.96A8.99 8.99 0 0 0 0 9c0 1.45.35 2.82.96 4.03l3-2.33z"/>
                <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.46 3.44 1.35l2.58-2.58A8.99 8.99 0 0 0 9 0 8.99 8.99 0 0 0 .96 4.97l3 2.33C4.66 5.17 6.65 3.58 9 3.58z"/>
              </svg>
              Fortsæt med Google
            </button>
          </>
        )}

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
