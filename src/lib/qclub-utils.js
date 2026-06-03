export function uid() {
  return Math.random().toString(16).slice(2) + "-" + Date.now().toString(16);
}

export function safeNum(x, fallback = 0) {
  const v = Number(x);
  return Number.isFinite(v) ? v : fallback;
}

export function monthKey(d = new Date()) {
  return d.toISOString().slice(0, 7);
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function toLocalYmd(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return "";

  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function bookingAnnouncementExpiresAt(bookingDate, timeSlot) {
  const safeDate = String(bookingDate || "").trim();
  const safeSlot = String(timeSlot || "").trim();

  if (!safeDate || !safeSlot) return null;

  let endPart = "";

  if (safeSlot.includes(" to ")) {
    [, endPart] = safeSlot.split(" to ");
  } else if (safeSlot.includes("-")) {
    [, endPart] = safeSlot.split("-");
  } else {
    return null;
  }

  const [endHourStr, endMinuteStr = "00"] = String(endPart || "").trim().split(":");

  const year = Number(safeDate.slice(0, 4));
  const month = Number(safeDate.slice(5, 7));
  const day = Number(safeDate.slice(8, 10));
  const endHour = Number(endHourStr);
  const endMinute = Number(endMinuteStr);

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(endHour) ||
    !Number.isFinite(endMinute)
  ) {
    return null;
  }

  const expiry = new Date(year, month - 1, day, endHour, endMinute, 0, 0);
  expiry.setMinutes(expiry.getMinutes() + 15);

  return expiry.getTime();
}

export function isAnnouncementVisible(a) {
  if (!a) return false;

  if (a.type === "table_booking") {
  const expiresAt =
    Number.isFinite(Number(a.expiresAt)) ? Number(a.expiresAt) : null;

  if (expiresAt) {
    return Date.now() < expiresAt;
  }

  const createdAt =
    Number.isFinite(Number(a.createdAt)) ? Number(a.createdAt) : null;

  if (createdAt) {
    return Date.now() < createdAt + 15 * 60 * 1000;
  }

  return true;
}

  const text = String(a.text || "").toLowerCase();
  const isLegacyBookingAnnouncement =
  text.includes("booked by") &&
  (text.includes("today at") || /\d{4}-\d{2}-\d{2}/.test(text)) &&
  (
    /\d{2}:\d{2}\s*-\s*\d{2}:\d{2}/.test(text) ||
    /\d{2}:\d{2}\s+to\s+\d{2}:\d{2}/.test(text)
  );

  if (isLegacyBookingAnnouncement) {
    return false;
  }

  return true;
}

export function formatWhatsappDateTime(value = new Date()) {
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

export function scrollAnyOpenPanelToTop() {
  requestAnimationFrame(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });

    document
      .querySelectorAll(".modal-body, .sheet-body, .drawer-body, .page-body, .legal-body")
      .forEach((el) => {
        el.scrollTo({ top: 0, left: 0, behavior: "auto" });
      });
  });
}

export function timeToMinutes(value = "") {
  const safe = String(value || "").trim();
  const [hourStr, minuteStr] = safe.split(":");
  const hour = Number(hourStr);
  const minute = Number(minuteStr);

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;

  return hour * 60 + minute;
}

