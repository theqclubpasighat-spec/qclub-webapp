import React from "react";

const styles = {
  page: {
    minHeight: "100vh",
    background: "#08120d",
    color: "#edf7f0",
    fontFamily: "Inter, system-ui, -apple-system, BlinkMacSystemFont, \"Segoe UI\", sans-serif",
  },
  shell: {
    width: "min(920px, calc(100% - 32px))",
    margin: "0 auto",
    padding: "48px 0 72px",
  },
  card: {
    background: "rgba(255,255,255,0.055)",
    border: "1px solid rgba(255,255,255,0.10)",
    borderRadius: 20,
    padding: "28px",
    boxShadow: "0 18px 60px rgba(0,0,0,0.28)",
  },
  eyebrow: {
    color: "#9fe2b1",
    fontWeight: 800,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    fontSize: 13,
    marginBottom: 10,
  },
  h1: { fontSize: "clamp(32px, 6vw, 54px)", margin: "0 0 8px", lineHeight: 1.05 },
  lead: { color: "#bfd0c4", fontSize: 17, lineHeight: 1.65, marginTop: 8 },
  section: { marginTop: 30 },
  h2: { fontSize: 22, margin: "0 0 10px" },
  p: { color: "#d8e4dc", lineHeight: 1.72, margin: "8px 0" },
  ol: { color: "#d8e4dc", lineHeight: 1.72, paddingLeft: 22, margin: "8px 0" },
  ul: { color: "#d8e4dc", lineHeight: 1.72, paddingLeft: 22, margin: "8px 0" },
  note: {
    marginTop: 24,
    padding: "16px 18px",
    borderRadius: 14,
    background: "rgba(159,226,177,0.08)",
    border: "1px solid rgba(159,226,177,0.20)",
    color: "#dff4e5",
    lineHeight: 1.65,
  },
  button: {
    display: "inline-block",
    marginTop: 14,
    padding: "12px 18px",
    borderRadius: 12,
    background: "#9fe2b1",
    color: "#08120d",
    fontWeight: 800,
    textDecoration: "none",
  },
  link: { color: "#9fe2b1" },
  meta: { color: "#90a397", fontSize: 14, marginTop: 4 },
};

export default function CraXamDeleteAccountPage() {
  const emailHref =
    "mailto:craxam@theqclubpasighat.com?subject=" +
    encodeURIComponent("CraXam account deletion request") +
    "&body=" +
    encodeURIComponent(
      "Please delete my CraXam account and associated personal data.\n\nCraXam sign-in email: \n\nOptional note: "
    );

  return (
    <main style={styles.page}>
      <div style={styles.shell}>
        <div style={styles.eyebrow}>CraXam</div>
        <h1 style={styles.h1}>Delete your CraXam account</h1>
        <p style={styles.meta}>Package: com.theqclubpasighat.craxam</p>
        <p style={styles.meta}>Last updated: 20 September 2026</p>

        <div style={{ ...styles.card, marginTop: 28 }}>
          <p style={styles.lead}>
            You can request deletion of your CraXam account and associated personal data even if you
            cannot currently access the app.
          </p>

          <section style={styles.section}>
            <h2 style={styles.h2}>How to request deletion</h2>
            <ol style={styles.ol}>
              <li>Send an email from the Google account you use to sign in to CraXam.</li>
              <li>Address it to <strong>craxam@theqclubpasighat.com</strong>.</li>
              <li>Use the subject <strong>CraXam account deletion request</strong>.</li>
              <li>Include the CraXam sign-in email address so we can identify the correct account.</li>
            </ol>
            <a style={styles.button} href={emailHref}>Request account deletion by email</a>
          </section>

          <section style={styles.section}>
            <h2 style={styles.h2}>What will be deleted</h2>
            <ul style={styles.ul}>
              <li>Your CraXam account/profile record and authentication linkage.</li>
              <li>Exam attempts, answers, scores, progress and performance history linked to your account.</li>
              <li>Mock-access and entitlement records linked to your account, except records that must be retained for legal or accounting reasons.</li>
              <li>Other user-specific app data that can reasonably be linked to your CraXam account.</li>
            </ul>
          </section>

          <section style={styles.section}>
            <h2 style={styles.h2}>What may be retained</h2>
            <p style={styles.p}>
              Limited records may be retained where required for legal, accounting, security,
              fraud-prevention, dispute-resolution or regulatory purposes. Any such retained data is
              kept only for the applicable required period and is not used to continue providing the
              deleted CraXam account.
            </p>
          </section>

          <section style={styles.section}>
            <h2 style={styles.h2}>Processing time</h2>
            <p style={styles.p}>
              We aim to complete verified account-deletion requests within 30 days. We may contact
              you using the request email address if additional verification is needed to protect the
              account from unauthorized deletion.
            </p>
          </section>

          <section style={styles.section}>
            <h2 style={styles.h2}>Contact</h2>
            <p style={styles.p}>
              Questions about deletion can be sent to{" "}
              <a style={styles.link} href="mailto:craxam@theqclubpasighat.com">
                craxam@theqclubpasighat.com
              </a>.
            </p>
          </section>

          <div style={styles.note}>
            This page is provided for CraXam account deletion requests and is accessible without
            signing in.
          </div>
        </div>
      </div>
    </main>
  );
}
