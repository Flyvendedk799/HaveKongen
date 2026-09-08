import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, Loader2, Send } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Newsletter signup.
 *
 * Goes through subscribe_newsletter() rather than an INSERT, so the table
 * cannot be probed to find out whether an address is already on the list, and
 * so signing up twice is idempotent instead of an error. The consent this
 * collects is for marketing email specifically — separate from the cookie
 * banner, which covers storage on the device.
 */
export function NewsletterSignup({ source = "footer" }: { source?: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (state === "sending") return;
    setState("sending");
    setError(null);
    try {
      const { data, error: rpcError } = await supabase.rpc("subscribe_newsletter", {
        p_email: email,
        p_source: source,
      });
      if (rpcError) throw new Error(rpcError.message);

      const result = data as unknown as { ok: boolean; message: string };
      if (!result.ok) {
        setError(result.message);
        setState("idle");
        return;
      }
      setState("done");
      setEmail("");
    } catch {
      setError("Kunne ikke tilmelde lige nu. Prøv igen senere.");
      setState("idle");
    }
  }

  if (state === "done") {
    return (
      <p className="newsletter-done">
        <Check size={15} /> Tak — du er tilmeldt. Vi skriver, når der er noget at gøre i haven.
      </p>
    );
  }

  return (
    <form className="newsletter" onSubmit={submit}>
      <label htmlFor="newsletter-email" className="newsletter-label">
        Sæsonens opgaver, direkte i indbakken
      </label>
      <div className="newsletter-row">
        <input
          id="newsletter-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="din@mail.dk"
          autoComplete="email"
          aria-describedby="newsletter-legal"
        />
        <button type="submit" disabled={state === "sending"} aria-label="Tilmeld nyhedsbrev">
          {state === "sending" ? <Loader2 size={15} className="spin" /> : <Send size={15} />}
        </button>
      </div>
      {error && <p className="newsletter-error">{error}</p>}
      <p id="newsletter-legal" className="newsletter-legal">
        Cirka ét brev om måneden. Afmeld når som helst. Se{" "}
        <Link to="/privatliv">privatlivspolitikken</Link>.
      </p>
    </form>
  );
}
