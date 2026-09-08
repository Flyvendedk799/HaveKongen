import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useConsent } from "@/lib/consent";

/**
 * Consent banner. Shown until the visitor answers, and reachable afterwards
 * from the footer so a choice can be changed — which the rules require and
 * most banners quietly forget.
 *
 * "Afvis" is a real button of equal weight, not a link buried in the settings
 * pane: a reject that is harder to find than accept is not freely given consent.
 */
export function CookieConsent() {
  const { needsDecision, choice, acceptAll, rejectAll, save } = useConsent();
  const [showDetails, setShowDetails] = useState(false);
  const [analytics, setAnalytics] = useState(choice?.analytics ?? false);
  const [marketing, setMarketing] = useState(choice?.marketing ?? false);
  const [functional, setFunctional] = useState(choice?.functional ?? false);

  // Re-seed the toggles when the banner is reopened from the footer so it
  // reflects what is currently stored rather than a stale first render.
  useEffect(() => {
    if (needsDecision && choice) {
      setAnalytics(choice.analytics);
      setMarketing(choice.marketing);
      setFunctional(choice.functional);
    }
  }, [needsDecision, choice]);

  if (!needsDecision) return null;

  return (
    <div className="consent-bar" role="dialog" aria-modal="false" aria-labelledby="consent-title">
      <div className="consent-inner">
        <div className="consent-copy">
          <h2 id="consent-title">Vi bruger cookies</h2>
          <p>
            Nødvendige cookies holder din kurv og dit login på plads. Statistik og marketing er helt
            frivilligt — siden fungerer præcis lige så godt, hvis du siger nej.{" "}
            <Link to="/cookies">Læs cookiepolitikken</Link>.
          </p>

          {showDetails && (
            <div className="consent-options">
              <ConsentRow
                label="Nødvendige"
                description="Login, kurv og sikkerhed. Kan ikke fravælges."
                checked
                disabled
              />
              <ConsentRow
                label="Funktionelle"
                description="Husker fx dit valgte bed og dine visningsindstillinger."
                checked={functional}
                onChange={setFunctional}
              />
              <ConsentRow
                label="Statistik"
                description="Anonym brug af siden, så vi kan se hvad der driller."
                checked={analytics}
                onChange={setAnalytics}
              />
              <ConsentRow
                label="Marketing"
                description="Bruges til at måle effekten af annoncer. Vi sætter ingen i dag."
                checked={marketing}
                onChange={setMarketing}
              />
            </div>
          )}
        </div>

        <div className="consent-actions">
          <button type="button" className="btn btn-primary" onClick={() => void acceptAll()}>
            Accepter alle
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => void rejectAll()}>
            Kun nødvendige
          </button>
          {showDetails ? (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void save({ analytics, marketing, functional })}
            >
              Gem valg
            </button>
          ) : (
            <button type="button" className="consent-link" onClick={() => setShowDetails(true)}>
              Tilpas
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function ConsentRow({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange?: (v: boolean) => void;
}) {
  return (
    <label className="consent-row">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
      />
      <span>
        <strong>{label}</strong>
        <em>{description}</em>
      </span>
    </label>
  );
}
