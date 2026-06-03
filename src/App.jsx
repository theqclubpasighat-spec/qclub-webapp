/* ================================
   App.jsx — PART 1
   (Beginning â†’ inside resetAll())
================================ */

import React, { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { Routes, Route, Link, useNavigate, useLocation, useSearchParams } from "react-router-dom";

// Supabase Cloud Sync helpers (implemented in src/cloud.js)
import { cloudMissingVars, isCloudEnabled, subscribeState, writeState } from "./cloud";
import { supabase, supabaseReady } from "./supabase";
import {
  uid,
  safeNum,
  monthKey,
  todayIso,
  toLocalYmd,
  bookingAnnouncementExpiresAt,
  isAnnouncementVisible,
  formatWhatsappDateTime,
  scrollAnyOpenPanelToTop,
  timeToMinutes,
  minutesToTime,
  bookingEndTime,
  bookingSlotLabel,
  bookingAmountFor,
  bookingTotalAmount,
  isActiveBookingStatus,
  hasBookingConflict,
  bookingStatusLabel,
  offerPriceLines,
  tournamentDisplay,
  
  normalizePlayerGames,
  playerGamesLabel,
  tournamentGameKey,
  getPlayersForGame,
  getCurrentTournamentForGame,
  getEligiblePlayersForTournament,
  calcAutoRankingBoard,
} from "./lib/qclub-utils";
import {
  BottomPadding,
  PageShell,
  StaticPage,
  renderEditableContent,
  editStaticPage,
} from "./components/page-helpers";
import {
  AboutContent,
  ContactContent,
  TermsContent,
  RefundContent,
  PrivacyContent,
  AirHockeyInfoContent,
  FoosballInfoContent,
  MassageChairInfoContent,
  TournamentLegalContent,
  HandicapContent,
} from "./components/static-content-pages";
import { TopNav, FooterLinks } from "./components/layout-shell";
import { BeyondTablesSection } from "./components/beyond-tables-section";


const ReviewPanel = lazy(() =>
  import("./components/review-panel").then((module) => ({
    default: module.ReviewPanel,
  }))
);
const MatchLedgerPage = lazy(() =>
  import("./components/match-ledger-page").then((module) => ({
    default: module.MatchLedgerPage,
  }))
);
const TVMode = lazy(() =>
  import("./components/tv-mode").then((module) => ({
    default: module.TVMode,
  }))
);
const AdminPanel = lazy(() =>
  import("./components/admin-panel").then((module) => ({
    default: module.AdminPanel,
  }))
);
const RummySnookerPage = lazy(() =>
  import("./components/rummy-snooker-page.jsx").then((module) => ({
    default: module.RummySnookerPage,
  }))
);

const RummySnookerDisplayPage = lazy(() =>
  import("./components/rummy-snooker-page.jsx").then((module) => ({
    default: module.RummySnookerDisplayPage,
  }))
);
const QChaseRecordsPage = lazy(() =>
  import("./components/rummy-snooker-page.jsx").then((module) => ({
    default: module.QChaseRecordsPage,
  }))
);
const QChaseMonthlyReportPage = lazy(() =>
  import("./components/rummy-snooker-page.jsx").then((module) => ({
    default: module.QChaseMonthlyReportPage,
  }))
);
const KittyPage = lazy(() =>
  import("./components/kitty-page.jsx").then((module) => ({
    default: module.KittyPage,
  }))
);
const KittyDisplayPage = lazy(() =>
  import("./components/kitty-page.jsx").then((module) => ({
    default: module.KittyDisplayPage,
  }))
);
const KittyRecordsPage = lazy(() =>
  import("./components/kitty-page.jsx").then((module) => ({
    default: module.KittyRecordsPage,
  }))
);
const KittyMonthlyReportPage = lazy(() =>
  import("./components/kitty-page.jsx").then((module) => ({
    default: module.KittyMonthlyReportPage,
  }))
);
/* =========================================================
   Q CLUB â€“ Single-file WebApp (Mobile-first)
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
const FOOD_AUTO_PRINT_ENABLED_KEY = "qclub_food_auto_print_enabled";
const POLICY_SYNC_VERSION = "2026-04-19-policy-v1";
const POLICY_SYNC_KEY = "qclub_policy_sync_version";
const QCLUB_APP_VERSION = "2026-05-23-cache-buster-v1";
const QCLUB_APP_VERSION_KEY = "qclub_app_version";
const QCLUB_UPDATE_RELOAD_KEY = "qclub_update_reload_once";

async function clearQClubBrowserCache() {
  try {
    if ("caches" in window) {
      const cacheNames = await window.caches.keys();
      await Promise.all(cacheNames.map((name) => window.caches.delete(name)));
    }
  } catch {}

  try {
    if ("serviceWorker" in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map((registration) => registration.unregister()));
    }
  } catch {}
}

async function checkQClubAppVersion() {
  if (typeof window === "undefined") return;
    const path = String(window.location?.pathname || "");
  const isLiveScorerPage =
    path.startsWith("/kitty") ||
    path.startsWith("/rummy") ||
    path.startsWith("/qchase");

  if (isLiveScorerPage) return;

  let latestVersion = QCLUB_APP_VERSION;

  try {
    const response = await fetch(`/version.json?v=${Date.now()}`, {
      cache: "no-store",
    });

    if (response.ok) {
      const info = await response.json();
      latestVersion = String(info?.version || QCLUB_APP_VERSION).trim() || QCLUB_APP_VERSION;
    }
  } catch {}

  const savedVersion = localStorage.getItem(QCLUB_APP_VERSION_KEY);

  if (!savedVersion) {
    localStorage.setItem(QCLUB_APP_VERSION_KEY, latestVersion);
    return;
  }

  if (savedVersion === latestVersion) {
    localStorage.removeItem(QCLUB_UPDATE_RELOAD_KEY);
    return;
  }

  const alreadyReloadedForVersion =
    localStorage.getItem(QCLUB_UPDATE_RELOAD_KEY) === latestVersion;

  localStorage.setItem(QCLUB_APP_VERSION_KEY, latestVersion);

  if (alreadyReloadedForVersion) return;

  localStorage.setItem(QCLUB_UPDATE_RELOAD_KEY, latestVersion);

  await clearQClubBrowserCache();

  const url = new URL(window.location.href);
  url.searchParams.set("qv", latestVersion);
  window.location.replace(url.toString());
}

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


function bookingTimeSlots(selectedDate = todayIso(), blockedSlotValues = [], durationHours = 1) {
  const slots = [];
  const today = todayIso();
  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const blockedRanges = (blockedSlotValues || []).map((value) => {
    const safeValue = String(value || "").trim();

    if (!safeValue) return null;

    if (safeValue.includes(" to ")) {
  const [startStr, endStr] = safeValue.split(" to ");
  const startMinutes = timeToMinutes(startStr);
  const endMinutes = timeToMinutes(endStr);

  if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes)) return null;

  return { startMinutes, endMinutes };
}

const plainStart = safeValue.includes("-")
  ? safeValue.split("-")[0]
  : safeValue;

const startMinutes = timeToMinutes(plainStart);
const endMinutes = timeToMinutes(bookingEndTime(plainStart, 1));

if (!Number.isFinite(startMinutes) || !Number.isFinite(endMinutes)) return null;

return { startMinutes, endMinutes };
  }).filter(Boolean);

  for (let minutes = 11 * 60; minutes <= 22 * 60; minutes += 15) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;

  const start = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
  const value = start;

  const slotEndMinutes = timeToMinutes(bookingEndTime(start, durationHours));
  const closingMinutes = 23 * 60;

  const isPastToday =
    selectedDate === today && currentMinutes >= minutes;

  const exceedsClosingTime =
    Number.isFinite(slotEndMinutes) && slotEndMinutes > closingMinutes;

  const isBlocked = blockedRanges.some((range) => {
    return minutes < range.endMinutes && slotEndMinutes > range.startMinutes;
  });

  slots.push({
    value,
    label: start,
    disabled: isPastToday || exceedsClosingTime || isBlocked,
    blocked: isBlocked,
  });
}

  return slots;
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
  heroBookBtnLabel: "Book Table",
  heroMembershipBtnLabel: "Membership",
  heroShopBtnLabel: "The Q Shop",
  bookPageTitle: "Book Table",
  bookPageSubtitle: "Quick Booking + Secure Online Payment",
  membershipPageTitle: "Membership",
  membershipPageSubtitle: "Apply for Membership with Secure Online Payment",
  shopPageTitle: "The Q Shop",
  shopPageSubtitle: "Cue sticks, cases and accessories arriving soon",
  contact: {
  phone1: "8974193310",
  phone2: "7085221922",
  email1: "admin@theqclubpasighat.com",
  email2: "theqclubpasighat@gmail.com",
},
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
  contactContent: `If you have any questions about bookings, memberships, tournaments, QShop orders, or pickups, feel free to contact us.

The Q Club Pasighat
GTC, Near DHO Office
PO/PS: Pasighat
East Siang, Arunachal Pradesh
PIN: 791102

## WhatsApp Support
8974193310

## Email
admin@theqclubpasighat.com
theqclubpasighat@gmail.com

## Support / Pickup Hours
11:00 AM to 8:00 PM

## Services
- Snooker
- Pool
- Air Hockey
- Foosball
- Massage Chair
- Tea & Coffee
- QShop Orders
- Memberships
- Tournaments`,
  termsTitle: "Terms & Conditions",
  termsContent: `By entering The Q Club Pasighat premises or using our website, QShop, bookings, memberships, or other club services, you agree to the following terms.

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

## 4. QShop Orders
- QShop currently operates on an online payment and in-store pickup only model.
- Home delivery is not available at this time.
- All products are subject to stock availability.
- Product images are for general representation only. Actual colour, finish, packaging, or minor design details may vary slightly depending on supplier batch or available stock.

## 5. Payments
- Once payment is successfully made, the order is treated as confirmed.
- Cancellation is not allowed after payment.

## 6. Pickup
- Orders must be collected within 7 days from the date of confirmation.
- Customers may be asked to show order confirmation, payment confirmation, or registered mobile / WhatsApp number at the time of pickup.
- If another person is collecting on behalf of the customer, the customer should inform the shop in advance and provide the order details.

## 7. Refunds and Exchanges
- No refunds shall be provided after successful payment.
- Exchange may be allowed only if the item is found to be genuinely defective, subject to inspection and stock availability.

## 8. Liability
- The Q Club Pasighat is not responsible for loss of personal belongings within the premises.
- The Club shall not be responsible for wrong purchase decisions made without checking product details, specifications, or compatibility properly.

## 9. Management Rights
- The management reserves the right to refuse entry, refuse service, verify customer details, reject suspicious pickups, modify prices, update membership benefits, and change club rules or store policies without prior notice.`,
  refundTitle: "Refund Policy",
  refundContent: `At The Q Club Pasighat, we strive to ensure a smooth and fair experience for all customers, members, players, and visitors.

## 1. Membership
- Membership fees are generally non-refundable once activated.
- Membership registrations once approved and activated are ordinarily final.
- In exceptional cases involving duplicate payment or technical error, management may review the matter at its discretion.

## 2. Table Bookings
- If advance bookings are introduced or accepted, cancellations made at least 2 hours before booking time may be eligible for rescheduling at the discretion of management.
- Missed bookings may not be refundable.
- If a booking slot cannot be honoured due to operational reasons, equipment issues, or a verified system error, management may offer rescheduling, time adjustment, credit, or other suitable resolution at its discretion.

## 3. QShop Orders
- QShop currently operates on an online payment and in-store pickup only model.
- No refunds shall be issued after successful payment for QShop orders.
- Cancellation is not allowed after payment.
- Refund requests based on change of mind, incorrect selection by customer, delayed pickup, or personal preference shall not be accepted.
- Exchange may be considered only if the item is found to be genuinely defective.
- Exchange requests should be raised promptly at pickup or within a reasonable time if the defect could not have been easily noticed immediately.
- Management may inspect the item before approving exchange.
- Exchange is subject to stock availability.

## 4. QFood Orders
- Food and beverage orders, once confirmed and prepared or processed, are generally non-cancellable and non-refundable.
- If an item becomes unavailable after payment, management may offer a replacement item, store adjustment, or refund at its discretion.
- Complaints relating to missing, wrong, or defective food items should be raised promptly with staff for review.

## 5. Tournament Registration
- Tournament registration fees are generally non-refundable once a playerâ€™s entry has been accepted or the fixture process has begun.
- If a player withdraws after registration, refund is ordinarily not available.
- If a tournament is postponed, rescheduled, or cancelled by the club, management may decide whether to carry forward the registration, reschedule participation, provide club credit, or issue refund in full or in part, depending on the circumstances.

## 6. Technical Issues
- If a game, session, order, registration, or payment cannot be completed properly due to equipment malfunction, staff error, platform issue, or payment verification problem, staff or management may offer replacement play time, rescheduling, exchange, club credit, or another reasonable remedy at the discretion of management.

## 7. Refund Review
- If a payment is made in error or a genuine technical issue occurs during payment processing, customers may contact The Q Club Pasighat for review.
- Any refund, if approved, may be processed within 5â€“7 working days or within a reasonable time depending on banking and payment gateway timelines.

## 8. Not Covered
Refund or exchange shall ordinarily not apply in the following cases:
- change of mind
- incorrect selection by customer
- delayed pickup by customer
- minor cosmetic variation in packaging
- slight variation in colour or appearance from listing image
- damage caused after pickup or handover
- misuse, mishandling, alteration, or improper storage by customer
- failure to attend a booked session, tournament, or scheduled pickup without valid operational cause`,
  privacyTitle: "Privacy Policy",
  privacyContent: `The Q Club Pasighat respects your privacy and is committed to handling customer, member, player, and visitor information responsibly.

## 1. Information We Collect
We may collect basic information such as:
- name
- phone number
- WhatsApp number
- membership details
- booking details
- tournament participation records
- QShop order details
- QFood order details
- payment reference information
- basic support or grievance messages submitted by customers

## 2. How We Use This Information
Your information may be used for:
- membership verification and administration
- booking confirmation and scheduling
- tournament registration, fixtures, records, and leaderboard rankings
- QShop order confirmation, pickup coordination, and support
- QFood order processing and customer coordination
- communication about club events, announcements, offers, services, and operational updates
- payment verification and basic record keeping
- handling customer complaints, exchanges, technical issues, or refund reviews where applicable

## 3. Data Protection
The Q Club Pasighat does not sell customer personal data to third parties.
We take reasonable steps to store and use customer information only for club, operational, service, and communication purposes.

## 4. Payment Information
Payment transactions are processed through authorised payment gateway providers.
The Q Club Pasighat does not store full card, UPI PIN, banking password, or other sensitive payment credentials on its own servers.

## 5. Sharing of Information
Customer information may be shared only where reasonably necessary with:
- authorised payment service providers
- operational service tools used by the club
- staff or administrators handling bookings, orders, memberships, tournaments, or support
- legal or regulatory authorities where required by law

## 6. Media Usage
Photos and videos taken inside the club premises, during tournaments, events, memberships, or related activities may be used on social media, promotional materials, and website content, unless management decides otherwise in a specific case.

## 7. Customer Responsibility
Customers are requested to provide correct contact and order information.
The Club shall not be responsible for issues caused by incorrect phone number, wrong pickup details, or inaccurate information submitted by the customer.

## 8. Policy Updates
This Privacy Policy may be updated from time to time to reflect operational, legal, or service changes. Continued use of The Q Club Pasighat website or services shall be treated as acceptance of the updated policy.`,
  airHockeyInfoTitle: "Air Hockey at The Q Club",
  airHockeyInfoContent: `## Pricing
- ₹100 per game(7 goals) or 10 minutes,whichever comes first
- Great for quick matches with friends

## How to Play
- Two players stand on opposite sides
- Use the striker to hit the puck
- Score by sending the puck into the opponent's goal

## Basic Rules
- Do not touch the puck with hands
- Keep the striker on your half
- First to the agreed score wins

## Why Try It at Q Club
- Fast and exciting
- Perfect for friends and groups
- A fun break between snooker and pool sessions`,
  foosballInfoTitle: "Foosball at The Q Club",
  foosballInfoContent: `## Pricing
- ₹100 per game(5 goals) or 10 minutes,whichever comes first
- Great for quick doubles or singles matches

## How to Play
- Each player controls rods with football figures
- Use the rods to pass, defend, and shoot
- Score by sending the ball into the opponent's goal

## Basic Rules
- No spinning the rods wildly
- Restart play fairly after a goal
- First to the agreed score wins

## Why Try It at Q Club
- Fast and social
- Perfect for 2 or 4 players
- Great fun for friends and groups`,
  massageChairInfoTitle: "Massage Chair at The Q Club",
  massageChairInfoContent: `## Pricing
- ₹200 for 10 minutes
- ₹300 for 20 minutes

## How to Use
- Sit comfortably and choose your session
- Relax while the chair runs the massage program
- Best enjoyed between games or after long sessions

## Available Modes
- Neck & shoulder relaxation
- Back massage
- Full body relaxation

## Why Try It at Q Club
- Premium comfort
- Great between matches
- A novelty experience in town`,
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

The Club does not organise, facilitate, or profit from any private wagering or side betting that individuals may independently engage in amongst themselves. Any such private act is not part of the Clubâ€™s official services, tournament structure, or business model.

The Club charges only for lawful use of its premises, facilities, event organisation, and related services, and does not take any commission or percentage from private bets, if any, between individuals.

By participating in any tournament at The Q Club, players acknowledge that tournament formats, rules, prize structures, schedules, and eligibility conditions may be fixed, revised, or interpreted by the management in the interest of smooth event conduct. Management reserves the right to refuse entry, disqualify participants for misconduct, and amend tournament rules or schedules when reasonably required.`,
},
        admin: {
  mainPin: "1234",
  staffPin: "5678",
  committeePin: "9012",
  rummyPin: "2468",
  rummyFinalLockPin: "8642",
},
    announcements: [
      { id: uid(), text: "Monthly tournaments every month ðŸ”¥ Register at counter.", createdAt: Date.now() },
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
      { id: uid(), title: "Massage Chair", price: "₹99 / 10 min â€¢ ₹199 / 20 min", details: "Relax between frames." },
      { id: uid(), title: "Foosball", price: "₹50 / game", details: "Best of 3 fun matches." },
      { id: uid(), title: "Air Hockey", price: "₹50 / game", details: "Fast rounds — winner stays!" },
      { id: uid(), title: "Tea/Coffee Vending", price: "₹10â€“₹20", details: "Self-serve vending." },
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
    jobApplications: [],
    jobSettings: {
  acceptingApplications: true,
  positions: [
    "Club Assistant (Counter & Operations)",
    "Floor Assistant",
    "Marker / Referee",
    "Kitchen Assistant",
  ],
},
    speakerAlerts: [],
    whatsappJobs: [],
    whatsappPersistence: {
      customTemplates: [
  {
    id: "job_application_received",
    label: "Job Application Received",
    key: "job_application_received",
    templateName: "job_application_received",
    purpose: "Employment application confirmation",
  },
],
  settings: {
    provider: "msg91",
    authKey: "",
    senderNumber: "",
    senderLabel: "",
    qshopSuccessTemplate: "",
    qshopFailedTemplate: "",
    bookingSuccessTemplate: "",
    bookingFailedTemplate: "",
    membershipSuccessTemplate: "",
    membershipFailedTemplate: "",
    otpTemplate: "",
    tournamentSuccessTemplate: "",
    tournamentFailedTemplate: "",
    foodSuccessTemplate: "",
    foodFailedTemplate: "",
    jobApplicationReceivedTemplate: "",
    jobInterviewCallTemplate: "",
  },
  mode: "draft_only",
  optOuts: [],
},
    archivedFoodOrders: [],
    shopReceipts: [],
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
    {
      id: "snk12",
      label: "Snooker Table 12x6",
      pricePerHour: 400,
      memberPricePerHour: 300,
    },
    {
      id: "mini10",
      label: "Mini Snooker 10x5",
      pricePerHour: 300,
      memberPricePerHour: 200,
    },
    {
      id: "pool9",
      label: "American Pool",
      pricePerHour: 300,
      memberPricePerHour: 200,
    },
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
  email1: pickText(src?.club?.contact?.email1, base.club.contact.email1 || ""),
  email2: pickText(src?.club?.contact?.email2, base.club.contact.email2 || ""),
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
jobApplications: Array.isArray(src.jobApplications) ? src.jobApplications : base.jobApplications,
jobSettings: {
  ...base.jobSettings,
  ...(src.jobSettings || {}),
  acceptingApplications:
    typeof src?.jobSettings?.acceptingApplications === "boolean"
      ? src.jobSettings.acceptingApplications
      : base.jobSettings.acceptingApplications,
      positions: Array.isArray(src?.jobSettings?.positions) && src.jobSettings.positions.length
  ? src.jobSettings.positions
  : base.jobSettings.positions,
},
speakerAlerts: Array.isArray(src.speakerAlerts) ? src.speakerAlerts : (base.speakerAlerts || []),
whatsappJobs: Array.isArray(src.whatsappJobs) ? src.whatsappJobs : [],
whatsappPersistence: {
  customTemplates: Array.isArray(src?.whatsappPersistence?.customTemplates)
  ? src.whatsappPersistence.customTemplates
  : base.whatsappPersistence.customTemplates,
  settings: {
    provider:
      String(src?.whatsappPersistence?.settings?.provider || base.whatsappPersistence.settings.provider).trim() || "msg91",
    authKey: String(src?.whatsappPersistence?.settings?.authKey || base.whatsappPersistence.settings.authKey).trim(),
    senderNumber: String(src?.whatsappPersistence?.settings?.senderNumber || base.whatsappPersistence.settings.senderNumber).trim(),
    senderLabel: String(src?.whatsappPersistence?.settings?.senderLabel || base.whatsappPersistence.settings.senderLabel).trim(),
    qshopSuccessTemplate: String(src?.whatsappPersistence?.settings?.qshopSuccessTemplate || base.whatsappPersistence.settings.qshopSuccessTemplate).trim(),
    qshopFailedTemplate: String(src?.whatsappPersistence?.settings?.qshopFailedTemplate || base.whatsappPersistence.settings.qshopFailedTemplate).trim(),
    bookingSuccessTemplate: String(src?.whatsappPersistence?.settings?.bookingSuccessTemplate || base.whatsappPersistence.settings.bookingSuccessTemplate).trim(),
    bookingFailedTemplate: String(src?.whatsappPersistence?.settings?.bookingFailedTemplate || base.whatsappPersistence.settings.bookingFailedTemplate).trim(),
    membershipSuccessTemplate: String(src?.whatsappPersistence?.settings?.membershipSuccessTemplate || base.whatsappPersistence.settings.membershipSuccessTemplate).trim(),
    membershipFailedTemplate: String(src?.whatsappPersistence?.settings?.membershipFailedTemplate || base.whatsappPersistence.settings.membershipFailedTemplate).trim(),
    otpTemplate: String(src?.whatsappPersistence?.settings?.otpTemplate || base.whatsappPersistence.settings.otpTemplate).trim(),
    tournamentSuccessTemplate: String(src?.whatsappPersistence?.settings?.tournamentSuccessTemplate || base.whatsappPersistence.settings.tournamentSuccessTemplate).trim(),
    tournamentFailedTemplate: String(src?.whatsappPersistence?.settings?.tournamentFailedTemplate || base.whatsappPersistence.settings.tournamentFailedTemplate).trim(),
    foodSuccessTemplate: String(src?.whatsappPersistence?.settings?.foodSuccessTemplate || base.whatsappPersistence.settings.foodSuccessTemplate).trim(),
    foodFailedTemplate: String(src?.whatsappPersistence?.settings?.foodFailedTemplate || base.whatsappPersistence.settings.foodFailedTemplate).trim(),
    jobApplicationReceivedTemplate: String(src?.whatsappPersistence?.settings?.jobApplicationReceivedTemplate || base.whatsappPersistence.settings.jobApplicationReceivedTemplate).trim(),
  jobInterviewCallTemplate: String(src?.whatsappPersistence?.settings?.jobInterviewCallTemplate || base.whatsappPersistence.settings.jobInterviewCallTemplate).trim(),
  },
  mode:
    String(src?.whatsappPersistence?.mode || base.whatsappPersistence.mode).trim() === "disabled"
      ? "disabled"
      : String(src?.whatsappPersistence?.mode || base.whatsappPersistence.mode).trim() === "live"
      ? "live"
      : "draft_only",
  optOuts: Array.isArray(src?.whatsappPersistence?.optOuts)
    ? src.whatsappPersistence.optOuts
    : base.whatsappPersistence.optOuts,
},
archivedFoodOrders: Array.isArray(src.archivedFoodOrders) ? src.archivedFoodOrders : base.archivedFoodOrders,
shopReceipts: Array.isArray(src.shopReceipts) ? src.shopReceipts : (base.shopReceipts || []),
tournaments: Array.isArray(src.tournaments) ? src.tournaments : base.tournaments,
    booking: {
  ...base.booking,
  ...(src.booking || {}),
  tables:
  Array.isArray(src?.booking?.tables) && src.booking.tables.length
    ? src.booking.tables.map((t) => ({
        ...t,
        label: String(t?.label || ""),
        pricePerHour: safeNum(t?.pricePerHour, 0),
        memberPricePerHour: safeNum(
          t?.memberPricePerHour,
          t?.id === "snk12"
            ? 300
            : t?.id === "mini10" || t?.id === "pool9"
            ? 200
            : safeNum(t?.pricePerHour, 0)
        ),
      }))
    : base.booking.tables,
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
function pickLatestIso(localValue = "", remoteValue = "") {
  const localTime = Date.parse(localValue || "");
  const remoteTime = Date.parse(remoteValue || "");

  if (Number.isFinite(localTime) && Number.isFinite(remoteTime)) {
    return localTime >= remoteTime ? localValue : remoteValue;
  }

  return localValue || remoteValue || "";
}

function mergeById(remoteList = [], localList = [], mergeItem, options = {}) {
  const keepLocalOnly = options.keepLocalOnly !== false;

  const localMap = new Map(
    (localList || [])
      .map((item) => [String(item?.id || ""), item])
      .filter(([id]) => id)
  );

  const remoteIds = new Set();

  const mergedRemote = (remoteList || []).map((item) => {
    const id = String(item?.id || "");
    if (id) remoteIds.add(id);

    const localItem = localMap.get(id);
    return localItem ? mergeItem(item, localItem) : item;
  });

  if (!keepLocalOnly) {
    return mergedRemote;
  }

  const localOnly = (localList || []).filter((item) => {
    const id = String(item?.id || "");
    return id && !remoteIds.has(id);
  });

  return [...mergedRemote, ...localOnly];
}

function mergeHydratedOperationalState(localState, remoteState) {
  const local = localState && typeof localState === "object" ? localState : {};
  const remote = remoteState && typeof remoteState === "object" ? remoteState : {};

  const mergedFoodOrders = mergeById(
    remote.foodOrders || [],
    local.foodOrders || [],
    (remoteOrder, localOrder) => {
      const printedAt = pickLatestIso(
        String(localOrder?.printMeta?.printedAt || ""),
        String(remoteOrder?.printMeta?.printedAt || "")
      );

      const printingAt = pickLatestIso(
        String(localOrder?.printMeta?.printingAt || ""),
        String(remoteOrder?.printMeta?.printingAt || "")
      );

      let status = String(remoteOrder?.printMeta?.status || "");

      if (printedAt) {
        status = "printed";
      } else if (
        String(localOrder?.printMeta?.status || "") === "printing" ||
        String(remoteOrder?.printMeta?.status || "") === "printing"
      ) {
        status = "printing";
      } else {
        status =
          String(localOrder?.printMeta?.status || "") ||
          String(remoteOrder?.printMeta?.status || "") ||
          "pending_auto_print";
      }

            return {
        ...remoteOrder,
        printMeta: {
          ...(remoteOrder?.printMeta || {}),
          ...(localOrder?.printMeta || {}),
          status,
          printedAt,
          printingAt,
          printedByRole:
            localOrder?.printMeta?.printedByRole ||
            remoteOrder?.printMeta?.printedByRole ||
            "",
          printingByRole:
            localOrder?.printMeta?.printingByRole ||
            remoteOrder?.printMeta?.printingByRole ||
            "",
        },
      };
    },
    { keepLocalOnly: false }
  );

  const mergedSpeakerAlerts = mergeById(
    remote.speakerAlerts || [],
    local.speakerAlerts || [],
    (remoteAlert, localAlert) => {
      const playedAt = pickLatestIso(
        String(localAlert?.playedAt || ""),
        String(remoteAlert?.playedAt || "")
      );

      return {
        ...remoteAlert,
        ...(playedAt ? { playedAt } : {}),
        playedByRole:
          localAlert?.playedByRole ||
          remoteAlert?.playedByRole ||
          "",
      };
    }
  );

  const mergedWhatsappJobs = mergeById(
    remote.whatsappJobs || [],
    local.whatsappJobs || [],
    (remoteJob, localJob) => {
      const sentAt = pickLatestIso(
        String(localJob?.sentAt || ""),
        String(remoteJob?.sentAt || "")
      );

      const failedAt = pickLatestIso(
        String(localJob?.failedAt || ""),
        String(remoteJob?.failedAt || "")
      );

      const sendingAt = pickLatestIso(
        String(localJob?.sendingAt || ""),
        String(remoteJob?.sendingAt || "")
      );

      let status = String(remoteJob?.status || "");

      if (sentAt) {
        status = "sent";
      } else if (failedAt) {
        status = "failed";
      } else if (
        String(localJob?.status || "") === "sending" ||
        String(remoteJob?.status || "") === "sending"
      ) {
        status = "sending";
      } else {
        status =
          String(localJob?.status || "") ||
          String(remoteJob?.status || "") ||
          "pending";
      }

      return {
        ...remoteJob,
        draft: remoteJob?.draft || localJob?.draft || null,
        status,
        sentAt,
        failedAt,
        sendingAt,
        failedReason:
          localJob?.failedReason ||
          remoteJob?.failedReason ||
          "",
        sentByRole:
          localJob?.sentByRole ||
          remoteJob?.sentByRole ||
          "",
      };
    }
  );

    const mergedJobApplications = mergeById(
    remote.jobApplications || [],
    local.jobApplications || [],
    (remoteApp, localApp) => {
      const updatedAt = pickLatestIso(
        String(localApp?.updatedAt || localApp?.createdAt || ""),
        String(remoteApp?.updatedAt || remoteApp?.createdAt || "")
      );

      return {
        ...remoteApp,
        ...localApp,
        status: String(localApp?.status || remoteApp?.status || "new"),
        createdAt: pickLatestIso(
          String(localApp?.createdAt || ""),
          String(remoteApp?.createdAt || "")
        ),
        updatedAt,
      };
    }
  );

  return {
    ...remote,
    foodOrders: mergedFoodOrders,
    speakerAlerts: mergedSpeakerAlerts,
    whatsappJobs: mergedWhatsappJobs,
    jobApplications: mergedJobApplications,
  };
}

function isMeaningfulState(obj) {
  if (!obj || typeof obj !== "object") return false;
  return Object.keys(obj).length > 0;
}

function qclubArrayLen(value) {
  return Array.isArray(value) ? value.length : 0;
}

function qclubObjectKeyLen(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.keys(value).length
    : 0;
}

function qclubStringLen(value) {
  return String(value || "").trim().length;
}

function getQclubStateHealth(state) {
  const s = state && typeof state === "object" ? state : {};
  const club = s.club || {};
  const contact = club.contact || {};
  const menuCatalog = s.menuCatalog || {};

  const menuCategories = qclubObjectKeyLen(menuCatalog);
  const menuItems = Object.values(menuCatalog || {}).reduce((sum, category) => {
    return sum + qclubArrayLen(category?.items);
  }, 0);

  return {
    shopItems: qclubArrayLen(s.shopCatalog?.items) + qclubArrayLen(s.shopItems),
    memberships: qclubArrayLen(s.memberships),
    tournaments: qclubArrayLen(s.tournaments),
    bookingTables: qclubArrayLen(s.booking?.tables),
    bookingRequests: qclubArrayLen(s.booking?.requests),
    players: qclubArrayLen(s.players),
    membersPage: qclubArrayLen(s.membersPage),
    memberRegistry: qclubArrayLen(s.memberRegistry),
    offers: qclubArrayLen(s.offers),
    photos: qclubArrayLen(s.photos),
    hallOfFame: qclubArrayLen(s.hallOfFame),
    announcements: qclubArrayLen(s.announcements),
    menuCategories,
    menuItems,
    foodOrders: qclubArrayLen(s.foodOrders),
    shopReceipts: qclubArrayLen(s.shopReceipts),
    inventoryItems: qclubArrayLen(s.inventoryItems),
    reviewHistory: qclubArrayLen(s.reviewHistory),
    whatsappJobs: qclubArrayLen(s.whatsappJobs),

    clubText:
      qclubStringLen(club.name) +
      qclubStringLen(club.location) +
      qclubStringLen(club.tagline) +
      qclubStringLen(club.aboutContent) +
      qclubStringLen(club.termsContent) +
      qclubStringLen(club.refundContent) +
      qclubStringLen(club.privacyContent) +
      qclubStringLen(contact.phone1) +
      qclubStringLen(contact.phone2) +
      qclubStringLen(contact.email1) +
      qclubStringLen(contact.email2),

    customPins:
      [
        s.admin?.mainPin,
        s.admin?.staffPin,
        s.admin?.committeePin,
        s.admin?.rummyPin,
        s.admin?.rummyFinalLockPin,
      ].filter((pin) => {
        const clean = String(pin || "").trim();
        return clean && !["1234", "5678", "9012"].includes(clean);
      }).length,
  };
}

function stateRichnessScore(state) {
  const h = getQclubStateHealth(state);

  let score = 0;

  score += h.shopItems * 12;
  score += h.memberships * 10;
  score += h.tournaments * 12;
  score += h.bookingTables * 10;
  score += h.players * 7;
  score += h.membersPage * 6;
  score += h.memberRegistry * 6;
  score += h.menuCategories * 8;
  score += h.menuItems * 5;
  score += h.offers * 5;
  score += h.photos * 3;
  score += h.bookingRequests * 3;
  score += h.shopReceipts * 2;
  score += h.foodOrders * 2;
  score += h.inventoryItems * 3;
  score += h.announcements * 2;
  score += h.hallOfFame * 2;
  score += h.reviewHistory * 2;
  score += h.whatsappJobs;
  score += Math.min(h.clubText, 3000) / 40;
  score += h.customPins * 8;

  return score;
}

function chooseRicherState(primaryState, fallbackState) {
  const primaryScore = stateRichnessScore(primaryState);
  const fallbackScore = stateRichnessScore(fallbackState);

  return fallbackScore > primaryScore ? fallbackState : primaryState;
}

function isWholeWebappCatastrophicDrop(previousState, nextState) {
  const before = getQclubStateHealth(previousState);
  const after = getQclubStateHealth(nextState);

  const danger =
    (before.shopItems >= 8 && after.shopItems <= 3) ||
    (before.memberships >= 4 && after.memberships <= 1) ||
    (before.tournaments >= 4 && after.tournaments <= 1) ||
    (before.bookingTables >= 3 && after.bookingTables === 0) ||
    (before.players >= 5 && after.players <= 1) ||
    (before.membersPage >= 3 && after.membersPage <= 1) ||
    (before.memberRegistry >= 3 && after.memberRegistry <= 1) ||
    (before.menuCategories >= 4 && after.menuCategories <= 1) ||
    (before.menuItems >= 8 && after.menuItems <= 2) ||
    (before.offers >= 3 && after.offers === 0) ||
    (before.clubText >= 1200 && after.clubText < 400) ||
    (before.customPins >= 2 && after.customPins === 0);

  return danger;
}

function loadData() {
  try {
    const primaryRaw =
      localStorage.getItem("qclub_v5_data") ||
      localStorage.getItem("qclub_v3_data") ||
      localStorage.getItem("qclub_v2_data") ||
      "";

    const backupRaw = localStorage.getItem("qclub_state_backup") || "";

    const primaryParsed = primaryRaw ? JSON.parse(primaryRaw) : null;
    const backupParsed = backupRaw ? JSON.parse(backupRaw) : null;

    const bestParsed = chooseRicherState(primaryParsed, backupParsed);

    if (!bestParsed) return syncMembersIntoPlayers(defaultData());

    return syncMembersIntoPlayers(mergeWithDefaults(bestParsed));
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
function announceNewFoodOrder() {
  try {
    const synth = window.speechSynthesis;
    if (!synth) return;

    synth.cancel();

    const text = "New food order received. New food order received.";
    const msg = new SpeechSynthesisUtterance(text);

    msg.volume = 1;
    msg.rate = 0.9;
    msg.pitch = 1;

    const voices = synth.getVoices();
    const preferred =
      voices.find((v) => /english/i.test(v.lang || "") && /female/i.test(v.name || "")) ||
      voices.find((v) => /english/i.test(v.lang || "")) ||
      null;

    if (preferred) {
      msg.voice = preferred;
    }

    synth.speak(msg);
  } catch {}
}
function createWhatsappJob(type = "", draft = null) {
  return {
    id: uid(),
    type: String(type || "").trim(),
    createdAt: Date.now(),
    status: "pending",
    sentAt: "",
    failedAt: "",
    failedReason: "",
    sentByRole: "",
    draft:
      draft && typeof draft === "object"
        ? JSON.parse(JSON.stringify(draft))
        : null,
  };
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

  const [adminRole, setAdminRole] = useState(() => {
  try {
    return sessionStorage.getItem("qclub_admin_role") || "" || "";
  } catch {
    return "";
  }
});

const admin = adminRole === "main";
const staffAdmin = adminRole === "staff";
const committeeAdmin = adminRole === "committee";
const latestDataRef = useRef(data);
const cloudWriteLockedRef = useRef(isCloudEnabled());
const autoPrintedFoodIdsRef = useRef({});
const seenFoodOrderIdsRef = useRef(new Set());
const autoSentWhatsappJobIdsRef = useRef({});
const navigate = useNavigate();
const location = useLocation();
const scorerOnlyPaths = [
  "/rummy-snooker",
  "/rummy-snooker-table-1",
  "/rummy-snooker-table-2",
  "/rummy-snooker-table-3",
  "/rummy-snooker-table-1-display",
  "/rummy-snooker-table-2-display",
  "/rummy-snooker-table-3-display",
  "/qchase-records",
  "/kitty",
  "/kitty-table-1",
  "/kitty-table-2",
  "/kitty-table-3",
  "/kitty-table-1-display",
  "/kitty-table-2-display",
  "/kitty-table-3-display",
  "/kitty-records",
    "/jobs",
    "/food-print-bridge",
];

const isScorerOnlyPage = scorerOnlyPaths.includes(location.pathname);

const [showInstallHelp, setShowInstallHelp] = useState(false);
useEffect(() => {
  checkQClubAppVersion();

  const onFocus = () => checkQClubAppVersion();

  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") {
      checkQClubAppVersion();
    }
  };

  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    window.removeEventListener("focus", onFocus);
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}, []);

useEffect(() => {
  const openInstallHelp = () => setShowInstallHelp(true);

  window.addEventListener("qclub-install-help", openInstallHelp);

  return () => {
    window.removeEventListener("qclub-install-help", openInstallHelp);
  };
}, []);
  useEffect(() => {
  try {
    if (adminRole) {
      sessionStorage.setItem("qclub_admin_role", adminRole);
      localStorage.removeItem("qclub_admin_role");
    } else {
      sessionStorage.removeItem("qclub_admin_role");
      localStorage.removeItem("qclub_admin_role");
    }
  } catch {}
}, [adminRole]);

useEffect(() => {
  latestDataRef.current = data;
}, [data]);
useEffect(() => {
  if (isCloudEnabled() && (!hasHydratedFromCloud || cloudWriteLockedRef.current)) return;

  const policyClub = defaultData().club;
  const currentClub = data?.club || {};

  const nextContact = {
    ...(policyClub.contact || {}),
    ...(currentClub.contact || {}),
  };

  const needsPolicySync =
    localStorage.getItem(POLICY_SYNC_KEY) !== POLICY_SYNC_VERSION ||
    !String(currentClub.contactContent || "").trim() ||
    !String(currentClub.termsContent || "").trim() ||
    !String(currentClub.refundContent || "").trim() ||
    !String(currentClub.privacyContent || "").trim();

  if (!needsPolicySync) return;

  const next = {
    ...data,
    club: {
      ...currentClub,
      contact: nextContact,
      contactContent: String(currentClub.contactContent || "").trim() || policyClub.contactContent,
      termsContent: String(currentClub.termsContent || "").trim() || policyClub.termsContent,
      refundContent: String(currentClub.refundContent || "").trim() || policyClub.refundContent,
      privacyContent: String(currentClub.privacyContent || "").trim() || policyClub.privacyContent,
    },
  };

  try {
    localStorage.setItem(POLICY_SYNC_KEY, POLICY_SYNC_VERSION);
  } catch {}

  commit(next);
}, [hasHydratedFromCloud, data]);
useEffect(() => {
  if (!hasHydratedFromCloud) return;
  if (isCloudEnabled() && cloudWriteLockedRef.current) return;

  const persisted = data.whatsappPersistence || {};
  const persistedSettings = persisted.settings || {};
  const persistedMode =
    persisted.mode === "disabled"
      ? "disabled"
      : persisted.mode === "live"
      ? "live"
      : "draft_only";
  const persistedOptOuts = Array.isArray(persisted.optOuts) ? persisted.optOuts : [];

  const hasPersistedSettings =
    !!persistedSettings.authKey ||
    !!persistedSettings.senderNumber ||
    !!persistedSettings.senderLabel ||
    !!persistedSettings.qshopSuccessTemplate ||
    !!persistedSettings.qshopFailedTemplate ||
    !!persistedSettings.bookingSuccessTemplate ||
    !!persistedSettings.bookingFailedTemplate ||
    !!persistedSettings.membershipSuccessTemplate ||
    !!persistedSettings.membershipFailedTemplate ||
    !!persistedSettings.otpTemplate ||
    !!persistedSettings.tournamentSuccessTemplate ||
    !!persistedSettings.tournamentFailedTemplate ||
    !!persistedSettings.foodSuccessTemplate ||
    !!persistedSettings.foodFailedTemplate ||
    persistedMode !== "draft_only" ||
    persistedOptOuts.length > 0;

  if (hasPersistedSettings) {
    try {
      localStorage.setItem(
        "qclub_whatsapp_settings",
        JSON.stringify({
          provider: String(persistedSettings.provider || "msg91").trim() || "msg91",
          authKey: String(persistedSettings.authKey || "").trim(),
          senderNumber: String(persistedSettings.senderNumber || "").trim(),
          senderLabel: String(persistedSettings.senderLabel || "").trim(),
          qshopSuccessTemplate: String(persistedSettings.qshopSuccessTemplate || "").trim(),
          qshopFailedTemplate: String(persistedSettings.qshopFailedTemplate || "").trim(),
          bookingSuccessTemplate: String(persistedSettings.bookingSuccessTemplate || "").trim(),
          bookingFailedTemplate: String(persistedSettings.bookingFailedTemplate || "").trim(),
          membershipSuccessTemplate: String(persistedSettings.membershipSuccessTemplate || "").trim(),
          membershipFailedTemplate: String(persistedSettings.membershipFailedTemplate || "").trim(),
          otpTemplate: String(persistedSettings.otpTemplate || "").trim(),
          tournamentSuccessTemplate: String(persistedSettings.tournamentSuccessTemplate || "").trim(),
          tournamentFailedTemplate: String(persistedSettings.tournamentFailedTemplate || "").trim(),
          foodSuccessTemplate: String(persistedSettings.foodSuccessTemplate || "").trim(),
          foodFailedTemplate: String(persistedSettings.foodFailedTemplate || "").trim(),
        jobApplicationReceivedTemplate: String(persistedSettings.jobApplicationReceivedTemplate || "").trim(),
        })
      );

      localStorage.setItem("qclub_whatsapp_mode", persistedMode);
      localStorage.setItem(
        "qclub_whatsapp_opt_outs",
        JSON.stringify(persistedOptOuts)
      );
    } catch {}

    return;
  }

  const localSettings = getWhatsappSettings();
  const localMode = getWhatsappMode();
  const localOptOuts = getWhatsappOptOuts();

  const hasLocalSettings =
    !!localSettings.authKey ||
    !!localSettings.senderNumber ||
    !!localSettings.senderLabel ||
    !!localSettings.qshopSuccessTemplate ||
    !!localSettings.qshopFailedTemplate ||
    !!localSettings.bookingSuccessTemplate ||
    !!localSettings.bookingFailedTemplate ||
    !!localSettings.membershipSuccessTemplate ||
    !!localSettings.membershipFailedTemplate ||
    !!localSettings.otpTemplate ||
    !!localSettings.tournamentSuccessTemplate ||
    !!localSettings.tournamentFailedTemplate ||
    !!localSettings.foodSuccessTemplate ||
    !!localSettings.foodFailedTemplate ||
    !!localSettings.jobApplicationReceivedTemplate ||
    localMode !== "draft_only" ||
    localOptOuts.length > 0;

  if (!hasLocalSettings) return;

  commit({
    ...data,
    whatsappPersistence: {
      settings: {
        provider: String(localSettings.provider || "msg91").trim() || "msg91",
        authKey: String(localSettings.authKey || "").trim(),
        senderNumber: String(localSettings.senderNumber || "").trim(),
        senderLabel: String(localSettings.senderLabel || "").trim(),
        qshopSuccessTemplate: String(localSettings.qshopSuccessTemplate || "").trim(),
        qshopFailedTemplate: String(localSettings.qshopFailedTemplate || "").trim(),
        bookingSuccessTemplate: String(localSettings.bookingSuccessTemplate || "").trim(),
        bookingFailedTemplate: String(localSettings.bookingFailedTemplate || "").trim(),
        membershipSuccessTemplate: String(localSettings.membershipSuccessTemplate || "").trim(),
        membershipFailedTemplate: String(localSettings.membershipFailedTemplate || "").trim(),
        otpTemplate: String(localSettings.otpTemplate || "").trim(),
        tournamentSuccessTemplate: String(localSettings.tournamentSuccessTemplate || "").trim(),
        tournamentFailedTemplate: String(localSettings.tournamentFailedTemplate || "").trim(),
        foodSuccessTemplate: String(localSettings.foodSuccessTemplate || "").trim(),
        foodFailedTemplate: String(localSettings.foodFailedTemplate || "").trim(),
      
        jobApplicationReceivedTemplate: String(localSettings.jobApplicationReceivedTemplate || "").trim(),
},
      mode: localMode,
      optOuts: localOptOuts,
    },
  });
}, [data.whatsappPersistence, hasHydratedFromCloud]);
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
    async function startPayment(
  amount,
  customerPhone = "9999999999",
  customerName = "",
  orderTags = {}
) {
  try {
    const cleanOrderTags =
      orderTags && typeof orderTags === "object" && !Array.isArray(orderTags)
        ? orderTags
        : {};

    const res = await fetch("/api/create-order", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount,
        customer_phone: customerPhone,
        customer_name: customerName,
        order_tags: cleanOrderTags,
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

  const previousLocal = latestDataRef.current || data || {};

    if (isWholeWebappCatastrophicDrop(previousLocal, safeNext)) {
    console.error("Q Club safety guard blocked dangerous whole-webapp local save", {
      before: getQclubStateHealth(previousLocal),
      after: getQclubStateHealth(safeNext),
    });

    setCloudStatus("error");

    alert(
      "Q Club safety guard blocked a dangerous full-app overwrite before saving. " +
      "Your current device tried to replace rich club data with weak/default data. " +
      "Please refresh once and check Admin before saving again."
    );

    return;
  }

  if (isCloudEnabled() && cloudWriteLockedRef.current) {
    console.error("Q Club safety guard blocked save because cloud has not safely hydrated yet.");

    setCloudStatus("error");

    alert(
      "Q Club cloud is not safely loaded yet. Saving is blocked to protect the live website. " +
      "Please refresh once and wait for cloud sync before making Admin changes."
    );

    return;
  }

  setData(safeNext);
  latestDataRef.current = safeNext;
  saveData(safeNext);

  try {
    localStorage.setItem("qclub_state_backup", JSON.stringify(safeNext));
  } catch (e) {}

  if (!isCloudEnabled()) return;
  if (!hasHydratedFromCloud) return;

  setCloudStatus("syncing");

  const cloudSafe = stripHeavyMediaForCloud(safeNext);
  const previousCloudSafe = stripHeavyMediaForCloud(previousLocal);

  if (isWholeWebappCatastrophicDrop(previousCloudSafe, cloudSafe)) {
    console.error("Q Club safety guard blocked dangerous whole-webapp cloud overwrite", {
      before: getQclubStateHealth(previousCloudSafe),
      after: getQclubStateHealth(cloudSafe),
    });

    setCloudStatus("error");

    alert(
      "Q Club safety guard blocked a dangerous full-app cloud overwrite. " +
      "Saved cloud data was protected. Please refresh once and check Admin before saving again."
    );

    return;
  }

  writeState(cloudSafe)
    .then(() => {
      setCloudStatus("synced");
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

function markFoodOrderAsPrinted(orderId, extra = {}) {
  if (!orderId) return;

  const current = latestDataRef.current || {};
  const currentOrders = Array.isArray(current.foodOrders) ? current.foodOrders : [];
  const target = currentOrders.find((order) => order.id === orderId);

  if (!target) return;
  if (target?.printMeta?.printedAt) return;

  commit({
    ...current,
    foodOrders: currentOrders.map((order) =>
      order.id === orderId
        ? {
            ...order,
            printMeta: {
              ...(order.printMeta || {}),
              status: "printed",
              printedAt: extra.printedAt || new Date().toISOString(),
              printedByRole: extra.printedByRole || (admin ? "main" : "staff"),
            },
          }
        : order
    ),
  });
}
function markFoodOrderAsPrinting(orderId, extra = {}) {
  if (!orderId) return;

  const current = latestDataRef.current || {};
  const currentOrders = Array.isArray(current.foodOrders) ? current.foodOrders : [];
  const target = currentOrders.find((order) => order.id === orderId);

  if (!target) return;
  if (target?.printMeta?.printedAt) return;
  if (target?.printMeta?.status === "printing") return;

  commit({
    ...current,
    foodOrders: currentOrders.map((order) =>
      order.id === orderId
        ? {
            ...order,
            printMeta: {
              ...(order.printMeta || {}),
              status: "printing",
              printingAt: extra.printingAt || new Date().toISOString(),
              printingByRole: extra.printingByRole || (admin ? "main" : "staff"),
            },
          }
        : order
    ),
  });
}
function markSpeakerAlertPlayed(alertId) {
  if (!alertId) return;

  const current = latestDataRef.current || {};
  const currentAlerts = Array.isArray(current.speakerAlerts) ? current.speakerAlerts : [];
  const target = currentAlerts.find((x) => x.id === alertId);

  if (!target) return;
  if (target.playedAt) return;

  commit({
    ...current,
    speakerAlerts: currentAlerts.map((x) =>
      x.id === alertId
        ? {
            ...x,
            playedAt: new Date().toISOString(),
            playedByRole: admin ? "main" : "staff",
          }
        : x
    ),
  });
}
function markWhatsappJobStatus(jobId, extra = {}) {
  if (!jobId) return;

  const current = latestDataRef.current || {};
  const currentJobs = Array.isArray(current.whatsappJobs) ? current.whatsappJobs : [];
  const target = currentJobs.find((job) => job.id === jobId);

  if (!target) return;

  commit({
    ...current,
    whatsappJobs: currentJobs.map((job) =>
      job.id === jobId
        ? {
            ...job,
            ...extra,
          }
        : job
    ),
  });
}
function markWhatsappJobAsSending(jobId, extra = {}) {
  if (!jobId) return;

  const current = latestDataRef.current || {};
  const currentJobs = Array.isArray(current.whatsappJobs) ? current.whatsappJobs : [];
  const target = currentJobs.find((job) => job.id === jobId);

  if (!target) return;
  if (target?.sentAt) return;
  if (target?.failedAt) return;
  if (target?.status === "sending") return;

  commit({
    ...current,
    whatsappJobs: currentJobs.map((job) =>
      job.id === jobId
        ? {
            ...job,
            status: "sending",
            sendingAt: extra.sendingAt || new Date().toISOString(),
            sentByRole: extra.sentByRole || (admin ? "main" : "staff"),
          }
        : job
    ),
  });
}
function shouldAutoPrintFoodOrders() {
  return true;
}
  function toggleAdmin() {
  if (adminRole) {
    setAdminRole("");
    try {
      sessionStorage.removeItem("qclub_admin_role");
localStorage.removeItem("qclub_admin_role");
    } catch {}
    return;
  }

  const pin = prompt("Enter Access PIN");
  if (!pin) return;

  if (pin === data.admin?.mainPin) {
    setAdminRole("main");
    try {
      sessionStorage.setItem("qclub_admin_role", "main");
    } catch {}
    return;
  }

  if (pin === data.admin?.staffPin) {
    setAdminRole("staff");
    try {
      sessionStorage.setItem("qclub_admin_role", "staff");
    } catch {}
    return;
  }

  if (pin === data.admin?.committeePin) {
    setAdminRole("committee");
    try {
      sessionStorage.setItem("qclub_admin_role", "committee");
    } catch {}
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

  if (mode === "1") {
    const current = data.admin?.mainPin || "";
    const oldPin = prompt("Enter current Main Admin PIN");
    if (oldPin === null) return;

    if (oldPin !== current) {
      alert("Current Main Admin PIN is incorrect");
      return;
    }
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
      mainPin: mode === "1" ? nextPin : data.admin?.mainPin || "1234",
      staffPin: mode === "2" ? nextPin : data.admin?.staffPin || "5678",
      committeePin: mode === "3" ? nextPin : data.admin?.committeePin || "9012",
    },
  });

  alert(
    mode === "1"
      ? "Main Admin PIN updated"
      : mode === "2"
      ? "Staff PIN reset successfully"
      : "Committee PIN reset successfully"
  );
}

  function resetAll() {
    if (!admin) return;
    if (!confirm("Reset ALL Q CLUB data to default?")) return;
    const d = defaultData();
commit(d);
setAdminRole("");
try {
  sessionStorage.removeItem("qclub_admin_role");
localStorage.removeItem("qclub_admin_role");
} catch {}
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
    const isFoodPrintBridgePage = location.pathname === "/food-print-bridge";

    if (!isFoodPrintBridgePage) return;
    if (!(admin || staffAdmin)) return;
    if (!shouldAutoPrintFoodOrders()) return;

    const pendingFoodOrder = (data.foodOrders || []).find((order) => {
      if (!order?.id) return false;
      if (order?.printMeta?.printedAt) return false;
      if (order?.printMeta?.status === "printing") return false;
      if (order?.printMeta?.status === "printed") return false;
      if (autoPrintedFoodIdsRef.current[order.id]) return false;
      return true;
    });

    if (!pendingFoodOrder) return;

    autoPrintedFoodIdsRef.current[pendingFoodOrder.id] = true;

    markFoodOrderAsPrinting(pendingFoodOrder.id, {
      printingAt: new Date().toISOString(),
      printingByRole: admin ? "main" : "staff",
    });

    const receipt = buildFoodReceiptRecord(pendingFoodOrder, data.club || {});
    const receiptJson = JSON.stringify(receipt);
    const receiptPayload = btoa(unescape(encodeURIComponent(receiptJson)))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");

    const receiptUrl = `${window.location.origin}/api/food-receipt-html?payload=${receiptPayload}`;
    const printAppLink =
      `print://escpos.org/escpos/bt/print?srcTp=uri&srcObj=html&numCopies=1&src='${encodeURIComponent(receiptUrl)}'`;

    setTimeout(() => {
      try {
        window.location.href = printAppLink;
      } catch {}
    }, 3500);

    setTimeout(() => {
      markFoodOrderAsPrinted(pendingFoodOrder.id, {
        printedAt: new Date().toISOString(),
        printedByRole: admin ? "main" : "staff",
      });
    }, 12000);
  }, [admin, staffAdmin, location.pathname, data.foodOrders, data.club]);
  useEffect(() => {
  if (!(admin || staffAdmin)) return;

  const pendingAlert = (data.speakerAlerts || []).find((x) => !x?.playedAt && x?.text);

  if (!pendingAlert) return;

  try {
    const synth = window.speechSynthesis;
    const message = String(pendingAlert.text || "").trim();
    if (!synth || !message) return;

    synth.cancel();

    const utterance = new SpeechSynthesisUtterance(message);
    utterance.volume = 1;
    utterance.rate = 0.95;
    utterance.pitch = 1;

    const voices = synth.getVoices();
    const preferred =
      voices.find((v) => /en/i.test(v.lang || "") && /female/i.test(v.name || "")) ||
      voices.find((v) => /en/i.test(v.lang || "")) ||
      null;

    if (preferred) utterance.voice = preferred;

    let finished = false;

    const done = () => {
      if (finished) return;
      finished = true;
      markSpeakerAlertPlayed(pendingAlert.id);
    };

    utterance.onend = done;
    utterance.onerror = done;

    synth.speak(utterance);

    setTimeout(done, 5000);
  } catch {}
}, [admin, staffAdmin, data.speakerAlerts]);
useEffect(() => {
  if (!(admin || staffAdmin)) return;

  const pendingJob = (data.whatsappJobs || []).find((job) => {
  if (!job?.id) return false;
  if (job?.sentAt) return false;
  if (job?.failedAt) return false;
  if (job?.status === "sending") return false;
  if (!job?.draft?.phone) return false;
  if (autoSentWhatsappJobIdsRef.current[job.id]) return false;

  const jobType = String(job?.type || job?.draft?.label || "").trim();
  const orderNo = String(
    job?.draft?.orderNo ||
      job?.draft?.order_no ||
      job?.draft?.templateParams?.[1] ||
      ""
  ).trim();

  if (jobType === "food_success" && orderNo) {
    const duplicateAlreadyHandled = (data.whatsappJobs || []).some((otherJob) => {
      if (!otherJob?.id || otherJob.id === job.id) return false;

      const otherType = String(otherJob?.type || otherJob?.draft?.label || "").trim();
      if (otherType !== "food_success") return false;

      const otherOrderNo = String(
        otherJob?.draft?.orderNo ||
          otherJob?.draft?.order_no ||
          otherJob?.draft?.templateParams?.[1] ||
          ""
      ).trim();

      if (otherOrderNo !== orderNo) return false;

      return Boolean(otherJob?.sentAt) || otherJob?.status === "sending";
    });

    if (duplicateAlreadyHandled) return false;
  }

  return true;
});

    if (!pendingJob) return;

  const mode = getWhatsappMode();
  if (mode === "disabled") return;

  const whatsappSendLockKey = `qclub_whatsapp_send_lock_${pendingJob.id}`;
  const whatsappSendLockOwner = `${Date.now()}_${Math.random().toString(36).slice(2)}`;

  try {
    const existingLock = JSON.parse(localStorage.getItem(whatsappSendLockKey) || "null");

    if (
      existingLock?.owner &&
      Number(existingLock?.expiresAt || 0) > Date.now()
    ) {
      return;
    }

    localStorage.setItem(
      whatsappSendLockKey,
      JSON.stringify({
        owner: whatsappSendLockOwner,
        expiresAt: Date.now() + 120000,
      })
    );

    const savedLock = JSON.parse(localStorage.getItem(whatsappSendLockKey) || "null");

    if (savedLock?.owner !== whatsappSendLockOwner) {
      return;
    }
  } catch {
    return;
  }

  autoSentWhatsappJobIdsRef.current[pendingJob.id] = true;

  markWhatsappJobAsSending(pendingJob.id, {
    sendingAt: new Date().toISOString(),
    sentByRole: admin ? "main" : "staff",
  });

  const settings = getWhatsappSettings();
  const baseDraft = pendingJob?.draft || {};
  const resolvedLabel = String(baseDraft?.label || pendingJob?.type || "").trim();
  const mappedTemplate = getWhatsappTemplateForLabel(resolvedLabel, settings);

  const finalDraft = {
    ...baseDraft,
    label: resolvedLabel,
    templateName: String(baseDraft?.templateName || mappedTemplate || "").trim(),
    provider: settings.provider || "msg91",
    senderNumber: settings.senderNumber || "",
    senderLabel: settings.senderLabel || "",
    msg91Payload:
      (settings.provider || "msg91") === "msg91"
        ? buildMsg91WhatsappPayload(
            {
              ...baseDraft,
              label: resolvedLabel,
              templateName: String(baseDraft?.templateName || mappedTemplate || "").trim(),
              senderNumber: settings.senderNumber || "",
              senderLabel: settings.senderLabel || "",
            },
            settings
          )
        : null,
  };

  storeLatestWhatsappDraft(finalDraft);

  let cancelled = false;

  (async () => {
    if (mode === "draft_only") {
      if (cancelled) return;

      markWhatsappJobStatus(pendingJob.id, {
        status: "draft_saved",
        sentAt: new Date().toISOString(),
        sentByRole: admin ? "main" : "staff",
        failedAt: "",
        failedReason: "",
      });

      return;
    }

    const result = await sendMsg91WhatsappMessage(finalDraft, settings);

    if (cancelled) return;

    localStorage.setItem(
      "qclub_last_whatsapp_send_result",
      JSON.stringify({
        ok: !!result?.ok,
        error: result?.error || "",
        sentAt: new Date().toISOString(),
        label: finalDraft.label || "",
        phone: finalDraft.phone || "",
        templateName: finalDraft.templateName || "",
        response: result?.response || null,
      })
    );

    if (result?.ok) {
      markWhatsappJobStatus(pendingJob.id, {
        status: "sent",
        sentAt: new Date().toISOString(),
        sentByRole: admin ? "main" : "staff",
        failedAt: "",
        failedReason: "",
      });
      return;
    }

    delete autoSentWhatsappJobIdsRef.current[pendingJob.id];

    markWhatsappJobStatus(pendingJob.id, {
      status: "failed",
      failedAt: new Date().toISOString(),
      failedReason: result?.error || "Unknown WhatsApp send error.",
    });
  })();

  return () => {
    cancelled = true;
  };
}, [admin, staffAdmin, data.whatsappJobs]);
useEffect(() => {
    if (!isCloudEnabled()) {
    cloudWriteLockedRef.current = false;

    const localOnlyState = hydrateLocalMediaIntoState(
      syncMembersIntoPlayers(mergeWithDefaults(loadData()))
    );

    setData(localOnlyState);
    latestDataRef.current = localOnlyState;
    setHasHydratedFromCloud(true);
    return;
  }

  setCloudStatus("syncing");

   const fallbackTimer = setTimeout(() => {
    console.warn("Q Club cloud hydration delayed. Showing local data but keeping Admin saves locked.");

    const localFallbackState = hydrateLocalMediaIntoState(
      syncMembersIntoPlayers(mergeWithDefaults(loadData()))
    );

    cloudWriteLockedRef.current = true;
    setData(localFallbackState);
    latestDataRef.current = localFallbackState;
    setHasHydratedFromCloud(true);
    setCloudStatus("error");
  }, 8000);

  const unsubscribe = subscribeState((remoteState) => {
    if (!remoteState || typeof remoteState !== "object") return;

    clearTimeout(fallbackTimer);

    const localCurrent = latestDataRef.current || loadData();
    const mergedRemote = mergeWithDefaults(remoteState);
    const protectedState = mergeHydratedOperationalState(localCurrent, mergedRemote);
    const merged = hydrateLocalMediaIntoState(protectedState);

    if (isWholeWebappCatastrophicDrop(localCurrent, merged)) {
      console.error("Q Club safety guard blocked dangerous remote hydration", {
        before: getQclubStateHealth(localCurrent),
        after: getQclubStateHealth(merged),
      });

      cloudWriteLockedRef.current = true;
      setHasHydratedFromCloud(true);
      setCloudStatus("error");

      alert(
        "Q Club safety guard blocked a dangerous cloud state from replacing this browser's data. " +
        "Please check Supabase qclub_state before making Admin changes."
      );

      return;
    }

    cloudWriteLockedRef.current = false;

    setData(merged);
    latestDataRef.current = merged;
    saveData(merged);

    try {
      localStorage.setItem("qclub_state_backup", JSON.stringify(merged));
    } catch {}

    setHasHydratedFromCloud(true);
    setCloudStatus("synced");
  });

  return () => {
    clearTimeout(fallbackTimer);
    if (typeof unsubscribe === "function") unsubscribe();
  };
}, []);
useEffect(() => {
  function syncFromLocalStorage() {
    try {
      const fresh = hydrateLocalMediaIntoState(
  syncMembersIntoPlayers(mergeWithDefaults(loadData()))
);

const current = latestDataRef.current || data || {};

if (isWholeWebappCatastrophicDrop(current, fresh)) {
  console.error("Q Club safety guard blocked dangerous localStorage refresh", {
    before: getQclubStateHealth(current),
    after: getQclubStateHealth(fresh),
  });
  return;
}

setData(fresh);
latestDataRef.current = fresh;
    } catch (e) {
      console.warn("Local storage sync failed:", e);
    }
  }

  function onStorage(e) {
    if (!e) return;

    if (
      e.key === LS_KEY ||
      e.key === "qclub_v3_data" ||
      e.key === "qclub_v2_data" ||
      e.key === "qclub_state_backup"
    ) {
      syncFromLocalStorage();
    }
  }

  function onVisibilityChange() {
    if (document.visibilityState === "visible") {
      syncFromLocalStorage();
    }
  }

  window.addEventListener("storage", onStorage);
  document.addEventListener("visibilitychange", onVisibilityChange);

  return () => {
    window.removeEventListener("storage", onStorage);
    document.removeEventListener("visibilitychange", onVisibilityChange);
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
     {!isScorerOnlyPage ? (
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
) : null}

      <Routes>
        <Route path="/" element={<Home data={data} admin={admin} commit={commit} activeTournament={activeTournament} />} />
        <Route path="/members" element={<MembersPage data={data} admin={admin} commit={commit} />} />
        <Route path="/member-registry" element={<MemberRegistryPage data={data} admin={admin} commit={commit} />} />
        <Route path="/jobs" element={<JobApplicationPage data={data} commit={commit} />} />
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
        <Route path="/air-hockey" element={<AirHockeyPage />} />
                <Route path="/foosball" element={<FoosballPage />} />
                        <Route path="/massage-chair" element={<MassageChairPage />} />
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
<Route
  path="/shop"
  element={
    <QShopPage
      data={data}
      admin={admin}
      commit={commit}
      startPayment={startPayment}
    />
  }
/>
<Route
  path="/shop/successful-order-receipts"
  element={
    <ShopSuccessfulOrderReceipts
      data={data}
      admin={admin}
      staffAdmin={staffAdmin}
      commit={commit}
    />
  }
/>
        <Route path="/photos" element={<Photos data={data} admin={admin} commit={commit} />} />
        <Route path="/players" element={<Players data={data} admin={admin} commit={commit} activeTournament={activeTournament} />} />
        <Route
  path="/handicap"
  element={
    <StaticPage title={data.club?.handicapTitle || "Handicap & Classification"}>
      <HandicapContent
  data={data}
  admin={admin}
  commit={commit}
  defaultData={defaultData}
/>
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
      staffAdmin={staffAdmin}
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
<Route
  path="/staff-walkins"
  element={
    <StaffWalkinBookings
      data={data}
      admin={admin}
      staffAdmin={staffAdmin}
      commit={commit}
    />
  }
/>
<Route
  path="/inventory"
  element={
    <InventoryMaintenance
      data={data}
      admin={admin}
      staffAdmin={staffAdmin}
      commit={commit}
    />
  }
/>
        <Route path="/halloffame" element={<HallOfFame data={data} admin={admin} commit={commit} />} />
        <Route
  path="/tv"
  element={
    <Suspense
      fallback={
        <div className="container" style={{ paddingTop: 24 }}>
          <div className="card">
            <div className="muted">Loading TV mode...</div>
          </div>
        </div>
      }
    >
      <TVMode
        data={data}
        activeTournament={activeTournament}
        players={data.players || []}
        admin={admin}
        staffAdmin={staffAdmin}
        commit={commit}
      />
    </Suspense>
  }
/>
        <Route
  path="/review-panel"
  element={
    <Suspense
      fallback={
        <div className="container" style={{ paddingTop: 24 }}>
          <div className="card">
            <div className="muted">Loading review panel...</div>
          </div>
        </div>
      }
    >
      <ReviewPanel
        data={data}
        admin={admin}
        staffAdmin={staffAdmin}
        committeeAdmin={committeeAdmin}
        commit={commit}
      />
    </Suspense>
  }
/>
<Route
  path="/match-ledger"
  element={
    <Suspense
      fallback={
        <div className="container" style={{ paddingTop: 24 }}>
          <div className="card">
            <div className="muted">Loading match ledger...</div>
          </div>
        </div>
      }
    >
      <MatchLedgerPage
        data={data}
        admin={admin}
        staffAdmin={staffAdmin}
        committeeAdmin={committeeAdmin}
        commit={commit}
      />
    </Suspense>
  }
/>
<Route
  path="/admin-panel"
  element={
    <Suspense
      fallback={
        <div className="container" style={{ paddingTop: 24 }}>
          <div className="card">
            <div className="muted">Loading admin panel...</div>
          </div>
        </div>
      }
    >
      <AdminPanel
        data={data}
        admin={admin}
        commit={commit}
        activeTournament={activeTournament}
      />
    </Suspense>
  }
/>
        <Route path="/about" element={<StaticPage title={data.club?.aboutTitle || "About The Q Club"}><AboutContent
  data={data}
  admin={admin}
  commit={commit}
  defaultData={defaultData}
/></StaticPage>} />
        <Route path="/contact" element={<StaticPage title={data.club?.contactTitle || "Contact Us"}><ContactContent
  data={data}
  admin={admin}
  commit={commit}
  defaultData={defaultData}
/></StaticPage>} />
        <Route path="/terms" element={<StaticPage title={data.club?.termsTitle || "Terms & Conditions"}><TermsContent
  data={data}
  admin={admin}
  commit={commit}
  defaultData={defaultData}
/></StaticPage>} />
        <Route path="/refund" element={<StaticPage title={data.club?.refundTitle || "Refund Policy"}><RefundContent
  data={data}
  admin={admin}
  commit={commit}
  defaultData={defaultData}
/></StaticPage>} />
        <Route path="/privacy" element={<StaticPage title={data.club?.privacyTitle || "Privacy Policy"}><PrivacyContent
  data={data}
  admin={admin}
  commit={commit}
  defaultData={defaultData}
/></StaticPage>} />
                <Route path="/air-hockey-info" element={<StaticPage title={data.club?.airHockeyInfoTitle || "Air Hockey at The Q Club"}><AirHockeyInfoContent
  data={data}
  admin={admin}
  commit={commit}
  defaultData={defaultData}
/></StaticPage>} />
                        <Route path="/foosball-info" element={<StaticPage title={data.club?.foosballInfoTitle || "Foosball at The Q Club"}><FoosballInfoContent
  data={data}
  admin={admin}
  commit={commit}
  defaultData={defaultData}
/></StaticPage>} />
                                <Route path="/massage-chair-info" element={<StaticPage title={data.club?.massageChairInfoTitle || "Massage Chair at The Q Club"}><MassageChairInfoContent
  data={data}
  admin={admin}
  commit={commit}
  defaultData={defaultData}
/></StaticPage>} />
        <Route path="/tournament-legal" element={<StaticPage title={data.club?.tournamentDisclaimerTitle || "Tournament Legal Notice"}><TournamentLegalContent
  data={data}
  admin={admin}
  commit={commit}
  defaultData={defaultData}
/></StaticPage>} />
                <Route
  path="/admin/orders"
  element={<FoodOrdersAdmin data={data} admin={admin} staffAdmin={staffAdmin} commit={commit} />}
/>
<Route
  path="/food-print-bridge"
  element={<FoodPrintBridge data={data} admin={admin} staffAdmin={staffAdmin} commit={commit} />}
/>
<Route
  path="/admin/orders-archive"
  element={<FoodOrdersArchive data={data} admin={admin} staffAdmin={staffAdmin} commit={commit} />}
/>
<Route
  path="/rummy-snooker"
  element={
    <RummySnookerPage
      data={data}
      admin={admin}
      staffAdmin={staffAdmin}
      commit={commit}
      tableKey="table1"
      tableLabel="Snooker Table 1"
    />
  }
/>

<Route
  path="/rummy-snooker-table-1"
  element={
    <RummySnookerPage
      data={data}
      admin={admin}
      staffAdmin={staffAdmin}
      commit={commit}
      tableKey="table1"
      tableLabel="Snooker Table 1"
    />
  }
/>

<Route
  path="/rummy-snooker-table-2"
  element={
    <RummySnookerPage
      data={data}
      admin={admin}
      staffAdmin={staffAdmin}
      commit={commit}
      tableKey="table2"
      tableLabel="Snooker Table 2"
    />
  }
/>

<Route
  path="/rummy-snooker-table-3"
  element={
    <RummySnookerPage
      data={data}
      admin={admin}
      staffAdmin={staffAdmin}
      commit={commit}
      tableKey="table3"
      tableLabel="Mini / Table 3"
    />
  }
/>

<Route
  path="/rummy-snooker-table-1-display"
  element={<RummySnookerDisplayPage tableKey="table1" tableLabel="Snooker Table 1" />}
/>

<Route
  path="/rummy-snooker-table-2-display"
  element={<RummySnookerDisplayPage tableKey="table2" tableLabel="Snooker Table 2" />}
/>

<Route
  path="/rummy-snooker-table-3-display"
  element={<RummySnookerDisplayPage tableKey="table3" tableLabel="Mini / Table 3" />}
/>
<Route
  path="/qchase-records"
  element={
    <QChaseRecordsPage
      admin={admin}
      staffAdmin={staffAdmin}
    />
  }
/>
<Route
  path="/qchase-monthly"
  element={
    <Suspense
      fallback={
        <div className="container" style={{ paddingTop: 24 }}>
          <div className="card">
            <div className="muted">Loading Q Chase monthly reports.</div>
          </div>
        </div>
      }
    >
      <QChaseMonthlyReportPage
        admin={admin}
        staffAdmin={staffAdmin}
      />
    </Suspense>
  }
/>
<Route
  path="/kitty"
  element={
    <KittyPage
      data={data}
      admin={admin}
      staffAdmin={staffAdmin}
      commit={commit}
      tableKey="table1"
      tableLabel="Snooker Table 1"
    />
  }
/>

<Route
  path="/kitty-table-1"
  element={
    <KittyPage
      data={data}
      admin={admin}
      staffAdmin={staffAdmin}
      commit={commit}
      tableKey="table1"
      tableLabel="Snooker Table 1"
    />
  }
/>

<Route
  path="/kitty-table-2"
  element={
    <KittyPage
      data={data}
      admin={admin}
      staffAdmin={staffAdmin}
      commit={commit}
      tableKey="table2"
      tableLabel="Snooker Table 2"
    />
  }
/>

<Route
  path="/kitty-table-3"
  element={
    <KittyPage
      data={data}
      admin={admin}
      staffAdmin={staffAdmin}
      commit={commit}
      tableKey="table3"
      tableLabel="Mini / Table 3"
    />
  }
/>

<Route
  path="/kitty-table-1-display"
  element={<KittyDisplayPage tableKey="table1" tableLabel="Snooker Table 1" />}
/>

<Route
  path="/kitty-table-2-display"
  element={<KittyDisplayPage tableKey="table2" tableLabel="Snooker Table 2" />}
/>

<Route
  path="/kitty-table-3-display"
  element={<KittyDisplayPage tableKey="table3" tableLabel="Mini / Table 3" />}
/>
<Route
  path="/kitty-records"
  element={
    <KittyRecordsPage
      admin={admin}
      staffAdmin={staffAdmin}
    />
  }
/>
        <Route
  path="/kitty-monthly"
  element={
    <Suspense
      fallback={
        <div className="container" style={{ paddingTop: 24 }}>
          <div className="card">
            <div className="muted">Loading Kitty monthly reports.</div>
          </div>
        </div>
      }
    >
      <KittyMonthlyReportPage
        admin={admin}
        staffAdmin={staffAdmin}
      />
    </Suspense>
  }
/>
                <Route path="/payment-status" element={<PaymentStatus data={data} commit={commit} />} />
        <Route path="*" element={<NotFound />} />
      </Routes>

      {showInstallHelp ? (
        <div
          onClick={() => setShowInstallHelp(false)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 99999,
            background: "rgba(0,0,0,.72)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 18,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(720px, 94vw)",
              maxHeight: "86vh",
              overflowY: "auto",
              borderRadius: 26,
              border: "1px solid rgba(255,255,255,.14)",
              background:
                "linear-gradient(180deg, rgba(20,28,44,.98), rgba(8,13,24,.98))",
              boxShadow: "0 28px 90px rgba(0,0,0,.55)",
              padding: 22,
            }}
          >
            <div
              className="row"
              style={{
                justifyContent: "space-between",
                alignItems: "flex-start",
                gap: 12,
              }}
            >
              <div>
                <div className="muted" style={{ fontSize: 12, fontWeight: 800 }}>
                  THE Q CLUB PASIGHAT
                </div>
                <h2 style={{ marginTop: 6 }}>Install Q Club App</h2>
                <div className="muted">
                  Add the webapp to your phone home screen for quick access.
                </div>
              </div>

              <button
                type="button"
                className="btn danger"
                onClick={() => setShowInstallHelp(false)}
                aria-label="Close install instructions"
              >
                ×
              </button>
            </div>

            <div className="grid" style={{ marginTop: 18 }}>
              <div className="card small cols-6">
                <h3>Android / Chrome</h3>
                <div className="hr" />
                <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
                  <li>Open The Q Club website in Chrome.</li>
                  <li>Tap the three-dot menu at the top right.</li>
                  <li>Tap <b>Add to Home screen</b> or <b>Install app</b>.</li>
                  <li>Tap <b>Install</b> or <b>Add</b>.</li>
                  <li>Open it from your phone home screen.</li>
                </ol>
              </div>

              <div className="card small cols-6">
                <h3>iPhone / Safari</h3>
                <div className="hr" />
                <ol style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
                  <li>Open The Q Club website in Safari.</li>
                  <li>Tap the <b>Share</b> button.</li>
                  <li>Scroll and tap <b>Add to Home Screen</b>.</li>
                  <li>Tap <b>Add</b> at the top right.</li>
                  <li>Open it from your iPhone home screen.</li>
                </ol>
              </div>
            </div>

            <div
              className="muted"
              style={{
                marginTop: 16,
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              Note: On iPhone, this works best from Safari. On Android, Chrome usually gives the best install option.
            </div>
          </div>
        </div>
      ) : null}

      {!isScorerOnlyPage ? (
  <FooterLinks data={data} admin={admin} commit={commit} />
) : null}
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
                âœ•
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

function playersForTournament(tournament, allPlayers = []) {
  if (!tournament) return [];
  const ids = tournament.participantIds || [];
  if (!ids.length) return getEligiblePlayersForTournament(allPlayers, tournament);
  return (allPlayers || []).filter((p) => ids.includes(p.id));
}

function AirHockeyPage() {
    const navigate = useNavigate();
  return (
        <div className="card">
      <button
        className="btn"
        style={{ marginBottom: "12px" }}
        onClick={() => navigate("/")}
      >
        â† Back to Home
      </button>
      <img
        src="/home/air-hockey.png"
        alt="Air Hockey"
        style={{
          width: "100%",
          borderRadius: "16px",
          marginBottom: "12px",
        }}
      />

      <h2>Air Hockey</h2>

      <div className="muted" style={{ marginBottom: "10px" }}>
        Fast-paced arcade-style game. First to score wins.
      </div>

      <div style={{ marginBottom: "12px" }}>
        âš¡ 1 vs 1 or 2 vs 2 <br />
        âš¡ Quick matches <br />
        âš¡ High energy gameplay
      </div>

            <button
        className="btn primary"
        style={{ width: "100%" }}
        onClick={() => navigate("/air-hockey-info")}
      >
        Pricing, Rules & How to Play
      </button>
    </div>
  );
}

function FoosballPage() {
  const navigate = useNavigate();

  return (
        <div className="card">
      <button
        className="btn"
        style={{ marginBottom: "12px" }}
        onClick={() => navigate("/")}
      >
        â† Back to Home
      </button>
      <img
        src="/home/foosball.jpg"
        alt="Foosball"
        style={{
          width: "100%",
          borderRadius: "16px",
          marginBottom: "12px",
        }}
      />

      <h2>Foosball</h2>

      <div className="muted" style={{ marginBottom: "10px" }}>
        Fast, social, and competitive table football for friends and groups.
      </div>

      <div style={{ marginBottom: "12px" }}>
        âš½ 1 vs 1 or 2 vs 2 <br />
        âš½ Quick and exciting matches <br />
        âš½ Perfect for group fun
      </div>

      <button
        className="btn primary"
        style={{ width: "100%" }}
        onClick={() => navigate("/foosball-info")}
      >
        Pricing, Rules & How to Play
      </button>
    </div>
  );
}
function MassageChairPage() {
  const navigate = useNavigate();

  return (
    <div className="card">
      <button
        className="btn"
        style={{ marginBottom: "12px" }}
        onClick={() => navigate("/")}
      >
        â† Back to Home
      </button>

      <img
        src="/home/massagechair.png"
        alt="Massage Chair"
        style={{
          width: "100%",
          borderRadius: "16px",
          marginBottom: "12px",
        }}
      />

      <h2>Massage Chair</h2>

      <div className="muted" style={{ marginBottom: "10px" }}>
        Relax, recharge, and unwind between games at The Q Club.
      </div>

      <div style={{ marginBottom: "12px" }}>
        ðŸ’† Full-body relaxation <br />
        ðŸ’† Great between matches <br />
        ðŸ’† Premium lounge experience
      </div>

      <button
        className="btn primary"
        style={{ width: "100%" }}
        onClick={() => navigate("/massage-chair-info")}
      >
        Pricing, Modes & How to Use
      </button>
    </div>
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
const visibleAnnouncements = (data.announcements || []).filter(isAnnouncementVisible);

const prioritizedAnnouncements = useMemo(() => {
  const activeBookings = (visibleAnnouncements || []).filter(
    (a) => a?.type === "table_booking"
  );
  const rest = (visibleAnnouncements || []).filter(
    (a) => a?.type !== "table_booking"
  );

  return [...activeBookings, ...rest];
}, [visibleAnnouncements]);

const tickerItems = useMemo(() => {
  const activeBookings = prioritizedAnnouncements.filter(
    (a) => a?.type === "table_booking"
  );
  const rest = prioritizedAnnouncements.filter(
    (a) => a?.type !== "table_booking"
  );

  return [...activeBookings, ...rest, ...rest];
}, [prioritizedAnnouncements]);

const tickerRenderKey = useMemo(
  () =>
    (tickerItems || [])
      .map((a) => `${a.id || ""}:${a.text || ""}:${a.expiresAt || ""}`)
      .join("|"),
  [tickerItems]
);
const [tickerPaused, setTickerPaused] = useState(false);
const [tickerDragOffset, setTickerDragOffset] = useState(0);
const tickerTouchStartX = useRef(null);
const tickerTouchMoved = useRef(false);
const tickerDragStartOffset = useRef(0);

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
            {admin && (
  <div className="row" style={{ marginTop: 4, gap: 8, flexWrap: "wrap" }}>
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
<div
  className="refGlassCard"
  style={{
    overflow: "hidden",
    marginTop: 2,
    marginBottom: 4,
    padding: "2px 10px",
  }}
>
  <div
    className="announceTicker"
    onMouseEnter={() => setTickerPaused(true)}
    onMouseLeave={() => {
      setTickerPaused(false);
      setTickerDragOffset(0);
    }}
    onTouchStart={(e) => {
      const startX = e.touches?.[0]?.clientX ?? null;
      setTickerPaused(true);
      tickerTouchMoved.current = false;
      tickerTouchStartX.current = startX;
      tickerDragStartOffset.current = tickerDragOffset;
    }}
    onTouchMove={(e) => {
      const currentX = e.touches?.[0]?.clientX ?? null;
      if (tickerTouchStartX.current !== null && currentX !== null) {
        const deltaX = currentX - tickerTouchStartX.current;

        if (Math.abs(deltaX) > 8) {
          tickerTouchMoved.current = true;
        }

        setTickerDragOffset(tickerDragStartOffset.current + deltaX);
      }
    }}
    onTouchEnd={() => {
      tickerTouchStartX.current = null;
      tickerDragStartOffset.current = 0;
      setTickerDragOffset(0);
      setTimeout(() => setTickerPaused(false), 1200);
    }}
  >
    <div
      style={{
        transform: tickerDragOffset
          ? `translateX(${tickerDragOffset}px)`
          : "translateX(0px)",
        transition: tickerPaused ? "none" : "transform .35s ease",
        willChange: "transform",
      }}
    >
      <div
  key={tickerRenderKey}
  className="announceTickerTrack"
  style={{
    animationDuration: `${data.club?.tickerSpeed || 28}s`,
    animationPlayState: tickerPaused ? "paused" : "running",
  }}
>
        {tickerItems.length > 0
  ? tickerItems.map((a, idx) => (
      <a
        key={`${a.id || idx}-${idx}`}
        className={`announceTickerItem ${a?.type === "table_booking" ? "announceTickerItemBooking" : ""}`}
        href={a.link || "#"}
        onClick={(e) => {
          if (tickerTouchMoved.current || !a.link) {
            e.preventDefault();
          }
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
</div>
      
            <section
  className="refHero"
  style={{
    marginTop: 2,
    backgroundImage: `linear-gradient(180deg, rgba(7,10,18,.30), rgba(7,10,18,.68)),
      radial-gradient(900px 320px at 20% 0%, rgba(56,211,159,.10), transparent 60%),
      radial-gradient(900px 420px at 90% 10%, rgba(212,175,55,.10), transparent 60%),
      url("${heroImage}")`,
    backgroundSize: "cover",
backgroundPosition: "center center",
backgroundRepeat: "no-repeat",
backgroundColor: "#050814",
transition: "background-image 0.45s ease-in-out",
  }}
>
        <div className="refHeroTopBar">
  <div className="refHeroActionRow">
    <Link className="btn neonGreen refHeroActionBtn" to="/book">
  {data.club?.heroBookBtnLabel || "Book Table"}
</Link>

  <Link className="btn neonGreen refHeroActionBtn" to="/membership">
  {data.club?.heroMembershipBtnLabel || "Membership"}
</Link>

<Link
  className="btn neonGreen refHeroActionBtn"
  to="/shop"
>
  {data.club?.heroShopBtnLabel || "The Q Shop"}
</Link>
</div>

  <div className="row" style={{ gap: 8 }}>
    <button
      className="btn"
      type="button"
      onClick={prevHeroImage}
      aria-label="Previous image"
    >
      â†
    </button>
    <button
      className="btn"
      type="button"
      onClick={nextHeroImage}
      aria-label="Next image"
    >
      â†’
    </button>
  </div>
</div>

                <div className="refHeroSpacer" style={{ minHeight: 120 }} />

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
              "Snooker â€¢ Pool â€¢ Air Hockey â€¢ Foosball â€¢ Massage Chair â€¢ Tea & Coffee"}
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
            "Snooker â€¢ Pool â€¢ Air Hockey â€¢ Foosball â€¢ Massage Chair â€¢ Tea & Coffee"
        );
        if (!tagline2) return;

        const heroBookBtnLabel = prompt(
          "Hero button 1 label:",
          data.club?.heroBookBtnLabel || "Book Table"
        );
        if (heroBookBtnLabel === null) return;

        const heroMembershipBtnLabel = prompt(
          "Hero button 2 label:",
          data.club?.heroMembershipBtnLabel || "Membership"
        );
        if (heroMembershipBtnLabel === null) return;

        const heroShopBtnLabel = prompt(
          "Hero button 3 label:",
          data.club?.heroShopBtnLabel || "The Q Shop"
        );
        if (heroShopBtnLabel === null) return;

        commit({
          ...data,
          club: {
            ...data.club,
            name,
            tagline2,
            heroBookBtnLabel: heroBookBtnLabel.trim(),
            heroMembershipBtnLabel: heroMembershipBtnLabel.trim(),
            heroShopBtnLabel: heroShopBtnLabel.trim(),
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
      ðŸ”¥ Register Now
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
      ðŸ“º Watch Live
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
  link: "/membership",
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
  const [foodLightbox, setFoodLightbox] = React.useState(null);
  function editFoodDrinksPageText() {
  if (!admin) return;

  const pageTitle = prompt(
    "Food & Drinks page title:",
    data.foodPage?.title || "Food & Drinks"
  );
  if (pageTitle === null) return;

  const pageSubtitle = prompt(
    "Food & Drinks page subtitle:",
    data.foodPage?.subtitle || "The Q Lounge Menu"
  );
  if (pageSubtitle === null) return;

  commit({
    ...data,
    foodPage: {
      ...(data.foodPage || {}),
      title: pageTitle.trim(),
      subtitle: pageSubtitle.trim(),
    },
  });
}
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
  <>
    <PageShell
  title={data.foodPage?.title || "Food & Drinks"}
  subtitle={data.foodPage?.subtitle || "The Q Lounge Menu"}
/>

        <div className="container foodPageContainer">

      <div className="offersStickyBar foodCategoryDock">
        <div className="foodCategoryTop">
          <div>
            <div className="foodSectionKicker">Order from the lounge</div>
            <div className="foodSectionTitle">Browse the menu</div>
          </div>
          <div className="swipeHint foodSwipeHint">{items.length} items in {category.title || "this category"}</div>
        </div>

                <div className="foodCategoryRow">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => setActiveCategory(cat)}
              className={activeCategory === cat ? "foodCatChip active" : "foodCatChip"}
            >
              {menu[cat].image ? (
                <span className="foodCatThumb">
                  <img src={menu[cat].image} alt={menu[cat].title} />
                </span>
              ) : null}

              <span className="foodCatLabel">
                {menu[cat].title}
              </span>
            </button>
          ))}
        </div>
      </div>

      {!admin && cartItems.length > 0 && showCheckout && (
        <div className="card foodCartCard" style={{ marginBottom: 20 }}>
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
  âˆ’
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
                        localStorage.setItem("qclub_food_order_started_at", new Date().toISOString());

                        const foodItemsForOrderTags = JSON.parse(localStorage.getItem("qclub_food_cart") || "[]")
  .map((item, index) => {
    const itemName = String(item?.name || "").trim();
    const qty = Number(item?.qty || 0);
    if (!itemName) return "";
    return `${index + 1}. ${itemName}${qty > 0 ? ` x ${qty}` : ""}`;
  })
  .filter(Boolean)
  .join("\n");

startPayment(
  cartTotal,
  customerPhone.trim(),
  customerName.trim(),
  {
    context: "food",
    customer_name: customerName.trim(),
    mobile: customerPhone.trim(),
    food_items: foodItemsForOrderTags || "Food items",
    food_items_json: localStorage.getItem("qclub_food_cart") || "[]",
    food_total: String(cartTotal),
  }
);
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
          <button className="btn secondary" type="button" onClick={editFoodDrinksPageText}>
  Edit Food & Drinks Title
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

      <div
        className="foodMenuGrid"
        onTouchStart={(e) => {
          touchStartX.current = e.changedTouches[0].screenX;
        }}
        onTouchEnd={(e) => {
          touchEndX.current = e.changedTouches[0].screenX;
          handleCategorySwipe();
        }}
      >
        {items.map((item) => (
                    <div key={item.id} className="card foodItemCard">
            <button
              type="button"
              className="foodCardImageBtn"
              onClick={() => {
                if (!item.image) return;
                setFoodLightbox({ title: item.name, image: item.image });
              }}
              style={{
                border: "none",
                background: "transparent",
                padding: 0,
                margin: 0,
                width: "100%",
                cursor: item.image ? "zoom-in" : "default",
                textAlign: "left",
              }}
            >
              <div className="foodItemImageWrap compact">
                <img src={item.image} alt={item.name} />
                <div className="foodImageOverlay" />
              </div>
            </button>

            <div className="foodItemBody">
              <div className="foodItemTopline">
                <div className="foodItemEyebrow">
                  {category.title || "Q Lounge"}
                </div>
                <div className="foodItemPrice">₹{item.price}</div>
              </div>

              <h3 className="foodItemTitle" style={{ margin: 0 }}>
                {item.name}
              </h3>

              <div className="muted foodItemDesc">
                {item.description || "Freshly prepared at The Q Lounge."}
              </div>
            </div>

            

            {admin ? (
              <div className="foodAdminActions" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
              <div className="foodQuickActions">
                <button className="btn secondary" type="button" onClick={() => removeFromCart(item)}>
                  âˆ’
                </button>

                <div className="foodQtyPill">{itemQty(item)}</div>

                <button className="btn primary foodAddBtn" type="button" onClick={() => addToCart(item)}>
                  + Add
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
       {!admin && cartItems.length > 0 && !showCheckout ? (
        <button
          type="button"
          className="foodFloatingCart"
          onClick={() => setShowCheckout(true)}
        >
          <div className="foodFloatingCartLeft">
            <div className="foodFloatingCartCount">
              {cartItems.reduce((sum, id) => sum + (cart[id] || 0), 0)} item
              {cartItems.reduce((sum, id) => sum + (cart[id] || 0), 0) === 1 ? "" : "s"}
            </div>
            <div className="foodFloatingCartTotal">₹{cartTotal}</div>
          </div>

          <div className="foodFloatingCartRight">
            View Cart â†’
          </div>
        </button>
      ) : null}

      {foodLightbox ? (
        <div
          onClick={() => setFoodLightbox(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(3,8,18,.88)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 18,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(860px, 96vw)",
              borderRadius: 24,
              border: "1px solid rgba(255,255,255,.12)",
              background: "linear-gradient(180deg, rgba(24,32,54,.96), rgba(10,16,30,.96))",
              boxShadow: "0 24px 80px rgba(0,0,0,.45)",
              padding: 16,
            }}
          >
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontWeight: 800, fontSize: 18 }}>{foodLightbox.title}</div>
              <button className="iconBtn" type="button" onClick={() => setFoodLightbox(null)}>
                âœ•
              </button>
            </div>
            <div
              style={{
                borderRadius: 18,
                overflow: "hidden",
                background: "#09101d",
              }}
            >
              <img
                src={foodLightbox.image}
                alt={foodLightbox.title}
                style={{
                  width: "100%",
                  maxHeight: "78vh",
                  objectFit: "contain",
                  display: "block",
                }}
              />
            </div>
          </div>
        </div>
      ) : null}
        </div>
  </>
  );
}
function QShopPage({ data, admin, commit, startPayment }) {
  const fallbackItems = [
    {
      id: "cue-1",
      name: "Beginner Cue Stick",
      desc: "Great starter cue for club and casual players",
      price: 1111,
      stock: 2,
      badge: "Pre-book Open",
      img: "/home/snooker.jpg",
    },
    {
      id: "case-1",
      name: "Cue Case",
      desc: "Protective case for carrying your cue safely",
      price: 1499,
      stock: 3,
      badge: "Pre-book Open",
      img: "/home/foosball.jpg",
    },
    {
      id: "chalk-1",
      name: "Chalk & Accessories",
      desc: "Chalk, tips, gloves and essential cue accessories",
      price: 299,
      stock: 10,
      badge: "Coming Soon",
      img: "/home/air-hockey.png",
    },
  ];

  const shopItems =
    Array.isArray(data.shopCatalog?.items) && data.shopCatalog.items.length
      ? data.shopCatalog.items
      : fallbackItems;

  function slugify(value) {
    return String(value || "")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || `opt-${Date.now()}`;
  }
    function itemShareSlug(item) {
  const namePart = slugify(item?.name || "item");
  const idPart = slugify(item?.id || "id");
  return `${namePart}-${idPart}`;
}

  function optionShareSlug(option) {
    return slugify(option?.label || option?.id || "option");
  }

  function buildShopShareUrl(item, option = null) {
  const params = new URLSearchParams();
  params.set("item", itemShareSlug(item));

  if (option?.label || option?.id) {
    params.set("option", optionShareSlug(option));
  }

  const query = params.toString();
  const hash = `shop-item-${item.id}`;

  return `${window.location.origin}/shop${query ? `?${query}` : ""}#${hash}`;
}

  function uniqueNonEmpty(values) {
    return Array.from(
      new Set(
        (values || [])
          .map((x) => String(x || "").trim())
          .filter(Boolean)
      )
    );
  }

  function normalizeItem(item) {
    const normalizedOptions = Array.isArray(item?.options)
      ? item.options
          .map((opt, index) => ({
            id: String(opt?.id || `${item?.id || "item"}-opt-${index + 1}`),
            label: String(opt?.label || "").trim(),
            stock: Math.max(0, safeNum(opt?.stock, 0)),
            img: String(opt?.img || "").trim(),
          }))
          .filter((opt) => opt.label)
      : [];

    const normalizedImages = uniqueNonEmpty([
      ...(Array.isArray(item?.images) ? item.images : []),
      item?.img || "",
    ]);

    return {
      ...item,
      optionGroupLabel: String(item?.optionGroupLabel || "").trim(),
      options: normalizedOptions,
      stock: Math.max(0, safeNum(item?.stock, 0)),
      img: String(item?.img || normalizedImages[0] || "").trim(),
      images: normalizedImages,
    };
  }

    const normalizedShopItems = useMemo(() => {
    return shopItems.map(normalizeItem);
  }, [shopItems]);

  function itemHasOptions(item) {
    return Array.isArray(item?.options) && item.options.length > 0;
  }

  function currentItemOptions(item) {
    return itemHasOptions(item) ? item.options : [];
  }

  function optionPromptString(item) {
    if (!itemHasOptions(item)) return "";
    return item.options
      .map((opt) => `${opt.label}~${Math.max(0, safeNum(opt.stock, 0))}`)
      .join(" | ");
  }

  function parseOptionsFromPrompt(raw, itemId) {
    const text = String(raw || "").trim();
    if (!text) return [];

    return text
      .split("|")
      .map((part, index) => {
        const [labelRaw, stockRaw] = String(part).split("~");
        const label = String(labelRaw || "").trim();
        if (!label) return null;

        return {
          id: `${itemId}_${slugify(label)}_${index + 1}`,
          label,
          stock: Math.max(0, safeNum(stockRaw, 0)),
        };
      })
      .filter(Boolean);
  }

  function parseImagesFromPrompt(raw, fallbackMain = "") {
    const parsed = uniqueNonEmpty(String(raw || "").split("|"));
    if (parsed.length) return parsed;
    return fallbackMain ? [String(fallbackMain).trim()].filter(Boolean) : [];
  }

  function cartEntryKey(itemId, optionId = "") {
    return `${String(itemId || "")}__${String(optionId || "")}`;
  }

  function buildCartEntry(item, qty = 1, selectedOption = null) {
    const optionLabel = selectedOption?.label ? String(selectedOption.label) : "";
    const displayName = optionLabel ? `${item.name} - ${optionLabel}` : item.name;

    return {
      key: cartEntryKey(item.id, selectedOption?.id || ""),
      itemId: item.id,
      name: item.name,
      displayName,
      qty: Math.max(0, safeNum(qty, 0)),
      price: safeNum(item.price, 0),
      lineTotal: safeNum(item.price, 0) * Math.max(0, safeNum(qty, 0)),
      selectedOptionId: selectedOption?.id || "",
      selectedOptionLabel: optionLabel,
    };
  }

  function normalizeSavedCart(rawCart, items) {
    if (Array.isArray(rawCart)) {
      return rawCart
        .map((entry) => {
          const item = items.find((x) => x.id === entry?.itemId);
          if (!item) return null;

          const selectedOption = itemHasOptions(item)
            ? currentItemOptions(item).find((opt) => opt.id === entry?.selectedOptionId) || null
            : null;

          const qty = Math.max(0, safeNum(entry?.qty, 0));
          if (qty <= 0) return null;

          return buildCartEntry(item, qty, selectedOption);
        })
        .filter(Boolean);
    }

    if (rawCart && typeof rawCart === "object") {
      return Object.entries(rawCart)
        .map(([itemId, qty]) => {
          const item = items.find((x) => x.id === itemId);
          if (!item) return null;

          const normalizedQty = Math.max(0, safeNum(qty, 0));
          if (normalizedQty <= 0) return null;

          return buildCartEntry(item, normalizedQty, null);
        })
        .filter(Boolean);
    }

    return [];
  }
  const [searchParams] = useSearchParams();
    const location = useLocation();
  const [cart, setCart] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("qclub_shop_cart") || "[]");
      return normalizeSavedCart(saved, normalizedShopItems);
    } catch {
      return [];
    }
  });

  const [selectedOptions, setSelectedOptions] = useState(() => {
    const initial = {};
    normalizedShopItems.forEach((item) => {
      if (itemHasOptions(item)) {
        initial[item.id] = item.options[0]?.id || "";
      }
    });
    return initial;
  });

  const [selectedImageIndex, setSelectedImageIndex] = useState(() => {
    const initial = {};
    normalizedShopItems.forEach((item) => {
      initial[item.id] = 0;
    });
    return initial;
  });

  const [lightbox, setLightbox] = useState(null);
    const sharedLinkHandledRef = useRef("");
  const [showCart, setShowCart] = useState(false);
  const [showCheckout, setShowCheckout] = useState(false);
  const [customerName, setCustomerName] = useState(localStorage.getItem("qclub_payment_name") || "");
  const [customerPhone, setCustomerPhone] = useState(localStorage.getItem("qclub_payment_mobile") || "");
    const sharedItemSlug = String(searchParams.get("item") || "").trim().toLowerCase();
  const sharedOptionSlug = String(searchParams.get("option") || "").trim().toLowerCase();

  const normalizedWhatsappNumber = String(customerPhone || "").replace(/\D/g, "");
  const isValidIndianWhatsappNumber = /^[6-9]\d{9}$/.test(normalizedWhatsappNumber);
  const isCheckoutFormValid =
    customerName.trim().length > 0 && isValidIndianWhatsappNumber;

  useEffect(() => {
    localStorage.setItem("qclub_shop_cart", JSON.stringify(cart));
  }, [cart]);

  useEffect(() => {
    setSelectedOptions((prev) => {
      const next = { ...prev };
      let changed = false;

      normalizedShopItems.forEach((item) => {
        if (!itemHasOptions(item)) {
          if (next[item.id]) {
            delete next[item.id];
            changed = true;
          }
          return;
        }

        const exists = item.options.some((opt) => opt.id === next[item.id]);
        if (!exists) {
          next[item.id] = item.options[0]?.id || "";
          changed = true;
        }
      });

      return changed ? next : prev;
    });

    setSelectedImageIndex((prev) => {
      const next = { ...prev };
      let changed = false;

      normalizedShopItems.forEach((item) => {
        const gallery = getGalleryImages(item, false);
        const maxIndex = Math.max(0, gallery.length - 1);
        const current = Number.isFinite(prev[item.id]) ? prev[item.id] : 0;
        const safeIndex = Math.min(current, maxIndex);

        if (safeIndex !== current || prev[item.id] === undefined) {
          next[item.id] = safeIndex;
          changed = true;
        }
      });

      return changed ? next : prev;
    });

    setCart((prev) => normalizeSavedCart(prev, normalizedShopItems));
  }, [data.shopCatalog?.items]);

          useEffect(() => {
    if (!sharedItemSlug) return;

    const handleKey = `${sharedItemSlug}__${sharedOptionSlug}`;
    if (sharedLinkHandledRef.current === handleKey) return;

    const matchedItem = normalizedShopItems.find(
      (item) => itemShareSlug(item) === sharedItemSlug
    );
    if (!matchedItem) return;

    if (itemHasOptions(matchedItem) && sharedOptionSlug) {
      const matchedOption = matchedItem.options.find(
        (opt) => optionShareSlug(opt) === sharedOptionSlug
      );

      if (matchedOption) {
        setSelectedOptions((prev) => ({
          ...prev,
          [matchedItem.id]: matchedOption.id,
        }));
      }
    }

    sharedLinkHandledRef.current = handleKey;
  }, [sharedItemSlug, sharedOptionSlug, normalizedShopItems]);
    useEffect(() => {
    const hash = String(location.hash || "").replace(/^#/, "").trim();
    if (!hash) return;

    const scrollToHash = () => {
      const el = document.getElementById(hash);
      if (!el) return false;

      const y = el.getBoundingClientRect().top + window.scrollY - 110;
      window.scrollTo({
        top: Math.max(0, y),
        behavior: "auto",
      });
      return true;
    };

    if (scrollToHash()) return;

    const timer = setTimeout(() => {
      scrollToHash();
    }, 300);

    return () => clearTimeout(timer);
  }, [location.hash, normalizedShopItems]);
  function saveShopItems(nextItems) {
    commit({
      ...data,
      shopCatalog: {
        ...(data.shopCatalog || {}),
        items: nextItems,
      },
    });
  }

  function getSelectedOption(item) {
    if (!itemHasOptions(item)) return null;
    const selectedId = selectedOptions[item.id] || item.options[0]?.id || "";
    return item.options.find((opt) => opt.id === selectedId) || item.options[0] || null;
  }

  function getGalleryImages(item, includeOptionImage = true) {
    const selectedOption = getSelectedOption(item);
    const optionImage = includeOptionImage ? String(selectedOption?.img || "").trim() : "";
    return uniqueNonEmpty([
      optionImage,
      ...(Array.isArray(item?.images) ? item.images : []),
      item?.img || "",
    ]);
  }

  function getDisplayImage(item) {
    const gallery = getGalleryImages(item);
    const currentIndex = Math.min(
      Math.max(0, safeNum(selectedImageIndex[item.id], 0)),
      Math.max(0, gallery.length - 1)
    );
    return gallery[currentIndex] || "";
  }

  function getAvailableStock(item, optionId = "") {
    if (itemHasOptions(item)) {
      const selectedId = optionId || getSelectedOption(item)?.id || "";
      const option = item.options.find((opt) => opt.id === selectedId);
      return Math.max(0, safeNum(option?.stock, 0));
    }
    return Math.max(0, safeNum(item?.stock, 0));
  }

  function itemQty(itemId, optionId = "") {
    const key = cartEntryKey(itemId, optionId);
    const entry = cart.find((x) => x.key === key);
    return Math.max(0, safeNum(entry?.qty, 0));
  }

  function setItemImageIndex(itemId, index) {
    setSelectedImageIndex((prev) => ({
      ...prev,
      [itemId]: Math.max(0, safeNum(index, 0)),
    }));
  }

  function openLightbox(item, index = 0) {
    const images = getGalleryImages(item);
    if (!images.length) return;
    setLightbox({
      itemId: item.id,
      title: item.name,
      images,
      index: Math.min(Math.max(0, safeNum(index, 0)), images.length - 1),
    });
  }

  function closeLightbox() {
    setLightbox(null);
  }

  function moveLightbox(step) {
    setLightbox((prev) => {
      if (!prev || !Array.isArray(prev.images) || !prev.images.length) return prev;
      const total = prev.images.length;
      const nextIndex = (prev.index + step + total) % total;
      return { ...prev, index: nextIndex };
    });
  }

  function addShopItem() {
    if (!admin) return alert("Main admin only");

    const name = prompt("Product name:", "New Product");
    if (!name) return;

    const desc = prompt("Description:", "") || "";
    const price = prompt("Price in rupees:", "999");
    if (price === null) return;

    const badge = prompt("Badge text:", "Pre-book Open") || "Pre-book Open";
    const optionGroupLabel =
      prompt("Option type (example: Colour or Length). Leave blank for no options:", "") || "";

    const newItemId = `shop_${Date.now()}`;

    let options = [];
    let stockValue = 0;

    if (optionGroupLabel.trim()) {
      const optionsRaw =
        prompt(
          `Enter ${optionGroupLabel.trim()} options in this format:\nBlack~2 | Brown~1 | Grey~4`,
          ""
        ) || "";
      options = parseOptionsFromPrompt(optionsRaw, newItemId);

      if (!options.length) {
        alert("No valid options entered. Product will be created without options.");
      }
    }

    if (!options.length) {
      const stock = prompt("Available quantity / stock:", "1");
      if (stock === null) return;
      stockValue = Math.max(0, safeNum(stock, 0));
    }

    const imagesRaw =
      prompt(
        "Image URLs / paths separated by | \nExample:\n/img1.jpg | /img2.jpg | /img3.jpg",
        "/home/snooker.jpg"
      ) || "/home/snooker.jpg";

    const images = parseImagesFromPrompt(imagesRaw, "/home/snooker.jpg");
    const mainImg = images[0] || "/home/snooker.jpg";
        const amazonUrl =
      prompt("Amazon compare link (optional):", "") || "";

    saveShopItems([
      {
        id: newItemId,
        name: name.trim(),
        desc: desc.trim(),
        price: safeNum(price, 0),
        stock: options.length ? 0 : stockValue,
        badge: badge.trim(),
        img: mainImg,
        images,
        optionGroupLabel: options.length ? optionGroupLabel.trim() : "",
                amazonUrl: amazonUrl.trim(),
        options,
      },
      ...normalizedShopItems,
    ]);
  }

  function editShopItem(id) {
    if (!admin) return alert("Main admin only");

    const current = normalizedShopItems.find((x) => x.id === id);
    if (!current) return;

    const name = prompt("Edit product name:", current.name || "");
    if (name === null) return;

    const desc = prompt("Edit description:", current.desc || "");
    if (desc === null) return;

    const price = prompt("Edit price in rupees:", String(current.price ?? 0));
    if (price === null) return;

    const badge = prompt("Edit badge text:", current.badge || "");
if (badge === null) return;

const amazonUrl = prompt(
  "Edit Amazon compare link (optional):",
  current.amazonUrl || ""
);
if (amazonUrl === null) return;

    const optionGroupLabel =
      prompt(
        "Edit option type (example: Colour or Length). Leave blank for no options:",
        current.optionGroupLabel || ""
      ) || "";

    let nextOptions = [];
    let nextStock = Math.max(0, safeNum(current.stock, 0));

    if (optionGroupLabel.trim()) {
      const optionsRaw =
        prompt(
          `Edit options in this format:\nBlack~2 | Brown~1 | Grey~4`,
          optionPromptString(current)
        ) || "";
      nextOptions = parseOptionsFromPrompt(optionsRaw, current.id);

      if (!nextOptions.length) {
        alert("No valid options entered. Product will be converted to normal stock item.");
      }
    }

    if (!nextOptions.length) {
      const stock = prompt("Edit available quantity / stock:", String(current.stock ?? 0));
      if (stock === null) return;
      nextStock = Math.max(0, safeNum(stock, 0));
    }

    const imagesRaw =
      prompt(
        "Edit image URLs / paths separated by |",
        uniqueNonEmpty(current.images || [current.img]).join(" | ")
      ) || "";

    const nextImages = parseImagesFromPrompt(imagesRaw, current.img || "");
    const nextMainImg = nextImages[0] || current.img || "";

    saveShopItems(
      normalizedShopItems.map((x) =>
        x.id === id
          ? {
              ...x,
              name: name.trim(),
              desc: desc.trim(),
              price: safeNum(price, 0),
              stock: nextOptions.length ? 0 : nextStock,
              badge: badge.trim(),
              img: nextMainImg,
              images: nextImages,
              optionGroupLabel: nextOptions.length ? optionGroupLabel.trim() : "",
                            amazonUrl: amazonUrl.trim(),
              options: nextOptions,
            }
          : x
      )
    );

    setCart((prev) => prev.filter((entry) => entry.itemId !== id));
    setSelectedImageIndex((prev) => ({ ...prev, [id]: 0 }));
  }

  function deleteShopItem(id) {
    if (!admin) return alert("Main admin only");
    if (!confirm("Delete this shop item?")) return;

    saveShopItems(normalizedShopItems.filter((x) => x.id !== id));
    setCart((prev) => prev.filter((entry) => entry.itemId !== id));
  }

  async function uploadShopItemImage(itemId, file) {
    if (!admin) return alert("Main admin only");
    if (!file) return;

    try {
      const uploaded = await uploadImageToStorage(file, "shop-items");

      saveShopItems(
        normalizedShopItems.map((x) => {
          if (x.id !== itemId) return x;

          const nextImages = uniqueNonEmpty([
            ...(Array.isArray(x.images) ? x.images : []),
            uploaded.url,
            x.img,
          ]);

          return {
            ...x,
            img: nextImages[0] || uploaded.url,
            images: nextImages,
            imagePath: uploaded.path,
          };
        })
      );
    } catch (err) {
      console.error(err);
      alert("Failed to upload shop item image.");
    }
  }

  function deleteCurrentShopItemImage(itemId) {
    if (!admin) return alert("Main admin only");

    const current = normalizedShopItems.find((x) => x.id === itemId);
    if (!current) return;

    const gallery = getGalleryImages(current, false);
    const currentIndex = Math.min(
      Math.max(0, safeNum(selectedImageIndex[itemId], 0)),
      Math.max(0, gallery.length - 1)
    );

    if (gallery.length <= 1) {
      alert("At least one image must remain.");
      return;
    }

    const imageToDelete = gallery[currentIndex];
    if (!imageToDelete) return;

    const confirmed = confirm("Delete the currently selected image?");
    if (!confirmed) return;

    const nextImages = gallery.filter((img, idx) => idx !== currentIndex);
    const nextMainImg =
      String(current.img || "").trim() === String(imageToDelete).trim()
        ? nextImages[0] || ""
        : current.img;

    saveShopItems(
      normalizedShopItems.map((x) =>
        x.id === itemId
          ? {
              ...x,
              img: nextMainImg,
              images: nextImages,
            }
          : x
      )
    );

    setSelectedImageIndex((prev) => ({
      ...prev,
      [itemId]: Math.max(0, Math.min(currentIndex, nextImages.length - 1)),
    }));
  }

  function clearShopItemImages(itemId) {
    if (!admin) return alert("Main admin only");
    const current = normalizedShopItems.find((x) => x.id === itemId);
    if (!current) return;

    const confirmed = confirm("Remove all extra gallery images and keep only the current main image?");
    if (!confirmed) return;

    const keep = String(current.img || "").trim();

    saveShopItems(
      normalizedShopItems.map((x) =>
        x.id === itemId
          ? {
              ...x,
              images: keep ? [keep] : [],
              img: keep,
            }
          : x
      )
    );
  }

  function changeSelectedOption(itemId, optionId) {
    setSelectedOptions((prev) => ({
      ...prev,
      [itemId]: optionId,
    }));
    setSelectedImageIndex((prev) => ({
      ...prev,
      [itemId]: 0,
    }));
  }

  function addToCart(itemId) {
    const item = normalizedShopItems.find((x) => x.id === itemId);
    if (!item) return;

    const selectedOption = getSelectedOption(item);
    const optionId = selectedOption?.id || "";
    const maxStock = getAvailableStock(item, optionId);

    setCart((prev) => {
      const key = cartEntryKey(item.id, optionId);
      const existing = prev.find((x) => x.key === key);
      const currentQty = Math.max(0, safeNum(existing?.qty, 0));

      if (currentQty >= maxStock) return prev;

      if (existing) {
        return prev.map((entry) =>
          entry.key === key
            ? {
                ...entry,
                qty: currentQty + 1,
                lineTotal: safeNum(entry.price, 0) * (currentQty + 1),
              }
            : entry
        );
      }

      return [...prev, buildCartEntry(item, 1, selectedOption)];
    });
  }

  function removeFromCart(itemId, optionId = "") {
    const key = cartEntryKey(itemId, optionId);

    setCart((prev) => {
      const existing = prev.find((x) => x.key === key);
      if (!existing) return prev;

      const nextQty = Math.max(0, safeNum(existing.qty, 0) - 1);

      if (nextQty <= 0) {
        return prev.filter((x) => x.key !== key);
      }

      return prev.map((entry) =>
        entry.key === key
          ? {
              ...entry,
              qty: nextQty,
              lineTotal: safeNum(entry.price, 0) * nextQty,
            }
          : entry
      );
    });
  }

  function cartTotal() {
    return cart.reduce((sum, entry) => {
      return sum + safeNum(entry.lineTotal, 0);
    }, 0);
  }

  function buySingleItem(item) {
  const amount = safeNum(item.price, 0);
  if (!amount || amount <= 0) {
    alert("Please set a valid product price first.");
    return;
  }

  if (!customerName.trim()) {
    alert("Please enter your name.");
    setShowCart(true);
    setShowCheckout(true);
    return;
  }

  if (!customerPhone.trim()) {
    alert("Please enter your WhatsApp number.");
    setShowCart(true);
    setShowCheckout(true);
    return;
  }

  if (!isValidIndianWhatsappNumber) {
    alert("Please enter a valid Indian 10-digit WhatsApp number.");
    setShowCart(true);
    setShowCheckout(true);
    return;
  }

  const selectedOption = getSelectedOption(item);
  const singleCart = [buildCartEntry(item, 1, selectedOption)];

  localStorage.setItem("qclub_payment_context", "shop");
  localStorage.setItem("qclub_payment_name", customerName.trim());
  localStorage.setItem("qclub_payment_mobile", normalizedWhatsappNumber);
  localStorage.setItem("qclub_shop_cart", JSON.stringify(singleCart));
  localStorage.setItem("qclub_shop_total", String(amount));

  startPayment(
  amount,
  normalizedWhatsappNumber,
  customerName.trim(),
  {
    context: "shop",
    customer_name: customerName.trim(),
    mobile: normalizedWhatsappNumber,
    shop_items: singleCart
      .map((entry) => `${entry.displayName || entry.name} x ${safeNum(entry.qty, 1)}`)
      .join(", "),
    shop_items_json: JSON.stringify(singleCart),
    shop_total: String(amount),
  }
);
}

  function buyCartNow() {
  const total = cartTotal();

  if (!total || total <= 0) {
    alert("Your cart is empty.");
    return;
  }

  if (!customerName.trim()) {
    alert("Please enter your name.");
    setShowCart(true);
    setShowCheckout(true);
    return;
  }

  if (!customerPhone.trim()) {
    alert("Please enter your WhatsApp number.");
    setShowCart(true);
    setShowCheckout(true);
    return;
  }

  if (!isValidIndianWhatsappNumber) {
    alert("Please enter a valid Indian 10-digit WhatsApp number.");
    setShowCart(true);
    setShowCheckout(true);
    return;
  }

  localStorage.setItem("qclub_payment_context", "shop");
  localStorage.setItem("qclub_retry_path", "/shop");
  localStorage.setItem("qclub_payment_name", customerName.trim());
  localStorage.setItem("qclub_payment_mobile", normalizedWhatsappNumber);
  localStorage.setItem("qclub_shop_total", String(total));
  localStorage.setItem("qclub_shop_cart", JSON.stringify(cart));

  startPayment(
  total,
  normalizedWhatsappNumber,
  customerName.trim(),
  {
    context: "shop",
    customer_name: customerName.trim(),
    mobile: normalizedWhatsappNumber,
    shop_items: cart
      .map((entry) => `${entry.displayName || entry.name} x ${safeNum(entry.qty, 1)}`)
      .join(", "),
    shop_items_json: JSON.stringify(cart),
    shop_total: String(total),
  }
);
}

  function editShopHeader() {
    if (!admin) return alert("Main admin only");

    const topLabel = prompt(
      "Top small label:",
      data.shopCatalog?.topLabel || "Q Shop"
    );
    if (topLabel === null) return;

    const heading = prompt(
      "Main heading:",
      data.shopCatalog?.heading || "Cue Sticks & Accessories"
    );
    if (heading === null) return;

    const description = prompt(
      "Description:",
      data.shopCatalog?.description ||
        "Fresh stock has been ordered and is expected soon. You can keep this page live now for display, enquiries, and pre-booking of cue sticks, cue cases, chalk, gloves, tips, and other accessories."
    );
    if (description === null) return;

    const badge1 = prompt(
      "Badge 1 text:",
      data.shopCatalog?.badge1 || "Stock Arriving Soon"
    );
    if (badge1 === null) return;

    const badge2 = prompt(
      "Badge 2 text:",
      data.shopCatalog?.badge2 || "Pre-booking Open"
    );
    if (badge2 === null) return;

    commit({
      ...data,
      shopCatalog: {
        ...(data.shopCatalog || {}),
        topLabel: topLabel.trim(),
        heading: heading.trim(),
        description: description.trim(),
        badge1: badge1.trim(),
        badge2: badge2.trim(),
        items: normalizedShopItems,
      },
    });
  }

  return (
    <>
      <PageShell
        title={data.club?.shopPageTitle || "The Q Shop"}
        subtitle={data.club?.shopPageSubtitle || "Cue sticks, cases and accessories arriving soon"}
        right={
          admin ? (
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  const shopPageTitle = prompt(
                    "Q Shop page title:",
                    data.club?.shopPageTitle || "The Q Shop"
                  );
                  if (shopPageTitle === null) return;

                  const shopPageSubtitle = prompt(
                    "Q Shop page subtitle:",
                    data.club?.shopPageSubtitle || "Cue sticks, cases and accessories"
                  );
                  if (shopPageSubtitle === null) return;

                  commit({
                    ...data,
                    club: {
                      ...data.club,
                      shopPageTitle: shopPageTitle.trim(),
                      shopPageSubtitle: shopPageSubtitle.trim(),
                    },
                  });
                }}
              >
                Edit Page Text
              </button>

              <button className="btn" type="button" onClick={editShopHeader}>
                Edit Header
              </button>

              <button className="btn primary" type="button" onClick={addShopItem}>
                + Add Shop Item
              </button>
            </div>
          ) : null
        }
      />

            <div className="container shopPageContainer" style={{ marginTop: -14 }}>
        <div className="card shopHeroCard">
          <div className="muted" style={{ lineHeight: 1.6, marginBottom: 10 }}>
            {data.shopCatalog?.description ||
              "Fresh stock has been ordered and is expected soon. You can keep this page live now for display, enquiries, and pre-booking of cue sticks, cue cases, chalk, gloves, tips, and other accessories."}
          </div>

          <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
            <span className="badge">
              <span className="dot" />
              {data.shopCatalog?.badge1 || "Stock Arriving Soon"}
            </span>
            <span className="badge">
              <span className="dot" />
              {data.shopCatalog?.badge2 || "Pre-booking Open"}
            </span>
          </div>
        </div>

                {!admin && (showCart || showCheckout) && cart.length > 0 ? (
          <div className="card shopCartCard" style={{ marginBottom: 18 }}>
            <button
              type="button"
              onClick={() => setShowCart((v) => !v)}
              style={{
                width: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                background: "transparent",
                border: "none",
                color: "#eaf0ff",
                padding: 0,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <div>
                <h2 style={{ margin: 0 }}>View Cart</h2>
                <div style={{ fontWeight: 800, fontSize: "1.1rem", marginTop: 8 }}>
                  Total: ₹{cartTotal()}
                </div>
              </div>

              <div
                style={{
                  minWidth: 34,
                  height: 34,
                  borderRadius: 999,
                  display: "grid",
                  placeItems: "center",
                  border: "1px solid rgba(255,255,255,.10)",
                  background: "rgba(255,255,255,.04)",
                  fontSize: 18,
                  fontWeight: 800,
                }}
              >
                {showCart ? "âˆ’" : "+"}
              </div>
            </button>

            {showCart ? (
              <div style={{ marginTop: 16 }}>
                {cart.length === 0 ? (
                  <div className="muted">Cart is empty.</div>
                ) : (
                  <div style={{ display: "grid", gap: 10 }}>
                    {cart.map((entry) => (
                      <div
                        key={entry.key}
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 10,
                          padding: "10px 0",
                          borderBottom: "1px solid rgba(255,255,255,.08)",
                        }}
                      >
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontWeight: 700 }}>{entry.displayName || entry.name}</div>
                          <div className="muted" style={{ marginTop: 4 }}>
                            ₹{safeNum(entry.price, 0)} each
                          </div>
                        </div>

                        <div className="row" style={{ gap: 8, alignItems: "center" }}>
                          <button
                            className="btn secondary"
                            type="button"
                            onClick={() => removeFromCart(entry.itemId, entry.selectedOptionId)}
                          >
                            âˆ’
                          </button>

                          <div style={{ minWidth: 24, textAlign: "center", fontWeight: 800 }}>
                            {Math.max(0, safeNum(entry.qty, 0))}
                          </div>

                          <button
                            className="btn secondary"
                            type="button"
                            onClick={() => addToCart(entry.itemId)}
                            disabled={
                              Math.max(0, safeNum(entry.qty, 0)) >=
                              getAvailableStock(
                                normalizedShopItems.find((x) => x.id === entry.itemId),
                                entry.selectedOptionId
                              )
                            }
                          >
                            +
                          </button>
                        </div>

                        <div style={{ minWidth: 90, textAlign: "right", fontWeight: 800 }}>
                          ₹{safeNum(entry.lineTotal, 0)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="row" style={{ marginTop: 16, gap: 10, flexWrap: "wrap" }}>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => setShowCheckout((v) => !v)}
                  >
                    {showCheckout ? "Hide Checkout" : "Proceed to Checkout"}
                  </button>

                  <button
                    className="btn danger"
                    type="button"
                    onClick={() => setCart([])}
                  >
                    Empty Cart
                  </button>
                </div>

                {showCheckout ? (
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
                        placeholder="WhatsApp Number"
                        inputMode="numeric"
                        maxLength={10}
                        value={customerPhone}
                        onChange={(e) =>
                          setCustomerPhone(e.target.value.replace(/\D/g, "").slice(0, 10))
                        }
                      />

                      {customerPhone.trim() && !isValidIndianWhatsappNumber ? (
                        <div
                          className="muted"
                          style={{ color: "#ff8a8a", fontSize: 13 }}
                        >
                          Enter a valid Indian 10-digit WhatsApp number.
                        </div>
                      ) : null}

                      <button
                        className="btn primary"
                        type="button"
                        onClick={buyCartNow}
                        disabled={!isCheckoutFormValid}
                        style={{
                          opacity: isCheckoutFormValid ? 1 : 0.55,
                          cursor: isCheckoutFormValid ? "pointer" : "not-allowed",
                        }}
                      >
                        Pay Now
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="shopProductGrid">
          {normalizedShopItems.map((item) => {
            const selectedOption = getSelectedOption(item);
            const selectedOptionId = selectedOption?.id || "";
            const availableStock = getAvailableStock(item, selectedOptionId);
            const currentQty = itemQty(item.id, selectedOptionId);
            const galleryImages = getGalleryImages(item);
            const currentImageIndex = Math.min(
              Math.max(0, safeNum(selectedImageIndex[item.id], 0)),
              Math.max(0, galleryImages.length - 1)
            );
            const currentImage = galleryImages[currentImageIndex] || "";

            return (
              <div
  key={item.id}
  id={`shop-item-${item.id}`}
  className="card shopProductCard"
>
                <button
                  type="button"
                  onClick={() => openLightbox(item, currentImageIndex)}
                  style={{
                    width: "100%",
                    border: "none",
                    padding: 0,
                    margin: 0,
                    background: "transparent",
                    cursor: currentImage ? "zoom-in" : "default",
                  }}
                >
                  <img
                    src={currentImage}
                    alt={item.name}
                    className="shopProductMainImage"
                    style={{
                      width: "100%",
                      height: 156,
                      objectFit: "contain",
                      objectPosition: "center",
                      borderRadius: 16,
                      marginBottom: 10,
                      background: "#0b1020",
                      padding: 8,
                      display: "block",
                    }}
                  />
                </button>

                {galleryImages.length > 1 ? (
                  <div className="shopGalleryThumbRow">
                    {galleryImages.map((imgSrc, imgIndex) => (
                      <button
                        key={`${item.id}_thumb_${imgIndex}`}
                        type="button"
                        onClick={() => setItemImageIndex(item.id, imgIndex)}
                        className="shopGalleryThumbBtn"
                        style={{
                          flex: "0 0 auto",
                          width: 46,
                          height: 46,
                          padding: 3,
                          borderRadius: 10,
                          border:
                            imgIndex === currentImageIndex
                              ? "1px solid rgba(56,211,159,.7)"
                              : "1px solid rgba(255,255,255,.12)",
                          background:
                            imgIndex === currentImageIndex
                              ? "rgba(56,211,159,.10)"
                              : "rgba(255,255,255,.03)",
                          cursor: "pointer",
                        }}
                      >
                        <img
                          src={imgSrc}
                          alt={`${item.name} ${imgIndex + 1}`}
                          style={{
                            width: "100%",
                            height: "100%",
                            objectFit: "cover",
                            borderRadius: 8,
                            display: "block",
                          }}
                        />
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
                  <h3 style={{ margin: 0 }}>{item.name}</h3>
                  <span className="badge">{item.badge}</span>
                </div>

                <div className="muted" style={{ marginTop: 8 }}>
                  {item.desc}
                </div>

                {itemHasOptions(item) ? (
                  <div style={{ marginTop: 12 }}>
                    <div className="muted" style={{ marginBottom: 8 }}>
                      Select {item.optionGroupLabel || "Option"}:
                    </div>

                    <div className="row shopOptionRow" style={{ gap: 8, flexWrap: "wrap" }}>
                      {item.options.map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          className="btn"
                          onClick={() => changeSelectedOption(item.id, opt.id)}
                          style={{
                            borderColor:
                              selectedOptionId === opt.id
                                ? "rgba(56,211,159,.6)"
                                : "rgba(255,255,255,.12)",
                            background:
                              selectedOptionId === opt.id
                                ? "rgba(56,211,159,.12)"
                                : "rgba(255,255,255,.04)",
                            opacity: Math.max(0, safeNum(opt.stock, 0)) > 0 ? 1 : 0.55,
                          }}
                        >
                          {opt.label} ({Math.max(0, safeNum(opt.stock, 0))})
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}

                <div style={{ marginTop: 14, fontWeight: 800, fontSize: "1.05rem" }}>
                  ₹{safeNum(item.price, 0)}
                </div>

                <div className="muted" style={{ marginTop: 6 }}>
                  Stock: {availableStock}
                </div>
                                <div className="row" style={{ marginTop: 12, gap: 8, flexWrap: "wrap" }}>
                  <button
                    className="btn"
                    type="button"
                    onClick={async () => {
                      const shareUrl = buildShopShareUrl(item, selectedOption);
                      try {
                        await navigator.clipboard.writeText(shareUrl);
                        alert("Product link copied.");
                      } catch {
                        prompt("Copy this product link:", shareUrl);
                      }
                    }}
                  >
                    Copy Product Link
                  </button>
                </div>
                                {String(item.amazonUrl || "").trim() ? (
                  <div style={{ marginTop: 12 }}>
                    <a
                      className="btn"
                      href={String(item.amazonUrl || "").trim()}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{
                        display: "inline-flex",
                        width: "100%",
                        justifyContent: "center",
                        textAlign: "center",
                      }}
                    >
                      Compare with Amazon
                    </a>
                  </div>
                ) : null}

                {!admin ? (
                  <div
                    className="row"
                    style={{ marginTop: 14, gap: 8, flexWrap: "wrap", alignItems: "center" }}
                  >
                    <button
                      className="btn secondary"
                      type="button"
                      onClick={() => removeFromCart(item.id, selectedOptionId)}
                    >
                      âˆ’
                    </button>

                    <div style={{ minWidth: 24, textAlign: "center", fontWeight: 800 }}>
                      {currentQty}
                    </div>

                    <button
                      className="btn secondary"
                      type="button"
                      onClick={() => addToCart(item.id)}
                      disabled={currentQty >= availableStock}
                    >
                      +
                    </button>

                    <button
                      className="btn primary"
                      type="button"
                      onClick={() => addToCart(item.id)}
                      disabled={availableStock <= 0 || currentQty >= availableStock}
                    >
                      Add to Cart
                    </button>
                  </div>
                ) : (
                  <div className="row" style={{ marginTop: 14, gap: 8, flexWrap: "wrap" }}>
                                      <button
                      className="btn"
                      type="button"
                      onClick={async () => {
                        const shareUrl = buildShopShareUrl(item, selectedOption);
                        try {
                          await navigator.clipboard.writeText(shareUrl);
                          alert("Product link copied.");
                        } catch {
                          prompt("Copy this product link:", shareUrl);
                        }
                      }}
                    >
                      Copy Link
                    </button>
                    <label className="btn secondary" style={{ cursor: "pointer" }}>
                      Upload Image
                      <input
                        type="file"
                        accept="image/*"
                        style={{ display: "none" }}
                        onChange={(e) => uploadShopItemImage(item.id, e.target.files?.[0])}
                      />
                    </label>

                    <button
                      className="btn"
                      type="button"
                      onClick={() => editShopItem(item.id)}
                    >
                      Edit
                    </button>

                    <button
                      className="btn warn"
                      type="button"
                      onClick={() => deleteCurrentShopItemImage(item.id)}
                    >
                      Delete Current Image
                    </button>

                    <button
                      className="btn"
                      type="button"
                      onClick={() => clearShopItemImages(item.id)}
                    >
                      Reset Gallery
                    </button>

                    <button
                      className="btn danger"
                      type="button"
                      onClick={() => deleteShopItem(item.id)}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        
      </div>
            {!admin && cart.length > 0 && !(showCart || showCheckout) ? (
        <button
          type="button"
          className="shopFloatingCart"
          onClick={() => {
            setShowCart(true);
            setShowCheckout(true);
            requestAnimationFrame(() => {
              window.scrollTo({ top: 0, behavior: "smooth" });
            });
          }}
        >
          <div className="shopFloatingCartLeft">
            <div className="shopFloatingCartCount">
              {cart.reduce((sum, entry) => sum + Math.max(0, safeNum(entry.qty, 0)), 0)} item
              {cart.reduce((sum, entry) => sum + Math.max(0, safeNum(entry.qty, 0)), 0) === 1 ? "" : "s"}
            </div>
            <div className="shopFloatingCartTotal">₹{cartTotal()}</div>
          </div>

          <div className="shopFloatingCartRight">
            View Cart â†’
          </div>
        </button>
      ) : null}

      {lightbox ? (
        <div
          onClick={closeLightbox}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(3, 8, 18, 0.88)",
            backdropFilter: "blur(8px)",
            WebkitBackdropFilter: "blur(8px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 18,
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(980px, 96vw)",
              maxHeight: "92vh",
              borderRadius: 24,
              border: "1px solid rgba(255,255,255,.12)",
              background: "linear-gradient(180deg, rgba(24,32,54,.96), rgba(10,16,30,.96))",
              boxShadow: "0 24px 80px rgba(0,0,0,.45)",
              padding: 16,
              overflow: "hidden",
            }}
          >
            <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
              <div style={{ fontWeight: 800, fontSize: 18 }}>{lightbox.title}</div>
              <button className="iconBtn" type="button" onClick={closeLightbox}>
                âœ•
              </button>
            </div>

            <div
              style={{
                position: "relative",
                borderRadius: 18,
                overflow: "hidden",
                background: "#09101d",
                minHeight: 320,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <img
                src={lightbox.images[lightbox.index]}
                alt={`${lightbox.title} ${lightbox.index + 1}`}
                style={{
                  width: "100%",
                  maxHeight: "68vh",
                  objectFit: "contain",
                  display: "block",
                }}
              />

              {lightbox.images.length > 1 ? (
                <>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => moveLightbox(-1)}
                    style={{
                      position: "absolute",
                      left: 12,
                      top: "50%",
                      transform: "translateY(-50%)",
                    }}
                  >
                    â†
                  </button>

                  <button
                    type="button"
                    className="btn"
                    onClick={() => moveLightbox(1)}
                    style={{
                      position: "absolute",
                      right: 12,
                      top: "50%",
                      transform: "translateY(-50%)",
                    }}
                  >
                    â†’
                  </button>
                </>
              ) : null}
            </div>

            {lightbox.images.length > 1 ? (
              <div
                style={{
                  display: "flex",
                  gap: 10,
                  overflowX: "auto",
                  paddingTop: 14,
                }}
              >
                {lightbox.images.map((imgSrc, idx) => (
                  <button
                    key={`lightbox_thumb_${idx}`}
                    type="button"
                    onClick={() => setLightbox((prev) => ({ ...prev, index: idx }))}
                    style={{
                      flex: "0 0 auto",
                      width: 72,
                      height: 72,
                      padding: 4,
                      borderRadius: 12,
                      border:
                        idx === lightbox.index
                          ? "1px solid rgba(56,211,159,.7)"
                          : "1px solid rgba(255,255,255,.12)",
                      background:
                        idx === lightbox.index
                          ? "rgba(56,211,159,.10)"
                          : "rgba(255,255,255,.03)",
                      cursor: "pointer",
                    }}
                  >
                    <img
                      src={imgSrc}
                      alt={`${lightbox.title} thumbnail ${idx + 1}`}
                      style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        borderRadius: 8,
                        display: "block",
                      }}
                    />
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
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

      qshopSuccessTemplate: String(saved?.qshopSuccessTemplate || "").trim(),
      qshopFailedTemplate: String(saved?.qshopFailedTemplate || "").trim(),

      bookingSuccessTemplate: String(saved?.bookingSuccessTemplate || "").trim(),
      bookingFailedTemplate: String(saved?.bookingFailedTemplate || "").trim(),

      membershipSuccessTemplate: String(saved?.membershipSuccessTemplate || "").trim(),
      membershipFailedTemplate: String(saved?.membershipFailedTemplate || "").trim(),

      otpTemplate: String(saved?.otpTemplate || "").trim(),

      tournamentSuccessTemplate: String(
        saved?.tournamentSuccessTemplate || saved?.tournamentTemplate || ""
      ).trim(),
      tournamentFailedTemplate: String(saved?.tournamentFailedTemplate || "").trim(),

      foodSuccessTemplate: String(
        saved?.foodSuccessTemplate || saved?.foodTemplate || ""
      ).trim(),
      foodFailedTemplate: String(saved?.foodFailedTemplate || "").trim(),
    };
  } catch {
    return {
      provider: "msg91",
      authKey: "",
      senderNumber: "",
      senderLabel: "",

      qshopSuccessTemplate: "",
      qshopFailedTemplate: "",

      bookingSuccessTemplate: "",
      bookingFailedTemplate: "",

      membershipSuccessTemplate: "",
      membershipFailedTemplate: "",

      otpTemplate: "",

      tournamentSuccessTemplate: "",
      tournamentFailedTemplate: "",

      foodSuccessTemplate: "",
      foodFailedTemplate: "",
      jobApplicationReceivedTemplate: "",
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

    qshopSuccessTemplate: String(
      next?.qshopSuccessTemplate ?? current.qshopSuccessTemplate ?? ""
    ).trim(),
    qshopFailedTemplate: String(
      next?.qshopFailedTemplate ?? current.qshopFailedTemplate ?? ""
    ).trim(),

    bookingSuccessTemplate: String(
      next?.bookingSuccessTemplate ?? current.bookingSuccessTemplate ?? ""
    ).trim(),
    bookingFailedTemplate: String(
      next?.bookingFailedTemplate ?? current.bookingFailedTemplate ?? ""
    ).trim(),

    membershipSuccessTemplate: String(
      next?.membershipSuccessTemplate ?? current.membershipSuccessTemplate ?? ""
    ).trim(),
    membershipFailedTemplate: String(
      next?.membershipFailedTemplate ?? current.membershipFailedTemplate ?? ""
    ).trim(),

    otpTemplate: String(next?.otpTemplate ?? current.otpTemplate ?? "").trim(),

    tournamentSuccessTemplate: String(
      next?.tournamentSuccessTemplate ?? current.tournamentSuccessTemplate ?? ""
    ).trim(),
    tournamentFailedTemplate: String(
      next?.tournamentFailedTemplate ?? current.tournamentFailedTemplate ?? ""
    ).trim(),

    foodSuccessTemplate: String(
      next?.foodSuccessTemplate ?? current.foodSuccessTemplate ?? ""
    ).trim(),
    foodFailedTemplate: String(
      next?.foodFailedTemplate ?? current.foodFailedTemplate ?? ""
    ).trim(),
  };

  localStorage.setItem(WHATSAPP_SETTINGS_KEY, JSON.stringify(merged));
  return merged;
}

function getWhatsappTemplateForLabel(label = "", settings = getWhatsappSettings()) {
  const cleanLabel = String(label || "").trim().toLowerCase();

  if (cleanLabel === "membership_success") {
    return settings.membershipSuccessTemplate || "";
  }

  if (cleanLabel === "membership_failed") {
    return settings.membershipFailedTemplate || "";
  }

  if (cleanLabel === "booking_success") {
    return settings.bookingSuccessTemplate || "";
  }

  if (cleanLabel === "booking_failed") {
    return settings.bookingFailedTemplate || "";
  }

  if (cleanLabel === "qshop_order_success" || cleanLabel === "shop_success") {
    return settings.qshopSuccessTemplate || "";
  }

  if (cleanLabel === "qshop_order_failed" || cleanLabel === "shop_failed") {
    return settings.qshopFailedTemplate || "";
  }

  if (cleanLabel === "food_success") {
  // Food success must always use the approved ITEMS template.
  // Do not depend on Admin Panel/localStorage setting here.
  return "food_success_items";
}



  if (cleanLabel === "food_failed") {
    return settings.foodFailedTemplate || "";
  }

  if (cleanLabel === "tournament_success") {
    return settings.tournamentSuccessTemplate || "";
  }

  if (cleanLabel === "tournament_failed") {
    return settings.tournamentFailedTemplate || "";
  }

  if (
    cleanLabel === "otp" ||
    cleanLabel === "guest_otp" ||
    cleanLabel === "otp_success" ||
    cleanLabel === "guest_access_otp"
  ) {
    return settings.otpTemplate || "";
  }

  return "";
}
function buildMsg91WhatsappPayload(draft, settings = getWhatsappSettings()) {
  const phone = normalizeWhatsappNumber(draft?.phone || "");
  const templateName = String(draft?.templateName || "").trim();
  const senderNumber = String(settings?.senderNumber || draft?.senderNumber || "").trim();

  const templateParams = Array.isArray(draft?.templateParams)
  ? draft.templateParams
      .map((x) => String(x ?? "").trim())
      .filter((x) => x.length > 0)
  : draft?.label === "food_success"
  ? [
      String(draft?.name || draft?.customerName || "Customer").trim() || "Customer",
      String(draft?.orderNo || draft?.orderNumber || "—").trim() || "—",
      String(draft?.itemListText || "Food items").trim() || "Food items",
      String(draft?.total || draft?.amount || "0").trim() || "0",
    ]
  : [];

  return {
    integrated_number: senderNumber,
    content_type: "template",
    payload: {
      to: phone,
      messaging_product: "whatsapp",
      type: "template",
      template: {
        name: templateName,
        language: {
          code: "en",
          policy: "deterministic",
        },
        components: templateParams.length
          ? [
              {
                type: "body",
                parameters: templateParams.map((value) => ({
                  type: "text",
                  text: value,
                })),
              },
            ]
          : [],
      },
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
  if (saved === "live") return "live";
  return "draft_only";
}

function setWhatsappMode(mode) {
  const nextMode =
    mode === "disabled"
      ? "disabled"
      : mode === "live"
      ? "live"
      : "draft_only";

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

async function sendMsg91WhatsappMessage(draft, settings = getWhatsappSettings()) {
  const authKey = String(settings?.authKey || "").trim();
  const senderNumber = String(settings?.senderNumber || "").trim();
  const senderLabel = String(settings?.senderLabel || "").trim();
  const templateName = String(draft?.templateName || "").trim();
  const phone = normalizeWhatsappNumber(draft?.phone || "");

  if (!authKey) {
    return { ok: false, error: "Missing MSG91 auth key." };
  }

  if (!senderNumber) {
    return { ok: false, error: "Missing MSG91 sender number." };
  }

  if (!templateName) {
    return { ok: false, error: "Missing MSG91 template name." };
  }

  if (!phone) {
    return { ok: false, error: "Missing recipient phone number." };
  }

  try {
    const res = await fetch("/api/whatsapp-send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        authKey,
        senderNumber,
        senderLabel,
        phone,
        templateName,
        templateParams: Array.isArray(draft?.templateParams)
          ? draft.templateParams
          : [],
        label: String(draft?.label || "").trim(),
        text: String(draft?.text || "").trim(),
      }),
    });

    let json = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }

    if (!res.ok) {
      return {
        ok: false,
        error:
          json?.error ||
          json?.message ||
          `API route failed with status ${res.status}.`,
        response: json,
      };
    }

    return {
      ok: true,
      response: json,
    };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || "API route request failed.",
    };
  }
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

  const stored = storeLatestWhatsappDraft(finalDraft);

  if (mode === "draft_only") {
    return stored;
  }

  if ((settings.provider || "msg91") !== "msg91") {
    return stored;
  }

  sendMsg91WhatsappMessage(finalDraft, settings)
    .then((result) => {
      localStorage.setItem(
        "qclub_last_whatsapp_send_result",
        JSON.stringify({
          ok: !!result?.ok,
          error: result?.error || "",
          sentAt: new Date().toISOString(),
          label: finalDraft.label || "",
          phone: finalDraft.phone || "",
          templateName: finalDraft.templateName || "",
          response: result?.response || null,
        })
      );
    })
    .catch((error) => {
      localStorage.setItem(
        "qclub_last_whatsapp_send_result",
        JSON.stringify({
          ok: false,
          error: error?.message || "Unknown WhatsApp send error.",
          sentAt: new Date().toISOString(),
          label: finalDraft.label || "",
          phone: finalDraft.phone || "",
          templateName: finalDraft.templateName || "",
        })
      );
    });

  return stored;
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
    const itemListText = itemLines.length
  ? itemLines
      .map((line, index) => `${index + 1}. ${line.replace(/^-+\s*/, "")}`)
      .join("\n")
  : itemCount
  ? `${itemCount} item(s)`
  : "Food items";

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
  const [durationHours, setDurationHours] = useState(1);
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
  function bookingTableDisplayLabel(table, type = "nonmember") {
  if (!table) return "—";

  const amount =
    type === "member"
      ? safeNum(table.memberPricePerHour, safeNum(table.pricePerHour, 0))
      : safeNum(table.pricePerHour, 0);

  return `${table.label || "Table"} — ₹${amount} / hour`;
}

const blockedEntries = (data.booking?.blockedSlots || []).filter(
  (x) =>
    x &&
    x.itemId === selectedTable?.id &&
    x.bookingDate === bookingDate
);

const activeRequestEntries = (data.booking?.requests || []).filter(
  (x) =>
    x &&
    isActiveBookingStatus(x.status) &&
    x.itemId === selectedTable?.id &&
    x.bookingDate === bookingDate
);

const blockedSlotValues = [
  ...blockedEntries.map((x) => x.timeSlot),
  ...activeRequestEntries.map((x) => x.slotLabel || bookingSlotLabel(x.timeSlot || "", x.durationHours || 1)),
];

const slots = bookingTimeSlots(bookingDate, blockedSlotValues, durationHours);

const amount = bookingTotalAmount(
  selectedTable,
  bookingType === "member" ? "member" : "nonmember",
  durationHours
);

  useEffect(() => {
  const firstAvailable = slots.find((s) => !s.disabled)?.value || "";
  if (!slots.some((s) => s.value === timeSlot && !s.disabled)) {
    setTimeSlot(firstAvailable);
  }
}, [bookingDate, itemId, durationHours, blockedSlotValues.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  const upiId = normalizedClubUpiId(data.club?.upiId);
  const upiName = data.club?.upiName || data.club?.name || "The Q Club";
  const upiLink = upiDeepLink({
  pa: upiId,
  pn: upiName,
  am: amount,
  tn:
    bookingType === "member"
      ? `Q Club Booking - ${selectedTable?.label || "Table"} - ${bookingSlotLabel(timeSlot, durationHours)} - Member`
      : `Q Club Booking - ${selectedTable?.label || "Table"} - ${bookingSlotLabel(timeSlot, durationHours)}`,
});

  const qr = qrUrl(upiLink, 280);

  function submitBooking() {
  if (bookingType === "nonmember") {
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

const selectedSlotMeta = slots.find((s) => s.value === timeSlot);

if (selectedSlotMeta?.blocked) {
  alert("This slot is currently blocked. Please unblock it first.");
  return false;
}

const requestedEndTime = bookingEndTime(timeSlot, durationHours);
const requestedEndMinutes = timeToMinutes(requestedEndTime);

if (!requestedEndTime || !Number.isFinite(requestedEndMinutes) || requestedEndMinutes > 23 * 60) {
  alert("Selected booking duration goes beyond closing time. Please choose an earlier slot or shorter duration.");
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
  durationHours,
  endTime: bookingEndTime(timeSlot, durationHours),
  slotLabel: bookingSlotLabel(timeSlot, durationHours),
  note: note.trim(),
  amount,
  status: "pending",
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
    tables,
    requests: [req, ...(data.booking?.requests || [])],
  },
});

  setSubmittedId(req.id);
  setName("");
  setMobile("");
  setTimeSlot("");
  setDurationHours(1);
  
  setNote("");
  alert("Booking request submitted. Please complete payment / verification.");
  return true;
}
function addBookingTable() {
  if (!admin) return alert("Admin only");

  const label = prompt("Table / Game name:", "New Table");
  if (!label) return;

  const nonMemberPrice = prompt("NON-MEMBER hourly rate:", "0");
  if (nonMemberPrice === null) return;

  const memberPrice = prompt("MEMBER hourly rate:", nonMemberPrice);
  if (memberPrice === null) return;

  const nextTable = {
    id: `tbl_${Date.now()}`,
    label: label.trim(),
    pricePerHour: safeNum(nonMemberPrice, 0),
    memberPricePerHour: safeNum(memberPrice, 0),
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

  const nonMemberPrice = prompt(
    "Edit NON-MEMBER hourly rate:",
    String(current.pricePerHour ?? 0)
  );
  if (nonMemberPrice === null) return;

  const memberPrice = prompt(
    "Edit MEMBER hourly rate:",
    String(current.memberPricePerHour ?? current.pricePerHour ?? 0)
  );
  if (memberPrice === null) return;

  const nextTables = tables.map((t) =>
    t.id === tableId
      ? {
          ...t,
          label: label.trim(),
          pricePerHour: safeNum(nonMemberPrice, 0),
          memberPricePerHour: safeNum(memberPrice, 0),
        }
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
    x.timeSlot === bookingSlotLabel(timeSlot, durationHours)
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
        timeSlot: bookingSlotLabel(timeSlot, durationHours),
        durationHours,
        endTime: bookingEndTime(timeSlot, durationHours),
        reason: reason.trim(),
        createdAt: Date.now(),
      },
      ...(data.booking?.blockedSlots || []),
    ],
  },
});
  alert("Slot blocked successfully.");
}

function unblockSelectedSlot(slotValue = bookingSlotLabel(timeSlot, durationHours)) {
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

  const requests = (data.booking?.requests || []).filter(
  (r) => !["failed", "booking_failed", "member_rejected", "rejected"].includes(String(r?.status || "").toLowerCase())
);

  return (
    <>
            <PageShell
        title={data.club?.bookPageTitle || "Book Table"}
        subtitle={data.club?.bookPageSubtitle || "Quick Booking + Secure Online Payment"}
        right={
          admin ? (
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  const bookPageTitle = prompt(
                    "Book page title:",
                    data.club?.bookPageTitle || "Book Table"
                  );
                  if (bookPageTitle === null) return;

                  const bookPageSubtitle = prompt(
                    "Book page subtitle:",
                    data.club?.bookPageSubtitle || "Quick Booking + Secure Online Payment"
                  );
                  if (bookPageSubtitle === null) return;

                  commit({
                    ...data,
                    club: {
                      ...data.club,
                      bookPageTitle: bookPageTitle.trim(),
                      bookPageSubtitle: bookPageSubtitle.trim(),
                    },
                  });
                }}
              >
                Edit Page Text
              </button>

              <Link className="btn" to="/admin-panel">
                Open Admin Panel
              </Link>
            </div>
          ) : null
        }
      />

            <div className="container" style={{ marginTop: -14 }}>
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
    {`${t.label.split("₹")[0].trim()} â€“ ₹${bookingAmountFor(
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
  <option
    key={s.value}
    value={s.value}
    disabled={admin ? (s.disabled && !s.blocked) : s.disabled}
  >
    {bookingSlotLabel(s.label, durationHours)}
    {s.disabled ? " (Unavailable)" : ""}
    {admin && s.blocked ? " (Blocked)" : ""}
  </option>
))}
                </select>
              </div>
              <div className="cols-6">
  <label className="lbl">Duration</label>
  <select
    value={durationHours}
    onChange={(e) => setDurationHours(Number(e.target.value))}
  >
    <option value={1}>1 hour</option>
    <option value={2}>2 hours</option>
    <option value={3}>3 hours</option>
    <option value={4}>4 hours</option>
    <option value={5}>5 hours</option>
  </select>
