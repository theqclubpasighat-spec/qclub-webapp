import React, { useEffect, useMemo, useRef, useState } from "react";
import { Routes, Route, Link, useNavigate, useLocation } from "react-router-dom";

// Firebase Cloud Sync helpers (implemented in src/cloud.js)
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
function clampStr(s, n = 120) {
  const t = (s || "").toString();
  return t.length > n ? t.slice(0, n) + "…" : t;
}
function safeNum(x, fallback = 0) {
  const v = Number(x);
  return Number.isFinite(v) ? v : fallback;
}
function monthKey(d = new Date()) {
  return d.toISOString().slice(0, 7);
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
  // Uses external QR image generator. Works on Vercel/phones.
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
  upiId: "yomsoji-1@okicici",
  upiName: "The Q CLUB",
  isOpenNow: true, // NEW
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

    photos: [
      // stored as data URLs when uploaded
    ],

    players: [
      { id: uid(), name: "Wilson", city: "Pasighat", photo: "", bio: "" },
      { id: uid(), name: "Riku", city: "Pasighat", photo: "", bio: "" },
      { id: uid(), name: "Tani", city: "Aalo", photo: "", bio: "" },
      { id: uid(), name: "Bikash", city: "Roing", photo: "", bio: "" },
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
        participantIds: [], // empty=all players
        matches: [],
      },
    ],

    booking: {
      tables: [
        { id: "snk12", label: "Snooker Table 12x6 — ₹400 / hour", pricePerHour: 400 },
        { id: "mini10", label: "Mini Snooker 10x5 — ₹300 / hour", pricePerHour: 300 },
        { id: "pool9", label: "American Pool — ₹300 / hour", pricePerHour: 300 },
      ],
      // Booking requests (local) for notification/pending verification
      requests: [],
      // for admin ping notifications
      lastSeenRequestAt: 0,
    },

    hallOfFame: {
      entries: [
        // {id, title, playerName, month, stats, description, photo}
      ],
    },
  };
}

function loadData() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaultData();
    const parsed = JSON.parse(raw);
    // Light migration: ensure required keys exist
    const d = { ...defaultData(), ...parsed };
    d.club = { ...defaultData().club, ...(parsed.club || {}) };
    d.admin = { ...defaultData().admin, ...(parsed.admin || {}) };
    d.booking = { ...defaultData().booking, ...(parsed.booking || {}) };
    d.hallOfFame = { ...defaultData().hallOfFame, ...(parsed.hallOfFame || {}) };
    d.booking.tables = parsed?.booking?.tables?.length ? parsed.booking.tables : defaultData().booking.tables;
    d.booking.requests = parsed?.booking?.requests || [];
    d.booking.lastSeenRequestAt = parsed?.booking?.lastSeenRequestAt || 0;
    d.hallOfFame.entries = parsed?.hallOfFame?.entries || [];
    return d;
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
          status: "scheduled", // scheduled | done
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
   (WebAudio oscillator – no files needed)
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
  } catch {
    // ignore
  }
}

/* =========================================================
   App
========================================================= */
export default function App() {
  const [data, setData] = useState(loadData());
  const [cloudStatus, setCloudStatus] = useState(isCloudEnabled() ? "syncing" : "local");
  const [admin, setAdmin] = useState(false);

  // Cloud sync: keep one shared state across all devices
  useEffect(() => {
    if (!isCloudEnabled()) return;
    const missing = cloudMissingVars();
    if (missing.length) {
      console.warn("Supabase env vars missing:", missing);
      setCloudStatus("error");
      return;
    }
    setCloudStatus("syncing");
    const unsub = subscribeState(
      (remote) => {
        // Apply remote state + keep a local cache (for offline)
        setData(remote);
        try { saveData(remote); } catch {}
        setCloudStatus("synced");
      },
      (err) => {
        console.warn("Cloud sync warning:", err);
        setCloudStatus((prev) => (prev === "synced" ? "degraded" : "syncing"));
      }
    );
    return () => unsub?.();
  }, []);

  const navigate = useNavigate();
  const location = useLocation();

  function commit(next) {
    setData(next);
    saveData(next);
      if (isCloudEnabled()) {
        setCloudStatus("syncing");
        writeState(next)
          .then(() => setCloudStatus("synced"))
          .catch((e) => {
            console.error("Cloud write failed:", e);
            setCloudStatus("error");
          });
      }
  }

  // Active tournament = latest month
  const activeTournament = useMemo(() => {
    const t = [...(data.tournaments || [])]
      .sort((a, b) => (a.month || "").localeCompare(b.month || ""))
      .pop();
    return t || null;
  }, [data.tournaments]);

  const playersForTournament = (t) => {
    if (!t) return data.players || [];
    const ids = t.participantIds?.length ? t.participantIds : (data.players || []).map((p) => p.id);
    const setIds = new Set(ids);
    return (data.players || []).filter((p) => setIds.has(p.id));
  };

  // Admin login
  function toggleAdmin() {
    if (admin) return setAdmin(false);
    const pin = prompt("Enter Admin PIN:");
    if (pin && pin === data.admin?.pin) setAdmin(true);
    else alert("Wrong PIN");
  }
  function changePin() {
    if (!admin) return alert("Admin only");
    const p = prompt("New Admin PIN:");
    if (!p) return;
    commit({ ...data, admin: { ...data.admin, pin: p } });
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

  // PAYMENT REQUEST PING:
  // If admin is ON and a new booking request arrives (createdAt newer than lastSeenRequestAt), ping once.
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

  // Always scroll to top on route change (better mobile UX)
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
        <Route path="/book" element={<BookTable data={data} admin={admin} commit={commit} />} />
        <Route path="/membership" element={<Membership data={data} admin={admin} commit={commit} />} />
        <Route path="/offer" element={<Offers data={data} admin={admin} commit={commit} />} />
        <Route path="/photos" element={<Photos data={data} admin={admin} commit={commit} />} />
        <Route path="/players" element={<Players data={data} admin={admin} commit={commit} activeTournament={activeTournament} />} />
        <Route path="/tournaments" element={<Tournaments data={data} admin={admin} commit={commit} />} />
        <Route path="/fixtures" element={<Fixtures data={data} admin={admin} commit={commit} />} />
        <Route path="/leaderboard" element={<LeaderboardAll data={data} />} />
        <Route path="/halloffame" element={<HallOfFame data={data} admin={admin} commit={commit} />} />
        <Route path="/tv" element={<TVMode data={data} activeTournament={activeTournament} players={playersForTournament(activeTournament)} />} />
        <Route path="*" element={<NotFound />} />
      </Routes>

      <BottomPadding />
    </>
  );
}

