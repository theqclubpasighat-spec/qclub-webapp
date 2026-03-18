/* ================================
   App.jsx — PART 1
   (Beginning → inside resetAll())
================================ */

import React, { useEffect, useMemo, useRef, useState } from "react";
import { Routes, Route, Link, useNavigate, useLocation } from "react-router-dom";

// Supabase Cloud Sync helpers (implemented in src/cloud.js)
import { cloudMissingVars, isCloudEnabled, subscribeState, writeState } from "./cloud";
import { supabase, supabaseReady } from "./supabase";

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
const STORAGE_BUCKET = "photos";
const LAST_SEEN_BOOKING_KEY = "qclub_last_seen_booking_at";

function getLastSeenBookingAt() {
  return Number(localStorage.getItem(LAST_SEEN_BOOKING_KEY) || 0);
}

function setLastSeenBookingAt(value) {
  localStorage.setItem(LAST_SEEN_BOOKING_KEY, String(value || 0));
}

function fileExt(file) {
  const fromName = String(file?.name || "").split(".").pop()?.toLowerCase();
  if (fromName && fromName !== String(file?.name || "").toLowerCase()) return fromName;

  const mime = String(file?.type || "").toLowerCase();
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  return "jpg";
}

function isDataUrl(value) {
  return typeof value === "string" && value.startsWith("data:");
}

