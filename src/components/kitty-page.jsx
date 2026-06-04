import React, { useEffect, useMemo, useState } from "react";
import { PageShell, QClubAccessBadge } from "./page-helpers";
import { supabase, supabaseReady } from "../supabase";
const KITTY_DISPLAY_STORAGE_PREFIX = "qclub_kitty_display_state";
const KITTY_SCORESHEET_ARCHIVE_KEY = "qclub_kitty_saved_scoresheets";
const QCLUB_PLAYER_PHONEBOOK_KEY = "qclub_qchase_player_phonebook";
const KITTY_RESULT_TEMPLATE_NAME = "kitty_result_settlement";
const KITTY_MONTHLY_TEMPLATE_NAME = "kitty_monthly_report";
const KITTY_TABLES = {
  table1: {
    key: "table1",
    label: "Snooker 1",
    displayName: "Ronnie's Table 12x6",
    gameType: "snooker_ronnie_12x6",
    scorePath: "/kitty-table-1",
    displayPath: "/kitty-table-1-display",
    ratePerHour: 600,
    needsPin: false,
  },
  table2: {
    key: "table2",
    label: "Snooker 2",
    displayName: "Mini Snooker Table 10x5",
    gameType: "snooker_mini_10x5",
    scorePath: "/kitty-table-2",
    displayPath: "/kitty-table-2-display",
    ratePerHour: 500,
    needsPin: false,
  },
  table3: {
    key: "table3",
    label: "Pool Table",
    displayName: "American Pool Table",
    gameType: "pool_american",
    scorePath: "/kitty-table-3",
    displayPath: "/kitty-table-3-display",
    ratePerHour: 400,
    needsPin: false,
  },
  table4: {
    key: "table4",
    label: "Snooker 3",
    displayName: "Snooker Table 12x6",
    gameType: "snooker_extra_12x6",
    scorePath: "/kitty-table-4",
    displayPath: "/kitty-table-4-display",
    ratePerHour: 600,
    needsPin: true,
  },
};

function getKittyTableConfig(tableKey = "table1") {
  return KITTY_TABLES[tableKey] || KITTY_TABLES.table1;
}

function displayStorageKey(tableKey = "table1") {
  return `${KITTY_DISPLAY_STORAGE_PREFIX}_${tableKey || "table1"}`;
}
const KITTY_ACTIVE_GAME_STORAGE_PREFIX = "qclub_kitty_active_game_state";

function activeKittyStorageKey(tableKey = "table1") {
  return `${KITTY_ACTIVE_GAME_STORAGE_PREFIX}_${tableKey || "table1"}`;
}

function loadActiveKittyGame(tableKey = "table1") {
  try {
    const raw = localStorage.getItem(activeKittyStorageKey(tableKey));
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function saveActiveKittyGame(tableKey = "table1", snapshot) {
  try {
    localStorage.setItem(activeKittyStorageKey(tableKey), JSON.stringify(snapshot));
  } catch {}
}

function clearActiveKittyGame(tableKey = "table1") {
  try {
    localStorage.removeItem(activeKittyStorageKey(tableKey));
  } catch {}
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
    window.dispatchEvent(new Event(`qclub-kitty-display-update-${tableKey}`));
  } catch {}
}

function loadSavedKittySheets() {
  try {
    const raw = localStorage.getItem(KITTY_SCORESHEET_ARCHIVE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveKittySheet(item) {
  try {
    const list = loadSavedKittySheets();
    const next = [item, ...list].slice(0, 100);
    localStorage.setItem(KITTY_SCORESHEET_ARCHIVE_KEY, JSON.stringify(next));
  } catch {}
}
async function saveKittyPlayerResultsToCloud({
  finalState,
  order,
  players,
  qualifierOrder,
  nextGameOrder,
  tableKey,
  tableLabel,
  playerPhones = {},
}) {
  if (!supabaseReady || !supabase) {
    console.warn("Supabase not ready. Kitty cloud record was not saved.");
    alert("Kitty final locked locally, but cloud save skipped because Supabase is not ready.");
    return false;
  }

  const savedAt = new Date();
  const monthKeyValue = `${savedAt.getFullYear()}-${String(savedAt.getMonth() + 1).padStart(2, "0")}`;

  const playersLine = (order || [])
    .map((name, index) => {
      const p = players?.[name] || {};
      return `${index + 1}. ${name} R:${Number(p.redsPotted || 0)} F:${Number(p.fouls || 0)} Q:${Number(p.qualifiedCount || 0)} D:${Number(p.deadCount || 0)}`;
    })
    .join(" | ");

  const qualifierLine = (qualifierOrder || []).length
    ? qualifierOrder.map((name, index) => `${index + 1}. ${name}`).join(", ")
    : "—";

  const nextGameOrderLine = (nextGameOrder || []).length
  ? nextGameOrder.map((name, index) => `${index + 1}. ${name}`).join(", ")
  : "—";

const settlementSummary = buildKittySettlementSummary({
  state: {
    ...finalState,
    players,
  },
  order,
});

const displayRowsForCloud = buildKittyDisplayPlayerResults({
  data: {
    ...finalState,
    players,
  },
  order,
});

function findKittyCloudResultRow(playerName) {
  return (
    displayRowsForCloud.find((row) => String(row.name) === String(playerName)) || null
  );
}

function kittyPlayerTableChargeForCloud({ isWinner }) {
  const mode = settlementSummary.tableChargeMode || "handled_separately";

  if (mode === "include_split") {
    return Number(settlementSummary.perPlayerTableCharge || 0);
  }

  if (mode === "paid_by_winner") {
    return isWinner ? Number(settlementSummary.winnerTableCharge || 0) : 0;
  }

  return 0;
}

const tableChargeTextForCloud = kittySettlementTableChargeText(settlementSummary);

const payload = (order || []).map((name, index) => {
    const p = players?.[name] || {};
    const isWinner = String(finalState.winner || "") === String(name);
    const isQualified = Number(p.qualifiedCount || 0) > 0 || Boolean(p.secretTokenActive);
    const isOut = isPlayerOutOfGame(p, finalState);
    const status = isWinner
      ? "winner"
      : isOut
      ? "out"
      : isQualified
      ? "qualified"
      : finalState.noWinner
      ? "no_winner"
      : "played";

    return {
      id: `${finalState.gameId || makeId("kitty_game")}_${String(name || "").trim().toUpperCase()}`,
      game_id: finalState.gameId || "",
      game_no: finalState.gameNo || "",
      kitty_no: Number(finalState.kittyNo || 1),
      kitty_label: `${ordinalShort(finalState.kittyNo || 1)} Kitty`,

      table_key: tableKey || "table1",
      table_name: finalState.tableName || tableLabel || "Snooker Table 1",
      game_type: finalState.gameType || "snooker",
      base_target: Number(finalState.baseTarget || 3),

      played_at: savedAt.toISOString(),
      month_key: monthKeyValue,

      player_name: name,
      phone: normalizeKittyPhone(playerPhones[kittyPlayerKey(name)] || ""),
serial_order: index + 1,

      token: "",
handicap_balls: Number(p.handicapBalls || 0),
required_balls: Number(p.requiredBalls || finalState.baseTarget || 3),
reds_potted: Number(p.redsPotted || 0),
      fouls: Number(p.fouls || 0),
      qualified_count: Number(p.qualifiedCount || 0),
      qualifier_rank: Number(p.qualifierRank || 0),
      dead_count: Number(p.deadCount || 0),

      status,
      is_winner: isWinner,
      is_qualified: isQualified,
      is_out: isOut,

      result: finalState.winner ? "WINNER DECLARED" : finalState.noWinner ? "NO WINNER" : "UNFINISHED",
      winner: finalState.winner || "",

      started_at: finalState.startedAt || "",
      ended_at: finalState.endedAt || "",
      duration: finalState.duration || "",

      players_line: playersLine,
      qualifier_line: qualifierLine,
            next_game_order_line: nextGameOrderLine,

      kitty_entry: Number(settlementSummary.kittyEntry || 0),
      out_penalty: Number(settlementSummary.outPenalty || 0),
      kitty_add_on: Number(settlementSummary.totalKittyAddOnPerPlayer || 0),
      kitty_add_ons: Array.isArray(settlementSummary.kittyAddOns)
        ? settlementSummary.kittyAddOns.join(" + ")
        : "",

      ball_out_payable: Number(settlementSummary.ballOutPayable || 0),
      not_out_payable: Number(settlementSummary.notOutPayable || 0),

      player_result: Number(findKittyCloudResultRow(name)?.resultValue || 0),
      kitty_points_won: isWinner ? Number(settlementSummary.grossKittyPoints || 0) : 0,
      gross_kitty_points: Number(settlementSummary.grossKittyPoints || 0),
      winner_net_kitty_points: Number(settlementSummary.winnerNetKittyPoints || 0),

      table_charge_mode: settlementSummary.tableChargeMode || "handled_separately",
      table_rate_per_hour: Number(settlementSummary.tableRatePerHour || 0),
      table_minutes: Number(settlementSummary.totalTableMinutes || 0),
      billable_table_minutes: Number(settlementSummary.roundedTableMinutes || 0),
      table_charge_total: Number(settlementSummary.roundedTableCharge || 0),
      player_table_charge: kittyPlayerTableChargeForCloud({ isWinner }),
      table_charge_text: tableChargeTextForCloud,

      remarks: playerStatusText(p, finalState.baseTarget),
    };
  });

  const { error } = await supabase.from("kitty_player_results").insert(payload);

  if (error) {
    console.error("Kitty cloud save failed:", error);
    alert(`Kitty final locked locally, but cloud save failed: ${error.message || "Unknown error"}`);
    return false;
  }

  return true;
}
function buildFinalKittyRecord({
  state,
  order,
  players,
  logs,
  qualifierOrder,
  nextGameOrder,
}) {
  const settlementSummary = buildKittySettlementSummary({
  state: {
    ...state,
    players,
  },
  order,
});

  return {
    id: makeId("kitty_final_record"),
    savedAt: nowText(),
    savedAtMs: Date.now(),

    gameNo: state.gameNo,
    kittyNo: state.kittyNo,
    kittyLabel: `${ordinalShort(state.kittyNo || 1)} Kitty`,
    tableName: state.tableName,
    gameType: state.gameType,
    baseTarget: state.baseTarget,

// Kitty settlement settings
kittyEntry: Number(state.kittyEntry || 0),
outPenalty: Number(state.outPenalty || 0),
kittyAddOn: Number(state.kittyAddOn || 0),
kittyAddOns: Array.isArray(state.kittyAddOns) ? state.kittyAddOns : [],
tableChargeMode: state.tableChargeMode || "handled_separately",
tableRatePerHour: Number(state.tableRatePerHour || 0),
tableManualCharge: Number(state.tableManualCharge || 0),
tableRoundingMode: state.tableRoundingMode || "round_up",
settlementSummary,

result: state.winner ? "WINNER DECLARED" : state.noWinner ? "NO WINNER" : "UNFINISHED",
    winner: state.winner || "",
    finalLocked: Boolean(state.locked),

    startedAt: state.startedAt || "",
    endedAt: state.endedAt || "",
    duration: state.duration || "",

    redsOnTable: state.redsOnTable,
tokenBallsLeft: state.tokenBallsLeft ?? 6,
extraRedsAllowed: state.extraRedsAllowed,
    extraRedsPlaced: state.extraRedsPlaced,
    extraRedInfo: kittyExtraRedInfo(state, players, logs),

    serialOrder: [...(order || [])],
    qualifierOrder: [...(qualifierOrder || [])],
    nextGameOrder: [...(nextGameOrder || [])],

    players: JSON.parse(JSON.stringify(players || {})),
    logs: JSON.parse(JSON.stringify(logs || [])),
    previousKittyResults: JSON.parse(JSON.stringify(state.previousKittyResults || [])),

    disputeNote:
      "This record was automatically saved by the system after Final Lock. It contains serial order, player states, fouls, reds, qualifiers, dead declarations, extra-red placement, result, and audit log.",
  };
}

function makeId(prefix = "kitty") {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function gameNo() {
  const y = new Date().getFullYear();
  return `KT-${y}-${String(Date.now()).slice(-5)}`;
}

function nowText() {
  return new Date().toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  });
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
function minutesBetweenNumber(startText, endText) {
  const start = new Date(startText);
  const end = new Date(endText);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 0;

  return Math.max(0, Math.round((end.getTime() - start.getTime()) / 60000));
}

function roundKittyTableMinutes(minutes, mode = "round_up") {
  const value = Math.max(0, Number(minutes || 0));
  if (!value) return 0;

  if (mode === "nearest") {
    return Math.round(value / 5) * 5;
  }

  return Math.ceil(value / 5) * 5;
}

function roundKittyTableFee(amount, mode = "round_up") {
  const value = Math.max(0, Number(amount || 0));
  if (!value) return 0;

  const rounded =
    mode === "nearest"
      ? Math.round(value / 50) * 50
      : Math.ceil(value / 50) * 50;

  // Minimum payable table charge is ₹100 whenever table charge is applicable.
  return Math.max(100, rounded);
}
function isPoolKittyGame(gameType) {
  const type = String(gameType || "").toLowerCase();
  return type === "pool" || type === "pool_american" || type.includes("pool");
}

function kittyDefaultRedsOnTable(gameType) {
  return isPoolKittyGame(gameType) ? 9 : 15;
}

function kittyGameTypeTextFromValue(gameType) {
  const type = String(gameType || "").toLowerCase();

  if (type === "snooker_ronnie_12x6") return "Ronnie's Table 12x6";
  if (type === "snooker_mini_10x5") return "Mini Snooker Table 10x5";
  if (type === "pool_american" || type === "pool") return "American Pool Table";
  if (type === "snooker_extra_12x6") return "Snooker Table 12x6";

  return isPoolKittyGame(type) ? "American Pool Table" : "Snooker Table";
}

function getKittyTableRate(gameType, tableLabel = "", tableKey = "") {
  const type = String(gameType || "").toLowerCase();
  const label = `${tableLabel || ""} ${tableKey || ""}`.toLowerCase();

  if (type === "pool_american" || type === "pool" || label.includes("pool")) return 400;
  if (type === "snooker_mini_10x5" || label.includes("mini") || label.includes("10x5")) return 500;

  return 600;
}
function validateKittySettlementBeforeStart(state) {
  const entryRaw = String(state?.kittyEntry ?? "").trim();
  const penaltyRaw = String(state?.outPenalty ?? "").trim();

  const entry = Number(entryRaw);
  const penalty = Number(penaltyRaw);

  if (!entryRaw || !Number.isFinite(entry) || entry <= 0) {
    return "Enter Kitty Entry first. Kitty Entry must be a non-zero number.";
  }

  if (penaltyRaw === "" || !Number.isFinite(penalty) || penalty < 0) {
    return "Enter Out Penalty first. Out Penalty can be 0, but it cannot be blank.";
  }

  return "";
}
function buildKittySettlementSummary({ state, order }) {
  const playerCount = Array.isArray(order) ? order.filter(Boolean).length : 0;
  const kittyNo = Math.max(1, Number(state?.kittyNo || 1));

  const kittyEntry = Math.max(0, Number(state?.kittyEntry || 0));
  const outPenalty = Math.max(0, Number(state?.outPenalty || 0));

  const kittyAddOns = Array.isArray(state?.kittyAddOns)
    ? state.kittyAddOns.map((value) => Math.max(0, Number(value || 0)))
    : [];

  const totalKittyAddOnPerPlayer = kittyAddOns.reduce((sum, value) => sum + value, 0);
  const kittyAddOn = totalKittyAddOnPerPlayer;
  const noWinnerRoundsBeforeFinal = Math.max(0, kittyAddOns.length || kittyNo - 1);

   const winnerName = String(state?.winner || "").trim();

  const playerRows = (order || []).map((name) => {
    const p = state?.players?.[name] || {};
    const isWinner = winnerName && String(name) === winnerName;

        const isOut = !isWinner && isPlayerOutOfGame(p, state);
    return {
      name,
      isWinner,
      isOut,
    };
  });

  const outPlayersCount = state?.winner
    ? playerRows.filter((row) => row.isOut).length
    : 0;

  const notOutLosersCount = state?.winner
    ? playerRows.filter((row) => !row.isWinner && !row.isOut).length
    : 0;

  const ballOutPayable = outPenalty + totalKittyAddOnPerPlayer;
  const notOutPayable = kittyEntry + totalKittyAddOnPerPlayer;

  const outPenaltyTotal = outPlayersCount * ballOutPayable;
  const notOutLosersTotal = notOutLosersCount * notOutPayable;

  const winnerOwnEntryAndAddOn = state?.winner
    ? kittyEntry + totalKittyAddOnPerPlayer
    : 0;

  const addOnPot = playerCount * totalKittyAddOnPerPlayer;

  // Example: Entry 300, Ball Out Penalty 500, Add-on 200.
  // Ball-out loser pays 500 + 200 = 700.
  // Not-out loser pays 300 + 200 = 500.
  // Winner net = total received from losing players.
  const winnerNetKittyPoints = state?.winner
    ? outPenaltyTotal + notOutLosersTotal
    : 0;

  const grossKittyPoints = state?.winner
    ? winnerOwnEntryAndAddOn + winnerNetKittyPoints
    : 0;

  const basePot = playerCount * kittyEntry;

  const tableChargeMode = state?.tableChargeMode || "handled_separately";
  const tableRatePerHour = Math.max(0, Number(state?.tableRatePerHour || 0));
  const tableRoundingMode = state?.tableRoundingMode || "round_up";

  const roundHistory = Array.isArray(state?.kittyRoundHistory)
    ? state.kittyRoundHistory
    : [];

  const carriedTableMinutes = roundHistory.reduce(
    (sum, round) => sum + Math.max(0, Number(round?.durationMinutes || 0)),
    0
  );

  const currentRoundMinutes = minutesBetweenNumber(
    state?.startedAt || state?.createdAt,
    state?.endedAt || new Date().toISOString()
  );

  const totalTableMinutes = carriedTableMinutes + currentRoundMinutes;
  const roundedTableMinutes = roundKittyTableMinutes(totalTableMinutes, tableRoundingMode);

  const manualTableCharge = Math.max(0, Number(state?.tableManualCharge || 0));

  const rawTableCharge =
    tableChargeMode === "manual"
      ? manualTableCharge
      : tableRatePerHour > 0
      ? (tableRatePerHour * roundedTableMinutes) / 60
      : 0;

  const roundedTableCharge =
  tableChargeMode === "manual"
    ? manualTableCharge > 0
      ? Math.max(100, manualTableCharge)
      : 0
    : roundKittyTableFee(rawTableCharge, tableRoundingMode);

  const perPlayerTableCharge =
    playerCount > 0 && tableChargeMode === "include_split"
      ? roundKittyTableFee(roundedTableCharge / playerCount, tableRoundingMode)
      : 0;

  const winnerTableCharge =
    state?.winner && tableChargeMode === "paid_by_winner"
      ? roundedTableCharge
      : 0;

  return {
    playerCount,
    kittyNo,
    noWinnerRoundsBeforeFinal,

    kittyEntry,
    outPenalty,
    kittyAddOn,
    kittyAddOns,
    totalKittyAddOnPerPlayer,

        basePot,
    outPlayersCount,
    notOutLosersCount,
    ballOutPayable,
    notOutPayable,
    outPenaltyTotal,
    notOutLosersTotal,
    addOnPot,
    grossKittyPoints,
    winnerOwnEntryAndAddOn,
    winnerNetKittyPoints,

    tableChargeMode,
    tableRatePerHour,
    tableRoundingMode,
    roundHistory,
    carriedTableMinutes,
    currentRoundMinutes,
    totalTableMinutes,
    roundedTableMinutes,
    manualTableCharge,
    rawTableCharge,
    roundedTableCharge,
    perPlayerTableCharge,
    winnerTableCharge,
  };
}
function kittySettlementTableChargeText(summary) {
  if (!summary) return "—";

  if (summary.tableChargeMode === "hide") return "Hidden from player result";
  if (summary.tableChargeMode === "handled_separately") return "Handled separately / prepaid";
  if (summary.tableChargeMode === "show_only") {
    return `Shown only: ₹${Number(summary.roundedTableCharge || 0)}`;
  }
  if (summary.tableChargeMode === "paid_by_winner") {
    return `Paid by winner: ₹${Number(summary.winnerTableCharge || 0)}`;
  }
  if (summary.tableChargeMode === "include_split") {
    return `Split equally: ₹${Number(summary.roundedTableCharge || 0)} total / ₹${Number(
      summary.perPlayerTableCharge || 0
    )} each`;
  }
  if (summary.tableChargeMode === "manual") {
    return `Manual: ₹${Number(summary.roundedTableCharge || 0)}`;
  }

  return "Handled separately / prepaid";
}

function buildKittySettlementHtml(summary) {
  if (!summary) return "";

  return `
    <div class="section">
      <div class="sectionTitle">KITTY SETTLEMENT</div>
      <div class="pad">
        <table>
          <tbody>
            <tr>
              <td><b>Kitty Entry</b></td>
              <td>${esc(summary.kittyEntry)}</td>
              <td><b>Out Penalty</b></td>
              <td>${esc(summary.outPenalty)}</td>
            </tr>
            <tr>
              <td><b>Out Players</b></td>
              <td>${esc(summary.outPlayersCount)}</td>
              <td><b>Out Penalty Total</b></td>
              <td>${esc(summary.outPenaltyTotal)}</td>
            </tr>
            <tr>
              <td><b>Kitty Add-on</b></td>
              <td>${esc(
                Array.isArray(summary.kittyAddOns) && summary.kittyAddOns.length
                  ? summary.kittyAddOns.join(" + ")
                  : "None"
              )}</td>
              <td><b>Add-on Total / Player</b></td>
              <td>${esc(summary.totalKittyAddOnPerPlayer)}</td>
            </tr>
            <tr>
              <td><b>Kitty Points Won</b></td>
              <td>${esc(summary.grossKittyPoints)}</td>
              <td><b>Winner Net Kitty Points</b></td>
              <td>${esc(summary.winnerNetKittyPoints)}</td>
            </tr>
            <tr>
              <td><b>Table Time</b></td>
              <td>${esc(summary.totalTableMinutes)} min</td>
              <td><b>Billable Time</b></td>
              <td>${esc(summary.roundedTableMinutes)} min</td>
            </tr>
            <tr>
              <td><b>Table Charge</b></td>
              <td colspan="3">${esc(kittySettlementTableChargeText(summary))}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  `;
}
function buildKittyDisplayPlayerResults({ data, order }) {
  const summary = buildKittySettlementSummary({
    state: data,
    order: order || [],
  });

  const winnerName = String(data?.winner || "").trim();

  return (order || [])
    .map((name) => {
      const p = data?.players?.[name] || {};
      const isWinner = winnerName && String(name) === winnerName;
      const isOut = !isWinner && isPlayerOutOfGame(p, data);

      let resultValue = 0;
      let resultLabel = "—";
      let resultNote = "Playing";

      if (isWinner) {
        resultValue = Number(summary.winnerNetKittyPoints || 0);
        resultLabel = `+${resultValue}`;
        resultNote = "Winner net";
      } else if (winnerName && isOut) {
        resultValue = -Number(summary.ballOutPayable || 0);
        resultLabel = String(resultValue);
        resultNote = `${summary.outPenalty} + ${summary.totalKittyAddOnPerPlayer || 0}`;
      } else if (winnerName) {
        resultValue = -Number(summary.notOutPayable || 0);
        resultLabel = String(resultValue);
        resultNote = `${summary.kittyEntry} + ${summary.totalKittyAddOnPerPlayer || 0}`;
      }

      return {
        name,
        player: p,
        isWinner,
        isOut,
        resultValue,
        resultLabel,
        resultNote,
        status: isWinner ? "WINNER" : isOut ? "BALL OUT" : winnerName ? "NOT OUT" : "PLAYING",
      };
    })
    .sort((a, b) => {
      if (a.isWinner && !b.isWinner) return -1;
      if (!a.isWinner && b.isWinner) return 1;
      return 0;
    });
}

function kittyRoundDisplayText(data) {
  const kittyNo = Math.max(1, Number(data?.kittyNo || 1));
  const historyCount = Array.isArray(data?.kittyRoundHistory)
    ? data.kittyRoundHistory.length
    : 0;

  const kittyRoundNumber = historyCount || Math.max(0, kittyNo - 1);

  if (kittyRoundNumber <= 0) return "First Normal Game";

  return `${ordinalShort(kittyRoundNumber)} Kitty / ${ordinalShort(kittyRoundNumber + 1)} Running Game`;
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

function cleanName(value) {
  return String(value || "").trim().toUpperCase();
}
function normalizeKittyPhone(value = "") {
  const digits = String(value || "").replace(/\D/g, "");

  if (!digits) return "";
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;

  return digits;
}

function kittyPlayerKey(value) {
  return String(value || "").trim().toUpperCase();
}

function loadQClubPlayerPhonebook() {
  try {
    const raw = localStorage.getItem(QCLUB_PLAYER_PHONEBOOK_KEY);
    const book = raw ? JSON.parse(raw) : {};
    return book && typeof book === "object" && !Array.isArray(book) ? book : {};
  } catch {
    return {};
  }
}

function saveQClubPlayerPhonebook(book) {
  try {
    localStorage.setItem(QCLUB_PLAYER_PHONEBOOK_KEY, JSON.stringify(book || {}));
  } catch {}
}

function kittyHandicapBalls(value) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return 0;
  return Math.max(0, Math.floor(num));
}

function kittyRequiredBalls(baseTarget, handicapValue) {
  const base = Math.max(1, Number(baseTarget || 3));
  const handicap = kittyHandicapBalls(handicapValue);
  return Math.max(1, base - handicap);
}

function kittyNeedReasonsForPlayer(baseTarget, handicapValue) {
  return baseNeedReasons(kittyRequiredBalls(baseTarget, handicapValue));
}

function defaultPlayerState(name) {
  return {
    name,
    redsPotted: 0,
    fouls: 0,

    // Red balls still required in current cycle.
    // "" = normal/base red
    // "F" = red added because of foul
    // "D" = red added because of Dead declaration
    needReasons: [],

    currentNeed: 0,
    cycleReds: 0,

    qualifiedCount: 0,
    qualifierRank: 0,
    deadCount: 0,

    secretTokenActive: false,
    foulClearanceActive: false,

    won: false,
    eliminated: false,
    firstQualifiedAt: 0,
    notes: "",
  };
}

function ordinal(n) {
  const num = Number(n || 0);
  if (!num) return "";
  if (num === 1) return "FIRST";
  if (num === 2) return "SECOND";
  if (num === 3) return "THIRD";
  if (num === 4) return "FOURTH";
  if (num === 5) return "FIFTH";
  if (num === 6) return "SIXTH";
  if (num === 7) return "SEVENTH";
  if (num === 8) return "EIGHTH";
  if (num === 9) return "NINTH";
  if (num === 10) return "TENTH";
  return `${num}TH`;
}

function ordinalShort(n) {
  const num = Number(n || 0);
  if (num % 100 >= 11 && num % 100 <= 13) return `${num}th`;
  if (num % 10 === 1) return `${num}st`;
  if (num % 10 === 2) return `${num}nd`;
  if (num % 10 === 3) return `${num}rd`;
  return `${num}th`;
}

function baseNeedReasons(baseTarget) {
  return Array.from({ length: Math.max(1, Number(baseTarget || 3)) }, () => "");
}

function remainingNeedReasons(player, baseTarget) {
  const reasons = Array.isArray(player?.needReasons) && player.needReasons.length
    ? player.needReasons
    : baseNeedReasons(baseTarget);

  return reasons.slice(Number(player?.cycleReds || 0));
}

function playerStatusText(player, baseTarget) {
  if (!player) return "—";
  if (player.won) return "WINNER";

  if (player.secretTokenActive && !player.foulClearanceActive) {
    return `${ordinal(player.qualifierRank || player.qualifiedCount)} QUALIFIER`;
  }

  const remaining = remainingNeedReasons(player, baseTarget).length;

  if (player.foulClearanceActive) {
    return `CLEAR FOUL: ${remaining} red needed`;
  }

  return `${remaining} red needed to qualify`;
}
function kittyExtraRedInfo(state, players = {}, logs = []) {
  const allowed = Number(state?.extraRedsAllowed || 0);
  const placed = Number(state?.extraRedsPlaced || 0);
  const pendingByLimit = Math.max(0, allowed - placed);

  const startingReds =
  Number(state?.startingRedsOnTable || 0) ||
  kittyDefaultRedsOnTable(state?.gameType);

const totalRedsRemovedFromTable = Math.max(
  0,
  startingReds + placed - Number(state?.redsOnTable || 0)
);

const totalRedsPotted = totalRedsRemovedFromTable;

const earnedPlacementCredit = Math.max(0, totalRedsRemovedFromTable - placed);
  const maxByBallsPotted = Math.min(pendingByLimit, earnedPlacementCredit);

  const lastLog = Array.isArray(logs) && logs.length ? logs[logs.length - 1] : null;
  const lastAction = String(lastLog?.action || "");

  const allowedByRule =
    lastAction.includes("QUALIFIER") ||
    Number(state?.redsOnTable || 0) <= 2;

  const placeableNow = allowedByRule ? maxByBallsPotted : 0;

  return {
    allowed,
    placed,
    pending: pendingByLimit,
    totalRedsPotted,
    earnedPlacementCredit,
    maxByBallsPotted,
    allowedByRule,
    placeableNow,
    ruleText:
      "Extra reds may be placed only after every qualifier or when only last 2 reds/non-token balls are left. The number placed cannot exceed reds/non-token balls already potted.",
  };
}
function playerRedNeedCount(player, baseTarget) {
  if (!player) return 0;
  if (player.won) return 0;

  // Qualified player with active token is not waiting for reds,
  // unless he has a pending foul clearance.
  if (player.secretTokenActive && !player.foulClearanceActive) return 0;

  return remainingNeedReasons(player, baseTarget).length;
}
function noWinnerAllowed(state) {
  const redsOnTable = Number(state?.redsOnTable || 0);
  const tokenBallsLeft = Number(state?.tokenBallsLeft ?? 6);
  const extraAllowed = Number(state?.extraRedsAllowed || 0);
  const extraPlaced = Number(state?.extraRedsPlaced || 0);
  const pendingExtra = Math.max(0, extraAllowed - extraPlaced);

  // No Winner is valid if:
  // 1. no reds/non-token balls are left and no extra reds are pending, OR
  // 2. all token/colour balls are gone, because nobody can legally win.
  return (redsOnTable <= 0 && pendingExtra <= 0) || tokenBallsLeft <= 0;
}

function canStartSameOrderGame(state) {
  // Same order continuation should happen only after No Winner was declared.
  return Boolean(state?.noWinner) && !state?.winner && !state?.locked;
}

function canStartCalculatedOrderGame(state) {
  // Calculated order after a winner should happen only after final lock.
  return Boolean(state?.winner) && Boolean(state?.locked);
}
function availableFutureReds(state) {
  const redsOnTable = Number(state?.redsOnTable || 0);
  const extraAllowed = Number(state?.extraRedsAllowed || 0);
  const extraPlaced = Number(state?.extraRedsPlaced || 0);
  const pendingExtra = Math.max(0, extraAllowed - extraPlaced);

  // If extra reds are still pending, player is still alive.
  return redsOnTable + pendingExtra;
}

function isPlayerOutOfGame(player, state) {
  if (!player) return false;
  if (player.won) return false;
  if (player.eliminated) return true;

  const need = playerRedNeedCount(player, state?.baseTarget || 3);
  if (need <= 0) return false;

  return need > availableFutureReds(state);
}

function nextPlayableIndexFrom(startIndex, direction, order, players, state) {
  if (!Array.isArray(order) || !order.length) return 0;

  for (let step = 1; step <= order.length; step += 1) {
    const idx = (startIndex + direction * step + order.length) % order.length;
    const name = order[idx];
    const p = players?.[name];

    if (!isPlayerOutOfGame(p, state)) {
      return idx;
    }
  }

  return startIndex;
}

function renderNeedBalls(player, baseTarget, options = {}) {
  const remaining = remainingNeedReasons(player, baseTarget);
  const stateForOutCheck = options.state || null;

if (stateForOutCheck && isPlayerOutOfGame(player, stateForOutCheck)) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "6px 12px",
        borderRadius: 999,
        fontWeight: 900,
        fontSize: Number(options.fontSize || 12),
        lineHeight: 1.1,
        whiteSpace: "nowrap",
        background: "linear-gradient(135deg, #555, #222)",
        color: "#fff",
        border: "1px solid rgba(255,255,255,.25)",
      }}
    >
      OUT OF GAME
    </span>
  );
}
  const size = Number(options.size || 24);
  const gap = Number(options.gap || 5);
  const fontSize = Number(options.fontSize || 12);

  const pillStyle = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    padding: "6px 12px",
    borderRadius: 999,
    fontWeight: 900,
    fontSize: fontSize,
    lineHeight: 1.1,
    whiteSpace: "nowrap",
  };

  if (player?.won) {
    return (
      <span
        style={{
          ...pillStyle,
          background: "linear-gradient(135deg, #19c37d, #0ea765)",
          color: "#04150e",
        }}
      >
        WINNER
      </span>
    );
  }

  if (player?.secretTokenActive && !player?.foulClearanceActive) {
    return (
      <span
        style={{
          ...pillStyle,
          background: "linear-gradient(135deg, #f6d365, #fda085)",
          color: "#231300",
        }}
      >
        {ordinal(player.qualifierRank || player.qualifiedCount)} QUALIFIER
      </span>
    );
  }

  return (
    <div style={{ display: "flex", gap, flexWrap: "wrap", alignItems: "center" }}>
      {remaining.map((reason, idx) => (
        <span
          key={`${reason}_${idx}`}
          title={reason === "F" ? "Foul added red" : reason === "D" ? "Dead declaration red" : "Required red"}
          style={{
            width: size,
            height: size,
            borderRadius: "50%",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#d60000",
            color: "#fff",
            fontWeight: 900,
            fontSize,
            boxShadow: "inset 0 0 0 2px rgba(255,255,255,.22)",
          }}
        >
          {reason || ""}
        </span>
      ))}
    </div>
  );
}

