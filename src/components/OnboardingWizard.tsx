import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/integrations/supabase/client";

export function OnboardingWizard() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [show, setShow] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (loading || !user) return;
    (async () => {
      const { data } = await supabase.from("profiles").select("onboarded_at").eq("id", user.id).maybeSingle();
      if (data && !data.onboarded_at) setShow(true);
    })();
  }, [user, loading]);

  async function complete(go?: string) {
    if (!user) return;
    await supabase.from("profiles").update({ onboarded_at: new Date().toISOString() }).eq("id", user.id);
    setShow(false);
    if (go) navigate(go);
  }

  if (!show) return null;

  const steps = [
    {
      title: "Velkommen til Havekongen 🌿",
      body: "Lad os få din have op at køre på 1 minut. Du kan altid skippe.",
      cta: "Kom i gang",
      next: () => setStep(1),
    },
    {
      title: "Mål din have",
      body: "Tegn din matrikel for præcise anbefalinger til klipper, vanding og planter.",
      cta: "Mål min have",
      next: () => complete("/havemaaler"),
    },
    {
      title: "Vælg planter & vanding",
      body: "Du er klar. Se dit overblik på Min have — eller hop direkte i webshop, vanding eller AI.",
      cta: "Til Min have",
      next: () => complete("/min-have"),
    },
  ];
  const s = steps[step];

  return (
    <div style={{
      position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)",
      display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 20,
    }}>
      <div style={{
        background: "var(--paper)", borderRadius: 20, padding: 36,
        maxWidth: 440, width: "100%", textAlign: "center",
      }}>
        <div style={{ display: "flex", justifyContent: "center", gap: 6, marginBottom: 20 }}>
          {steps.map((_, i) => (
            <div key={i} style={{
              width: i === step ? 24 : 8, height: 8, borderRadius: 4,
              background: i <= step ? "var(--forest-800)" : "var(--ink-100)",
              transition: "width 200ms",
            }} />
          ))}
        </div>
        <h2 style={{ fontSize: 24, marginBottom: 12 }}>{s.title}</h2>
        <p style={{ color: "var(--ink-500)", marginBottom: 28, lineHeight: 1.6 }}>{s.body}</p>
        <button onClick={s.next} className="btn btn-primary" style={{ width: "100%", height: 48, marginBottom: 10 }}>
          {s.cta}
        </button>
        <button onClick={() => complete()} className="btn btn-ghost btn-sm" style={{ color: "var(--ink-500)" }}>
          Spring over
        </button>
      </div>
    </div>
  );
}