async function uploadImageToStorage(file, folder = "general") {
  if (!supabaseReady || !supabase) {
    throw new Error("Supabase is not ready for storage uploads.");
  }

  const ext = fileExt(file);
  const path = `${folder}/${Date.now()}-${uid()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKET)
    .upload(path, file, {
      cacheControl: "3600",
      upsert: true,
      contentType: file?.type || undefined,
    });

  if (uploadError) {
    throw uploadError;
  }

  const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
  return { path, url: data?.publicUrl || "" };
}

async function deleteStorageObject(path) {
  if (!path || !supabaseReady || !supabase) return;
  try {
    await supabase.storage.from(STORAGE_BUCKET).remove([path]);
  } catch {
    // ignore cleanup failures
  }
}

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

  // Non-member → normal price
  if (bookingType !== "member") {
    return Math.max(0, safeNum(table.pricePerHour, 0));
  }

  // Member pricing based on table name
  const label = (table.label || "").toLowerCase();

  if (label.includes("12") || label.includes("12x6")) return 300;
  if (label.includes("mini") || label.includes("10x5")) return 200;
  if (label.includes("pool")) return 200;

  // fallback
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
    highestBreak: 0,
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

                const b1 = Number(m.break1 || 0);
        const b2 = Number(m.break2 || 0);

        if (Number.isFinite(b1) && b1 > a.highestBreak) a.highestBreak = b1;
        if (Number.isFinite(b2) && b2 > b.highestBreak) b.highestBreak = b2;

        touched.add(m.p1);
        touched.add(m.p2);

        a.matches++;
        b.matches++;

        if (t?.format === "knockout") {
          if (m.winner === m.p1) {
            a.wins++;
            b.losses++;
            a.points += t.pointsWin ?? 1;
            b.points += t.pointsLoss ?? 0;
          } else if (m.winner === m.p2) {
            b.wins++;
            a.losses++;
            b.points += t.pointsWin ?? 1;
            a.points += t.pointsLoss ?? 0;
          } else {
            a.matches--;
            b.matches--;
            touched.delete(m.p1);
            touched.delete(m.p2);
          }
          return;
        }

        const s1 = Number(m.score1);
        const s2 = Number(m.score2);
        if (!Number.isFinite(s1) || !Number.isFinite(s2)) {
          a.matches--;
          b.matches--;
          touched.delete(m.p1);
          touched.delete(m.p2);
          return;
        }

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
    return (
      (y.points - x.points) ||
      (y.wins - x.wins) ||
      (y.highestBreak - x.highestBreak) ||
      x.name.localeCompare(y.name)
    );
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
  heroSlides: [],
  heroSpeed: 3500,
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
    menuCatalog: {
  mocktails: {
    title: "Mocktails",
    image: "/menu/mocktails.png",
    items: [
      {
        id: "mojito",
        name: "Virgin Mojito",
        description: "Minty chilled mocktail",
        price: 99,
        image: "/menu/mocktails.png"
      },
      {
        id: "blue_lagoon",
        name: "Blue Lagoon",
        description: "Refreshing citrus mocktail",
        price: 99,
        image: "/menu/mocktails.png"
      }
    ]
  },

  momos: {
    title: "Momos",
    image: "/menu/momo.png",
    items: [
      {
        id: "chicken_momo",
        name: "Chicken Momos",
        description: "Steamed or fried",
        price: 120,
        image: "/menu/momo.png"
      },
      {
        id: "pork_momo",
        name: "Pork Momos",
        description: "Steamed or fried",
        price: 130,
        image: "/menu/momo.png"
      }
    ]
  },

  sausages: {
    title: "Sausages",
    image: "/menu/Grilled Sausage.png",
    items: [
      {
        id: "grilled_sausage",
        name: "Grilled Sausage",
        description: "Juicy grilled sausage",
        price: 120,
        image: "/menu/Grilled Sausage.png"
      }
    ]
  },

  chicken: {
    title: "Chicken",
    image: "/menu/roasted Chicken wings.png",
    items: [
      {
        id: "roasted_wings",
        name: "Roasted Chicken Wings",
        description: "Smoky roasted wings",
        price: 220,
        image: "/menu/roasted Chicken wings.png"
      }
    ]
  }
},
    photos: [],
    players: [
      { id: uid(), name: "Wilson", city: "Pasighat", photo: "", bio: "", games: ["snooker", "pool"] },
      { id: uid(), name: "Riku", city: "Pasighat", photo: "", bio: "", games: ["snooker"] },
      { id: uid(), name: "Tani", city: "Aalo", photo: "", bio: "", games: ["pool"] },
      { id: uid(), name: "Bikash", city: "Roing", photo: "", bio: "", games: ["snooker", "pool"] },
    ],
    foodOrders: [],
    archivedFoodOrders: [],
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
        heroSlides: Array.isArray(src?.club?.heroSlides) ? src.club.heroSlides.filter(Boolean) : base.club.heroSlides,
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
    announcements: Array.isArray(src.announcements) ? src.announcements : base.announcements,
memberships: Array.isArray(src.memberships) ? src.memberships : base.memberships,
offers: Array.isArray(src.offers) ? src.offers : base.offers,
menuCatalog: src.menuCatalog && typeof src.menuCatalog === "object" ? src.menuCatalog : base.menuCatalog,
photos: Array.isArray(src.photos) ? src.photos : base.photos,
players: Array.isArray(src.players)
  ? src.players.map((p) => ({ ...p, games: normalizePlayerGames(p?.games) }))
  : base.players,
foodOrders: Array.isArray(src.foodOrders) ? src.foodOrders : base.foodOrders,
archivedFoodOrders: Array.isArray(src.archivedFoodOrders) ? src.archivedFoodOrders : base.archivedFoodOrders,
tournaments: Array.isArray(src.tournaments) ? src.tournaments : base.tournaments,
    booking: {
      ...base.booking,
      ...(src.booking || {}),
      tables: Array.isArray(src?.booking?.tables) && src.booking.tables.length ? src.booking.tables : base.booking.tables,
      requests: Array.isArray(src?.booking?.requests) ? src.booking.requests : base.booking.requests,
      lastSeenRequestAt: Number.isFinite(src?.booking?.lastSeenRequestAt) ? src.booking.lastSeenRequestAt : base.booking.lastSeenRequestAt,
    },
        hallOfFame: Array.isArray(src.hallOfFame) ? src.hallOfFame : base.hallOfFame,
        mediaLibrary: Array.isArray(src.mediaLibrary) ? src.mediaLibrary : base.mediaLibrary,
  };
}
function stripHeavyMediaForCloud(src) {
  const next = JSON.parse(JSON.stringify(src || {}));

  next.photos = (next.photos || []).map((p) => ({
    ...p,
    dataUrl: isDataUrl(p?.dataUrl) ? "" : (p?.dataUrl || ""),
  }));

  next.players = (next.players || []).map((p) => ({
    ...p,
    photo: isDataUrl(p?.photo) ? "" : (p?.photo || ""),
  }));

  next.hallOfFame = (next.hallOfFame || []).map((h) => ({
    ...h,
    photo: isDataUrl(h?.photo) ? "" : (h?.photo || ""),
  }));

  return next;
}

function hydrateLocalMediaIntoState(src) {
  return JSON.parse(JSON.stringify(src || {}));
}

function isMeaningfulState(obj) {
  if (!obj || typeof obj !== "object") return false;
  return Object.keys(obj).length > 0;
}

function loadData() {
  try {
    const raw =
      localStorage.getItem("qclub_v5_data") ||
      localStorage.getItem("qclub_v3_data") ||
      localStorage.getItem("qclub_v2_data");

    if (!raw) return defaultData();

    const parsed = JSON.parse(raw);
    return mergeWithDefaults(parsed);
  } catch (e) {
    console.warn("Failed to load saved data:", e);
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
  break1: "",
  break2: "",
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
function generateKnockout(playerIds) {
  const ids = [...playerIds].filter(Boolean);
  if (ids.length < 2) return [];

  function nextPowerOfTwo(n) {
    let p = 1;
    while (p < n) p *= 2;
    return p;
  }

  function shuffle(arr) {
    return [...arr].sort(() => Math.random() - 0.5);
  }

  const shuffled = shuffle(ids);
  const matches = [];

  const bracketSize = nextPowerOfTwo(shuffled.length);
  const byes = bracketSize - shuffled.length;

  // Players getting a bye straight into Round 2
  const byePlayers = shuffled.slice(0, byes);

  // Players who must play Round 1
  const round1Players = shuffled.slice(byes);

  // Round 1
  const round1WinnerSlots = [];
  for (let i = 0; i < round1Players.length; i += 2) {
    const p1 = round1Players[i];
    const p2 = round1Players[i + 1];
    if (!p1 || !p2) continue;

    const matchNumber = round1WinnerSlots.length + 1;

    matches.push({
      id: uid(),
      round: 1,
      matchNo: matchNumber,
      p1,
      p2,
      score1: "",
      score2: "",
      winner: "",
      result: "",
      status: "scheduled",
      bestOf: 3,
      break1: "",
break2: "",
      updatedAt: Date.now(),
    });

    round1WinnerSlots.push(`WINNER_R1_M${matchNumber}`);
  }

  // Round 2 starts with bye players + winners of Round 1
  let currentRoundPlayers = [...byePlayers, ...round1WinnerSlots];
  let roundNumber = 2;

  while (currentRoundPlayers.length > 1) {
    const nextRoundPlayers = [];

    for (let i = 0; i < currentRoundPlayers.length; i += 2) {
      const p1 = currentRoundPlayers[i];
      const p2 = currentRoundPlayers[i + 1];

      if (!p1 && !p2) continue;

      if (p1 && !p2) {
        nextRoundPlayers.push(p1);
        continue;
      }

      if (!p1 && p2) {
        nextRoundPlayers.push(p2);
        continue;
      }

      const matchNumber = nextRoundPlayers.length + 1;
      const isFinal = currentRoundPlayers.length === 2;

      matches.push({
        id: uid(),
        round: roundNumber,
        matchNo: matchNumber,
        p1,
        p2,
        score1: "",
        score2: "",
        winner: "",
        result: "",
        status: "scheduled",
        bestOf: isFinal ? 5 : 3,
        break1: "",
break2: "",
        updatedAt: Date.now(),
      });

      nextRoundPlayers.push(`WINNER_R${roundNumber}_M${matchNumber}`);
    }

    currentRoundPlayers = nextRoundPlayers;
    roundNumber += 1;
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
    highestBreak: 0,
  }));
  const byId = new Map(rows.map((r) => [r.id, r]));

  (tournament.matches || []).forEach((m) => {
    if (m.status !== "done") return;
    const a = byId.get(m.p1);
    const b = byId.get(m.p2);
    if (!a || !b) return;

        const b1 = Number(m.break1 || 0);
    const b2 = Number(m.break2 || 0);

    if (Number.isFinite(b1) && b1 > a.highestBreak) a.highestBreak = b1;
    if (Number.isFinite(b2) && b2 > b.highestBreak) b.highestBreak = b2;

    a.played++;
    b.played++;

    if (tournament?.format === "knockout") {
      if (m.winner === m.p1) {
        a.wins++;
        b.losses++;
        a.points += tournament.pointsWin ?? 1;
        b.points += tournament.pointsLoss ?? 0;
      } else if (m.winner === m.p2) {
        b.wins++;
        a.losses++;
        b.points += tournament.pointsWin ?? 1;
        a.points += tournament.pointsLoss ?? 0;
      } else {
        a.played--;
        b.played--;
      }
      return;
    }

    const s1 = Number(m.score1);
    const s2 = Number(m.score2);
    if (!Number.isFinite(s1) || !Number.isFinite(s2)) {
      a.played--;
      b.played--;
      return;
    }

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
    return (
      (y.points - x.points) ||
      (y.wins - x.wins) ||
      (y.highestBreak - x.highestBreak) ||
      x.name.localeCompare(y.name)
    );
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
  const [hasHydratedFromCloud, setHasHydratedFromCloud] = useState(false);

  const [admin, setAdmin] = useState(false);

  const navigate = useNavigate();
  const location = useLocation();
    const [selectedPlayer, setSelectedPlayer] = useState(null);
    function openPlayerModal(playerId) {
  const found = (data.players || []).find(p => p.id === playerId);
  if (found) setSelectedPlayer(found);
}

function closePlayerModal() {
  setSelectedPlayer(null);
}

  function openPlayerById(playerId) {
    const found = (data.players || []).find((p) => p.id === playerId);
    if (found) setSelectedPlayer(found);
  }

  function closePlayerModal() {
    setSelectedPlayer(null);
  }
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
    const snookerBoard = useMemo(
    () => calcAutoRankingBoard(data.players || [], data.tournaments || [], "snooker"),
    [data.players, data.tournaments]
  );

  const poolBoard = useMemo(
    () => calcAutoRankingBoard(data.players || [], data.tournaments || [], "pool"),
    [data.players, data.tournaments]
  );
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
  const safeNext = hydrateLocalMediaIntoState(mergeWithDefaults(next));

  setData(safeNext);
  saveData(safeNext);
  try {
  localStorage.setItem("qclub_state_backup", JSON.stringify(safeNext));
} catch (e) {}

  if (!isCloudEnabled()) return;
  if (!hasHydratedFromCloud) return;

  setCloudStatus("syncing");

  const cloudSafe = stripHeavyMediaForCloud(safeNext);

  writeState(cloudSafe)
    .then(() => {
      setCloudStatus("offline");
    })
    .catch((err) => {
      console.error("Cloud sync error:", err);
      setCloudStatus("error");
    });
}
function updateData(path, value) {
  const keys = path.split(".");
  const next = JSON.parse(JSON.stringify(data));

  let ref = next;

  for (let i = 0; i < keys.length - 1; i++) {
    if (!ref[keys[i]]) ref[keys[i]] = {};
    ref = ref[keys[i]];
  }

  ref[keys[keys.length - 1]] = value;

  commit(next);
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
    const lastSeen = getLastSeenBookingAt();
    const newest = Math.max(0, ...(data.booking?.requests || []).map((r) => r.createdAt || 0));
    if (newest > lastSeen) {
      playPing();
      setLastSeenBookingAt(newest);
    }
  }, [admin, data.booking?.requests]);
useEffect(() => {
  if (!isCloudEnabled()) {
    setData(loadData());
    setHasHydratedFromCloud(true);
    return;
  }

  setCloudStatus("syncing");

  const fallbackTimer = setTimeout(() => {
    setHasHydratedFromCloud(true);
    setCloudStatus("synced");
  }, 2500);

  const unsubscribe = subscribeState((remoteState) => {
    if (!remoteState || typeof remoteState !== "object") return;

    clearTimeout(fallbackTimer);

    const merged = hydrateLocalMediaIntoState(mergeWithDefaults(remoteState));
    setData(merged);
    saveData(merged);
    setHasHydratedFromCloud(true);
    setCloudStatus("synced");
  });

  return () => {
    clearTimeout(fallbackTimer);
    if (typeof unsubscribe === "function") unsubscribe();
  };
}, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);
  if (!hasHydratedFromCloud) {
  return (
    <div className="container" style={{ paddingTop: 40 }}>
      <div
        className="card"
        style={{
          minHeight: 180,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 20,
          fontWeight: 800,
        }}
      >
        Loading The Q Club...
      </div>
    </div>
  );
}

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
                <Route
          path="/live"
          element={
            <LiveMatches
              data={data}
              admin={admin}
              onOpenPlayer={openPlayerModal}
            />
          }
        />
        <Route
  path="/offer"
  element={
    <Offers
      data={data}
      admin={admin}
      commit={commit}
      startPayment={startPayment}
    />
  }
/>
        <Route path="/photos" element={<Photos data={data} admin={admin} commit={commit} />} />
        <Route path="/players" element={<Players data={data} admin={admin} commit={commit} activeTournament={activeTournament} />} />
        <Route path="/tournaments" element={<Tournaments data={data} admin={admin} commit={commit} />} />
        <Route
  path="/fixtures"
  element={
    <Fixtures
      data={data}
      admin={admin}
      commit={commit}
      onOpenPlayer={openPlayerModal}
    />
  }
/>
        
        <Route
  path="/leaderboard"
  element={
    <LeaderboardAll
      data={data}
      onOpenPlayer={openPlayerModal}
    />
  }
/>
        <Route path="/halloffame" element={<HallOfFame data={data} admin={admin} commit={commit} />} />
        <Route
  path="/tv"
  element={
    <TVMode
      data={data}
      activeTournament={activeTournament}
      players={playersForTournament(activeTournament, data.players || [])}
    />
  }
/>
        <Route path="/admin-panel" element={<AdminPanel data={data} admin={admin} commit={commit} activeTournament={activeTournament} />} />
        <Route path="/about" element={<StaticPage title="About The Q Club"><AboutContent data={data} /></StaticPage>} />
        <Route path="/contact" element={<StaticPage title="Contact Us"><ContactContent data={data} /></StaticPage>} />
        <Route path="/terms" element={<StaticPage title="Terms & Conditions"><TermsContent /></StaticPage>} />
        <Route path="/refund" element={<StaticPage title="Refund Policy"><RefundContent /></StaticPage>} />
        <Route path="/privacy" element={<StaticPage title="Privacy Policy"><PrivacyContent /></StaticPage>} />
        <Route path="/admin/orders" element={<FoodOrdersAdmin data={data} admin={admin} commit={commit} />} />
        
        <Route path="/payment-status" element={<PaymentStatus data={data} commit={commit} />} />
        <Route path="*" element={<NotFound />} />
      </Routes>

      <FooterLinks data={data} admin={admin} commit={commit} />
            {selectedPlayer ? (
        <div
          onClick={closePlayerModal}
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
                style={{ alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}
              >
                {selectedPlayer.photo ? (
                  <div
                    style={{
                      width: 220,
                      height: 320,
                      minWidth: 220,
                      flexShrink: 0,
                      borderRadius: 18,
                      overflow: "hidden",
                      background: "rgba(255,255,255,.06)",
                      border: "1px solid rgba(255,255,255,.10)",
                    }}
                  >
                    <img
                      src={selectedPlayer.photo}
                      alt={selectedPlayer.name}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        display: "block",
                      }}
                    />
                  </div>
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
             <div className="grid" style={{ marginTop: 16 }}>     <div className="muted" style={{ marginTop: 6 }}>
                    {selectedPlayer.city || "—"}
                  </div>
                  <div className="badge" style={{ marginTop: 10 }}>
                    <span className="dot" />
                    {playerGamesLabel(selectedPlayer)}
                  </div>
                </div>
              </div>

              <button className="iconBtn" onClick={closePlayerModal}>
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
            {(() => {
              const row = snookerBoard.find((r) => r.id === selectedPlayer.id);
              return row ? row.highestBreak || 0 : 0;
            })()}
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

              <div className="card cols-6">
                <div className="infoLabel">Games</div>
                <div className="infoValue">
                  {playerGamesLabel(selectedPlayer)}
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      <BottomPadding />
    </>
  );
}

function FooterLinks({ data, admin, commit }) {
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
          </div>{admin && (
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
        
        <Link className="pill" to="/live">Live Matches</Link>
        
        <Link className="pill" to="/photos">Photos</Link>
        <Link className="pill" to="/players">Players</Link>
        <Link className="pill" to="/tournaments">Tournaments</Link>
        <Link className="pill" to="/fixtures">Fixtures</Link>
        <Link className="pill" to="/leaderboard">Leaderboards</Link>
        <Link className="pill" to="/halloffame">Hall of Fame</Link>
        {admin ? <Link className="pill" to="/tv">TV</Link> : null}
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

    const fallbackHeroImages = [
  "/home/snooker.jpg",
  "/home/air-hockey.png",
  "/home/foosball.jpg",
  ...(data.photos || []).map((p) => p.url || p.dataUrl).filter(Boolean),
];

const heroImages =
  Array.isArray(data.club?.heroSlides) && data.club.heroSlides.length
    ? data.club.heroSlides.filter(Boolean)
    : fallbackHeroImages;
      const heroSlideSpeed = Math.max(1000, Number(data.club?.heroSpeed || 3500));

  const [heroIndex, setHeroIndex] = useState(0);

  const heroImage =
    heroImages[heroIndex] || "/home/snooker.jpg";

  function prevHeroImage() {
    setHeroIndex((prev) =>
      prev === 0 ? heroImages.length - 1 : prev - 1
    );
  }

  function nextHeroImage() {
    setHeroIndex((prev) =>
      prev === heroImages.length - 1 ? 0 : prev + 1
    );
  }
    useEffect(() => {
    if (heroImages.length <= 1) return;

    const timer = setInterval(() => {
      setHeroIndex((prev) =>
        prev === heroImages.length - 1 ? 0 : prev + 1
      );
    }, heroSlideSpeed);

    return () => clearInterval(timer);
  }, [heroImages.length, heroSlideSpeed]);
    useEffect(() => {
    heroImages.forEach((src) => {
      if (!src) return;
      const img = new Image();
      img.src = src;
    });
  }, [heroImages]);
  const isSnookerTournament = tournamentGameKey(activeTournament?.game) === "snooker";
  const tournamentImage = isSnookerTournament ? "/home/snooker.jpg" : "/home/pool.jpg";

  const clubGallery = [
    { id: "snooker", url: "/home/snooker.jpg", caption: "Snooker" },
    { id: "airhockey", url: "/home/air-hockey.png", caption: "Air Hockey" },
    { id: "foosball", url: "/home/foosball.jpg", caption: "Foosball" },
  ];

  const memberships = (data.memberships || []).slice(0, 3);

  const features =
  data.club?.homeFeatures || [
    "2xPremium Snooker Tables",
    "American Pool Table",
    "Mini Snooker Table",
    "Monthly Tournaments",
    "Air Hockey & Foosball",
    "Massage Chair",
    "Tea & Coffee Vending Machines",
    "Members Privileges",
    "Smoking Room",
    "Separate Toilets",
    "Mocktails",
    "Food and Snacks",
  ];

  return (
    <div className="container refHome">
      <section
  className="refHero"
  style={{
    backgroundImage: `linear-gradient(180deg, rgba(7,10,18,.30), rgba(7,10,18,.68)),
      radial-gradient(900px 320px at 20% 0%, rgba(56,211,159,.10), transparent 60%),
      radial-gradient(900px 420px at 90% 10%, rgba(212,175,55,.10), transparent 60%),
      url("${heroImage}")`,
    backgroundSize: "contain",
    backgroundPosition: "center top",
    backgroundRepeat: "no-repeat",
    backgroundColor: "#050814",
    transition: "background-image 0.25s ease-in-out",
  }}
>
        <div className="refHeroTopBar">
  <div className="refHeroActionRow">
  <Link className="btn neonGreen refHeroActionBtn" to="/book">
  Book Table
</Link>

  <Link className="btn neonGreen refHeroActionBtn" to="/membership">
  Membership
</Link>

  <Link
  className="btn neonGreen refHeroActionBtn"
  to="/offer"
  
>
  The Q Lounge
</Link>
</div>

  <div className="row" style={{ gap: 8 }}>
    <button
      className="btn"
      type="button"
      onClick={prevHeroImage}
      aria-label="Previous image"
    >
      ←
    </button>
    <button
      className="btn"
      type="button"
      onClick={nextHeroImage}
      aria-label="Next image"
    >
      →
    </button>
  </div>
</div>

        <div className="refHeroSpacer" />

        <div className="refHeroBottom">
          <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
            <span className="badge premiumBadgeLite">
              <span className={data.club?.isOpenNow ? "dot" : "dot red"} />
              {data.club?.isOpenNow ? "OPEN NOW" : "CLOSED NOW"}
            </span>
          </div>

          <h1 className="refHeroTitle">{data.club?.name || "The Q CLUB"}</h1>

          <div className="refHeroSubtitle">
            {data.club?.tagline2 ||
              "Snooker • Pool • Air Hockey • Foosball • Massage Chair • Tea & Coffee"}
          </div>{admin && (
  <div style={{ marginTop: 10, display: "flex", gap: 10, alignItems: "center" }}>
    <button
      className="btn"
      type="button"
      onClick={() => {
        const name = prompt("Club title:", data.club?.name || "");
        if (!name) return;

        const tagline2 = prompt(
          "Hero subtitle:",
          data.club?.tagline2 ||
            "Snooker • Pool • Air Hockey • Foosball • Massage Chair • Tea & Coffee"
        );
        if (!tagline2) return;

        commit({
          ...data,
          club: {
            ...data.club,
            name,
            tagline2,
          },
        });
      }}
    >
      Edit Hero
    </button>
    <input
  type="text"
  placeholder="Paste YouTube livestream link"
  value={data.club?.liveStreamUrl || ""}
  onChange={(e) =>
    commit({
      ...data,
      club: {
        ...data.club,
        liveStreamUrl: e.target.value,
      },
    })
  }
  style={{
    padding: "6px 10px",
    borderRadius: 6,
    border: "1px solid #444",
    minWidth: 280,
  }}
/>
  </div>
)}
        </div>
      </section>

      <LiveMatchesHeroCard data={data} />

      <section className="refInfoGrid">
        <div className="refGlassCard">
          <div className="refInfoLabel">Location</div>
          <div className="refInfoValue">GTC Pasighat</div>
        </div>

        <div className="refGlassCard">
          <div className="refInfoLabel">Contact</div>
          <div className="refInfoValue">{phone || "—"}</div>
        </div>
      </section>

      <section className="refTournamentCard">
        <div className="refTournamentContent">
          <div className="refTournamentKicker">Current Tournament</div>
          <div className="refTournamentName">
            {activeTournament?.name || "Q Club Tournament"}
          </div>
          <div className="refTournamentMonth">
            {activeTournament?.month || "This Month"}
          </div>
          <div className="muted" style={{ marginTop: 8 }}>
            {isSnookerTournament ? "Snooker Tournament" : "Pool Tournament"}
          </div>

          <div style={{ marginTop: 18 }}>
            <Link className="btn neonGreen refViewBtn" to={`/fixtures?game=${isSnookerTournament ? "snooker" : "pool"}`}>
              View Fixtures
            </Link>
          </div>
        </div>

        <div className="refTournamentVisual">
          <img
            src={tournamentImage}
            alt={isSnookerTournament ? "Snooker Tournament" : "Pool Tournament"}
          />
        </div>
      </section>

      

            <section className="refWhyCard">

  <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
    <h2 className="refSectionTitle">Why Q Club?</h2>

    {admin && (
      <button
  className="btn"
  onClick={() => {
    const current = features.join(" | ");
    const next = prompt(
      "Edit Why Q Club items. Separate each item with |",
      current
    );

    if (next === null) return;

    const cleaned = next
      .split("|")
      .map((x) => x.trim())
      .filter(Boolean);

    if (!cleaned.length) {
      alert("Please enter at least one item.");
      return;
    }

    commit({
      ...data,
      club: {
        ...(data.club || {}),
        homeFeatures: cleaned,
      }
    });
  }}
>
  Edit
</button>
    )}
  </div>

        <div className="refFeatureGrid">
          {features.map((item, idx) => (
  <div className="refFeatureItem" key={`${item}-${idx}`}>
    {item}
  </div>
))}
        </div>
      </section>
    </div>
  );
}

function Offers({ data, admin, commit, startPayment }) {
  const menu = data.menuCatalog || {};
  const categories = Object.keys(menu);
  const [activeCategory, setActiveCategory] = React.useState(categories[0] || "");
  const [cart, setCart] = React.useState(() => {
  try {
    const saved = JSON.parse(localStorage.getItem("qclub_food_cart") || "[]");
    if (!Array.isArray(saved)) return {};

    return saved.reduce((acc, item) => {
      if (item && item.id) {
        acc[item.id] = Number(item.qty) || 0;
      }
      return acc;
    }, {});
  } catch {
    return {};
  }
});
  const [showCheckout, setShowCheckout] = React.useState(false);
  const [customerName, setCustomerName] = React.useState("");
const [customerPhone, setCustomerPhone] = React.useState("");

  React.useEffect(() => {
    if (!activeCategory && categories.length) {
      setActiveCategory(categories[0]);
    }
  }, [activeCategory, categories]);

  const category = menu[activeCategory] || {};
  const items = category.items || [];
  const cartItems = Object.keys(cart).filter((id) => cart[id] > 0);

const cartTotal = cartItems.reduce((sum, id) => {
  const found = Object.values(menu)
    .flatMap((cat) => cat.items || [])
    .find((x) => x.id === id);

  if (!found) return sum;

  return sum + found.price * cart[id];
}, 0);

  function updateItem(itemId, field, value) {
    const nextMenu = { ...menu };
    nextMenu[activeCategory] = {
      ...nextMenu[activeCategory],
      items: nextMenu[activeCategory].items.map((item) =>
        item.id === itemId ? { ...item, [field]: field === "price" ? Number(value) : value } : item
      ),
    };

    commit({
      ...data,
      menuCatalog: nextMenu,
    });
  }

  function addItem() {
    const name = prompt("Item name:");
    if (!name) return;

    const description = prompt("Item description:", "") || "";
    const price = Number(prompt("Item price:", "0") || 0);
    const image = prompt("Item image path:", category.image || "") || category.image || "";

    const nextMenu = { ...menu };
    nextMenu[activeCategory] = {
      ...nextMenu[activeCategory],
      items: [
        ...nextMenu[activeCategory].items,
        {
          id: `item_${Date.now()}`,
          name,
          description,
          price,
          image,
        },
      ],
    };

    commit({
      ...data,
      menuCatalog: nextMenu,
    });
  }
  function addCategory() {
  const keyInput = prompt("New category key (example: momos2 or beverages):", "");
  if (!keyInput) return;

  const key = keyInput.trim().toLowerCase().replace(/\s+/g, "_");
  if (!key) return;

  if (menu[key]) {
    alert("This category key already exists.");
    return;
  }

  const title = prompt("Category title:", keyInput.trim()) || keyInput.trim();

  const nextMenu = { ...menu };
  nextMenu[key] = {
    title,
    image: "",
    items: [],
  };

  commit({
    ...data,
    menuCatalog: nextMenu,
  });

  setActiveCategory(key);
}
function addToCart(item) {
  setCart((prev) => ({
    ...prev,
    [item.id]: (prev[item.id] || 0) + 1,
  }));
}
function removeFromCart(item) {
  setCart((prev) => ({
    ...prev,
    [item.id]: Math.max((prev[item.id] || 0) - 1, 0),
  }));
}
function itemQty(item) {
  return cart[item.id] || 0;
}
  function deleteItem(itemId) {
    const ok = confirm("Delete this item?");
    if (!ok) return;

    const nextMenu = { ...menu };
    nextMenu[activeCategory] = {
      ...nextMenu[activeCategory],
      items: nextMenu[activeCategory].items.filter((item) => item.id !== itemId),
    };

    commit({
      ...data,
      menuCatalog: nextMenu,
    });
  }
  async function uploadItemImage(itemId, file) {
  if (!admin) return alert("Admin only");
  if (!file) return;

  try {
    const uploaded = await uploadImageToStorage(file, "menu-items");

    const nextMenu = { ...menu };
    nextMenu[activeCategory] = {
      ...nextMenu[activeCategory],
      items: nextMenu[activeCategory].items.map((item) =>
        item.id === itemId
          ? {
              ...item,
              image: uploaded.url,
              imagePath: uploaded.path,
            }
          : item
      ),
    };

    commit({
      ...data,
      menuCatalog: nextMenu,
    });
  } catch (err) {
    console.error(err);
    alert("Failed to upload image.");
  }
}

async function uploadCategoryImage(file) {
  if (!admin) return alert("Admin only");
  if (!file) return;

  try {
    const uploaded = await uploadImageToStorage(file, "menu-categories");

    const nextMenu = { ...menu };
    nextMenu[activeCategory] = {
      ...nextMenu[activeCategory],
      image: uploaded.url,
      imagePath: uploaded.path,
    };

    commit({
      ...data,
      menuCatalog: nextMenu,
    });
  } catch (err) {
    console.error(err);
    alert("Failed to upload category image.");
  }
}

  function editCategoryTitle() {
    const title = prompt("Category title:", category.title || "");
    if (!title) return;

    const nextMenu = { ...menu };
    nextMenu[activeCategory] = {
      ...nextMenu[activeCategory],
      title,
    };

    commit({
      ...data,
      menuCatalog: nextMenu,
    });
  }

  function editCategoryImage() {
    const image = prompt("Category image path:", category.image || "");
    if (!image) return;

    const nextMenu = { ...menu };
    nextMenu[activeCategory] = {
      ...nextMenu[activeCategory],
      image,
    };

    commit({
      ...data,
      menuCatalog: nextMenu,
    });
  }
  function deleteActiveCategory() {
  if (!activeCategory) return;
  if (!confirm(`Delete category "${category.title || activeCategory}"?`)) return;

  const nextMenu = { ...menu };
  delete nextMenu[activeCategory];

  const nextCategories = Object.keys(nextMenu);

  commit({
    ...data,
    menuCatalog: nextMenu,
  });

  setActiveCategory(nextCategories[0] || "");
}

  return (
    <div className="container">
      <div className="sectionTitle">
        <span className="dot" />
        <span>The Q Lounge Menu</span>
      </div>

      <h1 style={{ marginBottom: 18 }}>Food & Drinks</h1>

      <p className="muted" style={{ marginBottom: 20 }}>
        Browse by Category  
      </p>
      {!admin && (
  <div className="card" style={{ marginBottom: 20 }}>
    <h3 style={{ marginTop: 0 }}>Your Cart</h3>

    {cartItems.length === 0 ? (
      <div className="muted">Cart is empty.</div>
    ) : (
      <>
        <div style={{ display: "grid", gap: 8 }}>
          {cartItems.map((id) => {
            const found = Object.values(menu)
              .flatMap((cat) => cat.items || [])
              .find((x) => x.id === id);

            if (!found) return null;

            return (
              <div
                key={id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12
                }}
              >
                <span>
                  {found.name} × {cart[id]}
                </span>
                <strong>₹{found.price * cart[id]}</strong>
              </div>
            );
          })}
        </div>

        <div style={{ marginTop: 12, fontWeight: 800, fontSize: "1.1rem" }}>
          Total: ₹{cartTotal}
        </div>

        <button
  className="btn"
  type="button"
  style={{ marginTop: 12 }}
  onClick={() => setShowCheckout((v) => !v)}
>
  {showCheckout ? "Hide Cart" : "View Cart"}
</button>
{showCheckout && (
  <div className="card" style={{ marginTop: 14 }}>
    <h3 style={{ marginTop: 0 }}>Checkout</h3>

    <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
      
      <input
  className="input"
  placeholder="Your Name"
  value={customerName}
  onChange={(e) => setCustomerName(e.target.value)}
/>

      <input
  className="input"
  placeholder="Mobile Number"
  value={customerPhone}
  onChange={(e) => setCustomerPhone(e.target.value)}
/>

      <button
  className="btn"
  onClick={() => {
    if (!customerName) {
      alert("Enter your name");
      return;
    }

    if (!customerPhone) {
      alert("Enter mobile number");
      return;
    }
    localStorage.setItem("qclub_payment_context", "food");
localStorage.setItem("qclub_payment_name", customerName.trim());
localStorage.setItem("qclub_payment_mobile", customerPhone.trim());
localStorage.setItem("qclub_food_cart", JSON.stringify(
  cartItems.map((id) => {
    const found = Object.values(menu)
      .flatMap((cat) => cat.items || [])
      .find((x) => x.id === id);

    return found
      ? {
          id: found.id,
          name: found.name,
          qty: cart[id],
          price: found.price,
          lineTotal: found.price * cart[id],
        }
      : null;
  }).filter(Boolean)
));
localStorage.setItem("qclub_food_total", String(cartTotal));

    startPayment(cartTotal, customerPhone);
  }}

>
  Pay ₹{cartTotal}
</button>

    </div>
  </div>
)}
      </>
    )}
  </div>
)}

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
        {categories.map((cat) => (
          <button
  key={cat}
  type="button"
  onClick={() => setActiveCategory(cat)}
  style={{
    padding: "10px 14px",
    borderRadius: "999px",
    border: "1px solid rgba(255,255,255,.12)",
    background: activeCategory === cat ? "rgba(16,185,129,.18)" : "rgba(255,255,255,.04)",
    color: activeCategory === cat ? "#d7fff1" : "#eaf0ff",
    fontWeight: 700,
    cursor: "pointer"
  }}
>
  {menu[cat].title}
</button>
        ))}
      </div>

      {admin && (
  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
    <button className="btn" type="button" onClick={addCategory}>
      + Add Category
    </button>

    {activeCategory && (
      <>
        <button className="btn" type="button" onClick={addItem}>
          + Add Item
        </button>

        <button className="btn secondary" type="button" onClick={editCategoryTitle}>
          Edit Category Name
        </button>

        <button className="btn danger" type="button" onClick={deleteActiveCategory}>
          Delete Category
        </button>

        <label className="btn secondary" style={{ cursor: "pointer" }}>
          Upload Category Image
          <input
            type="file"
            accept="image/*"
            style={{ display: "none" }}
            onChange={(e) => uploadCategoryImage(e.target.files?.[0])}
          />
        </label>
      </>
    )}
  </div>
)}

      {category.image && (
        <div className="card" style={{ marginBottom: 20, padding: 0, overflow: "hidden" }}>
          <img
            src={category.image}
            alt={category.title || "Menu category"}
            style={{
              width: "100%",
              maxHeight: "280px",
              objectFit: "cover",
              display: "block"
            }}
          />
          <div style={{ padding: 16 }}>
            <h2 style={{ margin: 0 }}>{category.title}</h2>
          </div>
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 280px))",
          gap: 18
        }}
      >
        {items.map((item) => (
          <div key={item.id} className="card">
            <img
              src={item.image}
              alt={item.name}
              style={{
                width: "100%",
                height: "110px",
                objectFit: "contain",
                backgroundColor: "rgba(255,255,255,0.03)",
                borderRadius: "12px",
                marginBottom: "12px"
              }}
            />

            <h3 style={{ margin: "4px 0 8px" }}>{item.name}</h3>

            <div className="muted" style={{ marginBottom: 10 }}>
              {item.description}
            </div>

            <div style={{ fontWeight: 800, fontSize: "1.1rem", marginBottom: 12 }}>
              ₹{item.price}
            </div>

            {admin ? (
  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
    <button className="btn secondary" type="button"
      onClick={() => {
        const value = prompt("Edit item name:", item.name);
        if (value !== null && value !== "") updateItem(item.id, "name", value);
      }}>
      Edit Name
    </button>

    <button className="btn secondary" type="button"
      onClick={() => {
        const value = prompt("Edit description:", item.description || "");
        if (value !== null) updateItem(item.id, "description", value);
      }}>
      Edit Details
    </button>

    <button className="btn secondary" type="button"
      onClick={() => {
        const value = prompt("Edit price:", item.price);
        if (value !== null && value !== "") updateItem(item.id, "price", value);
      }}>
      Edit Price
    </button>

    <label className="btn secondary" style={{ cursor: "pointer" }}>
      Upload Image
      <input
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => uploadItemImage(item.id, e.target.files?.[0])}
      />
    </label>

    <button className="btn" type="button" onClick={() => deleteItem(item.id)}>
      Delete
    </button>
  </div>
) : (
  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
    <button className="btn secondary" onClick={() => removeFromCart(item)}>
      −
    </button>

    <div style={{ fontWeight: 800, minWidth: 24, textAlign: "center" }}>
      {itemQty(item)}
    </div>

    <button className="btn" onClick={() => addToCart(item)}>
      + Add
    </button>
  </div>
)}
          </div>
        ))}
      </div>
    </div>
  );
}
function normalizedClubUpiId(value) {
  return String(value || "").trim();
}

function upiDeepLink({ pa = "", pn = "", am = "", tn = "" }) {
  const params = new URLSearchParams();

  if (pa) params.set("pa", pa);
  if (pn) params.set("pn", pn);
  if (am !== "" && am !== null && am !== undefined) {
    params.set("am", String(am));
  }
  if (tn) params.set("tn", tn);
  params.set("cu", "INR");

  return `upi://pay?${params.toString()}`;
}

