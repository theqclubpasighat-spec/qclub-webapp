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
function formatWhatsappDateTime(value = new Date()) {
  const dt = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(dt.getTime())) return "";

  return dt.toLocaleString("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}
function scrollAnyOpenPanelToTop() {
  requestAnimationFrame(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });

    document
      .querySelectorAll(".modal-body, .sheet-body, .drawer-body, .page-body, .legal-body")
      .forEach((el) => {
        el.scrollTo({ top: 0, left: 0, behavior: "auto" });
      });
  });
}
function bookingTimeSlots(selectedDate = todayIso(), blockedSlotValues = []) {
  const slots = [];
  const today = todayIso();
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const blockedSet = new Set((blockedSlotValues || []).filter(Boolean));

  for (let hour = 11; hour <= 22; hour += 1) {
    const next = hour + 1;
    const start = `${String(hour).padStart(2, "0")}:00`;
    const end = `${String(next).padStart(2, "0")}:00`;

    const slotStartMinutes = hour * 60;
    const slotEndMinutes = next * 60;
    const value = `${start}-${end}`;

    const isPastToday =
      selectedDate === today && currentMinutes >= slotEndMinutes;

    const isRunningNow =
      selectedDate === today &&
      currentMinutes >= slotStartMinutes &&
      currentMinutes < slotEndMinutes;

    const isBlocked = blockedSet.has(value);

    slots.push({
      value,
      label: `${start} to ${end}`,
      disabled: isPastToday || isRunningNow || isBlocked,
      blocked: isBlocked,
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
  tickerSpeed: 28,
  tvCustomSlides: [],
  tvShowcaseMode: "mixed",
  aboutTitle: "About The Q Club",
  aboutContent: `The Q Club is a premium indoor gaming lounge in Pasighat offering cue sports and leisure experiences in a comfortable, modern setting.

We provide Snooker, American Pool, Mini Snooker, Air Hockey, Foosball, refreshments, and relaxation facilities for members and visitors.

## Business Nature
The Q Club operates as a recreational indoor sports and leisure lounge.

## Our Mission
Our goal is to create a safe, premium, and welcoming environment that promotes sportsmanship, recreation, and healthy competition.

## Club Facilities
- Professional Snooker Tables
- American Pool Table
- Mini Snooker Table
- Air Hockey Table
- Foosball Table
- Tea & Coffee Vending
- Massage Chair

## Community Events
The Q Club may organise friendly tournaments, league nights, and special club events for members and guests.`,
  contactTitle: "Contact Us",
  contactContent: `If you have any questions about bookings, memberships, tournaments, or club rules, feel free to reach out.

The Q Club
GTC, Pasighat
Arunachal Pradesh, India

## Phone / WhatsApp
7005212774
7085221922

## Operating Hours
Open Daily: 11:00 AM – 10:00 PM (subject to holidays or tournament schedules)

## Visit Us For
- Snooker
- Pool
- Air Hockey
- Foosball
- Massage Chair
- Tea & Coffee
- Monthly Club Events`,
  termsTitle: "Terms & Conditions",
  termsContent: `By entering The Q Club or using our services, you agree to the following terms.

## 1. Club Rules
- No smoking inside the main club area.
- No alcohol allowed inside the premises.
- Spitting is strictly prohibited.
- Misconduct or damage to property may result in immediate removal from the club.

## 2. Membership
- Membership is monthly and non-transferable.
- Membership privileges reset daily at 00:00 hours.
- Member access to game tables is subject to availability.

## 3. Complimentary Session Guidelines
Complimentary play sessions, where applicable, may be offered at the discretion of the club and subject to availability.
- Pool: up to 15 minutes
- Mini Snooker: up to 20 minutes
- Snooker Table: up to 30 minutes
Unless specified otherwise, such sessions are generally available from 11:00 AM to 5:00 PM.

## 4. Liability
The Q Club is not responsible for loss of personal belongings within the premises.

## 5. Management Rights
The management reserves the right to refuse entry, modify prices, update membership benefits, and change club rules without prior notice.`,
  refundTitle: "Refund Policy",
  refundContent: `At The Q Club, we strive to ensure a smooth and fair experience for all customers.

## Membership
Membership fees are generally non-refundable once activated.

## Table Bookings
If advance bookings are introduced in the future, cancellations made at least 2 hours before booking time may be eligible for rescheduling. Missed bookings may not be refundable.

## Technical Issues
If a game cannot be completed due to equipment malfunction, staff may offer replacement play time or a complimentary session at the discretion of management.

## Refund Review
If a payment is made in error or a technical issue occurs during payment processing, customers may contact The Q Club for review. Refunds, if applicable, may be processed within 5–7 working days.`,
  privacyTitle: "Privacy Policy",
  privacyContent: `The Q Club respects your privacy.

## Information We Collect
We may collect basic information such as name, phone number, membership details, and tournament participation records.

## How We Use This Information
Your information is used for membership verification, tournament records, leaderboard rankings, and communication about club events.

## Data Protection
We do not sell or share your personal data with third parties.

## Payment Information
Payment transactions are processed through authorized payment gateway providers. The Q Club does not store card or payment details on its servers.

## Media Usage
Photos and videos taken inside the club and on Membership pages may be used on social media, promotional materials, and website content.`,
      balancedFormatTitle: "Q Club Balanced Match Format",
  balancedFormatSubtitle: "Structured for fair play, balanced competition, and a stronger tournament experience.",
  balancedFormatDescription: "This tournament uses player classification and handicap points to create fairer and more competitive matches across different playing standards.",
handicapTitle: "Handicap & Classification",
  handicapContent: `## Player Groups
- Group A: strongest and most advanced players
- Group B: competitive regular players
- Group C: developing, casual, or beginner players

## 6-Red Handicap Table
- A vs A = 0
- B vs B = 0
- C vs C = 0
- A vs B = 6 points to B
- B vs C = 6 points to C
- A vs C = 12 points to C

## Initial Classification
Players shall be placed into Group A, B or C by the Tournament Committee based on:
- match results
- scoring ability
- tactical understanding
- performance under pressure
- years of playing / experience

## Promotion Review
A player may normally be reviewed for promotion only after:
- 15 recorded frames, and
- completion of the current tournament cycle,
whichever is later.

## Demotion Review
A player may normally be reviewed for demotion only after:
- 20 recorded frames, and
- completion of the current tournament cycle,
whichever is later.

## Role of Experience
Years of playing / experience shall be treated as a relevant supporting factor, but current playing standard and recorded results shall carry greater weight.

## Committee
Classification, handicap, promotion and demotion decisions shall be made by the Tournament Committee based on recorded data and observed standard.

## Mid-Tournament Stability
No player should ordinarily be promoted or demoted during an ongoing tournament. Changes should normally take effect only after the tournament ends.`,
tournamentDisclaimerTitle: "Tournament Legal Disclaimer",
  tournamentDisclaimerContent: `The Q Club may organise recreational skill-based tournaments in games such as Snooker, Pool, Air Hockey, Foosball, and similar sporting or leisure activities. Any registration fee collected for such tournaments is charged towards participation, event organisation, table usage, administration, logistics, officiating, refreshments, and related club services.

Prize money, trophies, gifts, or other rewards for tournament winners may be funded from player registration fees, sponsorship support, promotional budgets, or contributions made by the club management. Such tournaments are intended as skill-based recreational competitions and not as gambling or wagering activities conducted by the club.

The Club does not organise, facilitate, or profit from any private wagering or side betting that individuals may independently engage in amongst themselves. Any such private act is not part of the Club’s official services, tournament structure, or business model.

The Club charges only for lawful use of its premises, facilities, event organisation, and related services, and does not take any commission or percentage from private bets, if any, between individuals.

By participating in any tournament at The Q Club, players acknowledge that tournament formats, rules, prize structures, schedules, and eligibility conditions may be fixed, revised, or interpreted by the management in the interest of smooth event conduct. Management reserves the right to refuse entry, disqualify participants for misconduct, and amend tournament rules or schedules when reasonably required.`,
},
    admin: {
  mainPin: "1234",
  staffPin: "5678",
  committeePin: "9012",
},
    announcements: [
      { id: uid(), text: "Monthly tournaments every month 🔥 Register at counter.", createdAt: Date.now() },
    ],
    reviewHistory: [],
    matchLedger: [],
    membersPage: [
  {
    id: "member_1",
    name: "Founding Member",
    tier: "Gold",
    joinedOn: "2026-01-01",
    note: "One of the first members of The Q Club.",
    photo: "",
  },
],
memberRegistry: [
  {
    id: "m_1",
    name: "Wilson Pilot Yomso",
    mobile: "9774219051",
    tier: "Gold",
    joinedOn: "2026-03-01",
    validUntil: "2026-04-01",
    status: "active",
    notes: "Founding Member"
  }
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
  {
    id: uid(),
    name: "Wilson",
    city: "Pasighat",
    photo: "",
    bio: "",
    games: ["snooker", "pool"],
    group: "B",
    yearsPlaying: "3",
    reviewStatus: "Stable",
    lastReviewDate: "",
    committeeNotes: "",
  },
  {
    id: uid(),
    name: "Riku",
    city: "Pasighat",
    photo: "",
    bio: "",
    games: ["snooker"],
    group: "C",
    yearsPlaying: "1",
    reviewStatus: "Stable",
    lastReviewDate: "",
    committeeNotes: "",
  },
  {
    id: uid(),
    name: "Tani",
    city: "Aalo",
    photo: "",
    bio: "",
    games: ["pool"],
    group: "C",
    yearsPlaying: "1",
    reviewStatus: "Stable",
    lastReviewDate: "",
    committeeNotes: "",
  },
  {
    id: uid(),
    name: "Bikash",
    city: "Roing",
    photo: "",
    bio: "",
    games: ["snooker", "pool"],
    group: "B",
    yearsPlaying: "2",
    reviewStatus: "Stable",
reviewRecommendation: "No Change",
lastReviewDate: "",
committeeNotes: "",
  },
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
  blockedSlots: [],
  lastSeenRequestAt: 0,
},
        hallOfFame: [],
    mediaLibrary: [],
  };
}

function pickText(value, fallback) {
  return typeof value === "string" && value.trim() ? value : fallback;
}
function syncMembersIntoPlayers(data) {
  const players = Array.isArray(data.players) ? data.players : [];
  const members = Array.isArray(data.membersPage) ? data.membersPage : [];

  const byName = new Map(
    players.map((p) => [String(p.name || "").trim().toLowerCase(), p])
  );

  const nextPlayers = [...players];

  members.forEach((m) => {
    const memberName = String(m?.name || "").trim();
    if (!memberName) return;

    const key = memberName.toLowerCase();
    if (byName.has(key)) return;

    const memberGames = Array.isArray(m?.games)
      ? m.games
      : Array.isArray(m?.memberGames)
      ? m.memberGames
      : Array.isArray(m?.sports)
      ? m.sports
      : ["snooker"];

    const normalizedGames = normalizePlayerGames(memberGames);

    const newPlayer = {
      id: uid(),
      name: memberName,
      photo: String(m?.photo || ""),
      location: String(m?.location || "Pasighat"),
      games: normalizedGames,
      group: String(m?.group || "C"),
      yearsPlaying: String(m?.yearsPlaying || ""),
      bio: "",
      achievements: "",
      style: "",
      snookerWins: 0,
      snookerLosses: 0,
      poolWins: 0,
      poolLosses: 0,
      bestBreak: 0,
      reviewStatus: "Stable",
      reviewRecommendation: "No Change",
      lastReviewDate: "",
      committeeNotes: "",
    };

    nextPlayers.push(newPlayer);
    byName.set(key, newPlayer);
  });

  return {
    ...data,
    players: nextPlayers,
  };
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
            balancedFormatTitle: pickText(src?.club?.balancedFormatTitle, base.club.balancedFormatTitle),
      balancedFormatSubtitle: pickText(src?.club?.balancedFormatSubtitle, base.club.balancedFormatSubtitle),
      balancedFormatDescription: pickText(src?.club?.balancedFormatDescription, base.club.balancedFormatDescription),
            handicapTitle: pickText(src?.club?.handicapTitle, base.club.handicapTitle),
      handicapContent: pickText(src?.club?.handicapContent, base.club.handicapContent),
        heroSlides: Array.isArray(src?.club?.heroSlides) ? src.club.heroSlides.filter(Boolean) : base.club.heroSlides,
      tickerSpeed: safeNum(src?.club?.tickerSpeed, base.club.tickerSpeed),
      tvCustomSlides: Array.isArray(src?.club?.tvCustomSlides) ? src.club.tvCustomSlides : base.club.tvCustomSlides,
      tvShowcaseMode:
  src?.club?.tvShowcaseMode === "custom_only" ? "custom_only" : base.club.tvShowcaseMode,
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
  mainPin: pickText(src?.admin?.mainPin, base.admin.mainPin),
  staffPin: pickText(src?.admin?.staffPin, base.admin.staffPin),
  committeePin: pickText(src?.admin?.committeePin, base.admin.committeePin),
},
    announcements: Array.isArray(src.announcements) ? src.announcements : base.announcements,
    reviewHistory: Array.isArray(src.reviewHistory)
  ? src.reviewHistory.map((r) => ({
      id: String(r?.id || uid()),
      playerId: String(r?.playerId || ""),
      playerName: String(r?.playerName || ""),
      action: String(r?.action || ""),
      fromGroup: String(r?.fromGroup || ""),
      toGroup: String(r?.toGroup || ""),
      recommendation: String(r?.recommendation || ""),
      reviewStatus: String(r?.reviewStatus || ""),
      committeeNotes: String(r?.committeeNotes || ""),
      createdAt: Number(r?.createdAt || Date.now()),
      reviewDate: String(r?.reviewDate || ""),
    }))
  : [],
  matchLedger: Array.isArray(src.matchLedger)
  ? src.matchLedger.map((m) => ({
      id: String(m?.id || uid()),
      date: String(m?.date || todayIso()),
      game: tournamentGameKey(m?.game),
      player1Id: String(m?.player1Id || ""),
      player2Id: String(m?.player2Id || ""),
      player1Name: String(m?.player1Name || ""),
      player2Name: String(m?.player2Name || ""),
      score1: String(m?.score1 ?? ""),
      score2: String(m?.score2 ?? ""),
      break1: String(m?.break1 ?? ""),
      break2: String(m?.break2 ?? ""),
      winnerId: String(m?.winnerId || ""),
      venueType: String(m?.venueType || "club"),
      source: String(m?.source || "manual"),
      notes: String(m?.notes || ""),
      createdAt: Number(m?.createdAt || Date.now()),
    }))
  : [],
    memberRegistry: Array.isArray(src.memberRegistry) ? src.memberRegistry : base.memberRegistry,
memberships: Array.isArray(src.memberships) ? src.memberships : base.memberships,
offers: Array.isArray(src.offers) ? src.offers : base.offers,
menuCatalog: src.menuCatalog && typeof src.menuCatalog === "object" ? src.menuCatalog : base.menuCatalog,
photos: Array.isArray(src.photos) ? src.photos : base.photos,
players: Array.isArray(src.players)
  ? src.players.map((p) => ({
      ...p,
      games: normalizePlayerGames(p?.games),
      group: ["A", "B", "C"].includes(String(p?.group || "").toUpperCase())
        ? String(p.group).toUpperCase()
        : "C",
      yearsPlaying:
        p?.yearsPlaying !== undefined && p?.yearsPlaying !== null
          ? String(p.yearsPlaying)
          : "",
      reviewStatus: String(p?.reviewStatus || "Stable"),
reviewRecommendation: String(p?.reviewRecommendation || "No Change"),
lastReviewDate: String(p?.lastReviewDate || ""),
committeeNotes: String(p?.committeeNotes || ""),
    }))
  : base.players,
foodOrders: Array.isArray(src.foodOrders) ? src.foodOrders : base.foodOrders,
archivedFoodOrders: Array.isArray(src.archivedFoodOrders) ? src.archivedFoodOrders : base.archivedFoodOrders,
tournaments: Array.isArray(src.tournaments) ? src.tournaments : base.tournaments,
    booking: {
  ...base.booking,
  ...(src.booking || {}),
  tables: Array.isArray(src?.booking?.tables) && src.booking.tables.length ? src.booking.tables : base.booking.tables,
  requests: Array.isArray(src?.booking?.requests) ? src.booking.requests : base.booking.requests,
  blockedSlots: Array.isArray(src?.booking?.blockedSlots) ? src.booking.blockedSlots : base.booking.blockedSlots,
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

    if (!raw) return syncMembersIntoPlayers(defaultData());

    const parsed = JSON.parse(raw);
    return syncMembersIntoPlayers(mergeWithDefaults(parsed));
  } catch (e) {
    console.warn("Failed to load saved data:", e);
    return defaultData();
  }
}

function saveData(data) {
  localStorage.setItem(LS_KEY, JSON.stringify(data));
}

function handicapFromGroups(group1, group2, game = "snooker") {
  const gameKey = tournamentGameKey(game);

  if (gameKey !== "snooker") {
    return { handicap1: 0, handicap2: 0 };
  }

  const g1 = String(group1 || "C").toUpperCase();
  const g2 = String(group2 || "C").toUpperCase();

  const rank = { A: 3, B: 2, C: 1 };
  const r1 = rank[g1] || 1;
  const r2 = rank[g2] || 1;

  if (r1 === r2) {
    return { handicap1: 0, handicap2: 0 };
  }

  const diff = Math.abs(r1 - r2);
  const points = diff === 1 ? 6 : 12;

  if (r1 > r2) {
    return { handicap1: 0, handicap2: points };
  }

  return { handicap1: points, handicap2: 0 };
}
/* ---------------------------
   Round robin fixtures
---------------------------- */
function generateRoundRobin(playerIds, allPlayers = []) {
  const ids = [...playerIds];
  const BYE = "BYE";
  if (ids.length < 2) return [];
  if (ids.length % 2 === 1) ids.push(BYE);

  const getPlayerGroup = (id) =>
    (allPlayers || []).find((p) => p.id === id)?.group || "C";

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
          p1Group: getPlayerGroup(p1),
p2Group: getPlayerGroup(p2),
...handicapFromGroups(getPlayerGroup(p1), getPlayerGroup(p2), "snooker"),
          score1: "",
          score2: "",
          break1: "",
          break2: "",
          winner: "",
          margin: "",
          notes: "",
          enteredBy: "",
          verifiedBy: "",
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

function generateKnockout(playerIds, allPlayers = []) {
  const ids = [...playerIds].filter(Boolean);
  if (ids.length < 2) return [];

  const getPlayerGroup = (id) =>
    (allPlayers || []).find((p) => p.id === id)?.group || "C";

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

  const byePlayers = shuffled.slice(0, byes);
  const round1Players = shuffled.slice(byes);

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
      p1Group: getPlayerGroup(p1),
p2Group: getPlayerGroup(p2),
...handicapFromGroups(getPlayerGroup(p1), getPlayerGroup(p2), "snooker"),
      score1: "",
      score2: "",
      winner: "",
      result: "",
      margin: "",
      status: "scheduled",
      bestOf: 3,
      break1: "",
      break2: "",
      notes: "",
      enteredBy: "",
      verifiedBy: "",
      updatedAt: Date.now(),
    });

    round1WinnerSlots.push(`WINNER_R1_M${matchNumber}`);
  }

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
        p1Group: String(p1).startsWith("WINNER_") ? "" : getPlayerGroup(p1),
