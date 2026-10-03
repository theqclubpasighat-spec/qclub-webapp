import React from "react";
import { Link } from "react-router-dom";

const money = (amount) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(amount || 0));

export function V2LegalHub() {
  const pages = [
    { to: "/terms", title: "Terms & Conditions", text: "Club use, membership, bookings, QShop and service terms." },
    { to: "/refund", title: "Refund Policy", text: "Current refund, exchange and rescheduling policy." },
    { to: "/privacy", title: "Privacy Policy", text: "How customer information is used and protected." },
    { to: "/tournament-legal", title: "Tournament Legal Notice", text: "Current tournament participation and wagering disclaimer." },
  ];
  return (
    <main className="v2-live-section" id="main-content">
      <div className="v2-live-page-heading">
        <div>
          <p className="v2-live-eyebrow">Policies & notices</p>
          <h1>Legal information</h1>
          <p className="v2-live-muted">These links open the existing production policies. No separate policy copy is stored here.</p>
        </div>
        <Link className="v2-live-button" to="/">Home</Link>
      </div>
      <div className="v2-live-feature-grid">
        {pages.map((page) => (
          <Link className="v2-live-feature-card" to={page.to} key={page.to}>
            <span aria-hidden="true">§</span>
            <h3>{page.title}</h3>
            <p>{page.text}</p>
            <strong>Open →</strong>
          </Link>
        ))}
      </div>
    </main>
  );
}

export function V2Pricing({ data }) {
  const memberships = Array.isArray(data?.memberships) ? data.memberships : [];
  const tables = Array.isArray(data?.booking?.tables) ? data.booking.tables : [];
  return (
    <main className="v2-live-section" id="main-content">
      <div className="v2-live-page-heading">
        <div>
          <p className="v2-live-eyebrow">Current club rates</p>
          <h1>Pricing</h1>
          <p className="v2-live-muted">Rates shown here come from the same website data used by membership and table booking.</p>
        </div>
        <div className="v2-live-inline-actions">
          <Link className="v2-live-button v2-live-primary" to="/book">Book a table</Link>
          <Link className="v2-live-button" to="/membership">Membership</Link>
        </div>
      </div>

      <section className="v2-live-panel" aria-labelledby="pricing-membership">
        <p className="v2-live-eyebrow">Membership</p>
        <h2 id="pricing-membership">Membership tiers</h2>
        {memberships.length ? (
          <div className="v2-live-tier-row">
            {memberships.map((tier) => (
              <div className="v2-live-tier" key={tier.id || tier.tier || tier.name}>
                <strong>{tier.tier || tier.name || "Membership"}</strong>
                <span>{money(tier.price)}</span>
                {tier.note ? <small className="v2-live-muted">{tier.note}</small> : null}
              </div>
            ))}
          </div>
        ) : <p className="v2-live-muted">Membership prices are currently unavailable.</p>}
      </section>

      <section className="v2-live-panel" aria-labelledby="pricing-tables">
        <p className="v2-live-eyebrow">Tables</p>
        <h2 id="pricing-tables">Hourly table rates</h2>
        {tables.length ? (
          <div className="v2-live-rate-list">
            {tables.map((table) => (
              <div className="v2-live-rate-row" key={table.id || table.label}>
                <div><strong>{table.label || "Table"}</strong></div>
                <div><span>Standard</span><strong>{money(table.pricePerHour)}/hr</strong></div>
                <div><span>Member</span><strong>{money(table.memberPricePerHour)}/hr</strong></div>
              </div>
            ))}
          </div>
        ) : <p className="v2-live-muted">Table rates are currently unavailable.</p>}
      </section>
    </main>
  );
}


export function V2RulesHub() {
  return (
    <main className="v2-live-section" id="main-content">
      <div className="v2-live-page-heading">
        <div>
          <p className="v2-live-eyebrow">Club conduct</p>
          <h1>Club rules</h1>
          <p className="v2-live-muted">The current club rules are maintained inside the Terms & Conditions so there is one authoritative policy copy.</p>
        </div>
        <Link className="v2-live-button" to="/">Home</Link>
      </div>
      <section className="v2-live-panel">
        <h2>Read the current rules</h2>
        <p className="v2-live-muted">Open Terms & Conditions for the current Club Rules section and the related membership, booking, QShop and management terms.</p>
        <div className="v2-live-inline-actions">
          <Link className="v2-live-button v2-live-primary" to="/terms">Open Terms & Conditions</Link>
          <Link className="v2-live-button" to="/legal">All legal information</Link>
        </div>
      </section>
    </main>
  );
}
