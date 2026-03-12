/* ================================
   App.jsx — PART 1
   (Beginning → inside resetAll())
================================ */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Routes, Route, Link, useNavigate, useLocation } from "react-router-dom";

// Supabase Cloud Sync helpers (implemented in src/cloud.js)
import { cloudMissingVars, isCloudEnabled, subscribeState, writeState } from "./cloud";

/* =========================================================
   Q CLUB – Single-file WebApp (Mobile-first)
   - LocalStorage database
   - Admin mode
   - Booking + "payment submitted" ping notification
   - Membership apply + UPI QR (display only)
   - Photos upload (file)
   - Hall of Fame CRUD + description + photo
   - Players: clickable profile modal + stats/rank
   - Tournaments: fixtures + per-tournament leaderboards + overall leaderboard
========================================================= */

const LS_KEY = "qclub_v5_data";

/* ---------------------------
   Helpers
---------------------------- */
function uid() {
  return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
}

function safeNum(x, fallback = 0) {
  const v = Number(x);
  return Number.isFinite(v) ? v : fallback;
}

function monthKey(d = new Date()) {
  return d.toISOString().slice(0, 7);
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function bookingTimeSlots(selectedDate = todayIso()) {
  const slots = [];
  const today = todayIso();
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  for (let hour = 11; hour <= 22; hour += 1) {
    const next = hour + 1;
    const start = `${String(hour).padStart(2, "0")}:00`;
    const end = `${String(next).padStart(2, "0")}:00`;

    const slotStartMinutes = hour * 60;
    const slotEndMinutes = next * 60;

    const isPastToday =
      selectedDate === today && currentMinutes >= slotEndMinutes;

    const isRunningNow =
      selectedDate === today &&
      currentMinutes >= slotStartMinutes &&
      currentMinutes < slotEndMinutes;

    slots.push({
      value: `${start}-${end}`,
      label: `${start} to ${end}`,
      disabled: isPastToday || isRunningNow,
    });
  }

  return slots;
}

function bookingAmountFor(table, bookingType) {
  if (!table) return 0;

  if (bookingType !== "member")
    return Math.max(0, safeNum(table.pricePerHour, 0));

  if (table.id === "snk12") return 300;
  if (table.id === "mini10" || table.id === "pool9") return 200;

  return Math.max(0, safeNum(table.pricePerHour, 0));
}

function isActiveBookingStatus(status) {
  return [
    "pending",
    "verified",
    "pending_member_verification",
    "member_verified",
  ].includes(status);
}

function hasBookingConflict(requests, nextRequest) {
  return (requests || []).some((r) => {
    if (!isActiveBookingStatus(r.status)) return false;

    return (
      r.itemId === nextRequest.itemId &&
      r.bookingDate === nextRequest.bookingDate &&
      r.timeSlot === nextRequest.timeSlot
    );
  });
}

function bookingStatusLabel(status) {
  switch (status) {
    case "verified":
      return "verified";
    case "member_verified":
      return "member approved";
    case "member_rejected":
      return "member rejected";
    case "pending_member_verification":
      return "member verify";
    default:
      return "pending";
  }
}

function offerPriceLines(price) {
  if (!price) return [];

  return String(price)
    .split(/\s*[•|]\s*|\s*,\s*/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

function tournamentDisplay(t) {
  if (!t) return "—";

  const parts = [t.name, t.month].filter(Boolean);

  return parts.join(" • ") || "—";
}

function normalizePlayerGames(value) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
    ? value.split(",")
    : [];

  const cleaned = raw
    .map((x) => String(x || "").trim().toLowerCase())
    .filter(Boolean)
    .map((x) => (x === "snooker" || x === "pool" ? x : null))
    .filter(Boolean);

  return cleaned.length ? Array.from(new Set(cleaned)) : ["snooker"];
}

function playerGamesLabel(player) {
  const games = normalizePlayerGames(player?.games);

  return games
    .map((x) => (x === "snooker" ? "Snooker" : "Pool"))
    .join(" / ");
}

function tournamentGameKey(game) {
  const value = String(game || "").trim().toLowerCase();

  if (value.includes("pool")) return "pool";

  return "snooker";
}
function getPlayersForGame(players, gameKey) {
  return (players || []).filter((p) => normalizePlayerGames(p?.games).includes(gameKey));
}

function getCurrentTournamentForGame(tournaments, gameKey) {
  const filtered = (tournaments || []).filter((t) => tournamentGameKey(t?.game) === gameKey);
  const flagged = filtered.find((t) => t.isCurrent);
  if (flagged) return flagged;
  return filtered
    .slice()
    .sort((a, b) => `${a.month || ""}|${a.createdAt || 0}`.localeCompare(`${b.month || ""}|${b.createdAt || 0}`))
    .pop() || null;
}

function getEligiblePlayersForTournament(players, tournament) {
  const gameKey = tournamentGameKey(tournament?.game);
  return getPlayersForGame(players || [], gameKey);
}

function calcAutoRankingBoard(players, tournaments, gameKey) {
  const eligiblePlayers = getPlayersForGame(players || [], gameKey);
  const rows = eligiblePlayers.map((p) => ({
    id: p.id,
    name: p.name,
    city: p.city || "",
    tournaments: 0,
    matches: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    points: 0,
    for: 0,
    against: 0,
  }));
  const byId = new Map(rows.map((r) => [r.id, r]));

  (tournaments || [])
    .filter((t) => tournamentGameKey(t?.game) === gameKey)
    .forEach((t) => {
      const eligibleIds = new Set(getEligiblePlayersForTournament(players, t).map((p) => p.id));
      const participantIds = t.participantIds?.length ? new Set(t.participantIds) : eligibleIds;
      const touched = new Set();

      (t.matches || []).forEach((m) => {
        if (m.status !== "done") return;
        const a = byId.get(m.p1);
        const b = byId.get(m.p2);
        if (!a || !b) return;
        if (participantIds && (!participantIds.has(m.p1) || !participantIds.has(m.p2))) return;

        const s1 = Number(m.score1);
        const s2 = Number(m.score2);
        if (!Number.isFinite(s1) || !Number.isFinite(s2)) return;

        touched.add(m.p1);
        touched.add(m.p2);

        a.matches++;
        b.matches++;
        a.for += s1;
        a.against += s2;
        b.for += s2;
        b.against += s1;

        if (s1 > s2) {
          a.wins++;
          b.losses++;
          a.points += t.pointsWin ?? 3;
          b.points += t.pointsLoss ?? 0;
        } else if (s2 > s1) {
          b.wins++;
          a.losses++;
          b.points += t.pointsWin ?? 3;
          a.points += t.pointsLoss ?? 0;
        } else {
          a.draws++;
          b.draws++;
          a.points += t.pointsDraw ?? 1;
          b.points += t.pointsDraw ?? 1;
        }
      });

      touched.forEach((id) => {
        const row = byId.get(id);
        if (row) row.tournaments++;
      });
    });

  return rows.sort((x, y) => {
    const dx = x.for - x.against;
    const dy = y.for - y.against;
    return (y.points - x.points) || (dy - dx) || (y.wins - x.wins) || x.name.localeCompare(y.name);
  });
}

function normalizedClubUpiId(raw) {
  const value = String(raw || "").trim();
  if (!value || /yomsoji/i.test(value)) return "Q526263817@ybl";
  return value;
}

function upiDeepLink({ pa, pn, am, tn }) {
  const params = new URLSearchParams();
  if (pa) params.set("pa", pa);
  if (pn) params.set("pn", pn);
  if (am) params.set("am", String(am));
  params.set("cu", "INR");
  if (tn) params.set("tn", tn);
  return `upi://pay?${params.toString()}`;
}

function qrUrl(data, size = 240) {
  const enc = encodeURIComponent(data);
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${enc}`;
}

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/* ---------------------------
   Default data
---------------------------- */
function defaultData() {
  return {
    club: {
      name: "The Q CLUB",
      location: "Pasighat",
      tagline: "Play. Chill. Compete.",
      contact: { phone1: "7005212774", phone2: "7085221922" },
      upiId: "Q526263817@ybl",
      upiName: "THE Q CLUB",
      isOpenNow: true,
      hoursNote: "Members only from 6 pm",
      musicUrl: "",
      videoUrl: "",
    },
    admin: { pin: "1234" },
    announcements: [
      { id: uid(), text: "Monthly tournaments every month 🔥 Register at counter.", createdAt: Date.now() },
    ],
    memberships: [
      {
        id: uid(),
        tier: "Bronze",
        price: 499,
        perks: ["Entry access during open hours", "Member pricing on games (where applicable)"],
        note: "Non-transferable",
      },
      {
        id: uid(),
        tier: "Silver",
        price: 999,
        perks: ["1 game free per day", "Unlimited water"],
        note: "Non-transferable",
      },
      {
        id: uid(),
        tier: "Gold",
        price: 1499,
        perks: ["1 game free per day", "10 min massage chair/day", "1 tea/coffee/day", "Unlimited water"],
        note: "Non-transferable",
      },
      {
        id: uid(),
        tier: "Platinum",
        price: 1999,
        perks: ["Priority bookings", "1 game free per day", "20 min massage chair/day", "2 tea/coffee/day", "Unlimited water"],
        note: "Non-transferable",
      },
    ],
    offers: [
      { id: uid(), title: "Massage Chair", price: "₹99 / 10 min • ₹199 / 20 min", details: "Relax between frames." },
      { id: uid(), title: "Foosball", price: "₹50 / game", details: "Best of 3 fun matches." },
      { id: uid(), title: "Air Hockey", price: "₹50 / game", details: "Fast rounds — winner stays!" },
      { id: uid(), title: "Tea/Coffee Vending", price: "₹10–₹20", details: "Self-serve vending." },
    ],
    photos: [],
    players: [
      { id: uid(), name: "Wilson", city: "Pasighat", photo: "", bio: "", games: ["snooker", "pool"] },
      { id: uid(), name: "Riku", city: "Pasighat", photo: "", bio: "", games: ["snooker"] },
      { id: uid(), name: "Tani", city: "Aalo", photo: "", bio: "", games: ["pool"] },
      { id: uid(), name: "Bikash", city: "Roing", photo: "", bio: "", games: ["snooker", "pool"] },
    ],
    tournaments: [
      {
        id: uid(),
        name: "Monthly Snooker Cup",
        month: monthKey(),
        game: "Snooker",
        format: "Round Robin",
        pointsWin: 3,
        pointsDraw: 1,
        pointsLoss: 0,
        participantIds: [],
        matches: [],
      },
    ],
    booking: {
      tables: [
        { id: "snk12", label: "Snooker Table 12x6 — ₹400 / hour", pricePerHour: 400 },
        { id: "mini10", label: "Mini Snooker 10x5 — ₹300 / hour", pricePerHour: 300 },
        { id: "pool9", label: "American Pool — ₹300 / hour", pricePerHour: 300 },
      ],
      requests: [],
      lastSeenRequestAt: 0,
    },
        hallOfFame: [],
    mediaLibrary: [],
  };
}

function pickText(value, fallback) {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function mergeWithDefaults(remote) {
  const base = defaultData();
  const src = remote && typeof remote === "object" ? remote : {};

  return {
    ...base,
    ...src,
    club: {
      ...base.club,
      ...(src.club || {}),
      name: pickText(src?.club?.name, base.club.name),
      location: pickText(src?.club?.location, base.club.location),
      tagline: pickText(src?.club?.tagline, base.club.tagline),
      upiId: pickText(src?.club?.upiId, base.club.upiId),
      upiName: pickText(src?.club?.upiName, base.club.upiName),
      contact: {
        ...base.club.contact,
        ...((src.club || {}).contact || {}),
        phone1: pickText(src?.club?.contact?.phone1, base.club.contact.phone1),
        phone2: pickText(src?.club?.contact?.phone2, base.club.contact.phone2),
      },
    },
    admin: {
      ...base.admin,
      ...(src.admin || {}),
      pin: pickText(src?.admin?.pin, base.admin.pin),
    },
    announcements: Array.isArray(src.announcements) && src.announcements.length ? src.announcements : base.announcements,
    memberships: Array.isArray(src.memberships) && src.memberships.length ? src.memberships : base.memberships,
    offers: Array.isArray(src.offers) && src.offers.length ? src.offers : base.offers,
    photos: Array.isArray(src.photos) ? src.photos : base.photos,
    players: Array.isArray(src.players) && src.players.length ? src.players.map((p) => ({ ...p, games: normalizePlayerGames(p?.games) })) : base.players,
    tournaments: Array.isArray(src.tournaments) && src.tournaments.length ? src.tournaments : base.tournaments,
    booking: {
      ...base.booking,
      ...(src.booking || {}),
      tables: Array.isArray(src?.booking?.tables) && src.booking.tables.length ? src.booking.tables : base.booking.tables,
      requests: Array.isArray(src?.booking?.requests) ? src.booking.requests : base.booking.requests,
      lastSeenRequestAt: Number.isFinite(src?.booking?.lastSeenRequestAt) ? src.booking.lastSeenRequestAt : base.booking.lastSeenRequestAt,
    },
        hallOfFame: Array.isArray(src.hallOfFame) ? src.hallOfFame : base.hallOfFame,
  };
}

function isMeaningfulState(obj) {
  if (!obj || typeof obj !== "object") return false;
  return Object.keys(obj).length > 0;
}

function loadData() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaultData();
    const parsed = JSON.parse(raw);
    return mergeWithDefaults(parsed);
  } catch {
    return defaultData();
  }
}

function saveData(data) {
  localStorage.setItem(LS_KEY, JSON.stringify(data));
}

/* ---------------------------
   Round robin fixtures
---------------------------- */
function generateRoundRobin(playerIds) {
  const ids = [...playerIds];
  const BYE = "BYE";
  if (ids.length < 2) return [];
  if (ids.length % 2 === 1) ids.push(BYE);

  const n = ids.length;
  const rounds = n - 1;
  const half = n / 2;
  const arr = [...ids];

  const matches = [];
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < half; i++) {
      const p1 = arr[i];
      const p2 = arr[n - 1 - i];
      if (p1 !== BYE && p2 !== BYE) {
        matches.push({
          id: uid(),
          round: r + 1,
          p1,
          p2,
          score1: "",
          score2: "",
          status: "scheduled",
          updatedAt: Date.now(),
        });
      }
    }
    const fixed = arr[0];
    const rest = arr.slice(1);
    rest.unshift(rest.pop());
    arr.splice(0, arr.length, fixed, ...rest);
  }
  return matches;
}

/* ---------------------------
   Leaderboard calc (per tournament)
---------------------------- */
function calcLeaderboard(players, tournament) {
  const rows = players.map((p) => ({
    id: p.id,
    name: p.name,
    city: p.city || "",
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    points: 0,
    for: 0,
    against: 0,
  }));
  const byId = new Map(rows.map((r) => [r.id, r]));

  (tournament.matches || []).forEach((m) => {
    if (m.status !== "done") return;
    const a = byId.get(m.p1);
    const b = byId.get(m.p2);
    if (!a || !b) return;

    const s1 = Number(m.score1);
    const s2 = Number(m.score2);
    if (!Number.isFinite(s1) || !Number.isFinite(s2)) return;

    a.played++;
    b.played++;
    a.for += s1;
    a.against += s2;
    b.for += s2;
    b.against += s1;

    if (s1 > s2) {
      a.wins++;
      b.losses++;
      a.points += tournament.pointsWin ?? 3;
      b.points += tournament.pointsLoss ?? 0;
    } else if (s2 > s1) {
      b.wins++;
      a.losses++;
      b.points += tournament.pointsWin ?? 3;
      a.points += tournament.pointsLoss ?? 0;
    } else {
      a.draws++;
      b.draws++;
      a.points += tournament.pointsDraw ?? 1;
      b.points += tournament.pointsDraw ?? 1;
    }
  });

  return rows.sort((x, y) => {
    const dx = x.for - x.against;
    const dy = y.for - y.against;
    return (y.points - x.points) || (dy - dx) || (y.wins - x.wins) || x.name.localeCompare(y.name);
  });
}


/* ---------------------------
   Simple "ping" sound
---------------------------- */

function playPing() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;

    const ctx = new AudioContext();

    const o = ctx.createOscillator();
    const g = ctx.createGain();

    o.type = "sine";
    o.frequency.value = 880;
    g.gain.value = 0.08;

    o.connect(g);
    g.connect(ctx.destination);

    o.start();

    setTimeout(() => {
      o.stop();
      ctx.close();
    }, 180);
  } catch {}
}

/* =========================================================
   App
========================================================= */

export default function App() {

  const [data, setData] = useState(loadData());
  const [cloudStatus, setCloudStatus] = useState(
    isCloudEnabled() ? "syncing" : "local"
  );

  const [admin, setAdmin] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();
    const activeTournament = useMemo(() => {
    const list = data.tournaments || [];
    const flagged = list.find((t) => t.isCurrent);
    if (flagged) return flagged;

    return (
      list
        .slice()
        .sort((a, b) =>
          `${b.month || ""}|${b.createdAt || 0}`.localeCompare(
            `${a.month || ""}|${a.createdAt || 0}`
          )
        )[0] || null
    );
  }, [data.tournaments]);
    async function startPayment(amount, customerPhone = "9999999999") {
    try {
      const res = await fetch("/api/create-order", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount,
          customer_phone: customerPhone,
        }),
      });

      const data = await res.json();

      if (data?.payment_session_id) {
        const cashfree = window.Cashfree({
          mode: "production",
        });

        cashfree.checkout({
          paymentSessionId: data.payment_session_id,
          redirectTarget: "_self",
        });
      } else {
        alert("Unable to start payment. Please try again.");
        console.log(data);
      }
    } catch (err) {
      console.error(err);
      alert("Payment error. Please try again.");
    }
  }

  function commit(next) {
    const safeNext = mergeWithDefaults(next);

    setData(safeNext);
    saveData(safeNext);

    if (isCloudEnabled()) {
      setCloudStatus("syncing");

      writeState(safeNext)
        .then(() => setCloudStatus("synced"))
        .catch(() => setCloudStatus("error"));
    }
  }

  function toggleAdmin() {
  if (admin === true) {
    setAdmin(false);
    return;
  }

  const pin = prompt("Enter Admin PIN");

  if (pin === data.admin?.pin) {
    setAdmin(true);
  } else {
    alert("Wrong PIN");
  }
}

  function changePin() {
    if (!admin) return alert("Admin only");

    const p = prompt("New Admin PIN:");

    if (!p) return;

    commit({
      ...data,
      admin: { ...data.admin, pin: p },
    });

    alert("PIN updated.");
  }

  function resetAll() {
    if (!admin) return;
    if (!confirm("Reset ALL Q CLUB data to default?")) return;
    const d = defaultData();
    commit(d);
    setAdmin(false);
    navigate("/");
  }

  useEffect(() => {
    if (!admin) return;
    const lastSeen = data.booking?.lastSeenRequestAt || 0;
    const newest = Math.max(0, ...(data.booking?.requests || []).map((r) => r.createdAt || 0));
    if (newest > lastSeen) {
      playPing();
      commit({
        ...data,
        booking: { ...data.booking, lastSeenRequestAt: newest },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admin, data.booking?.requests?.length]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <>
      <TopNav
        club={data.club}
        admin={admin}
        onToggleAdmin={toggleAdmin}
        onChangePin={changePin}
        onReset={resetAll}
        cloudStatus={cloudStatus}
      />

      <Routes>
        <Route path="/" element={<Home data={data} admin={admin} commit={commit} activeTournament={activeTournament} />} />
        <Route
  path="/book"
  element={
    <BookTable
      data={data}
      admin={admin}
      commit={commit}
      startPayment={startPayment}
    />
  }
/>
        <Route
  path="/membership"
  element={
    <Membership
      data={data}
      admin={admin}
      commit={commit}
      startPayment={startPayment}
    />
  }
/>
        <Route path="/offer" element={<Offers data={data} admin={admin} commit={commit} />} />
        <Route path="/photos" element={<Photos data={data} admin={admin} commit={commit} />} />
        <Route path="/players" element={<Players data={data} admin={admin} commit={commit} activeTournament={activeTournament} />} />
        <Route path="/tournaments" element={<Tournaments data={data} admin={admin} commit={commit} />} />
        <Route path="/fixtures" element={<Fixtures data={data} admin={admin} commit={commit} />} />
        
        <Route path="/leaderboard" element={<LeaderboardAll data={data} />} />
        <Route path="/halloffame" element={<HallOfFame data={data} admin={admin} commit={commit} />} />
        <Route path="/tv" element={<TVMode data={data} activeTournament={activeTournament} players={playersForTournament(activeTournament)} />} />
        <Route path="/admin-panel" element={<AdminPanel data={data} admin={admin} commit={commit} activeTournament={activeTournament} />} />
        <Route path="/about" element={<StaticPage title="About The Q Club"><AboutContent data={data} /></StaticPage>} />
        <Route path="/contact" element={<StaticPage title="Contact Us"><ContactContent data={data} /></StaticPage>} />
        <Route path="/terms" element={<StaticPage title="Terms & Conditions"><TermsContent /></StaticPage>} />
        <Route path="/refund" element={<StaticPage title="Refund Policy"><RefundContent /></StaticPage>} />
        <Route path="/privacy" element={<StaticPage title="Privacy Policy"><PrivacyContent /></StaticPage>} />
        <Route path="/payment-status" element={<PaymentStatus />} />
        <Route path="*" element={<NotFound />} />
      </Routes>

      <FooterLinks />
      <BottomPadding />
    </>
  );
}

function FooterLinks() {
  return (
    <footer className="siteFooter">
      <div className="container">
        <div className="siteFooterInner">
          <div>
            <div className="siteFooterBrand">The Q Club</div>
            <div className="muted">
              Premium indoor gaming lounge in Pasighat with cue sports and leisure activities.
            </div>
            <div className="muted" style={{ marginTop: 10 }}>
              The Q Club is a recreational indoor sports lounge offering cue sports and leisure activities.
            </div>
          </div>

          <div className="siteFooterLinks">
            <Link to="/about">About Us</Link>
            <Link to="/contact">Contact Us</Link>
            <Link to="/terms">Terms & Conditions</Link>
            <Link to="/refund">Refund Policy</Link>
            <Link to="/privacy">Privacy Policy</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

function StaticPage({ title, children }) {
  return (
    <>
      <PageShell title={title} subtitle="The Q Club • Pasighat" />
      <div className="container legalWrap">
        <div className="legalCard">{children}</div>
      </div>
    </>
  );
}

function AboutContent({ data }) {
  return (
    <>
      <p>
        <b>The Q Club</b> is a recreational indoor gaming lounge located in{" "}
        <b>{data.club?.location || "Pasighat"}</b>, offering cue sports and leisure
        activities in a comfortable and welcoming environment.
      </p>

      <p>
        The club provides facilities for enthusiasts and casual players to enjoy games
        such as Snooker, American Pool, Mini Snooker, Air Hockey and Foosball.
      </p>

      <p>
        In addition to gaming, The Q Club also offers relaxation and refreshment
        facilities including a massage chair and tea & coffee vending services.
      </p>

      <h3>Business Nature</h3>
      <p>
        The Q Club operates as a <b>recreational indoor sports lounge</b> offering
        access to cue sports tables and leisure facilities.
      </p>

      <h3>Our Mission</h3>
      <p>
        Our goal is to provide a premium and safe recreational environment for players
        of all skill levels while encouraging healthy competition and sportsmanship.
      </p>

      <h3>Club Facilities</h3>
      <ul>
        <li>Professional Snooker Tables</li>
        <li>American Pool Table</li>
        <li>Mini Snooker Table</li>
        <li>Air Hockey Table</li>
        <li>Foosball Table</li>
        <li>Tea & Coffee Vending</li>
        <li>Massage Chair</li>
      </ul>

      <h3>Community Events</h3>
      <p>
        The Q Club may organize friendly tournaments and club events for members and
        visitors to encourage participation and enjoyment of cue sports.
      </p>
    </>
  );
}

function ContactContent({ data }) {
  const phone1 = data.club?.contact?.phone1 || "7005068497";
  const phone2 = data.club?.contact?.phone2 || "7085221922";

  return (
    <>
      <p>
        If you have any questions about bookings, memberships, tournaments, or club
        rules, feel free to reach out.
      </p>

      <p>
        <b>The Q Club</b><br />
        GTC, {data.club?.location || "Pasighat"}<br />
        Arunachal Pradesh, India
      </p>

      <h3>Phone / WhatsApp</h3>
      <p>
        {phone1}
        <br />
        {phone2}
      </p>

      <h3>Operating Hours</h3>
      <p>Open Daily: 11:00 AM – 10:00 PM (subject to holidays or tournament schedules)</p>

      <h3>Visit Us For</h3>
      <ul>
        <li>Snooker</li>
        <li>Pool</li>
        <li>Air Hockey</li>
        <li>Foosball</li>
        <li>Massage Chair</li>
        <li>Tea & Coffee</li>
        <li>Monthly Club Events</li>
      </ul>
    </>
  );
}

function TermsContent() {
  return (
    <>
      <p>
        By entering The Q Club or using our services, you agree to the following terms.
      </p>

      <h3>1. Club Rules</h3>
      <ul>
        <li>No smoking inside the main club area.</li>
        <li>No alcohol allowed inside the premises.</li>
        <li>Spitting is strictly prohibited.</li>
        <li>Misconduct or damage to property may result in immediate removal from the club.</li>
      </ul>

      <h3>2. Membership</h3>
      <ul>
        <li>Membership is monthly and non-transferable.</li>
        <li>Membership privileges reset daily at 00:00 hours.</li>
        <li>Member access to game tables is subject to availability.</li>
      </ul>

      <h3>3. Complimentary Session Guidelines</h3>
      <p>
        Complimentary play sessions, where applicable, may be offered at the discretion
        of the club and subject to availability.
      </p>
      <ul>
        <li>Pool: up to 15 minutes</li>
        <li>Mini Snooker: up to 20 minutes</li>
        <li>Snooker Table: up to 30 minutes</li>
      </ul>
      <p>Unless specified otherwise, such sessions are generally available from 11:00 AM to 5:00 PM.</p>

      <h3>4. Liability</h3>
      <p>The Q Club is not responsible for loss of personal belongings within the premises.</p>

      <h3>5. Management Rights</h3>
      <p>
        The management reserves the right to refuse entry, modify prices, update
        membership benefits, and change club rules without prior notice.
      </p>
    </>
  );
}

function RefundContent() {
  return (
    <>
      <p>
        At The Q Club, we strive to ensure a smooth and fair experience for all customers.
      </p>

      <h3>Membership</h3>
      <p>Membership fees are generally non-refundable once activated.</p>

      <h3>Table Bookings</h3>
      <p>
        If advance bookings are introduced in the future, cancellations made at least
        2 hours before booking time may be eligible for rescheduling. Missed bookings
        may not be refundable.
      </p>

      <h3>Technical Issues</h3>
      <p>
        If a game cannot be completed due to equipment malfunction, staff may offer
        replacement play time or a complimentary session at the discretion of management.
      </p>

      <h3>Refund Review</h3>
      <p>
        If a payment is made in error or a technical issue occurs during payment
        processing, customers may contact The Q Club for review. Refunds, if applicable,
        may be processed within 5–7 working days.
      </p>
    </>
  );
}

function PrivacyContent() {
  return (
    <>
      <p>The Q Club respects your privacy.</p>

      <h3>Information We Collect</h3>
      <p>
        We may collect basic information such as name, phone number, membership
        details, and tournament participation records.
      </p>

      <h3>How We Use This Information</h3>
      <p>
        Your information is used for membership verification, tournament records,
        leaderboard rankings, and communication about club events.
      </p>

      <h3>Data Protection</h3>
      <p>We do not sell or share your personal data with third parties.</p>

      <h3>Payment Information</h3>
      <p>
        Payment transactions are processed through authorized payment gateway providers.
        The Q Club does not store card or payment details on its servers.
      </p>

      <h3>Media Usage</h3>
      <p>
        Photos and videos taken inside the club may be used on social media,
        promotional materials, and website content. If you do not wish to appear
        in promotional content, please inform the staff.
      </p>
    </>
  );
}

function BottomPadding() {
  return <div style={{ height: 28 }} />;
}

function TopNav({ club, admin, onToggleAdmin, onChangePin, onReset }) {
  return (
    <div className="nav">
      <div className="nav-inner">
        <div className="brand">
          <div className="title">{club?.name || "The Q CLUB"}</div>
          <div className="sub">
            {club?.location || "Pasighat"} • {club?.tagline || "Play. Chill. Compete."}
          </div>
        </div>

        <div className="spacer" />

        <Link className="pill" to="/">Home</Link>
        <Link className="pill" to="/book">Book Table</Link>
        <Link className="pill" to="/membership">Membership</Link>
        <Link className="pill" to="/offer">What We Offer</Link>
        <Link className="pill" to="/photos">Photos</Link>
        <Link className="pill" to="/players">Players</Link>
        <Link className="pill" to="/tournaments">Tournaments</Link>
        <Link className="pill" to="/fixtures">Fixtures</Link>
        <Link className="pill" to="/leaderboard">Leaderboards</Link>
        <Link className="pill" to="/halloffame">Hall of Fame</Link>
        <Link className="pill" to="/tv">TV</Link>
        {admin ? <Link className="pill" to="/admin-panel">Admin Panel</Link> : null}

        <button className="btn primary" onClick={onToggleAdmin}>
          {admin ? "Admin: ON" : "Admin Login"}
        </button>

        {admin && (
          <>
            <button className="btn" onClick={onChangePin}>Change PIN</button>
            <button className="btn danger" onClick={onReset}>Reset</button>
          </>
        )}
      </div>
    </div>
  );
}

function PageShell({ title, subtitle, right }) {
  const navigate = useNavigate();

  return (
    <div className="container">
      <div className="pageHead">
        <div className="pageHeadLeft">
          <button className="iconBtn" onClick={() => navigate(-1)} aria-label="Back">←</button>
          <Link className="iconBtn" to="/" aria-label="Home">⌂</Link>
          <div>
            <div className="pageTitle">{title}</div>
            {subtitle ? <div className="muted">{subtitle}</div> : null}
          </div>
        </div>

        <div className="pageHeadRight">{right || null}</div>
      </div>
    </div>
  );
}
function playersForTournament(tournament, allPlayers = []) {
  if (!tournament) return [];
  const ids = tournament.participantIds || [];
  if (!ids.length) return getEligiblePlayersForTournament(allPlayers, tournament);
  return (allPlayers || []).filter((p) => ids.includes(p.id));
}

function Home({ data, admin, commit, activeTournament }) {
  const phone = [data.club?.contact?.phone1, data.club?.contact?.phone2]
    .filter(Boolean)
    .join(" / ");

  const galleryItems =
    (data.photos || []).slice(0, 3).map((p) => ({
      id: p.id,
      url: p.dataUrl || p.url,
      caption: p.caption || "The Q Club",
    })) ||
    [];

  const fallbackGallery = [
    {
      id: "fallback-1",
      url: "https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=1200&q=80",
      caption: "Premium Snooker",
    },
    {
      id: "fallback-2",
      url: "https://images.unsplash.com/photo-1511884642898-4c92249e20b6?auto=format&fit=crop&w=1200&q=80",
      caption: "Club Atmosphere",
    },
    {
      id: "fallback-3",
      url: "https://images.unsplash.com/photo-1543357480-c60d40007a3f?auto=format&fit=crop&w=1200&q=80",
      caption: "Game Night",
    },
  ];

  const photos = galleryItems.length ? galleryItems : fallbackGallery;

  const highlights = [
    {
      title: "Premium Tables",
      text: "Snooker, Mini Snooker and American Pool in a premium lounge setting.",
    },
    {
      title: "Club Events",
      text: "Friendly matches and monthly recreational tournaments.",
    },
    {
      title: "Relax & Refresh",
      text: "Massage chair, tea, coffee and club-style downtime.",
    },
    {
      title: "More Than Cue Sports",
      text: "Air Hockey and Foosball for quick fun between longer sessions.",
    },
  ];

  return (
    <div className="container premiumHome">
      <section className="homeHeroPanel">
        <div className="homeHeroOverlay">
          <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
            <span className="badge premiumBadgeLite">
              <span className={data.club?.isOpenNow ? "dot" : "dot red"} />
              {data.club?.isOpenNow ? "OPEN NOW" : "CLOSED NOW"}
            </span>

            <span className="badge premiumBadgeLite">
              Recreational Indoor Sports Lounge
            </span>
          </div>

          <div className="homeHeroCopy">
            <div className="heroEyebrowLite">Premium Gaming Lounge • Pasighat</div>
            <h1 className="heroMainTitle">{data.club?.name || "The Q CLUB"}</h1>
            <div className="heroMainSubtitle">
{data.club?.tagline2 || "Snooker • Pool • Air Hockey • Foosball • Massage Chair • Tea & Coffee"}
</div>

{admin && (
<button
className="btn"
onClick={()=>{
const v = prompt("Edit feature line", data.club?.tagline2 || "")
if(v){
commit({
...data,
club:{...data.club, tagline2:v}
})
}
}}
>
Edit
</button>
)}  

            <div className="heroButtonRow">
              <Link className="btn primary premiumCta" to="/book">
                Book Table
              </Link>
              <Link className="btn premiumGhost" to="/membership">
                Membership
              </Link>
            </div>
          </div>
        </div>
      </section>

      <section className="infoCardsGrid">
        <div className="premiumHeroCard">
          <div className="infoLabel">Location</div>
          <div className="infoValue">{data.club?.location || "Pasighat"}</div>
        </div>

        <div className="premiumHeroCard">
          <div className="infoLabel">Contact</div>
          <div className="infoValue">{phone || "—"}</div>
        </div>

        <div className="premiumHeroCard">
          <div className="infoLabel">Current Tournament</div>
          <div className="infoValue">{tournamentDisplay(activeTournament)}</div>
        </div>
      </section>

      <section className="quickLinksRow">
        
        <Link className="quickLinkTile" to="/leaderboard">
          <div className="quickLinkTitle">Leaderboards</div>
          <div className="muted">Snooker and Pool rankings at a glance</div>
        </Link>
      </section>

      <section className="sectionBlock tournamentSpotlight">
        <div className="sectionKicker">Current Highlight</div>
        <h2 className="sectionHeadline">
          {activeTournament ? activeTournament.name : "Club Events Coming Soon"}
        </h2>

        <div className="tournamentSpotlightGrid">
          <div>
            <div className="spotlightMeta muted">
              {activeTournament
                ? `${activeTournament.month || "This Month"} • ${
                    activeTournament.game || "Snooker"
                  }`
                : "Friendly matches and recreational tournaments organised by the club."}
            </div>

            <div className="row" style={{ marginTop: 16 }}>
              <Link className="btn primary premiumCta" to="/tournaments">
                View Tournaments
              </Link>
              <Link className="btn premiumGhost" to="/fixtures">
                Fixtures
              </Link>
            </div>
          </div>

          <div className="spotlightNoteBox">
            <div className="infoLabel">Club Note</div>
            <div className="spotlightNoteText">
              The Q Club is a recreational indoor sports lounge offering cue sports
              and leisure activities.
            </div>
          </div>
        </div>
      </section>

      <section className="sectionBlock">
        <div className="sectionKicker">Inside The Q Club</div>
        <h2 className="sectionHeadline">A more premium club experience</h2>
        <div className="muted">
          Use real club photos later for the best effect. These are placeholders for now.
        </div>

        <div className="galleryStrip">
          {photos.map((item) => (
            <div className="miniGalleryCard" key={item.id}>
              <img src={item.url} alt={item.caption} />
              <div className="miniGalleryCap">{item.caption}</div>
            </div>
          ))}
        </div>
      </section>

      <section className="sectionBlock">
        <div className="sectionKicker">Why Q Club</div>
        <h2 className="sectionHeadline">Built for players, friends and club nights</h2>

        <div className="whyGridCompact">
          {highlights.map((item) => (
            <div className="whyTile" key={item.title}>
              <div className="quickLinkTitle">{item.title}</div>
              <div className="muted">{item.text}</div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Offers({ data, admin, commit }) {
  function addOffer() {
    const title = prompt("Offer title:");
    if (!title) return;
    const price = prompt("Offer price / rate:", "");
    const details = prompt("Offer details:", "");

    commit({
      ...data,
      offers: [
        ...(data.offers || []),
        { id: uid(), title: title.trim(), price: (price || "").trim(), details: (details || "").trim() },
      ],
    });
  }

  function editOffer(id) {
    const current = (data.offers || []).find((x) => x.id === id);
    if (!current) return;

    const title = prompt("Edit title:", current.title);
    if (title === null) return;
    const price = prompt("Edit price / rate:", current.price || "");
    if (price === null) return;
    const details = prompt("Edit details:", current.details || "");
    if (details === null) return;

    commit({
      ...data,
      offers: (data.offers || []).map((x) =>
        x.id === id ? { ...x, title: title.trim(), price: price.trim(), details: details.trim() } : x
      ),
    });
  }

  function deleteOffer(id) {
    if (!confirm("Delete this item?")) return;
    commit({
      ...data,
      offers: (data.offers || []).filter((x) => x.id !== id),
    });
  }

  return (
    <>
      <PageShell
        title="What We Offer"
        subtitle="Games, refreshment and premium club experiences"
        right={admin ? <button className="btn primary" onClick={addOffer}>+ Add Item</button> : null}
      />

      <div className="container">
                  <div className="grid offerGrid">
          {(data.offers || []).map((item) => (
            <div className="card cols-4 offerCard" key={item.id}>
  <div className="offerCardTop">
    <div className="offerCardHead">
      <h2 className="offerCardTitle">{item.title}</h2>

      {!offerPriceLines(item.price).length ? (
        <div className="badge">
          <span className="dot" />
          Ask at counter
        </div>
      ) : null}
    </div>

    {admin ? (
      <div className="row offerAdminBtns">
        <button className="btn" onClick={() => editOffer(item.id)}>Edit</button>
        <button className="btn danger" onClick={() => deleteOffer(item.id)}>Delete</button>
      </div>
    ) : null}
  </div>

  {offerPriceLines(item.price).length > 0 ? (
    <div className="offerLineList">
      {offerPriceLines(item.price).map((line) => (
        <div key={line} className="offerLinePill">
          <span className="dot" />
          <span>{line}</span>
        </div>
      ))}
    </div>
  ) : null}

  <div className="offerDetailsText">
    {item.details || "Available at the club."}
  </div>
</div>
          ))}
        </div>
      </div>
    </>
  );
}
function BookTable({ data, admin, commit, startPayment }) {
  const [bookingType, setBookingType] = useState("nonmember");
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [memberId, setMemberId] = useState("");
  const [itemId, setItemId] = useState(data.booking?.tables?.[0]?.id || "");
  const [bookingDate, setBookingDate] = useState(todayIso());
  const [timeSlot, setTimeSlot] = useState("");
  const [note, setNote] = useState("");
  const [submittedId, setSubmittedId] = useState("");

  const tables = data.booking?.tables || [];
  const selectedTable = tables.find((t) => t.id === itemId) || tables[0] || null;
  const slots = bookingTimeSlots(bookingDate);
  const amount = bookingAmountFor(selectedTable, bookingType === "member" ? "member" : "nonmember");

  useEffect(() => {
    const firstAvailable = slots.find((s) => !s.disabled)?.value || "";
    if (!slots.some((s) => s.value === timeSlot && !s.disabled)) {
      setTimeSlot(firstAvailable);
    }
  }, [bookingDate]); // eslint-disable-line react-hooks/exhaustive-deps

  const upiId = normalizedClubUpiId(data.club?.upiId);
  const upiName = data.club?.upiName || data.club?.name || "The Q Club";
  const upiLink = upiDeepLink({
    pa: upiId,
    pn: upiName,
    am: amount,
    tn:
      bookingType === "member"
        ? `Q Club Booking - ${selectedTable?.label || "Table"} - Member`
        : `Q Club Booking - ${selectedTable?.label || "Table"}`,
  });

  const qr = qrUrl(upiLink, 280);

  function submitBooking() {
    if (!name.trim()) return alert("Please enter name");
    if (!mobile.trim()) return alert("Please enter mobile number");
    if (!selectedTable) return alert("Please select table");
    if (!bookingDate) return alert("Please select date");
    if (bookingDate < todayIso()) return alert("Past dates are not allowed");
    if (!timeSlot) return alert("Please select a time slot");

    const req = {
      id: uid(),
      name: name.trim(),
      mobile: mobile.trim(),
      memberId: bookingType === "member" ? memberId.trim() : "",
      bookingType: bookingType === "member" ? "member" : "nonmember",
      itemId: selectedTable.id,
      itemLabel: selectedTable.label,
      bookingDate,
      timeSlot,
      note: note.trim(),
      amount,
      status: bookingType === "member" ? "pending_member_verification" : "pending",
      createdAt: Date.now(),
    };

    if (hasBookingConflict(data.booking?.requests || [], req)) {
      return alert("This slot is already booked / pending for this table.");
    }

    commit({
      ...data,
      booking: {
        ...(data.booking || {}),
        tables: tables,
        requests: [req, ...(data.booking?.requests || [])],
      },
    });

    setSubmittedId(req.id);
    setName("");
    setMobile("");
    setMemberId("");
    setNote("");
    alert("Booking request submitted. Please complete payment / verification.");
  }

  function approveRequest(id) {
    if (!admin) return alert("Admin only");

    commit({
      ...data,
      booking: {
        ...(data.booking || {}),
        requests: (data.booking?.requests || []).map((r) =>
          r.id === id
            ? {
                ...r,
                status:
                  r.bookingType === "member" ? "member_verified" : "verified",
              }
            : r
        ),
      },
    });
  }

  function rejectRequest(id) {
    if (!admin) return alert("Admin only");

    const req = (data.booking?.requests || []).find((r) => r.id === id);
    if (!req) return;

    const nextStatus =
      req.bookingType === "member" ? "member_rejected" : "rejected";

    commit({
      ...data,
      booking: {
        ...(data.booking || {}),
        requests: (data.booking?.requests || []).map((r) =>
          r.id === id ? { ...r, status: nextStatus } : r
        ),
      },
    });
  }

  function deleteRequest(id) {
    if (!admin) return alert("Admin only");
    if (!confirm("Delete this booking request?")) return;

    commit({
      ...data,
      booking: {
        ...(data.booking || {}),
        requests: (data.booking?.requests || []).filter((r) => r.id !== id),
      },
    });
  }

  const requests = data.booking?.requests || [];

  return (
    <>
      <PageShell
        title="Book Table"
        subtitle="Quick Booking + Secure Online Payment"
        right={
          admin ? (
            <Link className="btn" to="/admin-panel">
              Open Admin Panel
            </Link>
          ) : null
        }
      />

      <div className="container">
        <div className="grid">
          <div className="card cols-7">
            <h2>Booking Form</h2>

            <div className="row" style={{ marginBottom: 12 }}>
              <button
                className={`btn ${bookingType === "nonmember" ? "primary" : ""}`}
                onClick={() => setBookingType("nonmember")}
                type="button"
              >
                Non-member
              </button>

              <button
                className={`btn ${bookingType === "member" ? "primary" : ""}`}
                onClick={() => setBookingType("member")}
                type="button"
              >
                Member
              </button>
            </div>

            <div className="grid">
              <div className="cols-6">
                <label className="lbl">Name</label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Enter name"
                />
              </div>

              <div className="cols-6">
                <label className="lbl">Mobile Number</label>
                <input
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  placeholder="Enter mobile"
                />
              </div>

              {bookingType === "member" ? (
                <div className="cols-6">
                  <label className="lbl">Membership ID / Reference</label>
                  <input
                    value={memberId}
                    onChange={(e) => setMemberId(e.target.value)}
                    placeholder="Enter member ID"
                  />
                </div>
              ) : null}

              <div className="cols-6">
                <label className="lbl">Table / Game</label>
                <select
                  value={itemId}
                  onChange={(e) => setItemId(e.target.value)}
                >
                  {tables.map((t) => (
                    <option value={t.id} key={t.id}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="cols-6">
                <label className="lbl">Booking Date</label>
                <input
  type="date"
  value={bookingDate}
  min={todayIso()}
  onChange={(e) => {
    setBookingDate(e.target.value);
  }}

/>
              </div>

              <div className="cols-6">
                <label className="lbl">Time Slot</label>
                <select
                  value={timeSlot}
                  onChange={(e) => setTimeSlot(e.target.value)}
                >
                  {slots.map((s) => (
                    <option key={s.value} value={s.value} disabled={s.disabled}>
                      {s.label}
                      {s.disabled ? " (Unavailable)" : ""}
                    </option>
                  ))}
                </select>
              </div>

              <div className="cols-12">
                <label className="lbl">Note (optional)</label>
                <textarea
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Special note"
                />
              </div>
            </div>

            <div className="hr" />

            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <div className="muted">Payable Amount</div>
                <div style={{ fontSize: 28, fontWeight: 900 }}>₹{amount}</div>
              </div>

              <button
  className="btn primary"
  onClick={() => {
  if (!name || name.trim() === "") {
    alert("Please enter your name");
    return;
  }

  if (!mobile || mobile.trim().length < 10) {
    alert("Please enter a valid mobile number");
    return;
  }

  submitBooking();
  startPayment(amount, mobile.trim());
}}
  type="button"
>
  Submit Booking
</button>
            </div>

            {submittedId ? (
              <div style={{ marginTop: 14 }}>
                <span className="badge">
                  <span className="dot warn" />
                  Request submitted. Reference: {submittedId}
                </span>
              </div>
            ) : null}
          </div>

          
          {admin ? (
  <div className="card cols-12">
    <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
      <h2 style={{ margin: 0 }}>Booking Requests</h2>
      <div className="muted">Admin can approve / reject / delete.</div>
    </div>

    {requests.length === 0 ? (
      <div className="muted" style={{ marginTop: 12 }}>No booking requests yet.</div>
    ) : (
      <div style={{ marginTop: 12 }}>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Table</th>
              <th>Date</th>
              <th>Slot</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => (
              <tr key={r.id}>
                <td>
                  <b>{r.name}</b>
                  <div className="muted">{r.mobile}</div>
                </td>
                <td>{r.bookingType === "member" ? "Member" : "Non-member"}</td>
                <td>{r.itemLabel}</td>
                <td>{r.bookingDate || "—"}</td>
                <td>{r.timeSlot || "—"}</td>
                <td>₹{r.amount}</td>
                <td>
                  <span className="badge">
                    <span
                      className={
                        r.status === "verified" || r.status === "member_verified"
                          ? "dot"
                          : r.status === "rejected" || r.status === "member_rejected"
                          ? "dot red"
                          : "dot warn"
                      }
                    />
                    {bookingStatusLabel(r.status)}
                  </span>
                </td>
                <td>
                  <div className="row">
                    <button className="btn primary" onClick={() => approveRequest(r.id)}>
                      Approve
                    </button>
                    <button className="btn warn" onClick={() => rejectRequest(r.id)}>
                      Reject
                    </button>
                    <button className="btn danger" onClick={() => deleteRequest(r.id)}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </div>
) : null}
        </div>
      </div>
    </>
  );
}
function Membership({ data, admin, commit, startPayment }) {
  const [selectedTierId, setSelectedTierId] = useState("");
  const [applicantName, setApplicantName] = useState("");
  const [mobile, setMobile] = useState("");
  const [memberRef, setMemberRef] = useState("");
  const [submittedId, setSubmittedId] = useState("");
  const [showMembershipPopup, setShowMembershipPopup] = useState(false);
  const [membershipError, setMembershipError] = useState("");

  const tiers = data.memberships || [];
  const selectedTier =
    tiers.find((t) => t.id === selectedTierId) || tiers[0] || null;

    const membershipNote =
    data.club?.membershipNote ||
    "PLEASE NOTE : Membership at The Q Club provides access to club facilities and member privileges during the validity period. Membership is personal and non-transferable. Member privileges reset daily at 00:00 hours. Access to game tables is subject to availability. Complimentary play sessions may be offered to members at the discretion of the club. Pool table: up to 15 minutes. Mini Snooker: up to 20 minutes. Snooker table: up to 30 minutes. Complimentary sessions are generally available during 11:00 AM – 5:00 PM depending on table availability. The Q Club reserves the right to modify membership privileges, availability, or timings.";

  function editMembershipNote() {
    if (!admin) return alert("Admin only");
    const next = prompt("Edit membership note / terms:", membershipNote);
    if (next === null) return;

    commit({
      ...data,
      club: {
        ...(data.club || {}),
        membershipNote: next.trim(),
      },
    });
  }

  function addTier() {
    if (!admin) return alert("Admin only");

    const tier = prompt("Tier name:", "Bronze");
    if (!tier) return;

    const price = prompt("Price:", "499");
    if (price === null) return;

    const perksRaw = prompt(
      "Perks (separate with | )",
      "Entry access during open hours | Member pricing on games"
    );
    if (perksRaw === null) return;

    commit({
      ...data,
      memberships: [
        ...(data.memberships || []),
        {
          id: uid(),
          tier: tier.trim(),
          price: safeNum(price, 0),
          perks: String(perksRaw)
            .split("|")
            .map((x) => x.trim())
            .filter(Boolean),
          note: "Non-transferable",
        },
      ],
    });
  }

  function editTier(id) {
    if (!admin) return alert("Admin only");

    const current = (data.memberships || []).find((x) => x.id === id);
    if (!current) return;

    const tier = prompt("Edit tier name:", current.tier || "");
    if (tier === null) return;

    const price = prompt("Edit price:", String(current.price ?? ""));
    if (price === null) return;

    const perks = prompt(
      "Edit perks (separate with | )",
      (current.perks || []).join(" | ")
    );
    if (perks === null) return;

    commit({
      ...data,
      memberships: (data.memberships || []).map((x) =>
        x.id === id
          ? {
              ...x,
              tier: tier.trim(),
              price: safeNum(price, 0),
              perks: String(perks)
                .split("|")
                .map((p) => p.trim())
                .filter(Boolean),
            }
          : x
      ),
    });
  }

  function deleteTier(id) {
    if (!admin) return alert("Admin only");
    if (!confirm("Delete this membership tier?")) return;

    commit({
      ...data,
      memberships: (data.memberships || []).filter((x) => x.id !== id),
    });

    if (selectedTierId === id) {
      const remaining = (data.memberships || []).filter((x) => x.id !== id);
      setSelectedTierId(remaining[0]?.id || "");
    }
  }

  function submitMembershipApplication() {
    if (!selectedTier) return alert("Please select a membership tier");
    if (!applicantName.trim()) return alert("Please enter name");
    if (!mobile.trim()) return alert("Please enter mobile number");

    const req = {
      id: uid(),
      name: applicantName.trim(),
      mobile: mobile.trim(),
      memberId: memberRef.trim(),
      bookingType: "member",
      itemId: `membership-${selectedTier.id}`,
      itemLabel: `${selectedTier.tier} Membership`,
      bookingDate: todayIso(),
      timeSlot: "membership",
      note: `Membership Application • ${selectedTier.tier}`,
      amount: safeNum(selectedTier.price, 0),
      status: "pending_member_verification",
      createdAt: Date.now(),
    };

    commit({
      ...data,
      booking: {
        ...(data.booking || {}),
        requests: [req, ...(data.booking?.requests || [])],
      },
    });

    setSubmittedId(req.id);
    setApplicantName("");
    setMobile("");
    setMemberRef("");
    
  }

  const upiId = normalizedClubUpiId(data.club?.upiId);
  const upiName = data.club?.upiName || data.club?.name || "The Q Club";
  const upiLink = upiDeepLink({
    pa: upiId,
    pn: upiName,
    am: selectedTier ? safeNum(selectedTier.price, 0) : 0,
    tn: selectedTier
      ? `Q Club Membership - ${selectedTier.tier}`
      : "Q Club Membership",
  });
  const qr = qrUrl(upiLink, 280);

  return (
    <>
      <PageShell
        title="Membership"
        subtitle="Apply for Membership with Secure Online Payment"
        right={
          admin ? (
            <div className="row">
              <button className="btn" onClick={editMembershipNote}>
                Edit Note
              </button>
              <button className="btn primary" onClick={addTier}>
                + Add Tier
              </button>
            </div>
          ) : null
        }
      />

      <div className="container">
        <div className="membershipNoteBar">
          <div className="row" style={{ justifyContent: "space-between", gap: 10, alignItems: "flex-start" }}>
            <div>
              <div className="membershipNoteLabel">Please Note</div>
              <div className="membershipNoteText">{membershipNote}</div>
            </div>

            {admin ? (
              <button className="btn" onClick={editMembershipNote}>
                Edit
              </button>
            ) : null}
          </div>
        </div>

        <div className="grid" style={{ marginTop: 14 }}>
          {(tiers || []).map((tier) => (
            <div className="card cols-6 membershipTierCard" key={tier.id}>
              <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <h2 style={{ marginBottom: 8 }}>{tier.tier}</h2>
                  <div className="badge">
                    <span className="dot" /> ₹{safeNum(tier.price, 0)} (fixed)
                  </div>
                </div>

                <div className="row">
                  <button
  className="btn"
  onClick={() => {
    setSelectedTierId(tier.id);
    setShowMembershipPopup(true);
  }}
>
  Apply Now
</button>

                  {admin ? (
                    <>
                      <button className="btn" onClick={() => editTier(tier.id)}>
                        Edit
                      </button>
                      <button className="btn danger" onClick={() => deleteTier(tier.id)}>
                        Delete
                      </button>
                    </>
                  ) : null}
                </div>
              </div>

              <ul style={{ marginTop: 14 }}>
                {(tier.perks || []).map((perk) => (
                  <li key={perk}>{perk}</li>
                ))}
              </ul>
            </div>
          ))}

          {showMembershipPopup ? (
  <div className="modalBackdrop" onClick={() => setShowMembershipPopup(false)}>
    <div className="modalCard playerModal" onClick={(e) => e.stopPropagation()}>
      <div className="card" style={{ margin: 0 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={{ margin: 0 }}>Apply for Membership</h2>
          <button className="btn" onClick={() => setShowMembershipPopup(false)}>
            Close
          </button>
        </div>

        <div className="grid" style={{ marginTop: 14 }}>
          <div className="cols-6">
            <label className="lbl">Selected Tier</label>
            <select
              value={selectedTierId}
              onChange={(e) => setSelectedTierId(e.target.value)}
            >
              {(tiers || []).map((tier) => (
                <option value={tier.id} key={tier.id}>
                  {tier.tier} — ₹{safeNum(tier.price, 0)}
                </option>
              ))}
            </select>
          </div>

          <div className="cols-6">
            <label className="lbl">Applicant Name</label>
            <input
              value={applicantName}
              onChange={(e) => setApplicantName(e.target.value)}
              placeholder="Enter full name"
            />
          </div>

          <div className="cols-6">
            <label className="lbl">Mobile Number</label>
            <input
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              placeholder="Enter mobile number"
            />
          </div>

          <div className="cols-6">
            <label className="lbl">Reference / ID (optional)</label>
            <input
              value={memberRef}
              onChange={(e) => setMemberRef(e.target.value)}
              placeholder="Enter reference"
            />
          </div>
        </div>

        <div className="hr" />

        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div className="muted">Membership Fee</div>
            <div style={{ fontSize: 28, fontWeight: 900 }}>
              ₹{selectedTier ? safeNum(selectedTier.price, 0) : 0}
            </div>
          </div>

          <button
  className="btn primary"
  onClick={async () => {

  if (!applicantName || applicantName.trim() === "") {
    alert("Please enter your name");
    return;
  }

  if (!mobile || mobile.trim().length < 10) {
    alert("Please enter a valid mobile number");
    return;
  }

  setMembershipError("");
  setShowMembershipPopup(false);

  try {
    submitMembershipApplication();

    await startPayment(
      selectedTier ? safeNum(selectedTier.price, 0) : 0,
      mobile.trim()
    );
    } catch (err) {
      setShowMembershipPopup(true);
      setMembershipError("Unable to start payment. Please try again.");
    }
  }}
>
  Proceed to Payment
</button>
        </div>{membershipError ? (
  <div style={{ marginTop: 14, color: "#ffb4b4", fontWeight: 600 }}>
    {membershipError}
  </div>
) : null}

        {submittedId ? (
          <div style={{ marginTop: 14 }}>
            <span className="badge">
              <span className="dot warn" />
              Application submitted. Reference: {submittedId}
            </span>
          </div>
        ) : null}
      </div>
    </div>
  </div>
) : null}

          
        </div>
      </div>
    </>
  );
}
function Photos({ data, admin, commit }) {
    const [activePhoto, setActivePhoto] = useState(""); 
  async function addPhoto(e) {
    if (!admin) return alert("Admin only");

    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const dataUrl = await readFileAsDataURL(file);
      const caption = prompt("Caption (optional):", "") || "";

      commit({
        ...data,
        photos: [
          {
            id: uid(),
            dataUrl,
            caption: caption.trim(),
            createdAt: Date.now(),
          },
          ...(data.photos || []),
        ],
      });

      e.target.value = "";
    } catch {
      alert("Failed to read image file.");
    }
  }

  function editCaption(id) {
    if (!admin) return alert("Admin only");
    const current = (data.photos || []).find((p) => p.id === id);
    if (!current) return;

    const next = prompt("Edit caption:", current.caption || "");
    if (next === null) return;

    commit({
      ...data,
      photos: (data.photos || []).map((p) =>
        p.id === id ? { ...p, caption: next.trim() } : p
      ),
    });
  }

  function deletePhoto(id) {
    if (!admin) return alert("Admin only");
    if (!confirm("Delete this photo?")) return;

    commit({
      ...data,
      photos: (data.photos || []).filter((p) => p.id !== id),
    });
  }

  return (
    <>
      <PageShell
        title="Photos"
        subtitle="Club gallery"
        right={
          admin ? (
            <label className="btn primary">
              + Upload
              <input
                type="file"
                accept="image/*"
                onChange={addPhoto}
                style={{ display: "none" }}
              />
            </label>
          ) : null
        }
      />

      <div className="container">
        {(data.photos || []).length === 0 ? (
          <div className="card">
            <div className="muted">No photos uploaded yet.</div>
          </div>
        ) : (
          <div className="photoGrid">
            {(data.photos || []).map((p) => (
              <div className="photoCard" key={p.id}>
                <img
  src={p.dataUrl || p.url}
  alt={p.caption || "The Q Club"}
  style={{ cursor: "pointer", maxHeight: 180, objectFit: "cover", width: "100%" }}
  onClick={() => setActivePhoto(p.dataUrl || p.url)}
/>
                <div className="photoCardFooter">
                  <div>
                    <div className="photoCaption">{p.caption || "The Q Club"}</div>
                    <div className="muted" style={{ fontSize: 12 }}>
                      {p.createdAt ? new Date(p.createdAt).toLocaleString() : ""}
                    </div>
                  </div>

                  {admin ? (
                    <div className="row">
                      <button className="btn" onClick={() => editCaption(p.id)}>
                        Edit
                      </button>
                      <button className="btn danger" onClick={() => deletePhoto(p.id)}>
                        Delete
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
            {activePhoto ? (
        <div className="modalBackdrop" onClick={() => setActivePhoto("")}>
          <div className="modalCard playerModal" onClick={(e) => e.stopPropagation()}>
            <img
              src={activePhoto}
              alt="Expanded"
              style={{
                width: "100%",
                maxHeight: "80vh",
                objectFit: "contain",
                borderRadius: 12
              }}
            />
            <div style={{ marginTop: 12 }}>
              <button className="btn" onClick={() => setActivePhoto("")}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null} 
    </>
  );
}

function Players({ data, admin, commit, activeTournament }) {
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [viewGame, setViewGame] = useState("snooker");

  const players = data.players || [];

  const snookerBoard = useMemo(
    () => calcAutoRankingBoard(players, data.tournaments || [], "snooker"),
    [players, data.tournaments]
  );

  const poolBoard = useMemo(
    () => calcAutoRankingBoard(players, data.tournaments || [], "pool"),
    [players, data.tournaments]
  );

  const visiblePlayers = players.filter((p) =>
    normalizePlayerGames(p.games).includes(viewGame)
  );

  const activeBoard = viewGame === "pool" ? poolBoard : snookerBoard;

  const selectedPlayer =
    players.find((p) => p.id === selectedPlayerId) || null;

  function addPlayer() {
    if (!admin) return alert("Admin only");

    const name = prompt("Player name:");
    if (!name) return;

    const city = prompt("City:", "Pasighat");
    if (city === null) return;

    const gamesRaw = prompt("Games (snooker,pool)", "snooker");
    if (gamesRaw === null) return;

    commit({
      ...data,
      players: [
        ...(data.players || []),
        {
          id: uid(),
          name: name.trim(),
          city: city.trim(),
          photo: "",
          bio: "",
          games: normalizePlayerGames(gamesRaw),
        },
      ],
    });
  }

  async function uploadPlayerPhoto(id, file) {
    if (!admin) return alert("Admin only");
    if (!file) return;

    try {
      const dataUrl = await readFileAsDataURL(file);

      commit({
        ...data,
        players: (data.players || []).map((p) =>
          p.id === id ? { ...p, photo: dataUrl } : p
        ),
      });
    } catch {
      alert("Failed to upload photo.");
    }
  }

  function editPlayer(id) {
    if (!admin) return alert("Admin only");

    const current = (data.players || []).find((p) => p.id === id);
    if (!current) return;

    const name = prompt("Edit name:", current.name || "");
    if (name === null) return;

    const city = prompt("Edit city:", current.city || "");
    if (city === null) return;

    const bio = prompt("Edit bio:", current.bio || "");
    if (bio === null) return;

    const gamesRaw = prompt(
      "Edit games (snooker,pool)",
      normalizePlayerGames(current.games).join(",")
    );
    if (gamesRaw === null) return;

    commit({
      ...data,
      players: (data.players || []).map((p) =>
        p.id === id
          ? {
              ...p,
              name: name.trim(),
              city: city.trim(),
              bio: bio.trim(),
              games: normalizePlayerGames(gamesRaw),
            }
          : p
      ),
    });
  }

  function deletePlayer(id) {
    if (!admin) return alert("Admin only");
    if (!confirm("Delete this player?")) return;

    commit({
      ...data,
      players: (data.players || []).filter((p) => p.id !== id),
      tournaments: (data.tournaments || []).map((t) => ({
        ...t,
        participantIds: (t.participantIds || []).filter((pid) => pid !== id),
        matches: (t.matches || []).filter((m) => m.p1 !== id && m.p2 !== id),
      })),
    });

    if (selectedPlayerId === id) setSelectedPlayerId("");
  }

  function getRank(playerId) {
    const idx = activeBoard.findIndex((r) => r.id === playerId);
    return idx >= 0 ? `#${idx + 1}` : "—";
  }

  return (
    <>
      <PageShell
        title="Players"
        subtitle={
          activeTournament
            ? `Tap a player to view profile (Rank from ${tournamentDisplay(activeTournament)})`
            : "Tap a player to view profile"
        }
        right={
          admin ? (
            <button className="btn primary" onClick={addPlayer}>
              + Add Player
            </button>
          ) : null
        }
      />

      <div className="container">
        <div className="row" style={{ marginBottom: 14 }}>
          <button
            className={`btn ${viewGame === "snooker" ? "primary" : ""}`}
            onClick={() => setViewGame("snooker")}
          >
            Snooker Players
          </button>

          <button
            className={`btn ${viewGame === "pool" ? "primary" : ""}`}
            onClick={() => setViewGame("pool")}
          >
            Pool Players
          </button>

          <span className="badge">
            <span className="dot" />
            Auto ranking: {viewGame === "pool" ? "Pool" : "Snooker"}
          </span>
        </div>

        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Player</th>
                <th>City</th>
                <th>Games</th>
                <th>Rank</th>
                {admin ? <th>Admin</th> : null}
              </tr>
            </thead>
            <tbody>
              {visiblePlayers.map((player) => (
                <tr key={player.id}>
                  <td>
                    <button
                      type="button"
                      onClick={() => setSelectedPlayerId(player.id)}
                      style={{
                        background: "none",
                        border: "none",
                        padding: 0,
                        color: "inherit",
                        textDecoration: "underline",
                        cursor: "pointer",
                        fontWeight: 700,
                      }}
                    >
                      {player.name}
                    </button>
                  </td>
                  <td>{player.city || "—"}</td>
                  <td>{playerGamesLabel(player)}</td>
                  <td>{getRank(player.id)}</td>
                  {admin ? (
                    <td>
                      <div className="row">
                        <button className="btn" onClick={() => editPlayer(player.id)}>
                          Edit
                        </button>

                        <label className="btn">
                          Photo
                          <input
                            type="file"
                            accept="image/*"
                            style={{ display: "none" }}
                            onChange={(e) =>
                              uploadPlayerPhoto(player.id, e.target.files?.[0])
                            }
                          />
                        </label>

                        <button className="btn danger" onClick={() => deletePlayer(player.id)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selectedPlayer ? (
  <div
    onClick={() => setSelectedPlayerId("")}
    style={{
      position: "fixed",
      inset: 0,
      background: "rgba(3, 8, 18, 0.72)",
      backdropFilter: "blur(8px)",
      WebkitBackdropFilter: "blur(8px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 20,
      zIndex: 9999,
    }}
  >
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        width: "min(760px, 96vw)",
        maxHeight: "88vh",
        overflowY: "auto",
        borderRadius: 24,
        border: "1px solid rgba(255,255,255,.12)",
        background:
          "linear-gradient(180deg, rgba(24,32,54,.96), rgba(10,16,30,.96))",
        boxShadow: "0 24px 80px rgba(0,0,0,.45)",
        padding: 20,
      }}
    >
      <div
        className="row"
        style={{
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 16,
        }}
      >
        <div
          className="row"
          style={{ alignItems: "center", gap: 16, flexWrap: "nowrap" }}
        >
          {selectedPlayer.photo ? (
            <img
  src={selectedPlayer.photo}
  alt={selectedPlayer.name}
  style={{
    width: "100%",
    height: 420,
    objectFit: "cover",
    borderRadius: 18
  }}
/>
          ) : (
            <div
              style={{
                width: 120,
                height: 120,
                borderRadius: 18,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 42,
                fontWeight: 900,
                background: "rgba(255,255,255,.08)",
                border: "1px solid rgba(255,255,255,.12)",
                flexShrink: 0,
              }}
            >
              {String(selectedPlayer.name || "?").slice(0, 1).toUpperCase()}
            </div>
          )}

          <div>
            <h2 style={{ margin: 0 }}>{selectedPlayer.name}</h2>
            <div className="muted" style={{ marginTop: 6 }}>
              {selectedPlayer.city || "—"}
            </div>
            <div className="badge" style={{ marginTop: 10 }}>
              <span className="dot" />
              {playerGamesLabel(selectedPlayer)}
            </div>
          </div>
        </div>

        <button className="iconBtn" onClick={() => setSelectedPlayerId("")}>
          ✕
        </button>
      </div>

      <div className="hr" />

      <div>
        <div className="infoLabel">Bio</div>
        <div className="muted" style={{ marginTop: 6 }}>
          {selectedPlayer.bio || "No bio added yet."}
        </div>
      </div>

      <div className="grid" style={{ marginTop: 16 }}>
        <div className="card cols-6">
          <div className="infoLabel">Snooker Rank</div>
          <div className="infoValue">
            {(() => {
              const idx = snookerBoard.findIndex((r) => r.id === selectedPlayer.id);
              return idx >= 0 ? `#${idx + 1}` : "—";
            })()}
          </div>
        </div>

        <div className="card cols-6">
          <div className="infoLabel">Pool Rank</div>
          <div className="infoValue">
            {(() => {
              const idx = poolBoard.findIndex((r) => r.id === selectedPlayer.id);
              return idx >= 0 ? `#${idx + 1}` : "—";
            })()}
          </div>
        </div>

        <div className="card cols-4">
          <div className="infoLabel">Snooker Wins</div>
          <div className="infoValue">
            {(() => {
              const row = snookerBoard.find((r) => r.id === selectedPlayer.id);
              return row ? row.wins : 0;
            })()}
          </div>
        </div>

        <div className="card cols-4">
          <div className="infoLabel">Snooker Losses</div>
          <div className="infoValue">
            {(() => {
              const row = snookerBoard.find((r) => r.id === selectedPlayer.id);
              return row ? row.losses : 0;
            })()}
          </div>
        </div>

        <div className="card cols-4">
          <div className="infoLabel">Best Break</div>
          <div className="infoValue">
            {selectedPlayer.bestBreak || 0}
          </div>
        </div>

        <div className="card cols-6">
          <div className="infoLabel">Pool Wins</div>
          <div className="infoValue">
            {(() => {
              const row = poolBoard.find((r) => r.id === selectedPlayer.id);
              return row ? row.wins : 0;
            })()}
          </div>
        </div>

        <div className="card cols-6">
          <div className="infoLabel">Pool Losses</div>
          <div className="infoValue">
            {(() => {
              const row = poolBoard.find((r) => r.id === selectedPlayer.id);
              return row ? row.losses : 0;
            })()}
          </div>
        </div>
      </div>
    </div>
  </div>
) : null}
    </>
  );
}

function Tournaments({ data, admin, commit }) {

  const tournaments = data.tournaments || [];

  function addTournament() {
    if (!admin) return alert("Admin only");

    const name = prompt("Tournament name:", "9 Ball Battle");
    if (!name) return;

    const month = prompt("Month:", monthKey());
    if (!month) return;

    const game = prompt("Game type (snooker/pool):", "Pool");
    if (!game) return;

    commit({
      ...data,
      tournaments: [
        ...tournaments,
        {
          id: uid(),
          name: name.trim(),
          month: month.trim(),
          game: tournamentGameKey(game),
          participantIds: [],
          matches: [],
        },
      ],
    });
  }

  function deleteTournament(id) {
    if (!admin) return alert("Admin only");
    if (!confirm("Delete this tournament?")) return;

    commit({
      ...data,
      tournaments: tournaments.filter((t) => t.id !== id),
    });
  }

  function editTournament(id) {
    if (!admin) return alert("Admin only");

    const t = tournaments.find((x) => x.id === id);
    if (!t) return;

    const name = prompt("Edit name:", t.name || "");
    if (name === null) return;

    const month = prompt("Edit month:", t.month || "");
    if (month === null) return;

    commit({
      ...data,
      tournaments: tournaments.map((x) =>
        x.id === id
          ? { ...x, name: name.trim(), month: month.trim() }
          : x
      ),
    });
  }

  return (
    <>
      <PageShell
        title="Tournaments"
        subtitle="Club tournaments and events"
        right={
          admin ? (
            <button className="btn primary" onClick={addTournament}>
              + Add Tournament
            </button>
          ) : null
        }
      />

      <div className="container">

        {tournaments.length === 0 ? (
          <div className="card">
            <div className="muted">No tournaments created yet.</div>
          </div>
        ) : null}

        <div className="grid">

          {tournaments.map((t) => (

            <div className="card cols-6" key={t.id}>

              <div className="row" style={{justifyContent:"space-between"}}>

                <div>
                  <h2 style={{marginBottom:6}}>{t.name}</h2>
                  <div className="badge">
                    <span className="dot" />
                    {t.month}
                  </div>
                </div>

                {admin ? (
                  <div className="row">
                    <button className="btn" onClick={()=>editTournament(t.id)}>
                      Edit
                    </button>

                    <button className="btn danger" onClick={()=>deleteTournament(t.id)}>
                      Delete
                    </button>
                  </div>
                ) : null}

              </div>

              <div className="muted" style={{marginTop:10}}>
                Game: {tournamentGameKey(t.game) === "pool" ? "Pool" : "Snooker"}
              </div>

              {admin ? (
  <div style={{ marginTop: 12 }}>
    <Link className="btn primary" to="/fixtures">
      Manage Fixtures
    </Link>
  </div>
) : null}

            </div>

          ))}

        </div>

      </div>
    </>
  );
}
function Fixtures({ data, admin, commit }) {
  const tournaments = data.tournaments || [];
  const players = data.players || [];
  const [selectedTournamentId, setSelectedTournamentId] = useState(
    tournaments[0]?.id || ""
  );

  useEffect(() => {
    if (!selectedTournamentId && tournaments[0]?.id) {
      setSelectedTournamentId(tournaments[0].id);
    }
  }, [selectedTournamentId, tournaments]);

  const selectedTournament =
    tournaments.find((t) => t.id === selectedTournamentId) || null;

  const eligiblePlayers = selectedTournament
    ? getEligiblePlayersForTournament(players, selectedTournament)
    : [];

  function toggleParticipant(playerId) {
    if (!admin || !selectedTournament) return;

    const currentIds = selectedTournament.participantIds || [];
    const nextIds = currentIds.includes(playerId)
      ? currentIds.filter((id) => id !== playerId)
      : [...currentIds, playerId];

    commit({
      ...data,
      tournaments: tournaments.map((t) =>
        t.id === selectedTournament.id
          ? { ...t, participantIds: nextIds }
          : t
      ),
    });
  }

  function generateFixtures() {
    if (!admin) return alert("Admin only");
    if (!selectedTournament) return alert("Select a tournament first");

    const pool =
      (selectedTournament.participantIds || []).length > 0
        ? players.filter((p) =>
            (selectedTournament.participantIds || []).includes(p.id)
          )
        : eligiblePlayers;

    if (pool.length < 2) {
      return alert("Need at least 2 players to generate fixtures.");
    }

    if (!confirm("Generate / regenerate fixtures for this tournament?")) return;

    const matches = generateRoundRobin(pool.map((p) => p.id));

    commit({
      ...data,
      tournaments: tournaments.map((t) =>
        t.id === selectedTournament.id
          ? { ...t, matches }
          : t
      ),
    });
  }

  function updateMatchField(matchId, field, value) {
    if (!admin || !selectedTournament) return;

    commit({
      ...data,
      tournaments: tournaments.map((t) =>
        t.id !== selectedTournament.id
          ? t
          : {
              ...t,
              matches: (t.matches || []).map((m) =>
                m.id === matchId ? { ...m, [field]: value } : m
              ),
            }
      ),
    });
  }

  function markMatchDone(matchId) {
    if (!admin || !selectedTournament) return;

    const match = (selectedTournament.matches || []).find((m) => m.id === matchId);
    if (!match) return;

    const s1 = Number(match.score1);
    const s2 = Number(match.score2);

    if (!Number.isFinite(s1) || !Number.isFinite(s2)) {
      return alert("Enter valid numeric scores first.");
    }

    commit({
      ...data,
      tournaments: tournaments.map((t) =>
        t.id !== selectedTournament.id
          ? t
          : {
              ...t,
              matches: (t.matches || []).map((m) =>
                m.id === matchId
                  ? { ...m, status: "done", updatedAt: Date.now() }
                  : m
              ),
            }
      ),
    });
  }

  function reopenMatch(matchId) {
    if (!admin || !selectedTournament) return;

    commit({
      ...data,
      tournaments: tournaments.map((t) =>
        t.id !== selectedTournament.id
          ? t
          : {
              ...t,
              matches: (t.matches || []).map((m) =>
                m.id === matchId
                  ? { ...m, status: "scheduled", updatedAt: Date.now() }
                  : m
              ),
            }
      ),
    });
  }

  function playerName(id) {
    return players.find((p) => p.id === id)?.name || "Unknown Player";
  }

  const standings = selectedTournament
    ? calcLeaderboard(playersForTournament(selectedTournament, players), selectedTournament)
    : [];

  return (
    <>
      <PageShell
        title="Fixtures"
        subtitle="Generate matches and enter scores"
        right={
          <div className="row">
            <select
              value={selectedTournamentId}
              onChange={(e) => setSelectedTournamentId(e.target.value)}
            >
              {(tournaments || []).map((t) => (
                <option key={t.id} value={t.id}>
                  {tournamentDisplay(t)}
                </option>
              ))}
            </select>

            {admin ? (
              <button className="btn primary" onClick={generateFixtures}>
                Generate Fixtures
              </button>
            ) : null}
          </div>
        }
      />

      <div className="container">
        {!selectedTournament ? (
          <div className="card">
            <div className="muted">No tournament available. Create one first.</div>
          </div>
        ) : (
          <>
            <div className="grid">
              <div className="card cols-5">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <h2 style={{ margin: 0 }}>Participants</h2>
                  <span className="badge">
                    <span className="dot" />
                    {tournamentGameKey(selectedTournament.game) === "pool" ? "Pool" : "Snooker"}
                  </span>
                </div>

                <div className="muted" style={{ marginTop: 10 }}>
                  Choose players for this tournament. If none are selected, all eligible players will be used.
                </div>

                <div style={{ marginTop: 14 }}>
                  {eligiblePlayers.length === 0 ? (
                    <div className="muted">No eligible players found.</div>
                  ) : (
                    eligiblePlayers.map((p) => {
                      const checked = (selectedTournament.participantIds || []).includes(p.id);
                      return (
                        <label
                          key={p.id}
                          className="row"
                          style={{
                            justifyContent: "space-between",
                            padding: "10px 0",
                            borderBottom: "1px solid rgba(255,255,255,.08)",
                          }}
                        >
                          <div>
                            <b>{p.name}</b>
                            <div className="muted">{p.city || "—"}</div>
                          </div>

                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggleParticipant(p.id)}
                            disabled={!admin}
                          />
                        </label>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="card cols-7">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <h2 style={{ margin: 0 }}>Standings Preview</h2>
                  <span className="badge">
                    <span className="dot warn" />
                    Live from results
                  </span>
                </div>

                {standings.length === 0 ? (
                  <div className="muted" style={{ marginTop: 12 }}>
                    No standings yet. Generate fixtures and mark matches done.
                  </div>
                ) : (
                  <div style={{ marginTop: 12 }}>
                    <table>
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Player</th>
                          <th>P</th>
                          <th>W</th>
                          <th>D</th>
                          <th>L</th>
                          <th>Pts</th>
                        </tr>
                      </thead>
                      <tbody>
                        {standings.map((r, i) => (
                          <tr key={r.id}>
                            <td>#{i + 1}</td>
                            <td>{r.name}</td>
                            <td>{r.played}</td>
                            <td>{r.wins}</td>
                            <td>{r.draws}</td>
                            <td>{r.losses}</td>
                            <td>{r.points}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="card cols-12">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <h2 style={{ margin: 0 }}>Matches</h2>
                  <div className="muted">
                    {selectedTournament.matches?.length || 0} fixtures
                  </div>
                </div>

                {!selectedTournament.matches?.length ? (
                  <div className="muted" style={{ marginTop: 12 }}>
                    No fixtures yet. Generate fixtures first.
                  </div>
                ) : (
                  <div style={{ marginTop: 12 }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Round</th>
                          <th>Match</th>
                          <th>Score 1</th>
                          <th>Score 2</th>
                          <th>Status</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(selectedTournament.matches || []).map((m) => (
                          <tr key={m.id}>
                            <td>{m.round}</td>
                            <td>
                              {playerName(m.p1)} vs {playerName(m.p2)}
                            </td>
                            <td>
                              <input
                                value={m.score1}
                                onChange={(e) =>
                                  updateMatchField(m.id, "score1", e.target.value)
                                }
                                disabled={!admin}
                                style={{ width: 80 }}
                              />
                            </td>
                            <td>
                              <input
                                value={m.score2}
                                onChange={(e) =>
                                  updateMatchField(m.id, "score2", e.target.value)
                                }
                                disabled={!admin}
                                style={{ width: 80 }}
                              />
                            </td>
                            <td>
                              <span className="badge">
                                <span
                                  className={m.status === "done" ? "dot" : "dot warn"}
                                />
                                {m.status || "scheduled"}
                              </span>
                            </td>
                            <td>
                              {admin ? (
                                <div className="row">
                                  {m.status === "done" ? (
                                    <button
                                      className="btn"
                                      onClick={() => reopenMatch(m.id)}
                                    >
                                      Reopen
                                    </button>
                                  ) : (
                                    <button
                                      className="btn primary"
                                      onClick={() => markMatchDone(m.id)}
                                    >
                                      Mark Done
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <span className="muted">—</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function LeaderboardAll({ data }) {
  const tournaments = data.tournaments || [];
  const players = data.players || [];

  const [selectedTournamentId, setSelectedTournamentId] = useState(
    tournaments[0]?.id || ""
  );

  useEffect(() => {
    if (!selectedTournamentId && tournaments[0]?.id) {
      setSelectedTournamentId(tournaments[0].id);
    }
  }, [selectedTournamentId, tournaments]);

  const selectedTournament =
    tournaments.find((t) => t.id === selectedTournamentId) || null;
    const selectedGameKey = selectedTournament
  ? tournamentGameKey(selectedTournament.game)
  : "snooker";

  const standings = selectedTournament
    ? calcLeaderboard(playersForTournament(selectedTournament, players), selectedTournament)
    : [];

  const snookerBoard = useMemo(
    () => calcAutoRankingBoard(players, tournaments, "snooker"),
    [players, tournaments]
  );

  const poolBoard = useMemo(
    () => calcAutoRankingBoard(players, tournaments, "pool"),
    [players, tournaments]
  );

  return (
    <>
      <PageShell
        title="Leaderboards"
        subtitle="Tournament standings and auto rankings"
        right={
          <select
            value={selectedTournamentId}
            onChange={(e) => setSelectedTournamentId(e.target.value)}
          >
            {(tournaments || []).map((t) => (
              <option key={t.id} value={t.id}>
                {tournamentDisplay(t)}
              </option>
            ))}
          </select>
        }
      />

      <div className="container">
        <div className="grid">
          <div className="card cols-12">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2 style={{ margin: 0 }}>
                {selectedTournament ? selectedTournament.name : "Tournament Standings"}
              </h2>
              <span className="badge">
                <span className="dot" />
                {selectedTournament ? tournamentDisplay(selectedTournament) : "No tournament"}
              </span>
            </div>

            {!selectedTournament ? (
              <div className="muted" style={{ marginTop: 12 }}>
                No tournament available.
              </div>
            ) : standings.length === 0 ? (
              <div className="muted" style={{ marginTop: 12 }}>
                No results yet for this tournament.
              </div>
            ) : (
              <div style={{ marginTop: 12 }}>
                <table>
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Player</th>
                      <th>City</th>
                      <th>P</th>
                      <th>W</th>
                      <th>D</th>
                      <th>L</th>
                      <th>Pts</th>
                      <th>For</th>
                      <th>Against</th>
                    </tr>
                  </thead>
                  <tbody>
                    {standings.map((r, i) => (
                      <tr key={r.id}>
                        <td>#{i + 1}</td>
                        <td>{r.name}</td>
                        <td>{r.city || "—"}</td>
                        <td>{r.played}</td>
                        <td>{r.wins}</td>
                        <td>{r.draws}</td>
                        <td>{r.losses}</td>
                        <td>{r.points}</td>
                        <td>{r.for}</td>
                        <td>{r.against}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {selectedGameKey === "snooker" ? (
  <div className="card cols-12">
    <div className="row" style={{ justifyContent: "space-between" }}>
      <h2 style={{ margin: 0 }}>Snooker Auto Ranking</h2>
      <span className="badge">
        <span className="dot" />
        Club-wide
      </span>
    </div>

    <div style={{ marginTop: 12 }}>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Player</th>
            <th>Pts</th>
            <th>W</th>
            <th>L</th>
            <th>Matches</th>
          </tr>
        </thead>
        <tbody>
          {snookerBoard.map((r, i) => (
            <tr key={r.id}>
              <td>#{i + 1}</td>
              <td>{r.name}</td>
              <td>{r.points}</td>
              <td>{r.wins}</td>
              <td>{r.losses}</td>
              <td>{r.matches}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
) : null}

          {selectedGameKey === "pool" ? (
  <div className="card cols-12">
    <div className="row" style={{ justifyContent: "space-between" }}>
      <h2 style={{ margin: 0 }}>Pool Auto Ranking</h2>
      <span className="badge">
        <span className="dot" />
        Club-wide
      </span>
    </div>

    <div style={{ marginTop: 12 }}>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Player</th>
            <th>Pts</th>
            <th>W</th>
            <th>L</th>
            <th>Matches</th>
          </tr>
        </thead>
        <tbody>
          {poolBoard.map((r, i) => (
            <tr key={r.id}>
              <td>#{i + 1}</td>
              <td>{r.name}</td>
              <td>{r.points}</td>
              <td>{r.wins}</td>
              <td>{r.losses}</td>
              <td>{r.matches}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
) : null}
        </div>
      </div>
    </>
  );
}
function HallOfFame({ data, admin, commit }) {

  const entries = data.hallOfFame || [];

  function addEntry() {
    if (!admin) return alert("Admin only");

    const name = prompt("Player name:");
    if (!name) return;

    const title = prompt("Achievement / Title:", "Tournament Champion");
    if (!title) return;

    const year = prompt("Year:", new Date().getFullYear());
    if (!year) return;

    commit({
      ...data,
      hallOfFame: [
        ...entries,
        {
          id: uid(),
          name,
          title,
          year,
          photo: "",
          description: "",
        },
      ],
    });
  }

  function deleteEntry(id) {
    if (!admin) return;
    if (!confirm("Delete this entry?")) return;

    commit({
      ...data,
      hallOfFame: entries.filter((x) => x.id !== id),
    });
  }

  function editDescription(id) {
    if (!admin) return;

    const entry = entries.find((x) => x.id === id);
    if (!entry) return;

    const text = prompt("Description:", entry.description || "");
    if (text === null) return;

    commit({
      ...data,
      hallOfFame: entries.map((x) =>
        x.id === id ? { ...x, description: text } : x
      ),
    });
  }

  function uploadPhoto(id, file) {
    if (!file) return;

    const reader = new FileReader();

    reader.onload = () => {
      commit({
        ...data,
        hallOfFame: entries.map((x) =>
          x.id === id ? { ...x, photo: reader.result } : x
        ),
      });
    };

    reader.readAsDataURL(file);
  }

  return (
    <>
      <PageShell
        title="Hall of Fame"
        subtitle="Champions and club legends"
        right={
          admin ? (
            <button className="btn primary" onClick={addEntry}>
              + Add Entry
            </button>
          ) : null
        }
      />

      <div className="container">
        <div className="grid">

          {entries.length === 0 ? (
            <div className="card">
              <div className="muted">No Hall of Fame entries yet.</div>
            </div>
          ) : null}

          {entries.map((e) => (

            <div key={e.id} className="card cols-6">

              <div className="row" style={{gap:16}}>

                {e.photo ? (
                  <img
                    src={e.photo}
                    alt={e.name}
                    style={{
                      width:80,
                      height:80,
                      objectFit:"cover",
                      borderRadius:10
                    }}
                  />
                ) : (
                  <div className="avatarLarge">
                    {e.name?.charAt(0)}
                  </div>
                )}

                <div>
                  <h2 style={{margin:0}}>{e.name}</h2>
                  <div className="badge">{e.title}</div>
                  <div className="muted">{e.year}</div>
                </div>

              </div>

              {e.description ? (
                <p style={{marginTop:12}}>{e.description}</p>
              ) : null}

              {admin ? (
                <div className="row" style={{marginTop:10}}>
                  <button
                    className="btn"
                    onClick={() => editDescription(e.id)}
                  >
                    Edit Description
                  </button>

                  <label className="btn">
                    Upload Photo
                    <input
                      type="file"
                      style={{display:"none"}}
                      onChange={(ev) =>
                        uploadPhoto(e.id, ev.target.files?.[0])
                      }
                    />
                  </label>

                  <button
                    className="btn danger"
                    onClick={() => deleteEntry(e.id)}
                  >
                    Delete
                  </button>
                </div>
              ) : null}

            </div>

          ))}

        </div>
      </div>
    </>
  );
}



function TVMode({ data, activeTournament, players }) {

  const matches = activeTournament?.matches || [];

  return (
    <>
      <PageShell
        title="TV Display"
        subtitle="Live tournament fixtures"
      />

      <div className="container">

        <div className="card">

          <h2>
            {activeTournament
              ? tournamentDisplay(activeTournament)
              : "No active tournament"}
          </h2>

          {matches.length === 0 ? (
            <div className="muted">No matches available.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Round</th>
                  <th>Match</th>
                  <th>Score</th>
                  <th>Status</th>
                </tr>
              </thead>

              <tbody>
                {matches.map((m) => {

                  const p1 =
                    players.find((x) => x.id === m.p1)?.name || "Player 1";

                  const p2 =
                    players.find((x) => x.id === m.p2)?.name || "Player 2";

                  return (
                    <tr key={m.id}>
                      <td>{m.round}</td>

                      <td>
                        {p1} vs {p2}
                      </td>

                      <td>
                        {m.score1 ?? "-"} : {m.score2 ?? "-"}
                      </td>

                      <td>
                        <span className="badge">
                          <span className="dot" />
                          {m.status || "scheduled"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>

            </table>
          )}

        </div>

      </div>
    </>
  );
}



function AdminPanel({ data, admin, commit, activeTournament }) {
  if (!admin) {
    return (
      <>
        <PageShell title="Admin Panel" />
        <div className="container">
          <div className="card">
            <div className="muted">Admin access required.</div>
          </div>
        </div>
      </>
    );
  }

  const bookingCount = data.booking?.requests?.length || 0;
  const playersCount = data.players?.length || 0;
  const tournamentsCount = data.tournaments?.length || 0;

  function toggleClubOpen() {
    commit({
      ...data,
      club: {
        ...(data.club || {}),
        isOpenNow: !(data.club?.isOpenNow ?? true),
      },
    });
  }

  function setCurrentTournament(tournamentId) {
    commit({
      ...data,
      tournaments: (data.tournaments || []).map((t) => ({
        ...t,
        isCurrent: t.id === tournamentId,
      })),
    });
  }

  return (
    <>
      <PageShell title="Admin Panel" subtitle="Club management overview" />

      <div className="container">
        <div className="grid">
          <div className="card cols-4">
            <h2>Bookings</h2>
            <div className="bigStat">{bookingCount}</div>
            <div className="muted">Total booking requests</div>
            <div style={{ marginTop: 14 }}>
              <Link className="btn primary" to="/book">
                Open Bookings
              </Link>
            </div>
          </div>

          <div className="card cols-4">
            <h2>Players</h2>
            <div className="bigStat">{playersCount}</div>
            <div className="muted">Registered players</div>
            <div style={{ marginTop: 14 }}>
              <Link className="btn primary" to="/players">
                Manage Players
              </Link>
            </div>
          </div>

          <div className="card cols-4">
            <h2>Tournaments</h2>
            <div className="bigStat">{tournamentsCount}</div>
            <div className="muted">Total tournaments</div>
            <div style={{ marginTop: 14 }}>
              <Link className="btn primary" to="/tournaments">
                Manage Tournaments
              </Link>
            </div>
          </div>

          <div className="card cols-6">
            <h2>Club Status</h2>
            <div className="muted" style={{ marginBottom: 12 }}>
              Toggle whether the club is currently open or closed.
            </div>

            <div className="row">
              <span className="badge">
                <span className={data.club?.isOpenNow ? "dot" : "dot red"} />
                {data.club?.isOpenNow ? "OPEN NOW" : "CLOSED NOW"}
              </span>

              <button className="btn primary" onClick={toggleClubOpen} type="button">
                Toggle Open / Closed
              </button>
            </div>
          </div>

          <div className="card cols-6">
            <h2>Current Highlight</h2>
            <div className="muted" style={{ marginBottom: 12 }}>
              Choose which tournament should appear as the current homepage highlight.
            </div>

            <select
              value={activeTournament?.id || ""}
              onChange={(e) => setCurrentTournament(e.target.value)}
            >
              {(data.tournaments || []).map((t) => (
                <option key={t.id} value={t.id}>
                  {tournamentDisplay(t)}
                </option>
              ))}
            </select>

            <div style={{ marginTop: 12 }}>
              <span className="badge">
                <span className="dot" />
                {activeTournament ? tournamentDisplay(activeTournament) : "No current tournament"}
              </span>
            </div>
          </div>

          <div className="card cols-12">
            <h2>Quick Admin Actions</h2>
            <div className="grid" style={{ marginTop: 12 }}>
              <div className="cols-3">
                <Link className="btn primary" to="/book" style={{ width: "100%" }}>
                  Bookings
                </Link>
              </div>
              <div className="cols-3">
                <Link className="btn primary" to="/membership" style={{ width: "100%" }}>
                  Membership
                </Link>
              </div>
              <div className="cols-3">
                <Link className="btn primary" to="/players" style={{ width: "100%" }}>
                  Players
                </Link>
              </div>
              <div className="cols-3">
                <Link className="btn primary" to="/photos" style={{ width: "100%" }}>
                  Photos
                </Link>
              </div>
              <div className="cols-3">
                <Link className="btn primary" to="/tournaments" style={{ width: "100%" }}>
                  Tournaments
                </Link>
              </div>
              <div className="cols-3">
                <Link className="btn primary" to="/fixtures" style={{ width: "100%" }}>
                  Fixtures
                </Link>
              </div>
              <div className="cols-3">
                <Link className="btn primary" to="/leaderboard" style={{ width: "100%" }}>
                  Leaderboards
                </Link>
              </div>
              <div className="cols-3">
                <Link className="btn primary" to="/" style={{ width: "100%" }}>
                  Home
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
function PaymentStatus() {
  const navigate = useNavigate();
  const location = useLocation();
  const [status, setStatus] = useState("checking");

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const order_id = params.get("order_id");

    if (!order_id) {
      setStatus("failed");
      return;
    }

    fetch(`/api/get-order-status?order_id=${order_id}`)
      .then(res => res.json())
      .then(data => {
        if (data.order_status === "PAID") {
          setStatus("success");
        } else {
          setStatus("failed");
        }
      })
      .catch(() => setStatus("failed"));
  }, [location.search]);

  return (
    <div className="container">
      <div className="card" style={{maxWidth:600,margin:"40px auto"}}>

        {status === "checking" && (
          <>
            <h2>Checking your payment...</h2>
          </>
        )}

        {status === "success" && (
          <>
            <h2>Payment Successful 🎉</h2>
            <p>Thank you for your payment at The Q Club.</p>

            <button className="btn primary" onClick={()=>navigate("/")}>
              Go Home
            </button>
          </>
        )}

        {status === "failed" && (
          <>
            <h2>Payment Not Completed</h2>
            <p>Your payment was cancelled or failed.</p>

            <button className="btn primary" onClick={()=>navigate("/book")}>
              Try Again
            </button>
          </>
        )}

      </div>
    </div>
  );
}
function NotFound() {
  return (
    <>
      <PageShell title="Page Not Found" />
      <div className="container">
        <div className="card">
          <div className="muted">
            The page you are looking for does not exist.
          </div>
          <div style={{ marginTop: 14 }}>
            <Link className="btn primary" to="/">
              Go Home
            </Link>
          </div>
        </div>
      </div>
    </>
  );
}