</div>
<div className="cols-12">
  <div
    style={{
      marginTop: 4,
      padding: 12,
      border: "1px solid rgba(255,255,255,.10)",
      borderRadius: 14,
      background: "rgba(255,255,255,.03)",
      display: "grid",
      gap: 6,
    }}
  >
    <div style={{ fontWeight: 800 }}>
      Booking Window: {timeSlot ? bookingSlotLabel(timeSlot, durationHours) : "Select start time"}
    </div>

    <div className="muted">
      Duration: {durationHours} {durationHours === 1 ? "hour" : "hours"}
    </div>

    <div className="muted">
      Payable Amount: ₹{amount}
    </div>

    <div
      style={{
        marginTop: 4,
        fontSize: 13,
        lineHeight: 1.5,
        color: "rgba(255,220,160,.92)",
      }}
    >
      Unless there is a technical issue at the Club&apos;s end, bookings are non-refundable.
    </div>
  </div>
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
    {entry.timeSlot || bookingSlotLabel(entry.startTime || "", entry.durationHours || 1)} ×
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
  localStorage.setItem(
  "qclub_booking_slot",
  timeSlot ? bookingSlotLabel(timeSlot, durationHours) : ""
);
  localStorage.setItem("qclub_booking_amount", String(amount || ""));
  const ok = submitBooking();
  if (!ok) return;

  startPayment(
  amount,
  mobile.trim(),
  name.trim(),
  {
    context: "booking",
    customer_name: name.trim(),
    mobile: mobile.trim(),
    table_label: selectedTable?.label || "",
    booking_date: bookingDate || "",
    booking_slot: timeSlot ? bookingSlotLabel(timeSlot, durationHours) : "",
    booking_amount: String(amount || ""),
  }
);
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
                {r.slotLabel || bookingSlotLabel(r.timeSlot || "", r.durationHours || 1)}
                <div className="muted">
  Duration: {r.durationHours || 1} {(r.durationHours || 1) === 1 ? "hour" : "hours"} â€¢ Amount: ₹{r.amount || 0}
