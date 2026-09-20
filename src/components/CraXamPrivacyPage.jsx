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
  link: { color: "#9fe2b1" },
  meta: { color: "#90a397", fontSize: 14, marginTop: 4 },
};

export default function CraXamPrivacyPage() {
  return (
    <main style={styles.page}>
      <div style={styles.shell}>
        <div style={styles.eyebrow}>CraXam</div>
        <h1 style={styles.h1}>Privacy Policy</h1>
        <p style={styles.meta}>Package: com.theqclubpasighat.craxam</p>
        <p style={styles.meta}>Last updated: 20 September 2026</p>

        <div style={{ ...styles.card, marginTop: 28 }}>
          <p style={styles.lead}>
            CraXam is an exam-preparation application operated by The Q Club Pasighat. This policy
            explains what information CraXam processes, why it is used, and the choices available
            to users.
          </p>

          <section style={styles.section}>
            <h2 style={styles.h2}>1. Information we process</h2>
            <ul style={styles.ul}>
              <li>
                <strong>Account and authentication information:</strong> account identifiers such as
                your Supabase user ID, email address and, where a phone-based sign-in method is used,
                phone number. Authentication tokens are stored securely on the device.
              </li>
              <li>
                <strong>Profile and access information:</strong> display name where available, account
                role/status, entitlement level, mock-test access and related access timestamps.
              </li>
              <li>
                <strong>Exam activity:</strong> mock-test identifiers, attempts, answers, scores,
                start/submission times, attempt limits and related progress information required to
                provide and review exam sessions.
              </li>
              <li>
                <strong>Device and app information:</strong> device identifier, device model,
                operating-system version, app version and last-seen information where used for
                security, access control, troubleshooting and exam-session integrity.
              </li>
              <li>
                <strong>Purchase and entitlement records:</strong> when paid mock access is enabled,
                CraXam may store the purchase source, purchase/reference identifier and the access
                granted to your account. CraXam does not store your full card or bank-account
                credentials.
              </li>
            </ul>
          </section>

          <section style={styles.section}>
            <h2 style={styles.h2}>2. Microphone and voice mode</h2>
            <p style={styles.p}>
              CraXam requests microphone permission only for optional voice-answer features. The app
              uses Android's speech-recognition service to convert spoken responses into text. CraXam
              does not intentionally upload or retain raw microphone recordings on its own servers.
              Speech processing may be performed by the speech-recognition service available on your
              device, which may have its own privacy practices. Voice mode can be used only when you
              grant microphone permission.
            </p>
          </section>

          <section style={styles.section}>
            <h2 style={styles.h2}>3. How we use information</h2>
            <ul style={styles.ul}>
              <li>Authenticate users and maintain secure sessions.</li>
              <li>Deliver free and paid mock-test content and enforce access limits.</li>
              <li>Save exam attempts, answers, results and progress where server-backed delivery is used.</li>
              <li>Verify entitlements and purchase access.</li>
              <li>Prevent abuse, protect exam-session integrity and troubleshoot technical problems.</li>
              <li>Operate, maintain and improve CraXam.</li>
            </ul>
          </section>

          <section style={styles.section}>
            <h2 style={styles.h2}>4. Service providers</h2>
            <p style={styles.p}>
              CraXam uses Supabase for authentication and backend/database services. Google services
              may be used for Google sign-in, Android speech recognition and Google Play distribution
              or purchase processing when those features are enabled. These providers process data
              under their own terms and privacy policies.
            </p>
          </section>

          <section style={styles.section}>
            <h2 style={styles.h2}>5. Advertising and analytics</h2>
            <p style={styles.p}>
              The current CraXam Android application does not include an advertising SDK or a
              third-party analytics SDK. If this changes materially, this policy and the relevant
              Google Play Data safety disclosures will be updated.
            </p>
          </section>

          <section style={styles.section}>
            <h2 style={styles.h2}>6. Data storage and security</h2>
            <p style={styles.p}>
              Server-backed CraXam data is stored using Supabase infrastructure. The app uses
              row-level access controls where applicable, and authentication session credentials are
              encrypted at rest on the device. No method of storage or transmission is completely
              risk-free, but reasonable technical and organisational safeguards are used to protect
              information.
            </p>
          </section>

          <section style={styles.section}>
            <h2 style={styles.h2}>7. Data retention and deletion</h2>
            <p style={styles.p}>
              We retain account, entitlement, purchase-reference and exam-attempt information for as
              long as reasonably required to provide CraXam, maintain records, resolve disputes,
              prevent fraud or comply with legal obligations. You may request deletion of your CraXam
              account and associated personal data by contacting us. Some records may be retained
              where required for security, legal, accounting or fraud-prevention purposes.
            </p>
          </section>

          <section style={styles.section}>
            <h2 style={styles.h2}>8. Children</h2>
            <p style={styles.p}>
              CraXam is an exam-preparation service and is not designed as a child-directed service.
              Users who are below the age at which they can consent to data processing in their
              jurisdiction should use the service only with appropriate parent or guardian
              involvement.
            </p>
          </section>

          <section style={styles.section}>
            <h2 style={styles.h2}>9. Your choices</h2>
            <p style={styles.p}>
              You can deny or revoke microphone permission in Android settings, sign out of your
              account, and contact us to request access, correction or deletion of personal
              information associated with your account.
            </p>
          </section>

          <section style={styles.section}>
            <h2 style={styles.h2}>10. Contact</h2>
            <p style={styles.p}>
              Privacy questions and account/data-deletion requests can be sent to{" "}
              <a style={styles.link} href="mailto:craxam@theqclubpasighat.com">
                craxam@theqclubpasighat.com
              </a>.
            </p>
          </section>

          <div style={styles.note}>
            This policy applies specifically to the CraXam Android application. The Q Club website
            may have separate terms and privacy notices for its own services.
          </div>
        </div>
      </div>
    </main>
  );
}
