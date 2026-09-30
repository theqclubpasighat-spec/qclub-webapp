import React from "react";
import { Link } from "react-router-dom";

const money = (amount) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(Number(amount || 0));

function activeNotices(data) {
  const now = Date.now();
  return (data?.announcements || []).filter((notice) => {
    if (!notice?.text) return false;
    if (!notice.expiresAt) return true;
    const expires = new Date(notice.expiresAt).getTime();
    return !Number.isFinite(expires) || expires > now;
  });
}

export default function V2Home({ data, activeTournament }) {
  const club = data?.club || {};
  const notices = activeNotices(data).slice(0, 4);
  const tiers = (data?.memberships || []).slice(0, 4);
  const tournament = activeTournament || (data?.tournaments || []).find(Boolean) || null;

  const features = [
    { title: "Book a table", text: "Reserve snooker, mini snooker or American pool.", to: "/book", icon: "◉" },
    { title: "Q Lounge", text: "Browse the club food and refreshment catalogue.", to: "/food", icon: "☕" },
    { title: "The Q Shop", text: "Cue sticks, cases, chalk and club accessories.", to: "/shop", icon: "◇" },
    { title: "Membership", text: "Member rates, RFID access and club privileges.", to: "/membership", icon: "✦" },
  ];

  return (
    <main className="qclub-v2-home" id="main-content">
      {notices.length ? (
        <section className="v2-live-notices" aria-label="Club notices">
          {notices.map((notice) =>
            notice.link ? (
              <Link key={notice.id || notice.text} to={notice.link} className="v2-live-notice">
                {notice.text}
              </Link>
            ) : (
              <span key={notice.id || notice.text} className="v2-live-notice">
                {notice.text}
              </span>
            )
          )}
        </section>
      ) : null}

      <section className="v2-live-hero">
        <svg className="v2-live-rack" viewBox="0 0 220 190" aria-hidden="true">
          <path d="M110 14 L204 176 H16 Z" />
          {[
            [110, 44],
            [94, 72],
            [126, 72],
            [78, 100],
            [110, 100],
            [142, 100],
            [62, 128],
            [94, 128],
            [126, 128],
            [158, 128],
          ].map(([x, y]) => (
            <circle key={`${x}-${y}`} cx={x} cy={y} r="13" />
          ))}
        </svg>
        <p className="v2-live-eyebrow">Cue sports & social club</p>
        <h1>{club.name || "The Q Club"}</h1>
        <p className="v2-live-tagline">{club.tagline || "Play. Chill. Compete."}</p>
        <p className="v2-live-intro">
          Snooker, pool, club competitions and good company in Pasighat.
        </p>
        <div className="v2-live-actions">
          <Link className="v2-live-button v2-live-primary" to="/book">
            Book a table
          </Link>
          <Link className="v2-live-button" to="/tournaments">
            Tournaments
          </Link>
        </div>
        <div className="v2-live-open-badge">
          <span className={club.isOpenNow ? "v2-live-dot" : "v2-live-dot is-closed"} />
          {club.isOpenNow ? "Open now" : "Closed now"}
          {club.hoursNote ? <small>{club.hoursNote}</small> : null}
        </div>
      </section>

      <section className="v2-live-section" aria-labelledby="v2-live-explore">
        <p className="v2-live-eyebrow">Make yourself at home</p>
        <h2 id="v2-live-explore">Everything you need, without the endless scroll</h2>
        <div className="v2-live-feature-grid">
          {features.map((feature) => (
            <Link className="v2-live-feature-card" to={feature.to} key={feature.to}>
              <span aria-hidden="true">{feature.icon}</span>
              <h3>{feature.title}</h3>
              <p>{feature.text}</p>
              <strong>Open →</strong>
            </Link>
          ))}
        </div>
      </section>

      <section className="v2-live-section v2-live-split">
        <div className="v2-live-panel">
          <p className="v2-live-eyebrow">Competition</p>
          <h2>{tournament?.name || "Club tournaments"}</h2>
          <p className="v2-live-muted">
            {tournament
              ? `${tournament.month || "Current event"} · ${tournament.game || "Cue sports"}`
              : "Upcoming tournaments, fixtures and results live here."}
          </p>
          <div className="v2-live-inline-actions">
            <Link className="v2-live-button v2-live-primary" to="/tournaments">
              View tournaments
            </Link>
            <Link className="v2-live-button" to="/fixtures">
              Fixtures
            </Link>
          </div>
        </div>

        <div className="v2-live-panel">
          <p className="v2-live-eyebrow">Membership</p>
          <h2>Make it your club</h2>
          {tiers.length ? (
            <div className="v2-live-tier-row">
              {tiers.map((tier) => (
                <div className="v2-live-tier" key={tier.id || tier.tier}>
                  <strong>{tier.tier || tier.name}</strong>
                  <span>{money(tier.price)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="v2-live-muted">Membership options are available at the club.</p>
          )}
          <Link className="v2-live-text-link" to="/membership">
            Compare membership tiers →
          </Link>
        </div>
      </section>

      <section className="v2-live-quicklinks" aria-label="Quick links">
        <Link to="/players">Players</Link>
        <Link to="/leaderboard">Leaderboard</Link>
        <Link to="/halloffame">Hall of Fame</Link>
        <Link to="/photos">Photos</Link>
        <Link to="/rummy-snooker">Q Chase</Link>
        <Link to="/kitty">Kitty</Link>
      </section>
    </main>
  );
}