function qrUrl(text, size = 280) {
  const safeText = encodeURIComponent(String(text || ""));
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${safeText}`;
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
  if (!name.trim()) {
    alert("Please enter name");
    return false;
  }

  if (!mobile.trim()) {
    alert("Please enter mobile number");
    return false;
  }

  if (!selectedTable) {
    alert("Please select table");
    return false;
  }

  if (!bookingDate) {
    alert("Please select date");
    return false;
  }

  if (bookingDate < todayIso()) {
    alert("Past dates are not allowed");
    return false;
  }

  if (!timeSlot) {
    alert("Please select a time slot");
    return false;
  }

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
    alert("This slot is already booked / pending for this table.");
    return false;
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
  return true;
}
function addBookingTable() {
  if (!admin) return alert("Admin only");

  const label = prompt("Table / Game name:", "New Table");
  if (!label) return;

  const price = prompt("Hourly rate:", "0");
  if (price === null) return;

  const nextTable = {
    id: `tbl_${Date.now()}`,
    label: label.trim(),
    pricePerHour: safeNum(price, 0),
  };

  const nextTables = [...tables, nextTable];

  commit({
    ...data,
    booking: {
      ...(data.booking || {}),
      tables: nextTables,
    },
  });

  setItemId(nextTable.id);
}
function editBookingTable(tableId) {
  if (!admin) return alert("Admin only");

  const current = tables.find((t) => t.id === tableId);
  if (!current) return;

  const label = prompt("Edit table / game name:", current.label || "");
  if (!label) return;

  const price = prompt("Edit hourly rate:", String(current.pricePerHour ?? 0));
  if (price === null) return;

  const nextTables = tables.map((t) =>
    t.id === tableId
      ? { ...t, label: label.trim(), pricePerHour: safeNum(price, 0) }
      : t
  );

  commit({
    ...data,
    booking: {
      ...(data.booking || {}),
      tables: nextTables,
    },
  });
}

function deleteBookingTable(tableId) {
  if (!admin) return alert("Admin only");

  const current = tables.find((t) => t.id === tableId);
  if (!current) return;

  if (!confirm(`Delete "${current.label}"?`)) return;

  const nextTables = tables.filter((t) => t.id !== tableId);

  commit({
    ...data,
    booking: {
      ...(data.booking || {}),
      tables: nextTables,
    },
  });

  if (itemId === tableId) {
    setItemId(nextTables[0]?.id || "");
  }
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
            {admin && (
  <div className="row" style={{ marginBottom: 12, gap: 8, flexWrap: "wrap" }}>
    <button className="btn" type="button" onClick={addBookingTable}>
      + Add Table
    </button>

    {selectedTable ? (
      <>
        <button
          className="btn secondary"
          type="button"
          onClick={() => editBookingTable(selectedTable.id)}
        >
          Edit Selected Table
        </button>

        <button
          className="btn danger"
          type="button"
          onClick={() => deleteBookingTable(selectedTable.id)}
        >
          Delete Selected Table
        </button>
      </>
    ) : null}
  </div>
)}

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
    {`${t.label.split("₹")[0].trim()} – ₹${bookingAmountFor(
      t,
      bookingType === "member" ? "member" : "nonmember"
    )} / hour`}
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
  localStorage.setItem("qclub_payment_context", "booking");
localStorage.setItem("qclub_payment_name", name.trim());
localStorage.setItem("qclub_payment_mobile", mobile.trim());
localStorage.setItem("qclub_booking_table", selectedTable?.label || "");
localStorage.setItem("qclub_booking_date", bookingDate || "");
localStorage.setItem("qclub_booking_slot", timeSlot || "");

  const ok = submitBooking();
if (!ok) return;
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
  const [tshirtSize, setTshirtSize] = useState("M");
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
      tshirtSize,
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
        <div className="cols-6">
  <label className="lbl">T-Shirt Size</label>
  <select
    value={tshirtSize}
    onChange={(e) => setTshirtSize(e.target.value)}
  >
    <option value="S">S</option>
    <option value="M">M</option>
    <option value="L">L</option>
    <option value="XL">XL</option>
    <option value="XXL">XXL</option>
    <option value="XXXL">XXXL</option>
  </select>
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
  localStorage.setItem("qclub_payment_context", "membership");
localStorage.setItem("qclub_payment_name", applicantName.trim());
localStorage.setItem("qclub_payment_mobile", mobile.trim());
localStorage.setItem("qclub_membership_tier", selectedTier?.tier || "");
localStorage.setItem("qclub_tshirt_size", tshirtSize || "");

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
      const caption = prompt("Caption (optional):", "") || "";
      const uploaded = await uploadImageToStorage(file, "gallery");

      commit({
        ...data,
        photos: [
          {
            id: uid(),
            url: uploaded.url,
            storagePath: uploaded.path,
            caption: caption.trim(),
            createdAt: Date.now(),
          },
          ...(data.photos || []),
        ],
      });

      e.target.value = "";
    } catch (err) {
      console.error(err);
      alert("Failed to upload image. If this is your first storage upload, add Storage INSERT/UPDATE/DELETE policies for the photos bucket in Supabase.");
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

  async function deletePhoto(id) {
    if (!admin) return alert("Admin only");
    if (!confirm("Delete this photo?")) return;

    const current = (data.photos || []).find((p) => p.id === id);
    await deleteStorageObject(current?.storagePath);

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
  src={p.url || p.dataUrl}
  alt={p.caption || "The Q Club"}
  style={{
    cursor: "pointer",
    height: 220,
    objectFit: "contain",
    width: "100%",
    background: "#0b1020",
    borderRadius: 12,
    padding: 8
  }}
  onClick={() => setActivePhoto(p.url || p.dataUrl)}
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
  const location = useLocation();
  const [selectedPlayerId, setSelectedPlayerId] = useState("");
  const [viewGame, setViewGame] = useState("snooker");

  const players = data.players || [];

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const pid = params.get("playerId") || "";
    if (!pid) return;
    const found = players.find((p) => p.id === pid);
    if (!found) return;
    setSelectedPlayerId(pid);
    const games = normalizePlayerGames(found.games);
    if (games.includes("snooker")) setViewGame("snooker");
    else if (games.includes("pool")) setViewGame("pool");
  }, [location.search, players]);

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
      const current = (data.players || []).find((p) => p.id === id);
      const uploaded = await uploadImageToStorage(file, "players");
      await deleteStorageObject(current?.photoPath);

      commit({
        ...data,
        players: (data.players || []).map((p) =>
          p.id === id ? { ...p, photo: uploaded.url, photoPath: uploaded.path } : p
        ),
      });
    } catch (err) {
      console.error(err);
      alert("Failed to upload photo. If this is your first storage upload, add Storage INSERT/UPDATE/DELETE policies for the photos bucket in Supabase.");
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

  async function deletePlayer(id) {
    if (!admin) return alert("Admin only");
    if (!confirm("Delete this player?")) return;

    const current = (data.players || []).find((p) => p.id === id);
    await deleteStorageObject(current?.photoPath);

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
          style={{ alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}
        >
          {selectedPlayer.photo ? (
  <div
    style={{
      width: 220,
      height: 320,
      minWidth: 220,
      flexShrink: 0,
      borderRadius: 18,
      overflow: "hidden",
      background: "rgba(255,255,255,.06)",
      border: "1px solid rgba(255,255,255,.10)",
    }}
  >
    <img
      src={selectedPlayer.photo}
      alt={selectedPlayer.name}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "cover",
        display: "block",
      }}
    />
  </div>
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
       <div className="grid" style={{ marginTop: 16 }}>     <div className="muted" style={{ marginTop: 6 }}>
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
            {(() => {
  let best = 0;

  (data.tournaments || []).forEach((t) => {
    (t.matches || []).forEach((m) => {
      if (m.status !== "done") return;

      if (m.p1 === selectedPlayer.id) {
        const b = Number(m.break1 || 0);
        if (Number.isFinite(b) && b > best) best = b;
      }

      if (m.p2 === selectedPlayer.id) {
        const b = Number(m.break2 || 0);
        if (Number.isFinite(b) && b > best) best = b;
      }
    });
  });

  return best;
})()}

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
  format: "round_robin",
  participantIds: [],
  matches: [],
}
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
function Fixtures({ data, admin, commit, onOpenPlayer }) {
  const tournaments = data.tournaments || [];
  
  const location = useLocation();
const queryGame = new URLSearchParams(location.search).get("game");
  const players = data.players || [];
  const [selectedTournamentId, setSelectedTournamentId] = useState(() => {
  if (queryGame) {
    const matched = tournaments.find(
      (t) => String(t.game || "").toLowerCase() === queryGame.toLowerCase()
    );
    if (matched) return matched.id;
  }
  return tournaments[0]?.id || "";
});
useEffect(() => {
  if (!queryGame) return;
  const matched = tournaments.find(
    (t) => String(t.game || "").toLowerCase() === queryGame.toLowerCase()
  );
  if (matched && matched.id !== selectedTournamentId) {
    setSelectedTournamentId(matched.id);
  }
}, [queryGame, tournaments, selectedTournamentId]);

  useEffect(() => {
    if (!selectedTournamentId && tournaments[0]?.id) {
      setSelectedTournamentId(tournaments[0].id);
    }
  }, [selectedTournamentId, tournaments]);

  const selectedTournament =
  tournaments.find((t) => t.id === selectedTournamentId) || null;

const isKnockout = selectedTournament?.format === "knockout";

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

  function generateFixtures(format = "round_robin") {
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

    const matches =
  format === "knockout"
    ? generateKnockout(pool.map((p) => p.id))
    : generateRoundRobin(pool.map((p) => p.id));

    commit({
      ...data,
      tournaments: tournaments.map((t) =>
        t.id === selectedTournament.id
          ? { ...t, format, matches }
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
  function advanceKnockoutWinner(matchId) {
  if (!admin || !selectedTournament) return;

  const allMatches = selectedTournament.matches || [];
  const match = allMatches.find((m) => m.id === matchId);
  if (!match) return;

  if (!match.winner) {
    alert("Please select winner first.");
    return;
  }

  const round = Number(match.round || 0);
  const matchNo = Number(match.matchNo || 0);

  const winnerToken = `WINNER_R${round}_M${matchNo}`;

  const updatedMatches = allMatches.map((m) => {
    if (m.id === match.id) {
      return {
        ...m,
        status: "done",
        updatedAt: Date.now(),
      };
    }

    let changed = false;
    const next = { ...m };

    if (next.p1 === winnerToken) {
      next.p1 = match.winner;
      changed = true;
    }

    if (next.p2 === winnerToken) {
      next.p2 = match.winner;
      changed = true;
    }

    if (changed) {
      next.updatedAt = Date.now();
    }

    return next;
  });

  commit({
    ...data,
    tournaments: tournaments.map((t) =>
      t.id !== selectedTournament.id
        ? t
        : {
            ...t,
            matches: updatedMatches,
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
function updateMatchStatus(matchId, status) {

  commit({
    ...data,
    tournaments: tournaments.map((t) =>
      t.id !== selectedTournament.id
        ? t
        : {
            ...t,
            matches: (t.matches || []).map((m) =>
              m.id === matchId
                ? { ...m, status, updatedAt: Date.now() }
                : m
            ),
          }
    ),
  });

}
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
  <>
    <button className="btn" onClick={() => generateFixtures("round_robin")}>
      Generate Round Robin
    </button>
    <button className="btn primary" onClick={() => generateFixtures("knockout")}>
      Generate Knockout
    </button>
  </>
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
              {admin ? (
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
              ) : null}

              <div className={`card ${admin ? "cols-7" : "cols-12"}`}>
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <h2 style={{ margin: 0 }}>Standings Preview</h2>
                  {admin ? (
    <button
      className="btn"
      onClick={() => {
  const name = prompt("Player Name");
  if (!name) return;

  const value = prompt("Highest Break");
  if (value === null) return;

  const player = data.players.find(
    (x) => x.name.toLowerCase() === name.trim().toLowerCase()
  );

  if (!player) {
    alert("Player not found");
    return;
  }

  commit({
    ...data,
    players: (data.players || []).map((p) =>
      p.id === player.id
        ? { ...p, bestBreak: Number(value || 0) }
        : p
    ),
  });

  alert("Highest Break updated");
}}
    >
      Edit Break
    </button>
  ) : null}
                  <span className="badge">
  <span className="dot warn" />
  Format: {selectedTournament?.format === "knockout" ? "Knockout" : "Round Robin"}
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
<th>L</th>
<th>Pts</th>
{tournamentGameKey(selectedTournament.game) === "snooker" ? <th>Highest Break</th> : null}
                        </tr>
                      </thead>
                      <tbody>
                        {standings.map((r, i) => (
                          <tr key={r.id}>
                            <td>#{i + 1}</td>
<td>
  <span
    className="player-link"
    onClick={() => onOpenPlayer(r.id)}
    style={{ color: "inherit", textDecoration: "underline", cursor: "pointer" }}
  >
    {r.name}
  </span>
</td>
<td>{r.played}</td>
<td>{r.wins}</td>
<td>{r.losses}</td>
<td>{r.points}</td>
{tournamentGameKey(selectedTournament.game) === "snooker" ? (
  <td>{r.highestBreak || 0}</td>
) : null}

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
                          <th>{isKnockout ? "Winner" : "Score 1"}</th>
                          <th>{isKnockout ? "Result" : "Score 2"}</th>
                          <th>Break 1</th>
<th>Break 2</th>
                          <th>Status</th>
                          <th>Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(selectedTournament.matches || []).map((m) => (
                          <tr key={m.id}>
                            <td>{m.round}</td>
                            <td>
                              <>
  <span
    className="player-link"
    onClick={() => onOpenPlayer(m.p1)}
    style={{ textDecoration: "underline", cursor: "pointer" }}
  >
    {playerName(m.p1)}
  </span>
  {" "}vs{" "}
  <span
    className="player-link"
    onClick={() => onOpenPlayer(m.p2)}
    style={{ textDecoration: "underline", cursor: "pointer" }}
  >
    {playerName(m.p2)}
  </span>
</>
                            </td>
                            <td>
  {!isKnockout ? (
    <input
      value={m.score1}
      onChange={(e) =>
        updateMatchField(m.id, "score1", e.target.value)
      }
      disabled={!admin}
      style={{ width: 80 }}
    />
  ) : (
    <select
      value={m.winner || ""}
      disabled={!admin}
      onChange={(e) =>
        updateMatchField(m.id, "winner", e.target.value)
      }
    >
      <option value="">Select</option>
      <option value={m.p1}>{playerName(m.p1)}</option>
      <option value={m.p2}>{playerName(m.p2)}</option>
    </select>
  )}
</td>
                            <td>
  {!isKnockout ? (
    <input
      value={m.score2}
      onChange={(e) =>
        updateMatchField(m.id, "score2", e.target.value)
      }
      disabled={!admin}
      style={{ width: 80 }}
    />
  ) : (
    <input
      value={m.result || ""}
      onChange={(e) =>
        updateMatchField(m.id, "result", e.target.value)
      }
      disabled={!admin}
      placeholder={m.bestOf === 5 ? "3-2" : "2-1"}
      style={{ width: 80 }}
    />
  )}
</td><td>
  <input
    type="text"
    inputMode="numeric"
    placeholder="0"
    value={m.break1 || ""}
    onChange={(e) =>
      updateMatchField(
        m.id,
        "break1",
        e.target.value.replace(/[^0-9]/g, "")
      )
    }
    disabled={!admin}
    style={{ width: 80 }}
  />
</td>
<td>
  <input
    type="text"
    inputMode="numeric"
    placeholder="0"
    value={m.break2 || ""}
    onChange={(e) =>
      updateMatchField(
        m.id,
        "break2",
        e.target.value.replace(/[^0-9]/g, "")
      )
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
    {isKnockout ? (
      m.status === "done" ? (
        <button
          className="btn"
          onClick={() => reopenMatch(m.id)}
        >
          Reopen
        </button>
      ) : (
        <button
          className="btn primary"
          onClick={() => advanceKnockoutWinner(m.id)}
        >
          Advance Winner
        </button>
      )
    ) : (
      m.status === "done" ? (
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
      )
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

function LeaderboardAll({ data, onOpenPlayer }) {
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
<th>L</th>
<th>Pts</th>
{selectedGameKey === "snooker" ? <th>Highest Break</th> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {standings.map((r, i) => (
                      <tr key={r.id}>
                        <td>#{i + 1}</td>
<td>
  <span
    className="player-link"
    onClick={() => onOpenPlayer(r.id)}
    style={{ textDecoration: "underline", cursor: "pointer" }}
  >
    {r.name}
  </span>
</td>
<td>{r.city || "—"}</td>
<td>{r.played}</td>
<td>{r.wins}</td>
<td>{r.losses}</td>
<td>{r.points}</td>
{selectedGameKey === "snooker" ? (
  <td>{r.highestBreak || 0}</td>
) : null}

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
<th>P</th>
<th>W</th>
<th>L</th>
<th>Pts</th>
<th>Highest Break</th>
          </tr>
        </thead>
        <tbody>
          {snookerBoard.map((r, i) => (
            <tr key={r.id}>
              <td>#{i + 1}</td>
<td>
  <span
    className="player-link"
    onClick={() => onOpenPlayer(r.id)}
    style={{ color: "inherit", textDecoration: "underline", cursor: "pointer" }}
  >
    {r.name}
  </span>
</td>
<td>{r.matches}</td>
<td>{r.wins}</td>
<td>{r.losses}</td>
<td>{r.points}</td>
<td>{r.highestBreak || 0}</td>

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
<th>P</th>
<th>W</th>
<th>L</th>
<th>Pts</th>
          </tr>
        </thead>
        <tbody>
          {poolBoard.map((r, i) => (
            <tr key={r.id}>
              <td>#{i + 1}</td>
<td>
  <span
    className="player-link"
    onClick={() => onOpenPlayer(r.id)}
    style={{ color: "inherit", textDecoration: "underline", cursor: "pointer" }}
  >
    {r.name}
  </span>
</td>
<td>{r.matches}</td>
<td>{r.wins}</td>
<td>{r.losses}</td>
<td>{r.points}</td>
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

  async function deleteEntry(id) {
    if (!admin) return;
    if (!confirm("Delete this entry?")) return;

    const current = entries.find((x) => x.id === id);
    await deleteStorageObject(current?.photoPath);

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

  async function uploadPhoto(id, file) {
    if (!admin) return alert("Admin only");
    if (!file) return;

    try {
      const current = entries.find((x) => x.id === id);
      const uploaded = await uploadImageToStorage(file, "hall-of-fame");
      await deleteStorageObject(current?.photoPath);

      commit({
        ...data,
        hallOfFame: entries.map((x) =>
          x.id === id ? { ...x, photo: uploaded.url, photoPath: uploaded.path } : x
        ),
      });
    } catch (err) {
      console.error(err);
      alert("Failed to upload photo. If this is your first storage upload, add Storage INSERT/UPDATE/DELETE policies for the photos bucket in Supabase.");
    }
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





function LiveMatchesHeroCard({ data }) {
  const [summary, setSummary] = useState({ total: 0, live: 0, singles: 0, doubles: 0 });

  useEffect(() => {
    if (!supabaseReady || !supabase) return;

    let alive = true;

    const loadSummary = async () => {
      const { data: rows, error } = await supabase
        .from("live_matches")
        .select("id, match_type, status");
      if (!alive || error) return;
      const list = rows || [];
      setSummary({
        total: list.length,
        live: list.filter((x) => x.status === "live").length,
        singles: list.filter((x) => x.match_type === "singles").length,
        doubles: list.filter((x) => x.match_type === "doubles").length,
      });
    };

    loadSummary();

    const channel = supabase
      .channel("live-matches-hero-summary")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "live_matches" },
        () => loadSummary()
      )
      .subscribe();

    return () => {
      alive = false;
      try { supabase.removeChannel(channel); } catch {}
    };
  }, []);

  const hasLive = summary.live > 0;

  return (
    <section
      className="card"
      style={{
        marginTop: 18,
        border: hasLive ? "1px solid rgba(255,80,80,.45)" : undefined,
        boxShadow: hasLive ? "0 0 0 1px rgba(255,80,80,.12), 0 18px 50px rgba(255,80,80,.10)" : undefined,
      }}
    >
      <div className="row" style={{ justifyContent: "space-between", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
        <div>
          <div className="badge" style={{ marginBottom: 8 }}>
            <span className={hasLive ? "dot red" : "dot warn"} />
            {hasLive ? "LIVE NOW" : "TODAY'S MATCHUPS"}
          </div>
          <h2 style={{ margin: 0 }}>Live Matches</h2>
          <div className="muted" style={{ marginTop: 8 }}>
            {hasLive
              ? `${summary.live} live match${summary.live > 1 ? "es" : ""} running now`
              : "Follow today's snooker and pool singles / doubles matches"}
          </div>
        </div>

        <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
          <span className="badge"><span className="dot" />Total: {summary.total}</span>
          <span className="badge"><span className="dot" />Singles: {summary.singles}</span>
          <span className="badge"><span className="dot" />Doubles: {summary.doubles}</span>
          <Link
            to="/live"
            className="btn primary"
            style={{
              minWidth: 180,
              textAlign: "center",
              animation: hasLive ? "pulseGlow 1.2s infinite" : "none",
            }}
          >
            {hasLive ? "🔴 LIVE MATCHES NOW" : "Open Live Matches"}
          </Link>
          <a
  href={data.club?.liveStreamUrl || "#"}
  target="_blank"
  rel="noopener noreferrer"
  className="btn"
  style={{ marginLeft: 10 }}
>
  📺 Watch it Live
</a>
        </div>
      </div>
    </section>
  );
}


function LiveMatches({ data, admin, onOpenPlayer }) {
  const [rows, setRows] = useState([]);
  const [gameFilter, setGameFilter] = useState("snooker");
  const [typeFilter, setTypeFilter] = useState("all");
  const [loading, setLoading] = useState(true);

  const players = data.players || [];
  const playerMap = useMemo(() => new Map(players.map((p) => [p.id, p])), [players]);

  function nowDateIso() {
    return new Date().toISOString().slice(0, 10);
  }

  function nowTimeValue() {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function formatDateLabel(value) {
    if (!value) return "—";
    try {
      return new Date(value).toLocaleDateString();
    } catch {
      return value;
    }
  }

  function formatTimeLabel(value) {
    if (!value) return "—";
    return value;
  }

  function calcDurationLabel(startTime, endTime) {
    if (!startTime || !endTime) return "—";
    const [sh, sm] = String(startTime).split(":").map(Number);
    const [eh, em] = String(endTime).split(":").map(Number);
    if (![sh, sm, eh, em].every(Number.isFinite)) return "—";
    let startMins = sh * 60 + sm;
    let endMins = eh * 60 + em;
    if (endMins < startMins) endMins += 24 * 60;
    const diff = endMins - startMins;
    const hours = Math.floor(diff / 60);
    const mins = diff % 60;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  }

  function getWinnerInfo(row) {
    const s1 = safeNum(row.score1, 0);
    const s2 = safeNum(row.score2, 0);
    if (s1 === s2) {
      return {
        label: "Draw",
        photo: "",
        breakValue: Math.max(safeNum(row.break1, 0), safeNum(row.break2, 0)),
      };
    }

    if (row.match_type === "doubles") {
      const teamNo = s1 > s2 ? 1 : 2;
      const ids = teamNo === 1 ? [row.player1, row.player2] : [row.player3, row.player4];
      return {
        label: teamLabel(row, teamNo),
        photo: playerPhoto(ids[0]),
        breakValue: teamNo === 1 ? safeNum(row.break1, 0) : safeNum(row.break2, 0),
      };
    }

    const winnerId = s1 > s2 ? row.player1 : row.player2;
    return {
      label: playerName(winnerId),
      photo: playerPhoto(winnerId),
      breakValue: s1 > s2 ? safeNum(row.break1, 0) : safeNum(row.break2, 0),
    };
  }

  const [form, setForm] = useState({
    id: "",
    title: "",
    match_type: "singles",
    game: "snooker",
    status: "upcoming",
    match_date: nowDateIso(),
    start_time: "",
    end_time: "",
    player1: "",
    player2: "",
    player3: "",
    player4: "",
    team1_name: "",
    team2_name: "",
    score1: 0,
    score2: 0,
    break1: 0,
    break2: 0,
  });

  async function fetchMatches() {
    if (!supabaseReady || !supabase) {
      setLoading(false);
      return;
    }
    setLoading(true);
    const { data: liveRows, error } = await supabase
      .from("live_matches")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) {
      console.error("live_matches fetch error:", error);
      setLoading(false);
      return;
    }
    setRows(liveRows || []);
    setLoading(false);
  }

  useEffect(() => {
    fetchMatches();
    if (!supabaseReady || !supabase) return;

    const channel = supabase
      .channel("live-matches-page")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "live_matches" },
        () => fetchMatches()
      )
      .subscribe();

    return () => {
      try { supabase.removeChannel(channel); } catch {}
    };
  }, []);

  function resetForm() {
    setForm({
      id: "",
      title: "",
      match_type: "singles",
      game: "snooker",
      status: "upcoming",
      match_date: nowDateIso(),
      start_time: "",
      end_time: "",
      player1: "",
      player2: "",
      player3: "",
      player4: "",
      team1_name: "",
      team2_name: "",
      score1: 0,
      score2: 0,
      break1: 0,
      break2: 0,
    });
  }

  async function saveMatch() {
    if (!admin) return alert("Admin only");
    if (!supabaseReady || !supabase) return alert("Supabase is not ready.");

    const payload = {
      id: form.id || uid(),
      title: String(form.title || "").trim(),
      match_type: form.match_type,
      game: form.game,
      status: form.status,
      match_date: form.match_date || nowDateIso(),
      start_time: String(form.start_time || "").trim(),
      end_time: String(form.end_time || "").trim(),
      player1: form.player1 || "",
      player2: form.player2 || "",
      player3: form.match_type === "doubles" ? form.player3 || "" : "",
      player4: form.match_type === "doubles" ? form.player4 || "" : "",
      team1_name: String(form.team1_name || "").trim(),
      team2_name: String(form.team2_name || "").trim(),
      score1: safeNum(form.score1, 0),
      score2: safeNum(form.score2, 0),
      break1: form.game === "snooker" ? safeNum(form.break1, 0) : 0,
      break2: form.game === "snooker" ? safeNum(form.break2, 0) : 0,
      updated_at: new Date().toISOString(),
    };

    const { error } = await supabase.from("live_matches").upsert(payload);
    if (error) {
      console.error(error);
      alert("Failed to save live match.");
      return;
    }

    resetForm();
    fetchMatches();
  }

  async function quickUpdateMatch(id, patch) {
    if (!admin) return alert("Admin only");
    const { error } = await supabase
      .from("live_matches")
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id);
    if (error) {
      console.error(error);
      alert("Failed to update live match.");
      return;
    }
    fetchMatches();
  }

  function editMatch(row) {
    setForm({
      id: row.id || "",
      title: row.title || "",
      match_type: row.match_type || "singles",
      game: row.game || "snooker",
      status: row.status || "upcoming",
      match_date: row.match_date || nowDateIso(),
      start_time: row.start_time || "",
      end_time: row.end_time || "",
      player1: row.player1 || "",
      player2: row.player2 || "",
      player3: row.player3 || "",
      player4: row.player4 || "",
      team1_name: row.team1_name || "",
      team2_name: row.team2_name || "",
      score1: safeNum(row.score1, 0),
      score2: safeNum(row.score2, 0),
      break1: safeNum(row.break1, 0),
      break2: safeNum(row.break2, 0),
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function deleteMatch(id) {
    if (!admin) return alert("Admin only");
    if (!confirm("Delete this live match?")) return;
    const { error } = await supabase.from("live_matches").delete().eq("id", id);
    if (error) {
      console.error(error);
      alert("Failed to delete live match.");
      return;
    }
    fetchMatches();
  }

  const filteredPlayers = players.filter((p) => normalizePlayerGames(p.games).includes(form.game));

  function renderPlayerSelect(label, keyName) {
    return (
      <div className="cols-6">
        <label className="lbl">{label}</label>
        <select value={form[keyName]} onChange={(e) => setForm({ ...form, [keyName]: e.target.value })}>
          <option value="">Select player</option>
          {filteredPlayers.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>
    );
  }

  function playerName(id) {
    return playerMap.get(id)?.name || "Player";
  }

  function playerPhoto(id) {
    return playerMap.get(id)?.photo || "";
  }

  function teamLabel(row, side) {
    const pA = side === 1 ? row.player1 : row.player3;
    const pB = side === 1 ? row.player2 : row.player4;
    const custom = side === 1 ? row.team1_name : row.team2_name;
    if (custom) return custom;
    if (row.match_type !== "doubles") return playerName(side === 1 ? row.player1 : row.player2);
    return [playerName(pA), playerName(pB)].join(" + ");
  }

  const visibleRows = rows.filter((row) => {
    if (row.game !== gameFilter) return false;
    if (typeFilter !== "all" && row.match_type !== typeFilter) return false;
    return true;
  });

  const liveRows = visibleRows.filter((x) => x.status === "live");
  const otherRows = visibleRows.filter((x) => x.status !== "live");

  return (
    <>
      <PageShell
        title="Live Matches"
        subtitle="Daily snooker and pool singles / doubles"
        right={
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button className={`btn ${gameFilter === "snooker" ? "primary" : ""}`} onClick={() => setGameFilter("snooker")}>Snooker</button>
            <button className={`btn ${gameFilter === "pool" ? "primary" : ""}`} onClick={() => setGameFilter("pool")}>Pool</button>
            <button className={`btn ${typeFilter === "all" ? "primary" : ""}`} onClick={() => setTypeFilter("all")}>All</button>
            <button className={`btn ${typeFilter === "singles" ? "primary" : ""}`} onClick={() => setTypeFilter("singles")}>Singles</button>
            <button className={`btn ${typeFilter === "doubles" ? "primary" : ""}`} onClick={() => setTypeFilter("doubles")}>Doubles</button>
          </div>
        }
      />

      <div className="container">
        {admin ? (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <h2 style={{ margin: 0 }}>{form.id ? "Edit Live Match" : "Add Live Match"}</h2>
              {form.id ? <button className="btn" onClick={resetForm}>Clear</button> : null}
            </div>

            <div className="grid" style={{ marginTop: 14 }}>
              <div className="cols-6">
                <label className="lbl">Title (optional)</label>
                <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Evening Singles Showdown" />
              </div>

              <div className="cols-3">
                <label className="lbl">Game</label>
                <select value={form.game} onChange={(e) => setForm({ ...form, game: e.target.value })}>
                  <option value="snooker">Snooker</option>
                  <option value="pool">Pool</option>
                </select>
              </div>

              <div className="cols-3">
                <label className="lbl">Match Type</label>
                <select value={form.match_type} onChange={(e) => setForm({ ...form, match_type: e.target.value, player3: "", player4: "" })}>
                  <option value="singles">Singles</option>
                  <option value="doubles">Doubles</option>
                </select>
              </div>

              <div className="cols-3">
                <label className="lbl">Status</label>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  <option value="upcoming">Upcoming</option>
                  <option value="live">Live</option>
                  <option value="finished">Finished</option>
                </select>
              </div>

              <div className="cols-3">
                <label className="lbl">Date</label>
                <input type="date" value={form.match_date} onChange={(e) => setForm({ ...form, match_date: e.target.value })} />
              </div>

              <div className="cols-3">
                <label className="lbl">Start Time</label>
                <input type="time" value={form.start_time} onChange={(e) => setForm({ ...form, start_time: e.target.value })} />
              </div>

              <div className="cols-3">
                <label className="lbl">End Time</label>
                <input type="time" value={form.end_time} onChange={(e) => setForm({ ...form, end_time: e.target.value })} />
              </div>

              {renderPlayerSelect(form.match_type === "singles" ? "Player 1" : "Team A - Player 1", "player1")}
              {renderPlayerSelect(form.match_type === "singles" ? "Player 2" : "Team A - Player 2", "player2")}

              {form.match_type === "doubles" ? (
                <>
                  {renderPlayerSelect("Team B - Player 1", "player3")}
                  {renderPlayerSelect("Team B - Player 2", "player4")}
                  <div className="cols-6">
                    <label className="lbl">Team A Name (optional)</label>
                    <input value={form.team1_name} onChange={(e) => setForm({ ...form, team1_name: e.target.value })} placeholder="Cue Masters" />
                  </div>
                  <div className="cols-6">
                    <label className="lbl">Team B Name (optional)</label>
                    <input value={form.team2_name} onChange={(e) => setForm({ ...form, team2_name: e.target.value })} placeholder="Pocket Kings" />
                  </div>
                </>
              ) : null}

              <div className="cols-3">
                <label className="lbl">Score 1</label>
                <input type="number" value={form.score1} onChange={(e) => setForm({ ...form, score1: e.target.value })} />
              </div>
              <div className="cols-3">
                <label className="lbl">Score 2</label>
                <input type="number" value={form.score2} onChange={(e) => setForm({ ...form, score2: e.target.value })} />
              </div>

              {form.game === "snooker" ? (
                <>
                  <div className="cols-3">
                    <label className="lbl">Highest Break 1</label>
                    <input type="number" value={form.break1} onChange={(e) => setForm({ ...form, break1: e.target.value })} />
                  </div>
                  <div className="cols-3">
                    <label className="lbl">Highest Break 2</label>
                    <input type="number" value={form.break2} onChange={(e) => setForm({ ...form, break2: e.target.value })} />
                  </div>
                </>
              ) : null}
            </div>

            <div className="row" style={{ marginTop: 14 }}>
              <button className="btn primary" onClick={saveMatch}>{form.id ? "Update Match" : "Add Match"}</button>
              <button className="btn" onClick={() => setForm({ ...form, start_time: nowTimeValue(), match_date: form.match_date || nowDateIso() })}>Set Start Now</button>
              <button className="btn" onClick={() => setForm({ ...form, end_time: nowTimeValue() })}>Set End Now</button>
            </div>
          </div>
        ) : null}

        <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
          <div className="badge"><span className="dot red" />Live: {liveRows.length}</div>
          <div className="badge"><span className="dot" />Total: {visibleRows.length}</div>
        </div>

        {loading ? (
          <div className="card"><div className="muted">Loading live matches...</div></div>
        ) : visibleRows.length === 0 ? (
          <div className="card"><div className="muted">No live matches added yet.</div></div>
        ) : (
          <>
            {liveRows.length ? <h2 style={{ marginBottom: 10 }}>Live Now</h2> : null}
            <div className="grid">
              {liveRows.map((row) => (
                <div className="card cols-6" key={row.id} style={{ border: "1px solid rgba(255,80,80,.35)" }}>
                  <div className="row" style={{ justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                    <div>
                      <div className="badge"><span className="dot red" />LIVE</div>
                      <h2 style={{ marginTop: 8, marginBottom: 6 }}>{row.title || `${row.game === "pool" ? "Pool" : "Snooker"} ${row.match_type === "doubles" ? "Doubles" : "Singles"}`}</h2>
                      <div className="muted">{row.game === "pool" ? "Pool" : "Snooker"} • {row.match_type === "doubles" ? "Doubles" : "Singles"}</div>
                      <div className="muted" style={{ marginTop: 6 }}>
                        Date: {formatDateLabel(row.match_date)} • Start: {formatTimeLabel(row.start_time)} • Duration: {calcDurationLabel(row.start_time, row.end_time || nowTimeValue())}
                      </div>
                    </div>
                    {admin ? (
                      <div className="row">
                        <button className="btn" onClick={() => editMatch(row)}>Edit</button>
                        <button className="btn primary" onClick={() => quickUpdateMatch(row.id, { status: "finished", end_time: row.end_time || nowTimeValue() })}>End Match</button>
                        <button className="btn danger" onClick={() => deleteMatch(row.id)}>Delete</button>
                      </div>
                    ) : null}
                  </div>

                  <div style={{ marginTop: 16, display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 12, alignItems: "center" }}>
                    {[1, 2].map((side) => {
                      const ids = row.match_type === "doubles"
                        ? (side === 1 ? [row.player1, row.player2] : [row.player3, row.player4])
                        : [side === 1 ? row.player1 : row.player2].filter(Boolean);
                      const label = teamLabel(row, side);
                      return (
                        <div key={side} style={{ textAlign: "center" }}>
                          <div className="row" style={{ justifyContent: "center", gap: 8, flexWrap: "wrap" }}>
                            {ids.map((pid) => (
                              playerPhoto(pid) ? (
                                <img key={pid} src={playerPhoto(pid)} alt={playerName(pid)} style={{ width: 68, height: 68, borderRadius: 14, objectFit: "cover" }} />
                              ) : (
                                <div key={pid} style={{ width: 68, height: 68, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,.08)", fontWeight: 900 }}>
                                  {String(playerName(pid)).slice(0,1).toUpperCase()}
                                </div>
                              )
                            ))}
                          </div>
                          <div style={{ marginTop: 10, fontWeight: 800, fontSize: 20 }}>{label}</div>
                          <div className="muted" style={{ marginTop: 6 }}>
                            {ids.map((pid, idx) => (
  <span key={pid}>
    <span
      className="player-link"
      onClick={() => onOpenPlayer(pid)}
      style={{ color: "inherit", textDecoration: "underline", cursor: "pointer" }}
    >
      {playerName(pid)}
    </span>
    {idx < ids.length - 1 ? " + " : ""}
  </span>
))}
                          </div>
                        </div>
                      );
                    })}

                    <div style={{ textAlign: "center", minWidth: 110 }}>
                      <div style={{ fontSize: 34, fontWeight: 900 }}>{safeNum(row.score1, 0)} : {safeNum(row.score2, 0)}</div>
                      {row.game === "snooker" ? (
                        <div className="muted" style={{ marginTop: 8 }}>
                          Breaks: {safeNum(row.break1, 0)} / {safeNum(row.break2, 0)}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {otherRows.length ? <h2 style={{ marginTop: 18, marginBottom: 10 }}>Upcoming / Finished</h2> : null}
            <div className="grid">
              {otherRows.map((row) => {
                const winner = row.status === "finished" ? getWinnerInfo(row) : null;
                return (
                  <div className="card cols-6" key={row.id}>
                    <div className="row" style={{ justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                      <div>
                        <div className="badge"><span className={row.status === "finished" ? "dot" : "dot warn"} />{String(row.status || "upcoming").toUpperCase()}</div>
                        <h2 style={{ marginTop: 8, marginBottom: 6 }}>{row.title || `${row.game === "pool" ? "Pool" : "Snooker"} ${row.match_type === "doubles" ? "Doubles" : "Singles"}`}</h2>
                        <div className="muted">{teamLabel(row, 1)} vs {teamLabel(row, 2)}</div>
                        <div className="muted" style={{ marginTop: 6 }}>
                          Date: {formatDateLabel(row.match_date)} • Start: {formatTimeLabel(row.start_time)} • End: {formatTimeLabel(row.end_time)} • Total: {calcDurationLabel(row.start_time, row.end_time)}
                        </div>
                      </div>
                      <div style={{ fontSize: 28, fontWeight: 900 }}>{safeNum(row.score1, 0)} : {safeNum(row.score2, 0)}</div>
                    </div>

                    <div className="muted" style={{ marginTop: 12 }}>
                      {row.match_type === "doubles"
  ? (
    <>
      <span
        className="player-link"
        onClick={() => onOpenPlayer(row.player1)}
        style={{ textDecoration: "underline", cursor: "pointer" }}
      >
        {playerName(row.player1)}
      </span>
      {" + "}
      <span
        className="player-link"
        onClick={() => onOpenPlayer(row.player2)}
        style={{ textDecoration: "underline", cursor: "pointer" }}
      >
        {playerName(row.player2)}
      </span>
      {" "}vs{" "}
      <span
        className="player-link"
        onClick={() => onOpenPlayer(row.player3)}
        style={{ textDecoration: "underline", cursor: "pointer" }}
      >
        {playerName(row.player3)}
      </span>
      {" + "}
      <span
        className="player-link"
        onClick={() => onOpenPlayer(row.player4)}
        style={{ textDecoration: "underline", cursor: "pointer" }}
      >
        {playerName(row.player4)}
      </span>
    </>
  )
  : (
    <>
      <span
        className="player-link"
        onClick={() => onOpenPlayer(row.player1)}
        style={{ textDecoration: "underline", cursor: "pointer" }}
      >
        {playerName(row.player1)}
      </span>
      {" "}vs{" "}
      <span
        className="player-link"
        onClick={() => onOpenPlayer(row.player2)}
        style={{ textDecoration: "underline", cursor: "pointer" }}
      >
        {playerName(row.player2)}
      </span>
    </>
  )}
                    </div>

                    {row.status === "finished" ? (
                      <div
                        className="card"
                        style={{
                          marginTop: 14,
                          marginBottom: 0,
                          padding: 14,
                          borderRadius: 16,
                          background: "linear-gradient(180deg, rgba(18,28,44,.94), rgba(9,14,26,.94))",
                        }}
                      >
                        <div className="row" style={{ gap: 12, alignItems: "center" }}>
                          {winner?.photo ? (
                            <img src={winner.photo} alt={winner.label} style={{ width: 72, height: 72, borderRadius: 16, objectFit: "cover" }} />
                          ) : (
                            <div style={{ width: 72, height: 72, borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,255,255,.08)", fontWeight: 900, fontSize: 26 }}>
                              {String(winner?.label || "?").slice(0, 1).toUpperCase()}
                            </div>
                          )}
                          <div>
                            <div className="badge"><span className="dot" />Winner</div>
                            <div style={{ fontSize: 22, fontWeight: 900, marginTop: 8 }}>{winner?.label || "—"}</div>
                            <div className="muted" style={{ marginTop: 6 }}>
                              Final Score: {safeNum(row.score1, 0)} : {safeNum(row.score2, 0)}
                              {row.game === "snooker" ? ` • Highest Break: ${winner?.breakValue || 0}` : ""}
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}

                    {admin ? (
                      <div className="row" style={{ marginTop: 12 }}>
                        <button className="btn" onClick={() => editMatch(row)}>Edit</button>
                        {row.status !== "live" ? (
                          <button className="btn primary" onClick={() => quickUpdateMatch(row.id, { status: "live", start_time: row.start_time || nowTimeValue(), match_date: row.match_date || nowDateIso() })}>Start Match</button>
                        ) : null}
                        {row.status !== "finished" ? (
                          <button className="btn primary" onClick={() => quickUpdateMatch(row.id, { status: "finished", end_time: row.end_time || nowTimeValue() })}>End Match</button>
                        ) : null}
                        <button className="btn danger" onClick={() => deleteMatch(row.id)}>Delete</button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </>
  );
}


function TVMode({ data, activeTournament, players }) {
  const matches = activeTournament?.matches || [];
  const isSnooker = tournamentGameKey(activeTournament?.game) === "snooker";

  const highestBreakPlayer = isSnooker
    ? (players || []).slice().sort((a, b) => (b.bestBreak || 0) - (a.bestBreak || 0))[0]
    : null;

  const leaderboard = activeTournament
    ? calcLeaderboard(playersForTournament(activeTournament, data.players || []), activeTournament)
    : [];

  const nextMatches = matches.filter((m) => m.status !== "done");
  const doneMatches = matches.filter((m) => m.status === "done");

  function playerById(id) {
    return (players || []).find((x) => x.id === id) || null;
  }

  function playerName(id) {
    return playerById(id)?.name || "Player";
  }

  function playerPhoto(id) {
    return playerById(id)?.photo || "";
  }

  function statusDotClass(status) {
    return status === "done" ? "dot" : status === "live" ? "dot warn" : "dot";
  }

  function scoreText(m) {
    const s1 = m?.score1 === "" || m?.score1 == null ? "-" : m.score1;
    const s2 = m?.score2 === "" || m?.score2 == null ? "-" : m.score2;
    return `${s1} : ${s2}`;
  }

  const renderMatchCards = (list) => {
    if (!list.length) return <div className="muted">No matches available.</div>;

    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 16,
          marginTop: 14,
        }}
      >
        {list.map((m) => (
          <div
            key={m.id}
            className="card"
            style={{
              margin: 0,
              padding: 18,
              borderRadius: 18,
              background: "linear-gradient(180deg, rgba(13,20,36,.96), rgba(8,12,24,.96))",
            }}
          >
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
              <span className="badge">
                <span className="dot" />
                Round {m.round}
              </span>
              <span className="badge">
                <span className={statusDotClass(m.status)} />
                {m.status || "scheduled"}
              </span>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto 1fr",
                gap: 12,
                alignItems: "center",
              }}
            >
              {[m.p1, m.p2].map((pid, idx) => {
                const photo = playerPhoto(pid);
                const name = playerName(pid);
                return (
                  <div
                    key={pid || idx}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: 10,
                      textAlign: "center",
                    }}
                  >
                    {photo ? (
                      <img
                        src={photo}
                        alt={name}
                        style={{
                          width: 96,
                          height: 96,
                          objectFit: "cover",
                          borderRadius: 18,
                          border: "1px solid rgba(255,255,255,.12)",
                          background: "rgba(255,255,255,.05)",
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: 96,
                          height: 96,
                          borderRadius: 18,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          fontSize: 34,
                          fontWeight: 900,
                          background: "rgba(255,255,255,.08)",
                          border: "1px solid rgba(255,255,255,.12)",
                        }}
                      >
                        {String(name || "?").slice(0, 1).toUpperCase()}
                      </div>
                    )}

                    <div style={{ fontWeight: 800, fontSize: 20, lineHeight: 1.15 }}>{name}</div>
                  </div>
                );
              })}

              <div
                style={{
                  minWidth: 90,
                  textAlign: "center",
                  fontSize: 28,
                  fontWeight: 900,
                  letterSpacing: 1,
                }}
              >
                {scoreText(m)}
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  };

  return (
    <>
      <PageShell title="TV Display" subtitle="Live tournament fixtures" />

      <div className="container">
        <div className="card">
          <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start", gap: 16, flexWrap: "wrap" }}>
            <div>
              <h2 style={{ marginBottom: 6 }}>
                {activeTournament ? tournamentDisplay(activeTournament) : "No active tournament"}
              </h2>
              <div className="muted">
                {isSnooker ? "Snooker TV Mode" : "Pool TV Mode"}
              </div>
            </div>

            <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
              <span className="badge">
                <span className="dot" />
                Total Matches: {matches.length}
              </span>
              <span className="badge">
                <span className="dot warn" />
                Pending: {nextMatches.length}
              </span>
              <span className="badge">
                <span className="dot" />
                Completed: {doneMatches.length}
              </span>
              {isSnooker ? (
                <span className="badge">
                  <span className="dot" />
                  Highest Break: {highestBreakPlayer ? `${highestBreakPlayer.name} – ${highestBreakPlayer.bestBreak || 0}` : "—"}
                </span>
              ) : null}
            </div>
          </div>

          {leaderboard.length ? (
            <div style={{ marginTop: 16 }}>
              <h3 style={{ marginBottom: 10 }}>Top Players</h3>
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                  gap: 12,
                }}
              >
                {leaderboard.slice(0, 4).map((row, idx) => {
                  const p = playerById(row.id);
                  return (
                    <div
                      key={row.id}
                      className="card"
                      style={{
                        margin: 0,
                        padding: 14,
                        borderRadius: 16,
                        background: "linear-gradient(180deg, rgba(16,24,42,.94), rgba(9,13,24,.94))",
                      }}
                    >
                      <div className="row" style={{ gap: 12, alignItems: "center" }}>
                        {p?.photo ? (
                          <img
                            src={p.photo}
                            alt={row.name}
                            style={{
                              width: 56,
                              height: 56,
                              objectFit: "cover",
                              borderRadius: 14,
                              border: "1px solid rgba(255,255,255,.12)",
                            }}
                          />
                        ) : (
                          <div
                            style={{
                              width: 56,
                              height: 56,
                              borderRadius: 14,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontWeight: 900,
                              fontSize: 22,
                              background: "rgba(255,255,255,.08)",
                              border: "1px solid rgba(255,255,255,.12)",
                            }}
                          >
                            {String(row.name || "?").slice(0, 1).toUpperCase()}
                          </div>
                        )}

                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, opacity: 0.8 }}>#{idx + 1}</div>
                          <div style={{ fontWeight: 800, fontSize: 18, lineHeight: 1.1 }}>{row.name}</div>
                          <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>
                            {row.points} pts • {row.wins} wins
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          <div style={{ marginTop: 18 }}>
            <h3 style={{ marginBottom: 6 }}>Upcoming / Live</h3>
            {renderMatchCards(nextMatches)}
          </div>

          {doneMatches.length ? (
            <div style={{ marginTop: 22 }}>
              <h3 style={{ marginBottom: 6 }}>Completed Matches</h3>
              {renderMatchCards(doneMatches)}
            </div>
          ) : null}
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
  function editHeroSlides() {
  const current = (data.club?.heroSlides || []).join(" | ");
  const next = prompt("Edit hero slides (separate by |):", current);

  if (!next) return;

  const slides = next.split("|").map((x) => x.trim()).filter(Boolean);

  commit({
    ...data,
    club: {
      ...(data.club || {}),
      heroSlides: slides,
    },
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
  <h2>Homepage Hero Slider</h2>
  <div className="muted" style={{ marginBottom: 12 }}>
    Upload hero slider images shown on the homepage.
  </div>

  <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "center" }}>
    <label className="btn">
      Upload Hero Slide
      <input
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;

          try {
            const uploaded = await uploadImageToStorage(file, "hero-slides");

            commit({
              ...data,
              club: {
                ...(data.club || {}),
                heroSlides: [
                  ...((data.club?.heroSlides || []).filter(Boolean)),
                  uploaded.url,
                ],
              },
            });

            e.target.value = "";
          } catch (err) {
            console.error(err);
            alert("Failed to upload hero slide.");
          }
        }}
      />
    </label>
    <button className="btn" onClick={editHeroSlides}>
  Edit Hero Slides
</button>

    <span className="badge">
      <span className="dot" />
      {(data.club?.heroSlides || []).length} custom slide(s)
    </span>
  </div>

  <div className="muted" style={{ marginTop: 12 }}>
    Uploaded images will be added directly to the homepage hero slider.
  </div>

  {(data.club?.heroSlides || []).length > 0 ? (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
        gap: 12,
        marginTop: 16,
      }}
    >
      {(data.club?.heroSlides || []).map((src, idx) => (
        <div
          key={`${src}-${idx}`}
          className="card"
          style={{ margin: 0, padding: 10 }}
        >
          <img
            src={src}
            alt={`Hero Slide ${idx + 1}`}
            style={{
              width: "100%",
              height: 120,
              objectFit: "cover",
              borderRadius: 12,
              display: "block",
              marginBottom: 10,
            }}
          />

          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <span className="muted">Slide {idx + 1}</span>

            <button
              className="btn danger"
              onClick={() => {
                if (!confirm("Delete this hero slide?")) return;

                commit({
                  ...data,
                  club: {
                    ...(data.club || {}),
                    heroSlides: (data.club?.heroSlides || []).filter((_, i) => i !== idx),
                  },
                });
              }}
            >
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  ) : null}
</div>

          <div className="card cols-12">
            <h2>Quick Admin Actions</h2>
            <div className="grid" style={{ marginTop: 12 }}>
              <div className="cols-3">
                <Link className="btn primary" to="/live" style={{ width: "100%" }}>
                  Live Matches
                </Link>
              </div>
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
function FoodOrdersAdmin({ data, admin, commit }) {
  if (!admin) {
    return (
      <div className="container">
        <div className="card" style={{ maxWidth: 700, margin: "40px auto" }}>
          <h2>Admin Only</h2>
          <p className="muted">Turn admin mode on to view food orders.</p>
        </div>
      </div>
    );
  }

  const orders = Array.isArray(data.foodOrders) ? [...data.foodOrders].reverse() : [];
  const archivedOrders = Array.isArray(data.archivedFoodOrders)
    ? [...data.archivedFoodOrders].reverse()
    : [];

  function updateOrderStatus(id, newStatus) {
    const updated = (data.foodOrders || []).map((o) =>
      o.id === id ? { ...o, status: newStatus } : o
    );

    commit({
      ...data,
      foodOrders: updated,
    });
  }

  function archiveFoodOrder(orderId) {
    const order = (data.foodOrders || []).find((o) => o.id === orderId);
    if (!order) return;

    const updatedOrders = (data.foodOrders || []).filter((o) => o.id !== orderId);

    commit({
      ...data,
      foodOrders: updatedOrders,
      archivedFoodOrders: [
        ...(data.archivedFoodOrders || []),
        { ...order, archivedAt: new Date().toISOString() },
      ],
    });
  }

  function restoreFoodOrder(orderId) {
    const order = (data.archivedFoodOrders || []).find((o) => o.id === orderId);
    if (!order) return;

    const updatedArchived = (data.archivedFoodOrders || []).filter((o) => o.id !== orderId);

    commit({
      ...data,
      foodOrders: [...(data.foodOrders || []), order],
      archivedFoodOrders: updatedArchived,
    });
  }

  return (
    <div className="container">
      <div className="sectionTitle">
        <span className="dot" />
        <span>Food Orders Dashboard</span>
      </div>

      <h1 style={{ marginBottom: 18 }}>Food Orders</h1>
      <div style={{ marginBottom: 18 }}>
  <Link className="btn" to="/admin/orders-archive">
    View Archived Orders
  </Link>
</div>

      {orders.length === 0 ? (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>No food orders yet</h3>
          <p className="muted">Paid food orders will appear here.</p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          {orders.map((order) => (
            <div key={order.id} className="card">
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div>
                  <h3 style={{ margin: "0 0 8px" }}>Order #{order.id}</h3>
                  <div><b>Name:</b> {order.name || "—"}</div>
                  <div><b>Mobile:</b> {order.mobile || "—"}</div>
                  <div><b>Status:</b> {order.status || "Paid"}</div>

                  <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      className="btn"
                      style={{ background: "#facc15", color: "#111", borderColor: "#facc15" }}
                      onClick={() => updateOrderStatus(order.id, "Preparing")}
                    >
                      Preparing
                    </button>

                    <button
                      className="btn"
                      style={{ background: "#22c55e", color: "#fff", borderColor: "#22c55e" }}
                      onClick={() => updateOrderStatus(order.id, "Ready")}
                    >
                      Ready
                    </button>

                    <button
                      className="btn"
                      style={{ background: "#a855f7", color: "#fff", borderColor: "#a855f7" }}
                      onClick={() => updateOrderStatus(order.id, "Delivered")}
                    >
                      Delivered
                    </button>

                    {order.status === "Delivered" && (
                      <button
                        className="btn"
                        style={{ background: "#ef4444", color: "#fff", borderColor: "#ef4444" }}
                        onClick={() => archiveFoodOrder(order.id)}
                      >
                        Archive
                      </button>
                    )}
                  </div>
                </div>

                <div style={{ textAlign: "right" }}>
                  <div><b>Total:</b> ₹{order.total || 0}</div>
                  <div className="muted" style={{ marginTop: 6 }}>
                    {order.time ? new Date(order.time).toLocaleString() : "—"}
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 14 }}>
                <b>Items:</b>
                <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                  {(order.items || []).map((item, idx) => (
                    <div
                      key={`${order.id}-${idx}`}
                      style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
                    >
                      <span>{item.name} × {item.qty}</span>
                      <span>₹{item.lineTotal}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      
    </div>
  );
}
function FoodOrdersArchive({ data, admin, commit }) {
  if (!admin) {
    return (
      <div className="container">
        <div className="card" style={{ maxWidth: 700, margin: "40px auto" }}>
          <h2>Admin Only</h2>
          <p className="muted">Turn admin mode on to view archived food orders.</p>
        </div>
      </div>
    );
  }

  const archivedOrders = Array.isArray(data.archivedFoodOrders)
    ? [...data.archivedFoodOrders].reverse()
    : [];

  function restoreFoodOrder(orderId) {
    const order = (data.archivedFoodOrders || []).find((o) => o.id === orderId);
    if (!order) return;

    const updatedArchived = (data.archivedFoodOrders || []).filter((o) => o.id !== orderId);

    commit({
      ...data,
      foodOrders: [...(data.foodOrders || []), order],
      archivedFoodOrders: updatedArchived,
    });
  }

  return (
    <div className="container">
      <div className="sectionTitle">
        <span className="dot" />
        <span>Food Orders Archive</span>
      </div>

      <h1 style={{ marginBottom: 18 }}>Archived Orders</h1>

      <div style={{ marginBottom: 18 }}>
        <Link className="btn" to="/admin/orders">
          Back to Active Orders
        </Link>
      </div>

      {archivedOrders.length === 0 ? (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>No archived orders</h3>
          <p className="muted">Archived food orders will appear here.</p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          {archivedOrders.map((order) => (
            <div key={order.id} className="card">
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <div>
                  <h3 style={{ margin: "0 0 8px" }}>Order #{order.id}</h3>
                  <div><b>Name:</b> {order.name || "—"}</div>
                  <div><b>Mobile:</b> {order.mobile || "—"}</div>
                  <div><b>Status:</b> {order.status || "Delivered"}</div>
                </div>

                <div style={{ textAlign: "right" }}>
                  <div><b>Total:</b> ₹{order.total || 0}</div>
                  <div className="muted" style={{ marginTop: 6 }}>
                    {order.time ? new Date(order.time).toLocaleString() : "—"}
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 14 }}>
                <b>Items:</b>
                <div style={{ marginTop: 8 }}>
                  {(order.items || []).map((item, idx) => (
                    <div
                      key={`${order.id}-${idx}`}
                      style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
                    >
                      <span>{item.name} × {item.qty}</span>
                      <span>₹{item.lineTotal}</span>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ marginTop: 12 }}>
                <button className="btn" onClick={() => restoreFoodOrder(order.id)}>
                  Restore
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
function PaymentStatus({ data, commit }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [status, setStatus] = useState("checking");
  const [orderSaved, setOrderSaved] = useState(false);

  const paymentContext = localStorage.getItem("qclub_payment_context") || "";
  const foodCart = JSON.parse(localStorage.getItem("qclub_food_cart") || "[]");
  const foodTotal = localStorage.getItem("qclub_food_total") || "0";
  const paymentMobile = localStorage.getItem("qclub_payment_mobile") || "";
  const paymentName = localStorage.getItem("qclub_payment_name") || "";
  const params = new URLSearchParams(location.search);
const orderIdFromUrl = params.get("order_id") || "";
const displayOrderNo = `QC-${String(orderIdFromUrl).slice(-6)}`;
const displayTime = new Date().toLocaleString();

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const order_id = params.get("order_id");

    if (!order_id) {
      setStatus("failed");
      return;
    }

    fetch(`/api/get-order-status?order_id=${order_id}`)
      .then((res) => res.json())
      .then((orderData) => {
  if (orderData.order_status === "PAID") {

    if (paymentContext === "food" && !orderSaved) {

      const newOrder = {
        id: displayOrderNo,
        name: paymentName,
        mobile: paymentMobile,
        items: foodCart,
        total: foodTotal,
        time: new Date().toISOString(),
        status: "Paid"
      };

      commit({
  ...data,
  foodOrders: [...(data.foodOrders || []), newOrder]
});

      setOrderSaved(true);
    }

    setStatus("success");

  } else {
    setStatus("failed");
  }
})
      .catch(() => setStatus("failed"));
  }, [location.search]);

  function retryPath() {
    if (paymentContext === "food") return "/offer";
    if (paymentContext === "membership") return "/membership";
    return "/book";
  }

  const savedName = localStorage.getItem("qclub_payment_name") || "";
  const savedMobile = localStorage.getItem("qclub_payment_mobile") || "";
  const table = localStorage.getItem("qclub_booking_table") || "";
  const bookingDate = localStorage.getItem("qclub_booking_date") || "";
  const bookingSlot = localStorage.getItem("qclub_booking_slot") || "";
  const tier = localStorage.getItem("qclub_membership_tier") || "";
  const tshirtSize = localStorage.getItem("qclub_tshirt_size") || "";
  function downloadFoodReceiptPdf() {
  const params = new URLSearchParams(location.search);
  const orderIdFromUrl = params.get("order_id") || "";
  const displayOrderNo = `QC-${String(orderIdFromUrl).slice(-6)}`;
  const nowText = new Date().toLocaleString();

  const itemsHtml = foodCart.length
    ? foodCart
        .map(
          (item) => `
            <tr>
              <td style="padding:8px 0;border-bottom:1px solid #ddd;">${item.name} × ${item.qty}</td>
              <td style="padding:8px 0;border-bottom:1px solid #ddd;text-align:right;">₹${item.lineTotal}</td>
            </tr>
          `
        )
        .join("")
    : `<tr><td colspan="2" style="padding:8px 0;">No items found.</td></tr>`;

  const html = `
    <html>
      <head>
        <title>${displayOrderNo} Receipt</title>
      </head>
      <body style="font-family:Arial,sans-serif;padding:24px;color:#111;">
        <h2 style="margin:0 0 12px;">The Q Club Pasighat</h2>
        <div style="margin-bottom:8px;"><b>Order No:</b> ${displayOrderNo}</div>
        <div style="margin-bottom:8px;"><b>Time:</b> ${nowText}</div>
        <div style="margin-bottom:8px;"><b>Name:</b> ${paymentName || "-"}</div>
        <div style="margin-bottom:16px;"><b>Mobile:</b> ${paymentMobile || "-"}</div>

        <table style="width:100%;border-collapse:collapse;margin-top:12px;">
          <thead>
            <tr>
              <th style="text-align:left;padding-bottom:8px;border-bottom:2px solid #111;">Item</th>
              <th style="text-align:right;padding-bottom:8px;border-bottom:2px solid #111;">Amount</th>
            </tr>
          </thead>
          <tbody>
            ${itemsHtml}
          </tbody>
        </table>

        <div style="margin-top:18px;font-size:18px;font-weight:700;">
          Total Paid: ₹${foodTotal}
        </div>
      </body>
    </html>
  `;

  const win = window.open("", "_blank");
  if (!win) return;

  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
}

  return (
    <div className="container">
      <div className="card" style={{ maxWidth: 600, margin: "40px auto" }}>
        {status === "checking" && (
          <>
            <h2>Checking your payment...</h2>
          </>
        )}

        {status === "success" && (
          <>
            {paymentContext === "membership" ? (
              <>
                <h2>Welcome to The Q Club Membership 🏆</h2>
                <p>
                  Welcome to <strong>The Q Club</strong> — where legends are made.
                </p>

                <div className="card" style={{ marginTop: 14 }}>
                  <div><b>Name:</b> {savedName || "—"}</div>
                  <div><b>Mobile:</b> {savedMobile || "—"}</div>
                  <div><b>Membership Tier:</b> {tier || "—"}</div>
                  <div><b>T-Shirt Size:</b> {tshirtSize || "—"}</div>
                </div>

                <div className="row" style={{ marginTop: 16 }}>
                  <button className="btn primary" onClick={() => navigate("/")}>
                    Enter The Q Club
                  </button>
                  <button className="btn" onClick={() => navigate("/membership")}>
                    Membership Page
                  </button>
                </div>
              </>
            ) : paymentContext === "food" ? (
              <>
                <h2>Order Placed Successfully</h2>
                <div style={{ marginTop: 10, marginBottom: 14 }}>
  <div><b>Order No:</b> {displayOrderNo}</div>
  <div><b>Time:</b> {displayTime}</div>
</div>

                <div className="card" style={{ marginTop: 14 }}>
                  <div><b>Name:</b> {paymentName || "—"}</div>
                  <div><b>Mobile:</b> {paymentMobile || "—"}</div>

                  <div style={{ marginTop: 12 }}><b>Items:</b></div>

                  {foodCart.length > 0 ? (
                    foodCart.map((item) => (
                      <div
                        key={item.id}
                        style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
                      >
                        <span>{item.name} × {item.qty}</span>
                        <span>₹{item.lineTotal}</span>
                      </div>
                    ))
                  ) : (
                    <div className="muted">No items found.</div>
                  )}

                  <div style={{ marginTop: 10, fontWeight: 700 }}>
                    Total Paid: ₹{foodTotal}
                  </div>
                  <p className="muted" style={{ marginTop: 12 }}>
  Please give us up to 15 minutes to prepare your order. Please collect your order from the counter when called.
</p>
                </div>

                <div className="row" style={{ marginTop: 16 }}>
                  <button className="btn primary" onClick={() => navigate("/offer")}>
                    Order More
                  </button>
                  <button className="btn" onClick={downloadFoodReceiptPdf}>
  Download PDF
</button>
                  <button className="btn" onClick={() => navigate("/")}>
                    Home
                  </button>
                </div>
              </>
            ) : (
              <>
                <h2>Table Booked Successfully</h2>

                <p>
                  Your table booking at <strong>The Q Club</strong> is confirmed.
                </p>
                <p className="muted">Have a great game.</p>

                <div className="card" style={{ marginTop: 14 }}>
                  <div><b>Name:</b> {savedName || "—"}</div>
                  <div><b>Mobile:</b> {savedMobile || "—"}</div>
                  <div><b>Table:</b> {table || "—"}</div>
                  <div><b>Date:</b> {bookingDate || "—"}</div>
                  <div><b>Time Slot:</b> {bookingSlot || "—"}</div>
                </div>

                <div className="row" style={{ marginTop: 16 }}>
                  <button className="btn primary" onClick={() => navigate("/book")}>
                    Book Another Table
                  </button>
                  <button className="btn" onClick={() => navigate("/")}>
                    Home
                  </button>
                </div>
              </>
            )}
          </>
        )}

        {status === "failed" && (
          <>
            <h2>Payment Not Completed</h2>
            <p>Your payment was cancelled or failed.</p>

            <button className="btn primary" onClick={() => navigate(retryPath())}>
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