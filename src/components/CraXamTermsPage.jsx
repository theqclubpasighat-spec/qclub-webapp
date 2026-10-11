import React from "react";

const styles = {
  page: {
    minHeight: "100vh",
    background: "#08120d",
    color: "#edf7f0",
    fontFamily: 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
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

export default function CraXamTermsPage() {
  return (
    <main style={styles.page}>
      <div style={styles.shell}>
        <div style={styles.eyebrow}>CraXam</div>
        <h1 style={styles.h1}>Terms of Service</h1>
        <p style={styles.meta}>Package: com.theqclubpasighat.craxam</p>
        <p style={styles.meta}>Last updated: 11 October 2026</p>

        <div style={{ ...styles.card, marginTop: 28 }}>
          <p style={styles.lead}>
            These Terms govern use of the CraXam Android application. CraXam is an
            exam-preparation service operated by The Q Club Pasighat.
          </p>

          <section style={styles.section}>
            <h2 style={styles.h2}>1. Exam-preparation service</h2>
            <p style={styles.p}>
              CraXam provides practice mocks, explanations, exam tips, performance
              review and related learning tools. CraXam is not an examination
              authority, recruitment board, university or government agency. App
              content does not replace official notifications, syllabi, rules,
              answer keys or instructions issued by the relevant examination body.
            </p>
          </section>

          <section style={styles.section}>
            <h2 style={styles.h2}>2. Accounts and access</h2>
            <p style={styles.p}>
              Where sign-in is required, users must use a valid account and are
              responsible for activity performed through that account. Access to
              particular mocks or features may depend on the entitlement associated
              with the account and on availability of the service.
            </p>
          </section>

          <section style={styles.section}>
            <h2 style={styles.h2}>3. Educational accuracy</h2>
            <p style={styles.p}>
              CraXam aims to provide accurate, useful exam-preparation content and
              may review or update questions when errors are identified. No practice
              platform can guarantee that every question will match a future official
              examination, that every source will remain unchanged, or that use of
              the app will produce a particular examination result. If CraXam content
              conflicts with an official examination notice or authoritative source,
              the official source controls.
            </p>
          </section>

          <section style={styles.section}>
            <h2 style={styles.h2}>4. Acceptable use</h2>
            <ul style={styles.ul}>
              <li>Use CraXam for lawful personal exam preparation.</li>
              <li>Do not attempt to bypass access controls or interfere with the service.</li>
              <li>Do not use automated scraping, bulk extraction or similar methods to copy the question bank.</li>
              <li>Do not redistribute CraXam mock content as your own commercial product without permission.</li>
            </ul>
          </section>

          <section style={styles.section}>
            <h2 style={styles.h2}>5. Content and intellectual property</h2>
            <p style={styles.p}>
              CraXam's original app design, mock compilations, explanations and other
              original material are provided for personal study. Third-party names,
              government publications and referenced source material remain subject
              to the rights and terms applicable to those materials.
            </p>
          </section>

          <section style={styles.section}>
            <h2 style={styles.h2}>6. Service availability and changes</h2>
            <p style={styles.p}>
              Features, mock availability and technical implementation may change as
              CraXam is improved. Maintenance, connectivity problems or third-party
              service interruptions may temporarily affect availability. We may
              restrict access where reasonably necessary to protect the service,
              users or content from abuse.
            </p>
          </section>

          <section style={styles.section}>
            <h2 style={styles.h2}>7. Privacy</h2>
            <p style={styles.p}>
              Use of personal information is described in the{" "}
              <a style={styles.link} href="/craxam/privacy">
                CraXam Privacy Policy
              </a>.
            </p>
          </section>

          <section style={styles.section}>
            <h2 style={styles.h2}>8. Account deletion</h2>
            <p style={styles.p}>
              Information about requesting deletion of a CraXam account is available
              on the{" "}
              <a style={styles.link} href="/craxam/delete-account">
                CraXam account-deletion page
              </a>.
            </p>
          </section>

          <section style={styles.section}>
            <h2 style={styles.h2}>9. Contact</h2>
            <p style={styles.p}>
              Questions about CraXam or these Terms can be sent to{" "}
              <a style={styles.link} href="mailto:craxam@theqclubpasighat.com">
                craxam@theqclubpasighat.com
              </a>.
            </p>
          </section>

          <div style={styles.note}>
            These Terms apply specifically to the CraXam Android application. The Q
            Club website and club services may have separate terms for their own
            activities.
          </div>
        </div>
      </div>
    </main>
  );
}
