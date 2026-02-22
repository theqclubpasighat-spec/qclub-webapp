import React, { useMemo, useState } from "react";
import { Routes, Route, Link, useNavigate, useLocation } from "react-router-dom";
import { QRCodeCanvas } from "qrcode.react";

/* ---------------------------
   LocalStorage mini database
---------------------------- */
const LS_KEY = "qclub_v3_data";

function uid() {
  return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function monthISO() {
  return new Date().toISOString().slice(0, 7);
}

function defaultData() {
  const now = Date.now();
  return {
    club: {
      name: "The Q CLUB",
      location: "Pasighat",
      tagline: "Play. Chill. Compete.",
      contact: { phone1: "7005212774", phone2: "7085221922" },
      upiId: "yomsoji-1@okicici",
      payeeName: "The Q CLUB",
    },
    ui: { publicMode: false }, // hides admin controls without logging out
    admin: { pin: "1234" }, // change after first login
    announcements: [
      { id: uid(), text: "Monthly tournaments every month 🔥 Register at counter.", createdAt: now },
    ],
    memberships: [
      {
        id: uid(),
        name: "₹1000 / Month Plan",
        perks: ["1 game free per day", "10 min massage chair/day", "1 tea/coffee/day", "unlimited water"],
        note: "Non-transferable",
      },
      {
        id: uid(),
        name: "Hourly Tables",
        perks: ["2 × 12x6 tables: ₹300/hr", "Other tables: ₹200/hr"],
        note: "Subject to availability",
      },
    ],
    offers: [
      { id: uid(), title: "Massage Chair", price: "₹10 / minute", details: "Pay at counter (UPI integration later)." },
      { id: uid(), title: "Foosball", price: "₹50 / game", details: "Best of 3 fun matches." },
      { id: uid(), title: "Air Hockey", price: "₹50 / game", details: "Fast rounds — winner stays!" },
      { id: uid(), title: "Tea/Coffee Vending", price: "₹10–₹20", details: "Self-serve vending." },
    ],
    photos: [
      {
        id: uid(),
        url: "https://images.unsplash.com/photo-1546443046-ed1ce6ffd1a9?auto=format&fit=crop&w=1200&q=70",
        caption: "Tournament night vibes",
      },
      {
        id: uid(),
        url: "https://images.unsplash.com/photo-1529692236671-f1f6cf9683ba?auto=format&fit=crop&w=1200&q=70",
        caption: "Practice & coaching sessions",
      },
    ],
    players: [
      { id: uid(), name: "Wilson", city: "Pasighat", photoUrl: "", bestBreak: 0 },
      { id: uid(), name: "Riku", city: "Pasighat", photoUrl: "", bestBreak: 0 },
      { id: uid(), name: "Tani", city: "Aalo", photoUrl: "", bestBreak: 0 },
      { id: uid(), name: "Bikash", city: "Roing", photoUrl: "", bestBreak: 0 },
    ],
    tournaments: [
      {
        id: uid(),
        name: "Monthly Snooker Cup",
        month: monthISO(),
        game: "Snooker",
        format: "Round Robin",
        pointsWin: 3,
        pointsDraw: 1,
        pointsLoss: 0,
        participantIds: [], // empty = all players
        matches: [],
      },
    ],
    booking: {
      tables: [
        { id: "S1", name: "Snooker 12x6 - Table 1", rate: 300 },
        { id: "S2", name: "Snooker 12x6 - Table 2", rate: 300 },
        { id: "S3", name: "Snooker 10x5", rate: 200 },
        { id: "P1", name: "Pool Table", rate: 200 },
        { id: "AH", name: "Air Hockey", rate: 50 },
        { id: "FB", name: "Foosball", rate: 50 },
        { id: "MC", name: "Massage Chair", rate: 10 }, // per minute in real life
      ],
      bookings: [
        // {id, tableId, date, start, end, customer, phone, notes, status: 'hold'|'paid'|'cancelled'}
      ],
    },
    payments: {
      // {id, date, amount, method, note, bookingId?}
      receipts: [],
    },
    hallOfFame: {
      // month -> array of {playerId, label, points}
      months: [],
    },
  };
}

function loadData() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return defaultData();
    const parsed = JSON.parse(raw);
    // soft migrations
    if (!parsed.ui) parsed.ui = { publicMode: false };
    if (!parsed.booking) parsed.booking = defaultData().booking;
    if (!parsed.payments) parsed.payments = { receipts: [] };
    if (!parsed.hallOfFame) parsed.hallOfFame = { months: [] };
    if (!parsed.club?.upiId) parsed.club.upiId = "yourupi@bank";
    return parsed;
  } catch {
    return defaultData();
  }
}

function saveData(data) {
  localStorage.setItem(LS_KEY, JSON.stringify(data));
}

/* ---------------------------
   Booking + Payments helpers
---------------------------- */
function computeBookingAmount(tableId, startHHMM, endHHMM, tables) {
  const t = (tables || []).find((x) => x.id === tableId);
  if (!t) return 0;

  const [sh, sm] = String(startHHMM || "00:00").split(":").map(Number);
  const [eh, em] = String(endHHMM || "00:00").split(":").map(Number);
  const start = sh * 60 + (sm || 0);
  const end = eh * 60 + (em || 0);
  const mins = Math.max(0, end - start);

  // Pricing rule (from your earlier plan):
  // - 12x6 tables = ₹300/hr
  // - other tables = ₹200/hr
  const ratePerHour = t.type === "snooker12" ? 300 : 200;
  const hours = mins / 60;
  return Math.max(0, Math.round(ratePerHour * hours));
}