p2Group: String(p2).startsWith("WINNER_") ? "" : getPlayerGroup(p2),
...(
  String(p1).startsWith("WINNER_") || String(p2).startsWith("WINNER_")
    ? { handicap1: 0, handicap2: 0 }
    : handicapFromGroups(getPlayerGroup(p1), getPlayerGroup(p2), "snooker")
),
        score1: "",
        score2: "",
        winner: "",
        result: "",
        margin: "",
        status: "scheduled",
        bestOf: isFinal ? 5 : 3,
        break1: "",
        break2: "",
        notes: "",
        enteredBy: "",
        verifiedBy: "",
        updatedAt: Date.now(),
      });

      nextRoundPlayers.push(`WINNER_R${roundNumber}_M${matchNumber}`);
    }

    currentRoundPlayers = nextRoundPlayers;
    roundNumber += 1;
  }

  return matches;
}
function generateKnockoutForTournamentNow(data, commit, tournamentId) {
  const tournaments = data.tournaments || [];
  const tournament = tournaments.find((t) => t.id === tournamentId);

  if (!tournament) {
    alert("Tournament not found.");
    return;
  }

  const participantIds = Array.isArray(tournament.participantIds)
    ? tournament.participantIds.filter(Boolean)
    : [];

  if (participantIds.length < 2) {
    alert("Need at least 2 registered players to generate knockout fixtures.");
    return;
  }

  const hasExistingMatches = Array.isArray(tournament.matches) && tournament.matches.length > 0;

  if (hasExistingMatches) {
    const ok = confirm("Knockout fixtures already exist. Overwrite them?");
    if (!ok) return;
  }

  const matches = generateKnockout(participantIds, data.players || []);

  const fixtureAnnouncement = {
    id: uid(),
    text: `Knockout fixtures generated for ${tournament.name || "current tournament"} !`,
    link: "/fixtures",
    createdAt: Date.now(),
  };

  commit({
    ...data,
    tournaments: tournaments.map((t) =>
      t.id === tournamentId
        ? {
            ...t,
            format: "knockout",
            matches,
          }
        : t
    ),
    announcements: [
      fixtureAnnouncement,
      ...(data.announcements || []),
    ].slice(0, 20),
  });

  alert("Knockout fixtures generated successfully.");
}
function generateKnockoutForTournamentSilently(data, commit, tournamentId) {
  const tournaments = data.tournaments || [];
  const tournament = tournaments.find((t) => t.id === tournamentId);

  if (!tournament) return false;

  const participantIds = Array.isArray(tournament.participantIds)
    ? tournament.participantIds.filter(Boolean)
    : [];

  if (participantIds.length < 2) return false;

  const matches = generateKnockout(participantIds, data.players || []);

  const fixtureAnnouncement = {
    id: uid(),
    text: `Knockout fixtures generated for ${tournament.name || "current tournament"} !`,
    link: "/fixtures",
    createdAt: Date.now(),
  };

  commit({
    ...data,
    tournaments: tournaments.map((t) =>
      t.id === tournamentId
        ? {
            ...t,
            format: "knockout",
            matches,
          }
        : t
    ),
    announcements: [fixtureAnnouncement, ...(data.announcements || [])].slice(0, 20),
  });

  return true;
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

  const [data, setData] = useState(() =>
  hydrateLocalMediaIntoState(
    syncMembersIntoPlayers(mergeWithDefaults(loadData()))
  )
);
  const [cloudStatus, setCloudStatus] = useState(
    isCloudEnabled() ? "syncing" : "local"
  );
  const [hasHydratedFromCloud, setHasHydratedFromCloud] = useState(false);

  const [adminRole, setAdminRole] = useState("");
const admin = adminRole === "main";
const staffAdmin = adminRole === "staff";
const committeeAdmin = adminRole === "committee";
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
  const merged = mergeWithDefaults(next);
  const synced = syncMembersIntoPlayers(merged);
  const safeNext = hydrateLocalMediaIntoState(synced);

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
  if (adminRole) {
    setAdminRole("");
    return;
  }

  const pin = prompt("Enter Access PIN");
  if (!pin) return;

  if (pin === data.admin?.mainPin) {
    setAdminRole("main");
    return;
  }

  if (pin === data.admin?.staffPin) {
    setAdminRole("staff");
    return;
  }

  if (pin === data.admin?.committeePin) {
    setAdminRole("committee");
    return;
  }

  alert("Wrong PIN");
}
  function changePin() {
  if (!admin) return;

  const mode = prompt(
    "Change which PIN?\nType:\n1 for Main Admin PIN\n2 for Staff PIN\n3 for Committee PIN",
    "2"
  );

  if (!mode) return;

  if (mode !== "1" && mode !== "2" && mode !== "3") {
    alert("Invalid choice");
    return;
  }

  const current =
    mode === "1"
      ? data.admin?.mainPin || ""
      : mode === "2"
      ? data.admin?.staffPin || ""
      : data.admin?.committeePin || "";

  const oldPin = prompt(
    mode === "1"
      ? "Enter current Main Admin PIN"
      : mode === "2"
      ? "Enter current Staff PIN"
      : "Enter current Committee PIN"
  );
  if (oldPin === null) return;

  if (oldPin !== current) {
    alert("Current PIN is incorrect");
    return;
  }

  const nextPin = prompt(
    mode === "1"
      ? "Enter new Main Admin PIN"
      : mode === "2"
      ? "Enter new Staff PIN"
      : "Enter new Committee PIN"
  );
  if (!nextPin) return;

  commit({
    ...data,
    admin: {
      ...(data.admin || {}),
      mainPin:
        mode === "1" ? nextPin : data.admin?.mainPin || "1234",
      staffPin:
        mode === "2" ? nextPin : data.admin?.staffPin || "5678",
      committeePin:
        mode === "3" ? nextPin : data.admin?.committeePin || "9012",
    },
  });

  alert(
    mode === "1"
      ? "Main Admin PIN updated"
      : mode === "2"
      ? "Staff PIN updated"
      : "Committee PIN updated"
  );
}

  function resetAll() {
    if (!admin) return;
    if (!confirm("Reset ALL Q CLUB data to default?")) return;
    const d = defaultData();
commit(d);
setAdminRole("");
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
  scrollAnyOpenPanelToTop();
}, [location.pathname]);
  if (!hasHydratedFromCloud) {
  return (
    <div className="container" style={{ paddingTop: 40 }}>
      <style>{`
        @keyframes qclubBallBounce {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }

        @keyframes qclubCueTravel {
          0% { transform: translateX(0); opacity: .95; }
          50% { transform: translateX(282px); opacity: 1; }
          100% { transform: translateX(0); opacity: .95; }
        }
      `}</style>

      <div
        className="card"
        style={{
          minHeight: 220,
          borderRadius: 28,
          border: "1px solid rgba(255,255,255,.12)",
          background: "linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.03))",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 18,
          boxShadow: "0 20px 50px rgba(0,0,0,.25)",
        }}
      >
        <div
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
            gap: 14,
            padding: "18px 22px 34px",
          }}
        >
          {[
            { color: "#c62828", delay: "0s" },
            { color: "#f6c445", delay: ".1s" },
            { color: "#1faa59", delay: ".2s" },
            { color: "#7a4a22", delay: ".3s" },
            { color: "#1565c0", delay: ".4s" },
            { color: "#ff6fae", delay: ".5s" },
            { color: "#111", delay: ".6s" },
          ].map((ball, i) => (
            <span
              key={i}
              style={{
                width: 26,
                height: 26,
                borderRadius: 999,
                display: "inline-block",
                position: "relative",
                background: ball.color,
                boxShadow:
                  "inset -4px -5px 8px rgba(0,0,0,.35), inset 3px 3px 6px rgba(255,255,255,.18), 0 8px 18px rgba(0,0,0,.28)",
                animation: `qclubBallBounce 1.4s ease-in-out infinite`,
                animationDelay: ball.delay,
              }}
            >
              <span
                style={{
                  position: "absolute",
                  top: 4,
                  left: 5,
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: "rgba(255,255,255,.55)",
                }}
              />
            </span>
          ))}

          <span
            style={{
              position: "absolute",
              left: 8,
              top: 20,
              width: 24,
              height: 24,
              borderRadius: 999,
              background: "#f7f7f7",
              boxShadow:
                "inset -3px -4px 7px rgba(0,0,0,.18), inset 2px 2px 5px rgba(255,255,255,.95), 0 8px 18px rgba(0,0,0,.22)",
              animation: "qclubCueTravel 2.8s ease-in-out infinite",
              zIndex: 2,
            }}
          />
        </div>

        <div
          style={{
            fontSize: "clamp(15px, 2vw, 20px)",
            fontWeight: 700,
            letterSpacing: ".3px",
            color: "rgba(238,243,255,.82)",
          }}
        >
          Setting the table...
        </div>
      </div>
    </div>
  );
}

  return (
    <>
     <TopNav
  club={data.club}
  admin={admin}
  staffAdmin={staffAdmin}
  committeeAdmin={committeeAdmin}
  onToggleAdmin={toggleAdmin}
  onChangePin={changePin}
  onReset={resetAll}
  cloudStatus={cloudStatus}
/>

      <Routes>
        <Route path="/" element={<Home data={data} admin={admin} commit={commit} activeTournament={activeTournament} />} />
        <Route path="/members" element={<MembersPage data={data} admin={admin} commit={commit} />} />
        <Route path="/member-registry" element={<MemberRegistryPage data={data} admin={admin} commit={commit} />} />
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
  path="/tournament-register"
  element={
    <TournamentRegister
      data={data}
      admin={admin}
      commit={commit}
      startPayment={startPayment}
      activeTournament={activeTournament}
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
        <Route
  path="/handicap"
  element={
    <StaticPage title={data.club?.handicapTitle || "Handicap & Classification"}>
      <HandicapContent data={data} admin={admin} commit={commit} />
    </StaticPage>
  }
/>
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
      players={data.players || []}
      admin={admin}
      staffAdmin={staffAdmin}
      commit={commit}
    />
  }
/>
        <Route
  path="/review-panel"
  element={
    <ReviewPanel
  data={data}
  admin={admin}
  staffAdmin={staffAdmin}
  committeeAdmin={committeeAdmin}
  commit={commit}
/>
  }
/>
<Route
  path="/match-ledger"
  element={
    <MatchLedgerPage
      data={data}
      admin={admin}
      staffAdmin={staffAdmin}
      committeeAdmin={committeeAdmin}
      commit={commit}
    />
  }
/>
<Route path="/admin-panel" element={<AdminPanel data={data} admin={admin} commit={commit} activeTournament={activeTournament} />} />
        <Route path="/about" element={<StaticPage title={data.club?.aboutTitle || "About The Q Club"}><AboutContent data={data} admin={admin} commit={commit} /></StaticPage>} />
        <Route path="/contact" element={<StaticPage title={data.club?.contactTitle || "Contact Us"}><ContactContent data={data} admin={admin} commit={commit} /></StaticPage>} />
        <Route path="/terms" element={<StaticPage title={data.club?.termsTitle || "Terms & Conditions"}><TermsContent data={data} admin={admin} commit={commit} /></StaticPage>} />
        <Route path="/refund" element={<StaticPage title={data.club?.refundTitle || "Refund Policy"}><RefundContent data={data} admin={admin} commit={commit} /></StaticPage>} />
        <Route path="/privacy" element={<StaticPage title={data.club?.privacyTitle || "Privacy Policy"}><PrivacyContent data={data} admin={admin} commit={commit} /></StaticPage>} />
        <Route path="/tournament-legal" element={<StaticPage title={data.club?.tournamentDisclaimerTitle || "Tournament Legal Notice"}><TournamentLegalContent data={data} admin={admin} commit={commit} /></StaticPage>} />
        <Route
  path="/admin/orders"
  element={<FoodOrdersAdmin data={data} admin={admin} staffAdmin={staffAdmin} commit={commit} />}
/>
<Route
  path="/admin/orders-archive"
  element={<FoodOrdersArchive data={data} admin={admin} staffAdmin={staffAdmin} commit={commit} />}
/>
        
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
  useEffect(() => {
    window.scrollTo(0, 0);
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, []);

  return (
    <>
      <PageShell title={title} subtitle="The Q Club • Pasighat" />
      <div className="container legalWrap">
        <div className="legalCard">{children}</div>
      </div>
    </>
  );
}

function renderEditableContent(content) {
  const blocks = String(content || "")
    .split(/\n\s*\n/g)
    .map((x) => x.trim())
    .filter(Boolean);

  return blocks.map((block, idx) => {
    const lines = block.split("\n").map((x) => x.trim()).filter(Boolean);
    if (!lines.length) return null;

    if (lines[0].startsWith("## ")) {
      const heading = lines[0].replace(/^##\s+/, "");
      const rest = lines.slice(1);
      const listItems = rest.filter((line) => line.startsWith("- "));
      const textLines = rest.filter((line) => !line.startsWith("- "));

      return (
        <div key={idx}>
          <h3>{heading}</h3>
          {textLines.length ? <p>{textLines.join(" ")}</p> : null}
          {listItems.length ? (
            <ul>
              {listItems.map((item, itemIdx) => (
                <li key={itemIdx}>{item.replace(/^-\s+/, "")}</li>
              ))}
            </ul>
          ) : null}
        </div>
      );
    }

    const listItems = lines.filter((line) => line.startsWith("- "));
    const textLines = lines.filter((line) => !line.startsWith("- "));

    return (
      <div key={idx}>
        {textLines.length ? (
          <p>
            {textLines.map((line, lineIdx) => (
              <React.Fragment key={lineIdx}>
                {lineIdx > 0 ? <br /> : null}
                {line}
              </React.Fragment>
            ))}
          </p>
        ) : null}
        {listItems.length ? (
          <ul>
            {listItems.map((item, itemIdx) => (
              <li key={itemIdx}>{item.replace(/^-\s+/, "")}</li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  });
}

function editStaticPage(admin, data, commit, titleKey, contentKey, fallbackTitle, fallbackContent) {
  if (!admin) return;

  const nextTitle = prompt("Page title:", data.club?.[titleKey] || fallbackTitle);
  if (nextTitle === null) return;

  const nextContent = prompt(
    "Page content. Use blank lines between paragraphs, ## for headings, and - for bullet points.",
    data.club?.[contentKey] || fallbackContent
  );
  if (nextContent === null) return;

  commit({
    ...data,
    club: {
      ...data.club,
      [titleKey]: nextTitle.trim() || fallbackTitle,
      [contentKey]: nextContent.trim() || fallbackContent,
    },
  });
}

function AboutContent({ data, admin, commit }) {
  const fallbackTitle = "About The Q Club";
  const fallbackContent = defaultData().club.aboutContent;
  const content = data.club?.aboutContent || fallbackContent;

  return (
    <>
      {admin ? (
        <div className="row" style={{ justifyContent: "flex-end", marginBottom: 12 }}>
          <button className="btn" onClick={() => editStaticPage(admin, data, commit, "aboutTitle", "aboutContent", fallbackTitle, fallbackContent)}>
            Edit Page
          </button>
        </div>
      ) : null}
      {renderEditableContent(content)}
    </>
  );
}

function ContactContent({ data, admin, commit }) {
  const fallbackTitle = "Contact Us";
  const fallbackContent = defaultData().club.contactContent;
  const content = data.club?.contactContent || fallbackContent;

  return (
    <>
      {admin ? (
        <div className="row" style={{ justifyContent: "flex-end", marginBottom: 12 }}>
          <button className="btn" onClick={() => editStaticPage(admin, data, commit, "contactTitle", "contactContent", fallbackTitle, fallbackContent)}>
            Edit Page
          </button>
        </div>
      ) : null}
      {renderEditableContent(content)}
    </>
  );
}

function TermsContent({ data, admin, commit }) {
  const fallbackTitle = "Terms & Conditions";
  const fallbackContent = defaultData().club.termsContent;
  const content = data.club?.termsContent || fallbackContent;

  return (
    <>
      {admin ? (
        <div className="row" style={{ justifyContent: "flex-end", marginBottom: 12 }}>
          <button className="btn" onClick={() => editStaticPage(admin, data, commit, "termsTitle", "termsContent", fallbackTitle, fallbackContent)}>
            Edit Page
          </button>
        </div>
      ) : null}
      {renderEditableContent(content)}
    </>
  );
}

function RefundContent({ data, admin, commit }) {
  const fallbackTitle = "Refund Policy";
  const fallbackContent = defaultData().club.refundContent;
  const content = data.club?.refundContent || fallbackContent;

  return (
    <>
      {admin ? (
        <div className="row" style={{ justifyContent: "flex-end", marginBottom: 12 }}>
          <button className="btn" onClick={() => editStaticPage(admin, data, commit, "refundTitle", "refundContent", fallbackTitle, fallbackContent)}>
            Edit Page
          </button>
        </div>
      ) : null}
      {renderEditableContent(content)}
    </>
  );
}

function PrivacyContent({ data, admin, commit }) {
  const fallbackTitle = "Privacy Policy";
  const fallbackContent = defaultData().club.privacyContent;
  const content = data.club?.privacyContent || fallbackContent;

  return (
    <>
      {admin ? (
        <div className="row" style={{ justifyContent: "flex-end", marginBottom: 12 }}>
          <button className="btn" onClick={() => editStaticPage(admin, data, commit, "privacyTitle", "privacyContent", fallbackTitle, fallbackContent)}>
            Edit Page
          </button>
        </div>
      ) : null}
      {renderEditableContent(content)}
    </>
  );
}

function TournamentLegalContent({ data, admin, commit }) {
  const fallbackTitle = "Tournament Legal Notice";
  const fallbackContent = defaultData().club.tournamentDisclaimerContent;
  const content = data.club?.tournamentDisclaimerContent || fallbackContent;

  return (
    <>
      {admin ? (
        <div className="row" style={{ justifyContent: "flex-end", marginBottom: 12 }}>
          <button
            className="btn"
            onClick={() =>
              editStaticPage(
                admin,
                data,
                commit,
                "tournamentDisclaimerTitle",
                "tournamentDisclaimerContent",
                fallbackTitle,
                fallbackContent
              )
            }
          >
            Edit Notice
          </button>
        </div>
      ) : null}
      {renderEditableContent(content)}
    </>
  );
}
function HandicapContent({ data, admin, commit }) {
  const fallbackTitle = "Handicap & Classification";
  const fallbackContent = defaultData().club.handicapContent;
  const content = data.club?.handicapContent || fallbackContent;

  return (
    <>
      {admin ? (
        <div className="row" style={{ justifyContent: "flex-end", marginBottom: 12 }}>
          <button
            className="btn"
            onClick={() =>
              editStaticPage(
                admin,
                data,
                commit,
                "handicapTitle",
                "handicapContent",
                fallbackTitle,
                fallbackContent
              )
            }
          >
            Edit Rules
          </button>
        </div>
      ) : null}
      {renderEditableContent(content)}
    </>
  );
}

function BottomPadding() {
  return <div style={{ height: 28 }} />;
}

function TopNav({ club, admin, staffAdmin, committeeAdmin, onToggleAdmin, onChangePin, onReset }) {
  return (
    <div className="nav">
      <div className="nav-inner">
        <div className="brand">
          <div
  className="title"
  onDoubleClick={onToggleAdmin} // desktop
  onTouchStart={(e) => {
    e.currentTarget.pressTimer = setTimeout(() => {
      onToggleAdmin();
    }, 800); // hold for 0.8 sec
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
        
        <Link className="pill" to="/live">Live Matches</Link>
        
        <Link className="pill" to="/photos">Photos</Link>
        <Link className="pill" to="/members">Members</Link>
<Link className="pill" to="/players">Players</Link>
<Link className="pill" to="/handicap">Handicap</Link>
<Link className="pill" to="/tournaments">Tournaments</Link>
        <Link className="pill" to="/fixtures">Fixtures</Link>
        <Link className="pill" to="/leaderboard">Leaderboards</Link>
        <Link className="pill" to="/halloffame">Hall of Fame</Link>
        {(admin || staffAdmin) ? <Link className="pill" to="/tv">TV</Link> : null}

{(admin || staffAdmin) ? <Link className="pill" to="/admin/orders">Orders</Link> : null}

{admin ? <Link className="pill" to="/member-registry">Member Registry</Link> : null}

{(admin || staffAdmin || committeeAdmin) ? (
  <Link className="pill" to="/review-panel">Review Panel</Link>
) : null}
{(admin || staffAdmin || committeeAdmin) ? <Link className="pill" to="/match-ledger">Match Ledger</Link> : null}

{admin ? <Link className="pill" to="/admin-panel">Admin Panel</Link> : null}

       {admin && (
  <>
    <button className="btn primary" onClick={onToggleAdmin}>
      Admin: ON
    </button>
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
function ReviewPanel({ data, admin, staffAdmin, committeeAdmin, commit }) {
  if (!admin && !staffAdmin && !committeeAdmin) {
    return (
      <>
        <PageShell title="Review Panel" subtitle="Restricted access" />
        <div className="container">
          <div className="card">
            <div className="muted">Access denied.</div>
          </div>
        </div>
      </>
    );
  }

  const players = data.players || [];
  const tournaments = data.tournaments || [];
  const reviewHistory = data.reviewHistory || [];

  function addHistoryEntry(player, extra = {}) {
    return {
      id: uid(),
      playerId: player.id,
      playerName: player.name || "",
      action: extra.action || "review_saved",
      fromGroup: String(extra.fromGroup || player.group || "C"),
      toGroup: String(extra.toGroup || player.group || "C"),
      recommendation: String(extra.recommendation || player.reviewRecommendation || "No Change"),
      reviewStatus: String(extra.reviewStatus || player.reviewStatus || "Stable"),
      committeeNotes: String(extra.committeeNotes || player.committeeNotes || ""),
      createdAt: Date.now(),
      reviewDate: todayIso(),
    };
  }

  function updateReviewField(playerId, field, value) {
    commit({
      ...data,
      players: players.map((p) =>
        p.id === playerId ? { ...p, [field]: value } : p
      ),
    });
  }

  function saveReview(playerId) {
    const player = players.find((p) => p.id === playerId);
    if (!player) return;

    const updatedPlayers = players.map((p) =>
      p.id === playerId
        ? {
            ...p,
            lastReviewDate: todayIso(),
          }
        : p
    );

    commit({
      ...data,
      players: updatedPlayers,
      reviewHistory: [
        addHistoryEntry(
          { ...player, lastReviewDate: todayIso() },
          {
            action: "review_saved",
            fromGroup: player.group || "C",
            toGroup: player.group || "C",
          }
        ),
        ...reviewHistory,
      ],
    });

    alert(`Review saved for ${player.name}`);
  }

  function getPlayerEvidence(player) {
  const snookerWinsBase = Number(player.snookerWins || 0);
  const snookerLossesBase = Number(player.snookerLosses || 0);
  const poolWinsBase = Number(player.poolWins || 0);
  const poolLossesBase = Number(player.poolLosses || 0);
  const bestBreakBase = Number(player.bestBreak || 0);

  const ledger = data.matchLedger || [];

  let ledgerSnookerWins = 0;
  let ledgerSnookerLosses = 0;
  let ledgerPoolWins = 0;
  let ledgerPoolLosses = 0;
  let ledgerBestBreak = 0;

  ledger.forEach((m) => {
    const gameKey = tournamentGameKey(m?.game);
    const isP1 = m.player1Id === player.id;
    const isP2 = m.player2Id === player.id;

    if (!isP1 && !isP2) return;

    const winnerId = String(m.winnerId || "");
    const isWin = winnerId && winnerId === player.id;
    const isLoss =
      winnerId &&
      ((isP1 && winnerId === m.player2Id) || (isP2 && winnerId === m.player1Id));

    if (gameKey === "snooker") {
      if (isWin) ledgerSnookerWins += 1;
      if (isLoss) ledgerSnookerLosses += 1;

      const personalBreak = isP1
        ? Number(m.break1 || 0)
        : Number(m.break2 || 0);

      if (Number.isFinite(personalBreak) && personalBreak > ledgerBestBreak) {
        ledgerBestBreak = personalBreak;
      }
    } else {
      if (isWin) ledgerPoolWins += 1;
      if (isLoss) ledgerPoolLosses += 1;
    }
  });

  const snookerWins = snookerWinsBase + ledgerSnookerWins;
  const snookerLosses = snookerLossesBase + ledgerSnookerLosses;
  const poolWins = poolWinsBase + ledgerPoolWins;
  const poolLosses = poolLossesBase + ledgerPoolLosses;
  const bestBreak = Math.max(bestBreakBase, ledgerBestBreak);

  const totalWins = snookerWins + poolWins;
  const totalLosses = snookerLosses + poolLosses;
  const totalMatches = totalWins + totalLosses;
  const winRate = totalMatches > 0 ? Math.round((totalWins / totalMatches) * 100) : 0;

  const recentTournaments = tournaments
    .filter(
      (t) =>
        Array.isArray(t.participantIds) && t.participantIds.includes(player.id)
    )
    .slice(-5);

  const recentNames = recentTournaments.map((t) => t.name).filter(Boolean);

  const recentLedgerMatches = ledger
    .filter((m) => m.player1Id === player.id || m.player2Id === player.id)
    .slice(0, 5)
    .map((m) => {
      const opponentId = m.player1Id === player.id ? m.player2Id : m.player1Id;
      const opponentName =
        m.player1Id === player.id ? m.player2Name : m.player1Name || "";
      const resolvedOpponent =
        opponentName || players.find((p) => p.id === opponentId)?.name || "Opponent";

      return `${tournamentGameKey(m.game) === "pool" ? "Pool" : "Snooker"} vs ${resolvedOpponent}`;
    });

  return {
    snookerWins,
    snookerLosses,
    poolWins,
    poolLosses,
    bestBreak,
    totalWins,
    totalLosses,
    totalMatches,
    winRate,
    recentNames,
    recentLedgerMatches,
    ledgerSnookerWins,
    ledgerSnookerLosses,
    ledgerPoolWins,
    ledgerPoolLosses,
  };
}
  

  function getSuggestedRecommendation(player) {
    const ev = getPlayerEvidence(player);
    const currentGroup = String(player.group || "C").toUpperCase();

    if (ev.totalMatches >= 20 && ev.winRate <= 35 && currentGroup !== "C") {
      return {
        recommendation: "Demote",
        status: currentGroup === "A" ? "Demote to B" : "Demote to C",
        reason: `Low win rate (${ev.winRate}%) over ${ev.totalMatches} combined matches (tournaments + ledger)`,
      };
    }

    if (ev.totalMatches >= 15 && ev.winRate >= 70 && currentGroup !== "A") {
      return {
        recommendation: "Promote",
        status: currentGroup === "C" ? "Promote to B" : "Promote to A",
        reason: `Strong win rate (${ev.winRate}%) over ${ev.totalMatches} combined matches (tournaments + ledger)`,
      };
    }

    if (ev.totalMatches >= 8 && ev.winRate >= 36 && ev.winRate <= 45) {
      return {
        recommendation: "Watchlist",
        status: "Under Review",
        reason: `Borderline record (${ev.winRate}%) - watchlist suggested`,
      };
    }

    if (ev.totalMatches >= 8 && ev.winRate >= 46 && ev.winRate <= 69) {
      return {
        recommendation: "Hold",
        status: "Hold",
        reason: `Competitive but not decisive enough for movement (${ev.winRate}%)`,
      };
    }

    return {
      recommendation: "No Change",
      status: player.reviewStatus || "Stable",
      reason:
        ev.totalMatches < 8
          ? `Not enough recorded matches yet (${ev.totalMatches})`
          : `No movement suggested from current data`,
    };
  }
  function getEligibilityLabel(player, ev) {
  const currentGroup = String(player.group || "C").toUpperCase();

  if (ev.totalMatches < 8) {
    return `Not enough evidence yet (${ev.totalMatches} matches)`;
  }

  if (currentGroup === "A") {
    if (ev.totalMatches >= 20 && ev.winRate <= 35) {
      return "Eligible for demotion review";
    }
    return "Top group — monitor stability";
  }

  if (currentGroup === "B") {
    if (ev.totalMatches >= 15 && ev.winRate >= 70) {
      return "Eligible for promotion review";
    }
    if (ev.totalMatches >= 20 && ev.winRate <= 35) {
      return "Eligible for demotion review";
    }
    return "Under standard review window";
  }

  if (currentGroup === "C") {
    if (ev.totalMatches >= 15 && ev.winRate >= 70) {
      return "Eligible for promotion review";
    }
    return "Development group — continue recording matches";
  }

  return "Under review";
}

  function autoSuggestForPlayer(playerId) {
    const player = players.find((p) => p.id === playerId);
    if (!player) return;

    const suggestion = getSuggestedRecommendation(player);

    commit({
      ...data,
      players: players.map((p) =>
        p.id === playerId
          ? {
              ...p,
              reviewRecommendation: suggestion.recommendation,
              reviewStatus: suggestion.status,
              committeeNotes: p.committeeNotes
                ? p.committeeNotes
                : `Auto suggestion: ${suggestion.reason}`,
              lastReviewDate: todayIso(),
            }
          : p
      ),
      reviewHistory: [
        addHistoryEntry(
          {
            ...player,
            reviewRecommendation: suggestion.recommendation,
            reviewStatus: suggestion.status,
            committeeNotes: player.committeeNotes || `Auto suggestion: ${suggestion.reason}`,
            lastReviewDate: todayIso(),
          },
          {
            action: "auto_suggested",
            fromGroup: player.group || "C",
            toGroup: player.group || "C",
            recommendation: suggestion.recommendation,
            reviewStatus: suggestion.status,
            committeeNotes: player.committeeNotes || `Auto suggestion: ${suggestion.reason}`,
          }
        ),
        ...reviewHistory,
      ],
    });
  }

  function autoSuggestAll() {
    if (!players.length) return;

    const ok = confirm("Run automatic recommendation helper for all players?");
    if (!ok) return;

    const updatedPlayers = players.map((p) => {
      const suggestion = getSuggestedRecommendation(p);
      return {
        ...p,
        reviewRecommendation: suggestion.recommendation,
        reviewStatus: suggestion.status,
        committeeNotes: p.committeeNotes
          ? p.committeeNotes
          : `Auto suggestion: ${suggestion.reason}`,
        lastReviewDate: todayIso(),
      };
    });

    const historyEntries = players.map((p) => {
      const suggestion = getSuggestedRecommendation(p);
      return addHistoryEntry(
        {
          ...p,
          reviewRecommendation: suggestion.recommendation,
          reviewStatus: suggestion.status,
          committeeNotes: p.committeeNotes || `Auto suggestion: ${suggestion.reason}`,
          lastReviewDate: todayIso(),
        },
        {
          action: "auto_suggested",
          fromGroup: p.group || "C",
          toGroup: p.group || "C",
          recommendation: suggestion.recommendation,
          reviewStatus: suggestion.status,
          committeeNotes: p.committeeNotes || `Auto suggestion: ${suggestion.reason}`,
        }
      );
    });

    commit({
      ...data,
      players: updatedPlayers,
      reviewHistory: [...historyEntries.reverse(), ...reviewHistory],
    });

    alert("Automatic recommendation helper applied to all players.");
  }

  function applyRecommendation(playerId) {
    const player = players.find((p) => p.id === playerId);
    if (!player) return;

    const recommendation = String(player.reviewRecommendation || "No Change");
    const currentGroup = String(player.group || "C").toUpperCase();

    let nextGroup = currentGroup;

    if (recommendation === "Promote") {
      nextGroup =
        currentGroup === "C"
          ? "B"
          : currentGroup === "B"
          ? "A"
          : "A";
    } else if (recommendation === "Demote") {
      nextGroup =
        currentGroup === "A"
          ? "B"
          : currentGroup === "B"
          ? "C"
          : "C";
    } else if (
      recommendation === "Hold" ||
      recommendation === "Watchlist" ||
      recommendation === "No Change"
    ) {
      const ok = confirm(
        `${player.name}: recommendation is "${recommendation}". Save review without changing group?`
      );
      if (!ok) return;

      const updatedPlayer = {
        ...player,
        reviewStatus:
          recommendation === "Watchlist"
            ? "Under Review"
            : recommendation === "Hold"
            ? "Hold"
            : player.reviewStatus || "Stable",
        lastReviewDate: todayIso(),
      };

      commit({
        ...data,
        players: players.map((p) =>
          p.id === playerId ? updatedPlayer : p
        ),
        reviewHistory: [
          addHistoryEntry(updatedPlayer, {
            action: "review_updated",
            fromGroup: currentGroup,
            toGroup: currentGroup,
          }),
          ...reviewHistory,
        ],
      });

      alert(`Review updated for ${player.name}`);
      return;
    }

    if (nextGroup === currentGroup) {
      alert(`${player.name} is already in Group ${currentGroup}.`);
      return;
    }

    const ok = confirm(
      `Apply recommendation for ${player.name}?\n\nCurrent Group: ${currentGroup}\nNew Group: ${nextGroup}`
    );
    if (!ok) return;

    const updatedPlayer = {
      ...player,
      group: nextGroup,
      reviewStatus: `Moved to ${nextGroup}`,
      lastReviewDate: todayIso(),
    };

    commit({
      ...data,
      players: players.map((p) =>
        p.id === playerId ? updatedPlayer : p
      ),
      reviewHistory: [
        addHistoryEntry(updatedPlayer, {
          action: "group_changed",
          fromGroup: currentGroup,
          toGroup: nextGroup,
        }),
        ...reviewHistory,
      ],
    });

    alert(`${player.name} moved to Group ${nextGroup}`);
  }
function deletePlayerFromReview(playerId) {
  if (!admin) {
    alert("Only main admin can delete players.");
    return;
  }

  const player = players.find((p) => p.id === playerId);
  if (!player) return;

  const playerNameKey = String(player.name || "").trim().toLowerCase();

  const ok = confirm(
    `Delete ${player.name} everywhere?\n\nThis will remove the player from:\n- Players list\n- Members page matching name\n- Member registry matching name\n- tournament participant lists\n- review history entries\n- match ledger entries`
  );
  if (!ok) return;

  commit({
    ...data,
    players: players.filter((p) => p.id !== playerId),

    membersPage: (data.membersPage || []).filter(
      (m) => String(m?.name || "").trim().toLowerCase() !== playerNameKey
    ),

    memberRegistry: (data.memberRegistry || []).filter(
      (m) => String(m?.name || "").trim().toLowerCase() !== playerNameKey
    ),

    tournaments: (data.tournaments || []).map((t) => ({
      ...t,
      participantIds: (t.participantIds || []).filter((id) => id !== playerId),
      matches: (t.matches || []).map((m) => ({
        ...m,
        p1: m.p1 === playerId ? "" : m.p1,
        p2: m.p2 === playerId ? "" : m.p2,
        winner: m.winner === playerId ? "" : m.winner,
      })),
    })),

    reviewHistory: (data.reviewHistory || []).filter(
      (r) =>
        r.playerId !== playerId &&
        String(r.playerName || "").trim().toLowerCase() !== playerNameKey
    ),

    matchLedger: (data.matchLedger || []).filter((m) => {
      const p1NameKey = String(m?.player1Name || "").trim().toLowerCase();
      const p2NameKey = String(m?.player2Name || "").trim().toLowerCase();

      return (
        m.player1Id !== playerId &&
        m.player2Id !== playerId &&
        p1NameKey !== playerNameKey &&
        p2NameKey !== playerNameKey
      );
    }),
  });

  alert(`${player.name} deleted everywhere.`);
}
  return (
    <>
      <PageShell
        title="Review Panel"
        subtitle="Tournament committee review workspace"
        right={
          <button className="btn primary" onClick={autoSuggestAll}>
            Auto Suggest All
          </button>
        }
      />

      <div className="container">
        <div className="card" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Committee Review Panel</h2>
          <div className="muted" style={{ marginTop: 8 }}>
            Review classification, stats, recent participation, system suggestions, remarks, and apply group changes here.
          </div>
        </div>

        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Recent Review History</h3>

          {reviewHistory.length === 0 ? (
            <div className="muted">No review history yet.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Player</th>
                  <th>Action</th>
                  <th>From</th>
                  <th>To</th>
                  <th>Recommendation</th>
                  <th>Status</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {reviewHistory.slice(0, 20).map((r) => (
                  <tr key={r.id}>
                    <td>{r.reviewDate || "—"}</td>
                    <td>{r.playerName || "—"}</td>
                    <td>{r.action || "—"}</td>
                    <td>{r.fromGroup || "—"}</td>
                    <td>{r.toGroup || "—"}</td>
                    <td>{r.recommendation || "—"}</td>
                    <td>{r.reviewStatus || "—"}</td>
                    <td>{r.committeeNotes || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
  <h3 style={{ marginTop: 0 }}>Players Available For Review</h3>

  {players.length === 0 ? (
    <div className="muted">No players found.</div>
  ) : (
    <div
      style={{
        display: "grid",
        gap: 16,
      }}
    >
      {players.map((p) => {
        const ev = getPlayerEvidence(p);
        const suggestion = getSuggestedRecommendation(p);

        return (
          <div
            key={p.id}
            className="card"
            style={{
              padding: 16,
              border: "1px solid rgba(255,255,255,.08)",
              background: "rgba(255,255,255,.03)",
            }}
          >
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.2fr .8fr .8fr",
                gap: 14,
                alignItems: "start",
              }}
            >
              <div>
                <div style={{ fontSize: 20, fontWeight: 800 }}>{p.name}</div>

                <div className="muted" style={{ marginTop: 6 }}>
                  {playerGamesLabel(p)}
                </div>

                <div style={{ marginTop: 10 }}>
                  <span className="badge">
                    <span className="dot" />
                    Group {p.group || "C"}
                  </span>
                </div>

                <div className="muted" style={{ marginTop: 10 }}>
                  Years Playing: {p.yearsPlaying || "—"}
                </div>
              </div>

              <div>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Performance</div>

                <div className="muted">Snooker: W {ev.snookerWins} • L {ev.snookerLosses}</div>
                <div className="muted" style={{ marginTop: 4 }}>
                  Pool: W {ev.poolWins} • L {ev.poolLosses}
                </div>
                <div className="muted" style={{ marginTop: 4 }}>
                  Total: W {ev.totalWins} • L {ev.totalLosses}
                </div>
                <div className="muted" style={{ marginTop: 4 }}>
                  Matches: {ev.totalMatches}
                </div>
                <div className="muted" style={{ marginTop: 4 }}>
                  Win Rate: {ev.winRate}%
                </div>
                <div className="muted" style={{ marginTop: 4 }}>
                  Best Break: {ev.bestBreak || "—"}
                </div>
              </div>

              <div>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>Evidence</div>

                <div className="muted" style={{ marginBottom: 8 }}>
                  {suggestion.reason}
                </div>

                <div className="muted" style={{ marginBottom: 8 }}>
                  {getEligibilityLabel(p, ev)}
                </div>

                <div className="muted" style={{ marginBottom: 6 }}>
                  Recent Tournaments:
                </div>
                {ev.recentNames.length ? (
                  <div style={{ display: "grid", gap: 4, marginBottom: 10 }}>
                    {ev.recentNames.map((name, idx) => (
                      <div key={idx} className="muted">
                        • {name}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="muted" style={{ marginBottom: 10 }}>
                    No recent tournaments
                  </div>
                )}

                <div className="muted" style={{ marginBottom: 6 }}>
                  Recent Ledger Matches:
                </div>
                {ev.recentLedgerMatches.length ? (
                  <div style={{ display: "grid", gap: 4 }}>
                    {ev.recentLedgerMatches.map((name, idx) => (
                      <div key={idx} className="muted">
                        • {name}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="muted">No ledger matches</div>
                )}
              </div>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 14,
                marginTop: 16,
              }}
            >
              <div>
                <label className="lbl">Review Status</label>
                <select
                  value={p.reviewStatus || "Stable"}
                  onChange={(e) =>
                    updateReviewField(p.id, "reviewStatus", e.target.value)
                  }
                >
                  <option value="Stable">Stable</option>
                  <option value="Under Review">Under Review</option>
                  <option value="Promote to B">Promote to B</option>
                  <option value="Promote to A">Promote to A</option>
                  <option value="Demote to B">Demote to B</option>
                  <option value="Demote to C">Demote to C</option>
                  <option value="Hold">Hold</option>
                </select>
              </div>

              <div>
                <label className="lbl">Recommendation</label>
                <select
                  value={p.reviewRecommendation || "No Change"}
                  onChange={(e) =>
                    updateReviewField(p.id, "reviewRecommendation", e.target.value)
                  }
                >
                  <option value="No Change">No Change</option>
                  <option value="Promote">Promote</option>
                  <option value="Demote">Demote</option>
                  <option value="Hold">Hold</option>
                  <option value="Watchlist">Watchlist</option>
                </select>
              </div>

              <div style={{ gridColumn: "1 / -1" }}>
                <label className="lbl">Committee Notes</label>
                <textarea
                  value={p.committeeNotes || ""}
                  onChange={(e) =>
                    updateReviewField(p.id, "committeeNotes", e.target.value)
                  }
                  placeholder="Committee remarks..."
                  style={{ minHeight: 90 }}
                />
              </div>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                marginTop: 16,
                flexWrap: "wrap",
              }}
            >
              <div className="muted">
                Last Review: {p.lastReviewDate || "—"}
              </div>

              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
  <button
    className="btn"
    type="button"
    onClick={() => autoSuggestForPlayer(p.id)}
  >
    Auto Suggest
  </button>
  <button
    className="btn"
    type="button"
    onClick={() => saveReview(p.id)}
  >
    Save Review
  </button>
  <button
    className="btn primary"
    type="button"
    onClick={() => applyRecommendation(p.id)}
  >
    Apply
  </button>

  {admin ? (
    <button
      className="btn danger"
      type="button"
      onClick={() => deletePlayerFromReview(p.id)}
    >
      Delete Player
    </button>
  ) : null}
</div>
            </div>
          </div>
        );
      })}
    </div>
  )}
</div>
      </div>
    </>
  );
}
function MatchLedgerPage({ data, admin, staffAdmin, committeeAdmin, commit }) {
  if (!admin && !staffAdmin && !committeeAdmin) {
    return (
      <>
        <PageShell title="Match Ledger" subtitle="Restricted access" />
        <div className="container">
          <div className="card">
            <div className="muted">Access denied.</div>
          </div>
        </div>
      </>
    );
  }

  const players = data.players || [];
  const matchLedger = data.matchLedger || [];

  const [form, setForm] = useState({
    date: todayIso(),
    game: "snooker",
    player1Id: "",
    player2Id: "",
    score1: "",
    score2: "",
    break1: "",
    break2: "",
    venueType: "club",
    notes: "",
  });

  const filteredPlayers = players.filter((p) =>
    normalizePlayerGames(p.games).includes(form.game)
  );

  function playerName(id) {
    return players.find((p) => p.id === id)?.name || "Unknown Player";
  }

  function resetForm() {
    setForm({
      date: todayIso(),
      game: "snooker",
      player1Id: "",
      player2Id: "",
      score1: "",
      score2: "",
      break1: "",
      break2: "",
      venueType: "club",
      notes: "",
    });
  }

  function saveLedgerMatch() {
    if (!admin && !staffAdmin) {
      alert("Only admin or staff can add match records.");
      return;
    }

    if (!form.player1Id || !form.player2Id) {
      alert("Please select both players.");
      return;
    }

    if (form.player1Id === form.player2Id) {
      alert("Player 1 and Player 2 cannot be the same.");
      return;
    }

    const s1 = Number(form.score1);
    const s2 = Number(form.score2);

    if (!Number.isFinite(s1) || !Number.isFinite(s2)) {
      alert("Enter valid scores.");
      return;
    }

    const winnerId = s1 === s2 ? "" : s1 > s2 ? form.player1Id : form.player2Id;

    const entry = {
      id: uid(),
      date: form.date || todayIso(),
      game: tournamentGameKey(form.game),
      player1Id: form.player1Id,
      player2Id: form.player2Id,
      player1Name: playerName(form.player1Id),
      player2Name: playerName(form.player2Id),
      score1: String(form.score1),
      score2: String(form.score2),
      break1: form.game === "snooker" ? String(form.break1 || "") : "",
      break2: form.game === "snooker" ? String(form.break2 || "") : "",
      winnerId,
      venueType: form.venueType || "club",
      source: "manual",
      notes: String(form.notes || "").trim(),
      createdAt: Date.now(),
    };

    commit({
      ...data,
      matchLedger: [entry, ...(data.matchLedger || [])],
    });

    resetForm();
    alert("Match saved to ledger.");
  }

  function deleteLedgerMatch(id) {
    if (!admin) {
      alert("Only main admin can delete ledger matches.");
      return;
    }

    if (!confirm("Delete this match record?")) return;

    commit({
      ...data,
      matchLedger: (data.matchLedger || []).filter((m) => m.id !== id),
    });
  }

  return (
    <>
      <PageShell
        title="Match Ledger"
        subtitle="Structured non-tournament and review match records"
      />

      <div className="container">
        <div className="card" style={{ marginBottom: 16 }}>
          <h2 style={{ marginTop: 0 }}>Record Match</h2>

          <div className="grid">
            <div className="cols-4">
              <label className="lbl">Date</label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
            </div>

            <div className="cols-4">
              <label className="lbl">Game</label>
              <select
                value={form.game}
                onChange={(e) =>
                  setForm({
                    ...form,
                    game: tournamentGameKey(e.target.value),
                    player1Id: "",
                    player2Id: "",
                    break1: "",
                    break2: "",
                  })
                }
              >
                <option value="snooker">Snooker</option>
                <option value="pool">Pool</option>
              </select>
            </div>

            <div className="cols-4">
              <label className="lbl">Venue Type</label>
              <select
                value={form.venueType}
                onChange={(e) => setForm({ ...form, venueType: e.target.value })}
              >
                <option value="club">Club</option>
                <option value="tournament_review">Tournament Review</option>
                <option value="friendly">Friendly</option>
                <option value="practice">Practice</option>
              </select>
            </div>

            <div className="cols-6">
              <label className="lbl">Player 1</label>
              <select
                value={form.player1Id}
                onChange={(e) => setForm({ ...form, player1Id: e.target.value })}
              >
                <option value="">Select player</option>
                {filteredPlayers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="cols-6">
              <label className="lbl">Player 2</label>
              <select
                value={form.player2Id}
                onChange={(e) => setForm({ ...form, player2Id: e.target.value })}
              >
                <option value="">Select player</option>
                {filteredPlayers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="cols-3">
              <label className="lbl">Score 1</label>
              <input
                value={form.score1}
                onChange={(e) => setForm({ ...form, score1: e.target.value })}
                placeholder="0"
              />
            </div>

            <div className="cols-3">
              <label className="lbl">Score 2</label>
              <input
                value={form.score2}
                onChange={(e) => setForm({ ...form, score2: e.target.value })}
                placeholder="0"
              />
            </div>

            {form.game === "snooker" ? (
              <>
                <div className="cols-3">
                  <label className="lbl">Break 1</label>
                  <input
                    value={form.break1}
                    onChange={(e) => setForm({ ...form, break1: e.target.value })}
                    placeholder="0"
                  />
                </div>

                <div className="cols-3">
                  <label className="lbl">Break 2</label>
                  <input
                    value={form.break2}
                    onChange={(e) => setForm({ ...form, break2: e.target.value })}
                    placeholder="0"
                  />
                </div>
              </>
            ) : null}

            <div className="cols-12">
              <label className="lbl">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                placeholder="Optional notes"
              />
            </div>
          </div>

          <div className="row" style={{ marginTop: 14, gap: 8, flexWrap: "wrap" }}>
            <button className="btn primary" type="button" onClick={saveLedgerMatch}>
              Save Match
            </button>
            <button className="btn" type="button" onClick={resetForm}>
              Reset
            </button>
          </div>
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Recent Match Ledger</h2>

          {matchLedger.length === 0 ? (
            <div className="muted">No recorded matches yet.</div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Game</th>
                  <th>Match</th>
                  <th>Score</th>
                  <th>Breaks</th>
                  <th>Winner</th>
                  <th>Source</th>
                  <th>Venue</th>
                  <th>Notes</th>
                  <th>Admin</th>
                </tr>
              </thead>
              <tbody>
                {matchLedger.slice(0, 50).map((m) => (
                  <tr key={m.id}>
                    <td>{m.date || "—"}</td>
                    <td>{tournamentGameKey(m.game) === "pool" ? "Pool" : "Snooker"}</td>
                    <td>
                      <b>{m.player1Name || playerName(m.player1Id)}</b>
                      {" "}vs{" "}
                      <b>{m.player2Name || playerName(m.player2Id)}</b>
                    </td>
                    <td>{m.score1} - {m.score2}</td>
                    <td>
                      {tournamentGameKey(m.game) === "snooker"
                        ? `${m.break1 || 0} / ${m.break2 || 0}`
                        : "—"}
                    </td>
                    <td>{m.winnerId ? playerName(m.winnerId) : "Draw"}</td>
                    <td>{m.source || "manual"}</td>
                    <td>{m.venueType || "club"}</td>
                    <td>{m.notes || "—"}</td>
                    <td>
                      {admin ? (
                        <button
                          className="btn danger"
                          type="button"
                          onClick={() => deleteLedgerMatch(m.id)}
                        >
                          Delete
                        </button>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
function playersForTournament(tournament, allPlayers = []) {
  if (!tournament) return [];
  const ids = tournament.participantIds || [];
  if (!ids.length) return getEligiblePlayersForTournament(allPlayers, tournament);
  return (allPlayers || []).filter((p) => ids.includes(p.id));
}
function BeyondTablesSection() {
  const [activeImage, setActiveImage] = useState(null);

  const cards = [
    {
      title: "Air Hockey",
      desc: "Fast-paced 1v1 action",
      img: "/home/air-hockey.png",
    },
    {
      title: "Foosball",
      desc: "Fun 2v2 battles",
      img: "/home/foosball.jpg",
    },
    {
      title: "Massage Chair",
      desc: "Relax between games",
      img: "/home/massagechair.png",
    },
  ];

  return (
    <>
      <div className="card">
        <h2 style={{ marginBottom: 6 }}>Beyond the Tables</h2>
        <div className="muted" style={{ marginBottom: 12 }}>
          More than just snooker — experience The Q Club
        </div>

        <div className="bt-scroll">
          {cards.map((c) => (
            <button
              key={c.title}
              type="button"
              className="bt-card"
              onClick={() => setActiveImage(c)}
            >
              <img src={c.img} alt={c.title} />
              <div className="bt-overlay">
                <h3>{c.title}</h3>
                <p>{c.desc}</p>
                <span className="btn primary">View Image</span>
              </div>
            </button>
          ))}
        </div>
      </div>

      {activeImage ? (
        <div className="bt-modal" onClick={() => setActiveImage(null)}>
          <div
            className="bt-modal-card"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="bt-close"
              onClick={() => setActiveImage(null)}
            >
              ×
            </button>

            <img
              src={activeImage.img}
              alt={activeImage.title}
              className="bt-modal-img"
            />

            <div className="bt-modal-info">
              <h3>{activeImage.title}</h3>
              <div className="muted">{activeImage.desc}</div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}


function Home({ data, admin, commit, activeTournament }) {
  const phone = [data.club?.contact?.phone1, data.club?.contact?.phone2]
    .filter(Boolean)
    .join(" / ");
    function addAnnouncement() {
  if (!admin) return;

  const text = prompt("Announcement text:", "");
  if (!text) return;

  const link = prompt("Announcement link (example: /offer or /fixtures):", "") || "";

  commit({
    ...data,
    announcements: [
      ...(data.announcements || []),
      {
        id: `ann_${Date.now()}`,
        text: text.trim(),
        link: link.trim(),
      },
    ],
  });
}

function editAnnouncement(id) {
  if (!admin) return;

  const current = (data.announcements || []).find((a) => a.id === id);
  if (!current) return;

  const text = prompt("Edit announcement text:", current.text || "");
  if (!text) return;

  const link = prompt("Edit announcement link:", current.link || "") || "";

  commit({
    ...data,
    announcements: (data.announcements || []).map((a) =>
      a.id === id
        ? { ...a, text: text.trim(), link: link.trim() }
        : a
    ),
  });
}

function deleteAnnouncement(id) {
  if (!admin) return;
  if (!confirm("Delete this announcement?")) return;

  commit({
    ...data,
    announcements: (data.announcements || []).filter((a) => a.id !== id),
  });
}

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
  const featuredTournaments =
  (data.tournaments || []).filter(Boolean).length > 0
    ? (data.tournaments || []).filter(Boolean)
    : (activeTournament ? [activeTournament] : []);

const [featuredTournamentIndex, setFeaturedTournamentIndex] = useState(0);

useEffect(() => {
  if (featuredTournaments.length <= 1) return;

  const timer = setInterval(() => {
    setFeaturedTournamentIndex((prev) =>
      prev === featuredTournaments.length - 1 ? 0 : prev + 1
    );
  }, 3200);

  return () => clearInterval(timer);
}, [featuredTournaments.length]);

const displayedFeaturedTournament =
  featuredTournaments[featuredTournamentIndex] || activeTournament || null;

const isSnookerTournament =
  tournamentGameKey(displayedFeaturedTournament?.game) === "snooker";

const tournamentImage = isSnookerTournament ? "/home/snooker.jpg" : "/home/pool.jpg";
const disclaimerTitle = data.club?.tournamentDisclaimerTitle || "Tournament Legal Disclaimer";
const disclaimerContent = data.club?.tournamentDisclaimerContent || defaultData().club.tournamentDisclaimerContent;
  const clubGallery = [
    { id: "snooker", url: "/home/snooker.jpg", caption: "Snooker" },
    { id: "airhockey", url: "/home/air-hockey.png", caption: "Air Hockey" },
    { id: "foosball", url: "/home/foosball.jpg", caption: "Foosball" },
  ];

  const memberships = (data.memberships || []).slice(0, 3);

  return (
  <>
    <style>{`
      @keyframes qclubLockDrop {
        0% {
          opacity: 0;
          transform: translateY(-34px) rotateX(75deg);
          filter: blur(1.5px);
        }
        55% {
          opacity: 1;
          transform: translateY(6px) rotateX(0deg);
          filter: blur(0);
        }
        100% {
          opacity: 1;
          transform: translateY(0) rotateX(0deg);
          filter: blur(0);
        }
      }
    `}</style>

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

      <section className="refInfoGrid">
  <div className="refGlassCard" style={{ gridColumn: "1 / -1", overflow: "hidden" }}>
    <div className="refInfoLabel" style={{ marginBottom: 10 }}>Announcements</div>

    <div className="announceTicker">
      <div
  className="announceTickerTrack"
  style={{
    animationDuration: `${data.club?.tickerSpeed || 28}s`,
  }}
>
        {(data.announcements || []).length > 0
          ? [...(data.announcements || []), ...(data.announcements || [])].map((a, idx) => (
              <a
  key={`${a.id || idx}-${idx}`}
  className="announceTickerItem"
  href={a.link || "#"}
  onClick={(e) => {
    if (!a.link) e.preventDefault();
  }}
>
  {a.text}
</a>
            ))
          : (
              <span className="announceTickerItem">No announcements yet.</span>
            )}
      </div>
    </div>
  </div>
  {admin && (
  <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: "wrap" }}>
    <button className="btn" type="button" onClick={addAnnouncement}>
      + Add Announcement
    </button>
    <div className="row" style={{ gap: 6, alignItems: "center" }}>
  <span className="muted">Ticker Speed</span>
  <input
    type="number"
    min="10"
    max="120"
    step="1"
    value={data.club?.tickerSpeed || 28}
    onChange={(e) =>
      commit({
        ...data,
        club: {
          ...data.club,
          tickerSpeed: safeNum(e.target.value, 28),
        },
      })
    }
    style={{
      width: 90,
      padding: "8px 10px",
      borderRadius: 10,
      border: "1px solid rgba(255,255,255,.12)",
      background: "rgba(255,255,255,.04)",
      color: "#eaf0ff",
    }}
  />
</div>
    <div
  className="announceTickerTrack"
  style={{
    animationDuration: `${data.club?.tickerSpeed || 28}s`,
  }}
></div>

    {(data.announcements || []).map((a) => (
      <div key={a.id} className="row" style={{ gap: 6 }}>
        <button
          className="btn secondary"
          type="button"
          onClick={() => editAnnouncement(a.id)}
        >
          Edit
        </button>

        <button
          className="btn danger"
          type="button"
          onClick={() => deleteAnnouncement(a.id)}
        >
          Delete
        </button>
      </div>
    ))}
  </div>
)}
<BeyondTablesSection />
</section>

      

      <section className="refTournamentCard">
        <div className="refTournamentContent">
          <div className="refTournamentKicker">Featured Tournaments</div>
          <div className="refTournamentName" style={{ overflow: "hidden" }}>
  <div
    key={`featured-name-${featuredTournamentIndex}`}
    style={{
      display: "inline-block",
      animation: "qclubLockDrop .45s ease",
      transformOrigin: "center top",
      willChange: "transform, opacity",
    }}
  >
    {displayedFeaturedTournament?.name || "Q Club Tournament"}
  </div>
</div>
<div className="refTournamentMonth" style={{ overflow: "hidden" }}>
  <div
    key={`featured-month-${featuredTournamentIndex}`}
    style={{
      display: "inline-block",
      animation: "qclubLockDrop .5s ease",
      transformOrigin: "center top",
      willChange: "transform, opacity",
    }}
  >
    {displayedFeaturedTournament?.month || "This Month"}
  </div>
</div>
<div className="muted" style={{ marginTop: 8, overflow: "hidden" }}>
  <div
    key={`featured-game-${featuredTournamentIndex}`}
    style={{
      display: "inline-block",
      animation: "qclubLockDrop .55s ease",
      transformOrigin: "center top",
      willChange: "transform, opacity",
    }}
  >
    {isSnookerTournament ? "Snooker Tournament" : "Pool Tournament"}
  </div>
</div>

          <div style={{ marginTop: 18, display: "grid", gap: 12 }}>
  <Link
    className="btn primary"
    to="/tournaments"
    style={{
      width: "100%",
      minWidth: 0,
      textAlign: "center",
      fontWeight: 800,
      fontSize: "1.02rem",
      padding: "16px 18px",
      borderRadius: 20,
      background: "linear-gradient(90deg, #11f0c8, #1bbcff)",
      boxShadow: "0 0 18px rgba(20, 220, 210, 0.45)",
      animation: "pulseGlow 1.5s infinite",
    }}
  >
    Explore Tournaments
  </Link>

  <div
    style={{
      display: "grid",
      gridTemplateColumns: "1fr 1fr",
      gap: 12,
    }}
  >
    <Link
      className="btn primary"
      to={`/tournament-register?id=${displayedFeaturedTournament?.id || ""}`}
      style={{
        minWidth: 0,
        textAlign: "center",
        justifyContent: "center",
        fontWeight: 900,
        fontSize: "1rem",
        padding: "15px 14px",
        borderRadius: 18,
        color: "#fff6f2",
        border: "1px solid rgba(255,120,80,.35)",
        background:
          "linear-gradient(135deg, #ff7a18 0%, #ff3d00 45%, #b31217 100%)",
        boxShadow:
          "0 10px 24px rgba(255,70,20,.30), 0 0 16px rgba(255,90,40,.22), inset 0 1px 0 rgba(255,255,255,.18)",
      }}
    >
      🔥 Register Now
    </Link>

    <a
      href={data.club?.liveStreamUrl || "#"}
      target="_blank"
      rel="noopener noreferrer"
      className="btn"
      style={{
        minWidth: 0,
        textAlign: "center",
        justifyContent: "center",
        fontWeight: 700,
        fontSize: "1rem",
        padding: "15px 14px",
        borderRadius: 18,
        color: "#eef3ff",
        border: "1px solid rgba(255,255,255,.14)",
        background:
          "linear-gradient(135deg, rgba(255,255,255,.08), rgba(255,255,255,.03))",
        boxShadow:
          "0 8px 22px rgba(0,0,0,.22), inset 0 1px 0 rgba(255,255,255,.08)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
      }}
    >
      📺 Watch Live
    </a>
  </div>
</div>
        </div>

        <div className="refTournamentVisual">
          <img
  src={tournamentImage}
  alt={displayedFeaturedTournament?.name || (isSnookerTournament ? "Snooker Tournament" : "Pool Tournament")}
/>
        </div>
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div className="refTournamentKicker">{disclaimerTitle}</div>
            <div className="muted" style={{ marginTop: 10 }}>
              Read the full tournament legal notice before registering or participating.
            </div>
          </div>

          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <Link className="btn secondary" to="/tournament-legal">
              View Legal Notice
            </Link>

            {admin ? (
              <button
                className="btn"
                onClick={() => editStaticPage(admin, data, commit, "tournamentDisclaimerTitle", "tournamentDisclaimerContent", "Tournament Legal Notice", defaultData().club.tournamentDisclaimerContent)}
              >
                Edit Notice
              </button>
            ) : null}
          </div>
        </div>
            </section>
    </div>
  </>
  );
}
function MembersPage({ data, admin, commit }) {
  const members = Array.isArray(data.membersPage) ? data.membersPage : [];
  function addMember() {
  if (!admin) return;

  const name = prompt("Member name:", "");
  if (!name) return;

  const tier = prompt("Membership tier:", "Gold") || "";
  const joinedOn = prompt("Joined date (YYYY-MM-DD):", new Date().toISOString().slice(0, 10)) || "";
  const note = prompt("Short note:", "") || "";

  const manualMemberAnnouncement = {
  id: uid(),
  text: `${name.trim()} joins as the latest Q Club member !`,
  link: "/members",
  createdAt: Date.now(),
};

commit({
  ...data,
  membersPage: [
    ...(data.membersPage || []),
    {
      id: `member_${Date.now()}`,
      name: name.trim(),
      tier: tier.trim(),
      joinedOn: joinedOn.trim(),
      note: note.trim(),
      photo: "",
    },
  ],
  announcements: [
    manualMemberAnnouncement,
    ...(data.announcements || []),
  ].slice(0, 20),
});
}

function editMember(id) {
  if (!admin) return;

  const current = (data.membersPage || []).find((m) => m.id === id);
  if (!current) return;

  const name = prompt("Edit member name:", current.name || "");
  if (!name) return;

  const tier = prompt("Edit membership tier:", current.tier || "") || "";
  const joinedOn = prompt("Edit joined date:", current.joinedOn || "") || "";
  const note = prompt("Edit short note:", current.note || "") || "";

  commit({
    ...data,
    membersPage: (data.membersPage || []).map((m) =>
      m.id === id
        ? {
            ...m,
            name: name.trim(),
            tier: tier.trim(),
            joinedOn: joinedOn.trim(),
            note: note.trim(),
          }
        : m
    ),
  });
}

function deleteMember(id) {
  if (!admin) return;
  if (!confirm("Delete this member?")) return;

  commit({
    ...data,
    membersPage: (data.membersPage || []).filter((m) => m.id !== id),
  });
}
async function uploadMemberPhoto(memberId, file) {
  if (!admin) return alert("Admin only");
  if (!file) return;

  try {
    const uploaded = await uploadImageToStorage(file, "members");

    commit({
      ...data,
      membersPage: (data.membersPage || []).map((m) =>
        m.id === memberId
          ? {
              ...m,
              photo: uploaded.url,
              photoPath: uploaded.path,
            }
          : m
      ),
    });
  } catch (err) {
    console.error(err);
    alert("Failed to upload member photo.");
  }
}

  return (
    <div className="container">
      <div className="sectionTitle">
        <span className="dot" />
        <span>Members</span>
      </div>

      <h1 style={{ marginBottom: 18 }}>The Q Club Members</h1>

      <p className="muted" style={{ marginBottom: 20 }}>
        Meet the valued members of The Q Club community.
      </p>
      {admin && (
  <div className="row" style={{ marginBottom: 18, gap: 8, flexWrap: "wrap" }}>
    <button className="btn" type="button" onClick={addMember}>
      + Add Member
    </button>
  </div>
)}

      {members.length === 0 ? (
        <div className="card">
          <div className="muted">No members added yet.</div>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: 18
          }}
        >
          {members.map((member) => (
            <div key={member.id} className="card">
              <div
  style={{
    width: "100%",
    height: 220,
    borderRadius: 16,
    background: "rgba(255,255,255,0.04)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
    marginBottom: 14
  }}
>
  {member.photo ? (
    <img
      src={member.photo}
      alt={member.name}
      style={{
        width: "100%",
        height: "100%",
        objectFit: "contain",
        background: "rgba(255,255,255,0.03)"
      }}
    />
  ) : (
    <div className="muted">No Photo</div>
  )}
</div>

              <h3 style={{ margin: "0 0 8px" }}>{member.name}</h3>

              <div className="muted" style={{ marginBottom: 8 }}>
                Tier: {member.tier || "—"}
              </div>

              <div className="muted" style={{ marginBottom: 8 }}>
                Joined: {member.joinedOn || "—"}
              </div>

              <div>{member.note || "—"}</div>
              {admin && (
  <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: "wrap" }}>
    <label className="btn secondary" style={{ cursor: "pointer" }}>
      Upload Photo
      <input
        type="file"
        accept="image/*"
        style={{ display: "none" }}
        onChange={(e) => uploadMemberPhoto(member.id, e.target.files?.[0])}
      />
    </label>

    <button className="btn secondary" type="button" onClick={() => editMember(member.id)}>
      Edit
    </button>

    <button className="btn danger" type="button" onClick={() => deleteMember(member.id)}>
      Delete
    </button>
  </div>
)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
function MemberRegistryPage({ data, admin, commit }) {
  if (!admin) {
    return (
      <>
        <PageShell title="Member Registry" subtitle="Admin only" />
        <div className="container">
          <div className="card">
            <div className="muted">Admin access required.</div>
          </div>
        </div>
      </>
    );
  }

  const registry = Array.isArray(data.memberRegistry) ? data.memberRegistry : [];

  function addRegistryMember() {
    const name = prompt("Member name:", "");
    if (!name) return;

    const mobile = prompt("Mobile number:", "") || "";
    const tier = prompt("Tier:", "Gold") || "";
    const joinedOn =
      prompt("Joined date (YYYY-MM-DD):", new Date().toISOString().slice(0, 10)) || "";
    const validUntil =
      prompt("Valid until (YYYY-MM-DD):", new Date().toISOString().slice(0, 10)) || "";
    const status = prompt("Status (active/expired/pending):", "active") || "active";
    const notes = prompt("Notes:", "") || "";

    commit({
      ...data,
      memberRegistry: [
        ...(data.memberRegistry || []),
        {
          id: `reg_${Date.now()}`,
          name: name.trim(),
          mobile: mobile.trim(),
          tier: tier.trim(),
          joinedOn: joinedOn.trim(),
          validUntil: validUntil.trim(),
          status: status.trim().toLowerCase(),
          notes: notes.trim(),
        },
      ],
    });
  }

  function editRegistryMember(id) {
    const current = (data.memberRegistry || []).find((m) => m.id === id);
    if (!current) return;

    const name = prompt("Edit member name:", current.name || "");
    if (!name) return;

    const mobile = prompt("Edit mobile number:", current.mobile || "") || "";
    const tier = prompt("Edit tier:", current.tier || "") || "";
    const joinedOn = prompt("Edit joined date:", current.joinedOn || "") || "";
    const validUntil = prompt("Edit valid until:", current.validUntil || "") || "";
    const status = prompt("Edit status (active/expired/pending):", current.status || "active") || "active";
    const notes = prompt("Edit notes:", current.notes || "") || "";

    commit({
      ...data,
      memberRegistry: (data.memberRegistry || []).map((m) =>
        m.id === id
          ? {
              ...m,
              name: name.trim(),
              mobile: mobile.trim(),
              tier: tier.trim(),
              joinedOn: joinedOn.trim(),
              validUntil: validUntil.trim(),
              status: status.trim().toLowerCase(),
              notes: notes.trim(),
            }
          : m
      ),
    });
  }

  function deleteRegistryMember(id) {
    if (!confirm("Delete this registry member?")) return;

    commit({
      ...data,
      memberRegistry: (data.memberRegistry || []).filter((m) => m.id !== id),
    });
  }

  return (
    <>
      <PageShell
        title="Private Member Registry"
        subtitle="Admin-only member records"
        right={
          <button className="btn primary" type="button" onClick={addRegistryMember}>
            + Add Member
          </button>
        }
      />

      <div className="container">
        {registry.length === 0 ? (
          <div className="card">
            <div className="muted">No private member records yet.</div>
          </div>
        ) : (
          <div className="card">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Mobile</th>
                  <th>Tier</th>
                  <th>Joined</th>
                  <th>Valid Until</th>
                  <th>Status</th>
                  <th>Notes</th>
                  <th>Admin</th>
                </tr>
              </thead>
              <tbody>
                {registry.map((m) => (
                  <tr key={m.id}>
                    <td><b>{m.name}</b></td>
                    <td>{m.mobile || "—"}</td>
                    <td>{m.tier || "—"}</td>
                    <td>{m.joinedOn || "—"}</td>
                    <td>{m.validUntil || "—"}</td>
                    <td>
  {(() => {
    const today = todayIso();
    const expiry = m.validUntil || "";

    let label = "—";
    let color = "#999";

    if (m.status !== "active") {
      label = m.status;
      color = "#ff4d4d";
    } else if (expiry < today) {
      label = "Expired";
      color = "#ff4d4d";
    } else {
      const diff =
        (new Date(expiry) - new Date(today)) / (1000 * 60 * 60 * 24);

      if (diff <= 3) {
        label = "Expiring Soon";
        color = "#ffcc00";
      } else {
        label = "Active";
        color = "#22c55e";
      }
    }

    return (
      <span style={{ color, fontWeight: 700 }}>
        {label}
      </span>
    );
  })()}
</td>
                    <td>{m.notes || "—"}</td>
                    <td>
                      <div className="row">
                        <button className="btn" type="button" onClick={() => editRegistryMember(m.id)}>
                          Edit
                        </button>
                        <button className="btn danger" type="button" onClick={() => deleteRegistryMember(m.id)}>
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
    </>
  );
}

function Offers({ data, admin, commit, startPayment }) {
  const menu = data.menuCatalog || {};
  const categories = Object.keys(menu);
  const [activeCategory, setActiveCategory] = React.useState(categories[0] || "");

  React.useEffect(() => {
    window.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  }, [activeCategory]);

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
  const touchStartX = React.useRef(null);
  const touchEndX = React.useRef(null);

  React.useEffect(() => {
    if (!activeCategory && categories.length) {
      setActiveCategory(categories[0]);
    }
  }, [activeCategory, categories]);

  function handleCategorySwipe() {
    if (!categories.length) return;
    if (touchStartX.current === null || touchEndX.current === null) return;

    const deltaX = touchStartX.current - touchEndX.current;

    if (Math.abs(deltaX) < 50) return;

    const currentIndex = categories.indexOf(activeCategory);
    if (currentIndex === -1) return;

    if (deltaX > 0 && currentIndex < categories.length - 1) {
      setActiveCategory(categories[currentIndex + 1]);
    } else if (deltaX < 0 && currentIndex > 0) {
      setActiveCategory(categories[currentIndex - 1]);
    }

    touchStartX.current = null;
    touchEndX.current = null;
  }

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
        item.id === itemId
          ? { ...item, [field]: field === "price" ? Number(value) : value }
          : item
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

  function emptyCart() {
    const ok = confirm("Are you sure you want to empty the cart?");
    if (!ok) return;

    setCart({});
    setShowCheckout(false);
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

      <div className="offersStickyBar">
        <p className="muted" style={{ marginBottom: 20 }}>
          Browse by Category
        </p>

        <div className="swipeHint">
          ← Swipe to browse categories →
        </div>

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
      </div>

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
    alignItems: "center",
    gap: 8,
    padding: "3px 0"
  }}
>
                      <div
  style={{
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
    flex: 1
  }}
>
                        <div
  style={{
    fontWeight: 600,
    fontSize: "0.95rem",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: "140px"
  }}
>
  {found.name}
</div>

                        <div className="row" style={{ gap: 4 }}>
                          <button
  className="btn secondary"
  type="button"
  onClick={() => removeFromCart(found)}
  style={{ minWidth: 32, height: 32, padding: "0 10px" }}
>
  −
</button>

                          <div style={{ fontWeight: 800, minWidth: 16, textAlign: "center", fontSize: "0.95rem" }}>
  {cart[id]}
</div>

                          <button
  className="btn secondary"
  type="button"
  onClick={() => addToCart(found)}
  style={{ minWidth: 32, height: 32, padding: "0 10px" }}
>
  +
</button>
                        </div>
                      </div>

                      <strong
  style={{
    minWidth: 70,
    textAlign: "right",
    fontSize: "0.95rem"
  }}
>
  ₹{found.price * cart[id]}
</strong>
                    </div>
                  );
                })}
              </div>

              <div style={{ marginTop: 12, fontWeight: 800, fontSize: "1.1rem" }}>
                Total: ₹{cartTotal}
              </div>

              <div style={{ marginTop: 10 }}>
                <button className="btn danger" type="button" onClick={emptyCart}>
                  Empty Cart
                </button>
              </div>

              <button
                className="btn"
                type="button"
                style={{ marginTop: 12 }}
                onClick={() => setShowCheckout((v) => !v)}
              >
                {showCheckout ? "Hide Cart" : "Proceed to Payment"}
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
                      placeholder="Whatsapp Number"
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
                          alert("Enter Whatsapp number");
                          return;
                        }

                        localStorage.setItem("qclub_payment_context", "food");
                        localStorage.setItem("qclub_payment_name", customerName.trim());
                        localStorage.setItem("qclub_payment_mobile", customerPhone.trim());
                        localStorage.setItem(
                          "qclub_food_cart",
                          JSON.stringify(
                            cartItems
                              .map((id) => {
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
                              })
                              .filter(Boolean)
                          )
                        );
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
        onTouchStart={(e) => {
          touchStartX.current = e.changedTouches[0].screenX;
        }}
        onTouchEnd={(e) => {
          touchEndX.current = e.changedTouches[0].screenX;
          handleCategorySwipe();
        }}
        style={{
          display: "grid",
          gridTemplateColumns: window.innerWidth < 700
            ? "repeat(2, 1fr)"
            : "repeat(auto-fit, minmax(220px, 280px))",
          gap: 18
        }}
      >
        {items.map((item) => (
          <div key={item.id} className="card" style={{ padding: 14 }}>
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

            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 10,
                marginBottom: 4
              }}
            >
              <h3 style={{ margin: 0, fontSize: "1.05rem", lineHeight: 1.15 }}>{item.name}</h3>

              <div style={{ fontWeight: 800, fontSize: "1.05rem", whiteSpace: "nowrap" }}>
                ₹{item.price}
              </div>
            </div>

            <div
              className="muted"
              style={{
                marginBottom: 8,
                fontSize: "0.9rem",
                lineHeight: "1.2em",
                height: "2.4em",
                overflow: "hidden"
              }}
            >
              {item.description}
            </div>

            {admin ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button
                  className="btn secondary"
                  type="button"
                  onClick={() => {
                    const value = prompt("Edit item name:", item.name);
                    if (value !== null && value !== "") updateItem(item.id, "name", value);
                  }}
                >
                  Edit Name
                </button>

                <button
                  className="btn secondary"
                  type="button"
                  onClick={() => {
                    const value = prompt("Edit description:", item.description || "");
                    if (value !== null) updateItem(item.id, "description", value);
                  }}
                >
                  Edit Details
                </button>

                <button
                  className="btn secondary"
                  type="button"
                  onClick={() => {
                    const value = prompt("Edit price:", item.price);
                    if (value !== null && value !== "") updateItem(item.id, "price", value);
                  }}
                >
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

function normalizeWhatsappNumber(value) {
  const digits = String(value || "").replace(/\D/g, "");

  if (!digits) return "";
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;

  return digits;
}

function buildWhatsappDraft({ phone = "", text = "", label = "" }) {
  const normalizedPhone = normalizeWhatsappNumber(phone);
  const cleanText = String(text || "").trim();

  return {
    label: String(label || "").trim(),
    phone: normalizedPhone,
    text: cleanText,
    url:
      normalizedPhone && cleanText
        ? `https://wa.me/${normalizedPhone}?text=${encodeURIComponent(cleanText)}`
        : "",
  };
}
const WHATSAPP_OPT_OUTS_KEY = "qclub_whatsapp_opt_outs";
const WHATSAPP_MODE_KEY = "qclub_whatsapp_mode";
const WHATSAPP_SETTINGS_KEY = "qclub_whatsapp_settings";

function getWhatsappSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(WHATSAPP_SETTINGS_KEY) || "{}");
        return {
      provider: String(saved?.provider || "msg91").trim() || "msg91",
      authKey: String(saved?.authKey || "").trim(),
      senderNumber: String(saved?.senderNumber || "").trim(),
      senderLabel: String(saved?.senderLabel || "").trim(),
      membershipTemplate: String(saved?.membershipTemplate || "").trim(),
      tournamentTemplate: String(saved?.tournamentTemplate || "").trim(),
      foodTemplate: String(saved?.foodTemplate || "").trim(),
      bookingTemplate: String(saved?.bookingTemplate || "").trim(),
      otpTemplate: String(saved?.otpTemplate || "").trim(),
    };
  } catch {
        return {
      provider: "msg91",
      authKey: "",
      senderNumber: "",
      senderLabel: "",
      membershipTemplate: "",
      tournamentTemplate: "",
      foodTemplate: "",
      bookingTemplate: "",
      otpTemplate: "",
    };
  }
}

function saveWhatsappSettings(next) {
  const current = getWhatsappSettings();

    const merged = {
    provider: String(next?.provider ?? current.provider ?? "msg91").trim() || "msg91",
    authKey: String(next?.authKey ?? current.authKey ?? "").trim(),
    senderNumber: String(next?.senderNumber ?? current.senderNumber ?? "").trim(),
    senderLabel: String(next?.senderLabel ?? current.senderLabel ?? "").trim(),
    membershipTemplate: String(next?.membershipTemplate ?? current.membershipTemplate ?? "").trim(),
    tournamentTemplate: String(next?.tournamentTemplate ?? current.tournamentTemplate ?? "").trim(),
    foodTemplate: String(next?.foodTemplate ?? current.foodTemplate ?? "").trim(),
    bookingTemplate: String(next?.bookingTemplate ?? current.bookingTemplate ?? "").trim(),
    otpTemplate: String(next?.otpTemplate ?? current.otpTemplate ?? "").trim(),
  };

  localStorage.setItem(WHATSAPP_SETTINGS_KEY, JSON.stringify(merged));
  return merged;
}
function getWhatsappTemplateForLabel(label = "", settings = getWhatsappSettings()) {
  const cleanLabel = String(label || "").trim().toLowerCase();

  if (cleanLabel === "membership_success") {
    return settings.membershipTemplate || "";
  }

  if (cleanLabel === "tournament_success") {
    return settings.tournamentTemplate || "";
  }

  if (cleanLabel === "food_success") {
    return settings.foodTemplate || "";
  }

  if (cleanLabel === "booking_success") {
    return settings.bookingTemplate || "";
  }

  if (cleanLabel === "otp" || cleanLabel === "guest_otp" || cleanLabel === "otp_success") {
    return settings.otpTemplate || "";
  }

  return "";
}
function buildMsg91WhatsappPayload(draft, settings = getWhatsappSettings()) {
  const phone = normalizeWhatsappNumber(draft?.phone || "");
  const templateName = String(draft?.templateName || "").trim();
  const senderNumber = String(settings?.senderNumber || draft?.senderNumber || "").trim();
  const senderLabel = String(settings?.senderLabel || draft?.senderLabel || "").trim();

  return {
    integrated_number: senderNumber,
    content_type: "template",
    payload: {
      messaging_product: "whatsapp",
      type: "template",
      template: {
        name: templateName,
        language: {
          code: "en",
          policy: "deterministic",
        },
        components: [],
      },
    },
    recipient: {
      phone,
      name: senderLabel || "Q Club Customer",
    },
    meta: {
      label: String(draft?.label || "").trim(),
      textPreview: String(draft?.text || "").trim(),
      provider: "msg91",
    },
  };
}

function getWhatsappMode() {
  const saved = String(localStorage.getItem(WHATSAPP_MODE_KEY) || "draft_only").trim();

  if (saved === "disabled") return "disabled";
  return "draft_only";
}

function setWhatsappMode(mode) {
  const nextMode = mode === "disabled" ? "disabled" : "draft_only";
  localStorage.setItem(WHATSAPP_MODE_KEY, nextMode);
  return nextMode;
}

function getWhatsappOptOuts() {
  try {
    const raw = JSON.parse(localStorage.getItem(WHATSAPP_OPT_OUTS_KEY) || "[]");
    if (!Array.isArray(raw)) return [];
    return raw
      .map((x) => normalizeWhatsappNumber(x))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function saveWhatsappOptOuts(list) {
  const normalized = Array.isArray(list)
    ? Array.from(new Set(list.map((x) => normalizeWhatsappNumber(x)).filter(Boolean)))
    : [];

  localStorage.setItem(WHATSAPP_OPT_OUTS_KEY, JSON.stringify(normalized));
}

function isWhatsappOptedOut(phone) {
  const normalized = normalizeWhatsappNumber(phone);
  if (!normalized) return false;
  return getWhatsappOptOuts().includes(normalized);
}

function storeLatestWhatsappDraft(draft) {
  const phone = normalizeWhatsappNumber(draft?.phone || "");
  if (!phone) return false;
  if (isWhatsappOptedOut(phone)) return false;

  localStorage.setItem("qclub_last_whatsapp_draft", JSON.stringify(draft));
  return true;
}
function handleWhatsappNotification({
  label = "",
  phone = "",
  text = "",
  draft = null,
}) {
  const mode = getWhatsappMode();

  if (mode === "disabled") {
    return false;
  }

  const settings = getWhatsappSettings();

  const baseDraft =
    draft && typeof draft === "object"
      ? draft
      : buildWhatsappDraft({
          label,
          phone,
          text,
        });

  const resolvedLabel = String(baseDraft?.label || label || "").trim();
  const mappedTemplate = getWhatsappTemplateForLabel(resolvedLabel, settings);

  const finalDraft = {
    ...baseDraft,
    label: resolvedLabel,
    templateName: mappedTemplate,
    provider: settings.provider || "msg91",
    senderNumber: settings.senderNumber || "",
    senderLabel: settings.senderLabel || "",
    msg91Payload:
      (settings.provider || "msg91") === "msg91"
        ? buildMsg91WhatsappPayload(
            {
              ...baseDraft,
              label: resolvedLabel,
              templateName: mappedTemplate,
              senderNumber: settings.senderNumber || "",
              senderLabel: settings.senderLabel || "",
            },
            settings
          )
        : null,
  };

  if (mode === "draft_only") {
    return storeLatestWhatsappDraft(finalDraft);
  }

  return false;
}

function buildMembershipWhatsappText({
  name = "",
  tier = "",
  validUntil = "",
  activatedAt = "",
}) {
  const safeName = String(name || "").trim() || "Member";
  const safeTier = String(tier || "").trim() || "Membership";
  const safeValidUntil = String(validUntil || "").trim() || "—";
  const safeActivatedAt = formatWhatsappDateTime(activatedAt || new Date());

  return [
    `Hello ${safeName},`,
    `Your ${safeTier} membership at The Q Club has been activated successfully.`,
    `Date & Time: ${safeActivatedAt}`,
    `Valid until: ${safeValidUntil}`,
    `Thank you for joining The Q Club, Pasighat.`,
  ].join("\n");
}
function buildTournamentWhatsappText({
  name = "",
  tournamentName = "",
  fee = "",
  registeredAt = "",
}) {
  const safeName = String(name || "").trim() || "Player";
  const safeTournamentName = String(tournamentName || "").trim() || "Tournament";
  const safeFee = String(fee || "").trim() || "0";
  const safeRegisteredAt = formatWhatsappDateTime(registeredAt || new Date());

  return [
    `Hello ${safeName},`,
    `Thank you for registering for ${safeTournamentName}.`,
    `Date & Time: ${safeRegisteredAt}`,
    `Registration Fee: ₹${safeFee}`,
    `Tournament will begin as scheduled. Fixtures will be generated shortly after registration closes.`,
  ].join("\n");
}
function buildFoodWhatsappText({
  name = "",
  orderNo = "",
  total = "",
  items = [],
  itemCount = 0,
  orderedAt = "",
}) {
  const safeName = String(name || "").trim() || "Customer";
  const safeOrderNo = String(orderNo || "").trim() || "—";
  const safeTotal = String(total || "").trim() || "0";
  const safeOrderedAt = formatWhatsappDateTime(orderedAt || new Date());

  const itemLines = Array.isArray(items) && items.length
    ? items
        .map((item) => {
          const itemName = String(item?.name || "").trim();
          const qty = Number(item?.qty || 0);
          if (!itemName) return "";
          return `- ${itemName}${qty > 0 ? ` x ${qty}` : ""}`;
        })
        .filter(Boolean)
    : [];

  const lines = [
    `Hello ${safeName},`,
    `Your Q Lounge order has been placed successfully at The Q Club.`,
    `Order No: ${safeOrderNo}`,
    `Date & Time: ${safeOrderedAt}`,
  ];

  if (itemLines.length) {
    lines.push("Items:");
    lines.push(...itemLines);
  } else if (itemCount) {
    lines.push(`Items: ${itemCount}`);
  }

  lines.push(`Amount received: ₹${safeTotal}`);
  lines.push(`Thank you for your order.`);

  return lines.join("\n");
}
function buildBookingWhatsappText({
  name = "",
  table = "",
  bookingDate = "",
  bookingSlot = "",
  amount = "",
  bookedAt = "",
}) {
  const safeName = String(name || "").trim() || "Customer";
  const safeTable = String(table || "").trim();
  const safeBookingDate = String(bookingDate || "").trim();
  const safeBookingSlot = String(bookingSlot || "").trim();
  const safeAmount = String(amount || "").trim();
  const safeBookedAt = formatWhatsappDateTime(bookedAt || new Date());

  return [
    `Hello ${safeName},`,
    `Your booking request at The Q Club has been received successfully.`,
    `Date & Time: ${safeBookedAt}`,
    safeTable ? `Table / Game: ${safeTable}` : "",
    safeBookingDate ? `Booking Date: ${safeBookingDate}` : "",
    safeBookingSlot ? `Time Slot: ${safeBookingSlot}` : "",
    safeAmount ? `Amount received: ₹${safeAmount}` : "",
    `We look forward to seeing you at The Q Club.`,
  ]
    .filter(Boolean)
    .join("\n");
}
function BookTable({ data, admin, commit, startPayment }) {
  const [bookingType, setBookingType] = useState("nonmember");
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  
  const [itemId, setItemId] = useState(data.booking?.tables?.[0]?.id || "");
  const [bookingDate, setBookingDate] = useState(todayIso());
  const [timeSlot, setTimeSlot] = useState("");
  const [note, setNote] = useState("");
  const [submittedId, setSubmittedId] = useState("");

  const tables = data.booking?.tables || [];
  const today = todayIso();

const registryMembers = Array.isArray(data.memberRegistry)
  ? data.memberRegistry.filter((m) => {
      const statusOk = String(m.status || "").toLowerCase() === "active";
      const dateOk = !m.validUntil || String(m.validUntil) >= today;
      return statusOk && dateOk;
    })
  : [];

const membersPageEntries = Array.isArray(data.membersPage)
  ? data.membersPage.map((m) => ({
      id: `memberpage_${m.id}`,
      name: m.name || "",
      tier: m.tier || "",
      joinedOn: m.joinedOn || "",
      status: "active",
    }))
  : [];

const memberOptions = [...registryMembers, ...membersPageEntries].filter(
  (m, idx, arr) =>
    String(m.name || "").trim() &&
    arr.findIndex(
      (x) =>
        String(x.name || "").trim().toLowerCase() ===
        String(m.name || "").trim().toLowerCase()
    ) === idx
);
  const selectedTable = tables.find((t) => t.id === itemId) || tables[0] || null;

const blockedEntries = (data.booking?.blockedSlots || []).filter(
  (x) =>
    x &&
    x.itemId === selectedTable?.id &&
    x.bookingDate === bookingDate
);

const blockedSlotValues = blockedEntries.map((x) => x.timeSlot);
const slots = bookingTimeSlots(bookingDate, blockedSlotValues);

const amount = bookingAmountFor(
  selectedTable,
  bookingType === "member" ? "member" : "nonmember"
);

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
  if (bookingType === "non-member") {
  if (!name.trim()) {
    alert("Please enter name");
    return false;
  }
}

if (bookingType === "member") {
  if (!name.trim() || name === "Select member") {
    alert("Please select a member");
    return false;
  }
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
  if (bookingType === "member") {
  const selectedMember = memberOptions.find((m) => m.name === name.trim());

  if (!selectedMember) {
    alert("Please select an active member from the dropdown");
    return false;
  }
}
  const req = {
  id: uid(),
  name: name.trim(),
  mobile: mobile.trim(),
  memberId: bookingType === "member" ? name.trim() : "",
  bookingType: bookingType === "member" ? "member" : "nonmember",
  itemId: selectedTable.id,
  itemLabel: selectedTable.label,
  bookingDate,
  timeSlot,
  note: note.trim(),
  amount,
  status: "pending",
  createdAt: Date.now(),
};

  

  if (hasBookingConflict(data.booking?.requests || [], req)) {
    alert("This slot is already booked / pending for this table.");
    return false;
  }

  const bookingAnnouncement = {
  id: uid(),
  text: `${selectedTable.label} booked by ${name.trim()} for ${
    bookingDate === todayIso() ? "today" : bookingDate
  } at ${timeSlot}.`,
  link: "/book",
  createdAt: Date.now(),
};

commit({
  ...data,
  booking: {
    ...(data.booking || {}),
    tables,
    requests: [req, ...(data.booking?.requests || [])],
  },
  announcements: [
    bookingAnnouncement,
    ...(data.announcements || []),
  ].slice(0, 20),
});

  setSubmittedId(req.id);
  setName("");
  setMobile("");
  
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
function blockSelectedSlot() {
  if (!admin) return alert("Admin only");
  if (!selectedTable) return alert("Please select a table first.");
  if (!bookingDate) return alert("Please select a booking date first.");
  if (!timeSlot) return alert("Please select a time slot first.");

  const alreadyBlocked = (data.booking?.blockedSlots || []).some(
    (x) =>
      x.itemId === selectedTable.id &&
      x.bookingDate === bookingDate &&
      x.timeSlot === timeSlot
  );

  if (alreadyBlocked) {
    alert("This slot is already blocked.");
    return;
  }

  const reason =
    prompt(
      "Reason for blocking this slot?",
      "Blocked for tournament / reserve"
    ) || "Blocked for tournament / reserve";

  commit({
    ...data,
    booking: {
      ...(data.booking || {}),
      tables,
      requests: data.booking?.requests || [],
      blockedSlots: [
        {
          id: uid(),
          itemId: selectedTable.id,
          itemLabel: selectedTable.label,
          bookingDate,
          timeSlot,
          reason: reason.trim(),
          createdAt: Date.now(),
        },
        ...(data.booking?.blockedSlots || []),
      ],
    },
  });

  alert("Slot blocked successfully.");
}

function unblockSelectedSlot(slotValue = timeSlot) {
  if (!admin) return alert("Admin only");
  if (!selectedTable) return alert("Please select a table first.");
  if (!bookingDate) return alert("Please select a booking date first.");
  if (!slotValue) return alert("Please select a time slot first.");

  const exists = (data.booking?.blockedSlots || []).some(
    (x) =>
      x.itemId === selectedTable.id &&
      x.bookingDate === bookingDate &&
      x.timeSlot === slotValue
  );

  if (!exists) {
    alert("This slot is not blocked.");
    return;
  }

  commit({
    ...data,
    booking: {
      ...(data.booking || {}),
      tables,
      requests: data.booking?.requests || [],
      blockedSlots: (data.booking?.blockedSlots || []).filter(
        (x) =>
          !(
            x.itemId === selectedTable.id &&
            x.bookingDate === bookingDate &&
            x.timeSlot === slotValue
          )
      ),
    },
  });

  alert("Slot unblocked successfully.");
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

        <button
          className="btn warn"
          type="button"
          onClick={blockSelectedSlot}
        >
          Block Selected Slot
        </button>

        <button
          className="btn secondary"
          type="button"
          onClick={() => unblockSelectedSlot()}
        >
          Unblock Selected Slot
        </button>
      </>
    ) : null}
  </div>
)}

            <div className="row" style={{ marginBottom: 12 }}>
  <button
    className={`btn ${bookingType === "nonmember" ? "primary" : ""}`}
    onClick={() => {
      setBookingType("nonmember");
      setName("");
      setMobile("");
      setNote("");
    }}
    type="button"
  >
    Non-member
  </button>

  <button
    className={`btn ${bookingType === "member" ? "primary" : ""}`}
    onClick={() => {
      setBookingType("member");
      setName("");
      setMobile("");
      setNote("");
    }}
    type="button"
  >
    Member
  </button>
</div>

            <div className="grid">
              <div className="cols-6">
  <label className="lbl">{bookingType === "member" ? "Member Name" : "Name"}</label>

  {bookingType === "member" ? (
    <select
      value={name}
      onChange={(e) => setName(e.target.value)}
    >
      <option value="">Select member</option>
      {memberOptions.map((m) => (
        <option key={m.id} value={m.name}>
          {m.name}
        </option>
      ))}
    </select>
  ) : (
    <input
      value={name}
      onChange={(e) => setName(e.target.value)}
      placeholder="Enter name"
    />
  )}
</div>

              <div className="cols-6">
                <label className="lbl">Whatsapp Number</label>
                <input
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  placeholder="Enter mobile"
                />
              </div>

              

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
  {admin && selectedTable ? (
    <div
      style={{
        marginBottom: 12,
        padding: 12,
        border: "1px solid rgba(255,255,255,.10)",
        borderRadius: 14,
        background: "rgba(255,255,255,.03)",
      }}
    >
      <div style={{ fontWeight: 800, marginBottom: 6 }}>
        Blocked Slots for {selectedTable.label.split("₹")[0].trim()} on {bookingDate}
      </div>

      {blockedEntries.length === 0 ? (
        <div className="muted">No blocked slots for this date.</div>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {blockedEntries.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className="btn secondary"
              onClick={() => unblockSelectedSlot(entry.timeSlot)}
              title={entry.reason || "Blocked slot"}
            >
              {entry.timeSlot} ×
            </button>
          ))}
        </div>
      )}
    </div>
  ) : null}

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
  localStorage.setItem("qclub_booking_amount", String(amount || ""));
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
            <label className="lbl">Whatsapp Number</label>
            <input
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              placeholder="Enter Whatsapp number"
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
function TournamentRegister({ data, admin, commit, startPayment, activeTournament }) {
  const navigate = useNavigate();
  const location = useLocation();

  const [playerName, setPlayerName] = useState("");
  const [mobile, setMobile] = useState("");
  const [playerId, setPlayerId] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [adminSelectedPlayerName, setAdminSelectedPlayerName] = useState("");

  const players = data.players || [];
  const memberPagePlayers = (data.membersPage || []).map((m) => ({
    id: `memberpage_${m.id}`,
    name: m.name || "",
  }));

  const registryPlayers = (data.memberRegistry || []).map((m) => ({
    id: `registry_${m.id}`,
    name: m.name || "",
  }));

  const existingSelectablePlayers = [
    ...players.map((p) => ({ id: p.id, name: p.name || "" })),
    ...memberPagePlayers,
    ...registryPlayers,
  ].filter((p) => p.name.trim());

  const uniqueSelectablePlayers = existingSelectablePlayers.filter(
    (p, idx, arr) =>
      arr.findIndex(
        (x) => x.name.trim().toLowerCase() === p.name.trim().toLowerCase()
      ) === idx
  );

  const tournamentIdFromUrl = new URLSearchParams(location.search).get("id") || "";
  const currentTournament =
    (data.tournaments || []).find((t) => t.id === tournamentIdFromUrl) ||
    activeTournament ||
    null;

  const registeredNames = new Set(
    ((currentTournament?.participantIds || [])
      .map((id) => players.find((p) => p.id === id)?.name || "")
      .map((name) => String(name).trim().toLowerCase())
      .filter(Boolean))
  );

  const adminQuickAddOptions = uniqueSelectablePlayers
    .filter((p) => {
      const normalized = String(p.name || "").trim().toLowerCase();
      return normalized && !registeredNames.has(normalized);
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const registrationFee = safeNum(currentTournament?.registrationFee, 99);
  const registrationNote =
    currentTournament?.registrationNote ||
    "Tournament starts at 6:00 PM sharp. Fixtures will be generated shortly after registration closes.";

  const balancedFormatTitle =
    currentTournament?.balancedFormatTitle ||
    data.club?.balancedFormatTitle ||
    "Q Club Balanced Match Format";

  const balancedFormatSubtitle =
    currentTournament?.balancedFormatSubtitle ||
    data.club?.balancedFormatSubtitle ||
    "Structured for fair play, balanced competition, and a stronger tournament experience.";

  const balancedFormatDescription =
    currentTournament?.balancedFormatDescription ||
    data.club?.balancedFormatDescription ||
    "This tournament uses player classification and handicap points to create fairer and more competitive matches across different playing standards.";

  const registeredPlayers = (currentTournament?.participantIds || [])
    .map((id) => players.find((p) => p.id === id))
    .filter(Boolean);

  function addRegisteredPlayerManually() {
    if (!admin) return;

    if (!currentTournament) {
      alert("No tournament selected.");
      return;
    }

    const name = prompt("Enter player name:");
    if (!name) return;

    const mobile = prompt("Enter mobile number (optional):", "") || "";

    let nextPlayers = [...(data.players || [])];

    let existing = nextPlayers.find(
      (p) => String(p.name || "").trim().toLowerCase() === name.trim().toLowerCase()
    );

    let finalPlayerId = existing?.id || "";

    if (!finalPlayerId) {
      const newPlayer = {
        id: `pl_${Date.now()}`,
        name: name.trim(),
        mobile: mobile.trim(),
        city: "Pasighat",
        createdAt: Date.now(),
      };
      nextPlayers = [...nextPlayers, newPlayer];
      finalPlayerId = newPlayer.id;
    }

    const nextTournaments = (data.tournaments || []).map((t) => {
      if (t.id !== currentTournament.id) return t;

      const currentIds = Array.isArray(t.participantIds) ? t.participantIds : [];
      const nextIds = currentIds.includes(finalPlayerId)
        ? currentIds
        : [...currentIds, finalPlayerId];

      return {
        ...t,
        participantIds: nextIds,
      };
    });

    const manualTournamentAnnouncement = {
      id: uid(),
      text: `${name.trim()} registered for ${currentTournament.name || "the tournament"} ! Register now`,
      link: `/tournament-register?id=${currentTournament.id}`,
      createdAt: Date.now(),
    };

    commit({
      ...data,
      players: nextPlayers,
      tournaments: nextTournaments,
      announcements: [
        manualTournamentAnnouncement,
        ...(data.announcements || []),
      ].slice(0, 20),
    });
  }

  function beginRegistration() {
    if (!currentTournament) {
      alert("No active tournament found.");
      return;
    }

    if (!playerName.trim()) {
      alert("Please enter player name");
      return;
    }

    if (!mobile.trim()) {
      alert("Please enter mobile number");
      return;
    }

    localStorage.setItem("qclub_payment_context", "tournament");
    localStorage.setItem("qclub_payment_name", playerName.trim());
    localStorage.setItem("qclub_payment_mobile", mobile.trim());
    localStorage.setItem("qclub_tournament_id", currentTournament.id || "");
    localStorage.setItem("qclub_tournament_name", currentTournament.name || "");
    localStorage.setItem("qclub_tournament_fee", String(registrationFee));
    localStorage.setItem("qclub_tournament_player_id", playerId || "");

    startPayment(registrationFee, mobile.trim());
  }

  return (
    <>
      <PageShell
        title="Tournament Registration"
        subtitle={currentTournament ? currentTournament.name : "Current tournament"}
      />

      <div className="container">
        {!currentTournament ? (
          <div className="card">
            <div className="muted">No active tournament available right now.</div>
          </div>
        ) : (
          <div className="grid">
            <div className="card cols-7">
              <h2 style={{ marginTop: 0 }}>{currentTournament.name}</h2>

              <div
                className="row"
                style={{ marginTop: 8, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}
              >
                <div className="muted">Tournament Fee: ₹{registrationFee}</div>

                {admin ? (
                  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <button
                      className="btn"
                      type="button"
                      onClick={() => {
                        const nextFee = prompt(
                          "Enter registration fee",
                          String(registrationFee)
                        );
                        if (nextFee === null) return;

                        commit({
                          ...data,
                          tournaments: (data.tournaments || []).map((t) =>
                            t.id === currentTournament.id
                              ? {
                                  ...t,
                                  registrationFee: safeNum(nextFee, registrationFee),
                                }
                              : t
                          ),
                        });
                      }}
                    >
                      Edit Fee
                    </button>

                    <button
                      className="btn secondary"
                      type="button"
                      onClick={() => {
                        const nextTitle = prompt(
                          "Balanced format title:",
                          balancedFormatTitle
                        );
                        if (nextTitle === null) return;

                        const nextSubtitle = prompt(
                          "Balanced format subtitle:",
                          balancedFormatSubtitle
                        );
                        if (nextSubtitle === null) return;

                        const nextDescription = prompt(
                          "Balanced format description:",
                          balancedFormatDescription
                        );
                        if (nextDescription === null) return;

                        commit({
                          ...data,
                          tournaments: (data.tournaments || []).map((t) =>
                            t.id === currentTournament.id
                              ? {
                                  ...t,
                                  balancedFormatTitle:
                                    nextTitle.trim() || "Q Club Balanced Match Format",
                                  balancedFormatSubtitle:
                                    nextSubtitle.trim() ||
                                    "Structured for fair play, balanced competition, and a stronger tournament experience.",
                                  balancedFormatDescription:
                                    nextDescription.trim() ||
                                    "This tournament uses player classification and handicap points to create fairer and more competitive matches across different playing standards.",
                                }
                              : t
                          ),
                        });
                      }}
                    >
                      Edit Format
                    </button>
                  </div>
                ) : null}
              </div>

              <div
                className="row"
                style={{
                  marginTop: 8,
                  justifyContent: "space-between",
                  alignItems: "flex-start",
                  gap: 10,
                  flexWrap: "wrap",
                }}
              >
                <div
                  className="card"
                  style={{
                    marginTop: 14,
                    border: "1px solid rgba(255,255,255,.10)",
                    background:
                      "linear-gradient(180deg, rgba(255,255,255,.06), rgba(255,255,255,.03))",
                    boxShadow: "0 12px 30px rgba(0,0,0,.18)",
                  }}
                >
                  <div
                    style={{
                      fontSize: "0.82rem",
                      fontWeight: 800,
                      letterSpacing: ".08em",
                      textTransform: "uppercase",
                      color: "#f6c445",
                      marginBottom: 8,
                    }}
                  >
                    Tournament Format
                  </div>

                  <div
                    style={{
                      fontSize: "1.1rem",
                      fontWeight: 900,
                      color: "#eef3ff",
                      marginBottom: 6,
                    }}
                  >
                    {balancedFormatTitle}
                  </div>

                  <div
                    className="muted"
                    style={{
                      fontWeight: 700,
                      color: "rgba(234,240,255,.86)",
                      marginBottom: 10,
                      lineHeight: 1.45,
                    }}
                  >
                    {balancedFormatSubtitle}
                  </div>

                  <div
                    className="muted"
                    style={{
                      lineHeight: 1.55,
                      whiteSpace: "pre-line",
                    }}
                  >
                    {balancedFormatDescription}
                  </div>

                  <div
                    className="muted"
                    style={{
                      marginTop: 12,
                      whiteSpace: "pre-line",
                      lineHeight: 1.5,
                    }}
                  >
                    {registrationNote}
                  </div>

                  <div style={{ marginTop: 12 }}>
                    <Link className="btn secondary" to="/handicap">
                      View Handicap & Classification
                    </Link>
                  </div>
                </div>

                {admin ? (
                  <button
                    className="btn"
                    type="button"
                    onClick={() => {
                      const nextNote = prompt(
                        "Edit tournament description / timing note",
                        registrationNote
                      );
                      if (nextNote === null) return;

                      commit({
                        ...data,
                        tournaments: (data.tournaments || []).map((t) =>
                          t.id === currentTournament.id
                            ? {
                                ...t,
                                registrationNote: nextNote.trim(),
                              }
                            : t
                        ),
                      });
                    }}
                  >
                    Edit Details
                  </button>
                ) : null}
              </div>

              <div style={{ marginTop: 18 }}>
                <button
                  className="btn primary"
                  type="button"
                  onClick={() => setShowForm((v) => !v)}
                >
                  {showForm ? "Hide Registration Form" : "Register Now"}
                </button>
              </div>

              {showForm ? (
                <div className="grid" style={{ marginTop: 18 }}>
                  <div className="cols-6">
                    <label className="lbl">Select Existing Player (optional)</label>
                    <select
                      value={playerId}
                      onChange={(e) => {
                        const nextId = e.target.value;
                        setPlayerId(nextId);
                        const found = players.find((p) => p.id === nextId);
                        if (found) {
                          setPlayerName(found.name || "");
                        }
                      }}
                    >
                      <option value="">New / manual entry</option>
                      {uniqueSelectablePlayers.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="cols-6">
                    <label className="lbl">Player Name</label>
                    <input
                      value={playerName}
                      onChange={(e) => setPlayerName(e.target.value)}
                      placeholder="Enter player name"
                    />
                  </div>

                  <div className="cols-6">
                    <label className="lbl">Whatsapp Number</label>
                    <input
                      value={mobile}
                      onChange={(e) => setMobile(e.target.value)}
                      placeholder="Enter mobile number"
                    />
                  </div>

                  <div className="cols-12" style={{ marginTop: 8 }}>
                    <button
                      className="btn neonGreen"
                      type="button"
                      onClick={beginRegistration}
                    >
                      Pay ₹{registrationFee} and Register
                    </button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="card cols-5">
              <h2 style={{ marginTop: 0 }}>Current Tournament</h2>
              <div className="badge" style={{ marginTop: 8 }}>
                <span className="dot" />
                {currentTournament.month || "This Month"}
              </div>

              <div className="muted" style={{ marginTop: 14 }}>
                Game: {tournamentGameKey(currentTournament.game) === "pool" ? "Pool" : "Snooker"}
              </div>

              <div className="muted" style={{ marginTop: 10 }}>
                Registered Players: {(currentTournament.participantIds || []).length}
              </div>

              <div id="registered-players" style={{ marginTop: 14 }}>
                <div
                  style={{
                    fontWeight: 700,
                    marginBottom: 8,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 10,
                    flexWrap: "wrap",
                  }}
                >
                  <span>Registered Players</span>

                  {admin ? (
                    <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <select
                        value={adminSelectedPlayerName}
                        onChange={(e) => setAdminSelectedPlayerName(e.target.value)}
                        style={{ minWidth: 220 }}
                      >
                        <option value="">Select player / member to add</option>
                        {adminQuickAddOptions.map((p) => (
                          <option key={p.id} value={p.name}>
                            {p.name}
                          </option>
                        ))}
                      </select>

                      <button
                        className="btn"
                        type="button"
                        onClick={() => {
                          if (!adminSelectedPlayerName) {
                            alert("Please select a player or member first.");
                            return;
                          }

                          let nextPlayers = [...(data.players || [])];

                          let existing = nextPlayers.find(
                            (p) =>
                              String(p.name || "").trim().toLowerCase() ===
                              adminSelectedPlayerName.trim().toLowerCase()
                          );

                          let finalPlayerId = existing?.id || "";

                          if (!finalPlayerId) {
                            const source =
                              memberPagePlayers.find(
                                (m) =>
                                  String(m.name || "").trim().toLowerCase() ===
                                  adminSelectedPlayerName.trim().toLowerCase()
                              ) ||
                              registryPlayers.find(
                                (m) =>
                                  String(m.name || "").trim().toLowerCase() ===
                                  adminSelectedPlayerName.trim().toLowerCase()
                              );

                            const newPlayer = {
                              id: `pl_${Date.now()}`,
                              name: adminSelectedPlayerName.trim(),
                              mobile: "",
                              city: "Pasighat",
                              createdAt: Date.now(),
                              photo: "",
                              bio: "",
                              games: [tournamentGameKey(currentTournament?.game) || "snooker"],
                              group: "C",
                              yearsPlaying: "",
                              reviewStatus: "Stable",
                              reviewRecommendation: "No Change",
                              lastReviewDate: "",
                              committeeNotes: "",
                              sourceMemberId: source?.id || "",
                            };

                            nextPlayers = [...nextPlayers, newPlayer];
                            finalPlayerId = newPlayer.id;
                          }

                          const nextTournaments = (data.tournaments || []).map((t) => {
                            if (t.id !== currentTournament.id) return t;

                            const currentIds = Array.isArray(t.participantIds) ? t.participantIds : [];
                            const nextIds = currentIds.includes(finalPlayerId)
                              ? currentIds
                              : [...currentIds, finalPlayerId];

                            return {
                              ...t,
                              participantIds: nextIds,
                            };
                          });

                          commit({
                            ...data,
                            players: nextPlayers,
                            tournaments: nextTournaments,
                          });

                          setAdminSelectedPlayerName("");
                        }}
                      >
                        Add Selected
                      </button>

                      <button
                        className="btn secondary"
                        type="button"
                        onClick={addRegisteredPlayerManually}
                      >
                        + Walk-in
                      </button>
                    </div>
                  ) : null}
                </div>

                {registeredPlayers.length > 0 ? (
                  <div style={{ display: "grid", gap: 8 }}>
                    {registeredPlayers.map((p, idx) => (
                      <div
                        key={p.id || idx}
                        className="badge"
                        style={{ justifyContent: "flex-start", padding: "10px 12px" }}
                      >
                        <span className="dot" />
                        {p.name}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="muted">No registrations yet.</div>
                )}
              </div>

              <div style={{ marginTop: 18, display: "flex", gap: 10, flexWrap: "wrap" }}>
                {admin ? (
                  <button
                    className="btn primary"
                    type="button"
                    onClick={() =>
                      generateKnockoutForTournamentNow(data, commit, currentTournament.id)
                    }
                  >
                    Generate Knockout Now
                  </button>
                ) : null}

                <button className="btn" type="button" onClick={() => navigate("/")}>
                  Back Home
                </button>
              </div>
            </div>
          </div>
        )}
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

  const groupRaw = prompt("Group (A, B, or C):", "C");
  if (groupRaw === null) return;
  const group = ["A", "B", "C"].includes(String(groupRaw).trim().toUpperCase())
    ? String(groupRaw).trim().toUpperCase()
    : "C";

  const yearsPlaying = prompt("Years Playing:", "0");
  if (yearsPlaying === null) return;

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
        group,
        yearsPlaying: String(yearsPlaying).trim(),
        reviewStatus: "Stable",
reviewRecommendation: "No Change",
lastReviewDate: "",
committeeNotes: "",
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

  const groupRaw = prompt("Edit group (A, B, or C):", current.group || "C");
  if (groupRaw === null) return;
  const group = ["A", "B", "C"].includes(String(groupRaw).trim().toUpperCase())
    ? String(groupRaw).trim().toUpperCase()
    : "C";

  const yearsPlaying = prompt(
    "Edit years playing:",
    current.yearsPlaying !== undefined ? String(current.yearsPlaying) : ""
  );
  if (yearsPlaying === null) return;

  const reviewStatus = prompt(
    "Edit review status:",
    current.reviewStatus || "Stable"
  );
  if (reviewStatus === null) return;

  const lastReviewDate = prompt(
    "Edit last review date (YYYY-MM-DD):",
    current.lastReviewDate || ""
  );
  if (lastReviewDate === null) return;

  const committeeNotes = prompt(
    "Edit committee notes:",
    current.committeeNotes || ""
  );
  if (committeeNotes === null) return;

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
            group,
            yearsPlaying: String(yearsPlaying).trim(),
            reviewStatus: String(reviewStatus).trim() || "Stable",
            lastReviewDate: String(lastReviewDate).trim(),
            committeeNotes: String(committeeNotes).trim(),
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
  <th>Group</th>
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
<td>
  <span className="badge">
    <span className="dot" />
    {player.group || "C"}
  </span>
</td>
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
      <div className="grid" style={{ marginTop: 16 }}>
  <div className="card cols-6">
    <div className="infoLabel">Current Group</div>
    <div className="infoValue">{selectedPlayer.group || "C"}</div>
  </div>

  <div className="card cols-6">
    <div className="infoLabel">Years Playing</div>
    <div className="infoValue">{selectedPlayer.yearsPlaying || "—"}</div>
  </div>

  <div className="card cols-6">
    <div className="infoLabel">Review Status</div>
    <div className="infoValue">{selectedPlayer.reviewStatus || "Stable"}</div>
  </div>
  <div className="card cols-6">
  <div className="infoLabel">Recommendation</div>
  <div className="infoValue">{selectedPlayer.reviewRecommendation || "No Change"}</div>
</div>

  <div className="card cols-6">
    <div className="infoLabel">Last Review Date</div>
    <div className="infoValue">{selectedPlayer.lastReviewDate || "—"}</div>
  </div>

  <div className="card cols-12">
    <div className="infoLabel">Committee Notes</div>
    <div className="muted" style={{ marginTop: 6 }}>
      {selectedPlayer.committeeNotes || "No committee notes yet."}
    </div>
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

    const registrationNote = prompt(
      "Tournament description / timing note:",
      "Tournament starts at 6:00 PM sharp. Fixtures will be generated shortly after registration closes."
    );
    if (registrationNote === null) return;

    const balancedFormatTitle = prompt(
      "Tournament format title:",
      data.club?.balancedFormatTitle || "Q Club Balanced Match Format"
    );
    if (balancedFormatTitle === null) return;

    const balancedFormatSubtitle = prompt(
      "Tournament format subtitle:",
      data.club?.balancedFormatSubtitle ||
        "Structured for fair play, balanced competition, and a stronger tournament experience."
    );
    if (balancedFormatSubtitle === null) return;

    const balancedFormatDescription = prompt(
      "Tournament format description:",
      data.club?.balancedFormatDescription ||
        "This tournament uses player classification and handicap points to create fairer and more competitive matches across different playing standards."
    );
    if (balancedFormatDescription === null) return;

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
          registrationNote: registrationNote.trim(),
          balancedFormatTitle:
            balancedFormatTitle.trim() || "Q Club Balanced Match Format",
          balancedFormatSubtitle:
            balancedFormatSubtitle.trim() ||
            "Structured for fair play, balanced competition, and a stronger tournament experience.",
          balancedFormatDescription:
            balancedFormatDescription.trim() ||
            "This tournament uses player classification and handicap points to create fairer and more competitive matches across different playing standards.",
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

    const registrationNote = prompt(
      "Edit tournament description / timing note:",
      t.registrationNote ||
        "Tournament starts at 6:00 PM sharp. Fixtures will be generated shortly after registration closes."
    );
    if (registrationNote === null) return;

    commit({
      ...data,
      tournaments: tournaments.map((x) =>
        x.id === id
          ? {
              ...x,
              name: name.trim(),
              month: month.trim(),
              registrationNote: registrationNote.trim(),
            }
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
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>
                  <h2 style={{ marginBottom: 6 }}>{t.name}</h2>
                  <div className="badge">
                    <span className="dot" />
                    {t.month}
                  </div>
                </div>

                {admin ? (
                  <div className="row">
                    <button className="btn" onClick={() => editTournament(t.id)}>
                      Edit
                    </button>

                    <button className="btn danger" onClick={() => deleteTournament(t.id)}>
                      Delete
                    </button>
                  </div>
                ) : null}
              </div>

              <div className="muted" style={{ marginTop: 10 }}>
                Game: {tournamentGameKey(t.game) === "pool" ? "Pool" : "Snooker"}
              </div>

              <div
                className="muted"
                style={{
                  marginTop: 8,
                  whiteSpace: "pre-line",
                  lineHeight: 1.5,
                }}
              >
                {t.registrationNote ||
                  "Tournament starts at 6:00 PM sharp. Fixtures will be generated shortly after registration closes."}
              </div>

              <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Link className="btn primary" to={`/tournament-register?id=${t.id}`}>
                  Register Now
                </Link>

                <Link className="btn" to={`/tournament-register?id=${t.id}#registered-players`}>
                  Registered Players
                </Link>

                {admin ? (
                  <Link className="btn" to="/fixtures">
                    Manage Fixtures
                  </Link>
                ) : null}
              </div>
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
const params = new URLSearchParams(location.search);
const queryTournamentId = params.get("id") || "";
  const players = data.players || [];
   const [selectedTournamentId, setSelectedTournamentId] = useState(() => {
  if (queryTournamentId) return queryTournamentId;
  return tournaments[0]?.id || "";
});
useEffect(() => {
  if (!queryTournamentId) return;
  setSelectedTournamentId((prev) => prev || queryTournamentId);
}, [queryTournamentId]);

  useEffect(() => {
    if (!selectedTournamentId && tournaments[0]?.id) {
      setSelectedTournamentId(tournaments[0].id);
    }
  }, [selectedTournamentId, tournaments]);

  const selectedTournament =
  tournaments.find((t) => t.id === selectedTournamentId) || null;

const isKnockout = selectedTournament?.format === "knockout";
const isSnookerTournament =
  tournamentGameKey(selectedTournament?.game) === "snooker";

const eligiblePlayers = selectedTournament
    ? getEligiblePlayersForTournament(players, selectedTournament)
    : [];
    const tournamentPlayers = (selectedTournament?.participantIds || [])
  .map((id) => players.find((p) => p.id === id))
  .filter(Boolean);

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

    const pool = tournamentPlayers;
    if (pool.length < 2) {
      return alert("Need at least 2 players to generate fixtures.");
    }

    if (!confirm("Generate / regenerate fixtures for this tournament?")) return;

    const matches =
  format === "knockout"
    ? generateKnockout(pool.map((p) => p.id), players)
    : generateRoundRobin(pool.map((p) => p.id), players);

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
  const nextP1Group =
    String(next.p1).startsWith("WINNER_")
      ? ""
      : playerGroup(next.p1);

  const nextP2Group =
    String(next.p2).startsWith("WINNER_")
      ? ""
      : playerGroup(next.p2);

  const nextHandicap =
    isSnookerTournament &&
    next.p1 &&
    next.p2 &&
    !String(next.p1).startsWith("WINNER_") &&
    !String(next.p2).startsWith("WINNER_")
      ? handicapFromGroups(nextP1Group, nextP2Group, "snooker")
      : { handicap1: 0, handicap2: 0 };

  next.p1Group = nextP1Group;
  next.p2Group = nextP2Group;
  next.handicap1 = nextHandicap.handicap1;
  next.handicap2 = nextHandicap.handicap2;
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
  return tournamentPlayers.find((p) => p.id === id)?.name || "Unknown Player";
}
function playerGroup(id) {
  return tournamentPlayers.find((p) => p.id === id)?.group || "C";
}
function handicapLabel(m) {
  const h1 = Number(m.handicap1 || 0);
  const h2 = Number(m.handicap2 || 0);
  return `${h1} - ${h2}`;
}

 const standings = selectedTournament
  ? calcLeaderboard(tournamentPlayers, selectedTournament)
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
                  {tournamentPlayers.length === 0 ? (
  <div className="muted">No players registered yet.</div>
) : (
  tournamentPlayers.map((p) => {
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
  <th>Group</th>
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
<td>
  <span className="badge">
    <span className="dot" />
    {playerGroup(r.id)}
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
    Fixture will be generated after registration closes.
  </div>
) : (
                  <div style={{ marginTop: 12 }}>
                    <table>
                      <thead>
                        <tr>
  <th>Round</th>
  <th>Match</th>
  {isSnookerTournament ? <th>Groups</th> : null}
  {isSnookerTournament ? <th>Handicap</th> : null}
  <th>{isKnockout ? "Winner" : "Score 1"}</th>
  <th>{isKnockout ? "Result" : "Score 2"}</th>
  <th>Break 1</th>
  <th>Break 2</th>
  <th>Notes</th>
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
  <span className="badge" style={{ marginLeft: 8, marginRight: 8 }}>
    <span className="dot" />
    {playerGroup(m.p1)}
  </span>
  {" "}vs{" "}
  <span
    className="player-link"
    onClick={() => onOpenPlayer(m.p2)}
    style={{ textDecoration: "underline", cursor: "pointer" }}
  >
    {playerName(m.p2)}
  </span>
  <span className="badge" style={{ marginLeft: 8 }}>
    <span className="dot" />
    {playerGroup(m.p2)}
  </span>
</>
                            </td>
                            {isSnookerTournament ? (

                            <td>
  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
    <span className="badge">
      <span className="dot" />
      {m.p1Group || playerGroup(m.p1) || "C"}
    </span>
    <span className="badge">
      <span className="dot" />
      {m.p2Group || playerGroup(m.p2) || "C"}
    </span>
  </div>
</td>
                            ) : null}
                            {isSnookerTournament ? (

<td>
  <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
    <input
      type="text"
      inputMode="numeric"
      value={m.handicap1 ?? 0}
      onChange={(e) =>
        updateMatchField(
          m.id,
          "handicap1",
          e.target.value.replace(/[^0-9]/g, "")
        )
      }
      disabled={!admin}
      style={{ width: 60 }}
    />
    <span className="muted">-</span>
    <input
      type="text"
      inputMode="numeric"
      value={m.handicap2 ?? 0}
      onChange={(e) =>
        updateMatchField(
          m.id,
          "handicap2",
          e.target.value.replace(/[^0-9]/g, "")
        )
      }
      disabled={!admin}
      style={{ width: 60 }}
    />
  </div>
  <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>
    {handicapLabel(m)}
  </div>
</td>
                            ) : null}

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
  <input
    type="text"
    value={m.notes || ""}
    onChange={(e) => updateMatchField(m.id, "notes", e.target.value)}
    disabled={!admin}
    placeholder="Notes"
    style={{ width: 120 }}
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
  const tournamentPlayers = selectedTournament
    ? playersForTournament(selectedTournament, players)
    : [];

  const standings = selectedTournament
    ? calcLeaderboard(tournamentPlayers, selectedTournament)
    : [];

  const snookerBoard = useMemo(
    () => calcAutoRankingBoard(players, tournaments, "snooker"),
    [players, tournaments]
  );

  const poolBoard = useMemo(
    () => calcAutoRankingBoard(players, tournaments, "pool"),
    [players, tournaments]
  );
  function playerGroup(id) {
  return players.find((p) => p.id === id)?.group || "C";
}

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
  <th>Group</th>
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
<td>
  <span className="badge">
    <span className="dot" />
    {playerGroup(r.id)}
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
  <th>Group</th>
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
<td>
  <span className="badge">
    <span className="dot" />
    {playerGroup(r.id)}
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
  <th>Group</th>
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
<td>
  <span className="badge">
    <span className="dot" />
    {playerGroup(r.id)}
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


function TVMode({ data, activeTournament, players, admin, staffAdmin, commit }) {
  const [selectedTvTournamentId, setSelectedTvTournamentId] = useState(
  activeTournament?.id || data.tournaments?.[0]?.id || ""
);

const tvTournament =
  (data.tournaments || []).find((t) => t.id === selectedTvTournamentId) ||
  activeTournament ||
  null;

const tvMatches = tvTournament?.matches || [];
const matches = tvMatches;
const isSnooker = tournamentGameKey(tvTournament?.game) === "snooker";

const [tvMode, setTvMode] = useState("showcase"); // showcase | fixtures | auto
const [slideIndex, setSlideIndex] = useState(0);
const [fixturePage, setFixturePage] = useState(0);
const [autoPhase, setAutoPhase] = useState("showcase"); // showcase | fixtures
const [showFixtureBanner, setShowFixtureBanner] = useState(false);
const tvSlideFileInputRef = useRef(null);

const [fixtureRevealStage, setFixtureRevealStage] = useState("idle");
// idle | closed | generating | locked | ready | done
const [hasPlayedFixtureReveal, setHasPlayedFixtureReveal] = useState(false);
const [revealedPairCount, setRevealedPairCount] = useState(0);

const leaderboard = tvTournament
  ? calcLeaderboard(playersForTournament(tvTournament, data.players || []), tvTournament)
  : [];

const tournamentPlayersForTv = tvTournament
  ? playersForTournament(tvTournament, data.players || [])
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

function scoreText(m) {
  const s1 = m?.score1 === "" || m?.score1 == null ? "-" : m.score1;
  const s2 = m?.score2 === "" || m?.score2 == null ? "-" : m.score2;
  return `${s1} : ${s2}`;
}

function chunkItems(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const fixturePages = chunkItems(nextMatches.length ? nextMatches : doneMatches, 4);
const currentFixturePage = fixturePages[fixturePage] || [];

const highestBreakPlayer = isSnooker
  ? (players || []).slice().sort((a, b) => (b.bestBreak || 0) - (a.bestBreak || 0))[0]
  : null;

useEffect(() => {
  setFixturePage(0);
  setFixtureRevealStage("idle");
  setHasPlayedFixtureReveal(false);
  setShowFixtureBanner(false);
  setRevealedPairCount(0);
}, [selectedTvTournamentId]);

useEffect(() => {
  if (!showFixtureBanner) return;
  const t = setTimeout(() => setShowFixtureBanner(false), 4500);
  return () => clearTimeout(t);
}, [showFixtureBanner]);

useEffect(() => {
  const slidesExist = true;
  if (!slidesExist) return;

  const t = setInterval(() => {
    setSlideIndex((prev) => prev + 1);
  }, 7000);

  return () => clearInterval(t);
}, []);

useEffect(() => {
  if (fixturePages.length <= 1) return;

  const shouldRotateFixtures =
    tvMode === "fixtures" || (tvMode === "auto" && autoPhase === "fixtures");

  if (!shouldRotateFixtures) return;

  const t = setInterval(() => {
    setFixturePage((prev) => (prev + 1) % fixturePages.length);
  }, 10000);

  return () => clearInterval(t);
}, [fixturePages.length, tvMode, autoPhase]);

useEffect(() => {
  if (tvMode !== "auto") return;

  setAutoPhase("showcase");

  const t = setInterval(() => {
    setAutoPhase((prev) => {
      if (prev === "showcase") {
        return matches.length ? "fixtures" : "showcase";
      }
      return "showcase";
    });
  }, 15000);

  return () => clearInterval(t);
}, [tvMode, matches.length]);

useEffect(() => {
  let t;

  if (fixtureRevealStage === "closed") {
    t = setTimeout(() => setFixtureRevealStage("generating"), 700);
  } else if (fixtureRevealStage === "generating") {
    t = setTimeout(() => setFixtureRevealStage("locked"), 1100);
  } else if (fixtureRevealStage === "locked") {
    t = setTimeout(() => setFixtureRevealStage("ready"), 1200);
  } else if (fixtureRevealStage === "ready") {
    t = setTimeout(() => {
      setFixtureRevealStage("done");
      setHasPlayedFixtureReveal(true);
      setTvMode("fixtures");
    }, 1200);
  }

  return () => {
    if (t) clearTimeout(t);
  };
}, [fixtureRevealStage]);

useEffect(() => {
  if (fixtureRevealStage !== "locked" && fixtureRevealStage !== "ready") return;

  const maxPairs = Math.min(8, matches.length);
  if (maxPairs <= 0) return;

  setRevealedPairCount(1);

  const t = setInterval(() => {
    setRevealedPairCount((prev) => {
      if (prev >= maxPairs) {
        clearInterval(t);
        return prev;
      }
      return prev + 1;
    });
  }, 450);

  return () => clearInterval(t);
}, [fixtureRevealStage, matches.length]);

function triggerFixtureReveal() {
  setFixturePage(0);
  setShowFixtureBanner(false);
  setHasPlayedFixtureReveal(false);
  setRevealedPairCount(0);
  setTvMode("showcase");
  setFixtureRevealStage("idle");

  setTimeout(() => {
    setShowFixtureBanner(true);
    setFixtureRevealStage("closed");
  }, 40);
}

  const heroSlides = (data.club?.heroSlides || []).filter(Boolean).map((url, idx) => ({
    id: `hero_${idx}`,
    kind: "image",
    title: idx === 0 ? "Welcome to The Q Club" : "Premium Gaming Lounge",
    subtitle:
      idx === 0
        ? "Snooker • Pool • Air Hockey • Foosball • Tea • Coffee • Lounge"
        : "The coolest place in the oldest town.",
    image: url,
  }));

  const gallerySlides = (data.photos || [])
    .map((p, idx) => ({
      id: p.id || `gallery_${idx}`,
      kind: "image",
      title: p.title || "Club Gallery",
      subtitle: p.caption || "Moments from The Q Club",
      image: p.url || p.dataUrl || "",
    }))
    .filter((x) => x.image)
    .slice(0, 8);

  const memberSlides = (players || [])
    .filter((p) => p.photo)
    .map((p) => ({
      id: `player_${p.id}`,
      kind: "image",
      title: p.name || "Member Spotlight",
      subtitle: p.city ? `${p.city} • Q Club Player` : "Q Club Player",
      image: p.photo,
    }))
    .slice(0, 8);

  const hallOfFameSlides = (data.hallOfFame || [])
    .filter((h) => h.photo)
    .map((h) => ({
      id: `hof_${h.id}`,
      kind: "image",
      title: h.title || h.name || "Hall of Fame",
      subtitle: h.note || h.category || "Club Highlight",
      image: h.photo,
    }))
    .slice(0, 6);

  const textSlides = [
    {
      id: "amenities",
      kind: "text",
      title: "Club Amenities",
      subtitle:
        "2 Full-size 12x6 Snooker Tables • Mini Snooker • American Pool • Air Hockey • Foosball • Massage Chair",
    },
    {
      id: "beverages",
      kind: "text",
      title: "Food & Beverage",
      subtitle: "Tea • Coffee • Mocktails • Momos • Sausages • Chicken • More at The Q Club",
    },
    {
      id: "memberships",
      kind: "text",
      title: "Membership Open",
      subtitle: "Join Bronze • Silver • Gold • Platinum for member perks and special rates",
    },
    {
      id: "booking",
      kind: "text",
      title: "Book Your Table",
      subtitle: "Scan and book at theqclubpasighat.com",
    },
    {
      id: "tournament",
      kind: "text",
      title: tvTournament ? tournamentDisplay(tvTournament) : "Monthly Club Tournaments",
      subtitle: tvTournament?.registrationNote || "Skill-based club tournaments, fixtures, rankings, and more.",
    },
  ];

  const customSlides = (data.club?.tvCustomSlides || []).map((s, idx) => ({
    id: s.id || `custom_${idx}`,
    kind: s.kind || "text",
    title: s.title || "Showcase Slide",
    subtitle: s.subtitle || "",
    image: s.image || "",
    isCustom: true,
  }));

  const editableSlides = [...textSlides, ...customSlides];
  const tvShowcaseMode = data.club?.tvShowcaseMode === "custom_only" ? "custom_only" : "mixed";

  const showcaseSlides =
    tvShowcaseMode === "custom_only"
      ? customSlides.length
        ? customSlides
        : [
            {
              id: "custom_only_empty",
              kind: "text",
              title: "No Custom TV Slides Yet",
              subtitle: "Add or upload custom slides to use Custom Slides Only mode.",
            },
          ]
      : [...heroSlides, ...editableSlides, ...memberSlides, ...gallerySlides, ...hallOfFameSlides];

  const safeSlides = showcaseSlides.length
    ? showcaseSlides
    : [
        {
          id: "fallback",
          kind: "text",
          title: "Welcome to The Q Club",
          subtitle: "Premium gaming lounge • Snooker • Pool • Air Hockey • Lounge",
        },
      ];

  const activeSlide = safeSlides[slideIndex % safeSlides.length];
  const canEditTvSlides = admin || staffAdmin;

  function setTvShowcaseMode(nextMode) {
    if (!canEditTvSlides) return;

    commit({
      ...data,
      club: {
        ...(data.club || {}),
        tvCustomSlides: data.club?.tvCustomSlides || [],
        tvShowcaseMode: nextMode === "custom_only" ? "custom_only" : "mixed",
      },
    });
  }

  function triggerTvSlideImagePicker() {
    if (!canEditTvSlides) return;
    if (!tvSlideFileInputRef.current) return;
    tvSlideFileInputRef.current.value = "";
    tvSlideFileInputRef.current.click();
  }

  function handleTvSlideImageFileChange(e) {
    if (!canEditTvSlides) return;

    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || "");
      if (!dataUrl) return;

      const title = prompt("Slide title:", "The Q Club Showcase");
      if (title === null) return;

      const subtitle = prompt("Slide subtitle:", "Premium gaming lounge in Pasighat.");
      if (subtitle === null) return;

      commit({
        ...data,
        club: {
          ...(data.club || {}),
          tvCustomSlides: [
            ...(data.club?.tvCustomSlides || []),
            {
              id: uid(),
              kind: "image",
              title: title.trim(),
              subtitle: subtitle.trim(),
              image: dataUrl,
            },
          ],
        },
      });
    };

    reader.readAsDataURL(file);
  }

  function moveCurrentTvSlide(direction) {
    if (!canEditTvSlides) return;
    if (!activeSlide?.isCustom) {
      alert("Only custom TV slides can be reordered.");
      return;
    }

    const slides = [...(data.club?.tvCustomSlides || [])];
    const idx = slides.findIndex((s) => s.id === activeSlide.id);
    if (idx === -1) return;

    const targetIdx = direction === "up" ? idx - 1 : idx + 1;
    if (targetIdx < 0 || targetIdx >= slides.length) return;

    const temp = slides[idx];
    slides[idx] = slides[targetIdx];
    slides[targetIdx] = temp;

    commit({
      ...data,
      club: {
        ...(data.club || {}),
        tvCustomSlides: slides,
      },
    });
  }

  function addCustomTvSlide() {
    if (!canEditTvSlides) return;

    const title = prompt("Slide title:", "Welcome to The Q Club");
    if (title === null) return;

    const subtitle = prompt("Slide subtitle:", "Premium gaming lounge in Pasighat.");
    if (subtitle === null) return;

    const image = prompt("Optional image URL / data URL:", "");
    if (image === null) return;

    commit({
      ...data,
      club: {
        ...(data.club || {}),
        tvCustomSlides: [
          ...(data.club?.tvCustomSlides || []),
          {
            id: uid(),
            kind: image.trim() ? "image" : "text",
            title: title.trim(),
            subtitle: subtitle.trim(),
            image: image.trim(),
          },
        ],
      },
    });
  }

  function editCurrentTvSlide() {
    if (!canEditTvSlides) return;
    if (!activeSlide?.isCustom) {
      alert("Only custom TV slides are editable. Built-in slides are automatic.");
      return;
    }

    const current = (data.club?.tvCustomSlides || []).find((s) => s.id === activeSlide.id);
    if (!current) return;

    const title = prompt("Edit slide title:", current.title || "");
    if (title === null) return;

    const subtitle = prompt("Edit slide subtitle:", current.subtitle || "");
    if (subtitle === null) return;

    const image = prompt("Edit image URL / data URL:", current.image || "");
    if (image === null) return;

    commit({
      ...data,
      club: {
        ...(data.club || {}),
        tvCustomSlides: (data.club?.tvCustomSlides || []).map((s) =>
          s.id === current.id
            ? {
                ...s,
                title: title.trim(),
                subtitle: subtitle.trim(),
                image: image.trim(),
                kind: image.trim() ? "image" : "text",
              }
            : s
        ),
      },
    });
  }

  function deleteCurrentTvSlide() {
    if (!canEditTvSlides) return;
    if (!activeSlide?.isCustom) {
      alert("Only custom TV slides can be deleted.");
      return;
    }
    if (!confirm("Delete this custom TV slide?")) return;

    commit({
      ...data,
      club: {
        ...(data.club || {}),
        tvCustomSlides: (data.club?.tvCustomSlides || []).filter(
          (s) => s.id !== activeSlide.id
        ),
      },
    });
  }

  const showFixtureView =
    tvMode === "fixtures" || (tvMode === "auto" && autoPhase === "fixtures");

  function renderSlide(slide) {
    const bgImage = slide?.image || "";

    return (
      <div
        style={{
          position: "relative",
          minHeight: "64vh",
          borderRadius: 24,
          overflow: "hidden",
          background: bgImage
            ? `linear-gradient(180deg, rgba(4,8,18,.20), rgba(4,8,18,.80)), url(${bgImage}) center/cover no-repeat`
            : "linear-gradient(135deg, rgba(8,12,24,.98), rgba(18,31,58,.98))",
          border: "1px solid rgba(255,255,255,.08)",
          boxShadow: "0 20px 60px rgba(0,0,0,.35)",
          display: "flex",
          alignItems: "flex-end",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(180deg, rgba(0,0,0,.08) 0%, rgba(0,0,0,.30) 45%, rgba(0,0,0,.78) 100%)",
          }}
        />

        <div
          style={{
            position: "relative",
            zIndex: 1,
            width: "100%",
            padding: "28px",
            display: "grid",
            gap: 12,
          }}
        >
          <div
            style={{
              display: "inline-flex",
              width: "fit-content",
              alignItems: "center",
              gap: 8,
              padding: "8px 14px",
              borderRadius: 999,
              background: "rgba(255,255,255,.10)",
              border: "1px solid rgba(255,255,255,.14)",
              fontWeight: 800,
              fontSize: 14,
            }}
          >
            <span className="dot" />
            Showcase Mode
          </div>

          <div
            style={{
              fontSize: "clamp(34px, 5vw, 68px)",
              fontWeight: 900,
              lineHeight: 1.02,
              maxWidth: 980,
              textShadow: "0 4px 24px rgba(0,0,0,.35)",
            }}
          >
            {slide?.title}
          </div>

          <div
            style={{
              fontSize: "clamp(16px, 2vw, 28px)",
              lineHeight: 1.35,
              color: "rgba(255,255,255,.88)",
              maxWidth: 960,
            }}
          >
            {slide?.subtitle}
          </div>

          <div
            style={{
              display: "flex",
              gap: 8,
              flexWrap: "wrap",
              marginTop: 8,
            }}
          >
            {safeSlides.slice(0, Math.min(safeSlides.length, 10)).map((s, idx) => (
              <span
                key={s.id}
                style={{
                  width: idx === (slideIndex % safeSlides.length) ? 28 : 10,
                  height: 10,
                  borderRadius: 999,
                  background:
                    idx === (slideIndex % safeSlides.length)
                      ? "rgba(255,255,255,.95)"
                      : "rgba(255,255,255,.30)",
                  transition: "all .25s ease",
                }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  function renderFixtureCard(m) {
    const p1 = playerById(m.p1);
    const p2 = playerById(m.p2);

    return (
      <div
        key={m.id}
        style={{
          borderRadius: 22,
          padding: 20,
          background: "linear-gradient(180deg, rgba(14,22,38,.96), rgba(8,12,22,.96))",
          border: "1px solid rgba(255,255,255,.08)",
          boxShadow: "0 12px 34px rgba(0,0,0,.22)",
        }}
      >
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 16, gap: 8 }}>
          <span className="badge">
            <span className="dot" />
            Round {m.round || 1}
          </span>
          <span className="badge">
            <span className={m.status === "live" ? "dot warn" : "dot"} />
            {m.status === "done" ? "Completed" : m.status === "live" ? "Live" : "Upcoming"}
          </span>
        </div>

        <div style={{ display: "grid", gap: 16 }}>
          {[
            { p: p1, name: playerName(m.p1), score: m?.score1 === "" || m?.score1 == null ? "-" : m.score1 },
            { p: p2, name: playerName(m.p2), score: m?.score2 === "" || m?.score2 == null ? "-" : m.score2 },
          ].map((row, idx) => (
            <div
              key={idx}
              style={{
                display: "grid",
                gridTemplateColumns: "72px 1fr auto",
                gap: 14,
                alignItems: "center",
              }}
            >
              {row.p?.photo ? (
                <img
                  src={row.p.photo}
                  alt={row.name}
                  style={{
                    width: 72,
                    height: 72,
                    objectFit: "cover",
                    borderRadius: 16,
                    border: "1px solid rgba(255,255,255,.12)",
                  }}
                />
              ) : (
                <div
                  style={{
                    width: 72,
                    height: 72,
                    borderRadius: 16,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: 900,
                    fontSize: 30,
                    background: "rgba(255,255,255,.08)",
                    border: "1px solid rgba(255,255,255,.12)",
                  }}
                >
                  {String(row.name || "?").slice(0, 1).toUpperCase()}
                </div>
              )}

              <div
                style={{
                  fontSize: "clamp(18px, 2vw, 28px)",
                  fontWeight: 800,
                  lineHeight: 1.1,
                  minWidth: 0,
                }}
              >
                {row.name}
              </div>

              <div
                style={{
                  minWidth: 54,
                  textAlign: "center",
                  fontSize: "clamp(22px, 3vw, 40px)",
                  fontWeight: 900,
                }}
              >
                {row.score}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderFixtureView() {
    const focusMatch = nextMatches[0] || doneMatches[0] || null;

    return (
      <div style={{ display: "grid", gap: 18 }}>
        <div
          style={{
            borderRadius: 24,
            padding: 24,
            background: "linear-gradient(135deg, rgba(7,13,24,.98), rgba(15,28,52,.98))",
            border: "1px solid rgba(255,255,255,.08)",
            boxShadow: "0 20px 60px rgba(0,0,0,.28)",
          }}
        >
          <div className="row" style={{ justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 13, opacity: 0.8, marginBottom: 6 }}>
                Fixture Broadcast
              </div>
              <div style={{ fontSize: "clamp(26px, 4vw, 48px)", fontWeight: 900, lineHeight: 1.05 }}>
                {tvTournament ? tournamentDisplay(tvTournament) : "No Selected Tournament"}
              </div>
              <div className="muted" style={{ marginTop: 8, fontSize: 16 }}>
                {focusMatch
                  ? `Showing ${nextMatches.length ? "upcoming/live" : "completed"} fixtures`
                  : "No fixtures available yet"}
              </div>
            </div>

            <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
              <span className="badge">
                <span className="dot" />
                Total: {matches.length}
              </span>
              <span className="badge">
                <span className="dot warn" />
                Pending: {nextMatches.length}
              </span>
              <span className="badge">
                <span className="dot" />
                Done: {doneMatches.length}
              </span>
              {fixturePages.length > 1 ? (
                <span className="badge">
                  <span className="dot" />
                  Page {fixturePage + 1} / {fixturePages.length}
                </span>
              ) : null}
            </div>
          </div>
        </div>

        {focusMatch ? (
          <div
            style={{
              borderRadius: 24,
              padding: 22,
              background: "linear-gradient(180deg, rgba(12,19,34,.96), rgba(8,12,22,.96))",
              border: "1px solid rgba(255,255,255,.08)",
            }}
          >
            <div style={{ fontSize: 14, opacity: 0.82, marginBottom: 10 }}>
              {focusMatch.status === "live" ? "Now Playing" : "Next Featured Match"}
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto 1fr",
                alignItems: "center",
                gap: 12,
              }}
            >
              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "clamp(24px, 3vw, 44px)", fontWeight: 900 }}>
                  {playerName(focusMatch.p1)}
                </div>
              </div>

              <div style={{ fontSize: "clamp(28px, 4vw, 56px)", fontWeight: 900 }}>
                {scoreText(focusMatch)}
              </div>

              <div style={{ textAlign: "center" }}>
                <div style={{ fontSize: "clamp(24px, 3vw, 44px)", fontWeight: 900 }}>
                  {playerName(focusMatch.p2)}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="card">
            <div className="muted">Fixtures will appear here once generated.</div>
          </div>
        )}

        {currentFixturePage.length ? (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: 16,
            }}
          >
            {currentFixturePage.map(renderFixtureCard)}
          </div>
        ) : null}

        {leaderboard.length ? (
          <div
            style={{
              borderRadius: 22,
              padding: 18,
              background: "rgba(255,255,255,.04)",
              border: "1px solid rgba(255,255,255,.08)",
            }}
          >
            <div style={{ fontWeight: 800, marginBottom: 12 }}>Top Players</div>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 12,
              }}
            >
              {leaderboard.slice(0, 4).map((row, idx) => (
                <div
                  key={row.id}
                  style={{
                    borderRadius: 16,
                    padding: 14,
                    background: "rgba(255,255,255,.04)",
                    border: "1px solid rgba(255,255,255,.06)",
                  }}
                >
                  <div style={{ fontSize: 12, opacity: 0.75, marginBottom: 4 }}>#{idx + 1}</div>
                  <div style={{ fontWeight: 800, fontSize: 18 }}>{row.name}</div>
                  <div className="muted" style={{ marginTop: 4 }}>
                    {row.points} pts • {row.wins} wins
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    );
  }

  function renderFixtureReveal() {
  if (fixtureRevealStage === "idle" || fixtureRevealStage === "done") return null;

  const revealMatches = matches.slice(0, 8);
  const revealPlayers = tournamentPlayersForTv.slice(0, 16);
  const visiblePairs = revealMatches.slice(0, revealedPairCount || 0);

  const stageMeta = {
    closed: {
      kicker: "Registration Locked",
      title: "Tournament Entry Closed",
      subtitle:
        tvTournament?.registrationNote ||
        "All registered players are now being prepared for the official draw.",
      glow: "rgba(255, 186, 64, 0.28)",
      accent: "#ffcc66",
    },
    generating: {
      kicker: "Live Draw Engine",
      title: "Names Entering The Draw Bucket",
      subtitle:
        "Registered participants are flying into the draw, mixing rapidly, and forming the opening bracket.",
      glow: "rgba(0, 200, 255, 0.26)",
      accent: "#7ee7ff",
    },
    locked: {
      kicker: "Bracket Lock",
      title: "Round One Pairings Emerging",
      subtitle:
        "The shuffle is complete. Opening round pairings are now being revealed one by one.",
      glow: "rgba(110, 150, 255, 0.26)",
      accent: "#9ec0ff",
    },
    ready: {
      kicker: "Broadcast Ready",
      title: "Opening Round Confirmed",
      subtitle:
        "The opening draw is complete and ready for fixture broadcast.",
      glow: "rgba(56, 211, 159, 0.28)",
      accent: "#7fffd4",
    },
  };

  const meta = stageMeta[fixtureRevealStage] || stageMeta.closed;
  const isPairStage =
    fixtureRevealStage === "locked" || fixtureRevealStage === "ready";

  return (
    <div
      style={{
        position: "relative",
        minHeight: "72vh",
        borderRadius: 30,
        overflow: "hidden",
        background:
          "radial-gradient(circle at 50% 0%, rgba(34,70,130,.94), rgba(7,11,22,.98) 42%, rgba(3,7,15,1) 100%)",
        border: "1px solid rgba(255,255,255,.08)",
        boxShadow: "0 30px 90px rgba(0,0,0,.44)",
        padding: 30,
      }}
    >
      <style>{`
        @keyframes qclubGlowPulse {
          0%, 100% { opacity: .72; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.04); }
        }

        @keyframes qclubSweep {
          0% { transform: translateX(-22%) skewX(-18deg); opacity: .08; }
          50% { opacity: .58; }
          100% { transform: translateX(122%) skewX(-18deg); opacity: .08; }
        }

        @keyframes qclubChipLeft {
          0% { transform: translateX(-90px) translateY(-18px) scale(.90); opacity: 0; }
          65% { opacity: 1; }
          100% { transform: translateX(0) translateY(0) scale(1); opacity: 1; }
        }

        @keyframes qclubChipRight {
          0% { transform: translateX(90px) translateY(-18px) scale(.90); opacity: 0; }
          65% { opacity: 1; }
          100% { transform: translateX(0) translateY(0) scale(1); opacity: 1; }
        }

        @keyframes qclubChipFadeAway {
          0% { opacity: 1; transform: scale(1); }
          100% { opacity: .18; transform: scale(.94); }
        }

        @keyframes qclubBucketHum {
          0%, 100% {
            box-shadow:
              0 0 0 rgba(255,255,255,0),
              0 20px 55px rgba(0,0,0,.34);
            transform: translateY(0);
          }
          50% {
            box-shadow:
              0 0 30px rgba(130,210,255,.10),
              0 28px 70px rgba(0,0,0,.42);
            transform: translateY(-2px);
          }
        }

        @keyframes qclubPairCardIn {
          0% { transform: translateY(34px) scale(.94); opacity: 0; }
          100% { transform: translateY(0) scale(1); opacity: 1; }
        }

        @keyframes qclubCenterFlash {
          0%, 100% { opacity: .18; }
          50% { opacity: .46; }
        }
      `}</style>

      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(circle at 50% 34%, ${meta.glow}, transparent 42%)`,
          pointerEvents: "none",
        }}
      />

      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "linear-gradient(180deg, rgba(255,255,255,.03), transparent 20%, transparent 78%, rgba(255,255,255,.03))",
          pointerEvents: "none",
        }}
      />

      {(fixtureRevealStage === "generating" || fixtureRevealStage === "locked") &&
        [0, 1, 2, 3].map((line) => (
          <div
            key={line}
            style={{
              position: "absolute",
              left: "-24%",
              top: `${17 + line * 18}%`,
              width: "48%",
              height: 14,
              borderRadius: 999,
              background:
                "linear-gradient(90deg, transparent, rgba(255,255,255,.08), rgba(0,191,255,.22), rgba(255,255,255,.08), transparent)",
              filter: "blur(1px)",
              animationName: "qclubSweep",
              animationDuration: "1.05s",
              animationTimingFunction: "linear",
              animationIterationCount: "infinite",
              animationDelay: `${line * 0.16}s`,
            }}
          />
        ))}

      <div
        style={{
          position: "relative",
          zIndex: 1,
          display: "grid",
          gap: 22,
          minHeight: "64vh",
          alignContent: "start",
        }}
      >
        <div
          style={{
            display: "inline-flex",
            width: "fit-content",
            alignItems: "center",
            gap: 10,
            padding: "10px 16px",
            borderRadius: 999,
            background: "rgba(255,255,255,.10)",
            border: `1px solid ${meta.accent}55`,
            fontWeight: 900,
            fontSize: 14,
            letterSpacing: ".05em",
            color: "#eef3ff",
          }}
        >
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 999,
              background: meta.accent,
              boxShadow: `0 0 14px ${meta.accent}`,
            }}
          />
          {meta.kicker}
        </div>

        <div
          style={{
            fontSize: "clamp(36px, 5vw, 72px)",
            fontWeight: 900,
            lineHeight: 1.02,
            textShadow: "0 6px 28px rgba(0,0,0,.34)",
            maxWidth: 1020,
          }}
        >
          {meta.title}
        </div>

        <div
          style={{
            fontSize: "clamp(16px, 2vw, 24px)",
            lineHeight: 1.45,
            color: "rgba(255,255,255,.86)",
            maxWidth: 980,
          }}
        >
          {meta.subtitle}
        </div>

        <div
          style={{
            position: "relative",
            borderRadius: 28,
            padding: "22px 20px 24px",
            background: "rgba(255,255,255,.04)",
            border: "1px solid rgba(255,255,255,.08)",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr minmax(240px, 320px) 1fr",
              gap: 20,
              alignItems: "start",
            }}
          >
            <div style={{ display: "grid", gap: 10 }}>
              {revealPlayers
                .filter((_, idx) => idx % 2 === 0)
                .slice(0, 8)
                .map((p, idx) => (
                  <div
                    key={p.id || idx}
                    style={{
                      borderRadius: 18,
                      padding: "13px 15px",
                      background: "rgba(255,255,255,.05)",
                      border: "1px solid rgba(255,255,255,.10)",
                      fontWeight: 800,
                      fontSize: 16,
                      boxShadow: "0 8px 22px rgba(0,0,0,.16)",
                      animationName: isPairStage ? "qclubChipFadeAway" : "qclubChipLeft",
                      animationDuration: isPairStage ? ".45s" : ".48s",
                      animationTimingFunction: "ease",
                      animationFillMode: "forwards",
                      animationDelay: `${idx * 0.09}s`,
                      opacity: 0,
                    }}
                  >
                    {p.name || "Player"}
                  </div>
                ))}
            </div>

            <div
              style={{
                position: "relative",
                minHeight: 300,
                display: "grid",
                placeItems: "center",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: "18% 18% auto 18%",
                  height: 110,
                  borderRadius: 999,
                  background:
                    "radial-gradient(circle, rgba(0,191,255,.16), rgba(255,255,255,.02), transparent 70%)",
                  filter: "blur(12px)",
                  animationName: "qclubCenterFlash",
                  animationDuration: "1.3s",
                  animationTimingFunction: "ease-in-out",
                  animationIterationCount: "infinite",
                }}
              />

              <div
                style={{
                  position: "absolute",
                  top: 16,
                  width: 180,
                  height: 28,
                  borderRadius: 999,
                  background:
                    "linear-gradient(180deg, rgba(255,255,255,.18), rgba(255,255,255,.04))",
                  border: "1px solid rgba(255,255,255,.12)",
                }}
              />

              <div
                style={{
                  position: "absolute",
                  top: 36,
                  width: 215,
                  height: 178,
                  clipPath: "polygon(14% 0%, 86% 0%, 100% 100%, 0% 100%)",
                  background:
                    "linear-gradient(180deg, rgba(255,255,255,.11), rgba(20,30,58,.62) 22%, rgba(8,12,22,.96) 100%)",
                  border: "1px solid rgba(255,255,255,.12)",
                  animationName: "qclubBucketHum",
                  animationDuration: "2.1s",
                  animationTimingFunction: "ease-in-out",
                  animationIterationCount: "infinite",
                }}
              />

              <div
                style={{
                  position: "relative",
                  zIndex: 2,
                  display: "grid",
                  gap: 8,
                  justifyItems: "center",
                  marginTop: 16,
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    letterSpacing: ".14em",
                    textTransform: "uppercase",
                    color: meta.accent,
                    fontWeight: 900,
                  }}
                >
                  Draw Bucket
                </div>

                <div
                  style={{
                    fontSize: 28,
                    fontWeight: 900,
                    textAlign: "center",
                    lineHeight: 1.12,
                    maxWidth: 250,
                  }}
                >
                  {tvTournament ? tvTournament.name : "Tournament Draw"}
                </div>

                <div
                  className="muted"
                  style={{
                    textAlign: "center",
                    maxWidth: 230,
                    lineHeight: 1.45,
                    fontWeight: 700,
                  }}
                >
                  {fixtureRevealStage === "closed"
                    ? "Closing entries and preparing draw"
                    : fixtureRevealStage === "generating"
                    ? "Mixing and shuffling players"
                    : fixtureRevealStage === "locked"
                    ? "Pairings now emerging"
                    : "Opening round confirmed"}
                </div>
              </div>
            </div>

            <div style={{ display: "grid", gap: 10 }}>
              {revealPlayers
                .filter((_, idx) => idx % 2 === 1)
                .slice(0, 8)
                .map((p, idx) => (
                  <div
                    key={p.id || idx}
                    style={{
                      borderRadius: 18,
                      padding: "13px 15px",
                      background: "rgba(255,255,255,.05)",
                      border: "1px solid rgba(255,255,255,.10)",
                      fontWeight: 800,
                      fontSize: 16,
                      boxShadow: "0 8px 22px rgba(0,0,0,.16)",
                      animationName: isPairStage ? "qclubChipFadeAway" : "qclubChipRight",
                      animationDuration: isPairStage ? ".45s" : ".48s",
                      animationTimingFunction: "ease",
                      animationFillMode: "forwards",
                      animationDelay: `${idx * 0.09}s`,
                      opacity: 0,
                    }}
                  >
                    {p.name || "Player"}
                  </div>
                ))}
            </div>
          </div>
        </div>

        {(fixtureRevealStage === "locked" || fixtureRevealStage === "ready") && visiblePairs.length ? (
          <div
            style={{
              marginTop: 4,
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
              gap: 16,
            }}
          >
            {visiblePairs.map((m, idx) => (
              <div
                key={m.id || idx}
                style={{
                  borderRadius: 22,
                  padding: 20,
                  background:
                    "linear-gradient(180deg, rgba(255,255,255,.08), rgba(255,255,255,.03))",
                  border: "1px solid rgba(255,255,255,.11)",
                  boxShadow: "0 16px 38px rgba(0,0,0,.24)",
                  animationName: "qclubPairCardIn",
                  animationDuration: ".42s",
                  animationTimingFunction: "ease",
                  animationFillMode: "forwards",
                  animationDelay: `${idx * 0.08}s`,
                  opacity: 0,
                }}
              >
                <div
                  style={{
                    fontSize: 12,
                    textTransform: "uppercase",
                    letterSpacing: ".09em",
                    color: meta.accent,
                    fontWeight: 900,
                    marginBottom: 10,
                  }}
                >
                  Round {m.round || 1}
                </div>

                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 900,
                    lineHeight: 1.22,
                  }}
                >
                  {playerName(m.p1)} <span style={{ opacity: 0.56 }}>vs</span> {playerName(m.p2)}
                </div>

                {isSnooker ? (
                  <div
                    className="muted"
                    style={{
                      marginTop: 10,
                      fontWeight: 700,
                    }}
                  >
                    Handicap: {Number(m.handicap1 || 0)} - {Number(m.handicap2 || 0)}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : null}

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
          {["closed", "generating", "locked", "ready"].map((stage, idx) => {
            const active =
              ["closed", "generating", "locked", "ready"].indexOf(fixtureRevealStage) >= idx;

            return (
              <span
                key={stage}
                style={{
                  width: active ? 46 : 14,
                  height: 14,
                  borderRadius: 999,
                  background: active ? "rgba(255,255,255,.96)" : "rgba(255,255,255,.20)",
                  transition: "all .25s ease",
                }}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
  return (
    <>
      <PageShell
        title="TV Display"
        subtitle={tvTournament ? `${tvTournament.name} • ${tvTournament.month || ""}` : "Live tournament fixtures"}
        right={
          (admin || staffAdmin) ? (
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <select
                value={selectedTvTournamentId}
                onChange={(e) => setSelectedTvTournamentId(e.target.value)}
              >
                {(data.tournaments || []).map((t) => (
                  <option key={t.id} value={t.id}>
                    {tournamentDisplay(t)}
                  </option>
                ))}
              </select>

              <button
                type="button"
                className="btn primary"
                onClick={() => {
  if (!tvTournament) {
    alert("Please select a tournament first.");
    return;
  }

  const ok = generateKnockoutForTournamentSilently(data, commit, tvTournament.id);
  if (!ok) {
    alert("Need at least 2 registered players to generate fixtures.");
    return;
  }

  setTimeout(() => {
    triggerFixtureReveal();
  }, 80);
}}
              >
                Generate Fixtures
              </button>
            </div>
          ) : null
        }
      />

      <div className="container">
        <input
          ref={tvSlideFileInputRef}
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={handleTvSlideImageFileChange}
        />

        {(data.announcements || []).length > 0 && (
          <div
            style={{
              overflow: "hidden",
              whiteSpace: "nowrap",
              marginBottom: 16,
              borderRadius: 14,
              background: "rgba(0,0,0,0.68)",
              padding: "8px 14px",
              border: "1px solid rgba(255,255,255,.08)",
            }}
          >
            <div
              className="announceTickerTrack"
              style={{
                animationDuration: `${data.club?.tickerSpeed || 40}s`,
                fontSize: "clamp(18px, 2vw, 30px)",
                fontWeight: 800,
                padding: "14px 0",
                letterSpacing: "0.4px",
              }}
            >
              {(data.announcements || []).map((a) => (
                <span key={a.id} style={{ marginRight: 80 }}>
                  {a.text}
                </span>
              ))}
            </div>
          </div>
        )}

        {showFixtureBanner ? (
          <div
            style={{
              marginBottom: 16,
              padding: "14px 22px",
              borderRadius: 14,
              display: "inline-block",
              background: "linear-gradient(90deg, rgba(56,211,159,.20), rgba(0,191,255,.18))",
              border: "1px solid rgba(56, 211, 159, 0.45)",
              fontWeight: 800,
              fontSize: "22px",
              color: "#7fffd4",
              boxShadow: "0 0 18px rgba(56,211,159,.28)",
              animation: "pulseGlow 1.4s infinite",
              letterSpacing: "0.3px",
            }}
          >
            🎯 Fixtures Generated for {tvTournament?.name || "Selected Tournament"}
          </div>
        ) : null}

        <div className="card">
          <div
            className="row"
            style={{
              justifyContent: "space-between",
              alignItems: "flex-start",
              gap: 16,
              flexWrap: "wrap",
              marginBottom: 16,
            }}
          >
            <div>
              <h2 style={{ marginBottom: 6 }}>
                {tvTournament ? tournamentDisplay(tvTournament) : "The Q Club TV Mode"}
              </h2>
              <div className="muted">
                {tvMode === "showcase"
                  ? `Showcase Mode • ${
                      tvShowcaseMode === "custom_only" ? "Custom Slides Only" : "Mixed Showcase"
                    }${activeSlide?.isCustom ? " • Custom Slide" : " • Auto Slide"}`
                  : tvMode === "fixtures"
                  ? "Fixture Broadcast"
                  : `Auto Mode • ${autoPhase === "fixtures" ? "Showing Fixtures" : "Showing Showcase"}`}
              </div>
            </div>

            <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
              <button
                type="button"
                className={tvMode === "showcase" ? "btn primary" : "btn secondary"}
                onClick={() => setTvMode("showcase")}
              >
                Showcase Mode
              </button>

              <button
                type="button"
                className={tvMode === "fixtures" ? "btn primary" : "btn secondary"}
                onClick={() => setTvMode("fixtures")}
              >
                Fixture Broadcast
              </button>

              <button
                type="button"
                className={tvMode === "auto" ? "btn primary" : "btn secondary"}
                onClick={() => setTvMode("auto")}
              >
                Auto Mode
              </button>

              {(admin || staffAdmin) && tvMode === "showcase" ? (
                <>
                  <button
                    type="button"
                    className={tvShowcaseMode === "mixed" ? "btn primary" : "btn secondary"}
                    onClick={() => setTvShowcaseMode("mixed")}
                  >
                    Mixed Showcase
                  </button>

                  <button
                    type="button"
                    className={tvShowcaseMode === "custom_only" ? "btn primary" : "btn secondary"}
                    onClick={() => setTvShowcaseMode("custom_only")}
                  >
                    Custom Slides Only
                  </button>

                  <button
                    type="button"
                    className="btn secondary"
                    onClick={addCustomTvSlide}
                  >
                    + Add Slide
                  </button>

                  <button
                    type="button"
                    className="btn secondary"
                    onClick={triggerTvSlideImagePicker}
                  >
                    Upload Slide Image
                  </button>

                  <button
                    type="button"
                    className="btn secondary"
                    onClick={editCurrentTvSlide}
                  >
                    Edit Current Slide
                  </button>

                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => moveCurrentTvSlide("up")}
                  >
                    Move Up
                  </button>

                  <button
                    type="button"
                    className="btn secondary"
                    onClick={() => moveCurrentTvSlide("down")}
                  >
                    Move Down
                  </button>

                  <button
                    type="button"
                    className="btn danger"
                    onClick={deleteCurrentTvSlide}
                  >
                    Delete Current Slide
                  </button>
                </>
              ) : null}

              {(admin || staffAdmin) && matches.length ? (
                <button
                  type="button"
                  className="btn secondary"
                  onClick={triggerFixtureReveal}
                >
                  Replay Reveal
                </button>
              ) : null}
            </div>
          </div>

          {fixtureRevealStage !== "idle" && fixtureRevealStage !== "done"
            ? renderFixtureReveal()
            : showFixtureView
            ? renderFixtureView()
            : renderSlide(activeSlide)}
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
  const lastWhatsappDraft = (() => {
    try {
      return JSON.parse(localStorage.getItem("qclub_last_whatsapp_draft") || "null");
    } catch {
      return null;
    }
  })();

  const hasWhatsappDraft =
    lastWhatsappDraft &&
    typeof lastWhatsappDraft === "object" &&
    (lastWhatsappDraft.phone || lastWhatsappDraft.text || lastWhatsappDraft.url);
      const currentDraftPhone = normalizeWhatsappNumber(lastWhatsappDraft?.phone || "");
  const currentDraftIsOptedOut = currentDraftPhone
    ? isWhatsappOptedOut(currentDraftPhone)
    : false;
      const whatsappOptOuts = getWhatsappOptOuts();
        const whatsappMode = getWhatsappMode();
          const whatsappSettings = getWhatsappSettings();
              function createMembershipTestDraft() {
    const demoDraft = buildWhatsappDraft({
      phone: "9774219051",
      label: "membership_success",
      text: buildMembershipWhatsappText({
        name: "WhatsApp Test User",
        tier: "Bronze",
        validUntil: "2026-04-30",
      }),
    });

    handleWhatsappNotification({
      draft: demoDraft,
    });

    alert("Membership test WhatsApp draft created.");
    window.location.reload();
  }

  function createTournamentTestDraft() {
    const demoDraft = buildWhatsappDraft({
      phone: "9774219051",
      label: "tournament_success",
      text: buildTournamentWhatsappText({
        name: "WhatsApp Test User",
        tournamentName: "9 Ball Battle",
        fee: "99",
      }),
    });

    handleWhatsappNotification({
      draft: demoDraft,
    });

    alert("Tournament test WhatsApp draft created.");
    window.location.reload();
  }

  function createFoodTestDraft() {
    const demoDraft = buildWhatsappDraft({
      phone: "9774219051",
      label: "food_success",
      text: buildFoodWhatsappText({
        name: "WhatsApp Test User",
        orderNo: "QC-TEST-001",
        total: "198",
        items: [
          { name: "Blue Lagoon", qty: 1 },
          { name: "Virgin Mojito", qty: 1 },
        ],
      }),
    });

    handleWhatsappNotification({
      draft: demoDraft,
    });

    alert("Food test WhatsApp draft created.");
    window.location.reload();
  }

  function createBookingTestDraft() {
    const demoDraft = buildWhatsappDraft({
      phone: "9774219051",
      label: "booking_success",
      text: buildBookingWhatsappText({
        name: "WhatsApp Test User",
        table: "Snooker Table 12x6",
        bookingDate: "2026-04-01",
        bookingSlot: "18:00-19:00",
        amount: "300",
      }),
    });

    handleWhatsappNotification({
      draft: demoDraft,
    });

    alert("Booking test WhatsApp draft created.");
    window.location.reload();
  }
    async function copyMsg91Payload() {
    if (!lastWhatsappDraft?.msg91Payload) {
      alert("No MSG91 payload available to copy.");
      return;
    }

    const text = JSON.stringify(lastWhatsappDraft.msg91Payload, null, 2);

    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        alert("MSG91 payload copied.");
        return;
      }
    } catch {}

    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.setAttribute("readonly", "true");
      ta.style.position = "fixed";
      ta.style.left = "-9999px";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      alert("MSG91 payload copied.");
    } catch {
      alert("Unable to copy payload automatically.");
    }
  }
    async function sendCurrentDraftToDryRunApi() {
    if (!lastWhatsappDraft) {
      alert("No saved WhatsApp draft found.");
      return;
    }

    const payload =
      lastWhatsappDraft.msg91Payload || {
        phone: lastWhatsappDraft.phone || "",
        provider: lastWhatsappDraft.provider || "msg91",
        templateName: lastWhatsappDraft.templateName || "",
        label: lastWhatsappDraft.label || "",
      };

    try {
      const res = await fetch("/api/whatsapp-send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const json = await res.json();

      alert(
        json?.ok
          ? "Dry run API accepted the current draft."
          : `Dry run API rejected it: ${json?.error || "Unknown error"}`
      );

      console.log("WhatsApp dry run response:", json);
    } catch (error) {
      console.error("WhatsApp dry run request failed:", error);
      alert("Dry run API request failed.");
    }
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
            <h2>WhatsApp Settings</h2>
            <div className="muted" style={{ marginBottom: 12 }}>
              Local provider settings for future API integration. No live sending yet.
            </div>

            <div className="grid" style={{ marginTop: 8 }}>
              <div className="cols-3">
                <div className="muted">Provider</div>
                <div style={{ fontWeight: 800, marginTop: 6 }}>
                  {whatsappSettings.provider || "msg91"}
                </div>
              </div>

              <div className="cols-3">
                <div className="muted">Sender Number</div>
                <div style={{ fontWeight: 800, marginTop: 6 }}>
                  {whatsappSettings.senderNumber || "—"}
                </div>
              </div>

              <div className="cols-3">
                <div className="muted">Sender Label</div>
                <div style={{ fontWeight: 800, marginTop: 6 }}>
                  {whatsappSettings.senderLabel || "—"}
                </div>
              </div>

              <div className="cols-3">
                <div className="muted">Auth Key</div>
                <div style={{ fontWeight: 800, marginTop: 6 }}>
                  {whatsappSettings.authKey ? "Saved" : "Not set"}
                </div>
              </div>
                            <div className="cols-3">
                <div className="muted">Membership Template</div>
                <div style={{ fontWeight: 800, marginTop: 6 }}>
                  {whatsappSettings.membershipTemplate || "—"}
                </div>
              </div>

              <div className="cols-3">
                <div className="muted">Tournament Template</div>
                <div style={{ fontWeight: 800, marginTop: 6 }}>
                  {whatsappSettings.tournamentTemplate || "—"}
                </div>
              </div>

              <div className="cols-3">
                <div className="muted">Food Template</div>
                <div style={{ fontWeight: 800, marginTop: 6 }}>
                  {whatsappSettings.foodTemplate || "—"}
                </div>
              </div>

              <div className="cols-3">
                <div className="muted">Booking Template</div>
                <div style={{ fontWeight: 800, marginTop: 6 }}>
                  {whatsappSettings.bookingTemplate || "—"}
                </div>
              </div>

              <div className="cols-3">
                <div className="muted">OTP Template</div>
                <div style={{ fontWeight: 800, marginTop: 6 }}>
                  {whatsappSettings.otpTemplate || "—"}
                </div>
              </div>
            </div>

            <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn secondary"
                type="button"
                onClick={() => {
                  const provider = prompt(
                    "WhatsApp provider:",
                    whatsappSettings.provider || "msg91"
                  );
                  if (provider === null) return;

                  const senderNumber = prompt(
                    "Sender WhatsApp number:",
                    whatsappSettings.senderNumber || ""
                  );
                  if (senderNumber === null) return;

                  const senderLabel = prompt(
                    "Sender label / business display name:",
                    whatsappSettings.senderLabel || ""
                  );
                  if (senderLabel === null) return;

                  const authKey = prompt(
                    "Provider auth key / API key:",
                    whatsappSettings.authKey || ""
                  );
                  if (authKey === null) return;

                                    const membershipTemplate = prompt(
                    "Membership template name / ID:",
                    whatsappSettings.membershipTemplate || ""
                  );
                  if (membershipTemplate === null) return;

                  const tournamentTemplate = prompt(
                    "Tournament template name / ID:",
                    whatsappSettings.tournamentTemplate || ""
                  );
                  if (tournamentTemplate === null) return;

                  const foodTemplate = prompt(
                    "Food template name / ID:",
                    whatsappSettings.foodTemplate || ""
                  );
                  if (foodTemplate === null) return;

                  const bookingTemplate = prompt(
                    "Booking template name / ID:",
                    whatsappSettings.bookingTemplate || ""
                  );
                  if (bookingTemplate === null) return;

                  const otpTemplate = prompt(
                    "OTP template name / ID:",
                    whatsappSettings.otpTemplate || ""
                  );
                  if (otpTemplate === null) return;

                  saveWhatsappSettings({
                    provider,
                    senderNumber,
                    senderLabel,
                    authKey,
                    membershipTemplate,
                    tournamentTemplate,
                    foodTemplate,
                    bookingTemplate,
                    otpTemplate,
                  });

                  alert("WhatsApp settings saved locally.");
                  window.location.reload();
                }}
              >
                Edit Settings
              </button>

              <button
                className="btn danger"
                type="button"
                onClick={() => {
                  localStorage.removeItem("qclub_whatsapp_settings");
                  alert("WhatsApp settings cleared.");
                  window.location.reload();
                }}
              >
                Clear Settings
              </button>
            </div>
          </div>

          <div className="card cols-12">
            <h2>WhatsApp Draft Tester</h2>
                        <div className="muted" style={{ marginBottom: 12 }}>
              Preview the latest saved WhatsApp draft from successful payment actions.
            </div>

            <div
              style={{
                marginBottom: 12,
                padding: 12,
                border: "1px solid rgba(255,255,255,.10)",
                borderRadius: 14,
                background: "rgba(255,255,255,.03)",
              }}
            >
              <div className="muted">WhatsApp Mode</div>
              <div style={{ marginTop: 6, fontWeight: 800 }}>
                {whatsappMode === "disabled" ? "Disabled" : "Draft Only"}
              </div>

                                          <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
                <button
                  className="btn secondary"
                  type="button"
                  onClick={() => {
                    setWhatsappMode("draft_only");
                    alert("WhatsApp mode set to Draft Only.");
                    window.location.reload();
                  }}
                >
                  Set Draft Only
                </button>

                <button
                  className="btn warn"
                  type="button"
                  onClick={() => {
                    setWhatsappMode("disabled");
                    alert("WhatsApp mode set to Disabled.");
                    window.location.reload();
                  }}
                >
                  Disable WhatsApp
                </button>

                <button
                  className="btn primary"
                  type="button"
                  onClick={createMembershipTestDraft}
                >
                  Test Membership
                </button>

                <button
                  className="btn primary"
                  type="button"
                  onClick={createTournamentTestDraft}
                >
                  Test Tournament
                </button>

                <button
                  className="btn primary"
                  type="button"
                  onClick={createFoodTestDraft}
                >
                  Test Food
                </button>

                <button
                  className="btn primary"
                  type="button"
                  onClick={createBookingTestDraft}
                >
                  Test Booking
                </button>
              </div>
            </div>

            {!hasWhatsappDraft ? (
              <div className="muted">No saved WhatsApp draft found yet.</div>
            ) : (
              <>
                <div className="grid" style={{ marginTop: 8 }}>
                  <div className="cols-4">
                    <div className="muted">Label</div>
                    <div style={{ fontWeight: 800, marginTop: 6 }}>
                      {lastWhatsappDraft.label || "—"}
                    </div>
                  </div>

                                    <div className="cols-3">
                    <div className="muted">Phone</div>
                    <div style={{ fontWeight: 800, marginTop: 6 }}>
                      {lastWhatsappDraft.phone || "—"}
                    </div>
                  </div>

                  <div className="cols-3">
                    <div className="muted">Template</div>
                    <div style={{ fontWeight: 800, marginTop: 6 }}>
                      {lastWhatsappDraft.templateName || "—"}
                    </div>
                  </div>

                                    <div className="cols-3">
                    <div className="muted">Provider</div>
                    <div style={{ fontWeight: 800, marginTop: 6 }}>
                      {lastWhatsappDraft.provider || "—"}
                    </div>
                  </div>

                  <div className="cols-3">
                    <div className="muted">MSG91 Payload</div>
                    <div style={{ marginTop: 6, fontWeight: 800 }}>
                      {lastWhatsappDraft.msg91Payload ? "Ready" : "Not ready"}
                    </div>
                  </div>
                  <div className="cols-12">
                    <div className="muted">Opt-out Status</div>
                    <div style={{ marginTop: 6, fontWeight: 800 }}>
                      {currentDraftIsOptedOut ? "This number is opted out" : "This number is allowed"}
                    </div>
                  </div>

                                    <div className="cols-12">
                    <div className="muted" style={{ marginBottom: 6 }}>Message Preview</div>
                    <textarea
                      readOnly
                      value={lastWhatsappDraft.text || ""}
                      style={{ minHeight: 140 }}
                    />
                  </div>

                  <div className="cols-12">
                    <div className="muted" style={{ marginBottom: 6 }}>MSG91 Payload Preview</div>
                    <textarea
                      readOnly
                      value={
                        lastWhatsappDraft.msg91Payload
                          ? JSON.stringify(lastWhatsappDraft.msg91Payload, null, 2)
                          : ""
                      }
                      style={{ minHeight: 220 }}
                    />
                  </div>
                </div>

                                                                <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: "wrap" }}>
                  <button
                    className="btn primary"
                    type="button"
                    onClick={() => {
                      if (!lastWhatsappDraft?.url) {
                        alert("WhatsApp draft link is not ready.");
                        return;
                      }
                      if (currentDraftIsOptedOut) {
                        alert("This number is opted out from WhatsApp messages.");
                        return;
                      }
                      window.open(lastWhatsappDraft.url, "_blank", "noopener,noreferrer");
                    }}
                  >
                    Open in WhatsApp
                  </button>

                  <button
                    className="btn secondary"
                    type="button"
                    onClick={copyMsg91Payload}
                  >
                    Copy MSG91 Payload
                  </button>

                  <button
                    className="btn secondary"
                    type="button"
                    onClick={sendCurrentDraftToDryRunApi}
                  >
                    Send to Dry Run API
                  </button>

                  <button
                    className="btn warn"
                    type="button"
                    onClick={() => {
                      if (!currentDraftPhone) {
                        alert("No valid WhatsApp number found.");
                        return;
                      }

                      const optOuts = getWhatsappOptOuts();

                      if (optOuts.includes(currentDraftPhone)) {
                        saveWhatsappOptOuts(
                          optOuts.filter((x) => x !== currentDraftPhone)
                        );
                        alert("Number removed from opt-out list.");
                      } else {
                        saveWhatsappOptOuts([...optOuts, currentDraftPhone]);
                        alert("Number added to opt-out list.");
                      }

                      window.location.reload();
                    }}
                  >
                    {currentDraftIsOptedOut ? "Remove Opt-Out" : "Opt Out This Number"}
                  </button>

                  <button
                    className="btn danger"
                    type="button"
                    onClick={() => {
                      localStorage.removeItem("qclub_last_whatsapp_draft");
                      window.location.reload();
                    }}
                  >
                    Clear Saved Draft
                  </button>
                </div>
              </>
            )}
                    </div>

          <div className="card cols-12">
            <h2>WhatsApp Opt-Out List</h2>
            <div className="muted" style={{ marginBottom: 12 }}>
              Numbers in this list will not be opened or saved as WhatsApp drafts.
            </div>

            {whatsappOptOuts.length === 0 ? (
              <div className="muted">No opted-out numbers yet.</div>
            ) : (
              <div className="grid" style={{ marginTop: 8 }}>
                {whatsappOptOuts.map((phone) => (
                  <div
                    key={phone}
                    className="cols-4"
                    style={{
                      border: "1px solid rgba(255,255,255,.10)",
                      borderRadius: 14,
                      padding: 12,
                      background: "rgba(255,255,255,.03)",
                    }}
                  >
                    <div className="muted">Phone</div>
                    <div style={{ fontWeight: 800, marginTop: 6 }}>{phone}</div>

                    <div className="row" style={{ marginTop: 10, gap: 8, flexWrap: "wrap" }}>
                      <button
                        className="btn danger"
                        type="button"
                        onClick={() => {
                          saveWhatsappOptOuts(
                            whatsappOptOuts.filter((x) => x !== phone)
                          );
                          alert("Number removed from opt-out list.");
                          window.location.reload();
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="row" style={{ marginTop: 14, gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn secondary"
                type="button"
                onClick={() => {
                  const phone = prompt("Enter WhatsApp number to opt out:", "");
                  if (!phone) return;

                  const normalized = normalizeWhatsappNumber(phone);
                  if (!normalized) {
                    alert("Invalid number.");
                    return;
                  }

                  saveWhatsappOptOuts([...whatsappOptOuts, normalized]);
                  alert("Number added to opt-out list.");
                  window.location.reload();
                }}
              >
                + Add Number Manually
              </button>
            </div>
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
function FoodOrdersAdmin({ data, admin, staffAdmin, commit }) {
  if (!(admin || staffAdmin)) {
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
function FoodOrdersArchive({ data, admin, staffAdmin, commit }) {
  if (!(admin || staffAdmin)) {
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

      const foodWhatsappDraft = buildWhatsappDraft({
  phone: paymentMobile,
  label: "food_success",
  text: buildFoodWhatsappText({
    name: paymentName,
    orderNo: displayOrderNo,
    orderedAt: new Date().toISOString(),
    total: foodTotal,
    items: Array.isArray(foodCart) ? foodCart : [],
  }),
});

      commit({
  ...data,
  foodOrders: [...(data.foodOrders || []), newOrder]
});

                        handleWhatsappNotification({
              draft: foodWhatsappDraft,
            });

      setOrderSaved(true);
    }
        if (paymentContext === "booking" && !orderSaved) {
      const bookingWhatsappDraft = buildWhatsappDraft({
        phone: localStorage.getItem("qclub_payment_mobile") || "",
        label: "booking_success",
        text: buildBookingWhatsappText({
  name: localStorage.getItem("qclub_payment_name") || "",
  table: localStorage.getItem("qclub_booking_table") || "",
  bookedAt: new Date().toISOString(),
  bookingDate: localStorage.getItem("qclub_booking_date") || "",
  bookingSlot: localStorage.getItem("qclub_booking_slot") || "",
  amount:
    localStorage.getItem("qclub_booking_amount") ||
    localStorage.getItem("qclub_booking_fee") ||
    "",
}),
      });

                        handleWhatsappNotification({
              draft: bookingWhatsappDraft,
            });

      setOrderSaved(true);
    }
        // MEMBERSHIP SUCCESS → CREATE / UPDATE MEMBER
        if (paymentContext === "membership" && !orderSaved) {
      const name = (localStorage.getItem("qclub_payment_name") || "").trim();
      const mobile = (localStorage.getItem("qclub_payment_mobile") || "").trim();
      const tier = localStorage.getItem("qclub_membership_tier") || "Member";

      const today = todayIso();

      // default validity: 30 days (you can upgrade later per plan)
      const validUntil = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
        .toISOString()
        .slice(0, 10);

      const normalizedName = name.toLowerCase();

      const existing = (data.memberRegistry || []).find((m) => {
        const memberName = String(m?.name || "").trim().toLowerCase();
        const memberMobile = String(m?.mobile || "").trim();
        return memberName === normalizedName && memberMobile === mobile;
      });

      let nextRegistry;

      if (existing) {
        // RENEW SAME MEMBER
        nextRegistry = (data.memberRegistry || []).map((m) => {
          const memberName = String(m?.name || "").trim().toLowerCase();
          const memberMobile = String(m?.mobile || "").trim();

          return memberName === normalizedName && memberMobile === mobile
            ? {
                ...m,
                name,
                mobile,
                validUntil,
                status: "active",
                tier,
              }
            : m;
        });
      } else {
        // NEW MEMBER
        nextRegistry = [
          ...(data.memberRegistry || []),
          {
            id: `reg_${Date.now()}`,
            name,
            mobile,
            tier,
            joinedOn: today,
            validUntil,
            status: "active",
            notes: "Auto-created after payment",
          },
        ];
      }

      // UPDATE PUBLIC MEMBERS PAGE IF SAME NAME EXISTS, ELSE ADD NEW
      const existingMembersPageEntry = (data.membersPage || []).find(
        (m) => String(m?.name || "").trim().toLowerCase() === normalizedName
      );

      const nextMembersPage = existingMembersPageEntry
        ? (data.membersPage || []).map((m) =>
            String(m?.name || "").trim().toLowerCase() === normalizedName
              ? {
                  ...m,
                  name,
                  tier,
                  joinedOn: m.joinedOn || today,
                  note: m.note || "Member",
                }
              : m
          )
        : [
            ...(data.membersPage || []),
            {
              id: `mem_${Date.now()}`,
              name,
              tier,
              joinedOn: today,
              note: "Member",
            },
          ];

            const membershipAnnouncement = {
        id: uid(),
        text: `${name} joins as the latest Q Club member !`,
        createdAt: Date.now(),
      };

      const membershipWhatsappDraft = buildWhatsappDraft({
        phone: mobile,
        label: "membership_success",
        text: buildMembershipWhatsappText({
  name: paymentName,
  tier: paymentTier,
  activatedAt: new Date().toISOString(),
  validUntil: validUntilValue,
}),
      });

      commit({
        ...data,
        memberRegistry: nextRegistry,
        membersPage: nextMembersPage,
        announcements: [
          membershipAnnouncement,
          ...(data.announcements || []),
        ].slice(0, 20),
      });

                        handleWhatsappNotification({
              draft: membershipWhatsappDraft,
            });

      setOrderSaved(true);
    }
    

    if (paymentContext === "tournament" && !orderSaved) {
      const tournamentId = localStorage.getItem("qclub_tournament_id") || "";
      const tournamentName = localStorage.getItem("qclub_tournament_name") || "";
      const name = localStorage.getItem("qclub_payment_name") || "";
      const mobile = localStorage.getItem("qclub_payment_mobile") || "";
      const existingPlayerId = localStorage.getItem("qclub_tournament_player_id") || "";

      if (tournamentId && name.trim()) {
        let nextPlayers = [...(data.players || [])];
        let finalPlayerId = existingPlayerId;

        if (!finalPlayerId) {
          const existingPlayer = nextPlayers.find(
            (p) => String(p.name || "").trim().toLowerCase() === name.trim().toLowerCase()
          );

          if (existingPlayer) {
            finalPlayerId = existingPlayer.id;
          } else {
            const newPlayer = {
              id: `pl_${Date.now()}`,
              name: name.trim(),
              mobile: mobile.trim(),
              city: "Pasighat",
              createdAt: Date.now(),
            };
            nextPlayers = [...nextPlayers, newPlayer];
            finalPlayerId = newPlayer.id;
          }
        }

        const nextTournaments = (data.tournaments || []).map((t) => {
          if (t.id !== tournamentId) return t;

          const currentIds = Array.isArray(t.participantIds) ? t.participantIds : [];
          const nextIds = currentIds.includes(finalPlayerId)
            ? currentIds
            : [...currentIds, finalPlayerId];

          return {
            ...t,
            participantIds: nextIds,
          };
        });

                const tournamentAnnouncement = {
          id: uid(),
          text: `${name.trim()} registered for ${tournamentName || "the current tournament"} ! Register now`,
          link: `/tournament-register?id=${tournamentId}`,
          createdAt: Date.now(),
        };

        const tournamentWhatsappDraft = buildWhatsappDraft({
          phone: mobile,
          label: "tournament_success",
          text: buildTournamentWhatsappText({
  name,
  tournamentName,
  registeredAt: new Date().toISOString(),
  fee: localStorage.getItem("qclub_tournament_fee") || "",
}),
        });

        commit({
          ...data,
          players: nextPlayers,
          tournaments: nextTournaments,
          announcements: [
            tournamentAnnouncement,
            ...(data.announcements || []),
          ].slice(0, 20),
        });

                                handleWhatsappNotification({
                  draft: tournamentWhatsappDraft,
                });

        setOrderSaved(true);
      }
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
  const tournamentName = localStorage.getItem("qclub_tournament_name") || "Current Tournament";
const tournamentFee = localStorage.getItem("qclub_tournament_fee") || "";
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
            ) : paymentContext === "tournament" ? (
  <>
    <h2>Thank You for Registering 🏆</h2>

    <p>
      Thank you for registering for <strong>{tournamentName}</strong>.
    </p>

    <div className="card" style={{ marginTop: 12 }}>
      <div><b>Name:</b> {savedName || "—"}</div>
      <div><b>Mobile:</b> {savedMobile || "—"}</div>
      <div><b>Registration Fee:</b> ₹{tournamentFee}</div>
    </div>

    <p style={{ marginTop: 14 }}>
      Tournament will begin at <strong>6:00 PM sharp</strong>. Fixtures will be generated shortly after registration closes.
    </p>

    <div className="row" style={{ marginTop: 16 }}>
      <button className="btn primary" onClick={() => navigate("/")}>
        Go Home
      </button>
      <button className="btn" onClick={() => navigate("/fixtures")}>
        View Fixtures
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