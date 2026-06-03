import React, { useState } from "react";
import { PageShell } from "./page-helpers";
import {
  uid,
  todayIso,
  tournamentGameKey,
  normalizePlayerGames,
} from "../lib/qclub-utils";

export function MatchLedgerPage({
  data,
  admin,
  staffAdmin,
  committeeAdmin,
  commit,
}) {
  if (!admin && !staffAdmin) {
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