function buildUpiUrl({ vpa, payeeName, amount, note }) {
  const params = new URLSearchParams();
  params.set("pa", vpa || "");
  params.set("pn", payeeName || "The Q CLUB");
  params.set("am", String(amount || 0));
  params.set("cu", "INR");
  if (note) params.set("tn", note);
  // Works on most Android UPI apps:
  return `upi://pay?${params.toString()}`;
}

function clampText(s, n = 60) {
  const x = String(s || "");
  return x.length > n ? x.slice(0, n - 1) + "…" : x;
}

/* ---------------------------
   Fixtures: Round Robin
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
   Leaderboard calculation
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
   Booking helpers
---------------------------- */
function toMinutes(hhmm) {
  // "17:30" => 1050
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || "").trim());
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  if (hh < 0 || hh > 23 || mm < 0 || mm > 59) return null;
  return hh * 60 + mm;
}
function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/* ---------------------------
   App
---------------------------- */
export default function App() {
  const [data, setData] = useState(loadData());
  const [admin, setAdmin] = useState(false);
  const navigate = useNavigate();

  function commit(next) {
    setData(next);
    saveData(next);
  }

  const isAdminUI = admin && !data.ui?.publicMode;

  const activeTournament = useMemo(() => {
    const t = [...(data.tournaments || [])]
      .sort((a, b) => (a.month || "").localeCompare(b.month || ""))
      .pop();
    return t || null;
  }, [data.tournaments]);

  const playersForActive = useMemo(() => {
    if (!activeTournament) return data.players || [];
    const ids = activeTournament.participantIds?.length
      ? activeTournament.participantIds
      : (data.players || []).map((p) => p.id);
    const setIds = new Set(ids);
    return (data.players || []).filter((p) => setIds.has(p.id));
  }, [data.players, activeTournament]);

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

  function togglePublicMode() {
    if (!admin) return alert("Admin only.");
    commit({ ...data, ui: { ...(data.ui || {}), publicMode: !data.ui?.publicMode } });
  }

  return (
    <>
      <TopNav club={data.club} admin={admin} onToggleAdmin={toggleAdmin} onChangePin={changePin} onReset={resetAll} />
      <AudioDock />

      <Routes>
        <Route path="/" element={<Home data={data} activeTournament={activeTournament} isAdminUI={isAdminUI} commit={commit} />} />
        <Route path="/membership" element={<Membership data={data} isAdminUI={isAdminUI} commit={commit} />} />
        <Route path="/offers" element={<Offers data={data} isAdminUI={isAdminUI} commit={commit} />} />
        <Route path="/photos" element={<Photos data={data} isAdminUI={isAdminUI} commit={commit} />} />
        <Route path="/players" element={<Players data={data} isAdminUI={isAdminUI} commit={commit} />} />
        <Route path="/tournaments" element={<Tournaments data={data} isAdminUI={isAdminUI} commit={commit} />} />
        <Route path="/fixtures" element={<Fixtures data={data} isAdminUI={isAdminUI} commit={commit} />} />
        <Route path="/leaderboard" element={<Leaderboard data={data} activeTournament={activeTournament} playersForActive={playersForActive} />} />
        <Route path="/booking" element={<Booking data={data} admin={isAdminUI} commit={commit} />} />
        <Route path="/pay" element={<Pay data={data} admin={isAdminUI} commit={commit} />} />
        <Route path="/halloffame" element={<HallOfFame data={data} activeTournament={activeTournament} playersForActive={playersForActive} isAdminUI={isAdminUI} commit={commit} />} />
        <Route path="/tv" element={<TVMode data={data} activeTournament={activeTournament} playersForActive={playersForActive} />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
      <BottomNav admin={isAdminUI} />
    </>
  );
}

/* ---------------------------
   Nav
---------------------------- */
function TopNav({ club, admin, onToggleAdmin, onChangePin, onReset }) {
  const [open, setOpen] = useState(false);

  const links = [
    { to: "/", label: "Home" },
    { to: "/membership", label: "Membership" },
    { to: "/offers", label: "Offers" },
    { to: "/photos", label: "Photos" },
    { to: "/players", label: "Players" },
    { to: "/tournaments", label: "Tournaments" },
    { to: "/fixtures", label: "Fixtures" },
    { to: "/leaderboard", label: "Leaderboard" },
    { to: "/booking", label: "Booking" },
    { to: "/pay", label: "Pay" },
    { to: "/halloffame", label: "Hall of Fame" },
    { to: "/tv", label: "TV" },
  ];

  function close() {
    setOpen(false);
  }

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

        <div className="nav-links">
          {links.map((l) => (
            <Link key={l.to} className="pill" to={l.to}>
              {l.label}
            </Link>
          ))}
        </div>

        <div className="nav-actions">
          <button className={"btn " + (admin ? "success" : "primary")} onClick={onToggleAdmin}>
            {admin ? "Admin: ON" : "Admin Login"}
          </button>
          {admin && (
            <>
              <button className="btn" onClick={onChangePin}>Change PIN</button>
              <button className="btn danger" onClick={onReset}>Reset</button>
            </>
          )}

          <button className="btn icon" onClick={() => setOpen((s) => !s)} aria-label="Menu">
            ☰
          </button>
        </div>
      </div>

      {open && (
        <div className="drawer" role="dialog" aria-modal="true" onClick={close}>
          <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div style={{ fontWeight: 900 }}>{club?.name || "The Q CLUB"}</div>
              <button className="btn icon" onClick={close} aria-label="Close">✕</button>
            </div>

            <div style={{ marginTop: 10 }}>
              {links.map((l) => (
                <Link key={l.to} className="drawer-link" to={l.to} onClick={close}>
                  {l.label}
                </Link>
              ))}
            </div>

            <div style={{ marginTop: 14 }}>
              <button className={"btn " + (admin ? "success" : "primary")} onClick={() => { close(); onToggleAdmin(); }}>
                {admin ? "Admin: ON" : "Admin Login"}
              </button>
              {admin && (
                <div className="row" style={{ marginTop: 10 }}>
                  <button className="btn" onClick={() => { close(); onChangePin(); }}>Change PIN</button>
                  <button className="btn danger" onClick={() => { close(); onReset(); }}>Reset</button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


function Home({ data, activeTournament, isAdminUI, commit }) {
  const phone = [data.club?.contact?.phone1, data.club?.contact?.phone2].filter(Boolean).join(" / ");
  const nextT = activeTournament ? `${activeTournament.month} • ${activeTournament.name}` : "—";

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

  return (
    <div className="container">
      <div className="grid">
        <div className="card cols-8">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <span className="badge"><span className="dot" /> Open Today</span>
            <span className="badge"><span className="dot red" /> UPI payments: ready on Pay page</span>
          </div>

          <h1>Welcome to {data.club?.name || "The Q CLUB"}</h1>
          <div className="muted">
            Snooker • Pool • Air Hockey • Foosball • Massage Chair • Tea/Coffee Vending • Monthly Tournaments • Leaderboards
          </div>

          <div className="kpi">
            <div className="chip">
              <div className="muted">Location</div>
              <div style={{ fontSize: 18, fontWeight: 900 }}>{data.club?.location || "—"}</div>
            </div>
            <div className="chip">
              <div className="muted">Contact</div>
              <div style={{ fontSize: 18, fontWeight: 900 }}>{phone || "—"}</div>
            </div>
            <div className="chip">
              <div className="muted">Next Tournament</div>
              <div style={{ fontSize: 16, fontWeight: 900 }}>{nextT}</div>
            </div>
          </div>

          <div className="hr" />
          <h2>Cool Things</h2>
          <div className="row">
            <span className="badge"><span className="dot" /> Booking system</span>
            <span className="badge"><span className="dot" /> Pay screen (UPI placeholder)</span>
            <span className="badge"><span className="dot" /> Player profiles</span>
            <span className="badge"><span className="dot" /> Hall of Fame</span>
            <span className="badge"><span className="dot" /> TV mode</span>
            <span className="badge"><span className="dot warn" /> Public mode toggle</span>
          </div>
        </div>

        <div className="card cols-4">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2>Announcements</h2>
            {isAdminUI && <button className="btn primary" onClick={addAnnouncement}>+ Add</button>}
          </div>

          <div style={{ marginTop: 10 }}>
            {(data.announcements || []).length === 0 ? (
              <div className="muted">No announcements.</div>
            ) : (
              (data.announcements || []).slice(0, 6).map((a) => (
                <div className="card small" key={a.id} style={{ marginBottom: 10 }}>
                  <div className="muted" style={{ fontSize: 12 }}>
                    {new Date(a.createdAt).toLocaleString()}
                  </div>
                  <div style={{ marginTop: 6 }}>{a.text}</div>
                  {isAdminUI && (
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
          <h2>How to run a monthly tournament</h2>
          <div className="muted">
            1) Add players → 2) Create tournament → 3) Generate fixtures → 4) Enter scores → 5) Leaderboard updates.
            Then use Hall of Fame to save the top players for the month.
          </div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------
   Membership CRUD
---------------------------- */
function Membership({ data, isAdminUI, commit }) {
  const list = data.memberships || [];

  function add() {
    const name = prompt("Plan name:");
    if (!name) return;
    const perks = prompt("Perks (comma separated):", "1 game free/day, Unlimited water");
    const note = prompt("Note (optional):", "Non-transferable");
    commit({
      ...data,
      memberships: [
        ...list,
        {
          id: uid(),
          name,
          perks: (perks || "").split(",").map((s) => s.trim()).filter(Boolean),
          note: note || "",
        },
      ],
    });
  }

  function remove(id) {
    if (!confirm("Delete this plan?")) return;
    commit({ ...data, memberships: list.filter((x) => x.id !== id) });
  }

  return (
    <div className="container">
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>Membership Offers</h2>
          {isAdminUI && <button className="btn primary" onClick={add}>+ Add Plan</button>}
        </div>

        <div className="grid">
          {list.map((m) => (
            <div className="card small cols-6" key={m.id}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <h3>{m.name}</h3>
                {isAdminUI && <button className="btn danger" onClick={() => remove(m.id)}>Delete</button>}
              </div>
              <ul className="muted" style={{ marginTop: 6, paddingLeft: 18 }}>
                {(m.perks || []).map((p, i) => <li key={i}>{p}</li>)}
              </ul>
              {m.note ? <div className="badge" style={{ marginTop: 10 }}><span className="dot" /> {m.note}</div> : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------
   Offers CRUD
---------------------------- */
function Offers({ data, isAdminUI, commit }) {
  const list = data.offers || [];

  function add() {
    const title = prompt("Offer title:");
    if (!title) return;
    const price = prompt("Price:", "₹");
    const details = prompt("Details:", "Pay at counter for now");
    commit({ ...data, offers: [...list, { id: uid(), title, price: price || "", details: details || "" }] });
  }

  function remove(id) {
    if (!confirm("Delete this offer?")) return;
    commit({ ...data, offers: list.filter((x) => x.id !== id) });
  }

  return (
    <div className="container">
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>Other Offers</h2>
          {isAdminUI && <button className="btn primary" onClick={add}>+ Add Offer</button>}
        </div>

        <div className="grid">
          {list.map((o) => (
            <div className="card small cols-4" key={o.id}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <h3>{o.title}</h3>
                {isAdminUI && <button className="btn danger" onClick={() => remove(o.id)}>Delete</button>}
              </div>
              <div className="badge"><span className="dot" /> {o.price}</div>
              <div className="muted" style={{ marginTop: 10 }}>{o.details}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------
   Photos CRUD (URLs)
---------------------------- */
function Photos({ data, isAdminUI, commit }) {
  const list = data.photos || [];

  function add() {
    const url = prompt("Photo URL (for now use image link):");
    if (!url) return;
    const caption = prompt("Caption:", "Q Club vibes");
    commit({ ...data, photos: [...list, { id: uid(), url, caption: caption || "" }] });
  }

  function remove(id) {
    if (!confirm("Delete this photo?")) return;
    commit({ ...data, photos: list.filter((x) => x.id !== id) });
  }

  return (
    <div className="container">
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>Club Photos</h2>
          {isAdminUI && <button className="btn primary" onClick={add}>+ Add Photo</button>}
        </div>

        <div className="gallery" style={{ marginTop: 14 }}>
          {list.map((p) => (
            <div className="photo" key={p.id}>
              <img src={p.url} alt={p.caption || "photo"} />
              <div className="cap">
                {p.caption || "—"}
                {isAdminUI && (
                  <div style={{ marginTop: 8 }}>
                    <button className="btn danger" onClick={() => remove(p.id)}>Delete</button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="muted" style={{ marginTop: 14 }}>
          Upgrade later: real uploads (so you don’t need URLs).
        </div>
      </div>
    </div>
  );
}

/* ---------------------------
   Players (profiles + stats)
---------------------------- */
function Players({ data, isAdminUI, commit }) {
  const players = data.players || [];

  function addPlayer() {
    const name = prompt("Player name:");
    if (!name) return;
    const city = prompt("City (optional):", "Pasighat") || "";
    commit({ ...data, players: [...players, { id: uid(), name, city, photoUrl: "", bestBreak: 0 }] });
  }

  function removePlayer(id) {
    if (!confirm("Delete player? Tournament fixtures may be affected.")) return;
    commit({ ...data, players: players.filter((p) => p.id !== id) });
  }

  function editPlayer(p) {
    const city = prompt("City:", p.city || "") ?? p.city;
    const photoUrl = prompt("Photo URL (optional):", p.photoUrl || "") ?? p.photoUrl;
    const bestBreak = prompt("Best Break (number):", String(p.bestBreak || 0));
    const bb = Number(bestBreak);
    commit({
      ...data,
      players: players.map((x) =>
        x.id === p.id ? { ...x, city, photoUrl, bestBreak: Number.isFinite(bb) ? bb : x.bestBreak } : x
      ),
    });
  }

  return (
    <div className="container">
      <div className="grid">
        <div className="card cols-12">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2>Players</h2>
            {isAdminUI && <button className="btn primary" onClick={addPlayer}>+ Add Player</button>}
          </div>

          {players.length === 0 ? (
            <div className="muted">No players yet.</div>
          ) : (
            <table style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th>Player</th>
                  <th>City</th>
                  <th>Best Break</th>
                  <th>Photo</th>
                  {isAdminUI && <th>Action</th>}
                </tr>
              </thead>
              <tbody>
                {players.map((p) => (
                  <tr key={p.id}>
                    <td><b>{p.name}</b></td>
                    <td className="muted">{p.city || "-"}</td>
                    <td>{p.bestBreak || 0}</td>
                    <td className="muted">{p.photoUrl ? "Yes" : "No"}</td>
                    {isAdminUI && (
                      <td>
                        <button className="btn" onClick={() => editPlayer(p)} style={{ marginRight: 8 }}>Edit</button>
                        <button className="btn danger" onClick={() => removePlayer(p.id)}>Delete</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {!isAdminUI && <div className="muted" style={{ marginTop: 10 }}>Admin can add/edit players.</div>}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------
   Tournaments
---------------------------- */
function Tournaments({ data, isAdminUI, commit }) {
  const tournaments = data.tournaments || [];
  const players = data.players || [];

  function addTournament() {
    const name = prompt("Tournament name:", "Monthly Snooker Cup");
    if (!name) return;
    const month = prompt("Month (YYYY-MM):", monthISO()) || "";
    const game = prompt("Game (Snooker/Pool/etc):", "Snooker") || "";
    commit({
      ...data,
      tournaments: [
        ...tournaments,
        {
          id: uid(),
          name,
          month,
          game,
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
    if (!confirm("Delete tournament and its matches?")) return;
    commit({ ...data, tournaments: tournaments.filter((t) => t.id !== id) });
  }

  function setParticipants(t) {
    const names = players.map((p) => p.name).join(", ");
    const help = "Type player names separated by commas (leave empty for ALL players).";
    const input = prompt(`${help}\n\nAvailable:\n${names}`, "");
    if (input === null) return;
    const cleaned = input.split(",").map((s) => s.trim()).filter(Boolean);
    if (cleaned.length === 0) {
      commit({ ...data, tournaments: tournaments.map((x) => (x.id === t.id ? { ...x, participantIds: [] } : x)) });
      return;
    }
    const matchedIds = players.filter((p) => cleaned.some((n) => n.toLowerCase() === p.name.toLowerCase())).map((p) => p.id);
    commit({ ...data, tournaments: tournaments.map((x) => (x.id === t.id ? { ...x, participantIds: matchedIds } : x)) });
  }

  return (
    <div className="container">
      <div className="grid">
        <div className="card cols-12">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2>Monthly Tournaments</h2>
            {isAdminUI && <button className="btn primary" onClick={addTournament}>+ New Tournament</button>}
          </div>

          {tournaments.length === 0 ? (
            <div className="muted">No tournaments yet.</div>
          ) : (
            <table style={{ marginTop: 10 }}>
              <thead>
                <tr>
                  <th>Month</th>
                  <th>Name</th>
                  <th>Game</th>
                  <th>Players</th>
                  <th>Matches</th>
                  {isAdminUI && <th>Action</th>}
                </tr>
              </thead>
              <tbody>
                {tournaments
                  .slice()
                  .sort((a, b) => (b.month || "").localeCompare(a.month || ""))
                  .map((t) => (
                    <tr key={t.id}>
                      <td>{t.month}</td>
                      <td><b>{t.name}</b></td>
                      <td className="muted">{t.game}</td>
                      <td className="muted">{t.participantIds?.length ? t.participantIds.length : "All"}</td>
                      <td>{(t.matches || []).length}</td>
                      {isAdminUI && (
                        <td>
                          <button className="btn" onClick={() => setParticipants(t)} style={{ marginRight: 8 }}>Set Players</button>
                          <button className="btn danger" onClick={() => removeTournament(t.id)}>Delete</button>
                        </td>
                      )}
                    </tr>
                  ))}
              </tbody>
            </table>
          )}

          {!isAdminUI && <div className="muted" style={{ marginTop: 10 }}>Admin can create/edit tournaments.</div>}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------
   Fixtures + Score entry
---------------------------- */
function Fixtures({ data, isAdminUI, commit }) {
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
    commit({
      ...data,
      tournaments: tournaments.map((t) => {
        if (!selected || t.id !== selected.id) return t;
        return { ...t, matches: (t.matches || []).map((m) => (m.id === mid ? { ...m, ...patch } : m)) };
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
    <div className="container">
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>Fixtures</h2>
          <div className="row">
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
            {isAdminUI && <button className="btn primary" onClick={generate}>Generate Round Robin</button>}
          </div>
        </div>

        {!selected ? (
          <div className="muted">Create a tournament first.</div>
        ) : (
          <>
            <div className="muted">Players: {tournamentPlayers.map((p) => p.name).join(", ") || "—"}</div>

            <div style={{ marginTop: 12 }}>
              {(selected.matches || []).length === 0 ? (
                <div className="muted">No fixtures yet. {isAdminUI ? "Click Generate." : "Ask admin to generate."}</div>
              ) : (
                <table>
                  <thead>
                    <tr>
                      <th>Round</th>
                      <th>Match</th>
                      <th>Score</th>
                      <th>Status</th>
                      {isAdminUI && <th>Action</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {(selected.matches || []).slice().sort((a, b) => a.round - b.round).map((m) => (
                      <tr key={m.id}>
                        <td>{m.round}</td>
                        <td>{nameOf(m.p1)} vs {nameOf(m.p2)}</td>
                        <td style={{ width: 260 }}>
                          {isAdminUI ? (
                            <div className="row">
                              <input
                                style={{ width: 88 }}
                                value={m.score1}
                                onChange={(e) => updateMatch(m.id, { score1: e.target.value })}
                                placeholder="0"
                              />
                              <span className="muted">-</span>
                              <input
                                style={{ width: 88 }}
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
                        {isAdminUI && (
                          <td>
                            {m.status !== "done" ? (
                              <button className="btn primary" onClick={() => markDone(m)}>Mark Done</button>
                            ) : (
                              <button className="btn" onClick={() => updateMatch(m.id, { status: "scheduled" })}>Reopen</button>
                            )}
                          </td>
                        )}
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
  );
}

/* ---------------------------
   Leaderboard
---------------------------- */
function Leaderboard({ data, activeTournament, playersForActive }) {
  if (!activeTournament) {
    return (
      <div className="container">
        <div className="card">
          <h2>Leaderboard</h2>
          <div className="muted">Create a tournament and fixtures first.</div>
        </div>
      </div>
    );
  }

  const table = calcLeaderboard(playersForActive, activeTournament);

  return (
    <div className="container">
      <div className="grid">
        <div className="card cols-9">
          <h2>Leaderboard</h2>
          <div className="muted">{activeTournament.month} • {activeTournament.name}</div>

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
            Points: Win {activeTournament.pointsWin}, Draw {activeTournament.pointsDraw}, Loss {activeTournament.pointsLoss}
          </div>
        </div>

        <div className="card cols-3">
          <h3>Tip</h3>
          <div className="muted">
            Mark matches “done” in Fixtures and the leaderboard updates instantly.
          </div>
          <div className="hr" />
          <h3>Next</h3>
          <div className="muted">Go to Hall of Fame to save top players for the month.</div>
        </div>
      </div>
    </div>
  );
}

/* ---------------------------
   Booking
---------------------------- */
function Booking({ data, admin, commit }) {
  const navigate = useNavigate();
  const cfg = data.booking || {};
  const tables = cfg.tables || [];
  const bookings = cfg.bookings || [];

  const today = new Date().toISOString().slice(0, 10);
  const [date, setDate] = useState(today);
  const [tableId, setTableId] = useState(tables[0]?.id || "");
  const [start, setStart] = useState("17:00");
  const [end, setEnd] = useState("18:00");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState(localStorage.getItem("qclub_phone") || "");
  const [note, setNote] = useState("");

  const myPhone = phone.trim();

  const visibleBookings = useMemo(() => {
    const list = (bookings || []).filter((b) => b.date === date);
    const sorted = list.slice().sort((a, b) => (a.start || "").localeCompare(b.start || ""));
    if (admin) return sorted;
    if (!myPhone) return [];
    return sorted.filter((b) => String(b.customerPhone || "").trim() === myPhone);
  }, [bookings, date, admin, myPhone]);

  function parseMin(hhmm) {
    const [h, m] = String(hhmm || "0:0").split(":").map((x) => Number(x));
    if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
    return h * 60 + m;
  }
  function overlaps(aS, aE, bS, bE) {
    const as = parseMin(aS), ae = parseMin(aE), bs = parseMin(bS), be = parseMin(bE);
    return Math.max(as, bs) < Math.min(ae, be);
  }
  function calcAmount(t, s, e) {
    const minutes = Math.max(0, parseMin(e) - parseMin(s));
    const rate = Number(t?.rate) || 0;
    const type = t?.type || "hour";
    if (type === "minute") return Math.round(rate * minutes);
    if (type === "game") return rate;
    return Math.round((rate * minutes) / 60);
  }

  function createBooking() {
    if (!tableId) return alert("Select a table.");
    if (!name.trim()) return alert("Enter your name.");
    if (!myPhone) return alert("Enter phone.");
    if (parseMin(end) <= parseMin(start)) return alert("End time must be after start.");

    const t = tables.find((x) => x.id === tableId);
    if (!t) return alert("Invalid table.");

    const clash = bookings.some((b) =>
      b.date === date &&
      b.tableId === tableId &&
      b.status !== "cancelled" &&
      overlaps(start, end, b.start, b.end)
    );
    if (clash) return alert("Slot already booked.");

    const amount = calcAmount(t, start, end);
    const id = uid();
    const booking = {
      id,
      date,
      tableId,
      start,
      end,
      customerName: name.trim(),
      customerPhone: myPhone,
      note: note.trim(),
      amount,
      status: "hold",
      createdAt: Date.now(),
    };

    localStorage.setItem("qclub_phone", myPhone);
    commit({ ...data, booking: { ...cfg, bookings: [booking, ...bookings] } });
    navigate(`/pay?bid=${encodeURIComponent(id)}`);
  }

  function setStatus(id, status) {
    if (!admin) return;
    commit({
      ...data,
      booking: { ...cfg, bookings: bookings.map((b) => (b.id === id ? { ...b, status } : b)) },
    });
  }

  return (
    <div className="container">
      <div className="grid">
        <div className="card cols-4">
          <h2>Book a Table</h2>
          <div className="muted">Choose slot → Pay on next screen.</div>

          <div className="form" style={{ marginTop: 12 }}>
            <label className="lbl">Date</label>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />

            <label className="lbl">Table</label>
            <select value={tableId} onChange={(e) => setTableId(e.target.value)}>
              {tables.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label} • ₹{t.rate}/{t.type === "minute" ? "min" : t.type === "game" ? "game" : "hr"}
                </option>
              ))}
            </select>

            <div className="row" style={{ gap: 10 }}>
              <div style={{ flex: 1 }}>
                <label className="lbl">Start</label>
                <input type="time" value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              <div style={{ flex: 1 }}>
                <label className="lbl">End</label>
                <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>
            </div>

            <label className="lbl">Name</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />

            <label className="lbl">Phone</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit mobile" />

            <label className="lbl">Note (optional)</label>
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g., coaching" />

            <button className="btn primary" onClick={createBooking}>Book & Pay</button>

            <div className="muted" style={{ marginTop: 10, fontSize: 13 }}>
              Your bookings show for this phone number.
            </div>
          </div>
        </div>

        <div className="card cols-8">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2>{admin ? "Bookings" : "My Bookings"} • {date}</h2>
            <div className="badge">
              <span className="dot" /> {visibleBookings.filter((b) => b.status !== "cancelled").length} active
            </div>
          </div>

          {!admin && <div className="muted" style={{ marginTop: 6 }}>Phone: <b>{myPhone || "—"}</b></div>}

          <div style={{ marginTop: 12 }}>
            {visibleBookings.length === 0 ? (
              <div className="muted">No bookings for this date.</div>
            ) : (
              <table className="table">
                <thead>
                  <tr>
                    <th>Table</th>
                    <th>Time</th>
                    <th>Customer</th>
                    <th>Status</th>
                    <th>Amount</th>
                    {admin && <th>Action</th>}
                  </tr>
                </thead>
                <tbody>
                  {visibleBookings.map((b) => {
                    const t = tables.find((x) => x.id === b.tableId);
                    return (
                      <tr key={b.id}>
                        <td>{t?.label || b.tableId}</td>
                        <td>{b.start} - {b.end}</td>
                        <td>{b.customerName}</td>
                        <td>
                          <span className="badge">
                            <span className={b.status === "paid" ? "dot" : b.status === "payment_submitted" ? "dot" : "dot amber"} />
                            {b.status}
                          </span>
                        </td>
                        <td>₹{Number(b.amount || 0)}</td>
                        {admin && (
                          <td>
                            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                              <button className="btn" onClick={() => setStatus(b.id, "hold")}>Hold</button>
                              <button className="btn primary" onClick={() => setStatus(b.id, "paid")}>Paid</button>
                              <button className="btn danger" onClick={() => setStatus(b.id, "cancelled")}>Cancel</button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div className="muted" style={{ marginTop: 10 }}>
            Status: <b>hold</b> = reserved • <b>payment_submitted</b> = customer paid • <b>paid</b> = confirmed.
          </div>
        </div>
      </div>
    </div>
  );
}


function Pay({ data, admin, commit }) {
  const loc = useLocation();
  const params = new URLSearchParams(loc.search);
  const bid = params.get("bid") || "";

  const cfg = data.booking || {};
  const tables = cfg.tables || [];
  const bookings = cfg.bookings || [];

  const booking = useMemo(() => bookings.find((b) => String(b.id) === String(bid)) || null, [bookings, bid]);
  const table = booking ? tables.find((t) => t.id === booking.tableId) : null;

  const upiId = data.club?.upiId || "yomsoji-1@okicici";
  const payeeName = data.club?.name || "The Q CLUB";
  const amount = Number(booking?.amount || 0);
  const note = booking ? `${booking.customerName} • ${table?.label || booking.tableId} • ${booking.date} ${booking.start}-${booking.end}` : "Q Club booking";

  const upiLink = useMemo(() => {
    const qs = new URLSearchParams({ pa: upiId, pn: payeeName, am: String(amount || 0), cu: "INR", tn: note });
    return `upi://pay?${qs.toString()}`;
  }, [upiId, payeeName, amount, note]);

  function updateBooking(id, patch) {
    commit({ ...data, booking: { ...cfg, bookings: bookings.map((b) => (b.id === id ? { ...b, ...patch } : b)) } });
  }

  function markPaymentSubmitted() {
    if (!booking) return;
    updateBooking(booking.id, { status: booking.status === "paid" ? "paid" : "payment_submitted", paidAt: Date.now() });
    alert("Marked as paid (pending verification).");
  }

  function setStatus(status) {
    if (!admin || !booking) return;
    updateBooking(booking.id, { status });
  }

  function copyUpi() {
    navigator.clipboard?.writeText(upiId);
    alert("UPI ID copied.");
  }

  return (
    <div className="container">
      <div className="grid">
        <div className="card cols-6">
          <h2>Pay (UPI)</h2>

          {!booking ? (
            <div className="muted">Open Pay from <b>Booking → Book & Pay</b>.</div>
          ) : (
            <>
              <div className="muted" style={{ marginTop: 6 }}>
                Booking: <b>{table?.label || booking.tableId}</b> • {booking.date} • {booking.start}-{booking.end}
              </div>

              <div className="kpi" style={{ marginTop: 12 }}>
                <div className="chip">
                  <div className="muted">Amount</div>
                  <div style={{ fontSize: 22, fontWeight: 900 }}>₹{amount}</div>
                </div>
                <div className="chip">
                  <div className="muted">Status</div>
                  <div style={{ fontSize: 18, fontWeight: 900 }}>{booking.status}</div>
                </div>
              </div>

              <div style={{ marginTop: 14 }} className="row">
                <div className="badge"><span className="dot" /> UPI ID: <b style={{ marginLeft: 6 }}>{upiId}</b></div>
                <button className="btn" onClick={copyUpi}>Copy</button>
              </div>

              <div className="payGrid" style={{ marginTop: 14 }}>
                <div className="payQr">
                  <div className="muted" style={{ marginBottom: 8 }}>Scan QR in any UPI app</div>
                  <div className="qrBox">
                    <QRCodeCanvas value={upiLink} size={220} />
                  </div>
                </div>

                <div className="payActions">
                  <div className="muted">Or tap below to open UPI directly (phones):</div>
                  <a className="btn primary" href={upiLink}>Open UPI to Pay</a>

                  <button className="btn" style={{ marginTop: 10 }} onClick={markPaymentSubmitted}>I have paid</button>

                  <div className="muted" style={{ marginTop: 10, fontSize: 13 }}>
                    Show payment confirmation at counter if asked.
                  </div>

                  {admin && (
                    <div style={{ marginTop: 14 }}>
                      <div className="muted" style={{ marginBottom: 8 }}>Admin controls</div>
                      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                        <button className="btn" onClick={() => setStatus("hold")}>Hold</button>
                        <button className="btn primary" onClick={() => setStatus("paid")}>Mark Paid</button>
                        <button className="btn danger" onClick={() => setStatus("cancelled")}>Cancel</button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>

        <div className="card cols-6">
          <h3>How it works</h3>
          <div className="muted">Book → Pay via UPI → Tap “I have paid” → Admin verifies.</div>
        </div>
      </div>
    </div>
  );
}


function TVMode({ data, activeTournament, playersForActive }) {
  const table = activeTournament ? calcLeaderboard(playersForActive, activeTournament) : [];
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

function BottomNav({ admin }) {
  return (
    <div className="bottomNav">
      <Link to="/" className="bn">Home</Link>
      <Link to="/booking" className="bn">Book</Link>
      <Link to="/pay" className="bn">Pay</Link>
      <Link to="/leaderboard" className="bn">Board</Link>
      <Link to="/tv" className="bn">TV</Link>
      <span className={"bn tag " + (admin ? "on" : "off")}>{admin ? "Admin" : "Public"}</span>
    </div>
  );
}



/* ---------------------------
   Hall of Fame
---------------------------- */
function HallOfFame({ data, admin, commit }) {
  const [query, setQuery] = useState("");
  const players = data.players || [];
  const hof = data.hallOfFame || [];

  const byId = new Map(players.map((p) => [p.id, p]));
  const list = hof
    .map((h) => ({ ...h, player: byId.get(h.playerId) }))
    .filter((x) => x.player)
    .sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));

  const filtered = query
    ? list.filter((x) => (x.player.name || "").toLowerCase().includes(query.toLowerCase()))
    : list;

  function add() {
    if (!admin) return alert("Admin only");
    const name = prompt("Search player name to add:");
    if (!name) return;
    const hit = players.find((p) => p.name.toLowerCase().includes(name.toLowerCase()));
    if (!hit) return alert("No matching player found. Add player first in Players page.");
    const title = prompt("Title/Reason (optional):", "Champion");
    const note = prompt("Note (optional):", "");
    const next = {
      ...data,
      hallOfFame: [
        { id: uid(), playerId: hit.id, title: title || "", note: note || "", addedAt: Date.now() },
        ...(data.hallOfFame || []),
      ],
    };
    commit(next);
  }

  function remove(id) {
    if (!admin) return;
    if (!confirm("Remove from Hall of Fame?")) return;
    commit({ ...data, hallOfFame: (data.hallOfFame || []).filter((x) => x.id !== id) });
  }

  return (
    <div className="container">
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <h2 style={{ margin: 0 }}>Hall of Fame</h2>
            <div className="muted" style={{ marginTop: 6 }}>
              Top performers, champions, and special mentions at The Q CLUB.
            </div>
          </div>
          {admin && <button className="btn primary" onClick={add}>+ Add</button>}
        </div>

        <div className="row" style={{ marginTop: 14, gap: 10, flexWrap: "wrap" }}>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search player"
            style={{ maxWidth: 320 }}
          />
          <span className="badge"><span className="dot" /> {filtered.length} entries</span>
        </div>

        <div className="grid" style={{ marginTop: 14 }}>
          {filtered.length === 0 ? (
            <div className="muted">No entries yet.</div>
          ) : (
            filtered.map((x) => (
              <div className="card cols-6" key={x.id}>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
                  <h3 style={{ margin: 0 }}>{x.player.name}</h3>
                  {admin && <button className="btn danger" onClick={() => remove(x.id)}>Remove</button>}
                </div>
                <div className="muted" style={{ marginTop: 6 }}>{x.player.city || ""}</div>
                {x.title ? <div className="badge" style={{ marginTop: 10 }}><span className="dot" /> {x.title}</div> : null}
                {x.note ? <div className="muted" style={{ marginTop: 10 }}>{x.note}</div> : null}
                <div className="muted" style={{ marginTop: 12, fontSize: 12 }}>Added: {new Date(x.addedAt).toLocaleString()}</div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------
   Music Dock (Q Club Anthem)
   - Browser blocks autoplay, so user must tap Play once.
---------------------------- */
function AudioDock({ src = "/music.mp3", title = "Q Club Anthem" }) {
  const KEY_ENABLED = "qclub_music_enabled";
  const KEY_VOL = "qclub_music_volume";
  const audioRef = React.useRef(null);

  const [enabled, setEnabled] = React.useState(() => {
    try { return localStorage.getItem(KEY_ENABLED) === "1"; } catch { return false; }
  });
  const [playing, setPlaying] = React.useState(false);
  const [volume, setVolume] = React.useState(() => {
    try {
      const v = Number(localStorage.getItem(KEY_VOL));
      return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.6;
    } catch { return 0.6; }
  });
  const [hint, setHint] = React.useState("");

  React.useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    a.volume = volume;
    try { localStorage.setItem(KEY_VOL, String(volume)); } catch {}
  }, [volume]);

  React.useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => setPlaying(false);

    a.addEventListener("play", onPlay);
    a.addEventListener("pause", onPause);
    a.addEventListener("ended", onEnded);

    return () => {
      a.removeEventListener("play", onPlay);
      a.removeEventListener("pause", onPause);
      a.removeEventListener("ended", onEnded);
    };
  }, []);

  // Configure audio, but do NOT call play() from an effect.
  // Browsers allow audio.play() reliably only when it's directly triggered by a user gesture.
  React.useEffect(() => {
    const a = audioRef.current;
    if (!a) return;

    a.loop = true;
    if (!enabled) {
      a.pause();
      try { a.currentTime = 0; } catch {}
      setHint("");
    }

    try { localStorage.setItem(KEY_ENABLED, enabled ? "1" : "0"); } catch {}
  }, [enabled]);

  async function togglePlay() {
    const a = audioRef.current;
    if (!a) return;

    setHint("");

    // First tap enables + starts playback immediately (same click gesture)
    if (!enabled) {
      setEnabled(true);
      try {
        a.load();
        await a.play();
      } catch {
        setHint("Tap ▶ once more (browser blocked audio)");
      }
      return;
    }

    if (playing) {
      a.pause();
      return;
    }

    try {
      await a.play();
    } catch {
      setHint("Tap ▶ once more (browser blocked audio)");
    }
  }

  return (
    <div className="musicDock" role="region" aria-label="Music player">
      <audio ref={audioRef} src={src} preload="auto" />
      <button className={"btn " + (playing ? "danger" : "primary")} onClick={togglePlay}>
        {playing ? "⏸" : "▶"}
      </button>

      <div className="musicMeta">
        <div className="musicTitle">{title}</div>
        <div className="musicSub muted">
          {hint || (enabled ? (playing ? "Playing" : "Paused") : "Tap ▶ to play")}
        </div>
      </div>

      <input
        className="musicVol"
        type="range"
        min="0"
        max="1"
        step="0.01"
        value={volume}
        onChange={(e) => setVolume(Number(e.target.value))}
        aria-label="Volume"
      />

      <button className="btn" onClick={() => setEnabled(false)} title="Stop music">
        ✕
      </button>
    </div>
  );
}

function NotFound() {
  return (
    <div className="container">
      <div className="card">
        <h2>Page not found</h2>
        <div className="muted">Use the menu to navigate.</div>
      </div>
    </div>
  );
}
