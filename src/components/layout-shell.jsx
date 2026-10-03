import React, { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";

const PUBLIC_V2_PATHS = new Set([
  "/",
  "/about",
  "/contact",
  "/jobs",
  "/photos",
  "/offer",
  "/live",
  "/membership",
  "/members",
  "/book",
  "/tournaments",
  "/tournament-register",
  "/fixtures",
  "/leaderboard",
  "/players",
  "/handicap",
  "/halloffame",
  "/air-hockey",
  "/foosball",
  "/massage-chair",
  "/air-hockey-info",
  "/foosball-info",
  "/massage-chair-info",
  "/shop",
  "/food",
  "/rummy-snooker",
  "/qchase-records",
  "/qchase-monthly",
  "/kitty",
  "/kitty-records",
  "/kitty-monthly",
  "/about",
  "/terms",
  "/refund",
  "/refund-policy",
  "/privacy",
  "/legal",
  "/pricing",
  "/rules",
  "/feedback",
  "/anti-gambling",
  "/tournament-legal",
]);

function PublicLink({ to, children, onNavigate }) {
  return <Link to={to} onClick={onNavigate}>{children}</Link>;
}

export function FooterLinks({ data, admin, commit }) {
  return (
    <footer className="v2-live-footer">
      <div className="v2-live-footer-inner">
        <div>
          <div className="v2-live-footer-brand">The Q Club · Pasighat</div>
          <p>
            {data.club?.footerAbout || "Premium indoor gaming lounge at GTC, Pasighat."}
          </p>
          <p>
            {data.club?.footerDescription || "Snooker, Pool, Air Hockey, Foosball, Massage Chair, Tea & Coffee."}
          </p>
        </div>

        <div className="v2-live-footer-links">
          <Link to="/about">{data.club?.footerAboutLabel || "About Us"}</Link>
          <Link to="/contact">{data.club?.footerContactLabel || "Contact Us"}</Link>
          <Link to="/terms">{data.club?.footerTermsLabel || "Terms & Conditions"}</Link>
          <Link to="/refund">{data.club?.footerRefundLabel || "Refund Policy"}</Link>
          <Link to="/privacy">{data.club?.footerPrivacyLabel || "Privacy Policy"}</Link>
        </div>

        {admin ? (
          <div className="v2-live-footer-admin">
            <button
              className="v2-live-button"
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

            <button
              className="v2-live-button"
              type="button"
              onClick={() => {
                const footerAboutLabel = prompt("About label:", data.club?.footerAboutLabel || "About Us");
                if (!footerAboutLabel) return;
                const footerContactLabel = prompt("Contact label:", data.club?.footerContactLabel || "Contact Us");
                if (!footerContactLabel) return;
                const footerTermsLabel = prompt("Terms label:", data.club?.footerTermsLabel || "Terms & Conditions");
                if (!footerTermsLabel) return;
                const footerRefundLabel = prompt("Refund label:", data.club?.footerRefundLabel || "Refund Policy");
                if (!footerRefundLabel) return;
                const footerPrivacyLabel = prompt("Privacy label:", data.club?.footerPrivacyLabel || "Privacy Policy");
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
        ) : null}
      </div>
    </footer>
  );
}

export function TopNav({ club, admin, staffAdmin, committeeAdmin, onToggleAdmin, onChangePin }) {
  const [expanded, setExpanded] = useState(false);
  const location = useLocation();
  const pressTimer = useRef(null);
  const pathname = location.pathname;

  useEffect(() => {
    setExpanded(false);
  }, [pathname]);

  useEffect(() => {
    const normalized = pathname.toLowerCase();
    const isV2Public = PUBLIC_V2_PATHS.has(normalized);
    document.body.classList.toggle("qclub-v2-live", isV2Public);
    return () => document.body.classList.remove("qclub-v2-live");
  }, [pathname]);

  const closeMenu = () => setExpanded(false);

  return (
    <header className="v2-live-header">
      <div className="v2-live-header-row">
        <Link
          to="/"
          className="v2-live-brand"
          aria-label="The Q Club home"
          onDoubleClick={(event) => {
            event.preventDefault();
            onToggleAdmin?.();
          }}
          onTouchStart={() => {
            pressTimer.current = window.setTimeout(() => onToggleAdmin?.(), 800);
          }}
          onTouchEnd={() => {
            if (pressTimer.current) window.clearTimeout(pressTimer.current);
          }}
        >
          <span className="v2-live-brand-mark" aria-hidden="true">Q</span>
          <span className="v2-live-brand-copy">
            <strong>{club?.name || "The Q Club"}</strong>
            <small>{club?.location || "Pasighat"} · {club?.tagline || "Play. Chill. Compete."}</small>
          </span>
        </Link>

        <nav className="v2-live-core-nav" aria-label="Primary navigation">
          <PublicLink to="/book">Book</PublicLink>
          <PublicLink to="/membership">Membership</PublicLink>
          <PublicLink to="/food">Q Lounge</PublicLink>
          <PublicLink to="/shop">Q Shop</PublicLink>
          <PublicLink to="/tournaments">Tournaments</PublicLink>
        </nav>

        <button
          type="button"
          className="v2-live-menu-button"
          aria-expanded={expanded}
          aria-controls="qclub-v2-menu"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? "Close" : "Menu"}
        </button>
      </div>

      <nav id="qclub-v2-menu" className={`v2-live-menu ${expanded ? "is-open" : ""}`} aria-label="All Q Club pages">
        <div className="v2-live-menu-section">Club</div>
        <PublicLink to="/" onNavigate={closeMenu}>Home</PublicLink>
        <button
          type="button"
          onClick={() => {
            closeMenu();
            window.dispatchEvent(new CustomEvent("qclub-install-help"));
          }}
        >
          Install
        </button>
        <PublicLink to="/photos" onNavigate={closeMenu}>Photos</PublicLink>
        <PublicLink to="/members" onNavigate={closeMenu}>Members</PublicLink>
        <PublicLink to="/players" onNavigate={closeMenu}>Players</PublicLink>
        <PublicLink to="/handicap" onNavigate={closeMenu}>Handicap</PublicLink>
        <PublicLink to="/tournaments" onNavigate={closeMenu}>Tournaments</PublicLink>
        <PublicLink to="/fixtures" onNavigate={closeMenu}>Fixtures</PublicLink>
        <PublicLink to="/leaderboard" onNavigate={closeMenu}>Leaderboards</PublicLink>
        <PublicLink to="/halloffame" onNavigate={closeMenu}>Hall of Fame</PublicLink>
        <PublicLink to="/rummy-snooker" onNavigate={closeMenu}>Q Chase</PublicLink>
        <PublicLink to="/kitty" onNavigate={closeMenu}>Kitty</PublicLink>

        <div className="v2-live-menu-section">Book, eat & shop</div>
        <PublicLink to="/book" onNavigate={closeMenu}>Book a Table</PublicLink>
        <PublicLink to="/membership" onNavigate={closeMenu}>Membership</PublicLink>
        <PublicLink to="/food" onNavigate={closeMenu}>Q Lounge</PublicLink>
        <PublicLink to="/shop" onNavigate={closeMenu}>Q Shop</PublicLink>

        {(admin || staffAdmin || committeeAdmin) ? (
          <>
            <div className="v2-live-menu-section">Operations</div>
            {(admin || staffAdmin) ? <PublicLink to="/tv" onNavigate={closeMenu}>TV</PublicLink> : null}
            {(admin || staffAdmin) ? <PublicLink to="/staff-walkins" onNavigate={closeMenu}>Walk-ins</PublicLink> : null}
            {(admin || staffAdmin) ? <PublicLink to="/inventory" onNavigate={closeMenu}>Inventory</PublicLink> : null}
            {(admin || staffAdmin) ? <PublicLink to="/admin/orders" onNavigate={closeMenu}>Orders</PublicLink> : null}
            {(admin || staffAdmin) ? <PublicLink to="/shop/successful-order-receipts" onNavigate={closeMenu}>Shop Receipts</PublicLink> : null}
            {admin ? <PublicLink to="/member-registry" onNavigate={closeMenu}>Member Registry</PublicLink> : null}
            {(admin || committeeAdmin) ? <PublicLink to="/review-panel" onNavigate={closeMenu}>Review Panel</PublicLink> : null}
            {(admin || staffAdmin) ? <PublicLink to="/match-ledger" onNavigate={closeMenu}>Match Ledger</PublicLink> : null}
            {admin ? <PublicLink to="/admin-panel" onNavigate={closeMenu}>Admin Panel</PublicLink> : null}
          </>
        ) : null}

        {admin ? (
          <>
            <div className="v2-live-menu-section">Admin session</div>
            <button className="v2-live-admin-on" type="button" onClick={() => { closeMenu(); onToggleAdmin?.(); }}>
              Admin: ON
            </button>
            <button type="button" onClick={() => { closeMenu(); onChangePin?.(); }}>
              Change PIN
            </button>
          </>
        ) : null}
      </nav>
    </header>
  );
}