function buildA4Html({ state, order, players, logs, winner, nextOrder }) {
    const displayRowsForReport = buildKittyDisplayPlayerResults({
    data: { ...state, players },
    order,
  });

  const playerRows = displayRowsForReport
    .map((row, index) => {
      const p = players[row.name] || defaultPlayerState(row.name);
      return `
        <tr>
          <td>${index + 1}</td>
          <td><b>${esc(row.name)}</b></td>
          <td>${esc(p.redsPotted)}</td>
          <td>${esc(p.fouls)}</td>
          <td>${esc(p.qualifiedCount)}</td>
          <td>${esc(p.deadCount)}</td>
          <td>${esc(row.status || playerStatusText(p, state.baseTarget))}</td>
          <td><b>${esc(row.resultLabel || "—")}</b></td>
        </tr>
      `;
    })
    .join("");

  const logRows = logs
    .slice(-80)
    .map(
      (l, idx) => `
        <tr>
          <td>${idx + 1}</td>
          <td>${esc(l.time)}</td>
          <td><b>${esc(l.name || "SYSTEM")}</b></td>
          <td>${esc(l.action)}</td>
          <td>${esc(l.detail || "")}</td>
        </tr>`
    )
    .join("");

  const nextRows = nextOrder
    .map((name, index) => `<div class="orderCell">${index + 1}<b>${esc(name)}</b></div>`)
    .join("");
      const previousResultRows = (state.previousKittyResults || [])
    .map(
      (g, index) => `
        <tr>
          <td>${index + 1}</td>
          <td><b>${esc(g.label || `${ordinalShort(g.kittyNo)} Kitty`)}</b></td>
          <td>${esc(g.gameNo || "—")}</td>
          <td><b>${esc(g.result || "NO WINNER")}</b></td>
          <td>${esc((g.order || []).join(" → "))}</td>
        </tr>
      `
    )
    .join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(state.gameNo)} - Kitty A4</title>