export function minutesToTime(totalMinutes = 0) {
  const normalized = ((Number(totalMinutes) % (24 * 60)) + (24 * 60)) % (24 * 60);
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function bookingEndTime(startTime = "", durationHours = 1) {
  const startMinutes = timeToMinutes(startTime);
  if (!Number.isFinite(startMinutes)) return "";

  const safeDuration = Math.max(1, safeNum(durationHours, 1));
  return minutesToTime(startMinutes + safeDuration * 60);
}

export function bookingSlotLabel(startTime = "", durationHours = 1) {
  const endTime = bookingEndTime(startTime, durationHours);
  if (!startTime || !endTime) return "";

  return `${startTime} to ${endTime}`;
}

export function bookingAmountFor(table, bookingType) {
  if (!table) return 0;

  if (bookingType === "member") {
    return Math.max(
      0,
      safeNum(
        table.memberPricePerHour ?? table.pricePerHour,
        0
      )
    );
  }

  return Math.max(0, safeNum(table.pricePerHour, 0));
}

export function bookingTotalAmount(table, bookingType, durationHours = 1) {
  const hourlyAmount = bookingAmountFor(table, bookingType);
  const safeDuration = Math.max(1, safeNum(durationHours, 1));

  return hourlyAmount * safeDuration;
}

export function isActiveBookingStatus(status) {
  return [
    "pending",
    "verified",
    "pending_member_verification",
    "member_verified",
  ].includes(status);
}

export function hasBookingConflict(requests, nextRequest) {
  const nextStartTime = String(nextRequest?.timeSlot || "").includes(" to ")
    ? String(nextRequest?.timeSlot || "").split(" to ")[0]
    : nextRequest?.timeSlot || "";

  const nextStart = timeToMinutes(nextStartTime);
  const nextEnd = timeToMinutes(
    nextRequest?.endTime || bookingEndTime(nextStartTime, nextRequest?.durationHours || 1)
  );

  if (!Number.isFinite(nextStart) || !Number.isFinite(nextEnd)) return false;

  return (requests || []).some((r) => {
    if (!isActiveBookingStatus(r.status)) return false;
    if (r.itemId !== nextRequest.itemId) return false;
    if (r.bookingDate !== nextRequest.bookingDate) return false;

    const existingStartTime = String(r?.timeSlot || "").includes(" to ")
      ? String(r?.timeSlot || "").split(" to ")[0]
      : r?.timeSlot || "";

    const existingStart = timeToMinutes(existingStartTime);
    const existingEnd = timeToMinutes(
      r?.endTime || bookingEndTime(existingStartTime, r?.durationHours || 1)
    );

    if (!Number.isFinite(existingStart) || !Number.isFinite(existingEnd)) return false;

    return nextStart < existingEnd && nextEnd > existingStart;
  });
}

export function bookingStatusLabel(status) {
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

export function offerPriceLines(price) {
  if (!price) return [];

  return String(price)
    .split(/\s*[•|]\s*|\s*,\s*/g)
    .map((x) => x.trim())
    .filter(Boolean);
}

export function tournamentDisplay(t) {
  if (!t) return "—";

  const parts = [t.name, t.month].filter(Boolean);

  return parts.join(" • ") || "—";
}

export function normalizePlayerGames(value) {
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

export function playerGamesLabel(player) {
  const games = normalizePlayerGames(player?.games);

  return games
    .map((x) => (x === "snooker" ? "Snooker" : "Pool"))
    .join(" / ");
}

export function tournamentGameKey(game) {
  const value = String(game || "").trim().toLowerCase();

  if (value.includes("pool")) return "pool";

  return "snooker";
}

export function getPlayersForGame(players, gameKey) {
  return (players || []).filter((p) => normalizePlayerGames(p?.games).includes(gameKey));
}

export function getCurrentTournamentForGame(tournaments, gameKey) {
  const filtered = (tournaments || []).filter((t) => tournamentGameKey(t?.game) === gameKey);
  const flagged = filtered.find((t) => t.isCurrent);
  if (flagged) return flagged;

  return filtered
    .slice()
    .sort((a, b) =>
      `${a.month || ""}|${a.createdAt || 0}`.localeCompare(`${b.month || ""}|${b.createdAt || 0}`)
    )
    .pop() || null;
}

export function getEligiblePlayersForTournament(players, tournament) {
  const gameKey = tournamentGameKey(tournament?.game);
  return getPlayersForGame(players || [], gameKey);
}

export function calcAutoRankingBoard(players, tournaments, gameKey) {
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
export function playersForTournament(tournament, allPlayers = []) {
  if (!tournament) return [];
  const ids = tournament.participantIds || [];
  if (!ids.length) return getEligiblePlayersForTournament(allPlayers, tournament);
  return (allPlayers || []).filter((p) => ids.includes(p.id));
}
export function calcLeaderboard(players, tournament) {
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
export function normalizeWhatsappNumber(value) {
  const digits = String(value || "").replace(/\D/g, "");

  if (!digits) return "";
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;

  return digits;
}
export function isWhatsappOptedOut(phone) {
  const normalized = normalizeWhatsappNumber(phone);
  if (!normalized) return false;
  return getWhatsappOptOuts().includes(normalized);
}
const WHATSAPP_OPT_OUTS_KEY = "qclub_whatsapp_opt_outs";
const WHATSAPP_MODE_KEY = "qclub_whatsapp_mode";
const WHATSAPP_SETTINGS_KEY = "qclub_whatsapp_settings";
export function getWhatsappOptOuts() {
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
export function getWhatsappMode() {
  const saved = String(localStorage.getItem("qclub_whatsapp_mode") || "draft_only").trim();

  if (saved === "disabled") return "disabled";
  if (saved === "live") return "live";
  return "draft_only";
}
export function getWhatsappSettings() {
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
      jobApplicationReceivedTemplate: String(saved?.jobApplicationReceivedTemplate || "").trim(),
    jobInterviewCallTemplate: String(saved?.jobInterviewCallTemplate || "").trim(),
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
jobInterviewCallTemplate: "",
    };
  }
}