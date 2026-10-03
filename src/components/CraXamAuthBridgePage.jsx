import React, { useEffect, useMemo } from "react";

export default function CraXamAuthBridgePage() {
  const deepLink = useMemo(() => {
    if (typeof window === "undefined") return "craxam://callback";
    return `craxam://callback${window.location.search || ""}${window.location.hash || ""}`;
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const timer = window.setTimeout(() => {
      window.location.href = deepLink;
    }, 80);
    return () => window.clearTimeout(timer);
  }, [deepLink]);

  return (
    <main className="container" style={{ paddingTop: 32, paddingBottom: 48, maxWidth: 720 }}>
      <section className="card">
        <h1 style={{ marginTop: 0 }}>Opening CraXam…</h1>
        <p className="muted">
          Authentication is complete. This secure bridge is returning you to the CraXam app.
        </p>
        <p>
          <a className="btn" href={deepLink}>Open CraXam</a>
        </p>
        <p className="muted" style={{ fontSize: 13 }}>
          If the app does not open automatically, tap “Open CraXam”.
        </p>
      </section>
    </main>
  );
}