/* =========================================================
   Layout
========================================================= */
function BottomPadding() {
  return <div style={{ height: 28 }} />;
}

function TopNav({ club, admin, onToggleAdmin, onChangePin, onReset, cloudStatus }) {
  return (
    <div className="nav">
      <div className="nav-inner">
        <div className="brand">
          <div className="title">
            <span className="brandMark">Q</span> {club?.name || "The Q CLUB"}
          </div>
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

/* =========================================================
   Home
========================================================= */
function Home({ data, admin, commit, activeTournament }) {
  const phone = [data.club?.contact?.phone1, data.club?.contact?.phone2].filter(Boolean).join(" / ");

  function addAnnouncement() {
    const text = prompt("Announcement text:");
    if (!text) return;
    commit({
      ...data,
      announcements: [{ id: uid(), text, createdAt: Date.now() }, ...(data.announcements || [])],
    });
  }
  function deleteAnnouncement(id) {
    if (!confirm("Delete this announcement?")) return;
    commit({ ...data, announcements: (data.announcements || []).filter((a) => a.id !== id) });
  }

  const topReq = (data.booking?.requests || [])
    .slice()
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    .slice(0, 3);

  return (
    <div className="container hero">
      <div className="grid">
        <div className="card cols-8">
          <div className="row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
  {admin ? (
    <button
      className="badge"
      style={{ cursor: "pointer", border: "none" }}
      onClick={() => {
        commit({
          ...data,
          club: { ...(data.club || {}), isOpenNow: !(data.club?.isOpenNow ?? true) },
        });
      }}
      title="Admin: Toggle Open/Closed"
    >
      <span className={data.club?.isOpenNow ? "dot" : "dot red"} />{" "}
      {data.club?.isOpenNow ? "OPEN NOW" : "CLOSED NOW"}
    </button>
  ) : (
    <span className="badge">
      <span className={data.club?.isOpenNow ? "dot" : "dot red"} />{" "}
      {data.club?.isOpenNow ? "OPEN NOW" : "CLOSED NOW"}
    </span>
  )}

  <span className="badge"><span className="dot red" /> Payments: UPI display (verification later)</span>
</div>

          <h1 style={{ marginTop: 12 }}>
            Welcome to {data.club?.name || "The Q CLUB"}
          </h1>

          <p className="muted">
            Snooker • Pool • Air Hockey • Foosball • Massage Chair • Tea/Coffee Vending • Monthly Tournaments • Leaderboards
          </p>

          <div className="kpi" style={{ marginTop: 14 }}>
            <div className="chip">
              <div className="muted">Location</div>
              <div className="big">{data.club?.location || "—"}</div>
            </div>
            <div className="chip">
              <div className="muted">Contact</div>
              <div className="big">{phone || "—"}</div>
            </div>
            <div className="chip">
              <div className="muted">Current Tournament</div>
              <div className="big">{activeTournament ? `${activeTournament.month}` : "—"}</div>
            </div>
          </div>

          <div className="grid" style={{ marginTop: 14 }}>
            <Link className="card cols-4 tap" to="/book">
              <div className="cardTitle">Book Table</div>
              <div className="muted">Quick booking + UPI QR</div>
            </Link>
            <Link className="card cols-4 tap" to="/membership">
              <div className="cardTitle">Membership</div>
              <div className="muted">Bronze ₹499 and more</div>
            </Link>
            <Link className="card cols-4 tap" to="/leaderboard">
              <div className="cardTitle">Leaderboards</div>
              <div className="muted">Rankings & stats</div>
            </Link>
          </div>
        </div>

        <div className="card cols-4">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2 style={{ margin: 0 }}>Announcements</h2>
            {admin && <button className="btn primary" onClick={addAnnouncement}>+ Add</button>}
          </div>

          <div style={{ marginTop: 10 }}>
            {(data.announcements || []).length === 0 ? (
              <div className="muted">No announcements.</div>
            ) : (
              (data.announcements || []).slice(0, 8).map((a) => (
                <div className="card" key={a.id} style={{ marginBottom: 10 }}>
                  <div className="muted" style={{ fontSize: 13 }}>
                    {new Date(a.createdAt).toLocaleString()}
                  </div>
                  <div style={{ marginTop: 6 }}>{a.text}</div>
                  {admin && (
                    <div style={{ marginTop: 10 }}>
                      <button className="btn danger" onClick={() => deleteAnnouncement(a.id)}>Delete</button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="card cols-12">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
            <div>
              <h2 style={{ margin: 0 }}>Latest Booking Requests</h2>
              <div className="muted">If Admin is ON, you’ll hear a ping when a new request is submitted.</div>
            </div>
            <Link className="btn" to="/book">Open Book Table</Link>
          </div>

          {topReq.length === 0 ? (
            <div className="muted" style={{ marginTop: 10 }}>No booking requests yet.</div>
          ) : (
            <div className="grid" style={{ marginTop: 10 }}>
              {topReq.map((r) => (
                <div className="card cols-4" key={r.id}>
                  <div className="row" style={{ justifyContent: "space-between" }}>
                    <b>{r.name || "Guest"}</b>
                    <span className="badge"><span className="dot red" /> pending</span>
                  </div>
                  <div className="muted" style={{ marginTop: 6 }}>{r.itemLabel}</div>
                  <div style={{ marginTop: 6 }}>
                    <span className="badge"><span className="dot" /> Amount: ₹{r.amount}</span>
                  </div>
                  <div className="muted" style={{ marginTop: 8, fontSize: 13 }}>
                    {new Date(r.createdAt).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}

/* =========================================================
   Book Table (single tab experience)
========================================================= */
function BookTable({ data, admin, commit }) {
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [tableId, setTableId] = useState(data.booking?.tables?.[0]?.id || "snk12");
  const [hours, setHours] = useState(1);
  const [note, setNote] = useState("");
  const [submitted, setSubmitted] = useState(null);

  const tables = data.booking?.tables || [];
  const selected = tables.find((t) => t.id === tableId) || tables[0];
  const amount = Math.max(0, safeNum(selected?.pricePerHour, 0) * safeNum(hours, 1));

  const upiId = data.club?.upiId || "yomsoji-1@okicici";
  const upiName = data.club?.upiName || data.club?.name || "The Q CLUB";
  const txNote = `QClub Booking: ${selected?.label || "Table"} (${hours}h)`;
  const link = upiDeepLink({ pa: upiId, pn: upiName, am: amount, tn: txNote });

  function submitRequest() {
    if (!name.trim()) return alert("Enter your name");
    if (!mobile.trim()) return alert("Enter mobile number");
    if (!selected) return alert("Select a table");
    if (amount <= 0) return alert("Invalid amount");

    const req = {
      id: uid(),
      name: name.trim(),
      mobile: mobile.trim(),
      itemId: selected.id,
      itemLabel: selected.label,
      hours: safeNum(hours, 1),
      amount,
      note: note.trim(),
      createdAt: Date.now(),
      status: "pending", // pending | verified (later)
    };

    commit({
      ...data,
      booking: {
        ...data.booking,
        requests: [req, ...(data.booking?.requests || [])],
      },
    });

    setSubmitted(req);
    setNote("");
  }

  function markVerified(id) {
    if (!admin) return alert("Admin only");
    commit({
      ...data,
      booking: {
        ...data.booking,
        requests: (data.booking?.requests || []).map((r) => (r.id === id ? { ...r, status: "verified" } : r)),
      },
    });
  }

  return (
    <>
      <PageShell
        title="Book a Table"
        subtitle="Book & pay via UPI (verification later)"
        right={
          admin ? (
            <span className="badge"><span className="dot" /> Admin view</span>
          ) : null
        }
      />

      <div className="container">
        <div className="grid">
          <div className="card cols-6">
            <h2 style={{ marginTop: 0 }}>Customer Booking</h2>

            <div className="field">
              <label>Name</label>
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
            </div>

            <div className="field">
              <label>Mobile No.</label>
              <input value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="10-digit mobile" />
            </div>

            <div className="field">
              <label>Select</label>
              <select value={tableId} onChange={(e) => setTableId(e.target.value)}>
                {tables.map((t) => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>
            </div>

            <div className="field">
              <label>Hours</label>
              <select value={hours} onChange={(e) => setHours(Number(e.target.value))}>
                {[1,2,3,4,5].map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>

            <div className="field">
              <label>Note (optional)</label>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Preferred time / message" />
            </div>

            <div className="row" style={{ justifyContent: "space-between", marginTop: 10, flexWrap: "wrap", gap: 10 }}>
              <div>
                <div className="muted">Amount</div>
                <div style={{ fontSize: 22, fontWeight: 900 }}>₹{amount}</div>
              </div>
              <button className="btn primary" onClick={submitRequest}>Submit Booking</button>
            </div>

            {submitted ? (
              <div className="card" style={{ marginTop: 12 }}>
                <b>Booking submitted ✅</b>
                <div className="muted" style={{ marginTop: 6 }}>
                  Show this QR to pay. Admin will get a ping (if admin mode open).
                </div>
                <div className="grid" style={{ marginTop: 10 }}>
                  <div className="cols-6">
                    <img
                      src={qrUrl(link, 220)}
                      alt="UPI QR"
                      style={{ width: 220, height: 220, borderRadius: 12, border: "1px solid rgba(255,255,255,.12)" }}
                    />
                    <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
                      If QR doesn’t load, use UPI string below.
                    </div>
                  </div>
                  <div className="cols-6">
                    <div className="badge"><span className="dot" /> UPI: {upiId}</div>
                    <div className="muted" style={{ marginTop: 10 }}>
                      {submitted.itemLabel} • {submitted.hours} hour(s)
                    </div>
                    <div style={{ marginTop: 10 }}>
                      <a className="btn" href={link}>Open UPI App</a>
                    </div>
                    <div className="muted" style={{ marginTop: 10, fontSize: 12, wordBreak: "break-all" }}>
                      {link}
                    </div>
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="card cols-6">
            <h2 style={{ marginTop: 0 }}>Admin: Requests</h2>
            <div className="muted">
              New submissions trigger a <b>ping</b> when Admin is ON.
            </div>

            {(data.booking?.requests || []).length === 0 ? (
              <div className="muted" style={{ marginTop: 10 }}>No requests yet.</div>
            ) : (
              <div style={{ marginTop: 10 }}>
                {(data.booking?.requests || []).slice(0, 25).map((r) => (
                  <div className="card" key={r.id} style={{ marginBottom: 10 }}>
                    <div className="row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <b>{r.name}</b>
                      <span className="badge">
                        <span className={r.status === "verified" ? "dot" : "dot red"} />
                        {r.status}
                      </span>
                    </div>
                    <div className="muted" style={{ marginTop: 6 }}>{r.itemLabel}</div>
                    <div className="row" style={{ justifyContent: "space-between", marginTop: 8, gap: 10, flexWrap: "wrap" }}>
                      <span className="badge"><span className="dot" /> ₹{r.amount}</span>
                      <span className="muted" style={{ fontSize: 12 }}>{r.mobile}</span>
                    </div>
                    {r.note ? <div className="muted" style={{ marginTop: 8 }}>Note: {r.note}</div> : null}
                    <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>{new Date(r.createdAt).toLocaleString()}</div>

                    {admin ? (
                      <div className="row" style={{ marginTop: 10, justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                        <button className="btn" onClick={() => playPing()}>Test Ping</button>
                        {r.status !== "verified" ? (
                          <button className="btn primary" onClick={() => markVerified(r.id)}>Mark Verified</button>
                        ) : (
                          <span className="muted">Verified</span>
                        )}
                      </div>
                    ) : (
                      <div className="muted" style={{ marginTop: 10 }}>Admin login to verify requests.</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
    </>
  );
}

/* =========================================================
   Membership (Edit + Apply Now)
========================================================= */
function Membership({ data, admin, commit }) {
  const [applyTier, setApplyTier] = useState(null); // membership object
  const tiers = data.memberships || [];
  const upiId = data.club?.upiId || "yomsoji-1@okicici";
  const upiName = data.club?.upiName || data.club?.name || "The Q CLUB";

  function addTier() {
    if (!admin) return alert("Admin only");
    const tier = prompt("Tier name:", "New Tier");
    if (!tier) return;
    const price = Number(prompt("Price (INR):", "999"));
    const perks = prompt("Perks (comma separated):", "Benefit 1, Benefit 2");
    const note = prompt("Note:", "Non-transferable");
    commit({
      ...data,
      memberships: [
        ...tiers,
        {
          id: uid(),
          tier: tier.trim(),
          price: Number.isFinite(price) ? price : 0,
          perks: (perks || "").split(",").map((s) => s.trim()).filter(Boolean),
          note: note || "",
        },
      ],
    });
  }

  function removeTier(id) {
    if (!admin) return;
    if (!confirm("Delete this membership tier?")) return;
    commit({ ...data, memberships: tiers.filter((x) => x.id !== id) });
  }

  function editTier(t) {
    if (!admin) return;
    const tier = prompt("Tier name:", t.tier);
    if (!tier) return;
    const price = Number(prompt("Price (INR):", String(t.price ?? 0)));
    const perks = prompt("Perks (comma separated):", (t.perks || []).join(", "));
    const note = prompt("Note:", t.note || "");
    commit({
      ...data,
      memberships: tiers.map((x) =>
        x.id === t.id
          ? {
              ...x,
              tier: tier.trim(),
              price: Number.isFinite(price) ? price : x.price,
              perks: (perks || "").split(",").map((s) => s.trim()).filter(Boolean),
              note: note || "",
            }
          : x
      ),
    });
  }

  return (
    <>
      <PageShell
        title="Membership"
        subtitle="Apply & pay via UPI QR (verification later)"
        right={admin ? <button className="btn primary" onClick={addTier}>+ Add Tier</button> : null}
      />

      <div className="container">
        <div className="grid">
          {tiers.map((m) => (
            <div className="card cols-6" key={m.id}>
              <div className="row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div>
                  <div className="cardTitle">{m.tier}</div>
                  <div className="badge" style={{ marginTop: 8 }}>
                    <span className="dot" /> ₹{m.price} (fixed)
                  </div>
                </div>
                <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                  <button className="btn primary" onClick={() => setApplyTier(m)}>Apply Now</button>
                  {admin ? (
                    <>
                      <button className="btn" onClick={() => editTier(m)}>Edit</button>
                      <button className="btn danger" onClick={() => removeTier(m.id)}>Delete</button>
                    </>
                  ) : null}
                </div>
              </div>

              <ul className="muted" style={{ marginTop: 10 }}>
                {(m.perks || []).map((p, i) => <li key={i}>{p}</li>)}
              </ul>
              {m.note ? <div className="muted" style={{ marginTop: 10 }}>{m.note}</div> : null}
            </div>
          ))}
        </div>

        {applyTier ? (
          <ApplyModal
            tier={applyTier}
            upiId={upiId}
            upiName={upiName}
            onClose={() => setApplyTier(null)}
          />
        ) : null}
      </div>
    </>
  );
}

function ApplyModal({ tier, upiId, upiName, onClose }) {
  const [fullName, setFullName] = useState("");
  const [location, setLocation] = useState("Pasighat");
  const [mobile, setMobile] = useState("");
  const [size, setSize] = useState("M");

  const tn = `QClub Membership: ${tier.tier}`;
  const link = upiDeepLink({ pa: upiId, pn: upiName, am: tier.price, tn });

  return (
    <div className="modalOverlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
          <div>
            <div className="cardTitle">Apply: {tier.tier}</div>
            <div className="muted">Amount: ₹{tier.price}</div>
          </div>
          <button className="btn" onClick={onClose}>Close</button>
        </div>

        <div className="grid" style={{ marginTop: 10 }}>
          <div className="field cols-6">
            <label>Name</label>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Full name" />
          </div>
          <div className="field cols-6">
            <label>Location</label>
            <input value={location} onChange={(e) => setLocation(e.target.value)} placeholder="City" />
          </div>
          <div className="field cols-6">
            <label>Mobile No.</label>
            <input value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="10-digit mobile" />
          </div>
          <div className="field cols-6">
            <label>T-Shirt Size</label>
            <select value={size} onChange={(e) => setSize(e.target.value)}>
              {["XS","S","M","L","XL","XXL"].map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </div>
        </div>

        <div className="card" style={{ marginTop: 10 }}>
          <b>UPI QR (Display only)</b>
          <div className="muted" style={{ marginTop: 6 }}>
            Pay using any UPI app. Verification will be added later with PhonePe Business.
          </div>

          <div className="grid" style={{ marginTop: 10, alignItems: "start" }}>
            <div className="cols-6">
              <img
                src={qrUrl(link, 220)}
                alt="UPI QR"
                style={{ width: 220, height: 220, borderRadius: 12, border: "1px solid rgba(255,255,255,.12)" }}
              />
              <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
                {fullName ? `Name: ${fullName}` : "Fill details (optional)"} • Size: {size}
              </div>
            </div>
            <div className="cols-6">
              <div className="badge"><span className="dot" /> UPI: {upiId}</div>
              <div style={{ marginTop: 10 }}>
                <a className="btn primary" href={link}>Open UPI App</a>
              </div>
              <div className="muted" style={{ marginTop: 10, fontSize: 12, wordBreak: "break-all" }}>
                {link}
              </div>
            </div>
          </div>
        </div>

        <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
          Note: Auto-verification requires payment gateway / business integration. We’ll add that after you open the Q Club bank account.
        </div>
      </div>
    </div>
  );
}

/* =========================================================
   Offers (What We Offer) – Edit buttons for admin
========================================================= */
function Offers({ data, admin, commit }) {
  const list = data.offers || [];

  function add() {
    if (!admin) return alert("Admin only");
    const title = prompt("Title:", "New Offer");
    if (!title) return;
    const price = prompt("Price display:", "₹");
    const details = prompt("Details:", "Description");
    commit({ ...data, offers: [...list, { id: uid(), title, price: price || "", details: details || "" }] });
  }

  function remove(id) {
    if (!admin) return;
    if (!confirm("Delete this offer?")) return;
    commit({ ...data, offers: list.filter((x) => x.id !== id) });
  }

  function edit(o) {
    if (!admin) return;
    const title = prompt("Title:", o.title);
    if (!title) return;
    const price = prompt("Price display:", o.price || "");
    const details = prompt("Details:", o.details || "");
    commit({
      ...data,
      offers: list.map((x) => (x.id === o.id ? { ...x, title: title.trim(), price: price || "", details: details || "" } : x)),
    });
  }

  return (
    <>
      <PageShell
        title="What We Offer"
        subtitle="Games, fun & extras"
        right={admin ? <button className="btn primary" onClick={add}>+ Add</button> : null}
      />

      <div className="container">
        <div className="grid">
          {list.map((o) => (
            <div className="card cols-4" key={o.id}>
              <div className="row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                <div className="cardTitle">{o.title}</div>
                {admin ? (
                  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <button className="btn" onClick={() => edit(o)}>Edit</button>
                    <button className="btn danger" onClick={() => remove(o.id)}>Delete</button>
                  </div>
                ) : null}
              </div>
              {o.price ? <div className="badge" style={{ marginTop: 10 }}><span className="dot" /> {o.price}</div> : null}
              {o.details ? <div className="muted" style={{ marginTop: 10 }}>{o.details}</div> : null}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/* =========================================================
   Photos (Upload file + caption)
========================================================= */
function Photos({ data, admin, commit }) {
  const list = data.photos || [];
  const fileRef = useRef(null);

  async function addFromFile() {
    if (!admin) return alert("Admin only");
    const file = fileRef.current?.files?.[0];
    if (!file) return alert("Choose a photo file first.");
    const caption = prompt("Caption / Name:", "Q Club vibes") || "";
    const dataUrl = await readFileAsDataURL(file);
    commit({
      ...data,
      photos: [
        { id: uid(), dataUrl, caption: caption.trim(), createdAt: Date.now() },
        ...list,
      ],
    });
    if (fileRef.current) fileRef.current.value = "";
  }

  function remove(id) {
    if (!admin) return;
    if (!confirm("Delete this photo?")) return;
    commit({ ...data, photos: list.filter((x) => x.id !== id) });
  }

  return (
    <>
      <PageShell
        title="Photos"
        subtitle="Club moments"
        right={
          admin ? (
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <input ref={fileRef} type="file" accept="image/*" />
              <button className="btn primary" onClick={addFromFile}>Upload</button>
            </div>
          ) : null
        }
      />

      <div className="container">
        {(list.length === 0) ? (
          <div className="card">
            <div className="muted">No photos yet. {admin ? "Upload a photo above." : ""}</div>
          </div>
        ) : (
          <div className="gallery" style={{ marginTop: 8 }}>
            {list.map((p) => (
              <div className="photo" key={p.id}>
                <img src={p.dataUrl || p.url} alt={p.caption || "photo"} />
                <div className="cap">
                  <div>{p.caption || "—"}</div>
                  <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>
                    {p.createdAt ? new Date(p.createdAt).toLocaleString() : ""}
                  </div>
                  {admin ? (
                    <div style={{ marginTop: 8 }}>
                      <button className="btn danger" onClick={() => remove(p.id)}>Delete</button>
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

/* =========================================================
   Players (click name -> profile modal with stats/rank)
========================================================= */
function Players({ data, admin, commit, activeTournament }) {
  const players = data.players || [];
  const [selected, setSelected] = useState(null);

  // For stats: use active tournament leaderboard as "rank"
  const activePlayers = activeTournament ? playersForTournament(data, activeTournament) : players;
  const lb = activeTournament ? calcLeaderboard(activePlayers, activeTournament) : [];

  function playersForTournament(d, t) {
    const ids = t.participantIds?.length ? t.participantIds : (d.players || []).map((p) => p.id);
    const setIds = new Set(ids);
    return (d.players || []).filter((p) => setIds.has(p.id));
  }
  function rankOf(pid) {
    const idx = lb.findIndex((r) => r.id === pid);
    return idx >= 0 ? idx + 1 : null;
  }
  function rowOf(pid) {
    return lb.find((r) => r.id === pid) || null;
  }

  function addPlayer() {
    if (!admin) return alert("Admin only");
    const name = prompt("Player name:");
    if (!name) return;
    const city = prompt("City:", "Pasighat") || "";
    commit({
      ...data,
      players: [...players, { id: uid(), name: name.trim(), city: city.trim(), photo: "", bio: "" }],
    });
  }
  function removePlayer(id) {
    if (!admin) return;
    if (!confirm("Delete player? (May affect fixtures)")) return;
    commit({ ...data, players: players.filter((p) => p.id !== id) });
  }
  async function editPlayer(p) {
    if (!admin) return;
    const name = prompt("Name:", p.name);
    if (!name) return;
    const city = prompt("City:", p.city || "");
    const bio = prompt("Short bio (optional):", p.bio || "");
    commit({
      ...data,
      players: players.map((x) => (x.id === p.id ? { ...x, name: name.trim(), city: (city || "").trim(), bio: bio || "" } : x)),
    });
  }
  async function uploadPlayerPhoto(p, file) {
    if (!admin) return;
    const dataUrl = await readFileAsDataURL(file);
    commit({
      ...data,
      players: players.map((x) => (x.id === p.id ? { ...x, photo: dataUrl } : x)),
    });
  }

  return (
    <>
      <PageShell
        title="Players"
        subtitle={activeTournament ? `Tap a player to view profile (Rank from ${activeTournament.month})` : "Tap a player to view profile"}
        right={admin ? <button className="btn primary" onClick={addPlayer}>+ Add Player</button> : null}
      />

      <div className="container">
        <div className="card">
          <table>
            <thead>
              <tr>
                <th>Player</th>
                <th className="muted">City</th>
                <th>Rank</th>
                {admin ? <th>Admin</th> : null}
              </tr>
            </thead>
            <tbody>
              {players.map((p) => (
                <tr key={p.id}>
                  <td>
                    <button className="linkBtn" onClick={() => setSelected(p)}>{p.name}</button>
                  </td>
                  <td className="muted">{p.city || "-"}</td>
                  <td>{rankOf(p.id) ? `#${rankOf(p.id)}` : "-"}</td>
                  {admin ? (
                    <td>
                      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                        <button className="btn" onClick={() => editPlayer(p)}>Edit</button>
                        <button className="btn danger" onClick={() => removePlayer(p.id)}>Delete</button>
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {selected ? (
          <PlayerModal
            player={selected}
            admin={admin}
            onClose={() => setSelected(null)}
            rank={rankOf(selected.id)}
            statsRow={rowOf(selected.id)}
            onUpload={(file) => uploadPlayerPhoto(selected, file)}
          />
        ) : null}
      </div>
    </>
  );
}

function PlayerModal({ player, admin, onClose, rank, statsRow, onUpload }) {
  const fileRef = useRef(null);
  return (
    <div className="modalOverlay" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
          <div>
            <div className="cardTitle">{player.name}</div>
            <div className="muted">{player.city || ""} {rank ? `• Rank #${rank}` : ""}</div>
          </div>
          <button className="btn" onClick={onClose}>Close</button>
        </div>

        <div className="grid" style={{ marginTop: 10, alignItems: "start" }}>
          <div className="cols-5">
            <div className="photoBox">
              {player.photo ? (
                <img src={player.photo} alt="player" />
              ) : (
                <div className="muted">No photo</div>
              )}
            </div>

            {admin ? (
              <div className="row" style={{ gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <input ref={fileRef} type="file" accept="image/*" />
                <button
                  className="btn primary"
                  onClick={() => {
                    const f = fileRef.current?.files?.[0];
                    if (!f) return alert("Choose a file first");
                    onUpload(f);
                    fileRef.current.value = "";
                  }}
                >
                  Upload Photo
                </button>
              </div>
            ) : null}

            {player.bio ? <div className="muted" style={{ marginTop: 10 }}>{player.bio}</div> : null}
          </div>

          <div className="cols-7">
            <div className="card">
              <div className="cardTitle">Stats</div>
              {statsRow ? (
                <div className="grid" style={{ marginTop: 10 }}>
                  <Stat label="Matches" value={statsRow.played} />
                  <Stat label="Wins" value={statsRow.wins} />
                  <Stat label="Loss" value={statsRow.losses} />
                  <Stat label="Points" value={statsRow.points} />
                  <Stat label="For" value={statsRow.for} />
                  <Stat label="Against" value={statsRow.against} />
                  <Stat label="Diff" value={statsRow.for - statsRow.against} />
                </div>
              ) : (
                <div className="muted" style={{ marginTop: 8 }}>
                  Stats appear after fixtures are generated & matches are marked done.
                </div>
              )}
            </div>

            <div className="muted" style={{ marginTop: 10, fontSize: 12 }}>
              Rank and stats are based on current tournament results.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="chip">
      <div className="muted">{label}</div>
      <div className="big">{value ?? "-"}</div>
    </div>
  );
}

/* =========================================================
   Tournaments + Tournament Leaderboards
========================================================= */
function Tournaments({ data, admin, commit }) {
  const tournaments = data.tournaments || [];
  const players = data.players || [];
  const [view, setView] = useState("list"); // list | leaderboards

  function addTournament() {
    if (!admin) return alert("Admin only.");
    const name = prompt("Tournament name:", "Monthly Snooker Cup");
    if (!name) return;
    const month = prompt("Month (YYYY-MM):", monthKey());
    const game = prompt("Game (Snooker/Pool/etc):", "Snooker");
    commit({
      ...data,
      tournaments: [
        ...tournaments,
        {
          id: uid(),
          name,
          month: month || "",
          game: game || "",
          format: "Round Robin",
          pointsWin: 3,
          pointsDraw: 1,
          pointsLoss: 0,
          participantIds: [],
          matches: [],
        },
      ],
    });
  }
  function removeTournament(id) {
    if (!admin) return;
    if (!confirm("Delete tournament and its matches?")) return;
    commit({ ...data, tournaments: tournaments.filter((t) => t.id !== id) });
  }

  return (
    <>
      <PageShell
        title="Tournaments"
        subtitle="Manage tournaments and view per-tournament standings"
        right={
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className={view === "list" ? "btn primary" : "btn"} onClick={() => setView("list")}>Tournaments</button>
            <button className={view === "leaderboards" ? "btn primary" : "btn"} onClick={() => setView("leaderboards")}>Tournament Leaderboards</button>
            {admin ? <button className="btn" onClick={addTournament}>+ New</button> : null}
          </div>
        }
      />

      <div className="container">
        {view === "list" ? (
          <div className="card">
            {tournaments.length === 0 ? (
              <div className="muted">No tournaments yet.</div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Month</th>
                    <th>Name</th>
                    <th>Game</th>
                    <th>Matches</th>
                    {admin ? <th>Action</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {tournaments
                    .slice()
                    .sort((a, b) => (b.month || "").localeCompare(a.month || ""))
                    .map((t) => (
                      <tr key={t.id}>
                        <td>{t.month}</td>
                        <td>{t.name}</td>
                        <td>{t.game}</td>
                        <td>{(t.matches || []).length}</td>
                        {admin ? (
                          <td>
                            <button className="btn danger" onClick={() => removeTournament(t.id)}>Delete</button>
                          </td>
                        ) : null}
                      </tr>
                    ))}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <TournamentLeaderboards data={data} players={players} />
        )}
      </div>
    </>
  );
}

function TournamentLeaderboards({ data, players }) {
  const tournaments = data.tournaments || [];
  const [selectedId, setSelectedId] = useState(tournaments[0]?.id || "");
  const t = tournaments.find((x) => x.id === selectedId) || null;

  const tourPlayers = useMemo(() => {
    if (!t) return [];
    const ids = t.participantIds?.length ? t.participantIds : players.map((p) => p.id);
    const setIds = new Set(ids);
    return players.filter((p) => setIds.has(p.id));
  }, [t, players]);

  const table = useMemo(() => (t ? calcLeaderboard(tourPlayers, t) : []), [t, tourPlayers]);

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <h2 style={{ margin: 0 }}>Tournament Leaderboard</h2>
        <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
          {tournaments
            .slice()
            .sort((a, b) => (b.month || "").localeCompare(a.month || ""))
            .map((x) => (
              <option key={x.id} value={x.id}>
                {x.month} • {x.name}
              </option>
            ))}
        </select>
      </div>

      {!t ? (
        <div className="muted" style={{ marginTop: 10 }}>Create a tournament first.</div>
      ) : (
        <>
          <div className="muted" style={{ marginTop: 8 }}>{t.month} • {t.name} • {t.game}</div>
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
                  <th>Diff</th>
                </tr>
              </thead>
              <tbody>
                {table.map((r, i) => (
                  <tr key={r.id}>
                    <td>{i + 1}</td>
                    <td><b>{r.name}</b></td>
                    <td>{r.played}</td>
                    <td>{r.wins}</td>
                    <td>{r.draws}</td>
                    <td>{r.losses}</td>
                    <td><b>{r.points}</b></td>
                    <td>{r.for - r.against}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="muted" style={{ marginTop: 10 }}>
            Points: Win {t.pointsWin}, Draw {t.pointsDraw}, Loss {t.pointsLoss}
          </div>
        </>
      )}
    </div>
  );
}

/* =========================================================
   Fixtures
========================================================= */
function Fixtures({ data, admin, commit }) {
  const tournaments = data.tournaments || [];
  const players = data.players || [];

  const [selectedId, setSelectedId] = useState(tournaments[0]?.id || "");
  const selected = tournaments.find((t) => t.id === selectedId) || null;

  const tournamentPlayers = useMemo(() => {
    if (!selected) return [];
    const ids = selected.participantIds?.length ? selected.participantIds : players.map((p) => p.id);
    const setIds = new Set(ids);
    return players.filter((p) => setIds.has(p.id));
  }, [selected, players]);

  function nameOf(pid) {
    return players.find((p) => p.id === pid)?.name || "Unknown";
  }

  function generate() {
    if (!admin) return alert("Admin only.");
    if (!selected) return;
    if (tournamentPlayers.length < 2) return alert("Need at least 2 players.");
    if (!confirm("Generate fixtures? Existing matches will be replaced.")) return;

    const matches = generateRoundRobin(tournamentPlayers.map((p) => p.id));
    commit({
      ...data,
      tournaments: tournaments.map((t) => (t.id === selected.id ? { ...t, matches } : t)),
    });
  }

  function updateMatch(mid, patch) {
    if (!admin) return;
    commit({
      ...data,
      tournaments: tournaments.map((t) => {
        if (t.id !== selected.id) return t;
        return {
          ...t,
          matches: (t.matches || []).map((m) => (m.id === mid ? { ...m, ...patch, updatedAt: Date.now() } : m)),
        };
      }),
    });
  }

  function markDone(m) {
    const s1 = Number(m.score1);
    const s2 = Number(m.score2);
    if (!Number.isFinite(s1) || !Number.isFinite(s2)) return alert("Enter numeric scores first.");
    updateMatch(m.id, { status: "done" });
  }

  return (
    <>
      <PageShell
        title="Fixtures"
        subtitle="Generate matchups and enter scores"
        right={
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
              {tournaments
                .slice()
                .sort((a, b) => (b.month || "").localeCompare(a.month || ""))
                .map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.month} • {t.name}
                  </option>
                ))}
            </select>
            {admin ? <button className="btn primary" onClick={generate}>Generate</button> : null}
          </div>
        }
      />

      <div className="container">
        <div className="card">
          {!selected ? (
            <div className="muted">Create a tournament first.</div>
          ) : (
            <>
              <div className="muted">Players: {tournamentPlayers.map((p) => p.name).join(", ") || "—"}</div>

              <div style={{ marginTop: 12 }}>
                {(selected.matches || []).length === 0 ? (
                  <div className="muted">No fixtures yet. {admin ? "Click Generate." : "Ask admin to generate."}</div>
                ) : (
                  <table>
                    <thead>
                      <tr>
                        <th>Round</th>
                        <th>Match</th>
                        <th>Score</th>
                        <th>Status</th>
                        {admin ? <th>Action</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {(selected.matches || []).slice().sort((a, b) => a.round - b.round).map((m) => (
                        <tr key={m.id}>
                          <td>{m.round}</td>
                          <td>{nameOf(m.p1)} vs {nameOf(m.p2)}</td>
                          <td style={{ width: 240 }}>
                            {admin ? (
                              <div className="row">
                                <input
                                  style={{ width: 80 }}
                                  value={m.score1}
                                  onChange={(e) => updateMatch(m.id, { score1: e.target.value })}
                                  placeholder="0"
                                />
                                <span className="muted">-</span>
                                <input
                                  style={{ width: 80 }}
                                  value={m.score2}
                                  onChange={(e) => updateMatch(m.id, { score2: e.target.value })}
                                  placeholder="0"
                                />
                              </div>
                            ) : (
                              <span className="muted">{m.score1 || "—"} - {m.score2 || "—"}</span>
                            )}
                          </td>
                          <td>
                            <span className="badge">
                              <span className={m.status === "done" ? "dot" : "dot red"} />
                              {m.status}
                            </span>
                          </td>
                          {admin ? (
                            <td>
                              {m.status !== "done" ? (
                                <button className="btn primary" onClick={() => markDone(m)}>Mark Done</button>
                              ) : (
                                <button className="btn" onClick={() => updateMatch(m.id, { status: "scheduled" })}>Reopen</button>
                              )}
                            </td>
                          ) : null}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

/* =========================================================
   Leaderboards (All tournaments + Active)
========================================================= */
function LeaderboardAll({ data }) {
  const tournaments = data.tournaments || [];
  const players = data.players || [];

  const [selectedId, setSelectedId] = useState(tournaments.slice().sort((a,b)=> (b.month||"").localeCompare(a.month||""))[0]?.id || "");
  const t = tournaments.find((x) => x.id === selectedId) || null;

  const tourPlayers = useMemo(() => {
    if (!t) return [];
    const ids = t.participantIds?.length ? t.participantIds : players.map((p) => p.id);
    const setIds = new Set(ids);
    return players.filter((p) => setIds.has(p.id));
  }, [t, players]);

  const table = useMemo(() => (t ? calcLeaderboard(tourPlayers, t) : []), [t, tourPlayers]);

  return (
    <>
      <PageShell
        title="Leaderboards"
        subtitle="Select any tournament to view standings"
        right={
          <select value={selectedId} onChange={(e) => setSelectedId(e.target.value)}>
            {tournaments
              .slice()
              .sort((a, b) => (b.month || "").localeCompare(a.month || ""))
              .map((x) => (
                <option key={x.id} value={x.id}>
                  {x.month} • {x.name}
                </option>
              ))}
          </select>
        }
      />

      <div className="container">
        <div className="card">
          {!t ? (
            <div className="muted">Create a tournament and fixtures first.</div>
          ) : (
            <>
              <div className="muted">{t.month} • {t.name}</div>
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
                      <th>Ag</th>
                      <th>Diff</th>
                    </tr>
                  </thead>
                  <tbody>
                    {table.map((r, i) => (
                      <tr key={r.id}>
                        <td>{i + 1}</td>
                        <td><b>{r.name}</b></td>
                        <td className="muted">{r.city || "-"}</td>
                        <td>{r.played}</td>
                        <td>{r.wins}</td>
                        <td>{r.draws}</td>
                        <td>{r.losses}</td>
                        <td><b>{r.points}</b></td>
                        <td>{r.for}</td>
                        <td>{r.against}</td>
                        <td>{r.for - r.against}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="muted" style={{ marginTop: 10 }}>
                Points: Win {t.pointsWin}, Draw {t.pointsDraw}, Loss {t.pointsLoss}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

/* =========================================================
   Hall of Fame (Add/Edit + Description + Photo upload)
========================================================= */
function HallOfFame({ data, admin, commit }) {
  const entries = data.hallOfFame?.entries || [];
  const players = data.players || [];
  const [fileTargetId, setFileTargetId] = useState(null);
  const fileRef = useRef(null);

  function addEntry() {
    if (!admin) return alert("Admin only");
    const title = prompt("Title:", "Top Performer");
    if (!title) return;
    const playerName = prompt("Player name:", players[0]?.name || "Player") || "Player";
    const month = prompt("Month (YYYY-MM):", monthKey());
    const stats = prompt("Stats (short):", "Pts 12 • W 4 • Best Break 42") || "";
    const description = prompt("Description:", "Champion of the month") || "";
    const e = {
      id: uid(),
      title: title.trim(),
      playerName: playerName.trim(),
      month: month || "",
      stats: stats.trim(),
      description: description.trim(),
      photo: "",
      createdAt: Date.now(),
    };
    commit({
      ...data,
      hallOfFame: { ...data.hallOfFame, entries: [e, ...entries] },
    });
  }

  function editEntry(e) {
    if (!admin) return;
    const title = prompt("Title:", e.title);
    if (!title) return;
    const playerName = prompt("Player name:", e.playerName);
    if (!playerName) return;
    const month = prompt("Month (YYYY-MM):", e.month || monthKey());
    const stats = prompt("Stats (short):", e.stats || "");
    const description = prompt("Description:", e.description || "");
    commit({
      ...data,
      hallOfFame: {
        ...data.hallOfFame,
        entries: entries.map((x) =>
          x.id === e.id
            ? { ...x, title: title.trim(), playerName: playerName.trim(), month: month || "", stats: stats || "", description: description || "" }
            : x
        ),
      },
    });
  }

  function removeEntry(id) {
    if (!admin) return;
    if (!confirm("Delete this Hall of Fame entry?")) return;
    commit({
      ...data,
      hallOfFame: { ...data.hallOfFame, entries: entries.filter((x) => x.id !== id) },
    });
  }

  async function uploadPhotoFor(id) {
    if (!admin) return;
    const f = fileRef.current?.files?.[0];
    if (!f) return alert("Choose a file first.");
    const dataUrl = await readFileAsDataURL(f);
    commit({
      ...data,
      hallOfFame: {
        ...data.hallOfFame,
        entries: entries.map((x) => (x.id === id ? { ...x, photo: dataUrl } : x)),
      },
    });
    fileRef.current.value = "";
    setFileTargetId(null);
  }

  return (
    <>
      <PageShell
        title="Hall of Fame"
        subtitle="Champions & Top Performers"
        right={admin ? <button className="btn primary" onClick={addEntry}>+ Add</button> : null}
      />

      <div className="container">
        {(entries.length === 0) ? (
          <div className="card">
            <div className="muted">No entries yet. {admin ? "Click + Add" : ""}</div>
          </div>
        ) : (
          <div className="grid">
            {entries.map((e) => (
              <div className="card cols-6" key={e.id}>
                <div className="row" style={{ justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                  <div>
                    <div className="cardTitle">{e.title}</div>
                    <div className="muted" style={{ marginTop: 6 }}>
                      <b>{e.playerName}</b> {e.month ? `• ${e.month}` : ""}
                    </div>
                  </div>
                  {admin ? (
                    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                      <button className="btn" onClick={() => editEntry(e)}>Edit</button>
                      <button className="btn danger" onClick={() => removeEntry(e.id)}>Delete</button>
                    </div>
                  ) : null}
                </div>

                <div className="grid" style={{ marginTop: 10, alignItems: "start" }}>
                  <div className="cols-5">
                    <div className="photoBox">
                      {e.photo ? <img src={e.photo} alt="hof" /> : <div className="muted">No photo</div>}
                    </div>
                    {admin ? (
                      <div style={{ marginTop: 10 }}>
                        {fileTargetId === e.id ? (
                          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                            <input ref={fileRef} type="file" accept="image/*" />
                            <button className="btn primary" onClick={() => uploadPhotoFor(e.id)}>Upload</button>
                            <button className="btn" onClick={() => setFileTargetId(null)}>Cancel</button>
                          </div>
                        ) : (
                          <button className="btn" onClick={() => setFileTargetId(e.id)}>Upload Photo</button>
                        )}
                      </div>
                    ) : null}
                  </div>

                  <div className="cols-7">
                    {e.stats ? <div className="badge"><span className="dot" /> {e.stats}</div> : null}
                    {e.description ? (
                      <div style={{ marginTop: 10 }}>
                        <div className="muted" style={{ fontSize: 13 }}>Description</div>
                        <div style={{ marginTop: 6 }}>{e.description}</div>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="muted" style={{ marginTop: 12, fontSize: 12 }}>
          Auto month-end “Top Performer” publishing needs a server (cron job). We’ll add it later using Vercel Cron / Firebase Functions.
        </div>
      </div>
    </>
  );
}

/* =========================================================
   TV Mode (Big screen)
========================================================= */
function TVMode({ data, activeTournament, players }) {
  const table = activeTournament ? calcLeaderboard(players || [], activeTournament) : [];
  const a = (data.announcements || [])[0]?.text || "Welcome to The Q CLUB";

  return (
    <div style={{ padding: 24, fontFamily: "Arial", color: "white" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 20, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 34, fontWeight: 900 }}>{data.club?.name || "The Q CLUB"}</div>
          <div style={{ opacity: 0.8 }}>{data.club?.location || "Pasighat"} • {data.club?.tagline || ""}</div>
        </div>
        <div style={{ fontSize: 18, opacity: 0.85 }}>
          <b>Announcement:</b> {a}
        </div>
      </div>

      <div style={{ marginTop: 18, border: "1px solid rgba(255,255,255,.15)", borderRadius: 16, padding: 16 }}>
        <div style={{ fontSize: 22, fontWeight: 800 }}>
          {activeTournament ? `${activeTournament.month} • ${activeTournament.name}` : "No tournament yet"}
        </div>

        {activeTournament ? (
          <table style={{ width: "100%", marginTop: 12, borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", opacity: 0.8 }}>
                <th style={{ padding: 10, borderBottom: "1px solid rgba(255,255,255,.12)" }}>#</th>
                <th style={{ padding: 10, borderBottom: "1px solid rgba(255,255,255,.12)" }}>Player</th>
                <th style={{ padding: 10, borderBottom: "1px solid rgba(255,255,255,.12)" }}>Pts</th>
                <th style={{ padding: 10, borderBottom: "1px solid rgba(255,255,255,.12)" }}>W</th>
                <th style={{ padding: 10, borderBottom: "1px solid rgba(255,255,255,.12)" }}>L</th>
                <th style={{ padding: 10, borderBottom: "1px solid rgba(255,255,255,.12)" }}>Diff</th>
              </tr>
            </thead>
            <tbody>
              {table.slice(0, 10).map((r, i) => (
                <tr key={r.id}>
                  <td style={{ padding: 10, borderBottom: "1px solid rgba(255,255,255,.08)" }}>{i + 1}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid rgba(255,255,255,.08)", fontWeight: 700 }}>
                    {r.name}
                  </td>
                  <td style={{ padding: 10, borderBottom: "1px solid rgba(255,255,255,.08)" }}>{r.points}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid rgba(255,255,255,.08)" }}>{r.wins}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid rgba(255,255,255,.08)" }}>{r.losses}</td>
                  <td style={{ padding: 10, borderBottom: "1px solid rgba(255,255,255,.08)" }}>{r.for - r.against}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ marginTop: 10, opacity: 0.85 }}>Create tournament → generate fixtures → enter scores.</div>
        )}
      </div>

      <div style={{ marginTop: 14, opacity: 0.8 }}>
        Tip: Keep this page open on your hall TV. It updates when you mark matches “done”.
      </div>
    </div>
  );
}

function NotFound() {
  return (
    <>
      <PageShell title="Not Found" subtitle="Use Home to navigate" />
      <div className="container">
        <div className="card">
          <div className="muted">Page not found.</div>
          <Link className="btn primary" to="/" style={{ marginTop: 10 }}>Go Home</Link>
        </div>
      </div>
    </>
  );
} 