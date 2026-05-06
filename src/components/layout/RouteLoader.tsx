export function RouteLoader() {
  return (
    <div
      aria-busy="true"
      aria-live="polite"
      style={{
        minHeight: "60vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--ink-500)",
      }}
    >
      <div className="route-loader-dots" aria-hidden="true">
        <span /><span /><span />
      </div>
      <span className="sr-only">Indlæser…</span>
    </div>
  );
}
