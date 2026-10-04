import React, { useEffect, useState } from "react";
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

function AnnouncementTicker({ notices, speed }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [manual, setManual] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);
  if (!notices.length) return null;
  const current = notices[index % notices.length];
  const duration = Math.min(180, Math.max(8, Number(speed) || 28));
  const select = (direction) => {
    setIndex((value) => (value + notices.length + direction) % notices.length);
    setManual(true);
  };
  const renderNotice = (notice, duplicate = false) => notice.link
    ? <Link to={notice.link} tabIndex={duplicate ? -1 : undefined}>{notice.text}</Link>
    : <span>{notice.text}</span>;
  return (
    <section className="v2-live-ticker" aria-label="Club announcements">
      <div className="v2-live-ticker-inner">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m3 10 18-6v16L3 14v-4Zm4 5 2 6h4l-2-5" /></svg>
        <div className="v2-live-ticker-text" aria-live="off"
          onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
          onFocus={() => setFocused(true)} onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
          {reducedMotion || manual ? <div className="v2-live-ticker-static">{renderNotice(current)}</div> :
            <div className="v2-live-ticker-track" style={{ "--ticker-duration": `${duration}s`, animationPlayState: paused || hovered || focused ? "paused" : "running" }}>
              {[false, true].map((duplicate) => <div className="v2-live-ticker-group" key={String(duplicate)} aria-hidden={duplicate || undefined}>
                {notices.map((notice, itemIndex) => <div className="v2-live-ticker-item" key={notice.id || itemIndex}>{renderNotice(notice, duplicate)}</div>)}
              </div>)}
            </div>}
        </div>
        <div className="v2-live-ticker-controls">
          {notices.length > 1 ? <>
            <button type="button" aria-label="Previous announcement" onClick={() => select(-1)}>‹</button>
            <button type="button" aria-label="Next announcement" onClick={() => select(1)}>›</button>
          </> : null}
          {!reducedMotion ? <button type="button" aria-label={paused || manual ? "Resume announcements" : "Pause announcements"}
            onClick={() => { if (manual) { setManual(false); setPaused(false); } else setPaused((value) => !value); }}>
            {paused || manual ? <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="m4 2 10 6-10 6Z"/></svg> :
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M3 2h3v12H3zM10 2h3v12h-3z"/></svg>}
          </button> : null}
        </div>
      </div>
    </section>
  );
}

function FeatureIcon({ kind }) {
  const paths = {
    book: <><circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="4" /><path d="m16 8 5-5" /></>,
    food: <><path d="M4 3v7a3 3 0 0 0 6 0V3M7 3v18M20 3c-4 3-4 8 0 9V3Zm0 9v9" /></>,
    shop: <><path d="M5 7h14l2 14H3L5 7Z" /><path d="M9 7V5a3 3 0 0 1 6 0v2" /></>,
    membership: <><path d="m8 14-1 7 5-3 5 3-1-7" /><circle cx="12" cy="8" r="6" /></>,
  };
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[kind]}</svg>;
}

export default function V2Home({ data, activeTournament }) {
  const club = data?.club || {};
  const notices = activeNotices(data).slice(0, 10);
  const tiers = (data?.memberships || []).slice(0, 4);
  const tournament = activeTournament || (data?.tournaments || []).find(Boolean) || null;

  const features = [
    { title: "Book a table", text: "Reserve snooker, mini snooker or American pool.", to: "/book", icon: "book", action: "Reserve a table" },
    { title: "Q Lounge", text: "Food, drinks and a break between frames.", to: "/food", icon: "food", action: "Browse the menu" },
    { title: "The Q Shop", text: "Cue sticks, cases, chalk and club accessories.", to: "/shop", icon: "shop", action: "Explore the shop" },
    { title: "Membership", text: "Member rates, club access and more time to play.", to: "/membership", icon: "membership", action: "View membership" },
  ];

  return (
    <main className="qclub-v2-home" id="main-content">
      <AnnouncementTicker notices={notices} speed={club.tickerSpeed} />

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
            [46, 156], [78, 156], [110, 156], [142, 156], [174, 156],
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
        <h2 id="v2-live-explore">Your time at The Q Club</h2>
        <div className="v2-live-feature-grid">
          {features.map((feature) => (
            <Link className="v2-live-feature-card" to={feature.to} key={feature.to}>
              <span className="v2-live-feature-icon"><FeatureIcon kind={feature.icon} /></span>
              <h3>{feature.title}</h3>
              <p>{feature.text}</p>
              <strong>{feature.action} <span aria-hidden="true">→</span></strong>
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

