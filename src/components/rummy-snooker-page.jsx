import React, { useEffect, useMemo, useState } from "react";
import { PageShell, QClubAccessBadge } from "./page-helpers";
import { supabase, supabaseReady } from "../supabase";

const RUMMY_DISPLAY_STORAGE_PREFIX = "qclub_rummy_snooker_display_state";
const QCHASE_SCORESHEET_ARCHIVE_KEY = "qclub_qchase_saved_scoresheets";
const QCHASE_PLAYER_PHONEBOOK_KEY = "qclub_qchase_player_phonebook";
const QCHASE_RESULT_TEMPLATE_NAME = "qchase_result_final";
const QCHASE_RESULT_HANDICAP_TEMPLATE_NAME = "qchase_result_handicap_v2";
const USE_QCHASE_HANDICAP_TEMPLATE = false;
const QCHASE_MONTHLY_TEMPLATE_NAME = "qchase_monthly_report";
const QCHASE_MONTHLY_SENT_KEY = "qclub_qchase_monthly_report_sent_log";

function normalizeQChasePhone(value = "") {
  const digits = String(value || "").replace(/\D/g, "");

  if (!digits) return "";
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;

  return digits;
}

function loadQChasePhonebook() {
  try {
    const raw = localStorage.getItem(QCHASE_PLAYER_PHONEBOOK_KEY);
    const book = raw ? JSON.parse(raw) : {};
    return book && typeof book === "object" && !Array.isArray(book) ? book : {};
  } catch {
    return {};
  }
}

function saveQChasePhonebook(book) {
  try {
    localStorage.setItem(QCHASE_PLAYER_PHONEBOOK_KEY, JSON.stringify(book || {}));
  } catch {}
}

