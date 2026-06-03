import React from "react";
import { PageShell } from "./page-helpers";
import {
  uid,
  todayIso,
  tournamentGameKey,
  playerGamesLabel,
} from "../lib/qclub-utils";

export function ReviewPanel({
  data,
  admin,
  staffAdmin,
  committeeAdmin,
  commit,
}) {
  if (!admin && !committeeAdmin) {
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