import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const ledger = fs.readFileSync(new URL("../src/components/qclub-ledger-page.jsx", import.meta.url), "utf8");
const server = fs.readFileSync(new URL("../src/server/snooker-v1.js", import.meta.url), "utf8");

const expectedMiniGames = [
  "NORMAL_SNOOKER",
  "QCHASE_RUMMY",
  "SIX_BALL_SNOOKER",
  "TEN_BALL_SNOOKER",
  "KITTY",
];

test("Mini Snooker exposes the same supported snooker game menu as full-size tables", () => {
  const mapping = ledger.match(/MINI_SNOOKER:\s*\[([^\]]+)\]/);
  assert.ok(mapping, "Mini Snooker UI game mapping must exist");
  for (const game of expectedMiniGames) {
    assert.match(mapping[1], new RegExp("\\b" + game + "\\b"));
  }
});

test("Mini Snooker backend accepts every UI-exposed game", () => {
  const compat = server.match(/if \(tableType === "MINI_SNOOKER"\) return \[([^\]]+)\]\.includes\(gameType\);/);
  assert.ok(compat, "Mini Snooker backend compatibility mapping must exist");
  for (const game of expectedMiniGames) {
    assert.match(compat[1], new RegExp("\\b" + game + "\\b"));
  }
});

test("Mini Snooker public standby display advertises the restored modes", () => {
  const block = server.match(/else if \(table\.table_type === "MINI_SNOOKER"\) \{[\s\S]*?\n  \} else \{/);
  assert.ok(block, "Mini Snooker standby rule block must exist");
  assert.match(block[0], /QChase \/ Rummy/);
  assert.match(block[0], /6-Ball Snooker/);
  assert.match(block[0], /10-Ball Snooker/);
  assert.match(block[0], /Kitty/);
});