function loadSavedScoreSheets() {
  try {
    const raw = localStorage.getItem(QCHASE_SCORESHEET_ARCHIVE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveScoreSheetArchive(item) {
  try {
    const list = loadSavedScoreSheets();
    const next = [item, ...list].slice(0, 100);
    localStorage.setItem(QCHASE_SCORESHEET_ARCHIVE_KEY, JSON.stringify(next));
  } catch {}
}

function minutesBetween(startText, endText) {
  const start = new Date(startText);
  const end = new Date(endText);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "—";

  const totalMinutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;

  if (h && m) return `${h} hr ${m} min`;
  if (h) return `${h} hr`;
  return `${m} min`;
}

const BALLS = [
  {
    key: "reds",
    label: "Red",
    short: "R",
    emoji: "🔴",
    points: 1,
    type: "pot",
    bg: "#d60000",
    fg: "#ffffff",
  },
  {
    key: "yellow",
    label: "Yellow",
    short: "Y",
    emoji: "🟡",
    points: 2,
    type: "pot",
    bg: "#ffd84d",
    fg: "#151515",
  },
  {
    key: "green",
    label: "Green",
    short: "G",
    emoji: "🟢",
    points: 3,
    type: "pot",
    bg: "#1faa59",
    fg: "#ffffff",
  },
  {
    key: "brown",
    label: "Brown",
    short: "Br",
    emoji: "🟤",
    points: 4,
    type: "pot",
    bg: "#7a4a24",
    fg: "#ffffff",
  },
  {
    key: "blue",
    label: "Blue",
    short: "Bl",
    emoji: "🔵",
    points: 5,
    type: "pot",
    bg: "#1f6fff",
    fg: "#ffffff",
  },
  {
    key: "pink",
    label: "Pink",
    short: "P",
    emoji: "🩷",
    points: 6,
    type: "pot",
    bg: "#ff6fb3",
    fg: "#1b0712",
  },
  {
    key: "black",
    label: "Black",
    short: "Bk",
    emoji: "⚫",
    points: 7,
    type: "pot",
    bg: "#070707",
    fg: "#ffffff",
  },
];

const RUMMY_TABLES = {
  table1: {
    key: "table1",
    label: "Snooker Table 1",
    scorePath: "/rummy-snooker-table-1",
    displayPath: "/rummy-snooker-table-1-display",
  },
  table2: {
    key: "table2",
    label: "Snooker Table 2",
    scorePath: "/rummy-snooker-table-2",
    displayPath: "/rummy-snooker-table-2-display",
  },
  table3: {
    key: "table3",
    label: "Mini / Table 3",
    scorePath: "/rummy-snooker-table-3",
    displayPath: "/rummy-snooker-table-3-display",
  },
};

function displayStorageKey(tableKey = "table1") {
  return `${RUMMY_DISPLAY_STORAGE_PREFIX}_${tableKey || "table1"}`;
}

function loadDisplayState(tableKey = "table1") {
  try {
    const raw = localStorage.getItem(displayStorageKey(tableKey));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function saveDisplayState(tableKey = "table1", snapshot) {
  try {
    localStorage.setItem(displayStorageKey(tableKey), JSON.stringify(snapshot));
    window.dispatchEvent(new Event(`qclub-rummy-display-update-${tableKey}`));
  } catch {}
}

const FOULS = [
  { key: "foul4", label: "Foul -4", short: "F4", points: -4, type: "foul" },
  { key: "foul5", label: "Foul -5", short: "F5", points: -5, type: "foul" },
  { key: "foul6", label: "Foul -6", short: "F6", points: -6, type: "foul" },
  { key: "foul7", label: "Foul -7", short: "F7", points: -7, type: "foul" },
];
const MAX_REDS_ON_TABLE = 15;

const RED_GONE_NO_POINT = {
  key: "redGone",
  label: "Red Gone / No Point",
  short: "RG",
  points: 0,
  type: "redGone",
};
const FINAL_COLOUR_ORDER = ["yellow", "green", "brown", "blue", "pink", "black"];

function finalColourName(index = 0) {
  const key = FINAL_COLOUR_ORDER[index];
  const ball = BALLS.find((b) => b.key === key);
  return ball ? `${ball.emoji || ""} ${ball.label} (${ball.points})` : "Final Lock";
}
const DISPLAY_COLOUR_BALL_META = {
  Y: { label: "Yellow", bg: "#ffd84d", fg: "#151515" },
  G: { label: "Green", bg: "#1faa59", fg: "#ffffff" },
  Br: { label: "Brown", bg: "#7a4a24", fg: "#ffffff" },
  Bl: { label: "Blue", bg: "#1f6fff", fg: "#ffffff" },
  P: { label: "Pink", bg: "#ff6fb3", fg: "#1b0712" },
  Bk: { label: "Black", bg: "#070707", fg: "#ffffff" },
};

function parseDisplayColourSummary(summary = "") {
  if (!summary || summary === "—") return [];

  return String(summary)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const match = part.match(/^([A-Za-z]+)\s*[×x]\s*(\d+)$/);
      if (!match) return null;

      const code = match[1];
      const count = Number(match[2] || 0);
      const meta = DISPLAY_COLOUR_BALL_META[code];

      if (!meta || !count) return null;

      return {
        code,
        count,
        ...meta,
      };
    })
    .filter(Boolean);
}
const EMPTY_SCORE = {
  reds: 0,
  redGone: 0,
  yellow: 0,
  green: 0,
  brown: 0,
  blue: 0,
  pink: 0,
  black: 0,
  foul4: 0,
  foul5: 0,
  foul6: 0,
  foul7: 0,
  tryAgainPoints: 0,
};


function makeId(prefix = "rs") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function gameNo() {
  const y = new Date().getFullYear();
  return `RS-${y}-${String(Date.now()).slice(-5)}`;
}

function nowText() {
  return new Date().toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function shuffle(list) {
  const arr = [...list];
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
function totalRedsUsed(allScores = {}) {
  return Object.values(allScores || {}).reduce((sum, score) => {
    return sum + Number(score?.reds || 0) + Number(score?.redGone || 0);
  }, 0);
}
function qChaseBreakPotValue(item) {
  if (!item || item.type !== "pot") return 0;

  if (item.key === "reds") return 1;
  if (item.key === "yellow") return 2;
  if (item.key === "green") return 3;
  if (item.key === "brown") return 4;
  if (item.key === "blue") return 5;
  if (item.key === "pink") return 6;
  if (item.key === "black") return 7;

  return 0;
}

function qChaseEmptyBreakState() {
  return {
    current: 0,
    highest: 0,
  };
}
function qChaseHandicapAdjustments(orderList = [], manualHandicaps = {}) {
  const players = Array.isArray(orderList)
    ? orderList.map((name) => String(name || "").trim()).filter(Boolean)
    : [];

  const adjustments = {};
  const receiverKeys = new Set();

  players.forEach((name) => {
    const key = String(name || "").trim().toUpperCase();
    const value = Number(manualHandicaps[key] || 0);

    adjustments[key] = 0;

    if (value > 0) {
      receiverKeys.add(key);
    }
  });

  players.forEach((name, index) => {
    const key = String(name || "").trim().toUpperCase();
    const handicapValue = Number(manualHandicaps[key] || 0);

    if (!key || handicapValue <= 0) return;

    adjustments[key] = Number(adjustments[key] || 0) + handicapValue;

    if (players.length <= 1) return;

    const prevName = players[(index - 1 + players.length) % players.length];
    const nextName = players[(index + 1) % players.length];

    const prevKey = String(prevName || "").trim().toUpperCase();
    const nextKey = String(nextName || "").trim().toUpperCase();

    const burdenTargets = [prevKey, nextKey].filter((targetKey, targetIndex, arr) => {
      if (!targetKey || targetKey === key) return false;
      if (receiverKeys.has(targetKey)) return false;
      return arr.indexOf(targetKey) === targetIndex;
    });

    if (!burdenTargets.length) return;

    const burdenPerTarget = handicapValue / burdenTargets.length;

    burdenTargets.forEach((targetKey) => {
      adjustments[targetKey] = Number(adjustments[targetKey] || 0) - burdenPerTarget;
    });
  });

  return adjustments;
}
function snookerPoints(score) {
  const pots =
    Number(score.reds || 0) * 1 +
    Number(score.yellow || 0) * 2 +
    Number(score.green || 0) * 3 +
    Number(score.brown || 0) * 4 +
    Number(score.blue || 0) * 5 +
    Number(score.pink || 0) * 6 +
    Number(score.black || 0) * 7;

  const fouls =
    Number(score.foul4 || 0) * 4 +
    Number(score.foul5 || 0) * 5 +
    Number(score.foul6 || 0) * 6 +
    Number(score.foul7 || 0) * 7;

  return pots - fouls + Number(score.tryAgainPoints || 0);
}

function colourSummary(score) {
  const parts = [];
  if (score.yellow) parts.push(`Y×${score.yellow}`);
  if (score.green) parts.push(`G×${score.green}`);
  if (score.brown) parts.push(`Br×${score.brown}`);
  if (score.blue) parts.push(`Bl×${score.blue}`);
  if (score.pink) parts.push(`P×${score.pink}`);
  if (score.black) parts.push(`Bk×${score.black}`);
  return parts.join(", ") || "—";
}
function redSummary(score) {
  const scored = Number(score?.reds || 0);
  const gone = Number(score?.redGone || 0);

  if (!gone) return String(scored);
  return `${scored} scored + ${gone} no-point`;
}
function tryAgainSummary(score) {
  const value = Number(score?.tryAgainPoints || 0);
  if (!value) return "";
  return value > 0 ? `Try Again +${value}` : `Try Again ${value}`;
}

function foulSummary(score) {
  const parts = [];
  if (score.foul4) parts.push(`-4×${score.foul4}`);
  if (score.foul5) parts.push(`-5×${score.foul5}`);
  if (score.foul6) parts.push(`-6×${score.foul6}`);
  if (score.foul7) parts.push(`-7×${score.foul7}`);

  const tryAgain = tryAgainSummary(score);
  if (tryAgain) parts.push(tryAgain);

  return parts.join(", ") || "—";
}

function openPrintWindow(title, html) {
  const win = window.open("", "_blank", "width=1100,height=800");
  if (!win) {
    alert("Popup blocked. Please allow popups for this site and try again.");
    return;
  }

  win.document.open();
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 500);
}

function buildA4Html({ state, rows, ranking, logs, locked }) {
  const totalSnooker = rows.reduce((sum, r) => sum + r.snooker, 0);
  const totalRummy = rows.reduce((sum, r) => sum + r.rummy, 0);

  const summaryRows = rows
    .map(
      (r) => `
        <tr>
          <td><b>${esc(r.order)}</b></td>
          <td><b>${esc(r.name)}</b></td>
<td>${r.handicap ? `+${esc(r.handicap)}` : "—"}</td>
<td>${esc(redSummary(r.score))}</td>
          <td>${esc(colourSummary(r.score))}</td>
          <td>${esc(foulSummary(r.score))}</td>
<td><b>${esc(r.highestBreak || 0)}</b></td>
<td>${esc(r.playedSnooker || 0)}</td>
<td>${
  Number(r.handicap || 0) > 0
    ? `+${esc(r.handicap)}`
    : Number(r.handicap || 0) < 0
    ? esc(r.handicap)
    : "—"
}</td>
<td><b>${esc(r.snooker)}</b></td>
<td>${esc(state.multiplier)}</td>
<td><b>${esc(r.rummy)}</b></td>
        </tr>`
    )
    .join("");

  const calcRows = rows
    .map(
      (r) => `
        <tr>
          <td>${esc(r.order)}</td>
          <td><b>${esc(r.name)}</b></td>
          <td>${esc(r.rummy)}</td>
          <td>${esc(r.nextName)}</td>
          <td>${esc(r.nextRummy)}</td>
          <td>${esc(r.rummy)} - ${r.nextRummy < 0 ? `(${esc(r.nextRummy)})` : esc(r.nextRummy)}</td>
          <td class="${r.final < 0 ? "neg" : "pos"}"><b>${esc(r.final)}</b></td>
        </tr>`
    )
    .join("");

  const rankingRows = ranking
    .map(
      (r, idx) => `
        <tr>
          <td>${idx + 1}</td>
          <td><b>${esc(r.name)}</b></td>
          <td class="${r.final < 0 ? "neg" : "pos"}"><b>${esc(r.final)}</b></td>
        </tr>`
    )
    .join("");

  const logRows = logs
    .slice(-60)
    .map(
      (l, idx) => `
        <tr>
          <td>${idx + 1}</td>
          <td>${esc(l.time)}</td>
          <td><b>${esc(l.name)}</b></td>
          <td>${esc(l.label)}</td>
          <td>${esc(l.points)}</td>
          <td>${esc(l.runningSnooker)}</td>
        </tr>`
    )
    .join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(state.gameNo)} - Q Chase Snooker A4</title>
<style>
  @page { size: A4 portrait; margin: 8mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, sans-serif; color: #111; background: #fff; font-size: 11px; }
  .sheet { width: 100%; }
  .top { display: grid; grid-template-columns: 120px 1fr 150px; gap: 10px; align-items: center; border-bottom: 2px solid #65001d; padding-bottom: 6px; }
  .logo { border: 2px solid #65001d; border-radius: 14px; padding: 10px; text-align: center; color: #65001d; font-weight: 900; }
  .title { text-align: center; }
  .title h1 { margin: 0; font-size: 30px; color: #65001d; letter-spacing: .5px; }
  .title h2 { margin: 4px 0 0; font-size: 18px; }
  .resultBox { border: 1px solid #65001d; border-radius: 10px; overflow: hidden; text-align: center; }
  .resultBox .head { background: #65001d; color: #fff; padding: 5px; font-weight: 900; }
  .resultBox .body { padding: 8px; font-size: 13px; }
  .section { margin-top: 8px; border: 1px solid #aaa; border-radius: 8px; overflow: hidden; }
  .sectionTitle { display: inline-block; background: #65001d; color: #fff; padding: 5px 9px; font-weight: 900; font-size: 12px; }
  .pad { padding: 7px; }
  .info { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; border: 1px solid #aaa; border-radius: 8px; padding: 8px; margin-top: 8px; }
  .infoRow { display: grid; grid-template-columns: 80px 1fr; gap: 6px; margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #65001d; color: #fff; padding: 5px; border: 1px solid #888; font-size: 10px; }
  td { padding: 5px; border: 1px solid #bbb; text-align: center; vertical-align: middle; }
  .orderGrid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; border: 1px solid #aaa; }
  .orderCell { padding: 8px 4px; border-right: 1px solid #aaa; border-bottom: 1px solid #aaa; text-align: center; }
  .orderCell b { display: block; font-size: 13px; margin-top: 2px; }
  .twoCol { display: grid; grid-template-columns: 1.8fr .9fr; gap: 8px; }
  .quick { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4px; }
  .quickBox { border: 1px solid #bbb; border-radius: 6px; padding: 5px; min-height: 62px; }
  .quickBox b { display: block; margin-bottom: 4px; }
  .neg { color: #d60000; }
  .pos { color: #111; }
  .footer { margin-top: 8px; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .verify { border: 1px solid #aaa; border-radius: 8px; padding: 8px; min-height: 58px; }
  .small { font-size: 10px; }
  .rule { font-size: 10px; line-height: 1.35; }
  .audit { font-size: 9.5px; }
  .audit td, .audit th { padding: 3px; }
</style>
</head>
<body>
<div class="sheet">
  <div class="top">
    <div class="logo">THE Q CLUB<br/>PASIGHAT</div>
    <div class="title">
      <h1>THE Q CLUB PASIGHAT</h1>
      <h2>Q CHASE SNOOKER SCORE SHEET</h2>
    </div>
    <div class="resultBox">
      <div class="head">FINAL RESULT</div>
      <div class="body">
        <div>WINNER</div>
        <b>${esc(ranking[0]?.name || "—")}</b><br/>
        <b>${esc(ranking[0]?.final ?? "—")}</b> Points
      </div>
    </div>
  </div>

  <div class="info">
    <div>
      <div class="infoRow"><b>Game No.</b><span>${esc(state.gameNo)}</span></div>
      <div class="infoRow"><b>Date</b><span>${esc(state.createdAt)}</span></div>
<div class="infoRow"><b>Start</b><span>${esc(state.startedAt || "—")}</span></div>
<div class="infoRow"><b>Table</b><span>${esc(state.tableName)}</span></div>
    </div>
    <div>
      <div class="infoRow"><b>Multiplier</b><span>${esc(state.multiplier)} per snooker point</span></div>
      <div class="infoRow"><b>Players</b><span>${esc(rows.length)}</span></div>
      <div class="infoRow"><b>Type</b><span>Q Chase Snooker</span></div>
    </div>
    <div>
      <div class="infoRow"><b>Status</b><span>${locked ? "FINAL LOCKED" : "DRAFT"}</span></div>
      <div class="infoRow"><b>End</b><span>${esc(state.endedAt || "—")}</span></div>
<div class="infoRow"><b>Duration</b><span>${esc(state.duration || "—")}</span></div>
<div class="infoRow"><b>Printed</b><span>${esc(nowText())}</span></div>
    </div>
  </div>

  <div class="section">
    <div class="sectionTitle">1. SERIAL ORDER DRAW</div>
    <div class="pad">
      <div class="orderGrid">
        ${rows
          .map(
            (r) =>
              `<div class="orderCell">${esc(r.order)}<b>${esc(r.name)}</b></div>`
          )
          .join("")}
      </div>
      <div class="small" style="margin-top:5px;">Serial order is generated through system draw. Final Score = Own Rummy Points - Next Player's Rummy Points.</div>
    </div>
  </div>

  <div class="section">
    <div class="sectionTitle">2. SCORE SUMMARY</div>
    <div class="pad">
      <table>
        <thead>
          <tr>
            <th>Order</th>
            <th>Player</th>
<th>Handicap</th>
<th>Reds</th>
            <th>Colours Potted</th>
            <th>Fouls / Penalties</th>
<th>Highest Break</th>
<th>Raw Snooker</th>
<th>HCP +/-</th>
<th>Adj. Snooker</th>
<th>Multiplier</th>
<th>Q Points</th>
          </tr>
        </thead>
        <tbody>
          ${summaryRows}
          <tr>
            <td colspan="9"><b>TOTAL</b></td>
<td></td>
<td><b>${esc(totalRummy)}</b></td>
          </tr>
        </tbody>
      </table>
      <div class="rule" style="margin-top:5px;">
        Colours: Yellow 2, Green 3, Brown 4, Blue 5, Pink 6, Black 7. Fouls follow standard snooker foul values: -4, -5, -6, -7.
      </div>
    </div>
  </div>

  <div class="twoCol">
    <div class="section">
      <div class="sectionTitle">3. FINAL CALCULATION</div>
      <div class="pad">
        <table>
          <thead>
            <tr>
              <th>Order</th>
              <th>Player</th>
              <th>Own Q Points</th>
              <th>Next Player</th>
              <th>Next Q Points</th>
              <th>Calculation</th>
              <th>Final</th>
            </tr>
          </thead>
          <tbody>${calcRows}</tbody>
        </table>
        <div class="small" style="margin-top:4px;">Last player is calculated against Player 1.</div>
      </div>
    </div>

    <div class="section">
      <div class="sectionTitle">4. FINAL RANKING</div>
      <div class="pad">
        <table>
          <thead><tr><th>Rank</th><th>Player</th><th>Final</th></tr></thead>
          <tbody>${rankingRows}</tbody>
        </table>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="sectionTitle">5. QUICK VIEW</div>
    <div class="pad quick">
      ${rows
        .map(
          (r) => `
          <div class="quickBox">
            <b>${esc(r.name)}</b>
                        Reds: ${esc(redSummary(r.score))}<br/>
            Colours: ${esc(colourSummary(r.score))}<br/>
            Fouls: ${esc(foulSummary(r.score))}<br/>
Highest Break: <b>${esc(r.highestBreak || 0)}</b><br/>
Raw Snooker: ${esc(r.playedSnooker || 0)}<br/>
HCP Adj: ${
  Number(r.handicap || 0) > 0
    ? `+${esc(r.handicap)}`
    : Number(r.handicap || 0) < 0
    ? esc(r.handicap)
    : "0"
}<br/>
Adj Snooker: <b>${esc(r.snooker || 0)}</b><br/>
Pts: ${esc(r.snooker)} × ${esc(state.multiplier)} = <b>${esc(r.rummy)}</b><br/>
Final: <b class="${r.final < 0 ? "neg" : "pos"}">${esc(r.final)}</b>
          </div>`
        )
        .join("")}
    </div>
  </div>

  <div class="section">
    <div class="sectionTitle">6. DETAILED AUDIT LOG</div>
    <div class="pad">
      <table class="audit">
        <thead>
          <tr><th>#</th><th>Time</th><th>Player</th><th>Entry</th><th>Pts</th><th>Running Snooker Pts</th></tr>
        </thead>
        <tbody>${logRows || `<tr><td colspan="6">No entries recorded.</td></tr>`}</tbody>
      </table>
    </div>
  </div>

  <div class="footer">
    <div class="verify">
      <b>PLAYER VERIFICATION</b>
      <div class="small" style="margin-top:18px;">Players verify that the above scores, player order, fouls and calculations are correct.</div>
    </div>
    <div class="verify">
      <b>STAFF / HOST VERIFICATION</b>
      <div class="small" style="margin-top:18px;">Signature: _______________________________</div>
    </div>
  </div>

  <div class="rule" style="margin-top:8px; border-top:2px solid #65001d; padding-top:6px;">
    Snooker Points = Reds + Colours - Fouls. Rummy Points = Snooker Points × Multiplier. Final Score = Own Q Points - Next Player's Q Points.
    ${locked ? "FINAL LOCKED RESULT." : "DRAFT COPY - NOT FINAL."}
  </div>
</div>
</body>
</html>`;
}

function build80mmHtml({ state, rows, ranking, locked }) {
  const lines = rows
    .map(
      (r) => `
                <div class="line"><b>${esc(r.name)}</b> H:${r.handicap ? `+${esc(r.handicap)}` : "0"} R:${esc(redSummary(r.score))}</div>
<div class="line">C:${esc(colourSummary(r.score))}</div>
        <div class="line">F:${esc(foulSummary(r.score))}</div>
        <div class="line">Highest Break: ${esc(r.highestBreak || 0)}</div>
<div class="line">Raw Snooker: ${esc(r.playedSnooker || 0)}</div>
<div class="line">HCP Adj: ${
  Number(r.handicap || 0) > 0
    ? `+${esc(r.handicap)}`
    : Number(r.handicap || 0) < 0
    ? esc(r.handicap)
    : "0"
}</div>
<div class="line">Adj Snooker: ${esc(r.snooker || 0)}</div>
<div class="line">Pts ${esc(r.snooker)} x${esc(state.multiplier)} = ${esc(r.rummy)}</div>
        <div class="line">Final: ${esc(r.rummy)} - ${esc(r.nextRummy)} = <b>${esc(r.final)}</b></div>
        <hr/>`
    )
    .join("");

  const rankLines = ranking
    .map((r, idx) => `<div class="line">${idx + 1}. ${esc(r.name)} ${esc(r.final)}</div>`)
    .join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(state.gameNo)} - Q Chase 80mm</title>
<style>
  @page { size: 80mm auto; margin: 3mm; }
  * { box-sizing: border-box; }
  body { margin: 0; width: 72mm; font-family: monospace; color: #000; background: #fff; font-size: 12px; }
  .center { text-align: center; }
  h1 { font-size: 16px; margin: 0; }
  h2 { font-size: 13px; margin: 2px 0 8px; }
  .line { line-height: 1.35; }
  hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
</style>
</head>
<body>
  <div class="center">
    <h1>THE Q CLUB PASIGHAT</h1>
    <h2>Q CHASE SNOOKER RESULT</h2>
    <div>${locked ? "FINAL LOCKED" : "DRAFT COPY"}</div>
  </div>
  <hr/>
  <div class="line">Game: ${esc(state.gameNo)}</div>
  <div class="line">Date: ${esc(state.createdAt)}</div>
<div class="line">Start: ${esc(state.startedAt || "—")}</div>
<div class="line">End: ${esc(state.endedAt || "—")}</div>
<div class="line">Duration: ${esc(state.duration || "—")}</div>
<div class="line">Table: ${esc(state.tableName)}</div>
  <div class="line">Multiplier: ${esc(state.multiplier)}</div>
  <div class="line">Players: ${esc(rows.length)}</div>
  <hr/>
  <div class="center"><b>ORDER</b></div>
  ${rows.map((r) => `<div class="line">${esc(r.order)}. ${esc(r.name)}</div>`).join("")}
  <hr/>
  <div class="center"><b>SCORE + CALCULATION</b></div>
  ${lines}
  <div class="center"><b>RANKING</b></div>
  ${rankLines}
  <hr/>
  <div class="line">Rule: Snooker Pts x Multiplier = Q Points</div>
  <div class="line">Final = Own Q Points - Next Q Points</div>
  <div class="line">Last player vs Player 1</div>
</body>
</html>`;
}
function buildReadyReckoner80mmHtml({ reckonerRows, reckonerRanking, reckonerMultiplier }) {
  const calcLines = reckonerRows
    .map((r) => {
      const nextValue =
        r.nextRummyPoints < 0 ? `(${r.nextRummyPoints})` : String(r.nextRummyPoints);

      return `
        <div class="box">
          <div class="name">${esc(r.order)}. ${esc(r.name)}</div>
          <div>Snooker: ${esc(r.snookerPoints)} pts</div>
          <div>Raw: ${esc(r.snookerPoints)} x ${esc(reckonerMultiplier)} = ${esc(r.rummyPoints)}</div>
          <div>Vs ${esc(r.nextName)}: ${esc(r.rummyPoints)} - ${esc(nextValue)}</div>
          <div class="${r.finalScore < 0 ? "neg" : "pos"}">Final: ${esc(r.finalScore)}</div>
        </div>
      `;
    })
    .join("");

  const rankLines = reckonerRanking
    .map(
      (r, idx) => `
        <div class="rank">
          <span>${idx + 1}. ${esc(r.name)}</span>
          <b class="${r.finalScore < 0 ? "neg" : "pos"}">${esc(r.finalScore)}</b>
        </div>
      `
    )
    .join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Ready Reckoner 80mm</title>
<style>
  @page { size: 80mm auto; margin: 3mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    width: 72mm;
    font-family: Arial, sans-serif;
    color: #000;
    background: #fff;
    font-size: 12px;
  }
  .center { text-align: center; }
  h1 {
    font-size: 17px;
    margin: 0;
    letter-spacing: .5px;
  }
  h2 {
    font-size: 14px;
    margin: 3px 0 4px;
  }
  .sub {
    font-size: 11px;
    margin-bottom: 6px;
  }
  hr {
    border: 0;
    border-top: 1px dashed #000;
    margin: 7px 0;
  }
  .box {
    border: 1px solid #000;
    border-radius: 6px;
    padding: 6px;
    margin-bottom: 6px;
    line-height: 1.35;
  }
  .name {
    font-size: 13px;
    font-weight: 800;
    margin-bottom: 3px;
  }
  .sectionTitle {
    text-align: center;
    font-weight: 900;
    font-size: 13px;
    margin: 7px 0;
  }
  .rank {
    display: flex;
    justify-content: space-between;
    border-bottom: 1px dashed #999;
    padding: 4px 0;
    font-size: 12px;
  }
  .pos { font-weight: 900; color: #000; }
  .neg { font-weight: 900; color: #000; }
  .rule {
    font-size: 10.5px;
    line-height: 1.35;
    margin-top: 8px;
  }
</style>
</head>
<body>
  <div class="center">
    <h1>THE Q CLUB PASIGHAT</h1>
    <h2>Q CHASE SNOOKER</h2>
    <div class="sub">READY RECKONER RESULT</div>
  </div>

  <hr/>

  <div>Printed: ${esc(nowText())}</div>
  <div>Multiplier: ${esc(reckonerMultiplier)} per snooker point</div>
  <div>Players: ${esc(reckonerRows.length)}</div>

  <hr/>

  <div class="sectionTitle">CALCULATION</div>
  ${calcLines}

  <hr/>

  <div class="sectionTitle">RANKING</div>
  ${rankLines}

  <hr/>

  <div class="rule">
    Rule:<br/>
    Q Points = Snooker Points x Multiplier.
    Final Score = Own Q Points - Next Player's Q Points.
    Last player is calculated against Player 1.
  </div>

  <hr/>

  <div class="center">
    Generated by<br/>
    THE Q CLUB PASIGHAT
  </div>
</body>
</html>`;
}

export function RummySnookerPage({
  data,
  admin,
  staffAdmin,
  commit,
  tableKey = "table1",
  tableLabel = "Snooker Table 1",
}) {
  const rummyPin = String(data?.admin?.rummyPin || "2468");
  const rummyFinalLockPin = String(data?.admin?.rummyFinalLockPin || "8642");
  const [allowed, setAllowed] = useState(() => {
    try {
      return localStorage.getItem("qclub_rummy_access") === "yes";
    } catch {
      return false;
    }
  });

  const hasAccess = admin || staffAdmin || allowed;

  const [playerInputs, setPlayerInputs] = useState([
    "KAMIN",
    "LOT",
    "KIRON",
    "KATEM",
    "JOMBO",
    "TATIN",
    "ANANG",
    "NANA",
  ]);
  const [handicaps, setHandicaps] = useState({});
    const [playerPhones, setPlayerPhones] = useState(() => {
    const book = loadQChasePhonebook();
    const seed = {};

    [
      "KAMIN",
      "LOT",
      "KIRON",
      "KATEM",
      "JOMBO",
      "TATIN",
      "ANANG",
      "NANA",
    ].forEach((name) => {
      const key = String(name || "").trim().toUpperCase();
      seed[key] = book[key] || "";
    });

    return seed;
  });

  const [showWhatsappPreview, setShowWhatsappPreview] = useState(false);
const [whatsappSendStatus, setWhatsappSendStatus] = useState({});
const [whatsappSendAllRunning, setWhatsappSendAllRunning] = useState(false);
useEffect(() => {
  const book = loadQChasePhonebook();

  setPlayerPhones((prev) => {
    let changed = false;
    const next = { ...prev };

    playerInputs.forEach((name) => {
      const key = playerKey(name);
      if (!key) return;

      if (!next[key] && book[key]) {
        next[key] = book[key];
        changed = true;
      }
    });

    return changed ? next : prev;
  });
}, [playerInputs]);

  const [state, setState] = useState(() => ({
  gameId: makeId(),
  gameNo: gameNo(),
  createdAt: nowText(),
  startedAt: "",
  endedAt: "",
  duration: "",
  tableName: tableLabel || "Snooker Table 1",
  multiplier: 100,
  orderLocked: false,
  started: false,
  locked: false,
  redrawsLeft: 1,
}));

        const [order, setOrder] = useState([]);
const [scores, setScores] = useState({});
const [breaks, setBreaks] = useState({});
const [logs, setLogs] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(0);
    const [turnMode, setTurnMode] = useState("red");
  const [clearanceIndex, setClearanceIndex] = useState(0);
  const [tryAgainMode, setTryAgainMode] = useState(null);
  const [pendingRedFoul, setPendingRedFoul] = useState(null);
  const [showReckoner, setShowReckoner] = useState(false);
  const [reckonerPlayers, setReckonerPlayers] = useState([
    { name: "KAMIN", snookerPoints: "" },
    { name: "LOT", snookerPoints: "" },
    { name: "KIRON", snookerPoints: "" },
    { name: "KATEM", snookerPoints: "" },
    { name: "JOMBO", snookerPoints: "" },
    { name: "TATIN", snookerPoints: "" },
    { name: "ANANG", snookerPoints: "" },
    { name: "NANA", snookerPoints: "" },
  ]);
  const [reckonerMultiplier, setReckonerMultiplier] = useState(100);

  function unlockWithPin() {
    const pin = prompt("Enter Q CHASE PAGE PIN");
    if (pin === null) return;

    if (String(pin).trim() === rummyPin) {
      setAllowed(true);
      try {
        localStorage.setItem("qclub_rummy_access", "yes");
      } catch {}
      return;
    }

    alert("Wrong PAGE PIN.");
  }

  function changeRummyPin() {
    if (!admin) {
      alert("Only Main Admin can change the Page PIN.");
      return;
    }

    const next = prompt("Enter new PAGE PIN:", rummyPin);
    if (next === null) return;

    const clean = String(next || "").trim();
    if (clean.length < 4) {
      alert("Use at least 4 digits/characters.");
      return;
    }

    commit({
      ...data,
      admin: {
        ...(data.admin || {}),
        rummyPin: clean,
      },
    });

    alert("PAGE PIN changed.");
  }
  function changeRummyFinalLockPin() {
  if (!admin) {
    alert("Only Main Admin can change the Final Lock PIN.");
    return;
  }

  const next = prompt("Enter new FINAL LOCK PIN:", rummyFinalLockPin);
  if (next === null) return;

  const clean = String(next || "").trim();
  if (clean.length < 4) {
    alert("Use at least 4 digits/characters.");
    return;
  }

  commit({
    ...data,
    admin: {
      ...(data.admin || {}),
      rummyFinalLockPin: clean,
    },
  });

  alert("FINAL LOCK PIN changed.");
}
function playerKey(value) {
  return String(value || "").trim().toUpperCase();
}
function savePlayerPhonesToPhonebook() {
  const book = loadQChasePhonebook();

  playerInputs.forEach((name) => {
    const key = playerKey(name);
    const phone = normalizeQChasePhone(playerPhones[key] || "");

    if (key && phone) {
      book[key] = phone;
    }
  });

  saveQChasePhonebook(book);
  return book;
}

function updatePlayerName(index, value) {
  const cleanName = String(value || "").toUpperCase();
  const next = [...playerInputs];
  next[index] = cleanName;
  setPlayerInputs(next);

  const key = playerKey(cleanName);
  if (!key) return;

  const book = loadQChasePhonebook();

  setPlayerPhones((prev) => ({
    ...prev,
    [key]: prev[key] || book[key] || "",
  }));
}
function loadQChaseMonthlySentLog() {
  try {
    const raw = localStorage.getItem(QCHASE_MONTHLY_SENT_KEY);
    const log = raw ? JSON.parse(raw) : {};
    return log && typeof log === "object" && !Array.isArray(log) ? log : {};
  } catch {
    return {};
  }
}

function saveQChaseMonthlySentLog(log) {
  try {
    localStorage.setItem(QCHASE_MONTHLY_SENT_KEY, JSON.stringify(log || {}));
  } catch {}
}

function qChaseMonthLabel(monthKey = "") {
  const safe = String(monthKey || "").trim();
  const [year, month] = safe.split("-");
  const date = new Date(Number(year || 0), Number(month || 1) - 1, 1);

  if (Number.isNaN(date.getTime())) return safe || "Selected Month";

  return date.toLocaleString("en-IN", {
    month: "long",
    year: "numeric",
  });
}

function qChaseMonthlySendKey(monthKey = "", phone = "", name = "") {
  return `${String(monthKey || "").trim()}__${normalizeQChasePhone(phone) || playerKey(name)}`;
}

function qChaseDateOnly(value = "") {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return String(value || "—");

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}
function buildQChaseMonthlyPlayers(records = [], selectedMonth = "") {
  const map = new Map();

  (records || []).forEach((record) => {
    const name = String(record.player_name || "").trim().toUpperCase();
    const phone = normalizeQChasePhone(record.phone || "");
    const key = phone || playerKey(name);

    if (!key || !name) return;

    const finalScore = Number(record.final_score || 0);
const snookerPoints = Number(record.snooker_points || 0);
const rawSnookerPoints = Number(record.raw_snooker_points || 0);
const handicapAdjustment = Number(record.handicap_adjustment || 0);
const adjustedSnookerPoints = Number(
  record.adjusted_snooker_points || record.snooker_points || 0
);
const isWinner = Boolean(record.is_winner);
const playedAt = record.played_at || record.created_at || "";

    const existing =
      map.get(key) || {
        key,
        name,
        phone,
        monthKey: selectedMonth,
        games: 0,
        wins: 0,
        netPoints: 0,
        bestFinal: finalScore,
        lowestFinal: finalScore,
       highestBreak: Number(record.highest_break || snookerPoints || 0),
bestRawSnooker: rawSnookerPoints,
bestHandicapAdjustment: handicapAdjustment,
bestAdjustedSnooker: adjustedSnookerPoints,
lastPlayed: playedAt,
        winningDays: [],
        lowScoreDays: [],
        records: [],
      };

    existing.games += 1;
    existing.wins += isWinner ? 1 : 0;
    existing.netPoints += finalScore;
    existing.bestFinal = Math.max(Number(existing.bestFinal || 0), finalScore);
    existing.lowestFinal = Math.min(Number(existing.lowestFinal || 0), finalScore);
    existing.highestBreak = Math.max(
  Number(existing.highestBreak || 0),
  Number(record.highest_break || snookerPoints || 0)
);
existing.bestRawSnooker = Math.max(
  Number(existing.bestRawSnooker || 0),
  rawSnookerPoints
);
existing.bestHandicapAdjustment =
  Math.abs(handicapAdjustment) > Math.abs(Number(existing.bestHandicapAdjustment || 0))
    ? handicapAdjustment
    : Number(existing.bestHandicapAdjustment || 0);
existing.bestAdjustedSnooker = Math.max(
  Number(existing.bestAdjustedSnooker || 0),
  adjustedSnookerPoints
);

    if (playedAt && (!existing.lastPlayed || new Date(playedAt) > new Date(existing.lastPlayed))) {
      existing.lastPlayed = playedAt;
    }

    if (isWinner) {
      existing.winningDays.push(qChaseDateOnly(playedAt));
    }

    if (finalScore < 0) {
      existing.lowScoreDays.push(`${qChaseDateOnly(playedAt)}: ${qChaseFormatScore(finalScore)}`);
    }

    existing.records.push(record);
    map.set(key, existing);
  });

  return Array.from(map.values()).sort((a, b) => {
    const byNet = Number(b.netPoints || 0) - Number(a.netPoints || 0);
    if (byNet !== 0) return byNet;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
}

function qChaseMonthlyTemplateParams(player) {
  return [
    player.name,
    qChaseMonthLabel(player.monthKey),
    player.name,
    player.phone || "—",
    String(player.games || 0),
    String(player.wins || 0),
    qChaseFormatScore(player.netPoints || 0),
    qChaseFormatScore(player.bestFinal || 0),
    qChaseFormatScore(player.lowestFinal || 0),
    String(player.highestBreak || 0),
    player.winningDays?.length ? player.winningDays.join(", ") : "No winning day recorded.",
    player.lowScoreDays?.length ? player.lowScoreDays.slice(0, 8).join("; ") : "No losing / low-score day recorded.",
    `You played ${player.games || 0} Q Chase game(s) this month with ${player.wins || 0} win(s), monthly net Q Chase points of ${qChaseFormatScore(player.netPoints || 0)}, best break ${player.highestBreak || 0}, best raw snooker ${player.bestRawSnooker || 0}, and best adjusted snooker ${player.bestAdjustedSnooker || 0}.`,
  ];
}

function qChaseMonthlyPreviewText(player) {
  return `Hello ${player.name},

Your Q Chase monthly report at The Q Club Pasighat is ready.

Month: ${qChaseMonthLabel(player.monthKey)}
Player: ${player.name}
Phone: ${player.phone || "—"}

Games Played: ${player.games || 0}
Wins: ${player.wins || 0}
Monthly Net Q Chase Points: ${qChaseFormatScore(player.netPoints || 0)}

Best Final Score: ${qChaseFormatScore(player.bestFinal || 0)}
Lowest Final Score: ${qChaseFormatScore(player.lowestFinal || 0)}

Best Break: ${player.highestBreak || 0}
Best Raw Snooker: ${player.bestRawSnooker || 0}
Best HCP Adjustment: ${
  Number(player.bestHandicapAdjustment || 0) > 0
    ? `+${player.bestHandicapAdjustment}`
    : Number(player.bestHandicapAdjustment || 0) < 0
    ? player.bestHandicapAdjustment
    : 0
}
Best Adjusted Snooker: ${player.bestAdjustedSnooker || 0}

Winning Days:
${player.winningDays?.length ? player.winningDays.join(", ") : "No winning day recorded."}

Low Score Days:
${player.lowScoreDays?.length ? player.lowScoreDays.slice(0, 8).join("; ") : "No losing / low-score day recorded."}

Monthly Summary:
You played ${player.games || 0} Q Chase game(s) this month with ${player.wins || 0} win(s) and monthly net Q Chase points of ${qChaseFormatScore(player.netPoints || 0)}.

Thank you for playing Q Chase at The Q Club Pasighat.`;
}
function qChaseFormatNumber(value) {
  const num = Number(value || 0);
  return new Intl.NumberFormat("en-IN").format(num);
}

function qChaseFormatScore(value) {
  const num = Number(value || 0);

  if (num > 0) return `${qChaseFormatNumber(num)} pts`;
  if (num < 0) return `minus ${qChaseFormatNumber(Math.abs(num))} pts`;

  return "0 pts";
}

function qChaseCompactReds(score) {
  const scored = Number(score?.reds || 0);
  const gone = Number(score?.redGone || 0);

  if (!gone) return `R${scored}`;
  return `R${scored}+NP${gone}`;
}

function qChaseCompactColours(score) {
  const value = colourSummary(score);
  return value && value !== "—" ? `C:${value.replaceAll("×", "x")}` : "C:-";
}

function qChaseCompactFouls(score) {
  const fouls = [
    { value: 4, count: Number(score?.foul4 || 0) },
    { value: 5, count: Number(score?.foul5 || 0) },
    { value: 6, count: Number(score?.foul6 || 0) },
    { value: 7, count: Number(score?.foul7 || 0) },
  ].filter((f) => f.count > 0);

  const tryAgain = tryAgainSummary(score);

  if (!fouls.length && !tryAgain) return "F:-";

  const total = fouls.reduce((sum, f) => sum + f.value * f.count, 0);
  const detail = fouls.map((f) => `${f.value}x${f.count}`).join(", ");

  const foulText = total ? `minus ${total}${detail ? ` (${detail})` : ""}` : "";

  if (foulText && tryAgain) return `F:${foulText}; ${tryAgain}`;
  if (foulText) return `F:${foulText}`;

  return `F:${tryAgain}`;
}

function qChasePlayersLine() {
  return rows
    .map((r) => {
      const rawText =
        Number(r.playedSnooker || 0) < 0
          ? `minus ${Math.abs(Number(r.playedSnooker || 0))}`
          : String(r.playedSnooker || 0);

      const hcpValue = Number(r.handicap || 0);
      const hcpText = hcpValue > 0 ? `+${hcpValue}` : String(hcpValue || 0);

      const adjText =
        Number(r.snooker || 0) < 0
          ? `minus ${Math.abs(Number(r.snooker || 0))}`
          : String(r.snooker || 0);

      return `${r.order}. ${r.name} Raw:${rawText} HCP:${hcpText} Adj:${adjText} Q:${qChaseFormatNumber(
        r.rummy || 0
      )} ${qChaseCompactReds(r.score)} ${qChaseCompactColours(r.score)} ${qChaseCompactFouls(r.score)}`;
    })
    .join(" | ");
}

function qChaseRankingLine() {
  return ranking
    .map((r, idx) => `${idx + 1}. ${r.name}: ${qChaseFormatScore(r.final)}`)
    .join(", ");
}

function qChaseWinnerLine() {
  const winner = ranking[0];
  return winner ? `${winner.name}: ${qChaseFormatScore(winner.final)}` : "—";
}

function qChaseRankOf(name) {
  const idx = ranking.findIndex((r) => r.name === name);
  return idx >= 0 ? idx + 1 : "—";
}

function qChaseLegacyTemplateParams(row) {
  return [
    row.name,
    state.gameNo,
    state.tableName,
    state.endedAt || state.createdAt || nowText(),
    qChasePlayersLine(),
    String(state.multiplier || 0),
    `${qChaseFormatNumber(row.snooker || 0)} pts`,
    qChaseFormatScore(row.rummy),
    qChaseFormatScore(row.final),
    String(qChaseRankOf(row.name)),
    qChaseWinnerLine(),
    qChaseRankingLine(),
  ];
}

function qChaseHandicapTemplateParams(row) {
  const hcpValue = Number(row.handicap || 0);
  const hcpText =
    hcpValue > 0
      ? `+${qChaseFormatNumber(hcpValue)} pts`
      : hcpValue < 0
      ? `minus ${qChaseFormatNumber(Math.abs(hcpValue))} pts`
      : "0 pts";

  return [
    row.name,
    state.gameNo,
    state.tableName,
    state.endedAt || state.createdAt || nowText(),
    qChasePlayersLine(),
    String(state.multiplier || 0),
    `${qChaseFormatNumber(row.playedSnooker || 0)} pts`,
    hcpText,
    `${qChaseFormatNumber(row.snooker || 0)} pts`,
    qChaseFormatScore(row.rummy),
    qChaseFormatScore(row.final),
    String(qChaseRankOf(row.name)),
    qChaseWinnerLine(),
    qChaseRankingLine(),
  ];
}

function qChaseTemplateParams(row) {
  return USE_QCHASE_HANDICAP_TEMPLATE
    ? qChaseHandicapTemplateParams(row)
    : qChaseLegacyTemplateParams(row);
}

function qChaseTemplateName() {
  return USE_QCHASE_HANDICAP_TEMPLATE
    ? QCHASE_RESULT_HANDICAP_TEMPLATE_NAME
    : QCHASE_RESULT_TEMPLATE_NAME;
}

function qChasePreviewText(row) {
  return `Hello ${row.name},

Your Q Chase Snooker result at The Q Club Pasighat is ready.

Game No: ${state.gameNo}
Table: ${state.tableName}
Date: ${state.endedAt || state.createdAt || nowText()}
Players:
${qChasePlayersLine()}

Multiplier: ${state.multiplier}

Your Result:
Raw Snooker Points: ${row.playedSnooker || 0}
Handicap Adjustment: ${
  Number(row.handicap || 0) > 0
    ? `+${row.handicap}`
    : Number(row.handicap || 0) < 0
    ? row.handicap
    : 0
}
Adjusted Snooker Points: ${row.snooker}
Q Points: ${qChaseFormatScore(row.rummy)}
Final Score: ${qChaseFormatScore(row.final)}
Rank: ${qChaseRankOf(row.name)}

Winner:
${qChaseWinnerLine()}

Final Ranking:
${qChaseRankingLine()}

Thank you for playing at The Q Club Pasighat.`;
}

async function sendQChaseWhatsappResult(row) {
  if (!state.locked) {
    alert("Final Lock required before sending WhatsApp result.");
    return;
  }

  const key = playerKey(row.name);
  const phone = normalizeQChasePhone(playerPhones[key] || "");

  if (!phone) {
    alert(`WhatsApp number missing for ${row.name}.`);
    return;
  }

  savePlayerPhonesToPhonebook();

  setWhatsappSendStatus((prev) => ({
    ...prev,
    [key]: "sending",
  }));

  try {
    const response = await fetch("/api/whatsapp-send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        phone,
        templateName: qChaseTemplateName(),
        templateParams: qChaseTemplateParams(row),
        label: "Q Chase Final Result",
        text: qChasePreviewText(row),
      }),
    });

    const json = await response.json().catch(() => null);

    if (!response.ok || !json?.ok) {
      throw new Error(
  json?.error ||
    json?.response?.message ||
    json?.response?.error ||
    `WhatsApp send failed with status ${response.status}`
);
    }

    setWhatsappSendStatus((prev) => ({
      ...prev,
      [key]: "sent",
    }));
  } catch (error) {
    console.error("Q Chase WhatsApp send failed:", error);

    setWhatsappSendStatus((prev) => ({
      ...prev,
      [key]: `failed: ${error?.message || "Unknown error"}`,
    }));
  }
}

function openWhatsappPreview() {
  if (!state.locked) {
    alert("Final Lock required before sending WhatsApp result.");
    return;
  }

  savePlayerPhonesToPhonebook();
  setShowWhatsappPreview(true);
}
function waitQChase(ms = 650) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendAllQChaseWhatsappResults() {
  if (!state.locked) {
    alert("Final Lock required before sending WhatsApp result.");
    return;
  }

  if (whatsappSendAllRunning) return;

  const sendableRows = rows.filter((r) => {
    const key = playerKey(r.name);
    const phone = normalizeQChasePhone(playerPhones[key] || "");
    const status = whatsappSendStatus[key] || "";

    return phone && status !== "sent";
  });

  const missingRows = rows.filter((r) => {
    const key = playerKey(r.name);
    return !normalizeQChasePhone(playerPhones[key] || "");
  });

  if (!sendableRows.length) {
    alert(
      missingRows.length
        ? `No pending WhatsApp messages to send. Missing numbers: ${missingRows
            .map((r) => r.name)
            .join(", ")}`
        : "No pending WhatsApp messages to send."
    );
    return;
  }

  const ok = confirm(
    `Send Q Chase final result to ${sendableRows.length} player(s)?\n\n` +
      `This will send one-by-one through MSG91.\n\n` +
      (missingRows.length
        ? `Skipped because number missing: ${missingRows.map((r) => r.name).join(", ")}`
        : "")
  );

  if (!ok) return;

  savePlayerPhonesToPhonebook();
  setWhatsappSendAllRunning(true);

  try {
    for (const row of sendableRows) {
      await sendQChaseWhatsappResult(row);
      await waitQChase(700);
    }
  } finally {
    setWhatsappSendAllRunning(false);
  }
}
async function saveQChasePlayerResultsToCloud(finalState) {
  if (!supabaseReady || !supabase) {
    console.warn("Supabase not ready. Q Chase cloud record was not saved.");
    alert("Final locked locally, but cloud save skipped because Supabase is not ready.");
    return false;
  }

  const savedAt = new Date();
  const monthKeyValue = `${savedAt.getFullYear()}-${String(savedAt.getMonth() + 1).padStart(2, "0")}`;
  const rankMap = new Map(ranking.map((r, index) => [playerKey(r.name), index + 1]));
  const winnerKey = playerKey(ranking[0]?.name || "");
  const playersLine = qChasePlayersLine();
  const rankingLine = qChaseRankingLine();

  const payload = rows.map((r) => {
    const key = playerKey(r.name);
    const phone = normalizeQChasePhone(playerPhones[key] || "");

    return {
      id: `${finalState.gameId || makeId("qchase_game")}_${key}`,
      game_id: finalState.gameId || "",
      game_no: finalState.gameNo || "",
      table_key: tableKey || "table1",
      table_name: finalState.tableName || tableLabel || "Snooker Table 1",

      played_at: savedAt.toISOString(),
      month_key: monthKeyValue,

      player_name: r.name,
      phone,
      serial_order: Number(r.order || 0),

      raw_snooker_points: Number(r.playedSnooker || 0),
manual_handicap: Number(r.manualHandicap || 0),
handicap_adjustment: Number(r.handicap || 0),
adjusted_snooker_points: Number(r.snooker || 0),

snooker_points: Number(r.snooker || 0),
q_points: Number(r.rummy || 0),
final_score: Number(r.final || 0),
highest_break: Number(r.highestBreak || 0),
rank: Number(rankMap.get(key) || 0),
is_winner: key === winnerKey,

      handicap: Number(r.handicap || 0),
      reds_summary: redSummary(r.score),
      colours_summary: colourSummary(r.score),
      fouls_summary: foulSummary(r.score),

      players_line: playersLine,
      ranking_line: rankingLine,

      started_at: finalState.startedAt || "",
      ended_at: finalState.endedAt || "",
      duration: finalState.duration || "",
    };
  });

  const { error } = await supabase.from("qchase_player_results").insert(payload);

  if (error) {
    console.error("Q Chase cloud save failed:", error);
    alert(`Final locked locally, but Q Chase cloud save failed: ${error.message || "Unknown error"}`);
    return false;
  }

  return true;
}
  function cleanPlayers() {
    return playerInputs.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 10);
  }

  function ensureScores(nextOrder) {
  const next = {};
  const nextBreaks = {};

  nextOrder.forEach((name) => {
    next[name] = scores[name] || { ...EMPTY_SCORE };
    nextBreaks[name] = breaks[name] || qChaseEmptyBreakState();
  });

  setScores(next);
  setBreaks(nextBreaks);
}

  function drawOrder() {
  if (state.started) {
    alert("Order cannot be changed after game start.");
    return;
  }

  if (state.orderLocked) {
    alert("Order is already locked.");
    return;
  }

  if (order.length) {
    alert("Serial order has already been drawn. Redraw is not allowed.");
    return;
  }

  const names = cleanPlayers();
  if (names.length < 2) {
    alert("Enter at least 2 players.");
    return;
  }

  const drawn = shuffle(names);
  setOrder(drawn);
  ensureScores(drawn);

  setState((prev) => ({
    ...prev,
    redrawsLeft: 0,
  }));
}

  function lockOrder() {
    if (state.started) return;
    const names = order.length ? order : cleanPlayers();

    if (names.length < 2) {
      alert("Enter at least 2 players and draw order first.");
      return;
    }

    if (!order.length) {
      setOrder(names);
      ensureScores(names);
    }

    setState((prev) => ({
      ...prev,
      orderLocked: true,
    }));
  }

  function startGame() {
    const names = order.length ? order : cleanPlayers();

    if (names.length < 2) {
      alert("Enter at least 2 players.");
      return;
    }

    if (!state.orderLocked) {
      const ok = confirm("Order is not locked. Lock order and start game?");
      if (!ok) return;
    }

    if (!order.length) {
      setOrder(names);
      ensureScores(names);
    }
        savePlayerPhonesToPhonebook();

    setState((prev) => ({
  ...prev,
  orderLocked: true,
  started: true,
  startedAt: prev.startedAt || nowText(),
}));
  }

  function resetGame() {
    const ok = confirm("Start a fresh Q Chase Snooker game? Current scores will be cleared.");
    if (!ok) return;

    setState({
      gameId: makeId(),
      gameNo: gameNo(),
      createdAt: nowText(),
startedAt: "",
endedAt: "",
duration: "",
tableName: state.tableName || tableLabel || "Snooker Table 1",
multiplier: Number(state.multiplier || 100),
      orderLocked: false,
      started: false,
      locked: false,
      redrawsLeft: 0,
    });
           setOrder([]);
    setScores({});
    setBreaks({});
    setLogs([]);
    setCurrentIndex(0);
    setHandicaps({});
        setTurnMode("red");
    setClearanceIndex(0);
    setTryAgainMode(null);
    setPendingRedFoul(null);
  }
  function startTryAgain() {
    if (!state.started || state.locked) return;

    const striker = order[currentIndex];
    const requester = order[(currentIndex + 1) % order.length];
    const last = logs[logs.length - 1];

    if (!striker || !requester) return;

    if (!last || last.name !== striker || !String(last.key || "").startsWith("foul")) {
      alert("Try Again can be used only after the current player makes a foul.");
      return;
    }

    setTryAgainMode({
      striker,
      requester,
    });

    setTurnMode("red");
    alert(`${requester} asked ${striker} to try again. Next result will be applied to ${requester} with reverse sign.`);
  }
  function startRedGoneByFoul() {
  if (!state.started) {
    alert("Start game first.");
    return;
  }

  if (state.locked) {
    alert("Game is locked. No more edits allowed.");
    return;
  }

  if (!order[currentIndex]) return;

  const redsLeftNow = Math.max(0, MAX_REDS_ON_TABLE - totalRedsUsed(scores));

  if (redsLeftNow <= 0) {
    alert("No reds are left on the table.");
    return;
  }

  const input = prompt(
    `How many reds went into pocket without points?\n\nEnter 1, 2, 3 or 4.\nReds left on table: ${redsLeftNow}`,
    "1"
  );

  if (input === null) return;

  const redCount = Number(String(input || "").trim());

  if (![1, 2, 3, 4].includes(redCount)) {
    alert("Enter only 1, 2, 3 or 4.");
    return;
  }

  if (redCount > redsLeftNow) {
    alert(`Only ${redsLeftNow} red(s) are left on the table.`);
    return;
  }

  setPendingRedFoul({
    player: order[currentIndex],
    reds: redCount,
  });

  alert(`Selected ${redCount} red(s) gone by foul.\n\nNow click the correct Foul button only: -4, -5, -6 or -7.`);
}

function cancelRedGoneByFoul() {
  setPendingRedFoul(null);
}
      function addEntry(item) {
    if (!state.started) {
      alert("Start game first.");
      return;
    }

    if (state.locked) {
      alert("Game is locked. No more edits allowed.");
      return;
    }

    const name = order[currentIndex];
    if (!name) return;

    const isRed = item.key === "reds";
    const isColour = item.type === "pot" && item.key !== "reds";
    const isFoul = item.type === "foul";
    const isRedGone = item.type === "redGone";
    const isTryAgain = Boolean(tryAgainMode);
    const isPendingRedFoul = Boolean(pendingRedFoul);

if (isPendingRedFoul && !isFoul) {
  alert("Red Gone by Foul is pending. Please click only Foul -4, -5, -6 or -7.");
  return;
}

    const redsUsedBefore = totalRedsUsed(scores);
    if (isFoul && redsUsedBefore >= MAX_REDS_ON_TABLE && turnMode !== "colour") {
  if (clearanceIndex >= FINAL_COLOUR_ORDER.length) {
    alert("Final black is already completed. No more fouls can be entered.");
    return;
  }

  const nextColourKey = FINAL_COLOUR_ORDER[clearanceIndex];
  const nextColour = BALLS.find((ball) => ball.key === nextColourKey);
  const minimumFoul = Math.max(4, Number(nextColour?.points || 4));

  if (Math.abs(Number(item.points || 0)) < minimumFoul) {
    alert(`Minimum foul is -${minimumFoul} because next ball is ${nextColour?.label || "final colour"}.`);
    return;
  }
}

    if ((isRed || isRedGone) && redsUsedBefore >= MAX_REDS_ON_TABLE) {
      alert(`All ${MAX_REDS_ON_TABLE} reds are already gone.`);
      return;
    }

        const isLastRedColour =
      isColour && redsUsedBefore >= MAX_REDS_ON_TABLE && turnMode === "colour";

    const isFinalClearanceColour =
      isColour && redsUsedBefore >= MAX_REDS_ON_TABLE && turnMode !== "colour";

    if (isRed && (turnMode !== "red" || redsUsedBefore >= MAX_REDS_ON_TABLE)) {
      alert("No red can be scored now.");
      return;
    }

    if (isColour) {
      if (isFinalClearanceColour) {
        const requiredColour = FINAL_COLOUR_ORDER[clearanceIndex];

        if (item.key !== requiredColour) {
          alert(`Final colours must be potted in order. Next ball: ${finalColourName(clearanceIndex)}`);
          return;
        }
      } else if (turnMode !== "colour") {
        alert("A colour can be scored only after a legal red.");
        return;
      }
    }

    let nextScores = { ...scores };
    let running = 0;
    let logName = name;
    let logLabel = item.label;
    let logPoints = item.points;
    let adjustTargetName = "";
    let adjustPoints = 0;
    let consumeRedName = "";

    if (isTryAgain) {
      const striker = tryAgainMode.striker;
      const requester = tryAgainMode.requester;

      const strikerScore = nextScores[striker] || { ...EMPTY_SCORE };
      const requesterScore = nextScores[requester] || { ...EMPTY_SCORE };

      if (isRed) {
        adjustPoints = -1;
        consumeRedName = striker;

        nextScores[striker] = {
          ...strikerScore,
          redGone: Number(strikerScore.redGone || 0) + 1,
        };

        nextScores[requester] = {
          ...requesterScore,
          tryAgainPoints: Number(requesterScore.tryAgainPoints || 0) + adjustPoints,
        };
      } else if (isColour) {
        adjustPoints = -Math.abs(Number(item.points || 0));

        nextScores[requester] = {
          ...requesterScore,
          tryAgainPoints: Number(requesterScore.tryAgainPoints || 0) + adjustPoints,
        };
      } else if (isFoul) {
        adjustPoints = Math.abs(Number(item.points || 0));

        nextScores[requester] = {
          ...requesterScore,
          tryAgainPoints: Number(requesterScore.tryAgainPoints || 0) + adjustPoints,
        };
      } else if (isRedGone) {
        consumeRedName = striker;

        nextScores[striker] = {
          ...strikerScore,
          redGone: Number(strikerScore.redGone || 0) + 1,
        };
      }

      adjustTargetName = requester;
      running = snookerPoints(nextScores[requester] || { ...EMPTY_SCORE });
      logName = striker;
      logLabel = `Try Again → ${requester}: ${item.label}`;
      logPoints = adjustPoints;
    } else {
      const currentScore = scores[name] || { ...EMPTY_SCORE };
const pendingRedGoneCount =
  isPendingRedFoul && pendingRedFoul?.player === name
    ? Number(pendingRedFoul.reds || 0)
    : 0;

const nextScore = {
  ...currentScore,
  [item.key]: Number(currentScore[item.key] || 0) + 1,
  redGone: Number(currentScore.redGone || 0) + pendingRedGoneCount,
};

nextScores = {
  ...scores,
  [name]: nextScore,
};

if (pendingRedGoneCount > 0) {
  logLabel = `${pendingRedGoneCount} red(s) gone by foul + ${item.label}`;
}

running = snookerPoints(nextScore);
    }

        const redsUsedAfter = totalRedsUsed(nextScores);

    let nextTurnMode = turnMode;
    let nextClearanceIndex = clearanceIndex;

    if (isRed) {
      nextTurnMode = "colour";
    } else if (isColour) {
      if (isFinalClearanceColour) {
        nextClearanceIndex = Math.min(clearanceIndex + 1, FINAL_COLOUR_ORDER.length);
        nextTurnMode = "clearance";
      } else if (redsUsedAfter >= MAX_REDS_ON_TABLE) {
        nextTurnMode = "clearance";
      } else {
        nextTurnMode = "red";
      }
    } else if (isFoul) {
      nextTurnMode = redsUsedAfter >= MAX_REDS_ON_TABLE ? "clearance" : "red";
    } else if (isRedGone) {
      nextTurnMode = redsUsedAfter >= MAX_REDS_ON_TABLE ? "clearance" : turnMode;
    }
const breakPlayerName = isTryAgain ? tryAgainMode.striker : name;
const breakPotValue = qChaseBreakPotValue(item);
const breakBefore = breakPlayerName
  ? breaks[breakPlayerName] || qChaseEmptyBreakState()
  : qChaseEmptyBreakState();

let breakAfter = breakBefore;

if (breakPlayerName) {
  if (breakPotValue > 0) {
    const nextCurrent = Number(breakBefore.current || 0) + breakPotValue;

    breakAfter = {
      current: nextCurrent,
      highest: Math.max(Number(breakBefore.highest || 0), nextCurrent),
    };
  } else if (isFoul || isRedGone) {
    breakAfter = {
      current: 0,
      highest: Number(breakBefore.highest || 0),
    };
  }

  setBreaks((prev) => ({
    ...prev,
    [breakPlayerName]: breakAfter,
  }));
}
    setScores(nextScores);
    setTurnMode(nextTurnMode);
    setClearanceIndex(nextClearanceIndex);
   if (isPendingRedFoul && isFoul) {
  setPendingRedFoul(null);
  setTryAgainMode(null);
}

    setLogs((prev) => [
      ...prev,
      {
        id: makeId("log"),
        time: new Date().toLocaleTimeString("en-IN", {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        }),
        name: logName,
        key: item.key,
        label: logLabel,
        points: logPoints,
        runningSnooker: running,
                turnModeBefore: turnMode,
        turnModeAfter: nextTurnMode,
        clearanceIndexBefore: clearanceIndex,
        clearanceIndexAfter: nextClearanceIndex,
        mode: isTryAgain ? "tryAgain" : "normal",
        targetName: adjustTargetName,
        adjustPoints,
consumeRedName,
breakPlayerName,
breakBefore,
breakAfter,
      },
    ]);
  }

  function undoLast() {
    if (state.locked) {
      alert("Game is locked.");
      return;
    }

    const last = logs[logs.length - 1];
    if (!last) return;
    if (last.breakPlayerName) {
  setBreaks((prev) => ({
    ...prev,
    [last.breakPlayerName]: last.breakBefore || qChaseEmptyBreakState(),
  }));
}

        if (last.mode === "tryAgain") {
      const nextScores = { ...scores };

      if (last.consumeRedName) {
        const redOwnerScore = nextScores[last.consumeRedName] || { ...EMPTY_SCORE };
        nextScores[last.consumeRedName] = {
          ...redOwnerScore,
          redGone: Math.max(0, Number(redOwnerScore.redGone || 0) - 1),
        };
      }

      if (last.targetName && Number(last.adjustPoints || 0) !== 0) {
        const targetScore = nextScores[last.targetName] || { ...EMPTY_SCORE };
        nextScores[last.targetName] = {
          ...targetScore,
          tryAgainPoints:
            Number(targetScore.tryAgainPoints || 0) - Number(last.adjustPoints || 0),
        };
      }

      setScores(nextScores);
    } else {
      const currentScore = scores[last.name] || { ...EMPTY_SCORE };
      const nextValue = Math.max(0, Number(currentScore[last.key] || 0) - 1);

      setScores({
        ...scores,
        [last.name]: {
          ...currentScore,
          [last.key]: nextValue,
        },
      });
    }

        setTurnMode(last.turnModeBefore || "red");
    setClearanceIndex(
      Number.isFinite(Number(last.clearanceIndexBefore))
        ? Number(last.clearanceIndexBefore)
        : 0
    );
    setLogs(logs.slice(0, -1));
  }

        function nextPlayer() {
  if (!order.length) return;

  const leavingPlayer = order[currentIndex];

  if (leavingPlayer) {
    setBreaks((prev) => {
      const oldBreak = prev[leavingPlayer] || qChaseEmptyBreakState();

      return {
        ...prev,
        [leavingPlayer]: {
          current: 0,
          highest: Number(oldBreak.highest || 0),
        },
      };
    });
  }

  setTryAgainMode(null);
  setTurnMode(redsLeft <= 0 ? (turnMode === "colour" ? "colour" : "clearance") : "red");
  setCurrentIndex((prev) => (prev + 1) % order.length);
}

    async function lockFinal() {
  if (!state.started) {
    alert("Start game first.");
    return;
  }

  if (state.locked) {
    alert("Game is already final locked.");
    return;
  }

  if (!admin && !staffAdmin) {
    const pin = prompt("Enter FINAL LOCK PIN");
    if (pin === null) return;

    if (String(pin).trim() !== rummyFinalLockPin) {
      alert("Wrong FINAL LOCK PIN.");
      return;
    }
  }

  const ok = confirm(
    "Final Lock will freeze the result and enable print/New Game. Continue?"
  );

  if (!ok) return;

  const endedAt = nowText();
const startedAt = state.startedAt || state.createdAt;
const finalState = {
  ...state,
  locked: true,
  startedAt,
  endedAt,
  duration: minutesBetween(startedAt, endedAt),
};

setState(finalState);
saveFinalScoreSheet(finalState);

const cloudSaved = await saveQChasePlayerResultsToCloud(finalState);

alert(
  cloudSaved
    ? "Final locked, local scoresheet saved, and cloud player records saved."
    : "Final locked and local scoresheet saved. Cloud save was not completed."
);
}
  const currentPlayer = order[currentIndex] || "";
    const lastLog = logs[logs.length - 1];
  const canTryAgain =
    state.started &&
    !state.locked &&
    !tryAgainMode &&
    order[currentIndex] &&
    lastLog?.name === order[currentIndex] &&
    String(lastLog?.key || "").startsWith("foul");
  const redsUsed = totalRedsUsed(scores);
  const redsLeft = Math.max(0, MAX_REDS_ON_TABLE - redsUsed);
    const nextBallText =
    redsLeft <= 0
      ? turnMode === "colour"
        ? "Any colour after last red"
        : finalColourName(clearanceIndex)
      : turnMode === "colour"
      ? "Colour only"
      : "Red or foul";

    function canEnterItem(item) {
    if (!state.started || state.locked) return false;

   if (item.type === "foul") {
  if (redsLeft <= 0 && turnMode !== "colour" && clearanceIndex >= FINAL_COLOUR_ORDER.length) {
    return false;
  }

  if (redsLeft <= 0 && turnMode !== "colour") {
    const nextColourKey = FINAL_COLOUR_ORDER[clearanceIndex];
    const nextColour = BALLS.find((ball) => ball.key === nextColourKey);
    const minimumFoul = Math.max(4, Number(nextColour?.points || 4));

    return Math.abs(Number(item.points || 0)) >= minimumFoul;
  }

  return true;
}

    if (redsLeft <= 0) {
      if (item.key === "reds" || item.type === "redGone") return false;

      if (item.type === "pot") {
        if (turnMode === "colour") {
          return item.key !== "reds";
        }

        return item.key === FINAL_COLOUR_ORDER[clearanceIndex];
      }

      return false;
    }

    if (item.key === "reds") {
      return turnMode === "red" && redsLeft > 0;
    }

    if (item.type === "redGone") {
      return redsLeft > 0;
    }

    if (item.type === "pot") {
      return turnMode === "colour";
    }

    return false;
  }
    const reckonerRows = useMemo(() => {
    const clean = reckonerPlayers
      .map((p) => ({
        name: String(p.name || "").trim().toUpperCase(),
        snookerPoints: Number(p.snookerPoints || 0),
      }))
      .filter((p) => p.name);

    const multiplier = Number(reckonerMultiplier || 0);

    return clean.map((player, index) => {
      const nextPlayer = clean[(index + 1) % clean.length] || { name: "", snookerPoints: 0 };
      const rummyPoints = player.snookerPoints * multiplier;
      const nextRummyPoints = nextPlayer.snookerPoints * multiplier;

      return {
        order: index + 1,
        name: player.name,
        snookerPoints: player.snookerPoints,
        multiplier,
        rummyPoints,
        nextName: nextPlayer.name,
        nextRummyPoints,
        finalScore: rummyPoints - nextRummyPoints,
      };
    });
  }, [reckonerPlayers, reckonerMultiplier]);

  const reckonerRanking = useMemo(() => {
    return reckonerRows.slice().sort((a, b) => b.finalScore - a.finalScore);
  }, [reckonerRows]);
  const rows = useMemo(() => {
  const names = order.length ? order : cleanPlayers();
  const handicapAdjustments = qChaseHandicapAdjustments(names, handicaps);
  const multiplier = Number(state.multiplier || 0);

  const preparedRows = names.map((name, index) => {
    const key = playerKey(name);
    const score = scores[name] || { ...EMPTY_SCORE };
    const playedSnooker = snookerPoints(score);
    const manualHandicap = Number(handicaps[key] || 0);
    const handicap = Number(handicapAdjustments[key] || 0);
    const sPts = playedSnooker + handicap;
    const rummy = sPts * multiplier;

    return {
      order: index + 1,
      name,
      key,
      score,
      playedSnooker,
      manualHandicap,
      handicap,
      highestBreak: Number(breaks[name]?.highest || 0),
      currentBreak: Number(breaks[name]?.current || 0),
      snooker: sPts,
      rummy,
    };
  });

  return preparedRows.map((row, index) => {
    const nextRow = preparedRows[(index + 1) % preparedRows.length] || {
      name: "",
      rummy: 0,
    };

    return {
      ...row,
      nextName: nextRow.name,
      nextRummy: Number(nextRow.rummy || 0),
      final: Number(row.rummy || 0) - Number(nextRow.rummy || 0),
    };
  });
}, [order, scores, breaks, state.multiplier, playerInputs, handicaps]);

  const ranking = useMemo(() => {
    return rows.slice().sort((a, b) => b.final - a.final);
  }, [rows]);


  useEffect(() => {
    const displaySnapshot = {
      tableKey,
      gameNo: state.gameNo,
      createdAt: state.createdAt,
      tableName: state.tableName,
      multiplier: Number(state.multiplier || 0),
      locked: Boolean(state.locked),
      started: Boolean(state.started),
      orderLocked: Boolean(state.orderLocked),
      currentPlayer,
      redsLeft,
            turnMode,
      nextBallText,
      tryAgainMode,
      rows: rows.map((r) => ({
  order: r.order,
  name: r.name,
  playedSnooker: r.playedSnooker || 0,
  manualHandicap: r.manualHandicap || 0,
  handicap: r.handicap || 0,
  reds: redSummary(r.score),
  colours: colourSummary(r.score),
  fouls: foulSummary(r.score),
  currentBreak: r.currentBreak || 0,
  highestBreak: r.highestBreak || 0,
  snooker: r.snooker,
  rummy: r.rummy,
  nextName: r.nextName,
  final: r.final,
})),
      ranking: ranking.map((r) => ({
        name: r.name,
        final: r.final,
      })),
      updatedAt: Date.now(),
    };

    saveDisplayState(tableKey, displaySnapshot);
  }, [
    tableKey,
    state.gameNo,
    state.createdAt,
    state.tableName,
    state.multiplier,
    state.locked,
    state.started,
    state.orderLocked,
    currentPlayer,
    redsLeft,
        turnMode,
    nextBallText,
    tryAgainMode,
    rows,
    ranking,
  ]);

  function printA4() {
    openPrintWindow(
      "Q Chase Snooker A4",
      buildA4Html({
        state,
        rows,
        ranking,
        logs,
        locked: state.locked,
      })
    );
  }
  function saveFinalScoreSheet(finalState) {
  const a4Html = buildA4Html({
    state: finalState,
    rows,
    ranking,
    logs,
    locked: true,
  });

  const mm80Html = build80mmHtml({
    state: finalState,
    rows,
    ranking,
    locked: true,
  });

  saveScoreSheetArchive({
    id: finalState.gameId || makeId("saved"),
    gameNo: finalState.gameNo,
    tableName: finalState.tableName,
    multiplier: finalState.multiplier,
    winner: ranking[0]?.name || "—",
    winnerFinal: ranking[0]?.final ?? "—",
    createdAt: finalState.createdAt,
    startedAt: finalState.startedAt,
    endedAt: finalState.endedAt,
    duration: finalState.duration,
    savedAt: nowText(),
    a4Html,
    mm80Html,
  });
}

function openSavedScoreSheets() {
  const list = loadSavedScoreSheets();

  if (!list.length) {
    alert("No saved Q Chase scoresheets found on this browser.");
    return;
  }

  const rowsHtml = list
    .map(
      (s, index) => `
        <tr>
          <td>${index + 1}</td>
          <td><b>${esc(s.gameNo)}</b></td>
          <td>${esc(s.tableName)}</td>
          <td>${esc(s.winner)}</td>
          <td>${esc(s.winnerFinal)}</td>
          <td>${esc(s.startedAt || "—")}</td>
          <td>${esc(s.endedAt || "—")}</td>
          <td>${esc(s.duration || "—")}</td>
          <td>
            <button onclick="openSheet(${index}, 'a4')">Open A4</button>
            <button onclick="openSheet(${index}, 'mm80')">Open 80mm</button>
          </td>
        </tr>
      `
    )
    .join("");

  const archiveHtml = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Saved Q Chase Scoresheets</title>
<style>
  body { font-family: Arial, sans-serif; margin: 20px; background:#fff; color:#111; }
  h1 { margin: 0 0 10px; color:#65001d; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { background:#65001d; color:#fff; padding: 8px; border:1px solid #999; }
  td { padding: 8px; border:1px solid #bbb; text-align:center; }
  button { padding: 7px 10px; margin: 2px; cursor:pointer; font-weight:700; }
</style>
</head>
<body>
  <h1>Saved Q Chase Snooker Scoresheets</h1>
  <p>Saved on this browser/laptop only.</p>

  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>Game No.</th>
        <th>Table</th>
        <th>Winner</th>
        <th>Final</th>
        <th>Start</th>
        <th>End</th>
        <th>Duration</th>
        <th>Print</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>

  <script>
    const saved = ${JSON.stringify(list)};

    function openSheet(index, type) {
      const item = saved[index];
      const html = type === "mm80" ? item.mm80Html : item.a4Html;
      const win = window.open("", "_blank", "width=1100,height=800");
      win.document.open();
      win.document.write(html);
      win.document.close();
      win.focus();
    }
  </script>
</body>
</html>`;

  const win = window.open("", "_blank", "width=1200,height=800");
  if (!win) {
    alert("Popup blocked. Please allow popups and try again.");
    return;
  }

  win.document.open();
  win.document.write(archiveHtml);
  win.document.close();
  win.focus();
}

  function print80mm() {
    openPrintWindow(
        "Q Chase Snooker 80mm",
      build80mmHtml({
        state,
        rows,
        ranking,
        locked: state.locked,
      })
    );
  }
    function printReadyReckoner80mm() {
    if (reckonerRows.length < 2) {
      alert("Enter at least 2 players in Ready Reckoner.");
      return;
    }

    openPrintWindow(
      "Ready Reckoner 80mm",
      buildReadyReckoner80mmHtml({
        reckonerRows,
        reckonerRanking,
        reckonerMultiplier,
      })
    );
  }

  if (!hasAccess) {
    return (
      <>
        <PageShell title="Q Chase Snooker" subtitle="Protected Q Club scoring system" noNav />
        <div className="container">
          <div className="card" style={{ maxWidth: 560, margin: "0 auto" }}>
            <h2>Q Chase Page PIN Required</h2>
            <div className="muted" style={{ marginBottom: 14 }}>
              This scoring system is for authorised Q Club staff and trusted players only.
            </div>
            <button className="btn primary" type="button" onClick={unlockWithPin}>
              Enter Page PIN
            </button>
          </div>
        </div>
      </>
    );
  }

  

  return (
    <>
      <PageShell
        title={`Q Chase Snooker • ${state.tableName || tableLabel}`}
subtitle="Self-scoring • Serial order draw • Live display • A4 + 80mm print"
        right={
  <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
    <QClubAccessBadge
      admin={admin}
      staffAdmin={staffAdmin}
      scorerMode={allowed && !admin && !staffAdmin}
      scorerLabel="Q CHASE SCORER PIN MODE"
    />
            {admin ? (
  <>
    <button className="btn" type="button" onClick={changeRummyPin}>
      Change Page PIN
    </button>

    <button className="btn warn" type="button" onClick={changeRummyFinalLockPin}>
      Change Final Lock PIN
    </button>
  </>
) : null}
            <button
              className="btn"
              type="button"
              onClick={() => {
                setAllowed(false);
                try {
                  localStorage.removeItem("qclub_rummy_access");
                } catch {}
              }}
            >
              Lock Q Chase Page
            </button>
          </div>
        }
      />

      <div className="container">
        <div className="grid">
          <div className="card cols-12">
            <h2 style={{ marginTop: 0 }}>Game Setup</h2>

            <div className="grid">
              <div className="cols-4">
                <label className="lbl">Game No.</label>
                <input
                  value={state.gameNo}
                  onChange={(e) => setState({ ...state, gameNo: e.target.value })}
                />
              </div>

              <div className="cols-4">
                <label className="lbl">Table</label>
                <input
                  value={state.tableName}
                  onChange={(e) => setState({ ...state, tableName: e.target.value })}
                />
              </div>

                            <div className="cols-4">
                <label className="lbl">Multiplier</label>
                <input
                  type="number"
                  value={state.multiplier}
                  disabled
                  readOnly
                />
              </div>
            </div>

            <div className="muted" style={{ marginTop: 10 }}>
              Multiplier locks after game start. Fouls are standard snooker fouls: -4, -5, -6, -7.
            </div>
                                    <div className="row" style={{ marginTop: 14, gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn warn"
                type="button"
                onClick={() => setShowReckoner(true)}
              >
                Ready Reckoner
              </button>

              <a
                className="btn primary"
                href={RUMMY_TABLES[tableKey]?.displayPath || "/rummy-snooker-table-1-display"}
                target="_blank"
                rel="noreferrer"
              >
                Open Player Display
              </a>
              <button className="btn" type="button" onClick={openSavedScoreSheets}>
  Saved Score Sheets
</button>
            </div>
          </div>

          <div className="card cols-12">
            <h2 style={{ marginTop: 0 }}>Players</h2>

                        <div className="grid">
              {playerInputs.map((name, index) => (
                                <div className="cols-3" key={index}>
                  <label className="lbl">Player {index + 1}</label>

                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1fr 84px",
                      gap: 8,
                      alignItems: "center",
                    }}
                  >
                    <input
                      value={name}
                      disabled={state.started}
                      onChange={(e) => updatePlayerName(index, e.target.value)}
                    />

                    <input
                      type="number"
                      value={handicaps[playerKey(name)] ?? ""}
                      disabled={state.started}
                      placeholder="HCP"
                      title="Starting handicap points"
                      onChange={(e) => {
                        const key = playerKey(name);
                        if (!key) return;

                        setHandicaps((prev) => ({
                          ...prev,
                          [key]: Number(e.target.value || 0),
                        }));
                      }}
                      style={{
                        textAlign: "center",
                        fontWeight: 900,
                      }}
                    />
                  </div>

                  <input
                    type="tel"
                    value={playerPhones[playerKey(name)] || ""}
                    disabled={state.started}
                    placeholder="WhatsApp number"
                    title="Optional WhatsApp number for final result message"
                    onChange={(e) => {
                      const key = playerKey(name);
                      if (!key) return;

                      setPlayerPhones((prev) => ({
                        ...prev,
                        [key]: e.target.value,
                      }));
                    }}
                    style={{
                      marginTop: 8,
                      width: "100%",
                      fontWeight: 800,
                    }}
                  />
                </div>
              ))}
            </div>

            <div
              className="row"
              style={{
                marginTop: 16,
                gap: 10,
                padding: "12px 14px",
                border: "1px solid rgba(255,255,255,.12)",
                borderRadius: 16,
                background: "rgba(255,255,255,.04)",
                justifyContent: "space-between",
              }}
            >
              <div>
                <b>Game Multiplier</b>
                <div className="muted" style={{ fontSize: 12 }}>
                  Cannot be changed after game starts.
                </div>
              </div>

              <input
                type="number"
                value={state.multiplier}
                disabled={state.started}
                onChange={(e) =>
                  setState({
                    ...state,
                    multiplier: Number(e.target.value || 0),
                  })
                }
                style={{
                  width: 130,
                  fontSize: 18,
                  fontWeight: 900,
                  textAlign: "center",
                }}
              />

              <div
                className={state.started ? "badge" : "badge"}
                style={{
                  borderColor: state.started
                    ? "rgba(255,77,77,.35)"
                    : "rgba(56,211,159,.35)",
                  background: state.started
                    ? "rgba(255,77,77,.10)"
                    : "rgba(56,211,159,.10)",
                  fontWeight: 900,
                }}
              >
                {state.started ? "Multiplier Locked" : "Multiplier Editable"}
              </div>
            </div>

            <div className="row" style={{ marginTop: 14, gap: 8, flexWrap: "wrap" }}>
  <button
    className={order.length ? "btn primary" : "btn warn"}
    type="button"
    onClick={drawOrder}
    disabled={state.started}
  >
    {order.length ? "Serial Order Drawn" : "Draw Serial Order"}
  </button>

  <button
    className={state.orderLocked ? "btn danger" : "btn warn"}
    type="button"
    onClick={lockOrder}
    disabled={state.started}
  >
    {state.orderLocked ? "Order Locked" : "Lock Order"}
  </button>

  <button
    className={state.started ? "btn danger" : "btn primary"}
    type="button"
    onClick={startGame}
    disabled={state.started}
  >
    {state.started ? "Game Started" : "Start Game"}
  </button>

  <button
  className={state.locked ? "btn danger" : "btn"}
  type="button"
  onClick={resetGame}
  disabled={!state.locked}
  title={state.locked ? "Start a new game" : "Final Lock required before New Game"}
>
  {state.locked ? "New Game" : "New Game Locked"}
</button>
</div>

            <div className="muted" style={{ marginTop: 10 }}>
              Serial order draw is one-time only. No redraw is allowed after the first draw.
            </div>
          </div>

          <div className="card cols-6">
            <h2 style={{ marginTop: 0 }}>Serial Order</h2>

            {rows.length ? (
              <div style={{ display: "grid", gap: 8 }}>
                {rows.map((r) => (
                  <div
                    key={r.name}
                    className="row"
                    style={{
                      justifyContent: "space-between",
                      padding: "10px 12px",
                      border: "1px solid rgba(255,255,255,.12)",
                      borderRadius: 14,
                      background:
                        r.name === currentPlayer
                          ? "rgba(56,211,159,.14)"
                          : "rgba(255,255,255,.04)",
                    }}
                  >
                    <b>
                      {r.order}. {r.name}
                    </b>
                    <span className="muted">
                      {r.snooker} pts × {state.multiplier} = {r.rummy}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="muted">Draw order first.</div>
            )}
          </div>

          <div className="card cols-6">
            <h2 style={{ marginTop: 0 }}>Score Entry</h2>

                                    <div className="badge" style={{ marginBottom: 12 }}>
                            Current Player: {currentPlayer || "—"} • Reds Left: {redsLeft} • Next:{" "}
              {nextBallText}
              {tryAgainMode ? ` • TRY AGAIN: result applies to ${tryAgainMode.requester}` : ""}
            </div>

            <div className="grid">
                                          {BALLS.map((b) => {
                const enabled = canEnterItem(b);

                return (
                  <button
                    key={b.key}
                    className="cols-3"
                    type="button"
                    onClick={() => addEntry(b)}
                    disabled={!enabled}
                    style={{
                      width: 86,
                      height: 86,
                      maxWidth: "100%",
                      borderRadius: "999px",
                      border: "2px solid rgba(255,255,255,.22)",
                      background: b.bg,
                      color: b.fg,
                      display: "inline-flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 2,
                      fontSize: 13,
                      fontWeight: 950,
                      cursor: enabled ? "pointer" : "not-allowed",
                      opacity: enabled ? 1 : 0.35,
                      boxShadow: enabled
                        ? "inset 0 10px 18px rgba(255,255,255,.22), inset 0 -12px 20px rgba(0,0,0,.35), 0 10px 24px rgba(0,0,0,.32)"
                        : "none",
                    }}
                  >
                    <span style={{ fontSize: 22, lineHeight: 1 }}>{b.emoji}</span>
                    <span>{b.label}</span>
                    <span style={{ fontSize: 12, opacity: 0.9 }}>+{b.points}</span>
                  </button>
                );
              })}

              <button
  className="btn warn cols-3"
  type="button"
  onClick={startRedGoneByFoul}
  disabled={!state.started || state.locked || turnMode !== "red" || redsLeft <= 0 || Boolean(pendingRedFoul)}
>
  Red Gone by Foul
</button>
{pendingRedFoul ? (
  <div
    className="cols-12"
    style={{
      padding: 12,
      borderRadius: 14,
      background: "rgba(245,158,11,.14)",
      border: "1px solid rgba(245,158,11,.35)",
      color: "#fde68a",
      fontWeight: 900,
    }}
  >
    Red Gone by Foul pending: {pendingRedFoul.reds} red(s) selected for {pendingRedFoul.player}.
    Now click only Foul -4, Foul -5, Foul -6 or Foul -7.
    <button
      className="btn"
      type="button"
      onClick={cancelRedGoneByFoul}
      style={{ marginLeft: 10 }}
    >
      Cancel
    </button>
  </div>
) : null}

              {FOULS.map((f) => (
                <button
                  key={f.key}
                  className="btn danger cols-3"
                  type="button"
                  onClick={() => addEntry(f)}
                  disabled={!canEnterItem(f)}
                >
                  {f.label}
                </button>
              ))}
            </div>

                        <div className="row" style={{ marginTop: 14, gap: 8, flexWrap: "wrap" }}>
              <button className="btn" type="button" onClick={undoLast} disabled={state.locked}>
                Undo Last
              </button>

              <button
                className={tryAgainMode ? "btn danger" : "btn warn"}
                type="button"
                onClick={startTryAgain}
                disabled={!canTryAgain}
                title="Available only after the current player makes a foul"
              >
                {tryAgainMode ? `Try Again Active → ${tryAgainMode.requester}` : "Ask Try Again"}
              </button>

              <button className="btn primary" type="button" onClick={nextPlayer}>
                {tryAgainMode ? "End Try Again / Next Player" : "Next Player"}
              </button>

              <button className="btn warn" type="button" onClick={lockFinal}>
                Final Lock
              </button>
            </div>
          </div>

          <div className="card cols-12">
            <h2 style={{ marginTop: 0 }}>Live Score Summary</h2>

            <div style={{ overflowX: "auto" }}>
              <table>
                <thead>
                  <tr>
                    <th>Order</th>
                    <th>Player</th>
<th>Raw Snooker</th>
<th>HCP +/-</th>
<th>Adj. Snooker</th>
<th>Reds</th>
<th>Colours</th>
<th>Fouls</th>
<th>Current Break</th>
<th>Highest Break</th>
<th>Multiplier</th>
<th>Q Points</th>
                    <th>Next</th>
                    <th>Final</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.name}>
                      <td>{r.order}</td>
                      <td>
  <b>{r.name}</b>
</td>
<td>{r.playedSnooker}</td>
<td>
  {Number(r.handicap || 0) > 0
    ? `+${r.handicap}`
    : Number(r.handicap || 0) < 0
    ? r.handicap
    : "—"}
</td>
<td>
  <b>{r.snooker}</b>
</td>
<td>{redSummary(r.score)}</td>
<td>{colourSummary(r.score)}</td>
<td>{foulSummary(r.score)}</td>
<td>{r.currentBreak || 0}</td>
<td>
  <b>{r.highestBreak || 0}</b>
</td>
<td>{state.multiplier}</td>
<td>
  <b>{r.rummy}</b>
</td>
                      <td>{r.nextName}</td>
                      <td style={{ color: r.final < 0 ? "#ff4d4d" : "inherit", fontWeight: 900 }}>
                        {r.final}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

                        <div className="row" style={{ marginTop: 14, gap: 8, flexWrap: "wrap" }}>
              <button className="btn primary" type="button" onClick={printA4}>
                Print / Save A4
              </button>

              <button className="btn" type="button" onClick={print80mm}>
                Print 80mm
              </button>

              <button
                className="btn warn"
                type="button"
                onClick={openWhatsappPreview}
                disabled={!state.locked}
                title={state.locked ? "Preview and send WhatsApp result messages" : "Final Lock required"}
              >
                WhatsApp Results
              </button>
            </div>

            <div className="muted" style={{ marginTop: 10 }}>
              A4 print can be saved as PDF from the print dialog.
            </div>
          </div>

          <div className="card cols-6">
            <h2 style={{ marginTop: 0 }}>Ranking</h2>
            <div style={{ display: "grid", gap: 8 }}>
              {ranking.map((r, idx) => (
                <div
                  key={r.name}
                  className="row"
                  style={{
                    justifyContent: "space-between",
                    padding: "10px 12px",
                    borderRadius: 14,
                    border: "1px solid rgba(255,255,255,.12)",
                    background: idx === 0 ? "rgba(212,175,55,.14)" : "rgba(255,255,255,.04)",
                  }}
                >
                  <b>
                    {idx + 1}. {r.name}
                  </b>
                  <b style={{ color: r.final < 0 ? "#ff4d4d" : "inherit" }}>{r.final}</b>
                </div>
              ))}
            </div>
          </div>

          <div className="card cols-6">
            <h2 style={{ marginTop: 0 }}>Audit Log</h2>

            {logs.length ? (
              <div style={{ maxHeight: 360, overflow: "auto", display: "grid", gap: 6 }}>
                {logs
                  .slice()
                  .reverse()
                  .map((l) => (
                    <div
                      key={l.id}
                      style={{
                        padding: "8px 10px",
                        borderRadius: 12,
                        border: "1px solid rgba(255,255,255,.10)",
                        background: "rgba(255,255,255,.04)",
                      }}
                    >
                      <b>{l.name}</b> — {l.label} ({l.points}){" "}
                      <span className="muted">at {l.time}</span>
                    </div>
                  ))}
              </div>
            ) : (
              <div className="muted">No score entries yet.</div>
            )}
          </div>

          <div className="card cols-12">
            <h2 style={{ marginTop: 0 }}>Calculation Rule</h2>
            <div className="muted">
              Snooker Points = Reds + Colours - Fouls. Rummy Points = Snooker Points × Multiplier.
              Final Score = Own Rummy Points - Next Player's Rummy Points. Last player is calculated
              against Player 1.
            </div>
          </div>
        </div>
      </div>
            {showWhatsappPreview ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(0,0,0,.72)",
            padding: 18,
            overflow: "auto",
          }}
        >
          <div
            className="card"
            style={{
              maxWidth: 1020,
              margin: "30px auto",
              background: "#111827",
              border: "1px solid rgba(255,255,255,.18)",
            }}
          >
            <div
              className="row"
              style={{
                justifyContent: "space-between",
                gap: 12,
                alignItems: "center",
              }}
            >
              <div>
                <h2 style={{ margin: 0 }}>WhatsApp Result Preview</h2>
                <div className="muted">
                  Template: {QCHASE_RESULT_TEMPLATE_NAME}. Review each result before sending.
                </div>
              </div>

              <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
  <button
    className="btn primary"
    type="button"
    onClick={sendAllQChaseWhatsappResults}
    disabled={whatsappSendAllRunning}
  >
    {whatsappSendAllRunning ? "Sending All..." : "Send All via MSG91"}
  </button>

  <button
    className="btn danger"
    type="button"
    onClick={() => setShowWhatsappPreview(false)}
  >
    Close
  </button>
</div>
            </div>

            <div
              style={{
                marginTop: 14,
                padding: 12,
                borderRadius: 14,
                background: "rgba(255,193,7,.10)",
                border: "1px solid rgba(255,193,7,.22)",
              }}
            >
              <b>Important:</b> This sends through MSG91 using the approved template only.
              It does not use normal WhatsApp chatting.
            </div>

            <div style={{ marginTop: 14, display: "grid", gap: 12 }}>
              {rows.map((r) => {
                const key = playerKey(r.name);
                const phone = normalizeQChasePhone(playerPhones[key] || "");
                const status = whatsappSendStatus[key] || "";
                const sending = status === "sending";

                return (
                  <div
                    key={`wa-${r.name}`}
                    style={{
                      border: "1px solid rgba(255,255,255,.12)",
                      borderRadius: 16,
                      padding: 12,
                      background: "rgba(255,255,255,.04)",
                      display: "grid",
                      gap: 8,
                    }}
                  >
                    <div
                      className="row"
                      style={{
                        justifyContent: "space-between",
                        gap: 10,
                        flexWrap: "wrap",
                      }}
                    >
                      <div>
                        <b>
                          {r.name} • Rank {qChaseRankOf(r.name)} • Final {r.final}
                        </b>
                        <div className="muted">
                          Phone: {phone || "Missing"} • Status: {status || "Not sent"}
                        </div>
                      </div>

                      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                        {!phone ? (
                          <span className="badge" style={{ color: "#ffcc66" }}>
                            Missing number
                          </span>
                        ) : null}

                        <button
                          className={status === "sent" ? "btn primary" : "btn warn"}
                          type="button"
                          disabled={!phone || sending || whatsappSendAllRunning}
                          onClick={() => sendQChaseWhatsappResult(r)}
                        >
                          {sending ? "Sending..." : status === "sent" ? "Sent ✓" : "Send via MSG91"}
                        </button>
                      </div>
                    </div>

                    <textarea
                      readOnly
                      value={qChasePreviewText(r)}
                      rows={8}
                      style={{
                        width: "100%",
                        resize: "vertical",
                        fontFamily: "monospace",
                        fontSize: 12,
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
            {showReckoner ? (
        <div
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 9999,
            background: "rgba(0,0,0,.72)",
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "center",
            padding: "24px 12px",
            overflow: "auto",
          }}
        >
                    <div
            className="card"
            style={{
              width: "min(980px, 100%)",
              maxHeight: "92vh",
              overflow: "auto",
              background: "#0b1020",
              border: "1px solid rgba(255,255,255,.18)",
              boxShadow: "0 24px 80px rgba(0,0,0,.75)",
              backdropFilter: "none",
              WebkitBackdropFilter: "none",
            }}
          >
            <div className="row" style={{ justifyContent: "space-between", gap: 10 }}>
              <div>
                <h2 style={{ margin: 0 }}>Rummy Snooker Ready Reckoner</h2>
                <div className="muted">
                  Independent calculator only. Enter final snooker points manually to calculate result and ranking.
                </div>
              </div>

              <button className="btn danger" type="button" onClick={() => setShowReckoner(false)}>
                Close
              </button>
            </div>

            <div className="grid" style={{ marginTop: 16 }}>
              <div className="cols-4">
                <label className="lbl">Multiplier</label>
                <input
                  type="number"
                  value={reckonerMultiplier}
                  onChange={(e) => setReckonerMultiplier(Number(e.target.value || 0))}
                />
              </div>
            </div>

            <div className="grid" style={{ marginTop: 14 }}>
              {reckonerPlayers.map((p, index) => (
                <div className="cols-6" key={index}>
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1.4fr .8fr",
                      gap: 8,
                      alignItems: "end",
                    }}
                  >
                    <div>
                      <label className="lbl">Player {index + 1}</label>
                      <input
                        value={p.name}
                        onChange={(e) => {
                          const next = [...reckonerPlayers];
                          next[index] = {
                            ...next[index],
                            name: e.target.value.toUpperCase(),
                          };
                          setReckonerPlayers(next);
                        }}
                      />
                    </div>

                    <div>
                      <label className="lbl">Snooker Points</label>
                      <input
                        type="number"
                        value={p.snookerPoints}
                        placeholder="0"
                        onChange={(e) => {
                          const next = [...reckonerPlayers];
                          next[index] = {
                            ...next[index],
                            snookerPoints: e.target.value,
                          };
                          setReckonerPlayers(next);
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>

                        <div
              className="card"
              style={{
                marginTop: 16,
                background: "#111827",
                backdropFilter: "none",
                WebkitBackdropFilter: "none",
              }}
            >
              <h3 style={{ marginTop: 0 }}>Calculation</h3>

              <div style={{ overflowX: "auto" }}>
                <table>
                  <thead>
                    <tr>
                      <th>Order</th>
                      <th>Player</th>
                      <th>Snooker Pts</th>
                      <th>Multiplier</th>
                      <th>Rummy Pts</th>
                      <th>Next Player</th>
                      <th>Calculation</th>
                      <th>Final</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reckonerRows.map((r) => (
                      <tr key={`${r.order}-${r.name}`}>
                        <td>{r.order}</td>
                        <td>
                          <b>{r.name}</b>
                        </td>
                        <td>{r.snookerPoints}</td>
                        <td>{r.multiplier}</td>
                        <td>{r.rummyPoints}</td>
                        <td>{r.nextName}</td>
                        <td>
                          {r.rummyPoints} -{" "}
                          {r.nextRummyPoints < 0
                            ? `(${r.nextRummyPoints})`
                            : r.nextRummyPoints}
                        </td>
                        <td style={{ color: r.finalScore < 0 ? "#ff4d4d" : "inherit", fontWeight: 900 }}>
                          {r.finalScore}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="muted" style={{ marginTop: 10 }}>
                Rule: Final Score = Own Rummy Points - Next Player’s Rummy Points. Last player is calculated against Player 1.
              </div>
            </div>

                        <div
              className="card"
              style={{
                marginTop: 16,
                background: "#111827",
                backdropFilter: "none",
                WebkitBackdropFilter: "none",
              }}
            >
              <h3 style={{ marginTop: 0 }}>Ranking</h3>

              <div style={{ display: "grid", gap: 8 }}>
                {reckonerRanking.map((r, index) => (
                  <div
                    key={`${r.name}-${index}`}
                    className="row"
                    style={{
                      justifyContent: "space-between",
                      padding: "10px 12px",
                      borderRadius: 14,
                      border: "1px solid rgba(255,255,255,.12)",
                      background: index === 0 ? "rgba(212,175,55,.14)" : "rgba(255,255,255,.04)",
                    }}
                  >
                    <b>
                      {index + 1}. {r.name}
                    </b>
                    <b style={{ color: r.finalScore < 0 ? "#ff4d4d" : "inherit" }}>
                      {r.finalScore}
                    </b>
                  </div>
                ))}
              </div>
            </div>

                        <div className="row" style={{ marginTop: 16, gap: 8, flexWrap: "wrap" }}>
              <button
                className="btn primary"
                type="button"
                onClick={printReadyReckoner80mm}
              >
                Print / Save 80mm
              </button>

              <button
                className="btn"
                type="button"
                onClick={() => {
                  setReckonerPlayers((prev) =>
                    prev.map((p) => ({
                      ...p,
                      snookerPoints: "",
                    }))
                  );
                }}
              >
                Clear Points
              </button>

              
            </div>
          </div>
        </div>
      ) : null}
    
    </>
  );
}
function qChaseRecordSearchText(record = {}) {
  const htmlText = `${record.a4Html || ""} ${record.mm80Html || ""}`
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ");

  return [
    record.gameNo,
    record.tableName,
    record.winner,
    record.winnerFinal,
    record.multiplier,
    record.createdAt,
    record.startedAt,
    record.endedAt,
    record.duration,
    record.savedAt,
    htmlText,
  ]
    .join(" ")
    .toLowerCase();
}

function QChaseRecordDetails({ record }) {
  if (!record) return null;

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <h3 style={{ marginTop: 0 }}>Record Details</h3>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
        <div><b>Game No:</b><br />{record.gameNo || "—"}</div>
        <div><b>Table:</b><br />{record.tableName || "—"}</div>
        <div><b>Winner:</b><br />{record.winner || "—"}</div>
        <div><b>Winner Final:</b><br />{record.winnerFinal ?? "—"}</div>
        <div><b>Multiplier:</b><br />{record.multiplier || "—"}</div>
        <div><b>Saved:</b><br />{record.savedAt || "—"}</div>
        <div><b>Start:</b><br />{record.startedAt || "—"}</div>
        <div><b>End:</b><br />{record.endedAt || "—"}</div>
        <div><b>Duration:</b><br />{record.duration || "—"}</div>
      </div>

      <div style={{ marginTop: 14 }}>
        <b>Available Saved Sheets</b>
        <div className="muted" style={{ marginTop: 6 }}>
          This Q Chase record contains the saved A4 and 80mm print copies generated at Final Lock.
        </div>
      </div>
    </div>
  );
}
function qChaseMonthlyFormatNumber(value) {
  return new Intl.NumberFormat("en-IN").format(Number(value || 0));
}

function qChaseMonthlyFormatScore(value) {
  const num = Number(value || 0);

  if (num > 0) return `+${qChaseMonthlyFormatNumber(num)} pts`;
  if (num < 0) return `minus ${qChaseMonthlyFormatNumber(Math.abs(num))} pts`;

  return "0 pts";
}

function qChaseMonthlyMonthLabel(monthKey = "") {
  const safe = String(monthKey || "").trim();
  const [year, month] = safe.split("-");
  const date = new Date(Number(year || 0), Number(month || 1) - 1, 1);

  if (Number.isNaN(date.getTime())) return safe || "Selected Month";

  return date.toLocaleString("en-IN", {
    month: "long",
    year: "numeric",
  });
}

function qChaseMonthlyDateOnly(value = "") {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return String(value || "—");

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function qChaseMonthlySentKey(monthKey = "", phone = "", name = "") {
  const playerPart = normalizeQChasePhone(phone) || String(name || "").trim().toUpperCase();
  return `${String(monthKey || "").trim()}__${playerPart}`;
}

function loadQChaseMonthlySentLog() {
  try {
    const raw = localStorage.getItem(QCHASE_MONTHLY_SENT_KEY);
    const log = raw ? JSON.parse(raw) : {};
    return log && typeof log === "object" && !Array.isArray(log) ? log : {};
  } catch {
    return {};
  }
}

function saveQChaseMonthlySentLog(log) {
  try {
    localStorage.setItem(QCHASE_MONTHLY_SENT_KEY, JSON.stringify(log || {}));
  } catch {}
}

function buildQChaseMonthlyPlayers(records = [], selectedMonth = "") {
  const map = new Map();

  (records || []).forEach((record) => {
    const name = String(record.player_name || "").trim().toUpperCase();
    const phone = normalizeQChasePhone(record.phone || "");
    const key = phone || name;

    if (!key || !name) return;

    const finalScore = Number(record.final_score || 0);
    const snookerPoints = Number(record.highest_break || 0);
    const isWinner = Boolean(record.is_winner);
    const playedAt = record.played_at || record.created_at || "";

    const existing =
      map.get(key) || {
        key,
        name,
        phone,
        monthKey: selectedMonth,
        games: 0,
        wins: 0,
        netPoints: 0,
        bestFinal: finalScore,
        lowestFinal: finalScore,
        highestBreak: snookerPoints,
        lastPlayed: playedAt,
        winningDays: [],
        lowScoreDays: [],
        records: [],
      };

    existing.games += 1;
    existing.wins += isWinner ? 1 : 0;
    existing.netPoints += finalScore;
    existing.bestFinal = Math.max(Number(existing.bestFinal || 0), finalScore);
    existing.lowestFinal = Math.min(Number(existing.lowestFinal || 0), finalScore);
    existing.highestBreak = Math.max(Number(existing.highestBreak || 0), snookerPoints);

    if (playedAt && (!existing.lastPlayed || new Date(playedAt) > new Date(existing.lastPlayed))) {
      existing.lastPlayed = playedAt;
    }

    if (isWinner) {
      existing.winningDays.push(qChaseMonthlyDateOnly(playedAt));
    }

    if (finalScore < 0) {
      existing.lowScoreDays.push(`${qChaseMonthlyDateOnly(playedAt)}: ${qChaseMonthlyFormatScore(finalScore)}`);
    }

    existing.records.push(record);
    map.set(key, existing);
  });

  return Array.from(map.values()).sort((a, b) => {
    const byNet = Number(b.netPoints || 0) - Number(a.netPoints || 0);
    if (byNet !== 0) return byNet;
    return String(a.name || "").localeCompare(String(b.name || ""));
  });
}

function qChaseMonthlyTemplateParams(player) {
  return [
    player.name,
    qChaseMonthlyMonthLabel(player.monthKey),
    player.name,
    player.phone || "—",
    String(player.games || 0),
    String(player.wins || 0),
    qChaseMonthlyFormatScore(player.netPoints || 0),
    qChaseMonthlyFormatScore(player.bestFinal || 0),
    qChaseMonthlyFormatScore(player.lowestFinal || 0),
    String(player.highestBreak || 0),
    player.winningDays?.length ? player.winningDays.join(", ") : "No winning day recorded.",
    player.lowScoreDays?.length ? player.lowScoreDays.slice(0, 8).join("; ") : "No losing / low-score day recorded.",
    `You played ${player.games || 0} Q Chase game(s) this month with ${player.wins || 0} win(s) and monthly net Q Chase points of ${qChaseMonthlyFormatScore(player.netPoints || 0)}.`,
  ];
}

function qChaseMonthlyPreviewText(player) {
  return `Hello ${player.name},

Your Q Chase monthly report at The Q Club Pasighat is ready.

Month: ${qChaseMonthlyMonthLabel(player.monthKey)}
Player: ${player.name}
Phone: ${player.phone || "—"}

Games Played: ${player.games || 0}
Wins: ${player.wins || 0}
Monthly Net Q Chase Points: ${qChaseMonthlyFormatScore(player.netPoints || 0)}

Best Final Score: ${qChaseMonthlyFormatScore(player.bestFinal || 0)}
Lowest Final Score: ${qChaseMonthlyFormatScore(player.lowestFinal || 0)}
Best Snooker Points: ${player.highestBreak || 0}

Winning Days:
${player.winningDays?.length ? player.winningDays.join(", ") : "No winning day recorded."}

Low Score Days:
${player.lowScoreDays?.length ? player.lowScoreDays.slice(0, 8).join("; ") : "No losing / low-score day recorded."}

Monthly Summary:
You played ${player.games || 0} Q Chase game(s) this month with ${player.wins || 0} win(s) and monthly net Q Chase points of ${qChaseMonthlyFormatScore(player.netPoints || 0)}.

Thank you for playing Q Chase at The Q Club Pasighat.`;
}

function qChaseCloudSearchText(record = {}) {
  return [
    record.game_no,
    record.game_id,
    record.table_key,
    record.table_name,
    record.month_key,
    record.player_name,
    record.phone,
    record.serial_order,

    record.raw_snooker_points,
    record.manual_handicap,
    record.handicap_adjustment,
    record.adjusted_snooker_points,

    record.snooker_points,
    record.q_points,
    record.final_score,
    record.rank,
    record.is_winner ? "winner" : "played",
    record.handicap,
    record.highest_break,
    record.reds_summary,
    record.colours_summary,
    record.fouls_summary,
    record.players_line,
    record.ranking_line,
    record.started_at,
    record.ended_at,
    record.duration,
    record.played_at,

    "raw snooker",
    "manual handicap",
    "handicap adjustment",
    "adjusted snooker",
  ]
    .join(" ")
    .toLowerCase();
}

function qChaseDateText(value) {
  if (!value) return "—";

  try {
    return new Date(value).toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return String(value);
  }
}

function qChaseNum(value) {
  return Number(value || 0);
}

function qChaseCloudPlayerKey(record = {}) {
  const phone = String(record.phone || "").trim();
  const name = String(record.player_name || "").trim().toUpperCase();
  return phone || name || "UNKNOWN";
}
export function QChaseMonthlyReportPage({
  admin,
  staffAdmin,
}) {
  const [records, setRecords] = useState([]);
  const [monthFilter, setMonthFilter] = useState("");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [selectedPlayerKey, setSelectedPlayerKey] = useState("");
  const [sendStatus, setSendStatus] = useState({});
  const [sendAllRunning, setSendAllRunning] = useState(false);
  const [sentLog, setSentLog] = useState(() => loadQChaseMonthlySentLog());

  const hasAccess = admin || staffAdmin;

  async function refreshRecords() {
    if (!hasAccess) return;

    if (!supabaseReady || !supabase) {
      setLoadError("Supabase is not ready. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
      setRecords([]);
      return;
    }

    setLoading(true);
    setLoadError("");

    try {
      const { data, error } = await supabase
        .from("qchase_player_results")
        .select("*")
        .order("played_at", { ascending: false })
        .limit(3000);

      if (error) throw error;

      setRecords(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Q Chase monthly records load failed:", error);
      setLoadError(error?.message || "Could not load Q Chase monthly records.");
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refreshRecords();
  }, [hasAccess]);

  const months = useMemo(() => {
    return Array.from(
      new Set(
        (records || [])
          .map((record) => String(record.month_key || "").trim())
          .filter(Boolean)
      )
    ).sort((a, b) => b.localeCompare(a));
  }, [records]);

  useEffect(() => {
    if (!monthFilter && months.length) {
      setMonthFilter(months[0]);
    }
  }, [months, monthFilter]);

  const monthRecords = useMemo(() => {
    return (records || []).filter((record) => {
      if (!monthFilter) return false;
      return String(record.month_key || "") === String(monthFilter);
    });
  }, [records, monthFilter]);

  const monthlyPlayers = useMemo(() => {
    const q = String(query || "").trim().toLowerCase();
    const list = buildQChaseMonthlyPlayers(monthRecords, monthFilter);

    if (!q) return list;

    return list.filter((player) => {
      return [
        player.name,
        player.phone,
        player.monthKey,
        qChaseMonthlyFormatScore(player.netPoints),
        qChaseMonthlyFormatScore(player.bestFinal),
        qChaseMonthlyFormatScore(player.lowestFinal),
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [monthRecords, monthFilter, query]);

  const selectedPlayer =
    monthlyPlayers.find((player) => String(player.key) === String(selectedPlayerKey)) ||
    monthlyPlayers[0] ||
    null;

  function markMonthlySent(player) {
    const key = qChaseMonthlySentKey(player.monthKey, player.phone, player.name);
    const next = {
      ...(sentLog || {}),
      [key]: {
        sentAt: new Date().toISOString(),
        player: player.name,
        phone: player.phone || "",
        monthKey: player.monthKey,
      },
    };

    setSentLog(next);
    saveQChaseMonthlySentLog(next);
  }

  function monthlyAlreadySent(player) {
    const key = qChaseMonthlySentKey(player.monthKey, player.phone, player.name);
    return Boolean(sentLog?.[key]);
  }

  async function sendQChaseMonthlyReport(player) {
    if (!player) return;

    const phone = normalizeQChasePhone(player.phone || "");

    if (!phone) {
      alert(`WhatsApp number missing for ${player.name}.`);
      return;
    }

    const key = qChaseMonthlySentKey(player.monthKey, phone, player.name);

    if (monthlyAlreadySent(player)) {
      const ok = confirm(
        `Monthly report for ${player.name} already appears sent for ${qChaseMonthlyMonthLabel(player.monthKey)}.\n\nSend again?`
      );

      if (!ok) return;
    }

    setSendStatus((prev) => ({
      ...prev,
      [key]: "sending",
    }));

    try {
      const response = await fetch("/api/whatsapp-send", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          phone,
          templateName: QCHASE_MONTHLY_TEMPLATE_NAME,
          templateParams: qChaseMonthlyTemplateParams(player),
          label: "Q Chase Monthly Report",
          text: qChaseMonthlyPreviewText(player),
        }),
      });

      const json = await response.json().catch(() => null);

      if (!response.ok || !json?.ok) {
        throw new Error(
          json?.error ||
            json?.response?.message ||
            json?.response?.error ||
            `WhatsApp send failed with status ${response.status}`
        );
      }

      markMonthlySent(player);

      setSendStatus((prev) => ({
        ...prev,
        [key]: "sent",
      }));
    } catch (error) {
      console.error("Q Chase monthly WhatsApp send failed:", error);

      setSendStatus((prev) => ({
        ...prev,
        [key]: `failed: ${error?.message || "Unknown error"}`,
      }));
    }
  }

  function waitMonthlySend(ms = 700) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function sendAllQChaseMonthlyReports() {
    if (sendAllRunning) return;

    const sendable = monthlyPlayers.filter((player) => {
      const phone = normalizeQChasePhone(player.phone || "");
      return phone && !monthlyAlreadySent(player);
    });

    const missing = monthlyPlayers.filter((player) => !normalizeQChasePhone(player.phone || ""));

    if (!sendable.length) {
      alert(
        missing.length
          ? `No pending monthly reports to send. Missing numbers: ${missing.map((p) => p.name).join(", ")}`
          : "No pending monthly reports to send."
      );
      return;
    }

    const ok = confirm(
      `Send Q Chase monthly report to ${sendable.length} player(s) for ${qChaseMonthlyMonthLabel(monthFilter)}?\n\n` +
        `This will send one-by-one through MSG91.\n\n` +
        (missing.length ? `Skipped because number missing: ${missing.map((p) => p.name).join(", ")}` : "")
    );

    if (!ok) return;

    setSendAllRunning(true);

    try {
      for (const player of sendable) {
        await sendQChaseMonthlyReport(player);
        await waitMonthlySend(700);
      }
    } finally {
      setSendAllRunning(false);
    }
  }

  if (!hasAccess) {
    return (
      <>
        <PageShell
          title="Q Chase Monthly Reports"
          subtitle="Admin access required"
          noNav
        />
        <div className="container">
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Access Denied</h2>
            <p className="muted">Monthly Q Chase reports are available only for Main Admin and Staff Admin.</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageShell
        title="Q Chase Monthly Reports"
        subtitle="Monthly player summary from Supabase records"
        noNav
        right={
          <QClubAccessBadge
            admin={admin}
            staffAdmin={staffAdmin}
            scorerMode={false}
          />
        }
      />

      <div className="container" style={{ maxWidth: 1500, width: "min(1500px, calc(100vw - 32px))" }}>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Monthly Report Controls</h2>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "180px minmax(0, 1fr) auto auto",
              gap: 10,
              alignItems: "center",
            }}
          >
            <select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}>
              <option value="">Select Month</option>
              {months.map((month) => (
                <option key={month} value={month}>
                  {qChaseMonthlyMonthLabel(month)}
                </option>
              ))}
            </select>

            <input
              value={query}
              placeholder="Search by player name, phone, net points..."
              onChange={(e) => setQuery(e.target.value)}
            />

            <button className="btn" type="button" onClick={refreshRecords}>
              {loading ? "Loading..." : "Refresh"}
            </button>

            <button
              className="btn primary"
              type="button"
              onClick={sendAllQChaseMonthlyReports}
              disabled={sendAllRunning || !monthlyPlayers.length}
            >
              {sendAllRunning ? "Sending..." : "Send All Pending"}
            </button>
          </div>

          <div className="muted" style={{ marginTop: 8 }}>
            Showing {monthlyPlayers.length} player monthly report(s) for {qChaseMonthlyMonthLabel(monthFilter)}.
          </div>

          {loadError ? (
            <div
              style={{
                marginTop: 10,
                padding: 10,
                borderRadius: 12,
                background: "rgba(255,77,77,.12)",
                border: "1px solid rgba(255,77,77,.28)",
                color: "#ffb4b4",
              }}
            >
              {loadError}
            </div>
          ) : null}
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "420px minmax(0, 1fr)",
            gap: 14,
            alignItems: "start",
          }}
        >
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Players</h2>

            {!monthlyPlayers.length ? (
              <div className="muted">No Q Chase monthly records found.</div>
            ) : (
              <div style={{ display: "grid", gap: 8, maxHeight: 680, overflow: "auto" }}>
                {monthlyPlayers.map((player) => {
                  const active = String(selectedPlayer?.key) === String(player.key);
                  const sent = monthlyAlreadySent(player);

                  return (
                    <button
                      key={player.key}
                      type="button"
                      className="btn"
                      onClick={() => setSelectedPlayerKey(player.key)}
                      style={{
                        textAlign: "left",
                        justifyContent: "flex-start",
                        background: active ? "rgba(25,195,125,.18)" : undefined,
                      }}
                    >
                      <div>
                        <b>{player.name}</b>
                        {player.phone ? <span className="muted"> • {player.phone}</span> : null}
                        <div className="muted">
                          Games: {player.games} • Wins: {player.wins} • Net: {qChaseMonthlyFormatScore(player.netPoints)} • High Break: {player.highestBreak}
                        </div>
                        {sent ? <div style={{ color: "#19c37d", fontWeight: 800 }}>Monthly report sent ✓</div> : null}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>Selected Player Monthly Report</h2>

            {!selectedPlayer ? (
              <div className="muted">Select a player to view monthly report.</div>
            ) : (
              <>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                    gap: 10,
                    marginBottom: 14,
                  }}
                >
                  <div><b>Player</b><br />{selectedPlayer.name}</div>
                  <div><b>Phone</b><br />{selectedPlayer.phone || "—"}</div>
                  <div><b>Month</b><br />{qChaseMonthlyMonthLabel(selectedPlayer.monthKey)}</div>
                  <div><b>Games</b><br />{selectedPlayer.games}</div>
                  <div><b>Wins</b><br />{selectedPlayer.wins}</div>
                  <div><b>Monthly Net</b><br />{qChaseMonthlyFormatScore(selectedPlayer.netPoints)}</div>
                  <div><b>Best Final</b><br />{qChaseMonthlyFormatScore(selectedPlayer.bestFinal)}</div>
                  <div><b>Lowest Final</b><br />{qChaseMonthlyFormatScore(selectedPlayer.lowestFinal)}</div>
                  <div><b>Best Snooker Points</b><br />{selectedPlayer.highestBreak}</div>
                  <div><b>Last Played</b><br />{qChaseMonthlyDateOnly(selectedPlayer.lastPlayed)}</div>
                </div>

                <div className="row" style={{ gap: 8, marginBottom: 12, flexWrap: "wrap" }}>
                  <button
                    className="btn warn"
                    type="button"
                    onClick={() => sendQChaseMonthlyReport(selectedPlayer)}
                    disabled={!normalizeQChasePhone(selectedPlayer.phone || "")}
                  >
                    Send Monthly WhatsApp
                  </button>

                  <span className="badge">
                    {monthlyAlreadySent(selectedPlayer) ? "Already sent ✓" : "Not sent"}
                  </span>

                  <span className="muted">
                    {sendStatus[qChaseMonthlySentKey(selectedPlayer.monthKey, selectedPlayer.phone, selectedPlayer.name)] || ""}
                  </span>
                </div>

                <textarea
                  readOnly
                  value={qChaseMonthlyPreviewText(selectedPlayer)}
                  style={{
                    width: "100%",
                    minHeight: 300,
                    fontFamily: "monospace",
                    fontSize: 12,
                    lineHeight: 1.35,
                    borderRadius: 12,
                    padding: 10,
                    color: "#eaf0ff",
                    background: "#020617",
                    border: "1px solid rgba(255,255,255,.12)",
                  }}
                />

                <div style={{ marginTop: 14, overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 900 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left", padding: 8 }}>Date</th>
                        <th style={{ textAlign: "left", padding: 8 }}>Game</th>
                        <th style={{ textAlign: "right", padding: 8 }}>Snooker</th>
                        <th style={{ textAlign: "right", padding: 8 }}>Q Points</th>
                        <th style={{ textAlign: "right", padding: 8 }}>Final</th>
                        <th style={{ textAlign: "right", padding: 8 }}>Rank</th>
                        <th style={{ textAlign: "left", padding: 8 }}>Winner</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(selectedPlayer.records || []).map((record) => (
                        <tr key={record.id || `${record.game_no}_${record.player_name}`}>
                          <td style={{ padding: 8 }}>{qChaseMonthlyDateOnly(record.played_at)}</td>
                          <td style={{ padding: 8 }}>{record.game_no || "—"}</td>
                          <td style={{ padding: 8, textAlign: "right" }}>{record.snooker_points ?? 0}</td>
                          <td style={{ padding: 8, textAlign: "right" }}>{qChaseMonthlyFormatScore(record.q_points || 0)}</td>
                          <td style={{ padding: 8, textAlign: "right" }}>{qChaseMonthlyFormatScore(record.final_score || 0)}</td>
                          <td style={{ padding: 8, textAlign: "right" }}>{record.rank || "—"}</td>
                          <td style={{ padding: 8 }}>{record.is_winner ? "Winner" : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
export function QChaseRecordsPage({
  admin,
  staffAdmin,
}) {
  const [records, setRecords] = useState([]);
  const [query, setQuery] = useState("");
  const [monthFilter, setMonthFilter] = useState("");
  const [selectedGameNo, setSelectedGameNo] = useState("");
  const [selectedPlayerKey, setSelectedPlayerKey] = useState("");
  const [loading, setLoading] = useState(false);
const [loadError, setLoadError] = useState("");
const [deletingGameNo, setDeletingGameNo] = useState("");

  const hasAccess = admin || staffAdmin;

  async function refreshRecords() {
    if (!hasAccess) return;

    if (!supabaseReady || !supabase) {
      setLoadError("Supabase is not ready. Check VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.");
      setRecords([]);
      return;
    }

    setLoading(true);
    setLoadError("");

    try {
      const { data, error } = await supabase
        .from("qchase_player_results")
        .select("*")
        .order("played_at", { ascending: false })
        .limit(1500);

      if (error) throw error;

      setRecords(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Q Chase cloud records load failed:", error);
      setLoadError(error?.message || "Could not load Q Chase cloud records.");
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }
async function deleteSelectedQChaseGame() {
  if (!admin) {
    alert("Only Main Admin can delete Q Chase records.");
    return;
  }

  if (!selectedGame?.gameNo) {
    alert("No Q Chase game selected.");
    return;
  }

  if (!supabaseReady || !supabase) {
    alert("Supabase is not ready. Cannot delete cloud record.");
    return;
  }

  const gameNo = String(selectedGame.gameNo || "").trim();
  const playerCount = Number(selectedGame.players?.length || 0);

  const ok = confirm(
    `Delete Q Chase game ${gameNo}?\n\n` +
      `This will permanently delete ${playerCount} player row(s) from Supabase.\n\n` +
      `This cannot be undone.`
  );

  if (!ok) return;

  const typed = prompt(`Type the game number to confirm deletion:\n\n${gameNo}`);

  if (String(typed || "").trim() !== gameNo) {
    alert("Game number did not match. Delete cancelled.");
    return;
  }

  setDeletingGameNo(gameNo);

  try {
    const { error } = await supabase
      .from("qchase_player_results")
      .delete()
      .eq("game_no", gameNo);

    if (error) throw error;

    setRecords((prev) =>
      (prev || []).filter((record) => String(record.game_no || "") !== gameNo)
    );

    setSelectedGameNo("");
    setSelectedPlayerKey("");

    alert(`Deleted Q Chase game ${gameNo}.`);
  } catch (error) {
    console.error("Q Chase delete failed:", error);
    alert(`Delete failed: ${error?.message || "Unknown error"}`);
  } finally {
    setDeletingGameNo("");
  }
}
  useEffect(() => {
    refreshRecords();
  }, [hasAccess]);

  const months = useMemo(() => {
    return Array.from(
      new Set(
        (records || [])
          .map((r) => String(r.month_key || "").trim())
          .filter(Boolean)
      )
    ).sort((a, b) => b.localeCompare(a));
  }, [records]);

  const filteredRecords = useMemo(() => {
    const q = String(query || "").trim().toLowerCase();

    return (records || [])
      .filter((record) => {
        if (monthFilter && String(record.month_key || "") !== String(monthFilter)) {
          return false;
        }

        if (!q) return true;

        return qChaseCloudSearchText(record).includes(q);
      })
      .sort((a, b) => {
        const aTime = Date.parse(a.played_at || "") || 0;
        const bTime = Date.parse(b.played_at || "") || 0;
        return bTime - aTime;
      });
  }, [records, query, monthFilter]);

  const gameGroups = useMemo(() => {
    const map = new Map();

    filteredRecords.forEach((record) => {
      const gameNo = String(record.game_no || "NO-GAME-NO");

      if (!map.has(gameNo)) {
        map.set(gameNo, {
          gameNo,
          gameId: record.game_id || "",
          tableName: record.table_name || "—",
          tableKey: record.table_key || "",
          monthKey: record.month_key || "",
          playedAt: record.played_at || "",
          startedAt: record.started_at || "",
          endedAt: record.ended_at || "",
          duration: record.duration || "",
          players: [],
        });
      }

      map.get(gameNo).players.push(record);
    });

    return Array.from(map.values()).sort((a, b) => {
      const aTime = Date.parse(a.playedAt || "") || 0;
      const bTime = Date.parse(b.playedAt || "") || 0;
      return bTime - aTime;
    });
  }, [filteredRecords]);

  const selectedGame =
    gameGroups.find((g) => String(g.gameNo) === String(selectedGameNo)) ||
    gameGroups[0] ||
    null;

  const selectedGameRows = useMemo(() => {
    return (selectedGame?.players || [])
      .slice()
      .sort((a, b) => Number(a.serial_order || 0) - Number(b.serial_order || 0));
  }, [selectedGame]);

  const playerStats = useMemo(() => {
    const map = new Map();

    filteredRecords.forEach((record) => {
      const key = qChaseCloudPlayerKey(record);

      if (!map.has(key)) {
        map.set(key, {
          key,
          playerName: record.player_name || "—",
          phone: record.phone || "",
          games: 0,
          wins: 0,
          bestFinal: qChaseNum(record.final_score),
          lowestFinal: qChaseNum(record.final_score),
          highestBreak: qChaseNum(record.highest_break),
bestRawSnooker: qChaseNum(record.raw_snooker_points),
bestHandicapAdjustment: qChaseNum(record.handicap_adjustment),
bestAdjustedSnooker: qChaseNum(record.adjusted_snooker_points || record.snooker_points),
totalFinal: 0,
lastPlayedAt: record.played_at || "",
        });
      }

      const stat = map.get(key);
      const finalScore = qChaseNum(record.final_score);
const snooker = qChaseNum(record.highest_break);
const rawSnooker = qChaseNum(record.raw_snooker_points);
const handicapAdjustment = qChaseNum(record.handicap_adjustment);
const adjustedSnooker = qChaseNum(record.adjusted_snooker_points || record.snooker_points);

      stat.games += 1;
      stat.wins += record.is_winner ? 1 : 0;
      stat.bestFinal = Math.max(stat.bestFinal, finalScore);
      stat.lowestFinal = Math.min(stat.lowestFinal, finalScore);
      stat.highestBreak = Math.max(stat.highestBreak, snooker);
stat.bestRawSnooker = Math.max(Number(stat.bestRawSnooker || 0), rawSnooker);
stat.bestHandicapAdjustment =
  Math.abs(handicapAdjustment) > Math.abs(Number(stat.bestHandicapAdjustment || 0))
    ? handicapAdjustment
    : Number(stat.bestHandicapAdjustment || 0);
stat.bestAdjustedSnooker = Math.max(Number(stat.bestAdjustedSnooker || 0), adjustedSnooker);
stat.totalFinal += finalScore;

      const oldTime = Date.parse(stat.lastPlayedAt || "") || 0;
      const newTime = Date.parse(record.played_at || "") || 0;
      if (newTime > oldTime) stat.lastPlayedAt = record.played_at || "";
    });

    return Array.from(map.values()).sort((a, b) => {
      return b.wins - a.wins || b.bestFinal - a.bestFinal || b.games - a.games;
    });
  }, [filteredRecords]);

  const selectedPlayer =
    playerStats.find((p) => String(p.key) === String(selectedPlayerKey)) ||
    playerStats[0] ||
    null;

  const selectedPlayerRows = useMemo(() => {
    if (!selectedPlayer) return [];

    return filteredRecords
      .filter((record) => qChaseCloudPlayerKey(record) === selectedPlayer.key)
      .slice()
      .sort((a, b) => {
        const aTime = Date.parse(a.played_at || "") || 0;
        const bTime = Date.parse(b.played_at || "") || 0;
        return bTime - aTime;
      });
  }, [filteredRecords, selectedPlayer]);

  if (!hasAccess) {
    return (
      <>
        <PageShell
          title="Q Chase Records"
          subtitle="Admin access required"
          noNav
        />
        <div className="container">
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Access Denied</h2>
            <p className="muted">Q Chase Records are available only for Main Admin and Staff Admin.</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageShell
  title="Q Chase Records"
  subtitle="Cloud player records from Supabase"
  noNav
  right={
    <QClubAccessBadge
      admin={admin}
      staffAdmin={staffAdmin}
      scorerMode={false}
    />
  }
/>

      <div
  className="container"
  style={{
    maxWidth: 1500,
    width: "min(1500px, calc(100vw - 32px))",
  }}
>
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Search Cloud Records</h2>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 180px auto",
              gap: 10,
              alignItems: "center",
            }}
          >
            <input
              value={query}
              placeholder="Search by player name, phone, game no, table, winner, month..."
              onChange={(e) => setQuery(e.target.value)}
            />

            <select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)}>
              <option value="">All Months</option>
              {months.map((m) => (
                <option value={m} key={m}>
                  {m}
                </option>
              ))}
            </select>

            <button className="btn" type="button" onClick={refreshRecords}>
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>

          <div className="muted" style={{ marginTop: 8 }}>
            Showing {filteredRecords.length} player rows from {gameGroups.length} game(s).
          </div>

          {loadError ? (
            <div
              style={{
                marginTop: 10,
                padding: 10,
                borderRadius: 12,
                background: "rgba(255,77,77,.12)",
                border: "1px solid rgba(255,77,77,.28)",
                color: "#ffb4b4",
              }}
            >
              {loadError}
            </div>
          ) : null}
        </div>

        <div
  style={{
    display: "grid",
    gridTemplateColumns: "360px minmax(0, 1fr)",
    gap: 14,
    alignItems: "start",
  }}
>
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Player Summary</h2>

            {!playerStats.length ? (
              <div className="muted">No player records found.</div>
            ) : (
              <div style={{ display: "grid", gap: 8, maxHeight: 520, overflow: "auto" }}>
                {playerStats.map((p) => {
                  const active = String(selectedPlayer?.key) === String(p.key);
                  const avg = p.games ? Math.round(p.totalFinal / p.games) : 0;

                  return (
                    <button
                      key={p.key}
                      type="button"
                      className="btn"
                      onClick={() => setSelectedPlayerKey(p.key)}
                      style={{
                        textAlign: "left",
                        justifyContent: "flex-start",
                        background: active ? "rgba(25,195,125,.18)" : undefined,
                      }}
                    >
                      <div>
                        <b>{p.playerName}</b>
                        {p.phone ? <span className="muted"> • {p.phone}</span> : null}
                        <div className="muted">
                          Games: {p.games} • Wins: {p.wins} • Best Final: {p.bestFinal} • Low: {p.lowestFinal} • Best Snooker Points: {p.highestBreak} • Avg: {avg}
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="card">
            <h2 style={{ marginTop: 0 }}>Selected Player Details</h2>

            {!selectedPlayer ? (
              <div className="muted">Select a player to view details.</div>
            ) : (
              <>
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
                    gap: 10,
                  }}
                >
                  <div><b>Player</b><br />{selectedPlayer.playerName}</div>
                  <div><b>Phone</b><br />{selectedPlayer.phone || "—"}</div>
                  <div><b>Games</b><br />{selectedPlayer.games}</div>
                  <div><b>Wins</b><br />{selectedPlayer.wins}</div>
                  <div><b>Best Final</b><br />{selectedPlayer.bestFinal}</div>
                  <div><b>Lowest Final</b><br />{selectedPlayer.lowestFinal}</div>
                  <div><b>Best Snooker Points</b><br />{selectedPlayer.highestBreak}</div>
                  <div><b>Best Raw Snooker</b><br />{selectedPlayer.bestRawSnooker || 0}</div>
<div>
  <b>Best HCP Adj.</b><br />
  {Number(selectedPlayer.bestHandicapAdjustment || 0) > 0
    ? `+${selectedPlayer.bestHandicapAdjustment}`
    : Number(selectedPlayer.bestHandicapAdjustment || 0) < 0
    ? selectedPlayer.bestHandicapAdjustment
    : 0}
</div>
<div><b>Best Adj. Snooker</b><br />{selectedPlayer.bestAdjustedSnooker || 0}</div>
                  <div><b>Last Played</b><br />{qChaseDateText(selectedPlayer.lastPlayedAt)}</div>
                </div>

                <div style={{ marginTop: 14, overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1150 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left", padding: 8 }}>Date</th>
                        <th style={{ textAlign: "left", padding: 8 }}>Game</th>
                        <th style={{ textAlign: "left", padding: 8 }}>Table</th>
                        <th style={{ textAlign: "right", padding: 8 }}>Rank</th>
                        <th style={{ textAlign: "right", padding: 8 }}>Raw</th>
<th style={{ textAlign: "right", padding: 8 }}>HCP +/-</th>
<th style={{ textAlign: "right", padding: 8 }}>Adj. Snooker</th>
<th style={{ textAlign: "right", padding: 8 }}>Highest Break</th>
<th style={{ textAlign: "right", padding: 8 }}>Q Points</th>
<th style={{ textAlign: "right", padding: 8 }}>Final</th>
                        <th style={{ textAlign: "left", padding: 8 }}>Result</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedPlayerRows.map((r) => (
                        <tr key={r.id}>
                          <td style={{ padding: 8 }}>{qChaseDateText(r.played_at)}</td>
                          <td style={{ padding: 8 }}>{r.game_no || "—"}</td>
                          <td style={{ padding: 8 }}>{r.table_name || "—"}</td>
                          <td style={{ padding: 8, textAlign: "right" }}>{r.rank || "—"}</td>
                         <td style={{ padding: 8, textAlign: "right" }}>
  {r.raw_snooker_points ?? 0}
</td>
<td style={{ padding: 8, textAlign: "right" }}>
  {Number(r.handicap_adjustment || 0) > 0
    ? `+${r.handicap_adjustment}`
    : Number(r.handicap_adjustment || 0) < 0
    ? r.handicap_adjustment
    : 0}
</td>
<td style={{ padding: 8, textAlign: "right" }}>
  {r.adjusted_snooker_points ?? r.snooker_points ?? 0}
</td>
<td style={{ padding: 8, textAlign: "right" }}>{r.highest_break ?? 0}</td>
<td style={{ padding: 8, textAlign: "right" }}>{r.q_points ?? 0}</td>
<td
                            style={{
                              padding: 8,
                              textAlign: "right",
                              color: Number(r.final_score || 0) < 0 ? "#ff5b5b" : "#38d39f",
                              fontWeight: 900,
                            }}
                          >
                            {r.final_score ?? 0}
                          </td>
                          <td style={{ padding: 8 }}>{r.is_winner ? "Winner" : "Played"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Games</h2>

          {!gameGroups.length ? (
            <div className="muted">No Q Chase games found in cloud records.</div>
          ) : (
            <div style={{ display: "grid", gap: 8, maxHeight: 360, overflow: "auto" }}>
              {gameGroups.map((game) => {
                const active = String(selectedGame?.gameNo) === String(game.gameNo);
                const winner = (game.players || []).find((p) => p.is_winner);

                return (
                  <button
                    key={game.gameNo}
                    type="button"
                    className="btn"
                    onClick={() => setSelectedGameNo(game.gameNo)}
                    style={{
                      textAlign: "left",
                      justifyContent: "flex-start",
                      background: active ? "rgba(25,195,125,.18)" : undefined,
                    }}
                  >
                    <div>
                      <b>{game.gameNo}</b>
                      {" "}— {game.tableName}
                      {" "}— Winner: {winner?.player_name || "—"} ({winner?.final_score ?? "—"})
                      <div className="muted">
                        Players: {game.players.length} • Month: {game.monthKey || "—"} • Played: {qChaseDateText(game.playedAt)}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {selectedGame ? (
          <div className="card">
            <div
  style={{
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    alignItems: "center",
    marginBottom: 10,
  }}
>
  <h2 style={{ margin: 0 }}>Selected Game Details</h2>

  {admin ? (
    <button
      className="btn danger"
      type="button"
      onClick={deleteSelectedQChaseGame}
      disabled={deletingGameNo === selectedGame?.gameNo}
      title="Main Admin only. Permanently deletes this full Q Chase game from Supabase."
    >
      {deletingGameNo === selectedGame?.gameNo ? "Deleting..." : "Delete Selected Game"}
    </button>
  ) : null}
</div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))",
                gap: 10,
                marginBottom: 14,
              }}
            >
              <div><b>Game No.</b><br />{selectedGame.gameNo}</div>
              <div><b>Table</b><br />{selectedGame.tableName}</div>
              <div><b>Month</b><br />{selectedGame.monthKey || "—"}</div>
              <div><b>Start</b><br />{selectedGame.startedAt || "—"}</div>
              <div><b>End</b><br />{selectedGame.endedAt || "—"}</div>
              <div><b>Duration</b><br />{selectedGame.duration || "—"}</div>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: 8 }}>Order</th>
                    <th style={{ textAlign: "left", padding: 8 }}>Player</th>
                    <th style={{ textAlign: "left", padding: 8 }}>Phone</th>
                    <th style={{ textAlign: "right", padding: 8 }}>HCP</th>
                    <th style={{ textAlign: "left", padding: 8 }}>Reds</th>
                    <th style={{ textAlign: "left", padding: 8 }}>Colours</th>
                    <th style={{ textAlign: "left", padding: 8 }}>Fouls</th>
                    <th style={{ textAlign: "right", padding: 8 }}>Snooker</th>
<th style={{ textAlign: "right", padding: 8 }}>Highest Break</th>
<th style={{ textAlign: "right", padding: 8 }}>Q Points</th>
<th style={{ textAlign: "right", padding: 8 }}>Final</th>
                    <th style={{ textAlign: "right", padding: 8 }}>Rank</th>
                    <th style={{ textAlign: "left", padding: 8 }}>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedGameRows.map((r) => (
                    <tr key={r.id}>
                      <td style={{ padding: 8 }}>{r.serial_order}</td>
                      <td style={{ padding: 8 }}><b>{r.player_name}</b></td>
                      <td style={{ padding: 8 }}>{r.phone || "—"}</td>
                      <td style={{ padding: 8, textAlign: "right" }}>{r.handicap || 0}</td>
                      <td style={{ padding: 8 }}>{r.reds_summary || "—"}</td>
                      <td style={{ padding: 8 }}>{r.colours_summary || "—"}</td>
                      <td style={{ padding: 8 }}>{r.fouls_summary || "—"}</td>
                     <td style={{ padding: 8, textAlign: "right" }}>{r.snooker_points ?? 0}</td>
<td style={{ padding: 8, textAlign: "right" }}>{r.highest_break ?? 0}</td>
<td style={{ padding: 8, textAlign: "right" }}>{r.q_points ?? 0}</td>
<td
                        style={{
                          padding: 8,
                          textAlign: "right",
                          color: Number(r.final_score || 0) < 0 ? "#ff5b5b" : "#38d39f",
                          fontWeight: 900,
                        }}
                      >
                        {r.final_score ?? 0}
                      </td>
                      <td style={{ padding: 8, textAlign: "right" }}>{r.rank || "—"}</td>
                      <td style={{ padding: 8 }}>{r.is_winner ? "Winner" : "Played"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div style={{ marginTop: 14 }}>
              <b>Players Line</b>
              <div className="muted" style={{ marginTop: 4 }}>
                {selectedGameRows[0]?.players_line || "—"}
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <b>Ranking Line</b>
              <div className="muted" style={{ marginTop: 4 }}>
                {selectedGameRows[0]?.ranking_line || "—"}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
export function RummySnookerDisplayPage({
  tableKey = "table1",
  tableLabel = "Snooker Table 1",
}) {
  const [snapshot, setSnapshot] = useState(() => loadDisplayState(tableKey));

  useEffect(() => {
    document.body.classList.add("qchase-display-mode");

    function refresh() {
      setSnapshot(loadDisplayState(tableKey));
    }

    refresh();

    window.addEventListener("storage", refresh);
    window.addEventListener(`qclub-rummy-display-update-${tableKey}`, refresh);

    const timer = setInterval(refresh, 1000);

    return () => {
      document.body.classList.remove("qchase-display-mode");
      window.removeEventListener("storage", refresh);
      window.removeEventListener(`qclub-rummy-display-update-${tableKey}`, refresh);
      clearInterval(timer);
    };
  }, [tableKey]);

  const rows = Array.isArray(snapshot?.rows) ? snapshot.rows : [];
  const ranking = Array.isArray(snapshot?.ranking) ? snapshot.ranking : [];
  const locked = Boolean(snapshot?.locked);
  const started = Boolean(snapshot?.started);
  const playerCount = rows.length || 6;

  const rowHeight =
    playerCount <= 3
      ? "122px"
      : playerCount === 4
      ? "108px"
      : playerCount === 5
      ? "94px"
      : playerCount === 6
      ? "80px"
      : playerCount === 7
      ? "68px"
      : "60px";

  const displayNameFont =
    playerCount <= 3
      ? "clamp(46px, 4.8vw, 78px)"
      : playerCount === 4
      ? "clamp(42px, 4.3vw, 70px)"
      : playerCount === 5
      ? "clamp(38px, 3.8vw, 62px)"
      : playerCount === 6
      ? "clamp(34px, 3.1vw, 54px)"
      : "clamp(27px, 2.45vw, 44px)";

  const displayScoreFont =
    playerCount <= 3
      ? "clamp(52px, 5vw, 82px)"
      : playerCount === 4
      ? "clamp(48px, 4.5vw, 76px)"
      : playerCount === 5
      ? "clamp(42px, 3.9vw, 66px)"
      : playerCount === 6
      ? "clamp(38px, 3.25vw, 58px)"
      : "clamp(31px, 2.65vw, 52px)";

  const smallScoreFont =
    playerCount <= 4
      ? "clamp(26px, 2.2vw, 42px)"
      : playerCount <= 6
      ? "clamp(23px, 1.9vw, 36px)"
      : "clamp(20px, 1.65vw, 32px)";

  const displayBallSize =
    playerCount <= 4 ? 38 : playerCount <= 6 ? 34 : 30;

  const displayBallFont =
    playerCount <= 4 ? 17 : playerCount <= 6 ? 15 : 14;

  const scoreGridColumns = locked
    ? "62px minmax(185px, 2fr) .78fr .78fr .88fr .68fr minmax(130px, 1.25fr) minmax(105px, 1fr) .85fr 1.18fr 1.12fr"
    : "62px minmax(185px, 2fr) .78fr .78fr .88fr .68fr minmax(130px, 1.25fr) minmax(105px, 1fr) .85fr 1.18fr";

  const headerCellStyle = {
    padding: "10px 8px",
    minWidth: 0,
    textAlign: "center",
    fontSize: "clamp(16px, 1.15vw, 24px)",
    lineHeight: 1.08,
    fontWeight: 950,
    color: "rgba(241,245,255,.78)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };

  const cellStyle = {
    padding: "8px 8px",
    minWidth: 0,
    textAlign: "center",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  };

  const numberStyle = {
    fontSize: smallScoreFont,
    lineHeight: 1,
    fontWeight: 950,
    letterSpacing: "-.03em",
    whiteSpace: "nowrap",
  };

  return (
    <>
      <style>{`
        body.qchase-display-mode .nav,
        body.qchase-display-mode .bottomNav,
        body.qchase-display-mode .navHelper,
        body.qchase-display-mode .musicDock,
        body.qchase-display-mode footer {
          display: none !important;
        }

        body.qchase-display-mode {
          overflow: hidden !important;
          background: #03050a !important;
        }
      `}</style>

      <div
        style={{
          height: "100vh",
          width: "100vw",
          padding: "10px 12px",
          overflow: "hidden",
          background:
            "radial-gradient(circle at top left, rgba(56,211,159,.18), transparent 30%), linear-gradient(180deg, #03050a, #070c16 45%, #080d18)",
        }}
      >
        <div
          style={{
            height: "100%",
            width: "100%",
            maxWidth: "none",
            margin: "0 auto",
            display: "grid",
            gridTemplateRows: "auto 1fr",
            gap: 12,
          }}
        >
          <div
            style={{
              border: "1px solid rgba(255,255,255,.16)",
              background: "#0b1020",
              borderRadius: 24,
              padding: "16px 22px",
              boxShadow: "0 18px 60px rgba(0,0,0,.45)",
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 18,
              alignItems: "center",
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 950,
                  letterSpacing: ".08em",
                  textTransform: "uppercase",
                  color: "rgba(255,255,255,.78)",
                }}
              >
                The Q Club Pasighat
              </div>

              <div
                style={{
                  marginTop: 6,
                  fontSize: "clamp(44px, 4.7vw, 82px)",
                  lineHeight: 0.95,
                  fontWeight: 950,
                  letterSpacing: "-.06em",
                }}
              >
                Q Chase Snooker
              </div>

              <div
                style={{
                  marginTop: 8,
                  fontSize: 22,
                  color: "rgba(241,245,255,.72)",
                  fontWeight: 800,
                }}
              >
                {snapshot?.tableName || tableLabel}
              </div>
            </div>

            <div
              style={{
                textAlign: "right",
                display: "grid",
                gap: 8,
                justifyItems: "end",
              }}
            >
              <div style={{ fontSize: 20, fontWeight: 950 }}>
                {snapshot?.gameNo || "No active game"}
              </div>

              <div style={{ fontSize: 18, color: "rgba(241,245,255,.72)", fontWeight: 800 }}>
                Multiplier: {snapshot?.multiplier || "—"}
              </div>

              <div
                style={{
                  padding: "10px 16px",
                  borderRadius: 999,
                  fontSize: 18,
                  fontWeight: 950,
                  background: locked
                    ? "rgba(56,211,159,.18)"
                    : started
                    ? "rgba(255,204,102,.14)"
                    : "rgba(255,255,255,.08)",
                  border: locked
                    ? "1px solid rgba(56,211,159,.40)"
                    : "1px solid rgba(255,204,102,.32)",
                }}
              >
                {locked ? "FINAL LOCKED" : started ? "LIVE GAME" : "WAITING"}
              </div>
            </div>
          </div>

          {!rows.length ? (
            <div
              style={{
                border: "1px solid rgba(255,255,255,.14)",
                background: "#111827",
                borderRadius: 26,
                display: "grid",
                placeItems: "center",
                textAlign: "center",
                padding: 40,
              }}
            >
              <div>
                <div style={{ fontSize: 42, fontWeight: 950 }}>
                  No live Q Chase Snooker game found.
                </div>
                <div style={{ marginTop: 12, fontSize: 22, color: "rgba(241,245,255,.68)" }}>
                  Start the scoring page for {tableLabel}.
                </div>
              </div>
            </div>
          ) : (
            <div
              style={{
                minHeight: 0,
                border: "1px solid rgba(255,255,255,.14)",
                background: "#111827",
                borderRadius: 26,
                padding: 14,
                boxShadow: "0 18px 60px rgba(0,0,0,.38)",
                display: "grid",
                gridTemplateRows: "auto 1fr auto",
                gridTemplateColumns: locked ? "minmax(0, 1fr) 300px" : "minmax(0, 1fr)",
                gap: 12,
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  alignItems: "center",
                  gap: 14,
                  gridColumn: locked ? "1 / 3" : "1 / 2",
                }}
              >
                <div
                  style={{
                    fontSize: "clamp(32px, 2.8vw, 54px)",
                    lineHeight: 1,
                    fontWeight: 950,
                    letterSpacing: "-.04em",
                  }}
                >
                  {locked ? "Final Score" : "Running Score Only"}
                </div>

                <div
                  style={{
                    padding: "11px 15px",
                    borderRadius: 999,
                    border: "1px solid rgba(255,255,255,.14)",
                    background: "rgba(255,255,255,.06)",
                    fontSize: 21,
                    fontWeight: 900,
                    whiteSpace: "nowrap",
                  }}
                >
                  Current: {snapshot?.currentPlayer || "—"} • Reds: {snapshot?.redsLeft ?? "—"} • Next:{" "}
                  {snapshot?.nextBallText || "—"}
                </div>
              </div>

              <div
                style={{
                  minHeight: 0,
                  overflow: "hidden",
                  gridColumn: "1 / 2",
                  gridRow: "2 / 3",
                }}
              >
                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: scoreGridColumns,
                    gap: 0,
                    alignItems: "center",
                    background: "rgba(255,255,255,.06)",
                    borderRadius: "18px 18px 0 0",
                    overflow: "hidden",
                    borderBottom: "1px solid rgba(255,255,255,.10)",
                  }}
                >
                  {[
                    "Order",
                    "Player",
                    "Raw",
                    "HCP +/-",
                    "Adj. Snooker",
                    "Reds",
                    "Colours",
                    "Fouls",
                    "Highest Break",
                    "Q Points",
                  ]
                    .concat(locked ? ["Final"] : [])
                    .map((label) => (
                      <div key={label} style={headerCellStyle}>
                        {label}
                      </div>
                    ))}
                </div>

                {rows.map((r) => (
                  <div
                    key={`${r.order}-${r.name}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: scoreGridColumns,
                      minHeight: rowHeight,
                      alignItems: "center",
                      borderBottom: "1px solid rgba(255,255,255,.08)",
                      background:
                        r.name === snapshot?.currentPlayer && !locked
                          ? "rgba(56,211,159,.16)"
                          : "transparent",
                    }}
                  >
                    <div style={{ ...cellStyle, fontSize: 22, fontWeight: 950 }}>
                      {r.order}
                    </div>

                    <div
                      style={{
                        padding: "8px 10px",
                        minWidth: 0,
                        overflow: "hidden",
                        fontSize: displayNameFont,
                        lineHeight: 1,
                        fontWeight: 950,
                        letterSpacing: "-.04em",
                        whiteSpace: "nowrap",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {r.name}
                    </div>

                    <div style={cellStyle}>
                      <span style={numberStyle}>{r.playedSnooker || 0}</span>
                    </div>

                    <div style={cellStyle}>
                      <span
                        style={{
                          ...numberStyle,
                          color:
                            Number(r.handicap || 0) > 0
                              ? "#38d39f"
                              : Number(r.handicap || 0) < 0
                              ? "#ffcd4d"
                              : "rgba(241,245,255,.9)",
                        }}
                      >
                        {Number(r.handicap || 0) > 0
                          ? `+${r.handicap}`
                          : Number(r.handicap || 0) < 0
                          ? r.handicap
                          : "—"}
                      </span>
                    </div>

                    <div style={cellStyle}>
                      <span style={numberStyle}>{r.snooker || 0}</span>
                    </div>

                    <div style={cellStyle}>
                      <span style={numberStyle}>{r.reds}</span>
                    </div>

                    <div
                      style={{
                        padding: "4px 6px",
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 5,
                        alignItems: "center",
                        justifyContent: "center",
                        alignContent: "center",
                        minHeight: 40,
                        overflow: "hidden",
                      }}
                    >
                      {(() => {
                        const balls = parseDisplayColourSummary(r.colours);

                        if (!balls.length) {
                          return <span style={{ fontSize: 18, opacity: 0.7 }}>—</span>;
                        }

                        return balls.map((ball, idx) => (
                          <span
                            key={`${r.name}-colour-${idx}`}
                            title={`${ball.label} × ${ball.count}`}
                            style={{
                              width: displayBallSize,
                              height: displayBallSize,
                              borderRadius: "999px",
                              background: ball.bg,
                              color: ball.fg,
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              fontSize: displayBallFont,
                              fontWeight: 950,
                              border: "1px solid rgba(255,255,255,.28)",
                              boxShadow:
                                "inset 0 3px 6px rgba(255,255,255,.22), inset 0 -4px 8px rgba(0,0,0,.35)",
                            }}
                          >
                            {ball.count}
                          </span>
                        ));
                      })()}
                    </div>

                    <div
                      style={{
                        ...cellStyle,
                        fontSize: playerCount <= 6 ? 20 : 18,
                        fontWeight: 850,
                        lineHeight: 1.12,
                      }}
                    >
                      {r.fouls}
                    </div>

                    <div style={cellStyle} title="Highest Break">
                      <span
                        style={{
                          ...numberStyle,
                          color: "#fbbf24",
                        }}
                      >
                        {r.highestBreak || 0}
                      </span>
                    </div>

                    <div style={cellStyle}>
                      <span
                        style={{
                          fontSize: displayScoreFont,
                          lineHeight: 1,
                          fontWeight: 950,
                          letterSpacing: "-.04em",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {r.rummy}
                      </span>
                    </div>

                    {locked ? (
                      <div style={cellStyle}>
                        <span
                          style={{
                            fontSize: displayScoreFont,
                            lineHeight: 1,
                            fontWeight: 950,
                            letterSpacing: "-.04em",
                            whiteSpace: "nowrap",
                            color: r.final < 0 ? "#ff4d4d" : "#38d39f",
                          }}
                        >
                          {r.final}
                        </span>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>

              {locked ? (
                <div
                  style={{
                    gridColumn: "2 / 3",
                    gridRow: "2 / 3",
                    border: "1px solid rgba(255,255,255,.12)",
                    background: "rgba(255,255,255,.04)",
                    borderRadius: 22,
                    padding: 12,
                    overflow: "hidden",
                    display: "grid",
                    gridTemplateRows: "auto 1fr",
                    gap: 10,
                  }}
                >
                  <div
                    style={{
                      fontSize: 25,
                      fontWeight: 950,
                      letterSpacing: "-.03em",
                    }}
                  >
                    Final Ranking
                  </div>

                  <div style={{ display: "grid", gap: 8, alignContent: "start" }}>
                    {ranking.map((r, idx) => (
                      <div
                        key={`${r.name}-${idx}`}
                        style={{
                          padding: "9px 11px",
                          borderRadius: 15,
                          border: "1px solid rgba(255,255,255,.12)",
                          background:
                            idx === 0
                              ? "rgba(212,175,55,.18)"
                              : "rgba(255,255,255,.05)",
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "center",
                          gap: 10,
                        }}
                      >
                        <b style={{ fontSize: 19, whiteSpace: "nowrap" }}>
                          {idx + 1}. {r.name}
                        </b>
                        <b
                          style={{
                            fontSize: 23,
                            color: r.final < 0 ? "#ff4d4d" : "#38d39f",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {r.final}
                        </b>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              <div
                style={{
                  fontSize: 19,
                  color: "rgba(241,245,255,.68)",
                  fontWeight: 800,
                  gridColumn: locked ? "1 / 3" : "1 / 2",
                  gridRow: "3 / 4",
                }}
              >
                {locked
                  ? "Final score and ranking are now locked."
                  : "Final score and ranking will appear only after Final Lock."}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}