<style>
  @page { size: A4 portrait; margin: 8mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, sans-serif; color: #111; background: #fff; font-size: 11px; }
  .top { display: grid; grid-template-columns: 120px 1fr 150px; gap: 10px; align-items: center; border-bottom: 2px solid #65001d; padding-bottom: 6px; }
  .logo { border: 2px solid #65001d; border-radius: 14px; padding: 10px; text-align: center; color: #65001d; font-weight: 900; }
  .title { text-align: center; }
  .title h1 { margin: 0; font-size: 30px; color: #65001d; letter-spacing: .5px; }
  .title h2 { margin: 4px 0 0; font-size: 18px; }
  .resultBox { border: 1px solid #65001d; border-radius: 10px; overflow: hidden; text-align: center; }
  .resultBox .head { background: #65001d; color: #fff; padding: 5px; font-weight: 900; }
  .resultBox .body { padding: 8px; font-size: 13px; }
  .info { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 8px; border: 1px solid #aaa; border-radius: 8px; padding: 8px; margin-top: 8px; }
  .infoRow { display: grid; grid-template-columns: 90px 1fr; gap: 6px; margin-bottom: 4px; }
  .section { margin-top: 8px; border: 1px solid #aaa; border-radius: 8px; overflow: hidden; }
  .sectionTitle { display: inline-block; background: #65001d; color: #fff; padding: 5px 9px; font-weight: 900; font-size: 12px; }
  .pad { padding: 7px; }
  table { width: 100%; border-collapse: collapse; }
  th { background: #65001d; color: #fff; padding: 5px; border: 1px solid #888; font-size: 10px; }
  td { padding: 5px; border: 1px solid #bbb; text-align: center; vertical-align: middle; }
  .orderGrid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 0; border: 1px solid #aaa; }
  .orderCell { padding: 8px 4px; border-right: 1px solid #aaa; border-bottom: 1px solid #aaa; text-align: center; }
  .orderCell b { display: block; font-size: 13px; margin-top: 2px; }
  .rule { font-size: 10px; line-height: 1.35; }
</style>
</head>
<body>
  <div class="top">
    <div class="logo">THE Q CLUB<br/>PASIGHAT</div>
    <div class="title">
      <h1>THE Q CLUB PASIGHAT</h1>
      <h2>KITTY SCORE SHEET</h2>
    </div>
    <div class="resultBox">
      <div class="head">RESULT</div>
      <div class="body">
        <div>WINNER</div>
        <b>${esc(winner || "NO WINNER")}</b>
      </div>
    </div>
  </div>

  <div class="info">
    <div>
      <div class="infoRow"><b>Game No.</b><span>${esc(state.gameNo)}</span></div>
      <div class="infoRow"><b>Table</b><span>${esc(state.tableName)}</span></div>
      <div class="infoRow"><b>Type</b><span>${esc(kittyGameTypeTextFromValue(state.gameType))}</span></div>
    </div>
    <div>
      <div class="infoRow"><b>Base Target</b><span>${esc(state.baseTarget)} reds</span></div>
      <div class="infoRow"><b>Players</b><span>${esc(order.length)}</span></div>
      <div class="infoRow"><b>Status</b><span>${state.locked ? "FINAL LOCKED" : "DRAFT"}</span></div>
    </div>
    <div>
      <div class="infoRow"><b>Start</b><span>${esc(state.startedAt || "—")}</span></div>
      <div class="infoRow"><b>End</b><span>${esc(state.endedAt || "—")}</span></div>
      <div class="infoRow"><b>Duration</b><span>${esc(state.duration || "—")}</span></div>
    </div>
  </div>

  <div class="section">
    <div class="sectionTitle">1. SERIAL ORDER DRAW</div>
    <div class="pad">
      <div class="orderGrid">
        ${order
          .map((name, index) => `<div class="orderCell">${index + 1}<b>${esc(name)}</b></div>`)
          .join("")}
      </div>
    </div>
  </div>

  <div class="section">
    <div class="sectionTitle">2. PLAYER SUMMARY</div>
    <div class="pad">
      <table>
        <thead>
          <tr>
            <th>Order</th>
            <th>Player</th>
            <th>Reds Potted</th>
            <th>Fouls</th>
            <th>Qualifications</th>
            <th>Dead Declared</th>
            <th>Status</th>
            <th>Kitty Result</th>
          </tr>
        </thead>
        <tbody>${playerRows}</tbody>
      </table>
    </div>
  </div>
  ${buildKittySettlementHtml(
  buildKittySettlementSummary({
    state: {
      ...state,
      players,
    },
    order,
  })
)}
  <div class="section">
    <div class="sectionTitle">3. NEXT GAME ORDER</div>
    <div class="pad">
      <div class="orderGrid">${nextRows || "—"}</div>
    </div>
  </div>
    ${
    previousResultRows
      ? `<div class="section">
          <div class="sectionTitle">4. PREVIOUS KITTY RESULTS</div>
          <div class="pad">
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Kitty</th>
                  <th>Game No.</th>
                  <th>Result</th>
                  <th>Order</th>
                </tr>
              </thead>
              <tbody>${previousResultRows}</tbody>
            </table>
          </div>
        </div>`
      : ""
  }

  <div class="section">
    <div class="sectionTitle">4. AUDIT LOG</div>
    <div class="pad">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Time</th>
            <th>Player</th>
            <th>Action</th>
            <th>Detail</th>
          </tr>
        </thead>
        <tbody>${logRows}</tbody>
      </table>
    </div>
  </div>

  <div class="section">
    <div class="sectionTitle">RULE NOTE</div>
    <div class="pad rule">
      Players draw serial tokens before game. Players decide red qualification target before start.
      Each foul adds one red requirement. After qualification, token is secret. If player fouls while
      attempting secret token, he must pot one red to clear foul and may continue with same secret token.
      Dead declaration is optional. After declaring Dead, player must pot one red to draw another token.
      For Pool Kitty, token balls are 10 to 15 and all other balls are treated like red balls.
    </div>
  </div>
</body>
</html>`;
}

function build80Html({ state, order, players, winner, nextOrder }) {
    const displayRowsFor80mm = buildKittyDisplayPlayerResults({
    data: { ...state, players },
    order,
  });

  const lines = displayRowsFor80mm
    .map((row, index) => {
      const p = players[row.name] || defaultPlayerState(row.name);
      return `
        <div class="box">
          <div class="name">${index + 1}. ${esc(row.name)}</div>
          Reds: ${esc(p.redsPotted)} | Fouls: ${esc(p.fouls)}<br/>
          Qualified: ${esc(p.qualifiedCount)} | Dead: ${esc(p.deadCount)}<br/>
          Status: ${esc(row.status || playerStatusText(p, state.baseTarget))}<br/>
          Kitty Result: <b>${esc(row.resultLabel || "—")}</b>
        </div>
      `;
    })
    .join("");

  const nextLines = nextOrder
    .map((name, index) => `<div class="rank"><span>${index + 1}. ${esc(name)}</span></div>`)
    .join("");
      const previousLines = (state.previousKittyResults || [])
    .map(
      (g, index) => `
        <div class="box">
          <div class="name">${index + 1}. ${esc(g.label || `${ordinalShort(g.kittyNo)} Kitty`)}</div>
          Result: <b>${esc(g.result || "NO WINNER")}</b><br/>
          Order: ${esc((g.order || []).join(" → "))}
        </div>
      `
    )
    .join("");

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Kitty 80mm</title>
<style>
  @page { size: 80mm auto; margin: 3mm; }
  * { box-sizing: border-box; }
  body { margin: 0; width: 72mm; font-family: Arial, sans-serif; color: #000; background: #fff; font-size: 12px; }
  .center { text-align: center; }
  h1 { font-size: 17px; margin: 0; letter-spacing: .5px; }
  h2 { font-size: 14px; margin: 3px 0 4px; }
  .sub { font-size: 11px; margin-bottom: 6px; }
  hr { border: 0; border-top: 1px dashed #000; margin: 7px 0; }
  .box { border: 1px solid #000; border-radius: 6px; padding: 6px; margin-bottom: 6px; line-height: 1.35; }
  .name { font-size: 13px; font-weight: 800; margin-bottom: 3px; }
  .rank { display: flex; justify-content: space-between; border-bottom: 1px dashed #999; padding: 4px 0; font-size: 12px; }
  .rule { font-size: 10.5px; line-height: 1.35; margin-top: 8px; }
</style>
</head>
<body>
  <div class="center">
    <h1>THE Q CLUB PASIGHAT</h1>
    <h2>KITTY RESULT</h2>
    <div class="sub">${esc(state.gameNo)}</div>
  </div>

  <hr/>
  <div>Table: ${esc(state.tableName)}</div>
  <div>Type: ${esc(kittyGameTypeTextFromValue(state.gameType))}</div>
  <div>Base Target: ${esc(state.baseTarget)} reds</div>
  <div>Winner: <b>${esc(winner || "NO WINNER")}</b></div>
  <hr/>
    ${(() => {
    const summary = buildKittySettlementSummary({
  state: {
    ...state,
    players,
  },
  order,
});
    return `
      <div class="box">
        <div class="name">KITTY SETTLEMENT</div>
        Entry: ${esc(summary.kittyEntry)}<br/>
        Out Penalty: ${esc(summary.outPenalty)}<br/>
        Out Players: ${esc(summary.outPlayersCount)}<br/>
        Kitty Points Won: ${esc(summary.grossKittyPoints)}<br/>
        Net Kitty Points: ${esc(summary.winnerNetKittyPoints)}<br/>
        Table: ${esc(kittySettlementTableChargeText(summary))}
      </div>
    `;
  })()}

  ${lines}
    ${
    previousLines
      ? `<hr/>
         <b>PREVIOUS KITTY RESULTS</b>
         ${previousLines}`
      : ""
  }

  <hr/>
  <b>NEXT GAME ORDER</b>
  ${nextLines || "—"}

  <hr/>
  <div class="rule">
    Secret token game. Dead declaration optional. Foul after secret token = clear by potting 1 red.
  </div>

  <hr/>
  <div class="center">
    Generated by<br/>
    THE Q CLUB PASIGHAT
  </div>
</body>
</html>`;
}
function kittyCloudDateText(value) {
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

function kittyCloudSearchText(record = {}) {
  return [
    record.game_no,
    record.game_id,
    record.kitty_label,
    record.table_key,
    record.table_name,
    record.game_type,
    record.month_key,
    record.player_name,
    record.phone,
    record.serial_order,
    record.status,
    record.result,
    record.winner,
    record.players_line,
    record.qualifier_line,
    record.next_game_order_line,
    record.remarks,
    record.played_at,
  ]
    .join(" ")
    .toLowerCase();
}

function kittyCloudPlayerKey(record = {}) {
  const phone = String(record.phone || "").trim();
  const name = String(record.player_name || "").trim().toUpperCase();
  return phone || name || "UNKNOWN";
}

function kittyNum(value) {
  return Number(value || 0);
}
function buildKittyMonthlyPlayers(records = [], selectedMonth = "") {
  const map = new Map();

  (records || []).forEach((record) => {
    const key = kittyCloudPlayerKey(record);

    if (!map.has(key)) {
      map.set(key, {
  key,
  playerName: record.player_name || "—",
  phone: record.phone || "",
  monthKey: selectedMonth || record.month_key || "",
  gamesPlayed: 0,
  timesWinner: 0,
  timesBallOut: 0,

  totalKittyEntry: 0,
  totalOutPenalty: 0,
  totalKittyAddOn: 0,

  kittyPointsWon: 0,
  netKittyResult: 0,
  tableCharges: 0,
  lastPlayedAt: record.played_at || "",
});
    }

    const row = map.get(key);

    row.gamesPlayed += 1;
    row.timesWinner += record.is_winner ? 1 : 0;
    row.timesBallOut += record.is_out ? 1 : 0;
    row.totalKittyEntry +=
  Number(record.kitty_entry || 0) ||
  Number(record.entry || 0) ||
  0;

row.totalOutPenalty += record.is_out
  ? Number(record.out_penalty || 0) || Number(record.ball_out_payable || 0) || 0
  : 0;

row.totalKittyAddOn +=
  Number(record.kitty_add_on || 0) ||
  Number(record.add_on || 0) ||
  0;

    const ownResult =
      Number(record.kitty_result || 0) ||
      Number(record.net_kitty_result || 0) ||
      Number(record.player_result || 0) ||
      0;

    row.netKittyResult += ownResult;

    if (record.is_winner) {
      row.kittyPointsWon +=
        Number(record.kitty_points_won || 0) ||
        Number(record.gross_kitty_points || 0) ||
        Number(record.winner_net_kitty_points || 0) ||
        Math.max(0, ownResult);
    }

    row.tableCharges +=
      Number(record.table_charge || 0) ||
      Number(record.table_charge_paid || 0) ||
      Number(record.player_table_charge || 0) ||
      0;

    const oldTime = Date.parse(row.lastPlayedAt || "") || 0;
    const newTime = Date.parse(record.played_at || "") || 0;
    if (newTime > oldTime) row.lastPlayedAt = record.played_at || "";
  });

  return Array.from(map.values()).sort((a, b) => {
    return (
      b.timesWinner - a.timesWinner ||
      b.netKittyResult - a.netKittyResult ||
      b.gamesPlayed - a.gamesPlayed ||
      String(a.playerName).localeCompare(String(b.playerName))
    );
  });
}

function kittyMonthlySummaryLine(player) {
  if (!player) return "—";

  const net =
    Number(player.netKittyResult || 0) > 0
      ? `+${Number(player.netKittyResult || 0)}`
      : String(Number(player.netKittyResult || 0));

  return `${player.playerName} played ${player.gamesPlayed} Kitty game(s), won ${player.timesWinner}, ball-out ${player.timesBallOut} time(s), and finished with Net Kitty Result ${net}.`;
}
function kittyMonthlyTemplateParams(player, monthText = "") {
  if (!player) return [];

  const net =
    Number(player.netKittyResult || 0) > 0
      ? `+${Number(player.netKittyResult || 0)}`
      : String(Number(player.netKittyResult || 0));

  return [
    player.playerName || "Player",                         // {{1}}
    monthText || player.monthKey || "—",                   // {{2}}
    String(Number(player.gamesPlayed || 0)),               // {{3}}
    String(Number(player.timesWinner || 0)),               // {{4}}
    String(Number(player.totalKittyEntry || 0)),           // {{5}}
    String(Number(player.totalOutPenalty || 0)),           // {{6}}
    String(Number(player.totalKittyAddOn || 0)),           // {{7}}
    String(Number(player.kittyPointsWon || 0)),            // {{8}}
    net,                                                   // {{9}}
    String(Number(player.tableCharges || 0)),              // {{10}}
    kittyMonthlySummaryLine(player),                       // {{11}}
  ];
}

function kittyMonthlyPreviewText(player, monthText = "") {
  const params = kittyMonthlyTemplateParams(player, monthText);

  return [
    `Hello ${params[0]},`,
    "",
    "Kitty Monthly Report - The Q Club Pasighat",
    "",
    `Month: ${params[1]}`,
    "",
    `Games Played: ${params[2]}`,
    `Games Won: ${params[3]}`,
    "",
    `Kitty Entry: ${params[4]}`,
    `Ball Out Penalty: ${params[5]}`,
    `Kitty Add-on: ${params[6]}`,
    "",
    `Kitty Points Won: ${params[7]}`,
    `Net Kitty Result: ${params[8]}`,
    "",
    `Table Charges: ${params[9]}`,
    "",
    "Player Summary:",
    params[10],
    "",
    "Thank you for playing at The Q Club Pasighat.",
  ].join("\n");
}

export function KittyMonthlyReportPage({
  admin,
  staffAdmin,
}) {
  const [records, setRecords] = useState([]);
  const [monthFilter, setMonthFilter] = useState("");
  const [query, setQuery] = useState("");
  const [selectedPlayerKey, setSelectedPlayerKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [monthlyWhatsappSendStatus, setMonthlyWhatsappSendStatus] = useState({});

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
        .from("kitty_player_results")
        .select("*")
        .order("played_at", { ascending: false })
        .limit(5000);

      if (error) throw error;

      setRecords(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Kitty monthly records load failed:", error);
      setLoadError(error?.message || "Could not load Kitty monthly records.");
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }
async function sendKittyMonthlyWhatsapp(player) {
  if (!player) {
    alert("No player selected.");
    return;
  }

  const phone = normalizeKittyPhone(player.phone || "");

  if (!phone) {
    alert(`Missing WhatsApp number for ${player.playerName || "player"}.`);
    return;
  }

  const key = String(player.key || player.playerName || phone);

  setMonthlyWhatsappSendStatus((prev) => ({
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
        templateName: KITTY_MONTHLY_TEMPLATE_NAME,
        templateParams: kittyMonthlyTemplateParams(player, monthFilter),
        label: "kitty_monthly_report",
        text: kittyMonthlyPreviewText(player, monthFilter),
      }),
    });

    const json = await response.json().catch(() => null);

    if (!response.ok || !json?.ok) {
      throw new Error(
        json?.error ||
          json?.message ||
          `MSG91 request failed with status ${response.status}`
      );
    }

    setMonthlyWhatsappSendStatus((prev) => ({
      ...prev,
      [key]: "sent",
    }));

    alert(`Kitty monthly report sent to ${player.playerName || "player"}.`);
  } catch (error) {
    console.error("Kitty monthly WhatsApp failed:", error);

    setMonthlyWhatsappSendStatus((prev) => ({
      ...prev,
      [key]: `failed: ${error?.message || "Unknown error"}`,
    }));

    alert(`Kitty monthly WhatsApp failed: ${error?.message || "Unknown error"}`);
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
    const list = buildKittyMonthlyPlayers(monthRecords, monthFilter);

    if (!q) return list;

    return list.filter((player) => {
      return (
        String(player.playerName || "").toLowerCase().includes(q) ||
        String(player.phone || "").toLowerCase().includes(q)
      );
    });
  }, [monthRecords, monthFilter, query]);

  const selectedPlayer =
    monthlyPlayers.find((player) => String(player.key) === String(selectedPlayerKey)) ||
    monthlyPlayers[0] ||
    null;

  useEffect(() => {
    if (!selectedPlayer) {
      setSelectedPlayerKey("");
      return;
    }

    if (!monthlyPlayers.some((player) => String(player.key) === String(selectedPlayerKey))) {
      setSelectedPlayerKey(selectedPlayer.key);
    }
  }, [monthlyPlayers, selectedPlayer, selectedPlayerKey]);

  if (!hasAccess) {
    return (
      <>
        <PageShell title="Kitty Monthly Report" subtitle="Admin access required" noNav />
        <div className="container">
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Access Denied</h2>
            <p className="muted">Kitty Monthly Report is available only for Main Admin and Staff Admin.</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageShell
        title="Kitty Monthly Report"
        subtitle="Monthly player-wise Kitty summary"
        noNav
      />

      <div className="container">
        <div className="card">
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
              gap: 12,
              alignItems: "end",
            }}
          >
            <label>
              Month
              <select
                value={monthFilter}
                onChange={(event) => setMonthFilter(event.target.value)}
              >
                <option value="">Select month</option>
                {months.map((month) => (
                  <option key={month} value={month}>
                    {month}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Search player
              <input
                value={query}
                placeholder="Name / phone"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>

            <button className="btn" type="button" onClick={refreshRecords}>
              {loading ? "Loading..." : "Refresh"}
            </button>
          </div>

          {loadError ? (
            <div className="errorBox" style={{ marginTop: 12 }}>
              {loadError}
            </div>
          ) : null}
        </div>

        <div className="card">
          <h2 style={{ marginTop: 0 }}>Monthly Summary</h2>

          <div className="muted" style={{ marginBottom: 10 }}>
            {monthFilter || "No month selected"} · {monthlyPlayers.length} player(s)
          </div>

          <div style={{ overflowX: "auto" }}>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>Player</th>
                  <th>Games Played</th>
                  <th>Times Winner</th>
                  <th>Times Ball Out</th>
                  <th>Kitty Points Won</th>
                  <th>Net Kitty Result</th>
                  <th>Table Charges</th>
                  <th>Summary</th>
                </tr>
              </thead>
              <tbody>
                {monthlyPlayers.length ? (
                  monthlyPlayers.map((player) => (
                    <tr
                      key={player.key}
                      onClick={() => setSelectedPlayerKey(player.key)}
                      style={{
                        cursor: "pointer",
                        background:
                          selectedPlayer?.key === player.key
                            ? "rgba(250,204,21,0.12)"
                            : undefined,
                      }}
                    >
                      <td>
                        <b>{player.playerName}</b>
                        {player.phone ? <div className="muted">{player.phone}</div> : null}
                      </td>
                      <td>{player.gamesPlayed}</td>
                      <td>{player.timesWinner}</td>
                      <td>{player.timesBallOut}</td>
                      <td>{player.kittyPointsWon}</td>
                      <td>
                        <b>
                          {Number(player.netKittyResult || 0) > 0
                            ? `+${Number(player.netKittyResult || 0)}`
                            : Number(player.netKittyResult || 0)}
                        </b>
                      </td>
                      <td>{player.tableCharges ? `₹${player.tableCharges}` : "—"}</td>
                      <td>{kittyMonthlySummaryLine(player)}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="8" className="muted">
                      No Kitty records found for this month.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

                {selectedPlayer ? (
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Selected Player Preview</h2>
            <p style={{ marginTop: 0 }}>{kittyMonthlySummaryLine(selectedPlayer)}</p>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
                gap: 10,
              }}
            >
              <div className="stat-card">
                <div className="muted">Games Played</div>
                <b>{selectedPlayer.gamesPlayed}</b>
              </div>

              <div className="stat-card">
                <div className="muted">Times Winner</div>
                <b>{selectedPlayer.timesWinner}</b>
              </div>

              <div className="stat-card">
                <div className="muted">Times Ball Out</div>
                <b>{selectedPlayer.timesBallOut}</b>
              </div>

              <div className="stat-card">
                <div className="muted">Net Kitty Result</div>
                <b>
                  {Number(selectedPlayer.netKittyResult || 0) > 0
                    ? `+${Number(selectedPlayer.netKittyResult || 0)}`
                    : Number(selectedPlayer.netKittyResult || 0)}
                </b>
              </div>

              <div className="stat-card">
                <div className="muted">Kitty Entry</div>
                <b>{Number(selectedPlayer.totalKittyEntry || 0)}</b>
              </div>

              <div className="stat-card">
                <div className="muted">Ball Out Penalty</div>
                <b>{Number(selectedPlayer.totalOutPenalty || 0)}</b>
              </div>

              <div className="stat-card">
                <div className="muted">Kitty Add-on</div>
                <b>{Number(selectedPlayer.totalKittyAddOn || 0)}</b>
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <button
                className="btn primary"
                type="button"
                disabled={
                  !selectedPlayer?.phone ||
                  String(monthlyWhatsappSendStatus[selectedPlayer.key] || "") === "sending"
                }
                onClick={() => sendKittyMonthlyWhatsapp(selectedPlayer)}
              >
                {String(monthlyWhatsappSendStatus[selectedPlayer.key] || "") === "sending"
                  ? "Sending WhatsApp..."
                  : "Send WhatsApp Monthly Report"}
              </button>

              {selectedPlayer?.phone ? (
                <span className="muted" style={{ marginLeft: 10 }}>
                  {monthlyWhatsappSendStatus[selectedPlayer.key] || `To: ${selectedPlayer.phone}`}
                </span>
              ) : (
                <span className="muted" style={{ marginLeft: 10 }}>
                  No WhatsApp number found for this player.
                </span>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

export function KittyRecordsPage({
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
        .from("kitty_player_results")
        .select("*")
        .order("played_at", { ascending: false })
        .limit(1500);

      if (error) throw error;

      setRecords(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error("Kitty cloud records load failed:", error);
      setLoadError(error?.message || "Could not load Kitty cloud records.");
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }
  async function deleteSelectedKittyGame() {
  if (!admin) {
    alert("Only Main Admin can delete Kitty records.");
    return;
  }

  if (!selectedGame?.gameNo) {
    alert("No Kitty game selected.");
    return;
  }

  if (!supabaseReady || !supabase) {
    alert("Supabase is not ready. Cannot delete cloud record.");
    return;
  }

  const gameNo = String(selectedGame.gameNo || "").trim();
  const playerCount = Number(selectedGame.players?.length || 0);

  const ok = confirm(
    `Delete Kitty game ${gameNo}?\n\n` +
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
      .from("kitty_player_results")
      .delete()
      .eq("game_no", gameNo);

    if (error) throw error;

    setRecords((prev) =>
      (prev || []).filter((record) => String(record.game_no || "") !== gameNo)
    );

    setSelectedGameNo("");
    setSelectedPlayerKey("");

    alert(`Deleted Kitty game ${gameNo}.`);
  } catch (error) {
    console.error("Kitty delete failed:", error);
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

        return kittyCloudSearchText(record).includes(q);
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
          kittyNo: record.kitty_no || 1,
          kittyLabel: record.kitty_label || "",
          tableName: record.table_name || "—",
          tableKey: record.table_key || "",
          gameType: record.game_type || "",
          baseTarget: record.base_target || "",
          monthKey: record.month_key || "",
          playedAt: record.played_at || "",
          startedAt: record.started_at || "",
          endedAt: record.ended_at || "",
          duration: record.duration || "",
          result: record.result || "",
          winner: record.winner || "",
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
      const key = kittyCloudPlayerKey(record);

      if (!map.has(key)) {
        map.set(key, {
          key,
          playerName: record.player_name || "—",
          phone: record.phone || "",
          games: 0,
          wins: 0,
          qualified: 0,
          out: 0,
          totalReds: 0,
          totalFouls: 0,
          bestReds: 0,
          lastPlayedAt: record.played_at || "",
        });
      }

      const stat = map.get(key);

      stat.games += 1;
      stat.wins += record.is_winner ? 1 : 0;
      stat.qualified += record.is_qualified ? 1 : 0;
      stat.out += record.is_out ? 1 : 0;
      stat.totalReds += kittyNum(record.reds_potted);
      stat.totalFouls += kittyNum(record.fouls);
      stat.bestReds = Math.max(stat.bestReds, kittyNum(record.reds_potted));

      const oldTime = Date.parse(stat.lastPlayedAt || "") || 0;
      const newTime = Date.parse(record.played_at || "") || 0;
      if (newTime > oldTime) stat.lastPlayedAt = record.played_at || "";
    });

    return Array.from(map.values()).sort((a, b) => {
      return b.wins - a.wins || b.qualified - a.qualified || b.games - a.games;
    });
  }, [filteredRecords]);

  const selectedPlayer =
    playerStats.find((p) => String(p.key) === String(selectedPlayerKey)) ||
    playerStats[0] ||
    null;

  const selectedPlayerRows = useMemo(() => {
    if (!selectedPlayer) return [];

    return filteredRecords
      .filter((record) => kittyCloudPlayerKey(record) === selectedPlayer.key)
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
          title="Kitty Records"
          subtitle="Admin access required"
          noNav
        />
        <div className="container">
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Access Denied</h2>
            <p className="muted">Kitty Records are available only for Main Admin and Staff Admin.</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageShell
  title="Kitty Records"
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
          <h2 style={{ marginTop: 0 }}>Search Kitty Cloud Records</h2>

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
              placeholder="Search by player name, phone, game no, winner, qualified, out, month..."
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
            Showing {filteredRecords.length} player rows from {gameGroups.length} Kitty game(s).
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
              <div className="muted">No Kitty player records found.</div>
            ) : (
              <div style={{ display: "grid", gap: 8, maxHeight: 560, overflow: "auto" }}>
                {playerStats.map((p) => {
                  const active = String(selectedPlayer?.key) === String(p.key);

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
                          Games: {p.games} • Wins: {p.wins} • Qualified: {p.qualified} • Out: {p.out} • Reds: {p.totalReds} • Fouls: {p.totalFouls}
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
                  <div><b>Qualified</b><br />{selectedPlayer.qualified}</div>
                  <div><b>Out</b><br />{selectedPlayer.out}</div>
                  <div><b>Total Reds</b><br />{selectedPlayer.totalReds}</div>
                  <div><b>Total Fouls</b><br />{selectedPlayer.totalFouls}</div>
                  <div><b>Best Red Count</b><br />{selectedPlayer.bestReds}</div>
                  <div><b>Last Played</b><br />{kittyCloudDateText(selectedPlayer.lastPlayedAt)}</div>
                </div>

                <div style={{ marginTop: 14, overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1150 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left", padding: 8 }}>Date</th>
                        <th style={{ textAlign: "left", padding: 8 }}>Game</th>
                        <th style={{ textAlign: "left", padding: 8 }}>Kitty</th>
                        <th style={{ textAlign: "left", padding: 8 }}>Table</th>
                        <th style={{ textAlign: "right", padding: 8 }}>Order</th>
                        <th style={{ textAlign: "right", padding: 8 }}>Base</th>
                        <th style={{ textAlign: "right", padding: 8 }}>HCP</th>
                        <th style={{ textAlign: "right", padding: 8 }}>Required</th>
                        <th style={{ textAlign: "right", padding: 8 }}>Reds</th>
                        <th style={{ textAlign: "right", padding: 8 }}>Fouls</th>
                        <th style={{ textAlign: "left", padding: 8 }}>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedPlayerRows.map((r) => (
                        <tr key={r.id}>
                          <td style={{ padding: 8 }}>{kittyCloudDateText(r.played_at)}</td>
                          <td style={{ padding: 8 }}>{r.game_no || "—"}</td>
                          <td style={{ padding: 8 }}>{r.kitty_label || "—"}</td>
                          <td style={{ padding: 8 }}>{r.table_name || "—"}</td>
                          <td style={{ padding: 8, textAlign: "right" }}>{r.serial_order || "—"}</td>
                          <td style={{ padding: 8, textAlign: "right" }}>{r.base_target ?? "—"}</td>
                          <td style={{ padding: 8, textAlign: "right" }}>{r.handicap_balls ?? 0}</td>
                          <td style={{ padding: 8, textAlign: "right" }}>{r.required_balls ?? r.base_target ?? "—"}</td>
                          <td style={{ padding: 8, textAlign: "right" }}>{r.reds_potted ?? 0}</td>
                          <td style={{ padding: 8, textAlign: "right" }}>{r.fouls ?? 0}</td>
                          <td style={{ padding: 8 }}>{r.status || "played"}</td>
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
          <h2 style={{ marginTop: 0 }}>Kitty Games</h2>

          {!gameGroups.length ? (
            <div className="muted">No Kitty games found in cloud records.</div>
          ) : (
            <div style={{ display: "grid", gap: 8, maxHeight: 380, overflow: "auto" }}>
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
                      {" "}— {game.kittyLabel || `${ordinalShort(game.kittyNo || 1)} Kitty`}
                      {" "}— {game.tableName}
                      {" "}— Winner: {winner?.player_name || game.winner || "NO WINNER"}
                      <div className="muted">
                        Players: {game.players.length} • Month: {game.monthKey || "—"} • Played: {kittyCloudDateText(game.playedAt)}
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
  <h2 style={{ margin: 0 }}>Selected Kitty Game Details</h2>

  {admin ? (
    <button
      className="btn danger"
      type="button"
      onClick={deleteSelectedKittyGame}
      disabled={deletingGameNo === selectedGame?.gameNo}
      title="Main Admin only. Permanently deletes this full Kitty game from Supabase."
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
              <div><b>Kitty</b><br />{selectedGame.kittyLabel || `${ordinalShort(selectedGame.kittyNo || 1)} Kitty`}</div>
              <div><b>Table</b><br />{selectedGame.tableName}</div>
              <div><b>Type</b><br />{selectedGame.gameType || "—"}</div>
              <div><b>Base Target</b><br />{selectedGame.baseTarget || "—"}</div>
              <div><b>Month</b><br />{selectedGame.monthKey || "—"}</div>
              <div><b>Start</b><br />{selectedGame.startedAt || "—"}</div>
              <div><b>End</b><br />{selectedGame.endedAt || "—"}</div>
              <div><b>Duration</b><br />{selectedGame.duration || "—"}</div>
            </div>

            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1200 }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: "left", padding: 8 }}>Order</th>
                    <th style={{ textAlign: "left", padding: 8 }}>Player</th>
                    <th style={{ textAlign: "left", padding: 8 }}>Phone</th>
                    <th style={{ textAlign: "right", padding: 8 }}>Base</th>
                    <th style={{ textAlign: "right", padding: 8 }}>HCP</th>
                    <th style={{ textAlign: "right", padding: 8 }}>Required</th>
                    <th style={{ textAlign: "right", padding: 8 }}>Reds</th>
                    <th style={{ textAlign: "right", padding: 8 }}>Fouls</th>
                    <th style={{ textAlign: "right", padding: 8 }}>Qualified</th>
                    <th style={{ textAlign: "right", padding: 8 }}>Dead</th>
                    <th style={{ textAlign: "left", padding: 8 }}>Status</th>
                    <th style={{ textAlign: "left", padding: 8 }}>Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedGameRows.map((r) => (
                    <tr key={r.id}>
                      <td style={{ padding: 8 }}>{r.serial_order}</td>
                      <td style={{ padding: 8 }}><b>{r.player_name}</b></td>
                      <td style={{ padding: 8 }}>{r.phone || "—"}</td>
                      <td style={{ padding: 8, textAlign: "right" }}>{r.base_target ?? "—"}</td>
                      <td style={{ padding: 8, textAlign: "right" }}>{r.handicap_balls ?? 0}</td>
                      <td style={{ padding: 8, textAlign: "right" }}>{r.required_balls ?? r.base_target ?? "—"}</td>
                      <td style={{ padding: 8, textAlign: "right" }}>{r.reds_potted ?? 0}</td>
                      <td style={{ padding: 8, textAlign: "right" }}>{r.fouls ?? 0}</td>
                      <td style={{ padding: 8, textAlign: "right" }}>{r.qualified_count ?? 0}</td>
                      <td style={{ padding: 8, textAlign: "right" }}>{r.dead_count ?? 0}</td>
                      <td style={{ padding: 8 }}>{r.status || "played"}</td>
                      <td style={{ padding: 8 }}>{r.remarks || "—"}</td>
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
              <b>Qualifier Line</b>
              <div className="muted" style={{ marginTop: 4 }}>
                {selectedGameRows[0]?.qualifier_line || "—"}
              </div>
            </div>

            <div style={{ marginTop: 14 }}>
              <b>Next Game Order</b>
              <div className="muted" style={{ marginTop: 4 }}>
                {selectedGameRows[0]?.next_game_order_line || "—"}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
export function KittyPage({
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
      return localStorage.getItem("qclub_kitty_access") === "yes";
    } catch {
      return false;
    }
  });

  const hasAccess = admin || staffAdmin || allowed;
  const currentKittyTableConfig = getKittyTableConfig(tableKey);

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
const [kittyHandicaps, setKittyHandicaps] = useState({});
const [playerPhones, setPlayerPhones] = useState(() => {
  const book = loadQClubPlayerPhonebook();
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
    const key = kittyPlayerKey(name);
    seed[key] = book[key] || "";
  });

  return seed;
});

useEffect(() => {
  const book = loadQClubPlayerPhonebook();

  setPlayerPhones((prev) => {
    let changed = false;
    const next = { ...prev };

    playerInputs.forEach((name) => {
      const key = kittyPlayerKey(name);
      if (!key) return;

      if (!next[key] && book[key]) {
        next[key] = book[key];
        changed = true;
      }
    });

    return changed ? next : prev;
  });
}, [playerInputs]);

function saveKittyPhonesToPhonebook() {
  const book = loadQClubPlayerPhonebook();

  playerInputs.forEach((name) => {
    const key = kittyPlayerKey(name);
    const phone = normalizeKittyPhone(playerPhones[key] || "");

    if (key && phone) {
      book[key] = phone;
    }
  });

  saveQClubPlayerPhonebook(book);
  return book;
}

function updateKittyPlayerName(index, value) {
  // Keep spaces while typing. Final cleanup still happens when game starts.
  const typed = String(value || "").toUpperCase();

  const next = [...playerInputs];
  next[index] = typed;
  setPlayerInputs(next);

  const key = kittyPlayerKey(typed);
  if (!key) return;

  const book = loadQClubPlayerPhonebook();

  setPlayerPhones((prev) => ({
    ...prev,
    [key]: prev[key] || book[key] || "",
  }));
}
const [showKittyWhatsappPreview, setShowKittyWhatsappPreview] = useState(false);
const [kittyWhatsappSendStatus, setKittyWhatsappSendStatus] = useState({});
const [kittyWhatsappSendAllRunning, setKittyWhatsappSendAllRunning] = useState(false);
  const [state, setState] = useState(() => ({
    gameId: makeId(),
    gameNo: gameNo(),
    createdAt: nowText(),
    startedAt: "",
    endedAt: "",
    duration: "",
    tableName: currentKittyTableConfig.displayName || tableLabel || "Ronnie's Table 12x6",
gameType: currentKittyTableConfig.gameType || "snooker_ronnie_12x6",
kittyNo: 1,
baseTarget: 3,

// Kitty settlement settings.
// Kitty Entry = starting value each player enters with.
// Out Penalty = agreed penalty value if a player is out.
// Kitty Add-ons are locked only after "End Game - No Winner" is clicked.
kittyEntry: "",
outPenalty: "",
kittyAddOn: 0,
kittyAddOns: [],
kittyRoundHistory: [],

// Table charge handling is configurable because some groups may book/pay table time separately.
tableChargeMode: "handled_separately",
tableRatePerHour: getKittyTableRate(currentKittyTableConfig.gameType, currentKittyTableConfig.displayName, tableKey),
tableManualCharge: "",
tableRoundingMode: "round_up",

extraRedsAllowed: 0,
    extraRedsPlaced: 0,
    redsOnTable: 15,
startingRedsOnTable: 15,
tokenBallsLeft: 6,
orderLocked: false,
    started: false,
    locked: false,
    winner: "",
    noWinner: false,
previousKittyResults: [],
  }));

  const [order, setOrder] = useState([]);
  const [players, setPlayers] = useState({});
  const [logs, setLogs] = useState([]);
const [currentIndex, setCurrentIndex] = useState(0);
const [qualifierOrder, setQualifierOrder] = useState([]);
const [undoStack, setUndoStack] = useState([]);
const [kittyRestored, setKittyRestored] = useState(false);

useEffect(() => {
  const saved = loadActiveKittyGame(tableKey);

  if (saved?.state) setState(saved.state);
  if (Array.isArray(saved?.order)) setOrder(saved.order);
  if (saved?.players && typeof saved.players === "object") setPlayers(saved.players);
  if (Array.isArray(saved?.logs)) setLogs(saved.logs);
  if (Number.isFinite(saved?.currentIndex)) setCurrentIndex(saved.currentIndex);
  if (Array.isArray(saved?.qualifierOrder)) setQualifierOrder(saved.qualifierOrder);
  if (Array.isArray(saved?.undoStack)) setUndoStack(saved.undoStack);
  if (Array.isArray(saved?.playerInputs)) setPlayerInputs(saved.playerInputs);
  if (saved?.playerPhones && typeof saved.playerPhones === "object") setPlayerPhones(saved.playerPhones);
  if (saved?.kittyHandicaps && typeof saved.kittyHandicaps === "object") setKittyHandicaps(saved.kittyHandicaps);

  setKittyRestored(true);
}, [tableKey]);

useEffect(() => {
  if (!kittyRestored) return;

  const hasLiveKitty =
    state?.started ||
    state?.orderLocked ||
    order.length > 0 ||
    Object.keys(players || {}).length > 0 ||
    logs.length > 0;

  if (!hasLiveKitty) return;

  saveActiveKittyGame(tableKey, {
    savedAt: new Date().toISOString(),
    state,
    order,
    players,
    logs,
    currentIndex,
    qualifierOrder,
    undoStack,
    playerInputs,
    playerPhones,
    kittyHandicaps,
  });
}, [
  kittyRestored,
  tableKey,
  state,
  order,
  players,
  logs,
  currentIndex,
  qualifierOrder,
  undoStack,
  playerInputs,
  playerPhones,
  kittyHandicaps,
]);
  const currentPlayer = order[currentIndex] || "";
  const current = currentPlayer ? players[currentPlayer] : null;
  function makeUndoSnapshot(actionLabel = "Action") {
  return {
    actionLabel,
    savedAt: nowText(),
    state: JSON.parse(JSON.stringify(state || {})),
    order: JSON.parse(JSON.stringify(order || [])),
    players: JSON.parse(JSON.stringify(players || {})),
    logs: JSON.parse(JSON.stringify(logs || [])),
    currentIndex,
    qualifierOrder: JSON.parse(JSON.stringify(qualifierOrder || [])),
  };
}

function pushUndo(actionLabel = "Action") {
  if (state.locked) return;

  setUndoStack((prev) => [
    makeUndoSnapshot(actionLabel),
    ...prev,
  ].slice(0, 25));
}

function undoLastAction() {
  if (state.locked) {
    alert("Final locked game cannot be undone.");
    return;
  }

  const snapshot = undoStack[0];

  if (!snapshot) {
    alert("Nothing to undo.");
    return;
  }

  const ok = confirm(`Undo last action?\n\nLast saved action: ${snapshot.actionLabel}`);
  if (!ok) return;

  setState(snapshot.state);
  setOrder(snapshot.order);
  setPlayers(snapshot.players);
  setCurrentIndex(snapshot.currentIndex);
  setQualifierOrder(snapshot.qualifierOrder);

  setLogs([
    ...(snapshot.logs || []),
    {
      id: makeId("log"),
      time: nowText(),
      name: "SYSTEM",
      action: "Undo",
      detail: `Undid: ${snapshot.actionLabel}`,
    },
  ]);

  setUndoStack((prev) => prev.slice(1));
}

  function addLog(name, action, detail = "") {
    setLogs((prev) => [
      ...prev,
      {
        id: makeId("log"),
        time: nowText(),
        name,
        action,
        detail,
      },
    ]);
  }

  function cleanPlayers() {
    return playerInputs.map(cleanName).filter(Boolean);
  }

  function resetGame(keepOrder = false, customOrder = []) {
    const names = keepOrder && customOrder.length ? customOrder : cleanPlayers();
    const nextPlayers = {};
    names.forEach((name) => {
      const hcp = kittyHandicapBalls(kittyHandicaps[kittyPlayerKey(name)] || 0);
const requiredBalls = kittyRequiredBalls(state.baseTarget, hcp);

nextPlayers[name] = {
  ...defaultPlayerState(name),
  handicapBalls: hcp,
  requiredBalls,
  needReasons: kittyNeedReasonsForPlayer(state.baseTarget, hcp),
  currentNeed: requiredBalls,
};
    });

    setOrder(names);
    setPlayers(nextPlayers);
    setQualifierOrder([]);
    setLogs([]);
    setCurrentIndex(0);
    setUndoStack([]);
    setState((s) => ({
      ...s,
      gameId: makeId(),
      gameNo: gameNo(),
      createdAt: nowText(),
      startedAt: "",
      endedAt: "",
      duration: "",
      orderLocked: keepOrder,
      started: false,
      locked: false,
      winner: "",
noWinner: false,
kittyNo: keepOrder ? Number(s.kittyNo || 1) : 1,
previousKittyResults: keepOrder ? s.previousKittyResults || [] : [],
redsOnTable: kittyDefaultRedsOnTable(s.gameType),
startingRedsOnTable: kittyDefaultRedsOnTable(s.gameType),
tokenBallsLeft: 6,
extraRedsPlaced: 0,
    }));
  }
function resetKittyWithPin() {
  const enteredPin = prompt("Enter PIN to reset this Kitty game:");

  if (enteredPin !== rummyPin) {
    alert("Wrong PIN. Kitty reset cancelled.");
    return;
  }

  const ok = confirm(
    "Reset this Kitty game?\n\nThis will clear the current order, scores, winner, logs, and allow a fresh serial draw."
  );

  if (!ok) return;

  resetGame(false, []);
}
  function lockRandomOrder() {
    if (state.locked) return alert("Game is locked.");
    const settlementError = validateKittySettlementBeforeStart(state);
if (settlementError) {
  alert(settlementError);
  return;
}
    if (state.started || state.orderLocked || order.length) {
  alert("Serial order has already been drawn. Redraw is not allowed.");
  return;
}
    const names = cleanPlayers();
    if (names.length < 2) return alert("Add at least 2 players.");
saveKittyPhonesToPhonebook();
    const drawn = shuffle(names);
    const nextPlayers = {};
    drawn.forEach((name) => {
      const hcp = kittyHandicapBalls(kittyHandicaps[kittyPlayerKey(name)] || 0);
const requiredBalls = kittyRequiredBalls(state.baseTarget, hcp);

nextPlayers[name] = {
  ...defaultPlayerState(name),
  handicapBalls: hcp,
  requiredBalls,
  needReasons: kittyNeedReasonsForPlayer(state.baseTarget, hcp),
  currentNeed: requiredBalls,
};
    });

    setOrder(drawn);
    setPlayers(nextPlayers);
    setQualifierOrder([]);
    setLogs([]);
    setCurrentIndex(0);
    setUndoStack([]);
    setState((s) => ({
      ...s,
      orderLocked: true,
      started: true,
      startedAt: s.startedAt || nowText(),
      redsOnTable: kittyDefaultRedsOnTable(s.gameType),
tokenBallsLeft: 6,
extraRedsPlaced: 0,
    }));
    addLog("SYSTEM", "Serial order drawn", drawn.join(" → "));
  }

  function startSameOrder() {
      if (!canStartSameOrderGame(state)) {
    alert("Same Order new game is allowed only after End Game - No Winner is declared.");
    return;
  }
  const names = order.length ? order : cleanPlayers();
  saveKittyPhonesToPhonebook();
  if (names.length < 2) return alert("Add at least 2 players.");

  const nextKittyNo = state.noWinner
    ? Number(state.kittyNo || 1) + 1
    : Number(state.kittyNo || 1);

  const previousNoWinnerItem = state.noWinner
    ? {
        gameNo: state.gameNo,
        kittyNo: Number(state.kittyNo || 1),
        label: `${ordinalShort(state.kittyNo || 1)} Kitty`,
        result: "NO WINNER",
        order: [...order],
        endedAt: nowText(),
        redsOnTable: state.redsOnTable,
        extraRedsAllowed: state.extraRedsAllowed,
        extraRedsPlaced: state.extraRedsPlaced,
        players,
      }
    : null;

  const nextPlayers = {};
  names.forEach((name) => {
    nextPlayers[name] = {
      ...defaultPlayerState(name),
      handicapBalls: kittyHandicapBalls(kittyHandicaps[kittyPlayerKey(name)] || 0),
      requiredBalls: kittyRequiredBalls(state.baseTarget, kittyHandicapBalls(kittyHandicaps[kittyPlayerKey(name)] || 0)),
      needReasons: kittyNeedReasonsForPlayer(state.baseTarget, kittyHandicapBalls(kittyHandicaps[kittyPlayerKey(name)] || 0)),
      currentNeed: kittyRequiredBalls(state.baseTarget, kittyHandicapBalls(kittyHandicaps[kittyPlayerKey(name)] || 0)),
    };
  });

  setPlayers(nextPlayers);
  setQualifierOrder([]);
  setLogs([]);
  setCurrentIndex(0);
  setUndoStack([]);

  setState((s) => ({
    ...s,
    gameId: makeId(),
    gameNo: gameNo(),
    kittyNo: nextKittyNo,
    previousKittyResults: previousNoWinnerItem
      ? [...(s.previousKittyResults || []), previousNoWinnerItem]
      : s.previousKittyResults || [],
          kittyRoundHistory: Array.isArray(s.kittyRoundHistory) ? s.kittyRoundHistory : [],
    createdAt: nowText(),
    startedAt: nowText(),
    endedAt: "",
    duration: "",
    orderLocked: true,
    started: true,
    locked: false,
    winner: "",
    noWinner: false,
    redsOnTable: kittyDefaultRedsOnTable(s.gameType),
tokenBallsLeft: 6,
extraRedsPlaced: 0,
  }));

  addLog("SYSTEM", `${ordinalShort(nextKittyNo)} Kitty started in same order`, names.join(" → "));
}
  function updatePlayer(name, updater) {
    if (!name || state.locked) return;
    setPlayers((prev) => {
      const oldPlayer = prev[name] || defaultPlayerState(name);
      return {
        ...prev,
        [name]: updater(oldPlayer),
      };
    });
  }

 function addRed() {
  if (!state.started || !currentPlayer) return alert("Start game first.");
  if (state.locked) return alert("Game is locked.");
  if (state.winner) return alert("Winner already declared. No more changes allowed. Use Final Lock.");

  if (isPlayerOutOfGame(players[currentPlayer], state)) {
    return alert(`${currentPlayer} is OUT OF GAME because required reds are more than available reds.`);
  }

  if (Number(state.redsOnTable || 0) <= 0) {
    return alert("No reds/non-token balls left on table. Place extra reds or end game.");
  }

  pushUndo(`Red potted by ${currentPlayer}`);

  const before = players[currentPlayer] || defaultPlayerState(currentPlayer);
  const reasons = Array.isArray(before.needReasons) && before.needReasons.length
    ? before.needReasons
    : baseNeedReasons(state.baseTarget);

  const newCycleReds = Number(before.cycleReds || 0) + 1;
  const need = reasons.length;
  const qualifiesNow = newCycleReds >= need;

  const wasClearingFoul =
    before.secretTokenActive &&
    before.foulClearanceActive;

  const nextQualifierRank =
    before.qualifierRank ||
    (qualifierOrder.includes(currentPlayer)
      ? qualifierOrder.indexOf(currentPlayer) + 1
      : qualifierOrder.length + 1);

  const nextCurrentPlayer = {
    ...before,
    redsPotted: Number(before.redsPotted || 0) + 1,
    cycleReds: newCycleReds,
  };

  if (qualifiesNow) {
    nextCurrentPlayer.secretTokenActive = true;
    nextCurrentPlayer.foulClearanceActive = false;
    nextCurrentPlayer.cycleReds = 0;
    nextCurrentPlayer.currentNeed = 0;
    nextCurrentPlayer.needReasons = [];

    if (!wasClearingFoul) {
      nextCurrentPlayer.qualifiedCount = Number(before.qualifiedCount || 0) + 1;
      nextCurrentPlayer.qualifierRank = nextQualifierRank;
      if (!nextCurrentPlayer.firstQualifiedAt) nextCurrentPlayer.firstQualifiedAt = Date.now();
    }
  }

  const nextPlayers = {
    ...players,
    [currentPlayer]: nextCurrentPlayer,
  };

  const nextStateForOutCheck = {
    ...state,
    redsOnTable: Math.max(0, Number(state.redsOnTable || 0) - 1),
  };

  const alivePlayers = (order || []).filter((name) => {
    const p = nextPlayers[name] || defaultPlayerState(name);
    return !isPlayerOutOfGame(p, nextStateForOutCheck);
  });

  const autoWinner =
    alivePlayers.length === 1 &&
    String(alivePlayers[0]) === String(currentPlayer);

  if (autoWinner) {
    nextPlayers[currentPlayer] = {
      ...nextPlayers[currentPlayer],
      won: true,
    };
  }

  setPlayers(nextPlayers);

  setState((s) => ({
    ...s,
    redsOnTable: Math.max(0, Number(s.redsOnTable || 0) - 1),
    winner: autoWinner ? currentPlayer : s.winner,
    noWinner: autoWinner ? false : s.noWinner,
  }));

  if (qualifiesNow) {
    if (wasClearingFoul) {
      addLog(
        currentPlayer,
        "Foul cleared",
        autoWinner
          ? "Player cleared foul and became the only player left in the game. Winner auto-declared."
          : "Player is qualified again to attempt the same secret token."
      );
    } else {
      setQualifierOrder((prev) => {
        if (prev.includes(currentPlayer)) return prev;
        return [...prev, currentPlayer];
      });

      addLog(
        currentPlayer,
        `${ordinal(nextQualifierRank)} QUALIFIER`,
        autoWinner
          ? "Secret token drawn. All other players are ball out. Winner auto-declared."
          : "Secret token drawn. Token remains secret."
      );
    }
  } else {
    const remaining = Math.max(0, need - newCycleReds);
    addLog(
      currentPlayer,
      "Red potted",
      autoWinner
        ? "All other players are ball out. Winner auto-declared."
        : `${remaining} red needed`
    );
  }

  if (autoWinner) {
    addLog(
      currentPlayer,
      "AUTO WINNER",
      "Only player left in the game after a successful pot. Final Lock can now be used."
    );
  }
}

  function addFoul() {
  if (!state.started || !currentPlayer) return alert("Start game first.");
  if (state.locked) return alert("Game is locked.");
  
  if (state.winner) return alert("Winner already declared. No more changes allowed. Use Final Lock.");
  if (isPlayerOutOfGame(players[currentPlayer], state)) {
  return alert(`${currentPlayer} is OUT OF GAME because required reds are more than available reds.`);
}
pushUndo(`Foul by ${currentPlayer}`);
  const p = players[currentPlayer] || defaultPlayerState(currentPlayer);

  updatePlayer(currentPlayer, (old) => {
    const existingReasons = Array.isArray(old.needReasons) && old.needReasons.length
      ? old.needReasons
      : baseNeedReasons(state.baseTarget);

    const next = {
      ...old,
      fouls: Number(old.fouls || 0) + 1,
    };

    if (old.secretTokenActive && !old.foulClearanceActive) {
      // Player has token but fouled while attempting it.
      // He cannot hit token again until he clears this by potting 1 red.
      next.foulClearanceActive = true;
      next.currentNeed = 1;
      next.cycleReds = 0;
      next.needReasons = ["F"];
    } else {
      // Normal foul before qualification or after Dead requirement.
      next.needReasons = [...existingReasons, "F"];
      next.currentNeed = next.needReasons.length;
    }

    return next;
  });

  if (p.secretTokenActive && !p.foulClearanceActive) {
  addLog(
    currentPlayer,
    "Foul after token draw",
    "Player must clear foul by potting 1 red before he is qualified to hit token ball again. Turn passed to next player."
  );
} else {
  addLog(currentPlayer, "Foul", "One F red added. Turn passed to next player.");
}

moveToNextPlayerAfterFoul();
}
function addRedsWithFoul() {
  if (!state.started || !currentPlayer) return alert("Start game first.");
  if (state.locked) return alert("Game is locked.");
  if (state.winner) return alert("Winner already declared. No more changes allowed. Use Final Lock.");

  if (isPlayerOutOfGame(players[currentPlayer], state)) {
    return alert(`${currentPlayer} is OUT OF GAME because required reds are more than available reds.`);
  }

  const maxReds = Number(state.redsOnTable || 0);
  if (maxReds <= 0) {
    return alert("No reds/non-token balls left on table.");
  }

  const input = prompt(
    `How many reds/non-token balls went in during this FOUL stroke?\n\nThese reds will be removed from table but will NOT count for qualification.\n\nReds on table: ${maxReds}`,
    "1"
  );

  if (input === null) return;

  const qty = Math.max(0, Math.min(maxReds, Number(input || 0)));
  if (!qty) return;

  pushUndo(`${qty} red(s) removed during foul by ${currentPlayer}`);

  updatePlayer(currentPlayer, (old) => {
    const existingReasons = Array.isArray(old.needReasons) && old.needReasons.length
      ? old.needReasons
      : baseNeedReasons(state.baseTarget);

    const next = {
      ...old,
      fouls: Number(old.fouls || 0) + 1,
    };

    if (old.secretTokenActive && !old.foulClearanceActive) {
      // Player already had a secret token but fouled.
      // Reds removed in this foul shot do NOT count.
      // He must clear one F red before he can attempt token again.
      next.foulClearanceActive = true;
      next.currentNeed = 1;
      next.cycleReds = 0;
      next.needReasons = ["F"];
      return next;
    }

    // Important Kitty rule:
    // Reds potted during a foul stroke are physically gone,
    // but they do NOT reduce the player's qualification requirement.
    next.needReasons = [...existingReasons, "F"];
    next.currentNeed = next.needReasons.length;

    return next;
  });

  setState((s) => ({
    ...s,
    redsOnTable: Math.max(0, Number(s.redsOnTable || 0) - qty),
  }));

  addLog(
  currentPlayer,
  "Red(s) removed with foul",
  `${qty} red(s) removed from table, but not counted for qualification. One F red added. Turn passed to next player.`
);

moveToNextPlayerAfterFoul();
}
function markTokenBallGone() {
  if (!state.started || !currentPlayer) return alert("Start game first.");
  if (state.locked) return alert("Game is locked.");
  if (state.winner) return alert("Winner already declared. No more changes allowed. Use Final Lock.");

  const currentLeft = Number(state.tokenBallsLeft ?? 6);
  if (currentLeft <= 0) {
    return alert("No token/colour balls left.");
  }

  const ok = confirm(
    "Mark one token/colour ball as gone?\n\nUse this when a colour/token ball is potted by foul or removed from the game."
  );

  if (!ok) return;

  pushUndo(`Token/colour ball gone by ${currentPlayer}`);

  setState((s) => ({
    ...s,
    tokenBallsLeft: Math.max(0, Number(s.tokenBallsLeft ?? 6) - 1),
  }));

  addLog(
    currentPlayer,
    "Token/Colour Ball Gone",
    `Token/colour balls left: ${Math.max(0, currentLeft - 1)}`
  );
}
 function declareDead() {
  if (!state.started || !currentPlayer) return alert("Start game first.");
  if (state.locked) return alert("Game is locked.");
  if (state.winner) return alert("Winner already declared. No more changes allowed. Use Final Lock.");
 if (isPlayerOutOfGame(players[currentPlayer], state)) {
  return alert(`${currentPlayer} is OUT OF GAME because required reds are more than available reds.`);
}
  pushUndo(`Dead declared by ${currentPlayer}`);
  const p = players[currentPlayer] || defaultPlayerState(currentPlayer);

  if (!p.secretTokenActive) {
    return alert("Player has no active secret token.");
  }

  if (p.foulClearanceActive) {
    return alert("Clear the foul first by potting the F red. Then player may declare DEAD if he wants.");
  }

  updatePlayer(currentPlayer, (old) => ({
    ...old,
    secretTokenActive: false,
    foulClearanceActive: false,
    deadCount: Number(old.deadCount || 0) + 1,
    currentNeed: 1,
    cycleReds: 0,
    needReasons: ["D"],
  }));

  addLog(currentPlayer, "Declared DEAD", "One D red added. Player must pot it to draw another secret token.");
}

  function cleanTokenWin() {
    if (!state.started || !currentPlayer) return alert("Start game first.");
    if (state.locked) return alert("Game is locked.");

    const p = players[currentPlayer] || defaultPlayerState(currentPlayer);

    if (!p.secretTokenActive || p.foulClearanceActive) {
      return alert("Player must have active secret token and no pending foul clearance.");
    }

    const ok = confirm(
  `Winning Ball Potted?\n\nDeclare ${currentPlayer} as the winner?\n\nAfter this, scoring buttons will be locked until Undo or Final Lock.`
);
if (!ok) return;

pushUndo(`Winner declared: ${currentPlayer}`);

    updatePlayer(currentPlayer, (old) => ({
      ...old,
      won: true,
    }));

    setState((s) => ({
      ...s,
      winner: currentPlayer,
      noWinner: false,
    }));

    addLog(currentPlayer, "WINNER", "Clean secret token pot into corner pocket.");
  }
function moveToNextPlayerAfterFoul() {
  if (!order.length) return;

  setCurrentIndex((prev) =>
    nextPlayableIndexFrom(prev, 1, order, players, state)
  );
}
 function nextPlayer() {
  if (!order.length) return;
  if (state.locked || state.winner) return;

  pushUndo("Next Player pressed");

  setCurrentIndex((prev) =>
    nextPlayableIndexFrom(prev, 1, order, players, state)
  );
}

  function previousPlayer() {
  if (!order.length) return;
  if (state.locked || state.winner) return;

  pushUndo("Previous Player pressed");

  setCurrentIndex((prev) =>
    nextPlayableIndexFrom(prev, -1, order, players, state)
  );
}

 function placeExtraReds() {
  if (state.locked) return alert("Game is locked.");
if (state.winner) return alert("Winner already declared. No more changes allowed. Use Final Lock.");

const info = kittyExtraRedInfo(state, players, logs);

  if (!info.allowedByRule) {
    return alert(
      "Extra reds cannot be placed now.\n\nRule: extra reds may be placed only after every qualifier or when only last 2 reds/non-token balls are left."
    );
  }

  if (info.placeableNow <= 0) {
    return alert(
      `No extra reds can be placed now.\n\nReds potted: ${info.totalRedsPotted}\nAlready placed: ${info.placed}\nExtra allowed: ${info.allowed}\nPending extra reds: ${info.pending}`
    );
  }

  const input = prompt(
    `How many extra reds to place?\n\nMaximum allowed now: ${info.placeableNow}\nPending extra reds: ${info.pending}`,
    String(info.placeableNow)
  );

  if (input === null) return;

  const qty = Math.max(0, Math.min(info.placeableNow, Number(input || 0)));
if (!qty) return;

pushUndo(`Extra reds placed: ${qty}`);

setState((s) => ({
    ...s,
    extraRedsPlaced: Number(s.extraRedsPlaced || 0) + qty,
    redsOnTable: Number(s.redsOnTable || 0) + qty,
  }));

  addLog("SYSTEM", "Extra reds placed", `${qty} placed on baulk line. Pending extra reds: ${Math.max(0, info.pending - qty)}.`);
}

  function markNoWinner() {
    if (!state.started) return alert("Start game first.");
    if (state.locked) return alert("Game is locked.");
    if (state.winner) return alert("Winner already declared. You cannot mark No Winner now.");
if (!noWinnerAllowed(state)) {
  alert(
    "No Winner can be declared only when all reds/non-token balls are finished and no extra reds are pending."
  );
  return;
}
    pushUndo("Marked No Winner");

const ok = confirm("Mark this game as NO WINNER?");
if (!ok) return;

let lockedAddOn = 0;
const willAdd = confirm("Will players add Kitty Add-on for the next game?");

if (willAdd) {
  const entered = prompt("Enter Kitty Add-on value for the next game:", "");
  if (entered === null) return;

  lockedAddOn = Math.max(0, Number(entered || 0));

  if (!Number.isFinite(lockedAddOn)) {
    alert("Invalid Kitty Add-on value.");
    return;
  }
}

setState((s) => {
  const endedAt = nowText();
  const startedAt = s.startedAt || s.createdAt || endedAt;
  const durationMinutes = minutesBetweenNumber(startedAt, endedAt);
  const previousHistory = Array.isArray(s.kittyRoundHistory)
    ? s.kittyRoundHistory
    : [];

  const noWinnerRound = {
    id: makeId("kitty_round"),
    gameNo: s.gameNo || "",
    kittyNo: Number(s.kittyNo || 1),
    label: `${ordinalShort(s.kittyNo || 1)} Kitty`,
    result: "NO WINNER",
    startedAt,
    endedAt,
    durationMinutes,
    kittyAddOn: lockedAddOn,
    order: [...(order || [])],
  };

  return {
    ...s,
    winner: "",
    noWinner: true,
    endedAt,
    duration: minutesBetween(startedAt, endedAt),
    kittyAddOn: lockedAddOn,
    kittyAddOns: [...(Array.isArray(s.kittyAddOns) ? s.kittyAddOns : []), lockedAddOn],
    kittyRoundHistory: [...previousHistory, noWinnerRound],
  };
});

addLog(
  "SYSTEM",
  "No winner",
  lockedAddOn > 0
    ? `Game ended without winner. Kitty Add-on locked: ${lockedAddOn}. Next game uses same order.`
    : "Game ended without winner. No Kitty Add-on. Next game uses same order."
);
  }

  const nextGameOrder = useMemo(() => {
    if (!order.length) return [];

    if (state.noWinner || !state.winner) {
      return [...order];
    }

    const winner = state.winner;
    const result = [];

    if (winner) result.push(winner);

    qualifierOrder.forEach((name) => {
      if (name && !result.includes(name)) result.push(name);
    });

    order.forEach((name) => {
      if (name && !result.includes(name)) result.push(name);
    });

    return result;
  }, [order, qualifierOrder, state.winner, state.noWinner]);

  async function lockFinal() {
  if (!state.started) return alert("Start game first.");
  if (state.locked) return alert("Game is already final locked.");

  if (!state.winner) {
    alert("Final Lock is allowed only after WON / WINNER is pressed.");
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

  const ok = confirm("Final Lock will freeze Kitty result and enable printing. Continue?");
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

  const finalRecord = buildFinalKittyRecord({
  state: finalState,
  order,
  players,
  logs,
  qualifierOrder,
  nextGameOrder,
});

saveKittySheet(finalRecord);

const cloudSaved = await saveKittyPlayerResultsToCloud({
  finalState,
  order,
  players,
  qualifierOrder,
  nextGameOrder,
  tableKey,
  tableLabel,
  playerPhones,
});

alert(
  cloudSaved
    ? "Kitty final locked. Local record and cloud player records saved. Print is now enabled."
    : "Kitty final locked locally. Cloud save was not completed. Print is now enabled."
);
}

  function printA4() {
  if (!state.locked) {
    alert("Print is enabled only after Final Lock.");
    return;
  }

  const html = buildA4Html({
    state,
    order,
    players,
    logs,
    winner: state.winner,
    nextOrder: nextGameOrder,
  });
  openPrintWindow("Kitty A4", html);
}
function kittyGameTypeText() {
  return isPoolKittyGame(state.gameType) ? "Pool Kitty" : "Snooker Kitty";
}

function kittyCountBeforeWinnerText() {
  const count = Math.max(0, Number(state.kittyNo || 1) - 1);
  return count <= 0 ? "0" : `${ordinalShort(count)} Kitty`;
}

function kittyTotalEntryRoundsText() {
  return String(Math.max(1, Number(state.kittyNo || 1)));
}

function kittySerialOrderLine() {
  return (order || []).length
    ? (order || []).map((name, index) => `${index + 1}. ${name}`).join(", ")
    : "—";
}

function kittyQualifierOrderLine() {
  return (qualifierOrder || []).length
    ? qualifierOrder.map((name, index) => `${index + 1}. ${name}`).join(", ")
    : "—";
}

function kittyNextGameOrderLine() {
  return (nextGameOrder || []).length
    ? nextGameOrder.map((name, index) => `${index + 1}. ${name}`).join(", ")
    : "—";
}

function kittyStatusForPlayer(name) {
  const p = players?.[name] || {};

  if (String(state.winner || "") === String(name)) return "WINNER";
  if (isPlayerOutOfGame(p, state)) return "OUT";
  if (p.secretTokenActive && !p.foulClearanceActive) return "QUALIFIED";
  if (Number(p.qualifiedCount || 0) > 0) return "QUALIFIED";
  if (state.noWinner) return "NO WINNER GAME";

  return "PLAYED";
}

function kittyPlayerSummaryLine() {
  return (order || []).length
    ? (order || [])
        .map((name) => {
          const p = players?.[name] || {};
          return `${name}: Reds ${Number(p.redsPotted || 0)}, Fouls ${Number(
            p.fouls || 0
          )}, HCP ${Number(p.handicapBalls || 0)}, Required ${Number(
            p.requiredBalls || state.baseTarget || 3
          )}, Status ${kittyStatusForPlayer(name)}`;
        })
        .join("; ")
    : "—";
}
function currentKittySettlementSummary() {
  return buildKittySettlementSummary({
    state: {
      ...state,
      players,
    },
    order,
  });
}

function kittyTableChargeDisplayText(summary) {
  const mode = summary?.tableChargeMode || "handled_separately";

  if (mode === "hide") return "Hidden from player result";
  if (mode === "handled_separately") return "Handled separately / prepaid";
  if (mode === "show_only") {
    return `Shown only: ₹${Number(summary?.roundedTableCharge || 0)}`;
  }
    if (mode === "paid_by_winner") {
  return `Paid by winner: ₹${Number(summary?.winnerTableCharge || 0)}`;
}
  if (mode === "include_split") {
    return `Included: ₹${Number(summary?.roundedTableCharge || 0)} total${
      Number(summary?.perPlayerTableCharge || 0)
        ? ` / ₹${Number(summary.perPlayerTableCharge)} each`
        : ""
    }`;
  }
  if (mode === "manual") return "Manual table charge";

  return "Handled separately / prepaid";
}

function kittySettlementOneLine() {
  const summary = currentKittySettlementSummary();

  return [
    `Kitty Entry: ${Number(summary.kittyEntry || 0)}`,
    `Out Penalty: ${Number(summary.outPenalty || 0)}`,
    `Kitty Points Won: ${Number(summary.grossKittyPoints || 0)}`,
    `Net Kitty Points: ${Number(summary.winnerNetKittyPoints || 0)}`,
    `Table Charge: ${kittyTableChargeDisplayText(summary)}`,
  ].join(" | ");
}
function kittyTemplateParams(name) {
  const summary = currentKittySettlementSummary();

  const displayRows = buildKittyDisplayPlayerResults({
    data: {
      ...state,
      players,
    },
    order,
  });

  const myRow =
    displayRows.find((row) => String(row.name) === String(name)) || null;

  const kittyAddOnText =
    Array.isArray(summary.kittyAddOns) && summary.kittyAddOns.length
      ? `${summary.kittyAddOns.join(" + ")} = ${Number(
          summary.totalKittyAddOnPerPlayer || 0
        )}`
      : "0";

  const playerSummaryForWhatsapp = displayRows.length
  ? displayRows
      .map((row) => {
        const p = players?.[row.name] || {};
        return `${row.name} ${row.status} ${row.resultLabel} R${Number(
          p.redsPotted || 0
        )} F${Number(p.fouls || 0)}`;
      })
      .join("; ")
  : "—";

  return [
    name || "Player",                                      // {{1}}
    state.gameNo || "—",                                  // {{2}}
    state.tableName || tableLabel || "—",                 // {{3}}
    kittyGameTypeText(),                                  // {{4}}

    state.endedAt || nowText(),                           // {{5}} Date
    state.startedAt || "—",                               // {{6}} Start Time
    state.endedAt || "—",                                 // {{7}} End Time
    state.duration || "—",                                // {{8}} Duration

    state.winner || "NO WINNER",                          // {{9}}

    String(Number(summary.kittyEntry || 0)),               // {{10}}
    String(Number(summary.outPenalty || 0)),               // {{11}}
    kittyAddOnText,                                       // {{12}}

    String(Number(summary.ballOutPayable || 0)),           // {{13}}
    String(Number(summary.notOutPayable || 0)),            // {{14}}

    myRow
      ? `${myRow.resultLabel} (${myRow.status})`
      : "—",                                              // {{15}}

    String(Number(summary.grossKittyPoints || 0)),         // {{16}}
    String(Number(summary.winnerNetKittyPoints || 0)),     // {{17}}

    playerSummaryForWhatsapp,                             // {{18}}

    String(kittySettlementTableChargeText(summary))
  .replace("Handled separately / prepaid", "Separate/prepaid")
  .replace("Hidden from player result", "Hidden")
  .replace("Paid by winner:", "Winner pays")
  .replace("Split equally:", "Split")
  .replace("Shown only:", "Shown")
  .replace("Manual:", "Manual"),                       // {{19}}              // {{19}}

    state.endedAt || nowText(),                            // {{20}}
  ];
}

function kittyPreviewText(name) {
  const params = kittyTemplateParams(name);

  return [
    `Hello ${params[0]},`,
    "",
    "Kitty Result - The Q Club Pasighat",
    "",
    `Game No: ${params[1]}`,
    `Table: ${params[2]}`,
    `Game Type: ${params[3]}`,
    "",
    `Date: ${params[4]}`,
    `Start Time: ${params[5]}`,
    `End Time: ${params[6]}`,
    `Duration: ${params[7]}`,
    "",
    `Winner: ${params[8]}`,
    "",
    `Kitty Entry: ${params[9]}`,
    `Ball Out Penalty: ${params[10]}`,
    `Kitty Add-on: ${params[11]}`,
    "",
    `Ball-out pays: ${params[12]}`,
    `Not-out pays: ${params[13]}`,
    "",
    `Your Result: ${params[14]}`,
    "",
    `Kitty Points Won by Winner: ${params[15]}`,
    `Winner Net Kitty Points: ${params[16]}`,
    "",
    "Player Summary:",
    params[17],
    "",
    `Table Charge: ${params[18]}`,
    "",
    `Final Locked At: ${params[19]}`,
    "",
    "Thank you for playing at The Q Club Pasighat.",
  ].join("\n");
}

async function sendKittyWhatsappResult(name) {
  if (!state.locked) {
    alert("Final Lock required before sending Kitty WhatsApp result.");
    return;
  }

  const key = kittyPlayerKey(name);
  const phone = normalizeKittyPhone(playerPhones[key] || "");

  if (!phone) {
    alert(`WhatsApp number missing for ${name}.`);
    return;
  }

  saveKittyPhonesToPhonebook();

  setKittyWhatsappSendStatus((prev) => ({
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
        templateName: KITTY_RESULT_TEMPLATE_NAME,
        templateParams: kittyTemplateParams(name),
        label: "Kitty Final Result",
        text: kittyPreviewText(name),
      }),
    });

    const json = await response.json().catch(() => null);

    if (!response.ok || !json?.ok) {
  throw new Error(
    json?.error ||
      json?.message ||
      json?.upstreamResponse?.message ||
      json?.upstreamResponse?.error ||
      json?.response?.message ||
      json?.response?.error ||
      `WhatsApp send failed with status ${response.status}`
  );
}

if (json?.dryRun) {
  throw new Error("DRY RUN ONLY - not sent to MSG91");
}

if (!json?.upstreamStatus && !json?.upstreamResponse) {
  throw new Error("No MSG91 upstream response - not confirmed sent");
}

setKittyWhatsappSendStatus((prev) => ({
  ...prev,
  [key]: "accepted by MSG91",
}));
  } catch (error) {
    console.error("Kitty WhatsApp send failed:", error);

    setKittyWhatsappSendStatus((prev) => ({
      ...prev,
      [key]: `failed: ${error?.message || "Unknown error"}`,
    }));
  }
}

function openKittyWhatsappPreview() {
  if (!state.locked) {
    alert("Final Lock required before sending Kitty WhatsApp result.");
    return;
  }

  saveKittyPhonesToPhonebook();
  setShowKittyWhatsappPreview(true);
}

function waitKittyWhatsapp(ms = 700) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function sendAllKittyWhatsappResults() {
  if (!state.locked) {
    alert("Final Lock required before sending Kitty WhatsApp result.");
    return;
  }

  if (kittyWhatsappSendAllRunning) return;

  const sendableNames = (order || []).filter((name) => {
    const key = kittyPlayerKey(name);
    const phone = normalizeKittyPhone(playerPhones[key] || "");
    const status = kittyWhatsappSendStatus[key] || "";
    return phone && status !== "sent";
  });

  const missingNames = (order || []).filter((name) => {
    const key = kittyPlayerKey(name);
    return !normalizeKittyPhone(playerPhones[key] || "");
  });

  if (!sendableNames.length) {
    alert(
      missingNames.length
        ? `No pending WhatsApp messages to send. Missing numbers: ${missingNames.join(", ")}`
        : "No pending WhatsApp messages to send."
    );
    return;
  }

  const ok = confirm(
    `Send Kitty final result to ${sendableNames.length} player(s)?\n\n` +
      `This will send one-by-one through MSG91.\n\n` +
      (missingNames.length
        ? `Skipped because number missing: ${missingNames.join(", ")}`
        : "")
  );

  if (!ok) return;

  saveKittyPhonesToPhonebook();
  setKittyWhatsappSendAllRunning(true);

  try {
    for (const name of sendableNames) {
      await sendKittyWhatsappResult(name);
      await waitKittyWhatsapp(700);
    }
  } finally {
    setKittyWhatsappSendAllRunning(false);
  }
}
  function print80() {
  if (!state.locked) {
    alert("Print is enabled only after Final Lock.");
    return;
  }

  const html = build80Html({
    state,
    order,
    players,
    winner: state.winner,
    nextOrder: nextGameOrder,
  });
  openPrintWindow("Kitty 80mm", html);
}

 function startNextGameFromCalculatedOrder() {
  if (!canStartCalculatedOrderGame(state)) {
    alert("Calculated Order new game is allowed only after Winner is declared and Final Lock is completed.");
    return;
  }

  const calculatedOrder = (nextGameOrder || [])
    .map(cleanName)
    .filter(Boolean);

  if (!calculatedOrder.length) {
    return alert("No calculated next game order available.");
  }

  const extraInput = prompt(
    "Add new players for next Kitty?\n\nThey will be added at the end of the calculated order.\n\nSeparate names with comma. Leave blank if none.",
    ""
  );

  if (extraInput === null) return;

  const newPlayers = String(extraInput || "")
    .split(",")
    .map(cleanName)
    .filter(Boolean)
    .filter((name) => !calculatedOrder.includes(name));

  const finalOrder = [...calculatedOrder, ...newPlayers];

  const nextPlayers = {};
  finalOrder.forEach((name) => {
    const hcp = kittyHandicapBalls(kittyHandicaps[kittyPlayerKey(name)] || 0);
const requiredBalls = kittyRequiredBalls(state.baseTarget, hcp);

nextPlayers[name] = {
  ...defaultPlayerState(name),
  handicapBalls: hcp,
  requiredBalls,
  needReasons: kittyNeedReasonsForPlayer(state.baseTarget, hcp),
  currentNeed: requiredBalls,
};
  });

  setOrder(finalOrder);
  setPlayers(nextPlayers);
  setQualifierOrder([]);
  setLogs([]);
  setCurrentIndex(0);
  setUndoStack([]);

  setPlayerInputs(() => {
    const padded = [...finalOrder];
    while (padded.length < 8) padded.push("");
    return padded;
  });

  setState((s) => ({
    ...s,
    gameId: makeId(),
    gameNo: gameNo(),
    kittyNo: 1,
    kittyLabel: "",
previousKittyResults: [],
kittyAddOn: 0,
kittyAddOns: [],
kittyRoundHistory: [],
    createdAt: nowText(),
    startedAt: nowText(),
    endedAt: "",
    duration: "",
    orderLocked: true,
    started: true,
    locked: false,
    winner: "",
    noWinner: false,
    redsOnTable: kittyDefaultRedsOnTable(s.gameType),
tokenBallsLeft: 6,
extraRedsPlaced: 0,
  }));

  addLog(
    "SYSTEM",
    "New game from calculated order",
    newPlayers.length
      ? `${finalOrder.join(" → ")}. New player(s) added last: ${newPlayers.join(", ")}`
      : finalOrder.join(" → ")
  );
}

  function unlockWithPin() {
    const pin = prompt("Enter Kitty / Q Chase access PIN");
    if (pin === null) return;

    if (String(pin).trim() !== rummyPin) {
      alert("Wrong PIN.");
      return;
    }

    try {
      localStorage.setItem("qclub_kitty_access", "yes");
    } catch {}

    setAllowed(true);
  }

  useEffect(() => {
    const snapshot = {
      tableKey,
      gameNo: state.gameNo,
kittyNo: state.kittyNo,
kittyLabel: `${ordinalShort(state.kittyNo || 1)} Kitty`,
previousKittyResults: state.previousKittyResults || [],
tableName: state.tableName,
      gameType: state.gameType,
      baseTarget: state.baseTarget,
      locked: state.locked,
      started: state.started,
      currentPlayer,
      currentStatus: playerStatusText(current, state.baseTarget),
      redsOnTable: state.redsOnTable,
tokenBallsLeft: state.tokenBallsLeft ?? 6,
extraRedsAllowed: state.extraRedsAllowed,
      extraRedsPlaced: state.extraRedsPlaced,
extraRedInfo: kittyExtraRedInfo(state, players, logs),
winner: state.winner,
      noWinner: state.noWinner,

      // Kitty settlement values needed by monitor display
      kittyEntry: state.kittyEntry,
      outPenalty: state.outPenalty,
      kittyAddOn: state.kittyAddOn,
      kittyAddOns: Array.isArray(state.kittyAddOns) ? state.kittyAddOns : [],
      kittyRoundHistory: Array.isArray(state.kittyRoundHistory) ? state.kittyRoundHistory : [],
      tableChargeMode: state.tableChargeMode,
      tableRatePerHour: state.tableRatePerHour,
      tableManualCharge: state.tableManualCharge,
      tableRoundingMode: state.tableRoundingMode,

      order,
      players,
      logs: logs.slice(-20),
      nextGameOrder,
    };

    saveDisplayState(tableKey, snapshot);
  }, [tableKey, state, currentPlayer, current, order, players, logs, nextGameOrder]);

  if (!hasAccess) {
    return (
      <>
        <PageShell
          title="Kitty"
          subtitle="PIN protected Kitty game scoring"
          noNav
        />
        <div className="container">
          <div className="card" style={{ maxWidth: 520, margin: "0 auto" }}>
            <h2 style={{ marginTop: 0 }}>Kitty Access</h2>
            <p className="muted">Enter access PIN to open Kitty scorer.</p>
            <button className="btn primary" type="button" onClick={unlockWithPin}>
              Enter PIN
            </button>
          </div>
        </div>
      </>
    );
  }
const extraInfo = kittyExtraRedInfo(state, players, logs);
  return (
    <>
      <PageShell
       title={`Kitty - ${tableLabel} - ${ordinalShort(state.kittyNo || 1)} Kitty`}
        subtitle="Secret token qualification game"
        noNav   
        right={
  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
    <QClubAccessBadge
      admin={admin}
      staffAdmin={staffAdmin}
      scorerMode={allowed && !admin && !staffAdmin}
      scorerLabel="KITTY SCORER PIN MODE"
    />
            <a className="btn" href={KITTY_TABLES[tableKey]?.displayPath || "/kitty-table-1-display"} target="_blank" rel="noreferrer">
              Open Display
            </a>
          </div>
        }
      />

      <div className="container">
        <div className="card">
          <h2 style={{ marginTop: 0 }}>Game Setup</h2>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
                        <label>
              Kitty Table
              <select
                value={state.gameType}
                disabled={state.started}
                onChange={(e) => {
                  const nextGameType = e.target.value;
                  const nextTable =
                    Object.values(KITTY_TABLES).find(
                      (table) => table.gameType === nextGameType
                    ) || currentKittyTableConfig;

                  if (nextTable.needsPin) {
                    const enteredPin = prompt("Enter PIN to select this 12x6 Snooker Table:");
                    const expectedPin = String(data?.admin?.rummyPin || "2468");

                    if (enteredPin !== expectedPin) {
                      alert("Wrong PIN. This table cannot be selected.");
                      return;
                    }
                  }

                  const nextReds = kittyDefaultRedsOnTable(nextGameType);

                  setState((s) => ({
                    ...s,
                    tableName: nextTable.displayName || nextTable.label,
                    gameType: nextGameType,
                    redsOnTable: nextReds,
                    startingRedsOnTable: nextReds,
                    tokenBallsLeft: 6,
                    tableRatePerHour: getKittyTableRate(
                      nextGameType,
                      nextTable.displayName || nextTable.label,
                      nextTable.key
                    ),
                  }));
                }}
              >
                <option value="snooker_ronnie_12x6">
                  Ronnie&apos;s Table 12x6 — Snooker 1 — 600/hr
                </option>
                <option value="snooker_mini_10x5">
                  Mini Snooker Table 10x5 — Snooker 2 — 500/hr
                </option>
                <option value="pool_american">
                  American Pool Table — Pool Table — 400/hr
                </option>
                <option value="snooker_extra_12x6">
                  Snooker Table 12x6 — PIN Required — 600/hr
                </option>
              </select>
            </label>

            <label>
              Reds to Qualify
              <input
                type="number"
                min="1"
                max="15"
                value={state.baseTarget}
                disabled={state.started}
                onChange={(e) =>
                  setState((s) => ({
                    ...s,
                    baseTarget: Math.max(1, Number(e.target.value || 1)),
                  }))
                }
              />
            </label>

            <label>
              Extra Reds Allowed
              <input
                type="number"
                min="0"
                value={state.extraRedsAllowed}
                disabled={state.started}
                onChange={(e) =>
                  setState((s) => ({
                    ...s,
                    extraRedsAllowed: Math.max(0, Number(e.target.value || 0)),
                  }))
                }
              />
            </label>

            <label>
              Reds / Non-token Balls on Table
              <input
                type="number"
                min="0"
                value={state.redsOnTable}
                disabled={state.started}
                onChange={(e) =>
                  setState((s) => ({
                    ...s,
                    redsOnTable: Math.max(0, Number(e.target.value || 0)),
                  }))
                }
              />
            </label>
          </div>

                    <div style={{ marginTop: 12 }}>
            <b>Token rule:</b>{" "}
            {isPoolKittyGame(state.gameType)
  ? "American Pool Kitty uses token balls 10 to 15. All other balls are treated like reds."
  : `${kittyGameTypeTextFromValue(state.gameType)} uses 6 colour balls as secret token balls.`}
          </div>

          <div
            style={{
              marginTop: 16,
              paddingTop: 14,
              borderTop: "1px solid rgba(255,255,255,0.12)",
            }}
          >
            <h3 style={{ margin: "0 0 10px" }}>Kitty Settlement Setup</h3>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 10,
              }}
            >
              <label>
  Kitty Entry
  <input
    type="number"
    min="0"
    value={state.kittyEntry ?? ""}
    disabled={state.started}
    placeholder="Enter Kitty Entry"
    onChange={(e) =>
      setState((s) => ({
        ...s,
        kittyEntry: e.target.value,
      }))
    }
  />
</label>

<label>
  Out Penalty
  <input
    type="number"
    min="0"
    value={state.outPenalty ?? ""}
    disabled={state.started}
    placeholder="Enter Out Penalty"
    onChange={(e) =>
      setState((s) => ({
        ...s,
        outPenalty: e.target.value,
      }))
    }
  />
</label>

              

              <label>
                Table Charge Handling
                <select
                  value={state.tableChargeMode || "handled_separately"}
                  disabled={state.started}
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      tableChargeMode: e.target.value,
                    }))
                  }
                >
                  <option value="handled_separately">Handled separately / prepaid</option>
                  <option value="include_split">Include and split equally</option>
                  <option value="paid_by_winner">Paid by winner</option>
                  <option value="show_only">Show only, do not settle</option>
                  <option value="hide">Hide from player result</option>
                  <option value="manual">Manual table charge</option>
                </select>
              </label>

              <label>
  Table Rate Per Hour
  <input
    type="number"
    min="0"
    value={state.tableRatePerHour || 0}
    disabled
    title="Auto-fixed based on selected game/table: Pool 400, Mini Snooker 500, Ronnie/12x6 600"
  />
</label>
<label>
  Manual Table Charge
  <input
    type="number"
    min="0"
    value={state.tableManualCharge ?? ""}
    disabled={state.started || state.tableChargeMode !== "manual"}
    placeholder="Enter table charge"
    onChange={(e) =>
      setState((s) => ({
        ...s,
        tableManualCharge: e.target.value,
      }))
    }
  />
</label>

              <label>
                Table Rounding
                <select
                  value={state.tableRoundingMode || "round_up"}
                  disabled={state.started || state.tableChargeMode === "hide"}
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      tableRoundingMode: e.target.value,
                    }))
                  }
                >
                  <option value="round_up">Round up: 5 min / 50</option>
                  <option value="nearest">Nearest: 5 min / 50</option>
                </select>
              </label>
            </div>

            <div className="muted" style={{ marginTop: 8 }}>
              Kitty Entry and Out Penalty are game values. Table charge is optional and can be hidden,
              shown separately, prepaid, or included in the final settlement.
            </div>
          </div>
        </div>

        {!state.started ? (
          <div className="card">
            <h2 style={{ marginTop: 0 }}>Players</h2>

            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 10 }}>
  {playerInputs.map((name, idx) => (
    <div key={idx}>
      <label className="lbl">Player {idx + 1}</label>

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
          placeholder={`Player ${idx + 1}`}
          onChange={(e) => updateKittyPlayerName(idx, e.target.value)}
        />

        <input
          type="number"
          value={kittyHandicaps[kittyPlayerKey(name)] ?? ""}
          disabled={state.started}
          placeholder="HCP"
          title="Kitty handicap balls. Example: HCP 1 means player needs one ball less."
          min="0"
          onChange={(e) => {
            const key = kittyPlayerKey(name);
            if (!key) return;

            setKittyHandicaps((prev) => ({
              ...prev,
              [key]: kittyHandicapBalls(e.target.value),
            }));
          }}
          style={{
            textAlign: "center",
            fontWeight: 900,
          }}
        />
      </div>

      <input
        value={playerPhones[kittyPlayerKey(name)] || ""}
        disabled={state.started}
        placeholder="WhatsApp number"
        onChange={(e) => {
          const key = kittyPlayerKey(name);
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

      <div className="muted" style={{ marginTop: 5, fontSize: 12 }}>
        Needs {kittyRequiredBalls(state.baseTarget, kittyHandicaps[kittyPlayerKey(name)] || 0)} ball(s) to qualify
      </div>
    </div>
  ))}
</div>
<div className="muted" style={{ marginTop: 8 }}>
  New game buttons are locked during active play. “No Winner” works only when all reds/non-token balls are finished with no extra reds pending, or when all token/colour balls are gone.
</div>
            <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
              <button
  className="btn primary"
  type="button"
  onClick={lockRandomOrder}
  disabled={
  state.started ||
  state.orderLocked ||
  order.length > 0 ||
  !!validateKittySettlementBeforeStart(state)
}
  title={
  validateKittySettlementBeforeStart(state) ||
  (state.started || state.orderLocked || order.length > 0
    ? "Serial order already drawn. Redraw is not allowed."
    : "Draw serial order and start Kitty game")
}
>
  {state.started || state.orderLocked || order.length > 0
    ? "Serial Order Drawn"
    : "Draw Serial Order & Start"}
</button>

              <button
                className="btn"
                type="button"
                onClick={() => setPlayerInputs((prev) => [...prev, ""])}
              >
                + Add Player
              </button>
              <button
  className="btn danger"
  type="button"
  onClick={resetKittyWithPin}
>
  Reset Kitty
</button>
            </div>
          </div>
        ) : null}

        {state.started ? (
          <>
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Live Status</h2>

              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 10 }}>
                <div className="card" style={{ margin: 0 }}>
                  <div className="muted">Current Player</div>
                  <h2 style={{ margin: "4px 0" }}>{currentPlayer || "—"}</h2>
                  <div style={{ marginTop: 6 }}>{renderNeedBalls(current, state.baseTarget, { state })}</div>
                </div>

                <div className="card" style={{ margin: 0 }}>
                  <div className="muted">Reds on Table</div>
                  <h2 style={{ margin: "4px 0" }}>{state.redsOnTable}</h2>
                  <div>Token balls left: {state.tokenBallsLeft ?? 6}</div>
<div>Extra placed: {state.extraRedsPlaced} / {state.extraRedsAllowed}</div>
<div>Pending extra: {extraInfo.pending}</div>
<div>Can place now: {extraInfo.placeableNow}</div>
                </div>

                <div className="card" style={{ margin: 0 }}>
                  <div className="muted">Winner</div>
                  <h2 style={{ margin: "4px 0" }}>{state.winner || (state.noWinner ? "NO WINNER" : "—")}</h2>
                  <div>{state.locked ? "FINAL LOCKED" : "Running"}</div>
                </div>
              </div>

              <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button className="btn" type="button" onClick={previousPlayer} disabled={state.locked || state.winner}>
                  Previous Player
                </button>

                <button className="btn primary" type="button" onClick={nextPlayer} disabled={state.locked || state.winner}>
                  Next Player
                </button>

                <button className="btn" type="button" onClick={placeExtraReds} disabled={state.locked || state.winner}>
                  Place Extra Reds
                </button>
              </div>
            </div>

            <div className="card">
              <h2 style={{ marginTop: 0 }}>Scoring Buttons</h2>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button className="btn primary" type="button" onClick={addRed} disabled={state.locked || state.winner}>
                  + Red / Non-token Ball Potted
                </button>

                <button className="btn danger" type="button" onClick={addFoul} disabled={state.locked || state.winner}>
                  Foul +1
                </button>
                <button
  className="btn danger"
  type="button"
  onClick={addRedsWithFoul}
  disabled={state.locked || state.winner}
>
  Red(s) + Foul
</button>

<button
  className="btn"
  type="button"
  onClick={markTokenBallGone}
  disabled={state.locked || state.winner || Number(state.tokenBallsLeft ?? 6) <= 0}
>
  Token Ball Gone
</button>

                <button className="btn" type="button" onClick={declareDead} disabled={state.locked || state.winner}>
                  Declare DEAD
                </button>

                <button
  className="btn primary"
  type="button"
  onClick={cleanTokenWin}
  disabled={
    state.locked ||
    !current?.secretTokenActive ||
    current?.foulClearanceActive ||
    state.winner
  }
>
  Winning Ball Potted
</button>

<button
  className="btn"
  type="button"
  onClick={undoLastAction}
  disabled={state.locked || undoStack.length === 0}
>
  Undo Last Action
</button>
              </div>

              <div className="muted" style={{ marginTop: 10 }}>
                Secret token value is not shown or stored here. Player may declare Dead only after foul clearance is complete.
              </div>
            </div>

            <div className="card">
              <h2 style={{ marginTop: 0 }}>Players Summary</h2>

              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", padding: 8 }}>Order</th>
                      <th style={{ textAlign: "left", padding: 8 }}>Player</th>
                      <th style={{ textAlign: "left", padding: 8 }}>Reds</th>
                      <th style={{ textAlign: "left", padding: 8 }}>Fouls</th>
                      <th style={{ textAlign: "left", padding: 8 }}>Qualified</th>
                      <th style={{ textAlign: "left", padding: 8 }}>Dead</th>
                      <th style={{ textAlign: "left", padding: 8 }}>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {order.map((name, index) => {
                      const p = players[name] || defaultPlayerState(name);
                      const active = name === currentPlayer;
                      return (
                        <tr key={name} style={{ background: active ? "rgba(255, 215, 0, 0.12)" : "transparent" }}>
                          <td style={{ padding: 8 }}>{index + 1}</td>
                          <td style={{ padding: 8 }}><b>{name}</b></td>
                          <td style={{ padding: 8 }}>{p.redsPotted}</td>
                          <td style={{ padding: 8 }}>{p.fouls}</td>
                          <td style={{ padding: 8 }}>{p.qualifiedCount}</td>
                          <td style={{ padding: 8 }}>{p.deadCount}</td>
                          <td style={{ padding: 8 }}>{renderNeedBalls(p, state.baseTarget, { state })}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="card">
              <h2 style={{ marginTop: 0 }}>Next Game Order</h2>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {nextGameOrder.map((name, index) => (
                  <div key={`${name}_${index}`} className="badge">
                    {index + 1}. {name}
                  </div>
                ))}
              </div>

              <div style={{ marginTop: 12, display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
  className="btn"
  type="button"
  onClick={markNoWinner}
  disabled={state.locked || state.winner || !noWinnerAllowed(state)}
>
  End Game - No Winner
</button>

               <button
  className="btn"
  type="button"
  onClick={startSameOrder}
  disabled={!canStartSameOrderGame(state)}
>
  {state.noWinner ? `${ordinalShort(Number(state.kittyNo || 1) + 1)} Kitty - Same Order` : "New Game Same Order"}
</button>

                <button
  className="btn primary"
  type="button"
  onClick={startNextGameFromCalculatedOrder}
  disabled={!canStartCalculatedOrderGame(state)}
>
  New Game From Calculated Order
</button>
<button
  className="btn danger"
  type="button"
  onClick={resetKittyWithPin}
>
  Reset Kitty
</button>
              </div>
            </div>
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Kitty Settlement Preview</h2>

              {(() => {
                const summary = currentKittySettlementSummary();

                return (
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                      gap: 10,
                    }}
                  >
                    <div className="card" style={{ margin: 0 }}>
                      <div className="muted">Kitty Entry</div>
                      <h2 style={{ margin: "4px 0" }}>{summary.kittyEntry}</h2>
                    </div>

                    <div className="card" style={{ margin: 0 }}>
                      <div className="muted">Out Penalty</div>
                      <h2 style={{ margin: "4px 0" }}>{summary.outPenalty}</h2>
                    </div>

                    <div className="card" style={{ margin: 0 }}>
                      <div className="muted">Locked Kitty Add-ons</div>
<h2 style={{ margin: "4px 0" }}>{summary.totalKittyAddOnPerPlayer}</h2>
<div className="muted">
  Add-ons: {Array.isArray(summary.kittyAddOns) && summary.kittyAddOns.length
    ? summary.kittyAddOns.join(" + ")
    : "None"}
</div>
                    </div>

                    <div className="card" style={{ margin: 0 }}>
                      <div className="muted">Kitty Points Won</div>
                      <h2 style={{ margin: "4px 0" }}>{summary.grossKittyPoints}</h2>
                    </div>

                    <div className="card" style={{ margin: 0 }}>
                      <div className="muted">Winner Net Kitty Points</div>
                      <h2 style={{ margin: "4px 0" }}>{summary.winnerNetKittyPoints}</h2>
                    </div>

                    <div className="card" style={{ margin: 0 }}>
                      <div className="muted">Table Charge</div>
                      <h2 style={{ margin: "4px 0" }}>
                        {summary.tableChargeMode === "hide"
                          ? "Hidden"
                          : summary.tableChargeMode === "handled_separately"
                          ? "Separate"
                          : summary.tableChargeMode === "manual"
                          ? "Manual"
                          : `₹${summary.roundedTableCharge}`}
                      </h2>
                      <div className="muted">
                        {kittyTableChargeDisplayText(summary)}
                      </div>
                    </div>
                  </div>
                );
              })()}

              <div className="muted" style={{ marginTop: 10 }}>
                {kittySettlementOneLine()}
              </div>
            </div>
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Final / Print</h2>

              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <button
  className="btn danger"
  type="button"
  onClick={lockFinal}
  disabled={state.locked || !state.winner}
>
  Final Lock
</button>

                <button className="btn" type="button" onClick={printA4} disabled={!state.locked}>
  Print A4
</button>

                <button className="btn" type="button" onClick={print80} disabled={!state.locked}>
  Print 80mm
</button>
<button
  className="btn warn"
  type="button"
  onClick={openKittyWhatsappPreview}
  disabled={!state.locked}
  title={state.locked ? "Preview and send Kitty WhatsApp result messages" : "Final Lock required"}
>
  WhatsApp Results
</button>
              </div>
            </div>
{showKittyWhatsappPreview ? (
  <div
    style={{
      position: "fixed",
      inset: 0,
      zIndex: 9999,
      background: "rgba(0,0,0,.72)",
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "center",
      padding: 18,
      overflow: "auto",
    }}
  >
<div
  className="card"
  style={{
    width: "min(980px, 96vw)",
    maxHeight: "92vh",
    overflow: "auto",
    border: "1px solid rgba(255,255,255,.22)",
    background: "#111827",
    color: "#f8fafc",
    boxShadow: "0 24px 80px rgba(0,0,0,.75)",
  }}
>
      <div
        className="row"
        style={{
          justifyContent: "space-between",
          gap: 10,
          alignItems: "center",
          marginBottom: 12,
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>Kitty WhatsApp Result Preview</h2>
          <div className="muted">
            Template: {KITTY_RESULT_TEMPLATE_NAME}. Review each result before sending.
          </div>
        </div>

        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button
            className="btn primary"
            type="button"
            onClick={sendAllKittyWhatsappResults}
            disabled={kittyWhatsappSendAllRunning}
          >
            {kittyWhatsappSendAllRunning ? "Sending..." : "Send All via MSG91"}
          </button>

          <button
            className="btn danger"
            type="button"
            onClick={() => setShowKittyWhatsappPreview(false)}
          >
            Close
          </button>
        </div>
      </div>

      <div
        style={{
          marginBottom: 14,
          padding: 12,
          borderRadius: 14,
          border: "1px solid rgba(245,181,70,.35)",
          background: "rgba(245,181,70,.12)",
        }}
      >
        <b>Important:</b> This sends through MSG91 using the approved Kitty template only.
        It does not use normal WhatsApp chatting.
      </div>

      <div style={{ display: "grid", gap: 12 }}>
        {(order || []).map((name) => {
          const key = kittyPlayerKey(name);
          const phone = normalizeKittyPhone(playerPhones[key] || "");
          const status = kittyWhatsappSendStatus[key] || "Not sent";

          return (
            <div
              key={key || name}
              style={{
                border: "1px solid rgba(255,255,255,.12)",
                borderRadius: 16,
                padding: 12,
                background: "#1f2937",
              }}
            >
              <div
                className="row"
                style={{
                  justifyContent: "space-between",
                  gap: 10,
                  alignItems: "center",
                }}
              >
                <div>
                  <b>
                    {name} • {kittyStatusForPlayer(name)}
                  </b>
                  <div className="muted">
                    Phone: {phone || "Missing"} • Status: {status}
                  </div>
                </div>

                <div className="row" style={{ gap: 8 }}>
                  {!phone ? (
                    <span className="badge" style={{ color: "#f5b546" }}>
                      Missing number
                    </span>
                  ) : null}

                  <button
                    className="btn warn"
                    type="button"
                    onClick={() => sendKittyWhatsappResult(name)}
                    disabled={!phone || status === "sending"}
                  >
                    {status === "sending"
                      ? "Sending..."
                      : status === "sent"
                      ? "Sent ✓"
                      : "Send via MSG91"}
                  </button>
                </div>
              </div>

              <textarea
                readOnly
                value={kittyPreviewText(name)}
                style={{
                  width: "100%",
                  minHeight: 220,
                  marginTop: 10,
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
            </div>
          );
        })}
      </div>
    </div>
  </div>
) : null}
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Audit Log</h2>

              {logs.length === 0 ? (
                <div className="muted">No actions yet.</div>
              ) : (
                <div style={{ display: "grid", gap: 6 }}>
                  {logs.slice().reverse().map((l) => (
                    <div key={l.id} style={{ borderBottom: "1px solid rgba(255,255,255,.08)", paddingBottom: 6 }}>
                      <b>{l.name || "SYSTEM"}</b> — {l.action}
                      <div className="muted">{l.time} {l.detail ? `• ${l.detail}` : ""}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        ) : null}
      </div>
    </>
  );
}

export function KittyDisplayPage({
  tableKey = "table1",
  tableLabel = "Snooker Table 1",
}) {
  const [snapshot, setSnapshot] = useState(() => loadDisplayState(tableKey));

  useEffect(() => {
    function refresh() {
      setSnapshot(loadDisplayState(tableKey));
    }

    refresh();

    window.addEventListener(`qclub-kitty-display-update-${tableKey}`, refresh);
    window.addEventListener("storage", refresh);

    const timer = setInterval(refresh, 2000);

    return () => {
      window.removeEventListener(`qclub-kitty-display-update-${tableKey}`, refresh);
      window.removeEventListener("storage", refresh);
      clearInterval(timer);
    };
  }, [tableKey]);

  const data = snapshot || {};
  const order = Array.isArray(data.order) ? data.order : [];
  const players = data.players || {};

  const displayExtraInfo = data.extraRedInfo || {
    allowed: data.extraRedsAllowed || 0,
    placed: data.extraRedsPlaced || 0,
    pending: Math.max(
      0,
      Number(data.extraRedsAllowed || 0) - Number(data.extraRedsPlaced || 0)
    ),
    placeableNow: 0,
    ruleText:
      "Extra reds may be placed only after every qualifier or when only last 2 reds/non-token balls are left. The number placed cannot exceed reds/non-token balls already potted.",
  };

  const settlementSummary = buildKittySettlementSummary({
    state: data,
    order,
  });

  const lockedRows = buildKittyDisplayPlayerResults({
    data,
    order,
  });

  function qualifierDisplayText(name) {
    const p = players?.[name] || {};
    const rank = Number(p.qualifierRank || 0);

    if (rank > 0) return `${ordinal(rank)} QUALIFIER`;
    if (Number(p.qualifiedCount || 0) > 0) return "QUALIFIED";

    return "DID NOT QUALIFY";
  }

  function rowBg(row, active) {
    if (row?.isWinner) return "linear-gradient(90deg, rgba(16,185,129,.30), rgba(16,185,129,.16))";
    if (row?.isOut) return "linear-gradient(90deg, rgba(127,29,29,.42), rgba(127,29,29,.20))";
    if (active) return "linear-gradient(90deg, rgba(250,204,21,.22), rgba(250,204,21,.08))";
    return "rgba(255,255,255,.055)";
  }

  const statusText = data.locked ? "FINAL LOCKED" : data.started ? "LIVE" : "WAITING";
  const winnerText = data.winner || (data.noWinner ? "NO WINNER" : "—");

  const panelStyle = {
    border: "1px solid rgba(255,255,255,.14)",
    borderRadius: 18,
    background: "linear-gradient(180deg, rgba(255,255,255,.07), rgba(255,255,255,.035))",
    boxShadow: "0 18px 44px rgba(0,0,0,.34)",
  };

  const labelStyle = {
    opacity: 0.7,
    fontSize: 13,
    fontWeight: 900,
    letterSpacing: ".04em",
    textTransform: "uppercase",
  };
  const livePlayerCount = Math.max(1, order.length || 1);

  const liveNameFont =
    livePlayerCount <= 4 ? 38 : livePlayerCount <= 6 ? 32 : 28;

  const liveNumberFont =
    livePlayerCount <= 4 ? 34 : livePlayerCount <= 6 ? 30 : 25;

  const liveBallSize =
    livePlayerCount <= 4 ? 44 : livePlayerCount <= 6 ? 38 : 34;

  const liveStatusFont =
    livePlayerCount <= 4 ? 16 : livePlayerCount <= 6 ? 15 : 14;

  const liveRowPadding =
    livePlayerCount <= 4 ? "18px 18px" : livePlayerCount <= 6 ? "14px 16px" : "11px 14px";
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 999999,
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top left, rgba(112,26,117,.35), transparent 32%), radial-gradient(circle at bottom right, rgba(127,29,29,.28), transparent 38%), #05010a",
        color: "#fff",
        padding: "18px 20px",
        overflow: "auto",
      }}
    >
      <div style={{ maxWidth: 1580, margin: "0 auto" }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.4fr .8fr",
            gap: 14,
            alignItems: "stretch",
            marginBottom: 14,
          }}
        >
          <div
            style={{
              ...panelStyle,
              padding: "14px 18px",
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 16,
            }}
          >
            <div>
              <h1
                style={{
                  margin: 0,
                  fontSize: 38,
                  lineHeight: 1,
                  fontWeight: 1000,
                  letterSpacing: "-.03em",
                }}
              >
                THE Q CLUB KITTY
              </h1>
              <div style={{ marginTop: 6, fontSize: 21, fontWeight: 900, opacity: 0.9 }}>
                {tableLabel} • {kittyRoundDisplayText(data)}
              </div>
            </div>

            <div style={{ textAlign: "right" }}>
              <div style={labelStyle}>Game No</div>
              <div style={{ fontSize: 24, fontWeight: 1000 }}>
                {data.gameNo || "No Game"}
              </div>
            </div>
          </div>

          <div
            style={{
              ...panelStyle,
              padding: "14px 18px",
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 14,
              alignItems: "center",
            }}
          >
            <div>
              <div style={labelStyle}>Status</div>
              <div
                style={{
                  marginTop: 4,
                  fontSize: 31,
                  fontWeight: 1000,
                  lineHeight: 1,
                  color: data.locked ? "#34d399" : data.started ? "#facc15" : "#e5e7eb",
                }}
              >
                {statusText}
              </div>
            </div>

            <div style={{ textAlign: "right" }}>
              <div style={labelStyle}>Winner</div>
              <div
                style={{
                  marginTop: 4,
                  fontSize: 31,
                  fontWeight: 1000,
                  lineHeight: 1,
                  color: data.winner ? "#34d399" : data.noWinner ? "#fb7185" : "#e5e7eb",
                }}
              >
                {winnerText}
              </div>
            </div>
          </div>
        </div>

        {data.locked ? (
          <>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1.25fr .8fr .9fr",
                gap: 12,
                marginBottom: 12,
              }}
            >
              <div style={{ ...panelStyle, padding: 14 }}>
                <div style={labelStyle}>Game Details</div>
                <div style={{ marginTop: 4, fontSize: 24, fontWeight: 1000 }}>
                  {kittyGameTypeTextFromValue(data.gameType)}
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "repeat(3, 1fr)",
                    gap: "6px 14px",
                    marginTop: 8,
                    fontSize: 15,
                    fontWeight: 850,
                  }}
                >
                  <div>{kittyRoundDisplayText(data)}</div>
                  <div>Entry: <b>{settlementSummary.kittyEntry}</b></div>
                  <div>Ball Out: <b>{settlementSummary.outPenalty}</b></div>
                  <div>Add-on: <b>{settlementSummary.totalKittyAddOnPerPlayer || "None"}</b></div>
                  <div>Ball-out pays: <b>{settlementSummary.ballOutPayable}</b></div>
                  <div>Not-out pays: <b>{settlementSummary.notOutPayable}</b></div>
                </div>
              </div>

              <div style={{ ...panelStyle, padding: 14 }}>
                <div style={labelStyle}>Winner</div>
                <div style={{ marginTop: 4, fontSize: 34, fontWeight: 1000, lineHeight: 1 }}>
                  {winnerText}
                </div>
                {data.winner ? (
                  <div
                    style={{
                      display: "inline-flex",
                      marginTop: 12,
                      padding: "8px 13px",
                      borderRadius: 999,
                      background: "#10b981",
                      color: "#03150e",
                      fontWeight: 1000,
                    }}
                  >
                    WINNER
                  </div>
                ) : null}
              </div>

              <div style={{ ...panelStyle, padding: 14 }}>
                <div style={labelStyle}>Reds / Non-token Balls</div>
                <div style={{ marginTop: 2, fontSize: 38, fontWeight: 1000, lineHeight: 1 }}>
                  {data.redsOnTable ?? "—"}
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "3px 12px",
                    marginTop: 8,
                    fontSize: 14,
                    fontWeight: 850,
                  }}
                >
                  <div>Base: <b>{data.baseTarget || "—"}</b></div>
                  <div>Token: <b>{data.tokenBallsLeft ?? 6}</b></div>
                  <div>Extra: <b>{displayExtraInfo.placed} / {displayExtraInfo.allowed}</b></div>
                  <div>Pending: <b>{displayExtraInfo.pending}</b></div>
                  <div>Can place: <b>{displayExtraInfo.placeableNow}</b></div>
                </div>
              </div>
            </div>

            <div
              style={{
                ...panelStyle,
                padding: "10px 14px",
                marginBottom: 12,
                fontSize: 15,
                fontWeight: 900,
                lineHeight: 1.3,
              }}
            >
              <b>Extra red rule:</b> {displayExtraInfo.ruleText}
            </div>

            <div style={{ ...panelStyle, padding: 14 }}>
              <h2 style={{ margin: "0 0 12px", fontSize: 22 }}>
                Kitty Result List
              </h2>

              <div style={{ display: "grid", gap: 8 }}>
                {lockedRows.length ? (
                  lockedRows.map((row, index) => {
                    const p = players?.[row.name] || defaultPlayerState(row.name);

                    return (
                      <div
                        key={`${row.name}_${index}`}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "54px 1.4fr 170px 120px 120px 150px 150px 150px",
                          gap: 12,
                          alignItems: "center",
                          minHeight: 44,
padding: "7px 10px",
                          borderRadius: 13,
                          background: rowBg(row, false),
                          border: row.isWinner
                            ? "1px solid rgba(52,211,153,.45)"
                            : row.isOut
                            ? "1px solid rgba(248,113,113,.22)"
                            : "1px solid rgba(255,255,255,.08)",
                        }}
                      >
                        <div style={{ fontSize: 24, fontWeight: 1000 }}>{index + 1}</div>

                        <div
  style={{
    fontSize: 22,
    fontWeight: 1000,
    lineHeight: 1,
    whiteSpace: "nowrap",
  }}
>
  {row.name}
</div>

<div>
  <span
    style={{
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      padding: "4px 9px",
      borderRadius: 999,
      background:
        Number(p.qualifierRank || 0) > 0
          ? "linear-gradient(135deg, #f6d365, #fda085)"
          : "rgba(255,255,255,.12)",
      color:
        Number(p.qualifierRank || 0) > 0
          ? "#231300"
          : "rgba(255,255,255,.78)",
      fontSize: 10,
      fontWeight: 1000,
      letterSpacing: ".02em",
      whiteSpace: "nowrap",
    }}
  >
    {qualifierDisplayText(row.name)}
  </span>
</div>
                        <div style={{ fontSize: 16, fontWeight: 850 }}>
                          Reds: {Number(p.redsPotted || 0)}
                        </div>

                        <div style={{ fontSize: 16, fontWeight: 850 }}>
                          Fouls: {Number(p.fouls || 0)}
                        </div>

                        <div>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              padding: "7px 12px",
                              borderRadius: 999,
                              background: row.isWinner
                                ? "#10b981"
                                : row.isOut
                                ? "#ef4444"
                                : "rgba(255,255,255,.18)",
                              color: row.isWinner ? "#03150e" : "#fff",
                              fontWeight: 1000,
                              fontSize: 13,
                              whiteSpace: "nowrap",
                            }}
                          >
                            {row.status}
                          </span>
                        </div>

                        <div style={{ fontSize: 15, opacity: 0.84 }}>
                          {row.resultNote || "—"}
                        </div>

                        <div
                          style={{
                            textAlign: "right",
                            fontSize: 28,
                            fontWeight: 1000,
                            color:
                              row.resultValue > 0
                                ? "#34d399"
                                : row.resultValue < 0
                                ? "#fb7185"
                                : "#e5e7eb",
                          }}
                        >
                          {row.resultLabel}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div
                    style={{
                      padding: 18,
                      borderRadius: 14,
                      background: "rgba(255,255,255,.06)",
                      fontSize: 18,
                      fontWeight: 900,
                      opacity: 0.8,
                    }}
                  >
                    Waiting for Kitty game data...
                  </div>
                )}
              </div>
            </div>

            <div style={{ ...panelStyle, padding: 14, marginTop: 12 }}>
              <h2 style={{ margin: "0 0 10px", fontSize: 20 }}>Next Game Order</h2>

              <div style={{ display: "flex", gap: 9, flexWrap: "wrap" }}>
                {(data.nextGameOrder || []).length ? (
                  (data.nextGameOrder || []).map((name, index) => (
                    <div
                      key={`${name}_${index}`}
                      style={{
                        padding: "9px 13px",
                        borderRadius: 999,
                        background: "rgba(255,255,255,.13)",
                        border: "1px solid rgba(255,255,255,.12)",
                        fontSize: 17,
                        fontWeight: 1000,
                      }}
                    >
                      {index + 1}. {name}
                    </div>
                  ))
                ) : (
                  <div style={{ fontSize: 18, opacity: 0.75, fontWeight: 800 }}>
                    —
                  </div>
                )}
              </div>
            </div>
          </>
        ) : (
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(850px, 1.7fr) minmax(400px, .8fr)",
              gap: 14,
              alignItems: "start",
            }}
          >
            <div
              style={{
                ...panelStyle,
                padding: 14,
                minHeight: "calc(100vh - 160px)",
              }}
            >
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "70px 1.5fr 120px 110px 1.4fr",
                  gap: 12,
                  padding: "0 10px 10px",
                  borderBottom: "1px solid rgba(255,255,255,.12)",
                  color: "rgba(255,255,255,.7)",
                  fontSize: 13,
                  fontWeight: 900,
                  textTransform: "uppercase",
                  letterSpacing: ".04em",
                }}
              >
                <div>Order</div>
                <div>Player</div>
                <div>Reds</div>
                <div>Fouls</div>
                <div>Status</div>
              </div>

                            <div
                style={{
                  display: "grid",
                  gap: livePlayerCount <= 4 ? 14 : livePlayerCount <= 6 ? 11 : 8,
                  marginTop: 10,
                  height: order.length ? "calc(100vh - 285px)" : "auto",
                  gridTemplateRows: order.length
                    ? `repeat(${order.length}, minmax(0, 1fr))`
                    : undefined,
                }}
              >
                {order.length ? (
                  order.map((name, index) => {
                    const p = players?.[name] || defaultPlayerState(name);
                    const active = name === data.currentPlayer;
                    const isOut = isPlayerOutOfGame(p, data);

                    return (
                      <div
                        key={`${name}_${index}`}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "70px 1.5fr 120px 110px 1.4fr",
                          gap: 12,
                          alignItems: "center",
                          borderRadius: 15,
                                                    padding: liveRowPadding,
                          minHeight: 0,
                          background: rowBg({ isOut }, active),
                          border: active
                            ? "1px solid rgba(250,204,21,.45)"
                            : "1px solid rgba(255,255,255,.08)",
                        }}
                      >
                                                <div style={{ fontSize: liveNumberFont, fontWeight: 1000 }}>
                          {index + 1}
                        </div>

                        <div>
                                                    <div style={{ fontSize: liveNameFont, fontWeight: 1000, lineHeight: 1 }}>
                            {name}
                          </div>
                          {active ? (
                            <div
                              style={{
                                marginTop: 5,
                                fontSize: 12,
                                fontWeight: 1000,
                                color: "#facc15",
                              }}
                            >
                              CURRENT PLAYER
                            </div>
                          ) : null}
                        </div>

                                                <div style={{ fontSize: liveNumberFont, fontWeight: 950 }}>
                          {Number(p.redsPotted || 0)}
                        </div>

                                                <div style={{ fontSize: liveNumberFont, fontWeight: 950 }}>
                          {Number(p.fouls || 0)}
                        </div>

                        <div>
                                                    {renderNeedBalls(p, data.baseTarget || 3, {
                            size: liveBallSize,
                            gap: livePlayerCount <= 4 ? 10 : livePlayerCount <= 6 ? 9 : 8,
                            fontSize: liveStatusFont,
                            state: data,
                          })}
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div
                    style={{
                      padding: 18,
                      borderRadius: 14,
                      background: "rgba(255,255,255,.06)",
                      fontSize: 18,
                      fontWeight: 900,
                      opacity: 0.8,
                    }}
                  >
                    Waiting for Kitty game data...
                  </div>
                )}
              </div>
            </div>

            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ ...panelStyle, padding: 14 }}>
                <div style={labelStyle}>Current Player</div>
                <div style={{ fontSize: 38, fontWeight: 1000, lineHeight: 1 }}>
                  {data.currentPlayer || "—"}
                </div>
                <div style={{ marginTop: 10 }}>
                  {renderNeedBalls(players?.[data.currentPlayer], data.baseTarget || 3, {
                    size: 32,
                    gap: 8,
                    fontSize: 14,
                    state: data,
                  })}
                </div>
              </div>

              <div style={{ ...panelStyle, padding: 14 }}>
                <div style={labelStyle}>Game Details</div>
                <div style={{ fontSize: 27, fontWeight: 1000, marginTop: 3 }}>
                  {kittyGameTypeTextFromValue(data.gameType)}
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "6px 12px",
                    marginTop: 10,
                    fontSize: 16,
                    fontWeight: 850,
                  }}
                >
                  <div>Base Target: <b>{data.baseTarget || "—"}</b></div>
                  <div>Players: <b>{order.length}</b></div>
                  <div>Started: <b>{data.startedAt || "—"}</b></div>
                  <div>Duration: <b>{data.duration || "—"}</b></div>
                  <div>Entry: <b>{settlementSummary.kittyEntry}</b></div>
                  <div>Ball Out: <b>{settlementSummary.outPenalty}</b></div>
                  <div>Add-on: <b>{settlementSummary.totalKittyAddOnPerPlayer || 0}</b></div>
                  <div>Winner Net: <b>{settlementSummary.winnerNetKittyPoints || 0}</b></div>
                </div>
              </div>

              <div style={{ ...panelStyle, padding: 14 }}>
                <div style={labelStyle}>Reds / Non-token Balls</div>
                <div style={{ fontSize: 46, fontWeight: 1000, lineHeight: 1 }}>
                  {data.redsOnTable ?? "—"}
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "6px 12px",
                    marginTop: 10,
                    fontSize: 16,
                    fontWeight: 850,
                  }}
                >
                  <div>Token left: <b>{data.tokenBallsLeft ?? 6}</b></div>
                  <div>Extra: <b>{displayExtraInfo.placed} / {displayExtraInfo.allowed}</b></div>
                  <div>Pending: <b>{displayExtraInfo.pending}</b></div>
                  <div>Can place: <b>{displayExtraInfo.placeableNow}</b></div>
                </div>
              </div>

              <div style={{ ...panelStyle, padding: 14 }}>
                <div style={labelStyle}>Settlement / Rule</div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1fr 1fr",
                    gap: "7px 12px",
                    marginTop: 10,
                    fontSize: 16,
                    fontWeight: 850,
                  }}
                >
                  <div>Ball-out pays: <b>{settlementSummary.ballOutPayable}</b></div>
                  <div>Not-out pays: <b>{settlementSummary.notOutPayable}</b></div>
                  <div>Kitty Points Won: <b>{settlementSummary.grossKittyPoints}</b></div>
                  <div>Table Charge: <b>{kittySettlementTableChargeText(settlementSummary)}</b></div>
                </div>

                <div
                  style={{
                    marginTop: 10,
                    paddingTop: 9,
                    borderTop: "1px solid rgba(255,255,255,.12)",
                    fontSize: 13,
                    lineHeight: 1.32,
                    fontWeight: 750,
                    opacity: 0.86,
                  }}
                >
                  Extra reds may be placed only after every qualifier or when only last 2 reds/non-token balls are left.
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}