</div>
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
  const [showMembershipNote, setShowMembershipNote] = useState(false);
  const [openMembershipTiers, setOpenMembershipTiers] = useState({});

  const tiers = data.memberships || [];
  const selectedTier =
    tiers.find((t) => t.id === selectedTierId) || tiers[0] || null;

    const membershipNote =
    data.club?.membershipNote ||
    "PLEASE NOTE : Membership at The Q Club provides access to club facilities and member privileges during the validity period. Membership is personal and non-transferable. Member privileges reset daily at 00:00 hours. Access to game tables is subject to availability. Complimentary play sessions may be offered to members at the discretion of the club. Pool table: up to 15 minutes. Mini Snooker: up to 20 minutes. Snooker table: up to 30 minutes. Complimentary sessions are generally available during 11:00 AM â€“ 5:00 PM depending on table availability. The Q Club reserves the right to modify membership privileges, availability, or timings.";

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

  function toggleTierOpen(id) {
    setOpenMembershipTiers((prev) => ({
      ...prev,
      [id]: !prev[id],
    }));
  }

  return (
    <>
            <PageShell
        title={data.club?.membershipPageTitle || "Membership"}
        subtitle={data.club?.membershipPageSubtitle || "Apply for Membership with Secure Online Payment"}
        right={
          admin ? (
            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn"
                onClick={() => {
                  const membershipPageTitle = prompt(
                    "Membership page title:",
                    data.club?.membershipPageTitle || "Membership"
                  );
                  if (membershipPageTitle === null) return;

                  const membershipPageSubtitle = prompt(
                    "Membership page subtitle:",
                    data.club?.membershipPageSubtitle || "Apply for Membership with Secure Online Payment"
                  );
                  if (membershipPageSubtitle === null) return;

                  commit({
                    ...data,
                    club: {
                      ...data.club,
                      membershipPageTitle: membershipPageTitle.trim(),
                      membershipPageSubtitle: membershipPageSubtitle.trim(),
                    },
                  });
                }}
              >
                Edit Page Text
              </button>

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
          <button
            type="button"
            onClick={() => setShowMembershipNote((v) => !v)}
            style={{
              width: "100%",
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 12,
              background: "transparent",
              border: "none",
              color: "#eaf0ff",
              padding: 0,
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <div>
              <div className="membershipNoteLabel">Please Note</div>
              <div className="muted" style={{ marginTop: 6 }}>
                Membership note, rules and member privileges
              </div>
            </div>

            <div
              style={{
                minWidth: 34,
                height: 34,
                borderRadius: 999,
                display: "grid",
                placeItems: "center",
                border: "1px solid rgba(255,255,255,.10)",
                background: "rgba(255,255,255,.04)",
                fontSize: 18,
                fontWeight: 800,
              }}
            >
              {showMembershipNote ? "âˆ’" : "+"}
            </div>
          </button>

          {showMembershipNote ? (
            <div style={{ marginTop: 14 }}>
              <div className="membershipNoteText">{membershipNote}</div>

              {admin ? (
                <div style={{ marginTop: 12 }}>
                  <button className="btn" onClick={editMembershipNote}>
                    Edit
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

                <div className="grid" style={{ marginTop: 14 }}>
          {(tiers || []).map((tier) => {
            const isOpen = !!openMembershipTiers[tier.id];

            return (
              <div className="card cols-6 membershipTierCard" key={tier.id}>
                <button
                  type="button"
                  onClick={() => toggleTierOpen(tier.id)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 12,
                    background: "transparent",
                    border: "none",
                    color: "#eaf0ff",
                    padding: 0,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <div>
                    <h2 style={{ marginBottom: 8 }}>{tier.tier}</h2>
                    <div className="badge">
                      <span className="dot" /> ₹{safeNum(tier.price, 0)} (fixed)
                    </div>
                  </div>

                  <div
                    style={{
                      minWidth: 34,
                      height: 34,
                      borderRadius: 999,
                      display: "grid",
                      placeItems: "center",
                      border: "1px solid rgba(255,255,255,.10)",
                      background: "rgba(255,255,255,.04)",
                      fontSize: 18,
                      fontWeight: 800,
                    }}
                  >
                    {isOpen ? "âˆ’" : "+"}
                  </div>
                </button>

                {isOpen ? (
                  <>
                    <ul style={{ marginTop: 14 }}>
                      {(tier.perks || []).map((perk) => (
                        <li key={perk}>{perk}</li>
                      ))}
                    </ul>

                    <div className="row" style={{ marginTop: 14, gap: 8, flexWrap: "wrap" }}>
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
                  </>
                ) : null}
              </div>
            );
          })}

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
    
    const membershipValidUntil = (() => {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d.toISOString().slice(0, 10);
})();

await startPayment(
  selectedTier ? safeNum(selectedTier.price, 0) : 0,
  mobile.trim(),
  applicantName.trim(),
  {
    context: "membership",
    customer_name: applicantName.trim(),
    mobile: mobile.trim(),
    tier: selectedTier?.tier || "",
    tshirt_size: tshirtSize || "",
    valid_until: membershipValidUntil,
  }
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

    startPayment(
  registrationFee,
  mobile.trim(),
  playerName.trim(),
  {
    context: "tournament",
    customer_name: playerName.trim(),
    mobile: mobile.trim(),
    tournament_id: currentTournament.id || "",
    tournament_name: currentTournament.name || "",
    tournament_fee: String(registrationFee || 0),
    tournament_player_id: playerId || "",
  }
);
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
          âœ•
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
function Fixtures({ data, admin, staffAdmin, commit, onOpenPlayer }) {
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
const canPrintFixtures = admin || staffAdmin;

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
                  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <div className="muted">
                      {selectedTournament.matches?.length || 0} fixtures
                    </div>
                    {canPrintFixtures ? (
                      <button
                        className="btn"
                        type="button"
                        onClick={() =>
                          printFixtureSlip({
                            tournament: selectedTournament,
                            matches: selectedTournament.matches || [],
                            players,
                          })
                        }
                        disabled={!selectedTournament.matches?.length}
                      >
                        Print Fixtures
                      </button>
                    ) : null}
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


function fixtureThermalPrintHtml({ tournament = null, matches = [], players = [] }) {
  const safeTournamentName = String(tournament?.name || "Tournament Fixtures").trim() || "Tournament Fixtures";
  const safeGame = tournamentGameKey(tournament?.game) === "pool" ? "Pool" : "Snooker";
  const printedAt = new Date().toLocaleString();

  function resolvePlayerName(id) {
    return players.find((p) => p.id === id)?.name || "TBD";
  }

  const sortedMatches = [...(matches || [])].sort((a, b) => {
    const roundDiff = Number(a?.round || 0) - Number(b?.round || 0);
    if (roundDiff !== 0) return roundDiff;
    return Number(a?.matchNo || 0) - Number(b?.matchNo || 0);
  });

  const grouped = sortedMatches.reduce((acc, match) => {
    const round = Number(match?.round || 1) || 1;
    if (!acc[round]) acc[round] = [];
    acc[round].push(match);
    return acc;
  }, {});

  const roundsHtml = Object.keys(grouped)
    .sort((a, b) => Number(a) - Number(b))
    .map((roundKey) => {
      const roundMatches = grouped[roundKey] || [];
      const matchHtml = roundMatches
        .map((match, index) => {
          const left = resolvePlayerName(match?.p1);
          const right = resolvePlayerName(match?.p2);
          const matchLabel = match?.matchNo ? `Match ${match.matchNo}` : `Match ${index + 1}`;
          const noteBits = [];
          if (safeGame === "Snooker") {
            const h1 = Number(match?.handicap1 || 0);
            const h2 = Number(match?.handicap2 || 0);
            if (h1 || h2) noteBits.push(`HC ${h1}-${h2}`);
          }
          if (String(match?.notes || "").trim()) {
            noteBits.push(String(match.notes).trim());
          }
          const noteHtml = noteBits.length
            ? `<div class="sub">${noteBits.join(" â€¢ ")}</div>`
            : "";
          return `
            <div class="match">
              <div class="matchLabel">${matchLabel}</div>
              <div class="pair">${left}</div>
              <div class="vs">vs</div>
              <div class="pair">${right}</div>
              ${noteHtml}
            </div>
          `;
        })
        .join("");

      return `
        <div class="roundBlock">
          <div class="roundTitle">Round ${roundKey}</div>
          ${matchHtml}
        </div>
      `;
    })
    .join("");

  return `
  <html>
    <head>
      <title>${safeTournamentName}</title>
      <style>
        @page { size: 80mm auto; margin: 4mm; }
        html, body {
          margin: 0;
          padding: 0;
          background: #fff;
          color: #111;
          font-family: Arial, sans-serif;
          width: 72mm;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .wrap { padding: 4mm; }
        .center { text-align: center; }
        .title { font-size: 18px; font-weight: 700; }
        .subline { font-size: 12px; margin-top: 2px; }
        .line { border-top: 1px dashed #888; margin: 8px 0; }
        .meta { font-size: 12px; margin: 3px 0; }
        .roundBlock { margin-top: 10px; }
        .roundTitle { font-size: 14px; font-weight: 700; margin-bottom: 6px; }
        .match { padding: 6px 0; border-bottom: 1px dashed #cfcfcf; }
        .match:last-child { border-bottom: none; }
        .matchLabel { font-size: 11px; font-weight: 700; margin-bottom: 3px; }
        .pair { font-size: 13px; font-weight: 700; line-height: 1.35; }
        .vs { font-size: 11px; margin: 2px 0; }
        .sub { font-size: 10px; margin-top: 4px; color: #444; }
        .footer { margin-top: 12px; font-size: 11px; text-align: center; }
      </style>
    </head>
    <body>
      <div class="wrap">
        <div class="center title">The Q Club</div>
        <div class="center subline">Pasighat</div>
        <div class="line"></div>
        <div class="center" style="font-size:15px;font-weight:700;">${safeTournamentName}</div>
        <div class="center subline">${safeGame} Fixtures</div>
        <div class="meta"><b>Printed:</b> ${printedAt}</div>
        <div class="meta"><b>Total Fixtures:</b> ${(matches || []).length}</div>
        <div class="line"></div>
        ${roundsHtml || '<div class="meta">No fixtures generated yet.</div>'}
        <div class="line"></div>
        <div class="footer">Best of luck to all players</div>
      </div>
    </body>
  </html>`;
}

function printFixtureSlip({ tournament = null, matches = [], players = [] }) {
  const html = fixtureThermalPrintHtml({ tournament, matches, players });
  const win = window.open("", "_blank", "width=420,height=760");

  if (!win) {
    alert("Popup blocked. Please allow popups for printing.");
    return;
  }

  win.document.open();
  win.document.write(html);
  win.document.close();

  win.onload = () => {
    win.focus();
    win.print();
  };
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
function StaffWalkinBookings({ data, admin, staffAdmin, commit }) {
  if (!admin && !staffAdmin) {
    return (
      <>
        <PageShell title="Walk-in Bookings" subtitle="Restricted access" />
        <div className="container">
          <div className="card">
            <div className="muted">Access denied.</div>
          </div>
        </div>
      </>
    );
  }
  const tables = data.booking?.tables || [];
const requests = data.booking?.requests || [];

const blockedSlots = data.booking?.blockedSlots || [];
const today = todayIso();
const [walkinName, setWalkinName] = useState("");
const [walkinMobile, setWalkinMobile] = useState("");
const [walkinItemId, setWalkinItemId] = useState(data.booking?.tables?.[0]?.id || "");
const [walkinDate, setWalkinDate] = useState(todayIso());
const [walkinTimeSlot, setWalkinTimeSlot] = useState("");
const [walkinDurationHours, setWalkinDurationHours] = useState(1);
const [walkinNote, setWalkinNote] = useState("");
const [walkinBookingType, setWalkinBookingType] = useState("nonmember");
const [walkinMemberName, setWalkinMemberName] = useState("");
const activeRegistryMembers = Array.isArray(data.memberRegistry)
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

const memberOptions = [...activeRegistryMembers, ...membersPageEntries].filter(
  (m, idx, arr) =>
    String(m.name || "").trim() &&
    arr.findIndex(
      (x) =>
        String(x.name || "").trim().toLowerCase() ===
        String(m.name || "").trim().toLowerCase()
    ) === idx
);
const selectedWalkinItem =
  tables.find((t) => t.id === walkinItemId) || tables[0] || null;
  function bookingTableDisplayLabel(table, type = "nonmember") {
  if (!table) return "—";

  const amount =
    type === "member"
      ? safeNum(table.memberPricePerHour, safeNum(table.pricePerHour, 0))
      : safeNum(table.pricePerHour, 0);

  return `${table.label || "Table"} — ₹${amount} / hour`;
}

const walkinBlockedEntries = blockedSlots.filter(
  (x) =>
    x &&
    x.itemId === selectedWalkinItem?.id &&
    x.bookingDate === walkinDate
);

const walkinActiveRequestEntries = requests.filter(
  (x) =>
    x &&
    isActiveBookingStatus(x.status) &&
    x.itemId === selectedWalkinItem?.id &&
    x.bookingDate === walkinDate
);

const walkinBlockedSlotValues = [
  ...walkinBlockedEntries.map((x) => x.timeSlot),
  ...walkinActiveRequestEntries.map(
    (x) => x.slotLabel || bookingSlotLabel(x.timeSlot || "", x.durationHours || 1)
  ),
];

const walkinSlots = bookingTimeSlots(
  walkinDate,
  walkinBlockedSlotValues,
  walkinDurationHours
);

const walkinAmount = bookingTotalAmount(
  selectedWalkinItem,
  walkinBookingType === "member" ? "member" : "nonmember",
  walkinDurationHours
);
useEffect(() => {
  const firstAvailable = walkinSlots.find((s) => !s.disabled)?.value || "";

  if (!walkinSlots.some((s) => s.value === walkinTimeSlot && !s.disabled)) {
    setWalkinTimeSlot(firstAvailable);
  }
}, [
  walkinDate,
  walkinItemId,
  walkinDurationHours,
  walkinBlockedSlotValues.join("|"),
]); // eslint-disable-line react-hooks/exhaustive-deps
function saveWalkinBooking() {
  if (walkinBookingType === "member") {
  if (!walkinMemberName.trim()) {
    alert("Please select a member.");
    return;
  }
} else {
  if (!walkinName.trim()) {
    alert("Please enter customer name.");
    return;
  }
}

  if (!walkinMobile.trim()) {
    alert("Please enter mobile number");
    return false;
  }

  if (!selectedWalkinItem) {
    alert("Please select a table / game");
    return false;
  }

  if (!walkinDate) {
    alert("Please select date");
    return false;
  }

  if (walkinDate < todayIso()) {
    alert("Past dates are not allowed");
    return false;
  }

  if (!walkinTimeSlot) {
    alert("Please select a start time");
    return false;
  }

  const requestedEndTime = bookingEndTime(walkinTimeSlot, walkinDurationHours);
  const requestedEndMinutes = timeToMinutes(requestedEndTime);

  if (
    !requestedEndTime ||
    !Number.isFinite(requestedEndMinutes) ||
    requestedEndMinutes > 23 * 60
  ) {
    alert("Selected booking duration goes beyond closing time.");
    return false;
  }

  const req = {
    id: uid(),
    name:
  walkinBookingType === "member"
    ? walkinMemberName.trim()
    : walkinName.trim(),
mobile: walkinMobile.trim(),
memberId:
  walkinBookingType === "member"
    ? walkinMemberName.trim()
    : "",
bookingType:
  walkinBookingType === "member" ? "member" : "nonmember",
    source: "staff_walkin",
    createdBy: admin ? "admin" : "staff",
    paymentStatus: "unpaid",
    itemId: selectedWalkinItem.id,
    itemLabel: selectedWalkinItem.label,
    bookingDate: walkinDate,
    timeSlot: walkinTimeSlot,
    durationHours: walkinDurationHours,
    endTime: bookingEndTime(walkinTimeSlot, walkinDurationHours),
    slotLabel: bookingSlotLabel(walkinTimeSlot, walkinDurationHours),
    note: walkinNote.trim(),
    amount: walkinAmount,
    status: "verified",
    createdAt: Date.now(),
  };

  if (hasBookingConflict(requests, req)) {
    alert("This slot is already booked / blocked for this item.");
    return false;
  }

  const walkinWhatsappDraft = buildWhatsappDraft({
    phone: req.mobile,
    label: "booking_success",
    text: buildBookingWhatsappText({
      name: req.name,
      table: req.itemLabel,
      bookedAt: new Date().toISOString(),
      bookingDate: req.bookingDate,
      bookingSlot: req.slotLabel,
      amount: req.amount,
    }),
  });

  walkinWhatsappDraft.templateParams = [
    req.name || "Customer",
    `WI-${String(req.id || "").slice(-5)}`,
    req.itemLabel || "Booked Table",
    req.bookingDate || "—",
    req.slotLabel || "—",
  ];

  commit({
    ...data,
    booking: {
      ...(data.booking || {}),
      tables,
      requests: [req, ...(data.booking?.requests || [])],
      blockedSlots,
    },
    whatsappJobs: [
      ...(data.whatsappJobs || []),
      createWhatsappJob("booking_success", walkinWhatsappDraft),
    ],
  });

  setWalkinBookingType("nonmember");
setWalkinMemberName("");
setWalkinName("");
setWalkinMobile("");
setWalkinDate(today);
setWalkinTimeSlot("");
setWalkinDurationHours(1);
setWalkinNote("");

  alert("Walk-in booking saved successfully.");
  return true;
}
const todaysRequests = requests.filter(
  (r) =>
    String(r?.bookingDate || "") === today &&
    String(r?.source || "") === "staff_walkin"
);
function updateWalkinPaymentStatus(id, paymentStatus) {
  commit({
    ...data,
    booking: {
      ...(data.booking || {}),
      tables,
      blockedSlots,
      requests: requests.map((r) =>
        r.id === id ? { ...r, paymentStatus } : r
      ),
    },
  });
}
function printWalkinReceipt(entry) {
  if (!entry) return;

  const receiptNo = `WALKIN-${String(entry.id || "").slice(-6).toUpperCase()}`;
  const bookingWindow =
    entry.slotLabel ||
    bookingSlotLabel(entry.timeSlot || "", entry.durationHours || 1) ||
    "—";

  const paidLabel =
    entry.paymentStatus === "paid_cash"
      ? "Paid by Cash"
      : entry.paymentStatus === "paid_upi"
      ? "Paid by UPI"
      : "Unpaid";

  const bookingTypeLabel =
    entry.bookingType === "member" ? "Member Booking" : "Walk-in Booking";

  const nowText = new Date().toLocaleString("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });

  const html = `
  <html>
    <head>
      <title>${receiptNo}</title>
      <style>
        @page {
          size: 80mm auto;
          margin: 4mm;
        }

        html, body {
          margin: 0;
          padding: 0;
          background: #fff;
          color: #111;
          font-family: Arial, sans-serif;
          width: 72mm;
        }

        body {
          padding: 0;
        }

        .receipt {
          width: 72mm;
          margin: 0 auto;
          padding: 2mm 0 4mm;
          box-sizing: border-box;
        }

        .topline {
          display: flex;
          justify-content: space-between;
          font-size: 10px;
          font-weight: 700;
          margin-bottom: 6px;
        }

        .brand {
          text-align: center;
          margin-bottom: 8px;
        }

        .brand .title {
          font-size: 24px;
          font-weight: 900;
          letter-spacing: 1px;
          line-height: 1.05;
        }

        .brand .sub {
          font-size: 16px;
          font-weight: 800;
          margin-top: 2px;
        }

        .brand .tag {
          font-size: 11px;
          margin-top: 3px;
          color: #333;
        }

        .rule {
          border-top: 2px solid #111;
          margin: 8px 0;
        }

        .sectionTitle {
          font-size: 18px;
          font-weight: 900;
          text-align: left;
          margin: 2px 0;
        }

        .sectionSub {
          font-size: 11px;
          color: #333;
          margin-bottom: 4px;
        }

        .row {
          margin: 5px 0;
          font-size: 13px;
          line-height: 1.35;
          word-break: break-word;
        }

        .label {
          font-weight: 800;
        }

        .amount {
          font-size: 18px;
          font-weight: 900;
          margin-top: 8px;
        }

        .payment {
          font-size: 14px;
          font-weight: 800;
          margin-top: 4px;
        }

        .footer {
          margin-top: 10px;
          padding-top: 8px;
          border-top: 1px dashed #777;
          text-align: center;
          font-size: 12px;
          line-height: 1.5;
        }

        .strong {
          font-weight: 900;
        }
      </style>
    </head>
    <body>
      <div class="receipt">
        <div class="topline">
          <span>${entry.bookingDate || "-"}</span>
          <span>${receiptNo}</span>
        </div>

        <div class="brand">
          <div class="title">THE Q CLUB</div>
          <div class="sub">PASIGHAT</div>
          <div class="tag">Premium Indoor Gaming Lounge</div>
        </div>

        <div class="rule"></div>

        <div class="sectionTitle">BOOKING RECEIPT</div>
        <div class="sectionSub">${bookingTypeLabel}</div>

        <div class="rule"></div>

        <div class="row"><span class="label">Printed:</span> ${nowText}</div>
        <div class="row"><span class="label">Name:</span> ${entry.name || "-"}</div>
        <div class="row"><span class="label">Mobile:</span> ${entry.mobile || "-"}</div>
        <div class="row"><span class="label">Date:</span> ${entry.bookingDate || "-"}</div>
        <div class="row"><span class="label">Time:</span> ${bookingWindow}</div>
        <div class="row"><span class="label">Table/Game:</span> ${entry.itemLabel || "-"}</div>
        <div class="row"><span class="label">Duration:</span> ${entry.durationHours || 1} hour(s)</div>
        <div class="row"><span class="label">Notes:</span> ${entry.note || "—"}</div>

        <div class="amount">AMOUNT: ₹${entry.amount || 0}</div>
        <div class="payment">PAYMENT: ${paidLabel}</div>

        <div class="footer">
          <div>Thank you for visiting <span class="strong">The Q Club</span></div>
          <div>Please keep this receipt</div>
          <div>Have a great game</div>
        </div>
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
    <>
      <PageShell
        title="Walk-in Bookings"
        subtitle="Staff booking and session management"
      />

      <div className="container">
        <div className="card">
  <h2 style={{ marginTop: 0 }}>Walk-in Bookings</h2>
  <div className="muted" style={{ marginBottom: 14 }}>
    Staff booking and session management using the same shared booking database.
  </div>

  <div className="grid">
    <div className="cols-3">
  <label className="lbl">Booking Type</label>
  <select
    value={walkinBookingType}
    onChange={(e) => {
      const nextType = e.target.value;
      setWalkinBookingType(nextType);
      setWalkinMemberName("");
      setWalkinName("");
      setWalkinMobile("");
    }}
  >
    <option value="nonmember">Non-member</option>
    <option value="member">Member</option>
  </select>
</div>

<div className="cols-9">
  <label className="lbl">
    {walkinBookingType === "member" ? "Member" : "Customer Name"}
  </label>

  {walkinBookingType === "member" ? (
    <select
      value={walkinMemberName}
      onChange={(e) => {
        const selectedName = e.target.value;
        setWalkinMemberName(selectedName);

        const found = memberOptions.find(
          (m) => String(m.name || "").trim() === selectedName
        );

        setWalkinName(selectedName || "");
        setWalkinMobile(found?.mobile || "");
      }}
    >
      <option value="">Select member</option>
      {memberOptions.map((m) => (
        <option key={m.id} value={m.name}>
          {m.name}
          {m.tier ? ` — ${m.tier}` : ""}
        </option>
      ))}
    </select>
  ) : (
    <input
      value={walkinName}
      onChange={(e) => setWalkinName(e.target.value)}
      placeholder="Walk-in customer name"
    />
  )}
</div>

    <div className="cols-6">
  <label className="lbl">Mobile Number</label>
  <input
    value={walkinMobile}
    onChange={(e) => setWalkinMobile(e.target.value)}
    placeholder={
      walkinBookingType === "member"
        ? "Member mobile"
        : "Customer mobile"
    }
  />
</div>

    <div className="cols-6">
      <label className="lbl">Table / Game</label>
      <select
        value={walkinItemId}
        onChange={(e) => setWalkinItemId(e.target.value)}
      >
        {tables.map((t) => (
  <option key={t.id} value={t.id}>
    {bookingTableDisplayLabel(t, walkinBookingType)}
  </option>
))}
      </select>
    </div>

    <div className="cols-3">
      <label className="lbl">Date</label>
      <input
        type="date"
        value={walkinDate}
        onChange={(e) => setWalkinDate(e.target.value)}
      />
    </div>

    <div className="cols-3">
      <label className="lbl">Duration</label>
      <select
        value={walkinDurationHours}
        onChange={(e) => setWalkinDurationHours(Number(e.target.value))}
      >
        <option value={1}>1 hour</option>
        <option value={2}>2 hours</option>
        <option value={3}>3 hours</option>
        <option value={4}>4 hours</option>
        <option value={5}>5 hours</option>
      </select>
    </div>

    <div className="cols-6">
      <label className="lbl">Start Time</label>
      <select
        value={walkinTimeSlot}
        onChange={(e) => setWalkinTimeSlot(e.target.value)}
      >
        {walkinSlots.map((s) => (
          <option key={s.value} value={s.value} disabled={s.disabled}>
            {bookingSlotLabel(s.label, walkinDurationHours)}
            {s.disabled ? " (Unavailable)" : ""}
          </option>
        ))}
      </select>
    </div>

    <div className="cols-6">
      <label className="lbl">Notes</label>
      <input
        value={walkinNote}
        onChange={(e) => setWalkinNote(e.target.value)}
        placeholder="Optional note"
      />
    </div>

    <div className="cols-12">
      <div
        style={{
          marginTop: 4,
          padding: 12,
          border: "1px solid rgba(255,255,255,.10)",
          borderRadius: 14,
          background: "rgba(255,255,255,.03)",
          display: "grid",
          gap: 6,
        }}
      >
        <div className="cols-12">
  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
    <button
      className="btn primary"
      type="button"
      onClick={saveWalkinBooking}
    >
      Save Walk-in Booking
    </button>
  </div>
</div>
        <div style={{ fontWeight: 800 }}>
          Booking Window:{" "}
          {walkinTimeSlot
            ? bookingSlotLabel(walkinTimeSlot, walkinDurationHours)
            : "Select start time"}
        </div>

        <div className="muted">
          Duration: {walkinDurationHours}{" "}
          {walkinDurationHours === 1 ? "hour" : "hours"}
        </div>

        <div className="muted">
          Payable Amount: ₹{walkinAmount}
        </div>
      </div>
    </div>

    <div className="card cols-4">
      <div className="infoLabel">Booking Items</div>
      <div className="infoValue">{tables.length}</div>
    </div>

    <div className="card cols-4">
      <div className="infoLabel">Booking Requests</div>
      <div className="infoValue">{requests.length}</div>
    </div>

    <div className="card cols-4">
      <div className="infoLabel">Blocked Slots</div>
      <div className="infoValue">{blockedSlots.length}</div>
    </div>
  </div>
</div>
<div className="card" style={{ marginTop: 16 }}>
  <h3 style={{ marginTop: 0 }}>Today&apos;s Shared Booking Records</h3>

  {todaysRequests.length === 0 ? (
    <div className="muted">No booking records for today.</div>
  ) : (
    <table>
      <thead>
  <tr>
    <th>Name</th>
    <th>Item</th>
    <th>Window</th>
    <th>Status</th>
    <th>Payment</th>
    <th>Source</th>
    <th>Amount</th>
    <th>Admin</th>
  </tr>
</thead>
      <tbody>
        {todaysRequests.map((r) => (
          <tr key={r.id}>
  <td>{r.name || "—"}</td>
  <td>{r.itemLabel || "—"}</td>
  <td>{r.slotLabel || bookingSlotLabel(r.timeSlot || "", r.durationHours || 1)}</td>
  <td>{bookingStatusLabel(r.status)}</td>
  <td>
    <select
      value={r.paymentStatus || "unpaid"}
      onChange={(e) => updateWalkinPaymentStatus(r.id, e.target.value)}
    >
      <option value="unpaid">unpaid</option>
      <option value="paid_cash">paid_cash</option>
      <option value="paid_upi">paid_upi</option>
    </select>
  </td>
  <td>{r.source || "—"}</td>
<td>₹{r.amount || 0}</td>
<td>
  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
    <button
      className="btn"
      type="button"
      onClick={() => printWalkinReceipt(r)}
    >
      Print Receipt
    </button>

    {admin ? (
      <button
        className="btn danger"
        type="button"
        onClick={() => deleteWalkinBooking(r.id)}
      >
        Delete
      </button>
    ) : (
      "—"
    )}
  </div>
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
function deleteWalkinBooking(id) {
  const ok = confirm("Delete this walk-in booking?");
  if (!ok) return;

  commit({
    ...data,
    booking: {
      ...(data.booking || {}),
      tables,
      blockedSlots,
      requests: requests.filter((r) => r.id !== id),
    },
  });
}
function InventoryMaintenance({ data, admin, staffAdmin, commit }) {
  if (!admin && !staffAdmin) {
    return (
      <>
        <PageShell title="Inventory" subtitle="Restricted access" />
        <div className="container">
          <div className="card">
            <div className="muted">Access denied.</div>
          </div>
        </div>
      </>
    );
  }
const inventoryItems = Array.isArray(data.inventoryItems) ? data.inventoryItems : [];
const [itemName, setItemName] = useState("");
const [itemCategory, setItemCategory] = useState("");
const [itemUnit, setItemUnit] = useState("");
const [itemQty, setItemQty] = useState("");
const [itemMinQty, setItemMinQty] = useState("");
const [itemNote, setItemNote] = useState("");
const [qtyDrafts, setQtyDrafts] = useState({});
function saveInventoryItem() {
  if (!itemName.trim()) {
    alert("Please enter item name");
    return false;
  }

  const nextItem = {
  id: uid(),
  name: itemName.trim(),
  category: itemCategory.trim(),
  unit: itemUnit.trim(),
  qty: safeNum(itemQty, 0),
  minQty: safeNum(itemMinQty, 0),
  note: itemNote.trim(),
  createdAt: Date.now(),
  movements: [
    {
      id: uid(),
      type: "opening",
      qty: safeNum(itemQty, 0),
      note: "Opening stock",
      createdAt: Date.now(),
    },
  ],
};

  commit({
    ...data,
    inventoryItems: [nextItem, ...inventoryItems],
  });

  setItemName("");
  setItemCategory("");
  setItemUnit("");
  setItemQty("");
  setItemMinQty("");
  setItemNote("");

  alert("Inventory item saved.");
  return true;
}
function deleteInventoryItem(id) {
  const ok = confirm("Delete this inventory item?");
  if (!ok) return;

  commit({
    ...data,
    inventoryItems: inventoryItems.filter((item) => item.id !== id),
  });
}
function updateInventoryQty(id, nextQty) {
  const currentItem = inventoryItems.find((item) => item.id === id);
  if (!currentItem) return;

  const previousQty = safeNum(currentItem.qty, 0);
  const updatedQty = safeNum(nextQty, 0);

  if (previousQty === updatedQty) return;

  const ok = confirm(
    `Confirm stock change for "${currentItem.name || "item"}"?\n\nCurrent Qty: ${previousQty}\nNew Qty: ${updatedQty}\n\nOnce confirmed, staff cannot reverse this action. In case of mistake, contact main admin.`
  );
  if (!ok) return;

  const delta = updatedQty - previousQty;

  commit({
    ...data,
    inventoryItems: inventoryItems.map((item) => {
      if (item.id !== id) return item;

      return {
        ...item,
        qty: updatedQty,
        movements: [
          {
            id: uid(),
            type: delta > 0 ? "stock_in" : "stock_out",
            qty: Math.abs(delta),
            note: "Confirmed qty update",
            createdAt: Date.now(),
          },
          ...(Array.isArray(item.movements) ? item.movements : []),
        ],
      };
    }),
  });
}
function updateInventoryMinQty(id, nextMinQty) {
  commit({
    ...data,
    inventoryItems: inventoryItems.map((item) =>
      item.id === id
        ? { ...item, minQty: safeNum(nextMinQty, 0) }
        : item
    ),
  });
}


return (
    <>
      <PageShell
        title="Inventory"
        subtitle="Staff inventory maintenance"
      />

      <div className="container">
        <div className="card">
  <h2 style={{ marginTop: 0 }}>Inventory Maintenance</h2>
  <div className="muted" style={{ marginBottom: 14 }}>
    Track stock items for staff use and leakage control.
  </div>

  <div className="grid">
    <div className="cols-6">
      <label className="lbl">Item Name</label>
      <input
        value={itemName}
        onChange={(e) => setItemName(e.target.value)}
        placeholder="Example: Tea Cups"
      />
    </div>

    <div className="cols-6">
      <label className="lbl">Category</label>
      <input
        value={itemCategory}
        onChange={(e) => setItemCategory(e.target.value)}
        placeholder="Example: Beverage / Food / Cleaning"
      />
    </div>

    <div className="cols-4">
      <label className="lbl">Unit</label>
      <input
        value={itemUnit}
        onChange={(e) => setItemUnit(e.target.value)}
        placeholder="pcs / bottles / packs / kg"
      />
    </div>

    <div className="cols-4">
      <label className="lbl">Current Qty</label>
      <input
        value={itemQty}
        onChange={(e) => setItemQty(e.target.value)}
        placeholder="0"
      />
    </div>

    <div className="cols-4">
      <label className="lbl">Minimum Qty Alert</label>
      <input
        value={itemMinQty}
        onChange={(e) => setItemMinQty(e.target.value)}
        placeholder="0"
      />
    </div>

    <div className="cols-12">
      <label className="lbl">Notes</label>
      <input
        value={itemNote}
        onChange={(e) => setItemNote(e.target.value)}
        placeholder="Optional notes"
      />
    </div>
<div className="cols-12">
  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
    <button
      className="btn primary"
      type="button"
      onClick={saveInventoryItem}
    >
      Save Inventory Item
    </button>
  </div>
</div>
    <div className="card cols-4">
      <div className="infoLabel">Inventory Items</div>
      <div className="infoValue">{inventoryItems.length}</div>
    </div>
  </div>
</div>
<div className="card" style={{ marginTop: 16 }}>
  <h3 style={{ marginTop: 0 }}>Inventory Records</h3>

  {inventoryItems.length === 0 ? (
    <div className="muted">No inventory items saved yet.</div>
  ) : (
    <table>
      <thead>
  <tr>
    <th>Item</th>
    <th>Category</th>
    <th>Unit</th>
    <th>Qty</th>
    <th>Min Qty</th>
    <th>Last Movement</th>
    <th>Notes</th>
    <th>Admin</th>
  </tr>
</thead>
      <tbody>
        {inventoryItems.map((item) => (
         <tr
  key={item.id}
  style={
    Number(item.qty ?? 0) <= Number(item.minQty ?? 0)
      ? { background: "rgba(255, 77, 77, 0.10)" }
      : undefined
  }
>
  <td>{item.name || "—"}</td>
  <td>{item.category || "—"}</td>
  <td>{item.unit || "—"}</td>
  <td>
  <input
    value={
      Object.prototype.hasOwnProperty.call(qtyDrafts, item.id)
        ? qtyDrafts[item.id]
        : String(item.qty ?? 0)
    }
    onChange={(e) =>
      setQtyDrafts((prev) => ({
        ...prev,
        [item.id]: e.target.value,
      }))
    }
    onBlur={(e) => {
      updateInventoryQty(item.id, e.target.value);
      setQtyDrafts((prev) => {
        const next = { ...prev };
        delete next[item.id];
        return next;
      });
    }}
    style={{ width: 90 }}
  />
</td>
  <td>
  {admin ? (
    <input
      value={item.minQty ?? 0}
      onChange={(e) => updateInventoryMinQty(item.id, e.target.value)}
      style={{ width: 90 }}
    />
  ) : (
    item.minQty ?? 0
  )}
</td>
<td>
  {(() => {
    const mv = Array.isArray(item.movements) ? item.movements[0] : null;
    if (!mv) return "—";
    return `${mv.type || "update"} â€¢ ${mv.qty ?? 0}`;
  })()}
</td>
<td>
  {admin ? (
    <input
      value={item.note || ""}
      onChange={(e) => updateInventoryNote(item.id, e.target.value)}
      placeholder="Notes"
    />
  ) : (
    item.note || "—"
  )}
</td>
  <td>
    {admin ? (
  <button
    className="btn danger"
    type="button"
    onClick={() => deleteInventoryItem(item.id)}
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
                      <div className="muted">{row.game === "pool" ? "Pool" : "Snooker"} â€¢ {row.match_type === "doubles" ? "Doubles" : "Singles"}</div>
                      <div className="muted" style={{ marginTop: 6 }}>
                        Date: {formatDateLabel(row.match_date)} â€¢ Start: {formatTimeLabel(row.start_time)} â€¢ Duration: {calcDurationLabel(row.start_time, row.end_time || nowTimeValue())}
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
                          Date: {formatDateLabel(row.match_date)} â€¢ Start: {formatTimeLabel(row.start_time)} â€¢ End: {formatTimeLabel(row.end_time)} â€¢ Total: {calcDurationLabel(row.start_time, row.end_time)}
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
                              {row.game === "snooker" ? ` â€¢ Highest Break: ${winner?.breakValue || 0}` : ""}
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
function FoodPrintBridge({ data, admin, staffAdmin, commit }) {
  const [query, setQuery] = useState("");
  const [expandedOrderId, setExpandedOrderId] = useState("");
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

    const printOrderId = "";

  function lockBridge() {
    try {
      sessionStorage.removeItem("qclub_admin_role");
      localStorage.removeItem("qclub_admin_role");
    } catch {}
    window.location.reload();
  }

  const isBridgeActive = admin || staffAdmin;

  const activeOrders = Array.isArray(data.foodOrders)
    ? [...data.foodOrders].sort((a, b) => Number(b?.time || 0) - Number(a?.time || 0))
    : [];

  const orderToPrint = printOrderId
    ? activeOrders.find((order) => String(order?.id || "") === String(printOrderId))
    : null;

  const receiptToPrint = orderToPrint
    ? buildFoodReceiptRecord(orderToPrint, data.club || {})
    : null;

    useEffect(() => {
    if (!isBridgeActive) return;
    if (!printOrderId) return;

    if (!orderToPrint) {
      navigate("/food-print-bridge", { replace: true });
      return;
    }

    const alreadyPrinted =
      Boolean(orderToPrint?.printMeta?.printedAt) ||
      orderToPrint?.printMeta?.status === "printed";

    if (alreadyPrinted) {
      navigate("/food-print-bridge", { replace: true });
      return;
    }

    try {
      if ("speechSynthesis" in window) {
        window.speechSynthesis.cancel();
        const msg = new SpeechSynthesisUtterance(
          "New food order received. New food order received."
        );
        msg.lang = "en-IN";
        msg.rate = 0.9;
        msg.pitch = 1;
        msg.volume = 1;
        window.speechSynthesis.speak(msg);
      }
    } catch {}

    const printTimer = setTimeout(() => {
      try {
        window.focus();
        window.print();
      } catch {}
    }, 3500);

    const markPrintedTimer = setTimeout(() => {
      const currentOrders = Array.isArray(data.foodOrders) ? data.foodOrders : [];

      commit({
        ...data,
        foodOrders: currentOrders.map((order) =>
          order.id === orderToPrint.id
            ? {
                ...order,
                printMeta: {
                  ...(order.printMeta || {}),
                  status: "printed",
                  printedAt: order.printMeta?.printedAt || new Date().toISOString(),
                  printedByRole: admin ? "main" : "staff",
                },
              }
            : order
        ),
      });

      navigate("/food-print-bridge", { replace: true });
    }, 9000);

    return () => {
      clearTimeout(printTimer);
      clearTimeout(markPrintedTimer);
    };
  }, [
    isBridgeActive,
    printOrderId,
    orderToPrint?.id,
    orderToPrint?.printMeta?.printedAt,
    orderToPrint?.printMeta?.status,
    data,
    admin,
    commit,
    navigate,
  ]);

  if (!isBridgeActive) {
    return (
      <div
        style={{
          minHeight: "100vh",
          padding: 16,
          background: "#ffffff",
          color: "#111827",
        }}
      >
        <div style={{ maxWidth: 520, margin: "40px auto", border: "1px solid #ddd", borderRadius: 16, padding: 18 }}>
          <h2 style={{ marginTop: 0 }}>Food Print Bridge Locked</h2>
          <p>
            Enter Staff PIN or Main Admin PIN from the normal Q Club admin login first.
            After that, reopen this page on the spare Android print phone.
          </p>
          <a className="btn primary" href="/">
            Open Q Club Login
          </a>
        </div>
      </div>
    );
  }

  if (receiptToPrint) {
    const createdText = receiptToPrint.createdAt
      ? new Date(receiptToPrint.createdAt).toLocaleString("en-IN", {
          year: "numeric",
          month: "short",
          day: "2-digit",
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        })
      : "—";

    return (
      <div
        style={{
          minHeight: "100vh",
          background: "#ffffff",
          color: "#111111",
          padding: "4mm",
          fontFamily: "Arial, sans-serif",
        }}
      >
        <style>{`
          @page { size: 80mm auto; margin: 4mm; }
          @media print {
            html, body {
              background: #ffffff !important;
              margin: 0 !important;
              padding: 0 !important;
            }
            .no-print {
              display: none !important;
            }
            .qclub-receipt-wrap {
              width: 72mm !important;
              margin: 0 !important;
              padding: 0 !important;
              box-shadow: none !important;
              border: 0 !important;
            }
          }
        `}</style>

               <div className="no-print" style={{ marginBottom: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button
            className="btn"
            onClick={() => {
              try {
                window.print();
              } catch {}
            }}
          >
            Print Receipt
          </button>

          <button
            className="btn"
            onClick={() => {
              navigate("/food-print-bridge", { replace: true });
            }}
          >
            Back to Bridge
          </button>
        </div>

        <div
          className="qclub-receipt-wrap"
          style={{
            width: "72mm",
            maxWidth: "100%",
            margin: "0 auto",
            background: "#ffffff",
            color: "#111111",
            fontSize: 12,
            lineHeight: 1.35,
          }}
        >
          <div style={{ textAlign: "center", fontSize: 18, fontWeight: 900 }}>
            The Q Club
          </div>
          <div style={{ textAlign: "center", fontSize: 12 }}>
            Pasighat
          </div>

          <div style={{ borderTop: "1px dashed #111", margin: "8px 0" }} />

          <div><b>Order No:</b> {receiptToPrint.id}</div>
          <div><b>Date & Time:</b> {createdText}</div>
          <div><b>Name:</b> {receiptToPrint.customerName || "—"}</div>
          <div><b>Mobile:</b> {receiptToPrint.customerMobile || "—"}</div>
          <div><b>Status:</b> {receiptToPrint.status || "Paid"}</div>

          <div style={{ borderTop: "1px dashed #111", margin: "8px 0" }} />

          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", borderBottom: "1px solid #111", paddingBottom: 4 }}>
                  Item
                </th>
                <th style={{ textAlign: "right", borderBottom: "1px solid #111", paddingBottom: 4 }}>
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              {(receiptToPrint.items || []).map((item, idx) => (
                <tr key={`${receiptToPrint.id}-${idx}`}>
                  <td style={{ padding: "5px 0", borderBottom: "1px dashed #aaa" }}>
                    {item.name || "Item"} × {item.qty || 0}
                  </td>
                  <td style={{ padding: "5px 0", textAlign: "right", borderBottom: "1px dashed #aaa" }}>
                    ₹{safeNum(item.lineTotal, safeNum(item.price, 0) * safeNum(item.qty, 0))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ borderTop: "1px dashed #111", margin: "8px 0" }} />

          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 15, fontWeight: 900 }}>
            <span>Total</span>
            <span>₹{safeNum(receiptToPrint.total, 0)}</span>
          </div>

          <div style={{ borderTop: "1px dashed #111", margin: "8px 0" }} />

          <div style={{ textAlign: "center", fontWeight: 700 }}>
            Thank you for ordering at The Q Club
          </div>
          <div style={{ textAlign: "center", marginTop: 6 }}>
            Please wait for up to 15 minutes.
          </div>
          <div style={{ textAlign: "center", marginTop: 4 }}>
            Please collect from the counter when your name is called.
          </div>
        </div>
      </div>
    );
  }

  const pendingOrders = activeOrders.filter((order) => {
    if (!order?.id) return false;
    if (order?.printMeta?.printedAt) return false;
    if (order?.printMeta?.status === "printed") return false;
    return true;
  });

  const printedOrders = activeOrders.filter((order) => {
    if (order?.printMeta?.printedAt) return true;
    if (order?.printMeta?.status === "printed") return true;
    return false;
  });

  const todayKey = new Date().toISOString().slice(0, 10);

  const todayOrders = activeOrders.filter((order) => {
    const orderDate = order?.createdAt || order?.paidAt || order?.paymentTime || order?.time || "";
    const parsedDate = orderDate ? new Date(orderDate) : null;
    if (!parsedDate || Number.isNaN(parsedDate.getTime())) return false;
    return parsedDate.toISOString().slice(0, 10) === todayKey;
  });

  const cleanQuery = query.trim().toLowerCase();

  const visibleOrders = activeOrders.filter((order) => {
    if (!cleanQuery) return true;

    const orderDate = order?.createdAt || order?.paidAt || order?.paymentTime || order?.time || "";

    const itemText = (order?.items || [])
      .map((item) => `${item?.name || ""} ${item?.qty || ""}`)
      .join(" ");

    const haystack = [
      order?.id,
      order?.name,
      order?.mobile,
      order?.total,
      orderDate ? new Date(orderDate).toLocaleString("en-IN") : "",
      itemText,
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(cleanQuery);
  });

  const recentOrders = visibleOrders.slice(0, 50);

  return (
    <div
      style={{
        minHeight: "100vh",
        padding: 12,
        background: "linear-gradient(180deg, #08111f, #020617)",
        color: "#f8fafc",
      }}
    >
      <div style={{ maxWidth: 900, margin: "0 auto" }}>
        <div
          className="card"
          style={{
            marginBottom: 12,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div>
            <div className="muted" style={{ fontSize: 12 }}>
              Q Club Kitchen
            </div>
            <h2 style={{ margin: "2px 0 0" }}>Food Print Bridge</h2>
            <div className="badge" style={{ marginTop: 8 }}>
              <span className="dot" />
              Active on this Android phone
            </div>
          </div>

          <button className="btn danger" onClick={lockBridge}>
            Lock
          </button>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
            gap: 8,
            marginBottom: 12,
          }}
        >
          <div className="card" style={{ padding: 12 }}>
            <div className="muted" style={{ fontSize: 12 }}>Pending</div>
            <div style={{ fontSize: 28, fontWeight: 900 }}>{pendingOrders.length}</div>
          </div>

          <div className="card" style={{ padding: 12 }}>
            <div className="muted" style={{ fontSize: 12 }}>Today</div>
            <div style={{ fontSize: 28, fontWeight: 900 }}>{todayOrders.length}</div>
          </div>

          <div className="card" style={{ padding: 12 }}>
            <div className="muted" style={{ fontSize: 12 }}>Printed</div>
            <div style={{ fontSize: 28, fontWeight: 900 }}>{printedOrders.length}</div>
          </div>
        </div>

        <div className="card" style={{ marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, mobile, order no, item, date..."
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: 14,
                border: "1px solid rgba(255,255,255,.18)",
                background: "rgba(255,255,255,.06)",
                color: "#fff",
                outline: "none",
              }}
            />
            {query ? (
              <button className="btn" onClick={() => setQuery("")}>
                Clear
              </button>
            ) : null}
          </div>
          <div className="muted" style={{ marginTop: 8, fontSize: 12 }}>
            Showing latest {recentOrders.length} matching orders. Keep this page open for auto-print.
          </div>
        </div>

        <div style={{ display: "grid", gap: 8 }}>
          {recentOrders.length ? (
            recentOrders.map((order) => {
              const isExpanded = expandedOrderId === order.id;
              const printedAt = order?.printMeta?.printedAt || "";
              const statusText = printedAt
                ? `Printed â€¢ ${new Date(printedAt).toLocaleString("en-IN")}`
                : order?.printMeta?.status === "printing"
                ? "Printing..."
                : "Pending auto print";

              const orderDate = order?.createdAt || order?.paidAt || order?.paymentTime || order?.time || "";

              return (
                <div className="card" key={order.id} style={{ padding: 12 }}>
                  <button
                    className="btn"
                    style={{
                      width: "100%",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 10,
                      textAlign: "left",
                    }}
                    onClick={() => setExpandedOrderId(isExpanded ? "" : order.id)}
                  >
                    <span>
                      <b>#{order.id}</b>
                      <br />
                      <span className="muted">
                        {order.name || "Customer"} â€¢ ₹{order.total || 0}
                      </span>
                    </span>
                    <span style={{ textAlign: "right", fontSize: 12 }}>
                      {printedAt ? "âœ… Printed" : order?.printMeta?.status === "printing" ? "ðŸ–¨ï¸ Printing" : "â³ Pending"}
                      <br />
                      {isExpanded ? "Hide" : "View"}
                    </span>
                  </button>

                  {isExpanded ? (
                    <div style={{ marginTop: 12 }}>
                      <div><b>Name:</b> {order.name || "—"}</div>
                      <div><b>Mobile:</b> {order.mobile || "—"}</div>
                      <div><b>Total:</b> ₹{order.total || 0}</div>
                      <div>
                        <b>Time:</b>{" "}
                        {orderDate ? new Date(orderDate).toLocaleString("en-IN") : "—"}
                      </div>
                      <div><b>Receipt:</b> {statusText}</div>

                      <div className="hr" />

                      <div style={{ display: "grid", gap: 8 }}>
                        {(order.items || []).map((item, idx) => (
                          <div
                            key={`${order.id}-${idx}`}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              gap: 12,
                              borderBottom: "1px dashed rgba(255,255,255,.14)",
                              paddingBottom: 6,
                            }}
                          >
                            <span>{item.name} × {item.qty}</span>
                            <span>₹{item.lineTotal}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })
          ) : (
            <div className="card">
              <p className="muted" style={{ margin: 0 }}>
                No matching food orders found.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
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
  function deleteArchivedFoodOrder(orderId) {
  if (!admin) return;
  if (!confirm("Delete this archived order permanently?")) return;

  commit({
    ...data,
    archivedFoodOrders: (data.archivedFoodOrders || []).filter((o) => o.id !== orderId),
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
                  <div>
                    <b>Receipt Print:</b>{" "}
                    {order?.printMeta?.printedAt
                      ? `Printed â€¢ ${new Date(order.printMeta.printedAt).toLocaleString("en-IN")}`
                      : "Pending auto print"}
                  </div>

                  <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      className="btn"
                      onClick={() =>
                        printFoodReceipt(buildFoodReceiptRecord(order, data.club || {}))
                      }
                    >
                      Print Receipt
                    </button>
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
  function deleteArchivedFoodOrder(orderId) {
  if (!admin) return;
  if (!confirm("Delete this archived order permanently?")) return;

  commit({
    ...data,
    archivedFoodOrders: (data.archivedFoodOrders || []).filter((o) => o.id !== orderId),
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
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
  <button
    className="btn"
    onClick={() => restoreFoodOrder(order.id)}
  >
    Restore
  </button>

  {admin && (
    <button
      className="btn"
      style={{ background: "#ef4444", color: "#fff", borderColor: "#ef4444" }}
      onClick={() => deleteArchivedFoodOrder(order.id)}
    >
      Delete
    </button>
  )}
</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function foodReceiptCreatedText(value) {
  if (!value) return "—";
  const dt = new Date(value);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleString("en-IN", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function buildFoodReceiptRecord(order = {}, club = {}) {
  const cleanItems = Array.isArray(order?.items) ? order.items : [];
  return {
    id: String(order?.id || `FOOD-${String(uid()).slice(-8).toUpperCase()}`),
    customerName: String(order?.name || "").trim(),
    customerMobile: String(order?.mobile || "").trim(),
    items: cleanItems,
    total: safeNum(order?.total, 0),
    status: String(order?.status || "Paid"),
    createdAt: String(order?.time || order?.createdAt || new Date().toISOString()),
    clubName: String(club?.name || "The Q Club"),
    clubLocation: String(club?.location || "Pasighat"),
    logoUrl: String(club?.logoUrl || ""),
  };
}

function foodReceiptHtml(receipt, options = {}) {
  if (!receipt) return "";

  const createdText = foodReceiptCreatedText(receipt.createdAt);
  const autoClose = options?.autoClose ? "true" : "false";
  const escapedLogoUrl = String(receipt.logoUrl || "").replace(/"/g, "&quot;");

  const itemsHtml =
    Array.isArray(receipt.items) && receipt.items.length
      ? receipt.items
          .map(
            (item) => `
              <tr>
                <td style="padding:4px 0;border-bottom:1px dashed #bbb;">${item.name || "Item"} × ${safeNum(item.qty, 0)}</td>
                <td style="padding:4px 0;border-bottom:1px dashed #bbb;text-align:right;">₹${safeNum(
                  item.lineTotal,
                  safeNum(item.price, 0) * safeNum(item.qty, 0)
                )}</td>
              </tr>
            `
          )
          .join("")
      : `<tr><td colspan="2" style="padding:4px 0;">No items found.</td></tr>`;

  return `
  <html>
    <head>
      <title>${receipt.id}</title>
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <style>
        @page { size: 80mm auto; margin: 4mm; }

        html, body {
          margin: 0;
          padding: 0;
          background: #fff;
          color: #111;
          font-family: Arial, sans-serif;
        }

        body { width: 80mm; }

        .sheet {
          width: 72mm;
          margin: 0 auto;
          padding: 4mm;
          box-sizing: border-box;
        }

        .center { text-align: center; }
        .line { border-top: 1px dashed #888; margin: 8px 0; }
        .tiny { font-size: 11px; }
        .small { font-size: 12px; }
        table { width: 100%; border-collapse: collapse; }
        .logoWrap { margin-bottom: 6px; }
        .logoWrap img {
          max-width: 46mm;
          max-height: 18mm;
          object-fit: contain;
          display: block;
          margin: 0 auto 6px;
        }

        @media screen {
          body {
            background: #f3f3f3;
            padding: 8px 0;
          }
          .sheet {
            background: #fff;
            box-shadow: 0 8px 24px rgba(0,0,0,.12);
          }
        }
      </style>
    </head>
    <body>
      <div class="sheet">
        <div class="logoWrap center">
          ${escapedLogoUrl ? `<img src="${escapedLogoUrl}" alt="The Q Club Logo" />` : ""}
          <div style="font-size:18px;font-weight:900;letter-spacing:.5px;">${receipt.clubName || "The Q Club"}</div>
          <div class="small">${receipt.clubLocation || "Pasighat"}</div>
        </div>

        <div class="line"></div>
        <div class="small"><b>Order No:</b> ${receipt.id}</div>
        <div class="small"><b>Date & Time:</b> ${createdText}</div>
        <div class="small"><b>Name:</b> ${receipt.customerName || "—"}</div>
        <div class="small"><b>Mobile:</b> ${receipt.customerMobile || "—"}</div>
        <div class="small"><b>Status:</b> ${receipt.status || "Paid"}</div>
        <div class="line"></div>

        <table>
          <thead>
            <tr>
              <th style="text-align:left;padding-bottom:6px;border-bottom:2px solid #111;">Item</th>
              <th style="text-align:right;padding-bottom:6px;border-bottom:2px solid #111;">Amount</th>
            </tr>
          </thead>
          <tbody>${itemsHtml}</tbody>
        </table>

        <div class="line"></div>
        <div style="display:flex;justify-content:space-between;font-size:14px;font-weight:700;">
          <span>Total</span><span>₹${safeNum(receipt.total, 0)}</span>
        </div>

        <div class="line"></div>
        <div class="center tiny" style="font-weight:700;">Thank you for ordering at The Q Club</div>
        <div class="center tiny" style="margin-top:6px;">Please wait for up to 15 minutes.</div>
        <div class="center tiny" style="margin-top:4px;">Please collect from the counter when your name is called.</div>

        <script>
          (function () {
            function runPrint() {
              try {
                window.focus();
                window.print();
              } catch (e) {}
            }

            if (document.readyState === "complete") {
              setTimeout(runPrint, 120);
            } else {
              window.addEventListener("load", function () {
                setTimeout(runPrint, 120);
              });
            }

            window.addEventListener("afterprint", function () {
              if (${autoClose}) {
                setTimeout(function () {
                  try { window.close(); } catch (e) {}
                }, 150);
              }
            });
          })();
        </script>
      </div>
    </body>
  </html>`;
}

function printHtmlViaHiddenFrame(html, { onAfterPrint } = {}) {
  if (!html) return false;

    const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.setAttribute("title", "Q Club Receipt Print Frame");
  iframe.style.position = "fixed";
  iframe.style.inset = "0";
  iframe.style.width = "100vw";
  iframe.style.height = "100vh";
  iframe.style.border = "0";
  iframe.style.opacity = "1";
  iframe.style.background = "#fff";
  iframe.style.zIndex = "2147483647";
  document.body.appendChild(iframe);

  const cleanup = () => {
    setTimeout(() => {
      try {
        iframe.remove();
      } catch {}
    }, 300);
  };

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    cleanup();
    return false;
  }

  doc.open();
  doc.write(html);
  doc.close();

  const trigger = () => {
    const win = iframe.contentWindow;
    if (!win) {
      cleanup();
      return;
    }

    let finished = false;
    const done = () => {
      if (finished) return;
      finished = true;
      try {
        onAfterPrint?.();
      } catch {}
      cleanup();
    };

            try {
      win.onafterprint = done;
      setTimeout(done, 2500);
      win.focus();
      setTimeout(() => {
        try {
          win.print();
        } catch {
          done();
        }
      }, 150);
    } catch {
      done();
    }
  };

  setTimeout(trigger, 120);
  return true;
}

function printFoodReceipt(receipt, options = {}) {
  if (!receipt) return false;
  return printHtmlViaHiddenFrame(foodReceiptHtml(receipt, options), {
    onAfterPrint: options?.onAfterPrint,
  });
}

function buildShopReceiptRecord({
  orderId = "",
  name = "",
  mobile = "",
  items = [],
  total = 0,
  paymentStatus = "Paid",
  createdAt = new Date().toISOString(),
}) {
  const cleanItems = Array.isArray(items) ? items : [];
  return {
    id: `QSHOP-${String(orderId || uid()).slice(-8).toUpperCase()}`,
    gatewayOrderId: String(orderId || ""),
    customerName: String(name || "").trim(),
    customerMobile: String(mobile || "").trim(),
    items: cleanItems,
    total: safeNum(total, 0),
    paymentStatus: paymentStatus || "Paid",
    createdAt,
  };
}

function shopReceiptHtml(receipt) {
  if (!receipt) return "";

  const createdText = receipt.createdAt
    ? new Date(receipt.createdAt).toLocaleString("en-IN", {
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "numeric",
        minute: "2-digit",
        hour12: true,
      })
    : "—";

  const itemsHtml =
    Array.isArray(receipt.items) && receipt.items.length
      ? receipt.items
          .map(
            (item) => `
              <tr>
                <td style="padding:6px 0;border-bottom:1px dashed #bbb;">${item.name || "Item"} × ${safeNum(item.qty, 0)}</td>
                <td style="padding:6px 0;border-bottom:1px dashed #bbb;text-align:right;">₹${safeNum(
                  item.lineTotal,
                  safeNum(item.price, 0) * safeNum(item.qty, 0)
                )}</td>
              </tr>
            `
          )
          .join("")
      : `<tr><td colspan="2" style="padding:6px 0;">No items found.</td></tr>`;

  const returnUrl = `${window.location.origin}/shop/successful-order-receipts`;

  return `
  <html>
    <head>
      <title>${receipt.id}</title>
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <style>
        @page { size: 80mm auto; margin: 4mm; }

        html, body {
          margin: 0;
          padding: 0;
          background: #f5f5f5;
          color: #111;
          font-family: Arial, sans-serif;
        }

        .toolbar {
          position: sticky;
          top: 0;
          z-index: 20;
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
          padding: 12px;
          background: #ffffff;
          border-bottom: 1px solid #ddd;
        }

        .toolbar button {
          appearance: none;
          border: 1px solid #ccc;
          background: #111;
          color: #fff;
          border-radius: 10px;
          padding: 10px 14px;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
        }

        .toolbar button.secondary {
          background: #fff;
          color: #111;
        }

        .page {
          padding: 12px;
        }

        .wrap {
          width: 72mm;
          max-width: 100%;
          margin: 0 auto;
          background: #fff;
          padding: 4mm;
          box-sizing: border-box;
        }

        .center { text-align: center; }
        .line { border-top: 1px dashed #888; margin: 8px 0; }
        table { width: 100%; border-collapse: collapse; }

        @media print {
          html, body {
            background: #fff;
          }

          .toolbar {
            display: none !important;
          }

          .page {
            padding: 0;
          }

          .wrap {
            margin: 0;
            width: 72mm;
            max-width: none;
            box-shadow: none;
          }
        }
      </style>
    </head>
    <body>
      <div class="toolbar">
        <button class="secondary" onclick="
          try {
            if (window.opener && !window.opener.closed) {
              window.close();
              return;
            }
          } catch (e) {}
          window.location.href='${returnUrl}';
        ">â† Back</button>

        <button onclick="window.print()">Print</button>

        <button class="secondary" onclick="
          try {
            window.close();
          } catch (e) {}
          setTimeout(function () {
            window.location.href='${returnUrl}';
          }, 150);
        ">Close</button>
      </div>

      <div class="page">
        <div class="wrap">
          <div class="center" style="font-size:18px;font-weight:700;">The Q Club</div>
          <div class="center" style="font-size:12px;">Pasighat</div>
          <div class="line"></div>
          <div style="font-size:12px;"><b>Receipt:</b> ${receipt.id}</div>
          <div style="font-size:12px;"><b>Time:</b> ${createdText}</div>
          <div style="font-size:12px;"><b>Name:</b> ${receipt.customerName || "—"}</div>
          <div style="font-size:12px;"><b>Mobile:</b> ${receipt.customerMobile || "—"}</div>
          <div class="line"></div>
          <table>${itemsHtml}</table>
          <div class="line"></div>
          <div class="center" style="display:flex;justify-content:space-between;font-size:14px;font-weight:700;">
            <span>Total</span><span>₹${safeNum(receipt.total, 0)}</span>
          </div>
          <div style="margin-top:10px;font-size:11px;" class="center">Thank you for shopping at The Q Club</div>
        </div>
      </div>
    </body>
  </html>`;
}

function downloadShopReceipt(receipt) {
  if (!receipt) return;

  const html = shopReceiptHtml(receipt);
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = `${receipt.id || "qshop-receipt"}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();

  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function printShopReceipt(receipt) {
  if (!receipt) return;

  const html = shopReceiptHtml(receipt);
  const win = window.open("", "_blank", "width=420,height=760");

  if (!win) {
    alert("Popup blocked. Please allow popups for printing.");
    return;
  }

  win.document.open();
  win.document.write(html);
  win.document.close();

  win.onload = () => {
    win.focus();
    win.print();
  };
}

function ShopSuccessfulOrderReceipts({ data, admin, staffAdmin, commit }) {
  const [searchText, setSearchText] = useState("");
  const [testFilter, setTestFilter] = useState("real");
  const [dateFilter, setDateFilter] = useState("all");

  if (!(admin || staffAdmin)) {
    return (
      <>
        <PageShell title="Shop Receipts" subtitle="Restricted access" />
        <div className="container">
          <div className="card">
            <div className="muted">Access denied.</div>
          </div>
        </div>
      </>
    );
  }

  const allReceipts = Array.isArray(data.shopReceipts) ? [...data.shopReceipts] : [];

  function getReceiptDate(receipt) {
    const rawDate = receipt?.createdAt || receipt?.time || "";
    const parsed = rawDate ? new Date(rawDate) : null;
    return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
  }

  function isSameDay(dateA, dateB) {
    return (
      dateA.getFullYear() === dateB.getFullYear() &&
      dateA.getMonth() === dateB.getMonth() &&
      dateA.getDate() === dateB.getDate()
    );
  }

  function passesDateFilter(receipt) {
    if (dateFilter === "all") return true;

    const receiptDate = getReceiptDate(receipt);
    if (!receiptDate) return false;

    const now = new Date();

    if (dateFilter === "today") {
      return isSameDay(receiptDate, now);
    }

    if (dateFilter === "last7") {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(now.getDate() - 7);
      return receiptDate >= sevenDaysAgo;
    }

    if (dateFilter === "month") {
      return (
        receiptDate.getFullYear() === now.getFullYear() &&
        receiptDate.getMonth() === now.getMonth()
      );
    }

    return true;
  }

  function passesTestFilter(receipt) {
    if (testFilter === "all") return true;
    if (testFilter === "test") return Boolean(receipt?.isTest);
    return !receipt?.isTest;
  }

  function passesSearch(receipt) {
    const query = searchText.trim().toLowerCase();
    if (!query) return true;

    const itemText = (receipt.items || [])
      .map((item) => `${item.name || ""} ${item.displayName || ""}`)
      .join(" ")
      .toLowerCase();

    const haystack = [
      receipt.id,
      receipt.customerName,
      receipt.customerMobile,
      receipt.paymentStatus,
      receipt.pickupStatus,
      itemText,
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(query);
  }

  const receipts = allReceipts
    .filter(passesDateFilter)
    .filter(passesTestFilter)
    .filter(passesSearch)
    .reverse();

  const visibleTotal = receipts.reduce((sum, receipt) => sum + safeNum(receipt.total, 0), 0);

  const visibleItemCount = receipts.reduce(
    (sum, receipt) =>
      sum +
      (receipt.items || []).reduce((itemSum, item) => itemSum + safeNum(item.qty, 0), 0),
    0
  );

  function updateShopReceipt(receiptId, patch) {
    commit({
      ...data,
      shopReceipts: allReceipts.map((receipt) =>
        receipt.id === receiptId
          ? {
              ...receipt,
              ...patch,
              updatedAt: new Date().toISOString(),
            }
          : receipt
      ),
    });
  }

  function deleteShopReceipt(receiptId) {
    if (!admin) {
      alert("Only MAIN ADMIN can delete shop receipts.");
      return;
    }

    const receipt = allReceipts.find((item) => item.id === receiptId);

    const confirmText = receipt
      ? `Delete this shop receipt?\n\n${receipt.id}\nName: ${receipt.customerName || "—"}\nTotal: ₹${safeNum(receipt.total, 0)}\n\nThis only removes the receipt record. It will NOT restore stock and will NOT change payment records.`
      : "Delete this shop receipt?";

    if (!window.confirm(confirmText)) return;

    commit({
      ...data,
      shopReceipts: allReceipts.filter((item) => item.id !== receiptId),
    });
  }

  function markReceiptAsTest(receiptId) {
    if (!admin) {
      alert("Only MAIN ADMIN can mark test receipts.");
      return;
    }

    updateShopReceipt(receiptId, { isTest: true });
  }

  function markReceiptAsReal(receiptId) {
    if (!admin) {
      alert("Only MAIN ADMIN can mark receipts as real.");
      return;
    }

    updateShopReceipt(receiptId, { isTest: false });
  }

  function printShopSalesSummary() {
    const rows = receipts
      .map((receipt) => {
        const pickupStatus = receipt.pickupStatus || "Pending Pickup";
        const typeLabel = receipt.isTest ? "TEST" : "REAL";

        return `
          <tr>
            <td>${receipt.id || "—"}</td>
            <td>${receipt.customerName || "—"}</td>
            <td>${receipt.customerMobile || "—"}</td>
            <td>${typeLabel}</td>
            <td>${pickupStatus}</td>
            <td style="text-align:right;">₹${safeNum(receipt.total, 0)}</td>
          </tr>
        `;
      })
      .join("");

    const html = `
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>Q Shop Sales Summary</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              padding: 18px;
              color: #111;
            }
            h2, p {
              margin: 0 0 8px;
            }
            table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 14px;
              font-size: 12px;
            }
            th, td {
              border: 1px solid #999;
              padding: 6px;
              text-align: left;
            }
            th {
              background: #eee;
            }
            .summary {
              margin-top: 12px;
              font-weight: 700;
            }
          </style>
        </head>
        <body>
          <h2>The Q Club Pasighat</h2>
          <p>Q Shop Sales Summary</p>
          <p>Printed: ${new Date().toLocaleString("en-IN")}</p>
          <p>Receipts shown: ${receipts.length}</p>
          <p>Total items: ${visibleItemCount}</p>
          <p class="summary">Total sales shown: ₹${visibleTotal}</p>

          <table>
            <thead>
              <tr>
                <th>Receipt</th>
                <th>Name</th>
                <th>Mobile</th>
                <th>Type</th>
                <th>Pickup</th>
                <th>Total</th>
              </tr>
            </thead>
            <tbody>
              ${rows || `<tr><td colspan="6">No receipts found</td></tr>`}
            </tbody>
          </table>
        </body>
      </html>
    `;

    const win = window.open("", "_blank", "width=900,height=700");

    if (!win) {
      alert("Popup blocked. Please allow popups for printing.");
      return;
    }

    win.document.open();
    win.document.write(html);
    win.document.close();

    win.onload = () => {
      win.focus();
      win.print();
    };
  }

  return (
    <>
      <PageShell title="Successful Shop Receipts" subtitle="Staff and main admin access" />
      <div className="container">
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <h3 style={{ margin: "0 0 6px" }}>Receipt Controls</h3>
                <div className="muted">
                  Showing {receipts.length} receipt(s), {visibleItemCount} item(s), total ₹{visibleTotal}
                </div>
              </div>

              <button className="btn" type="button" onClick={printShopSalesSummary}>
                Print Sales Summary
              </button>
            </div>

            <input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Search by receipt ID, name, mobile, or item..."
              style={{
                width: "100%",
                padding: "12px 14px",
                borderRadius: 12,
                border: "1px solid rgba(255,255,255,.18)",
                background: "rgba(255,255,255,.06)",
                color: "inherit",
              }}
            />

            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button className="btn" type="button" onClick={() => setTestFilter("real")} style={{ opacity: testFilter === "real" ? 1 : 0.65 }}>
                Real Only
              </button>
              <button className="btn" type="button" onClick={() => setTestFilter("test")} style={{ opacity: testFilter === "test" ? 1 : 0.65 }}>
                Test Only
              </button>
              <button className="btn" type="button" onClick={() => setTestFilter("all")} style={{ opacity: testFilter === "all" ? 1 : 0.65 }}>
                Show All
              </button>
            </div>

            <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
              <button className="btn" type="button" onClick={() => setDateFilter("all")} style={{ opacity: dateFilter === "all" ? 1 : 0.65 }}>
                All Dates
              </button>
              <button className="btn" type="button" onClick={() => setDateFilter("today")} style={{ opacity: dateFilter === "today" ? 1 : 0.65 }}>
                Today
              </button>
              <button className="btn" type="button" onClick={() => setDateFilter("last7")} style={{ opacity: dateFilter === "last7" ? 1 : 0.65 }}>
                Last 7 Days
              </button>
              <button className="btn" type="button" onClick={() => setDateFilter("month")} style={{ opacity: dateFilter === "month" ? 1 : 0.65 }}>
                This Month
              </button>
            </div>
          </div>
        </div>

        {receipts.length === 0 ? (
          <div className="card">
            <h3 style={{ marginTop: 0 }}>No matching shop receipts</h3>
            <div className="muted">
              Try changing search, date filter, or test/real filter.
            </div>
          </div>
        ) : (
          <div style={{ display: "grid", gap: 16 }}>
            {receipts.map((receipt) => {
              const pickupStatus = receipt.pickupStatus || "Pending Pickup";
              const isPickedUp = pickupStatus === "Picked Up";

              return (
                <div key={receipt.id} className="card">
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                    <div>
                      <h3 style={{ margin: "0 0 8px" }}>
                        {receipt.id}
                        {receipt.isTest ? (
                          <span
                            style={{
                              marginLeft: 8,
                              fontSize: 12,
                              padding: "3px 8px",
                              borderRadius: 999,
                              background: "rgba(255,193,7,.18)",
                              border: "1px solid rgba(255,193,7,.45)",
                            }}
                          >
                            TEST
                          </span>
                        ) : null}
                      </h3>
                      <div><b>Name:</b> {receipt.customerName || "—"}</div>
                      <div><b>Mobile:</b> {receipt.customerMobile || "—"}</div>
                      <div><b>Status:</b> {receipt.paymentStatus || "Paid"}</div>
                      <div>
                        <b>Pickup:</b>{" "}
                        <span style={{ color: isPickedUp ? "#22c55e" : "#facc15" }}>
                          {pickupStatus}
                        </span>
                      </div>
                    </div>

                    <div style={{ textAlign: "right" }}>
                      <div><b>Total:</b> ₹{safeNum(receipt.total, 0)}</div>
                      <div className="muted" style={{ marginTop: 6 }}>
                        {getReceiptDate(receipt)
                          ? getReceiptDate(receipt).toLocaleString("en-IN")
                          : "—"}
                      </div>
                    </div>
                  </div>

                  <div style={{ marginTop: 14 }}>
                    <b>Items:</b>
                    <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                      {(receipt.items || []).map((item, idx) => (
                        <div
                          key={`${receipt.id}-${idx}`}
                          style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
                        >
                          <span>{item.displayName || item.name || "Item"} × {safeNum(item.qty, 0)}</span>
                          <span>
                            ₹{safeNum(
                              item.lineTotal,
                              safeNum(item.price, 0) * safeNum(item.qty, 0)
                            )}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="row" style={{ marginTop: 16, gap: 8, flexWrap: "wrap" }}>
                    <button className="btn" type="button" onClick={() => printShopReceipt(receipt)}>
                      Print Receipt
                    </button>

                    <button
                      className="btn"
                      type="button"
                      onClick={() =>
                        updateShopReceipt(receipt.id, {
                          pickupStatus: isPickedUp ? "Pending Pickup" : "Picked Up",
                          pickedUpAt: isPickedUp ? "" : new Date().toISOString(),
                        })
                      }
                    >
                      {isPickedUp ? "Mark Pending Pickup" : "Mark Picked Up"}
                    </button>

                    {admin ? (
                      <>
                        {receipt.isTest ? (
                          <button className="btn" type="button" onClick={() => markReceiptAsReal(receipt.id)}>
                            Mark Real
                          </button>
                        ) : (
                          <button className="btn" type="button" onClick={() => markReceiptAsTest(receipt.id)}>
                            Mark Test
                          </button>
                        )}

                        <button
                          className="btn"
                          type="button"
                          onClick={() => deleteShopReceipt(receipt.id)}
                          style={{
                            background: "linear-gradient(135deg, #ef4444, #991b1b)",
                            borderColor: "rgba(255,255,255,.22)",
                          }}
                        >
                          Delete Receipt
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}

function PaymentStatus({ data, commit }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [status, setStatus] = useState("checking");
    const [orderSaved, setOrderSaved] = useState(false);
  const [trustedPayment, setTrustedPayment] = useState(null);
  const processedRef = useRef(false);
  const [paymentPageLoadedAt] = useState(() => new Date().toISOString());

  function parseTrustedArray(value, fallback = []) {
    if (Array.isArray(value)) return value;
    if (!value) return fallback;

    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : fallback;
    } catch {
      return fallback;
    }
  }

  const localFoodCart = parseTrustedArray(localStorage.getItem("qclub_food_cart") || "[]");
  const localShopCart = parseTrustedArray(localStorage.getItem("qclub_shop_cart") || "[]");
  const trustedTags = trustedPayment?.fulfillment?.orderTags || {};
  const trustedCustomer = trustedPayment?.customer || {};
  const trustedAmount = Number(trustedPayment?.amount || 0);
  const paymentContext = String(
    trustedPayment?.context ||
      trustedTags.context ||
      localStorage.getItem("qclub_payment_context") ||
      ""
  ).toLowerCase();
  const foodCart = parseTrustedArray(trustedTags.food_items_json, localFoodCart);
  const foodTotal = String(trustedAmount || trustedTags.food_total || localStorage.getItem("qclub_food_total") || "0");
  const shopCartRaw = parseTrustedArray(trustedTags.shop_items_json, localShopCart);
  const shopTotal = String(trustedAmount || trustedTags.shop_total || localStorage.getItem("qclub_shop_total") || "0");
  const paymentMobile =
    trustedCustomer.phone || trustedTags.mobile || localStorage.getItem("qclub_payment_mobile") || "";
  const paymentName =
    trustedCustomer.name || trustedTags.customer_name || localStorage.getItem("qclub_payment_name") || "";
  const paymentTier = trustedTags.tier || localStorage.getItem("qclub_membership_tier") || "Member";
  const params = new URLSearchParams(location.search);
  const orderIdFromUrl = params.get("order_id") || "";
    const displayOrderNo = `QC-${String(orderIdFromUrl).slice(-6)}`;
    const existingFoodOrder = (data.foodOrders || []).find(
    (order) =>
      String(order?.id || "") === displayOrderNo ||
      String(order?.gatewayOrderId || "") === String(orderIdFromUrl || "")
  );
  const foodOrderTimeKey = `qclub_food_order_time_${displayOrderNo}`;
  const foodOrderProcessedKey = `qclub_food_order_processed_${displayOrderNo}`;
  const foodOrderMadeAt =
    existingFoodOrder?.time ||
    localStorage.getItem(foodOrderTimeKey) ||
    localStorage.getItem("qclub_food_order_started_at") ||
    paymentPageLoadedAt;
  const displayTime = new Date(foodOrderMadeAt).toLocaleString();
  const shopItems = Array.isArray(data.shopCatalog?.items) ? data.shopCatalog.items : [];

  function normalizeShopCatalogItem(item) {
    const normalizedOptions = Array.isArray(item?.options)
      ? item.options
          .map((opt, index) => ({
            id: String(opt?.id || `${item?.id || "item"}-opt-${index + 1}`),
            label: String(opt?.label || "").trim(),
            stock: Math.max(0, safeNum(opt?.stock, 0)),
            img: String(opt?.img || "").trim(),
          }))
          .filter((opt) => opt.label)
      : [];

    return {
      ...item,
      stock: Math.max(0, safeNum(item?.stock, 0)),
      options: normalizedOptions,
      optionGroupLabel: String(item?.optionGroupLabel || "").trim(),
    };
  }

  const normalizedShopItems = shopItems.map(normalizeShopCatalogItem);

  function normalizeShopCartEntries(rawCart) {
    if (Array.isArray(rawCart)) {
      return rawCart
        .map((entry) => {
          const found = normalizedShopItems.find((item) => item.id === entry?.itemId);
          if (!found) {
            const qty = Math.max(0, safeNum(entry?.qty, 0));
            if (qty <= 0) return null;

            const price = safeNum(entry?.price, 0);
            const itemId = String(entry?.itemId || entry?.id || "");
            const baseName = String(entry?.name || entry?.displayName || "Item").trim();
            const optionLabel = String(entry?.selectedOptionLabel || "").trim();

            return {
              id: itemId,
              itemId,
              name: baseName,
              displayName: String(entry?.displayName || baseName).trim(),
              qty,
              price,
              lineTotal: safeNum(entry?.lineTotal ?? price * qty),
              selectedOptionId: String(entry?.selectedOptionId || ""),
              selectedOptionLabel: optionLabel,
            };
          }

          const selectedOption = Array.isArray(found.options)
            ? found.options.find((opt) => opt.id === entry?.selectedOptionId) || null
            : null;

          const qty = Math.max(0, safeNum(entry?.qty, 0));
          if (qty <= 0) return null;

          const baseName = String(found.name || entry?.name || "Item").trim();
          const optionLabel =
            String(entry?.selectedOptionLabel || selectedOption?.label || "").trim();
          const displayName = optionLabel ? `${baseName} - ${optionLabel}` : baseName;
          const price = safeNum(entry?.price, safeNum(found.price, 0));

          return {
            id: found.id,
            itemId: found.id,
            name: baseName,
            displayName,
            qty,
            price,
            lineTotal: price * qty,
            selectedOptionId: String(entry?.selectedOptionId || selectedOption?.id || ""),
            selectedOptionLabel: optionLabel,
          };
        })
        .filter(Boolean);
    }

    if (rawCart && typeof rawCart === "object") {
      return Object.entries(rawCart)
        .map(([itemId, qty]) => {
          const found = normalizedShopItems.find((item) => item.id === itemId);
          if (!found) return null;

          const normalizedQty = Math.max(0, safeNum(qty, 0));
          if (normalizedQty <= 0) return null;

          return {
            id: found.id,
            itemId: found.id,
            name: found.name,
            displayName: found.name,
            qty: normalizedQty,
            price: safeNum(found.price, 0),
            lineTotal: safeNum(found.price, 0) * normalizedQty,
            selectedOptionId: "",
            selectedOptionLabel: "",
          };
        })
        .filter(Boolean);
    }

    return [];
  }

  const shopCart = normalizeShopCartEntries(shopCartRaw);

  const shopReceiptPreview = buildShopReceiptRecord({
    orderId: orderIdFromUrl,
    name: paymentName,
    mobile: paymentMobile,
    items: shopCart,
    total: shopTotal,
    paymentStatus: "Paid",
    createdAt: new Date().toISOString(),
  });

  const shopDisplayOrderNo =
    shopReceiptPreview?.orderNo ||
    `QSHOP-${String(orderIdFromUrl || "").slice(-8)}`;

  async function postPaymentAction(action, result = {}) {
    const response = await fetch("/api/get-order-status", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        order_id: orderIdFromUrl,
        action,
        result,
      }),
    });

    const json = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(json?.error || `Payment action failed with status ${response.status}`);
    }

    return json;
  }

  function fulfilTrustedPayment(payment) {
    const context = String(payment?.context || "").trim().toLowerCase();
    const tags = payment?.fulfillment?.orderTags || {};
    const customer = payment?.customer || {};
    const orderId = String(payment?.order_id || orderIdFromUrl || "");
    const customerName = String(customer.name || tags.customer_name || "Customer").trim() || "Customer";
    const customerPhone = String(customer.phone || tags.mobile || tags.phone || "").trim();
    const amount = String(payment?.amount || 0);
    const qcOrderNo = payment?.fulfillment?.orderNo || `QC-${String(orderId).slice(-6)}`;

    if (context === "food") {
      const items = parseTrustedArray(tags.food_items_json, []);
      if (!items.length) throw new Error("Trusted food order items are missing.");

      const alreadyExists = (data.foodOrders || []).some(
        (order) =>
          String(order?.id || "") === qcOrderNo ||
          String(order?.gatewayOrderId || "") === orderId
      );

      const orderedAt = new Date().toISOString();
      localStorage.setItem(`qclub_food_order_time_${qcOrderNo}`, orderedAt);
      localStorage.setItem(`qclub_food_order_processed_${qcOrderNo}`, "yes");

      if (!alreadyExists) {
        const foodWhatsappDraft = buildWhatsappDraft({
          phone: customerPhone,
          label: "food_success",
          text: buildFoodWhatsappText({
            name: customerName,
            orderNo: qcOrderNo,
            orderedAt,
            total: amount,
            items,
          }),
        });

        const foodItemsForWhatsapp = items
          .map((item, index) => {
            const itemName = String(item?.name || "").trim();
            const qty = Number(item?.qty || 0);
            if (!itemName) return "";
            return `${index + 1}. ${itemName}${qty > 0 ? ` x ${qty}` : ""}`;
          })
          .filter(Boolean)
          .join("\n");

        foodWhatsappDraft.name = customerName;
        foodWhatsappDraft.customerName = customerName;
        foodWhatsappDraft.orderNo = qcOrderNo;
        foodWhatsappDraft.itemListText = foodItemsForWhatsapp || "Food items";
        foodWhatsappDraft.total = amount;
        foodWhatsappDraft.templateParams = [
          foodWhatsappDraft.customerName,
          foodWhatsappDraft.orderNo,
          foodWhatsappDraft.itemListText,
          foodWhatsappDraft.total,
        ];

        commit({
          ...data,
          foodOrders: [
            ...(data.foodOrders || []),
            {
              id: qcOrderNo,
              gatewayOrderId: orderId,
              name: customerName,
              mobile: customerPhone,
              items,
              total: amount,
              time: orderedAt,
              status: "Paid",
              printMeta: {
                status: "pending_auto_print",
                requestedAt: new Date().toISOString(),
                printedAt: "",
              },
            },
          ],
          speakerAlerts: [
            ...(data.speakerAlerts || []),
            {
              id: uid(),
              type: "food_order",
              text: "New food order received. New food order received.",
              createdAt: Date.now(),
              playedAt: "",
            },
          ],
          whatsappJobs: [
            ...(data.whatsappJobs || []),
            createWhatsappJob("food_success", {
              ...foodWhatsappDraft,
              orderNo: qcOrderNo,
              orderNumber: qcOrderNo,
            }),
          ],
        });
      }

      setOrderSaved(true);
      return { context, orderNo: qcOrderNo, inserted: !alreadyExists };
    }

    if (context === "shop") {
      const trustedShopCart = normalizeShopCartEntries(parseTrustedArray(tags.shop_items_json, []));
      if (!trustedShopCart.length) throw new Error("Trusted shop order items are missing.");

      const createdAt = new Date().toISOString();
      const receipt = buildShopReceiptRecord({
        orderId,
        name: customerName,
        mobile: customerPhone,
        items: trustedShopCart,
        total: amount,
        paymentStatus: "Paid",
        createdAt,
      });

      const existingShopReceipt = (data.shopReceipts || []).find(
        (r) => String(r.gatewayOrderId || "") === orderId
      );
      const stockAlreadyAdjusted = existingShopReceipt?.stockAdjusted === true;
      const receiptWithStockMarker = {
        ...receipt,
        stockAdjusted: true,
        stockAdjustedAt: createdAt,
      };
      const nextShopReceipts = existingShopReceipt
        ? (data.shopReceipts || []).map((r) =>
            String(r.gatewayOrderId || "") === orderId
              ? {
                  ...r,
                  stockAdjusted: true,
                  stockAdjustedAt: r.stockAdjustedAt || createdAt,
                }
              : r
          )
        : [...(data.shopReceipts || []), receiptWithStockMarker];

      const nextShopItems = stockAlreadyAdjusted
        ? normalizedShopItems
        : normalizedShopItems.map((item) => {
            const purchasesForItem = trustedShopCart.filter((x) => x.itemId === item.id);
            if (!purchasesForItem.length) return item;

            if (Array.isArray(item.options) && item.options.length > 0) {
              return {
                ...item,
                options: item.options.map((opt) => {
                  const purchasedQty = purchasesForItem
                    .filter((x) => x.selectedOptionId === opt.id)
                    .reduce((sum, x) => sum + safeNum(x.qty, 0), 0);

                  return purchasedQty > 0
                    ? { ...opt, stock: Math.max(0, safeNum(opt.stock, 0) - purchasedQty) }
                    : opt;
                }),
              };
            }

            const purchasedQty = purchasesForItem.reduce(
              (sum, x) => sum + safeNum(x.qty, 0),
              0
            );

            return {
              ...item,
              stock: Math.max(0, safeNum(item.stock, 0) - purchasedQty),
            };
          });

      commit({
        ...data,
        shopReceipts: nextShopReceipts,
        shopCatalog: {
          ...(data.shopCatalog || {}),
          items: nextShopItems,
        },
      });

      setOrderSaved(true);
      return {
        context,
        orderNo: receipt.orderNo || `QSHOP-${String(orderId).slice(-8)}`,
        inserted: !existingShopReceipt,
      };
    }

    if (context === "booking") {
      const bookingTable = String(tags.table_label || "").trim();
      const bookingDateValue = String(tags.booking_date || "").trim();
      const bookingSlotValue = String(tags.booking_slot || "").trim();
      const bookingAmountValue = String(tags.booking_amount || amount || "0");
      const bookingReference = `BK-${String(orderId).slice(-5)}`;
      const bookingWhatsappDraft = buildWhatsappDraft({
        phone: customerPhone,
        label: "booking_success",
        text: buildBookingWhatsappText({
          name: customerName,
          table: bookingTable,
          bookedAt: new Date().toISOString(),
          bookingDate: bookingDateValue,
          bookingSlot: bookingSlotValue,
          amount: bookingAmountValue,
        }),
      });

      bookingWhatsappDraft.templateParams = [
        customerName,
        bookingReference,
        bookingTable || "Booked Table",
        bookingDateValue || "—",
        bookingSlotValue || "—",
      ];

      const bookingSpeakerText =
        `${bookingTable || "Booked table"} booked by ${customerName || "customer"} ` +
        `on ${bookingDateValue || "the selected date"} ` +
        `from ${bookingSlotValue || "the booked slot"}.`;

      commit({
        ...data,
        announcements: [
          {
            id: uid(),
            type: "table_booking",
            text:
              `${bookingTable || "Booked table"} booked by ${customerName || "Customer"} ` +
              `on ${bookingDateValue || "the selected date"} ` +
              `from ${bookingSlotValue || "the booked slot"}.`,
            link: "/book",
            createdAt: Date.now(),
            expiresAt: bookingAnnouncementExpiresAt(bookingDateValue, bookingSlotValue),
          },
          ...(data.announcements || []),
        ].slice(0, 20),
        speakerAlerts: [
          ...(data.speakerAlerts || []),
          {
            id: uid(),
            type: "booking_success",
            text: bookingSpeakerText,
            createdAt: Date.now(),
            playedAt: "",
          },
        ],
        whatsappJobs: [
          ...(data.whatsappJobs || []),
          createWhatsappJob("booking_success", bookingWhatsappDraft),
        ],
      });

      setOrderSaved(true);
      return { context, orderNo: bookingReference, bookingUpdated: true };
    }

    if (context === "membership") {
      const tier = String(tags.tier || "Member").trim() || "Member";
      const today = todayIso();
      const validUntil =
        String(tags.valid_until || "").trim() ||
        new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const normalizedName = customerName.toLowerCase();
      const existing = (data.memberRegistry || []).find((m) => {
        const memberName = String(m?.name || "").trim().toLowerCase();
        const memberMobile = String(m?.mobile || "").trim();
        return memberName === normalizedName && memberMobile === customerPhone;
      });
      const nextRegistry = existing
        ? (data.memberRegistry || []).map((m) => {
            const memberName = String(m?.name || "").trim().toLowerCase();
            const memberMobile = String(m?.mobile || "").trim();
            return memberName === normalizedName && memberMobile === customerPhone
              ? {
                  ...m,
                  name: customerName,
                  mobile: customerPhone,
                  validUntil,
                  status: "active",
                  tier,
                }
              : m;
          })
        : [
            ...(data.memberRegistry || []),
            {
              id: `reg_${Date.now()}`,
              name: customerName,
              mobile: customerPhone,
              tier,
              joinedOn: today,
              validUntil,
              status: "active",
              notes: "Auto-created after verified payment",
            },
          ];

      const nextMembersPage = (data.membersPage || []).some(
        (m) => String(m?.name || "").trim().toLowerCase() === normalizedName
      )
        ? (data.membersPage || []).map((m) =>
            String(m?.name || "").trim().toLowerCase() === normalizedName
              ? {
                  ...m,
                  name: customerName,
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
              name: customerName,
              tier,
              joinedOn: today,
              note: "Member",
            },
          ];

      const membershipWhatsappDraft = buildWhatsappDraft({
        phone: customerPhone,
        label: "membership_success",
        text: buildMembershipWhatsappText({
          name: customerName,
          tier,
          activatedAt: new Date().toISOString(),
          validUntil,
        }),
      });

      membershipWhatsappDraft.templateName =
        getWhatsappTemplateForLabel("membership_success", getWhatsappSettings());
      membershipWhatsappDraft.templateParams = [
        customerName,
        tier,
        formatWhatsappDateTime(new Date()),
        validUntil || "—",
      ];

      commit({
        ...data,
        memberRegistry: nextRegistry,
        membersPage: nextMembersPage,
        announcements: [
          {
            id: uid(),
            text: `${customerName} joins as the latest Q Club member !`,
            link: "/membership",
            createdAt: Date.now(),
          },
          ...(data.announcements || []),
        ].slice(0, 20),
        speakerAlerts: [
          ...(data.speakerAlerts || []),
          {
            id: uid(),
            type: "membership_success",
            text: `${customerName || "Member"} joined as the latest ${tier || "Q Club"} member.`,
            createdAt: Date.now(),
            playedAt: "",
          },
        ],
        whatsappJobs: [
          ...(data.whatsappJobs || []),
          createWhatsappJob("membership_success", membershipWhatsappDraft),
        ],
      });

      setOrderSaved(true);
      return { context, orderNo: `MEM-${String(orderId).slice(-6)}`, membershipUpserted: true };
    }

    if (context === "tournament") {
      const tournamentId = String(tags.tournament_id || "").trim();
      const tournamentName = String(tags.tournament_name || "Current Tournament").trim();
      const tournamentFee = String(tags.tournament_fee || amount || "0");
      const existingPlayerId = String(tags.tournament_player_id || "").trim();
      if (!tournamentId || !customerName) throw new Error("Trusted tournament details are missing.");

      let nextPlayers = [...(data.players || [])];
      let finalPlayerId = existingPlayerId;
      if (!finalPlayerId) {
        const existingPlayer = nextPlayers.find(
          (p) => String(p.name || "").trim().toLowerCase() === customerName.toLowerCase()
        );
        if (existingPlayer) {
          finalPlayerId = existingPlayer.id;
        } else {
          const newPlayer = {
            id: `pl_${Date.now()}`,
            name: customerName,
            mobile: customerPhone,
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
        return {
          ...t,
          participantIds: currentIds.includes(finalPlayerId)
            ? currentIds
            : [...currentIds, finalPlayerId],
        };
      });

      const tournamentWhatsappDraft = buildWhatsappDraft({
        phone: customerPhone,
        label: "tournament_success",
        text: buildTournamentWhatsappText({
          name: customerName,
          tournamentName,
          registeredAt: new Date().toISOString(),
          fee: tournamentFee,
        }),
      });
      tournamentWhatsappDraft.templateParams = [
        customerName || "Player",
        tournamentName || "Tournament",
        String(tournamentFee || "0"),
      ];

      commit({
        ...data,
        players: nextPlayers,
        tournaments: nextTournaments,
        announcements: [
          {
            id: uid(),
            text: `${customerName} registered for ${tournamentName || "the current tournament"} ! Register now`,
            link: `/tournament-register?id=${tournamentId}`,
            createdAt: Date.now(),
          },
          ...(data.announcements || []),
        ].slice(0, 20),
        speakerAlerts: [
          ...(data.speakerAlerts || []),
          {
            id: uid(),
            type: "tournament_success",
            text: `${customerName || "Player"} successfully registered for ${tournamentName || "the tournament"}.`,
            createdAt: Date.now(),
            playedAt: "",
          },
        ],
        whatsappJobs: [
          ...(data.whatsappJobs || []),
          createWhatsappJob("tournament_success", tournamentWhatsappDraft),
        ],
      });

      setOrderSaved(true);
      return { context, orderNo: `TOUR-${String(orderId).slice(-6)}`, tournamentRegistered: true };
    }

    throw new Error("Unsupported trusted payment context.");
  }

  useEffect(() => {
    let cancelled = false;

    async function verifyAndFulfil() {
      if (!orderIdFromUrl) {
        setStatus("failed");
        return;
      }

      try {
        const response = await fetch(
          `/api/get-order-status?order_id=${encodeURIComponent(orderIdFromUrl)}`
        );
        const orderData = await response.json().catch(() => null);

        if (cancelled) return;
        setTrustedPayment(orderData || null);

        if (!response.ok || !orderData?.verified) {
          setStatus(orderData?.order_status === "ACTIVE" ? "checking" : "failed");
          return;
        }

        if (orderData.fulfilled) {
          setOrderSaved(true);
          setStatus("success");
          return;
        }

        if (processedRef.current) return;
        processedRef.current = true;

        const claim = await postPaymentAction("claim_fulfillment");
        if (cancelled) return;
        setTrustedPayment(claim || orderData);

        if (claim?.fulfilled) {
          setOrderSaved(true);
          setStatus("success");
          return;
        }

        if (claim?.claimAccepted === false) {
          setStatus("checking");
          return;
        }

        if (!claim?.verified) {
          setStatus("failed");
          return;
        }

        const result = fulfilTrustedPayment(claim);
        const acknowledged = await postPaymentAction("acknowledge_fulfillment", result);

        if (cancelled) return;
        setTrustedPayment(acknowledged || claim);
        setStatus("success");
      } catch (error) {
        console.error("Payment verification error:", error);
        if (!cancelled) setStatus("failed");
      }
    }

    verifyAndFulfil();

    return () => {
      cancelled = true;
    };
  }, [location.search]);



  useEffect(() => {
  // Auto-print for food orders is handled only by the counter PC admin/staff watcher.
  // Keep success-page printing manual to avoid duplicate receipts.
}, [status, paymentContext, orderIdFromUrl]);

  function retryPath() {
  if (paymentContext === "food") return "/offer";
  if (paymentContext === "shop") return "/shop";
  if (paymentContext === "membership") return "/membership";
  if (paymentContext === "tournament") return "/tournament-register";
  if (paymentContext === "booking") return "/book";

  const savedRetryPath = localStorage.getItem("qclub_retry_path") || "";
  if (savedRetryPath) return savedRetryPath;

  const savedShopCart = localStorage.getItem("qclub_shop_cart") || "";
  const savedShopTotal = localStorage.getItem("qclub_shop_total") || "";

  if (savedShopCart || savedShopTotal) return "/shop";

  return "/book";
}

  const savedName = paymentName || localStorage.getItem("qclub_payment_name") || "";
  const savedMobile = paymentMobile || localStorage.getItem("qclub_payment_mobile") || "";
  const table = trustedTags.table_label || localStorage.getItem("qclub_booking_table") || "";
  const bookingDate = trustedTags.booking_date || localStorage.getItem("qclub_booking_date") || "";
  const bookingSlot = trustedTags.booking_slot || localStorage.getItem("qclub_booking_slot") || "";
  const tier = trustedTags.tier || localStorage.getItem("qclub_membership_tier") || "";
  const tshirtSize = trustedTags.tshirt_size || localStorage.getItem("qclub_tshirt_size") || "";
  const tournamentName =
    trustedTags.tournament_name ||
    localStorage.getItem("qclub_tournament_name") ||
    "Current Tournament";
  const tournamentFee =
    trustedTags.tournament_fee || String(trustedAmount || "") || localStorage.getItem("qclub_tournament_fee") || "";

    function downloadFoodReceiptPdf() {
    const params = new URLSearchParams(location.search);
    const orderIdFromUrl = params.get("order_id") || "";
    const displayOrderNo = `QC-${String(orderIdFromUrl).slice(-6)}`;
    const nowText = displayTime;

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

  function downloadShopReceiptPdf() {
    const receipt = buildShopReceiptRecord({
      orderId: orderIdFromUrl,
      name: paymentName,
      mobile: paymentMobile,
      items: shopCart,
      total: shopTotal,
      paymentStatus: "Paid",
      createdAt: new Date().toISOString(),
    });

    printShopReceipt(receipt);
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
                  <button
                    className="btn"
                    onClick={() =>
                                            printFoodReceipt(
                        buildFoodReceiptRecord(
                          {
                            id: displayOrderNo,
                            name: paymentName,
                            mobile: paymentMobile,
                            items: foodCart,
                            total: foodTotal,
                            time: foodOrderMadeAt,
                            status: "Paid",
                          },
                          data.club || {}
                        )
                      )
                    }
                  >
                    Print Receipt
                  </button>
                  <button className="btn" onClick={downloadFoodReceiptPdf}>
                    Download PDF
                  </button>
                  <button className="btn" onClick={() => navigate("/")}>
                    Home
                  </button>
                </div>
              </>
            ) : paymentContext === "shop" ? (
              <>
                <h2>Thank You for Shopping at The Q Club</h2>
                <div style={{ marginTop: 10, marginBottom: 14 }}>
                  <div><b>Order No:</b> {shopDisplayOrderNo}</div>
                  <div><b>Time:</b> {displayTime}</div>
                </div>

                <div className="card" style={{ marginTop: 14 }}>
                  <div><b>Name:</b> {paymentName || "—"}</div>
                  <div><b>Mobile:</b> {paymentMobile || "—"}</div>

                  <div style={{ marginTop: 12 }}><b>Items:</b></div>

                  {shopCart.length > 0 ? (
                    shopCart.map((item, index) => (
                      <div
                        key={`${item.itemId || item.id}-${item.selectedOptionId || "base"}-${index}`}
                        style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
                      >
                        <span>{item.displayName || item.name} × {item.qty}</span>
                        <span>₹{item.lineTotal}</span>
                      </div>
                    ))
                  ) : (
                    <div className="muted">No items found.</div>
                  )}

                  <div style={{ marginTop: 10, fontWeight: 700 }}>
                    Total Paid: ₹{shopTotal}
                  </div>
                </div>

                <div className="row" style={{ marginTop: 16, gap: 8, flexWrap: "wrap" }}>
                  <button className="btn primary" onClick={() => navigate("/shop")}>
                    Continue Shopping
                  </button>

                  <button
                    className="btn"
                    type="button"
                    onClick={() =>
                      downloadShopReceipt(
                        buildShopReceiptRecord({
                          orderId: orderIdFromUrl,
                          name: paymentName,
                          mobile: paymentMobile,
                          items: shopCart,
                          total: shopTotal,
                          paymentStatus: "Paid",
                          createdAt: new Date().toISOString(),
                        })
                      )
                    }
                  >
                    Download Receipt
                  </button>

                  <button
                    className="btn"
                    type="button"
                    onClick={() =>
                      printShopReceipt(
                        buildShopReceiptRecord({
                          orderId: orderIdFromUrl,
                          name: paymentName,
                          mobile: paymentMobile,
                          items: shopCart,
                          total: shopTotal,
                          paymentStatus: "Paid",
                          createdAt: new Date().toISOString(),
                        })
                      )
                    }
                  >
                    Print Receipt
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
            <p className="muted">Please try again to complete your order.</p>

            <div className="row" style={{ marginTop: 16, gap: 8, flexWrap: "wrap" }}>
              <button className="btn primary" onClick={() => navigate(retryPath())}>
                Try Again
              </button>
              <button className="btn" onClick={() => navigate("/")}>
                Home
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
function JobApplicationPage({ data, commit }) {
  const acceptingApplications = data?.jobSettings?.acceptingApplications !== false;

  const [form, setForm] = useState({
    position: "",
    name: "",
    age: "",
    phone: "",
    email: "",
    address: "",
    education: "",
    experience: "",
    languages: "",
    aadhaarNumber: "",
    panNumber: "",
    techComfort: "",
    eveningDuty: "",
    cleaningDuty: "",
    tobaccoUse: "",
    reason: "",
    contractAccepted: false,
    tobaccoPolicyAccepted: false,
  });

  const [photoFile, setPhotoFile] = useState(null);
  const [aadhaarFile, setAadhaarFile] = useState(null);
  const [panFile, setPanFile] = useState(null);
  const [busy, setBusy] = useState(false);

  const update = (key, value) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const validateFile = (file, allowedTypes, maxMb, label) => {
    if (!file) throw new Error(`${label} is required.`);

    const type = String(file.type || "").toLowerCase();
    const okType = allowedTypes.some((allowed) => type.includes(allowed));

    if (!okType) {
      throw new Error(`${label} must be in allowed format.`);
    }

    if (file.size > maxMb * 1024 * 1024) {
      throw new Error(`${label} must be below ${maxMb} MB.`);
    }
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!acceptingApplications) {
      alert("Applications are currently closed.");
      return;
    }
    if (!form.position) return alert("Please select position applied for.");

    if (!form.name.trim()) return alert("Full name is required.");
    if (!form.age.trim()) return alert("Age is required.");
    if (!form.phone.trim()) return alert("Phone / WhatsApp number is required.");
    if (!form.address.trim()) return alert("Address is required.");
    if (!form.aadhaarNumber.trim()) return alert("Aadhaar number is required.");

const cleanAadhaar = form.aadhaarNumber.trim().replace(/\s+/g, "");
const aadhaarOk = /^[0-9]{12}$/.test(cleanAadhaar);
if (!aadhaarOk) return alert("Enter a valid 12-digit Aadhaar number.");

if (!form.panNumber.trim()) return alert("PAN number is required.");
    const cleanPan = form.panNumber.trim().toUpperCase();
const panOk = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(cleanPan);
if (!panOk) return alert("Enter a valid PAN number. Example: ABCDE1234F");

if (!form.techComfort) return alert("Please select smartphone/computer comfort.");
if (!form.eveningDuty) return alert("Please select evening duty comfort.");
if (!form.cleaningDuty) return alert("Please select cleaning duty comfort.");
if (!form.tobaccoUse) return alert("Please select tobacco/gutka/pan masala answer.");
    if (!form.contractAccepted) return alert("Please accept the 12-month notarized contract condition.");
    if (!form.tobaccoPolicyAccepted) return alert("Please accept the tobacco-free workplace policy.");

    try {
      validateFile(photoFile, ["jpeg", "jpg", "png"], 2, "Recent photograph");
      validateFile(aadhaarFile, ["jpeg", "jpg", "png", "pdf"], 3, "Aadhaar upload");
      validateFile(panFile, ["jpeg", "jpg", "png", "pdf"], 3, "PAN upload");

      setBusy(true);

      const photoUpload = await uploadImageToStorage(photoFile, "job-applications/photos");
      const aadhaarUpload = await uploadImageToStorage(aadhaarFile, "job-applications/aadhaar");
      const panUpload = await uploadImageToStorage(panFile, "job-applications/pan");

      const nextSerial = (data.jobApplications || []).length + 1;
const applicationId = `JOB-${new Date().getFullYear()}-${String(nextSerial).padStart(4, "0")}`;

const application = {
  id: uid(),
  applicationId,
  createdAt: new Date().toISOString(),
  status: "new",
        ...form,
        photo: photoUpload,
        aadhaarFile: aadhaarUpload,
        panFile: panUpload,
      };

           const jobTemplate =
  (data.whatsappPersistence?.customTemplates || []).find(
    (template) => template.key === "job_application_received"
  )?.templateName ||
  data.whatsappPersistence?.settings?.jobApplicationReceivedTemplate ||
  "job_application_received";

const jobWhatsappDraft = {
  label: "job_application_received",
  phone: normalizeWhatsappNumber(form.phone),
  text: `Hello ${form.name}, your employment application at The Q Club Pasighat has been received successfully. Application ID: ${applicationId}`,
  templateName: jobTemplate,
  templateParams: [form.name, applicationId],
};

commit({
  ...data,
  jobApplications: [application, ...(data.jobApplications || [])],
});

try {
  const whatsappSettings = data.whatsappPersistence?.settings || {};

  await fetch("/api/whatsapp-send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      authKey: whatsappSettings.authKey,
      senderNumber: whatsappSettings.senderNumber,
      senderLabel: whatsappSettings.senderLabel,
      phone: normalizeWhatsappNumber(form.phone),
      templateName: jobTemplate,
      templateParams: [form.name, applicationId],
      label: "job_application_received",
      text: jobWhatsappDraft.text,
    }),
  });
} catch (waError) {
  console.warn("Job application WhatsApp send failed:", waError);
}

      alert("Application submitted successfully. The Q Club will contact shortlisted candidates.");
      setForm({
        position: "",
        name: "",
        age: "",
        phone: "",
          email: "",
        address: "",
        education: "",
        experience: "",
        languages: "",
        aadhaarNumber: "",
        panNumber: "",
        techComfort: "",
        eveningDuty: "",
        cleaningDuty: "",
        tobaccoUse: "",
        reason: "",
        contractAccepted: false,
        tobaccoPolicyAccepted: false,
      });
      setPhotoFile(null);
      setAadhaarFile(null);
      setPanFile(null);
      event.target.reset();
    } catch (error) {
      alert(error?.message || "Unable to submit application.");
    } finally {
      setBusy(false);
    }
  };

  if (!acceptingApplications) {
    return (
      <>
        <PageShell title="Job Applications" />
        <div className="container">
          <div className="card">
            <h2>Applications Closed</h2>
            <p className="muted">
              Applications are currently closed. Thank you for your interest in The Q Club Pasighat.
            </p>
          </div>
        </div>
        <BottomPadding />
      </>
    );
  }

  return (
    <>
      <PageShell
  title="Career Opportunities at The Q Club Pasighat"
  subtitle="Join one of Arunachal Pradesh's most modern premium recreation and entertainment clubs."
/>
      <div className="container">
        <form className="card grid" onSubmit={handleSubmit}>
          <div className="cols-12">
            <h2>Join The Q Club Team</h2>
<p className="muted">
  Smart â€¢ Professional â€¢ Tech-Friendly â€¢ Growth-Oriented
</p>
<p className="muted">
  Please fill the form carefully. Photograph, Aadhaar and PAN uploads are mandatory.
</p>
          </div>
<label className="cols-12">
  Position Applied For *
  <select
    value={form.position}
    onChange={(e) => update("position", e.target.value)}
  >
    <option value="">Select position</option>
    {(data?.jobSettings?.positions || []).map((position) => (
      <option key={position} value={position}>
        {position}
      </option>
    ))}
  </select>
</label>
          <label className="cols-6">
            Full Name *
            <input value={form.name} onChange={(e) => update("name", e.target.value)} />
          </label>

          <label className="cols-6">
            Age *
            <input value={form.age} onChange={(e) => update("age", e.target.value)} />
          </label>

          <label className="cols-6">
            Phone / WhatsApp *
            <input value={form.phone} onChange={(e) => update("phone", e.target.value)} />
          </label>
          <label className="cols-6">
  Email
  <input value={form.email} onChange={(e) => update("email", e.target.value)} />
</label>

          <label className="cols-6">
            Education
            <input value={form.education} onChange={(e) => update("education", e.target.value)} />
          </label>

          <label className="cols-12">
            Address *
            <textarea value={form.address} onChange={(e) => update("address", e.target.value)} />
          </label>

          <label className="cols-6">
            Aadhaar Number *
            <input value={form.aadhaarNumber} onChange={(e) => update("aadhaarNumber", e.target.value)} />
          </label>

          <label className="cols-6">
            PAN Number *
            <input value={form.panNumber} onChange={(e) => update("panNumber", e.target.value.toUpperCase())} />
          </label>

          <label className="cols-6">
            Recent Photograph * (JPG/PNG, max 2 MB)
            <input type="file" accept="image/jpeg,image/png" onChange={(e) => setPhotoFile(e.target.files?.[0] || null)} />
          </label>

          <label className="cols-6">
            Aadhaar Upload * (JPG/PNG/PDF, max 3 MB)
            <input type="file" accept="image/jpeg,image/png,application/pdf" onChange={(e) => setAadhaarFile(e.target.files?.[0] || null)} />
          </label>

          <label className="cols-6">
            PAN Upload * (JPG/PNG/PDF, max 3 MB)
            <input type="file" accept="image/jpeg,image/png,application/pdf" onChange={(e) => setPanFile(e.target.files?.[0] || null)} />
          </label>

          <label className="cols-6">
            Languages Known
            <input value={form.languages} onChange={(e) => update("languages", e.target.value)} />
          </label>

          <label className="cols-12">
            Previous Work Experience
            <textarea value={form.experience} onChange={(e) => update("experience", e.target.value)} />
          </label>

          <label className="cols-6">
            Comfortable using smartphone/computer?
            <select value={form.techComfort} onChange={(e) => update("techComfort", e.target.value)}>
              <option value="">Select</option>
              <option>Yes</option>
              <option>No</option>
            </select>
          </label>

          <label className="cols-6">
            Comfortable with evening duty?
            <select value={form.eveningDuty} onChange={(e) => update("eveningDuty", e.target.value)}>
              <option value="">Select</option>
              <option>Yes</option>
              <option>No</option>
            </select>
          </label>

          <label className="cols-6">
            Comfortable with cleaning duties?
            <select value={form.cleaningDuty} onChange={(e) => update("cleaningDuty", e.target.value)}>
              <option value="">Select</option>
              <option>Yes</option>
              <option>No</option>
            </select>
          </label>

          <label className="cols-6">
            Do you currently consume tobacco/gutka/pan masala?
            <select value={form.tobaccoUse} onChange={(e) => update("tobaccoUse", e.target.value)}>
              <option value="">Select</option>
              <option>No</option>
              <option>Gutka / Pan Masala</option>
              <option>Tobacco</option>
              <option>Cigarettes</option>
              <option>Other</option>
            </select>
          </label>

          <label className="cols-12">
            Why do you want to work at The Q Club?
            <textarea value={form.reason} onChange={(e) => update("reason", e.target.value)} />
          </label>

          <label className="cols-12" style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <input
              type="checkbox"
              checked={form.contractAccepted}
              onChange={(e) => update("contractAccepted", e.target.checked)}
              style={{ width: "auto", marginTop: 4 }}
            />
            <span>
              I understand that a notarized 12-month employment contract must be signed before joining,
              and I should proceed only if I am comfortable with this condition.
            </span>
          </label>

          <label className="cols-12" style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <input
              type="checkbox"
              checked={form.tobaccoPolicyAccepted}
              onChange={(e) => update("tobaccoPolicyAccepted", e.target.checked)}
              style={{ width: "auto", marginTop: 4 }}
            />
            <span>
              I agree to follow The Q Club Pasighat's tobacco-free and professional workplace policy.
            </span>
          </label>

          <div className="cols-12">
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? "Submitting..." : "Submit Application"}
            </button>
          </div>
        </form>
      </div>
      <BottomPadding />
    </>
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



