import React from "react";
import { Link } from "react-router-dom";

export function FooterLinks({ data, admin, commit }) {
  return (
    <footer className="siteFooter">
      <div className="container">
        <div className="siteFooterInner">
          <div>
            <div className="siteFooterBrand">The Q Club</div>
            <div className="muted">
              {data.club?.footerAbout || "Premium indoor gaming lounge at GTC, Pasighat."}
            </div>
            <div className="muted" style={{ marginTop: 10 }}>
              {data.club?.footerDescription || "Snooker, Pool, Air Hockey, Foosball, Massage Chair, Tea & Coffee."}
            </div>

            {admin && (
              <div style={{ marginTop: 12 }}>
                <button
                  className="btn"
                  type="button"
                  onClick={() => {
                    const footerAbout = prompt(
                      "Footer About text:",
                      data.club?.footerAbout || "Premium indoor gaming lounge at GTC, Pasighat."
                    );
                    if (!footerAbout) return;

                    const footerDescription = prompt(
                      "Footer Description text:",
                      data.club?.footerDescription || "Snooker, Pool, Air Hockey, Foosball, Massage Chair, Tea & Coffee."
                    );
                    if (!footerDescription) return;

                    commit({
                      ...data,
                      club: {
                        ...data.club,
                        footerAbout,
                        footerDescription,
                      },
                    });
                  }}
                >
                  Edit Footer
                </button>
              </div>
            )}
          </div>

          <div className="siteFooterLinks">
            <Link to="/about">{data.club?.footerAboutLabel || "About Us"}</Link>
            <Link to="/contact">{data.club?.footerContactLabel || "Contact Us"}</Link>
            <Link to="/terms">{data.club?.footerTermsLabel || "Terms & Conditions"}</Link>
            <Link to="/refund">{data.club?.footerRefundLabel || "Refund Policy"}</Link>
            <Link to="/privacy">{data.club?.footerPrivacyLabel || "Privacy Policy"}</Link>
          </div>

          {admin && (
            <div style={{ marginTop: 12 }}>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  const footerAboutLabel = prompt(
                    "About label:",
                    data.club?.footerAboutLabel || "About Us"
                  );
                  if (!footerAboutLabel) return;

                  const footerContactLabel = prompt(
                    "Contact label:",
                    data.club?.footerContactLabel || "Contact Us"
                  );
                  if (!footerContactLabel) return;

                  const footerTermsLabel = prompt(
                    "Terms label:",
                    data.club?.footerTermsLabel || "Terms & Conditions"
                  );
                  if (!footerTermsLabel) return;

                  const footerRefundLabel = prompt(
                    "Refund label:",
                    data.club?.footerRefundLabel || "Refund Policy"
                  );
                  if (!footerRefundLabel) return;

                  const footerPrivacyLabel = prompt(
                    "Privacy label:",
                    data.club?.footerPrivacyLabel || "Privacy Policy"
                  );
                  if (!footerPrivacyLabel) return;

                  commit({
                    ...data,
                    club: {
                      ...data.club,
                      footerAboutLabel,
                      footerContactLabel,
                      footerTermsLabel,
                      footerRefundLabel,
                      footerPrivacyLabel,
                    },
                  });
                }}
              >
                Edit Footer Links
              </button>
            </div>
          )}
        </div>
      </div>
    </footer>
  );
}

export function TopNav({ club, admin, staffAdmin, committeeAdmin, onToggleAdmin, onChangePin, onReset }) {
  return (
    <div className="nav">
      <div className="nav-inner">
        <div className="brand">
          <div
            className="title"
            onDoubleClick={onToggleAdmin}
            onTouchStart={(e) => {
              e.currentTarget.pressTimer = setTimeout(() => {
                onToggleAdmin();
              }, 800);
            }}
            onTouchEnd={(e) => {
              clearTimeout(e.currentTarget.pressTimer);
            }}
            title="The Q Club"
            style={{ cursor: "pointer" }}
          >
            {club?.name || "The Q CLUB"}
          </div>
          <div className="sub">
            {club?.location || "Pasighat"} • {club?.tagline || "Play. Chill. Compete."}
          </div>
        </div>

        <div className="spacer" />

        <Link className="pill" to="/">Home</Link>
        <button
  type="button"
  className="pill navInstallBtn"
  onClick={() => {
    window.dispatchEvent(new CustomEvent("qclub-install-help"));
  }}
>
  Install
</button>
        <Link className="pill" to="/photos">Photos</Link>
        <Link className="pill" to="/members">Members</Link>
        <Link className="pill" to="/players">Players</Link>
        <Link className="pill" to="/handicap">Handicap</Link>
        <Link className="pill" to="/tournaments">Tournaments</Link>
        <Link className="pill" to="/fixtures">Fixtures</Link>
        <Link className="pill" to="/leaderboard">Leaderboards</Link>
        <Link className="pill" to="/halloffame">Hall of Fame</Link>
        {(admin || staffAdmin) ? <Link className="pill" to="/tv">TV</Link> : null}
        {(admin || staffAdmin) ? <Link className="pill" to="/staff-walkins">Walk-ins</Link> : null}
        {(admin || staffAdmin) ? <Link className="pill" to="/inventory">Inventory</Link> : null}
        {(admin || staffAdmin) ? <Link className="pill" to="/admin/orders">Orders</Link> : null}
        {(admin || staffAdmin) ? <Link className="pill" to="/shop/successful-order-receipts">Shop Receipts</Link> : null}
        {admin ? <Link className="pill" to="/member-registry">Member Registry</Link> : null}
        {(admin || committeeAdmin) ? <Link className="pill" to="/review-panel">Review Panel</Link> : null}
        {(admin || staffAdmin) ? <Link className="pill" to="/match-ledger">Match Ledger</Link> : null}
        {admin ? <Link className="pill" to="/admin-panel">Admin Panel</Link> : null}

        {admin && (
  <>
    <button className="btn primary" onClick={onToggleAdmin}>
      Admin: ON
    </button>
    <button className="btn" onClick={onChangePin}>Change PIN</button>
  </>
)}
      </div>
    </div>
  );
}