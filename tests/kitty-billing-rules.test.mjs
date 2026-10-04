import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/components/kitty-page.jsx", import.meta.url), "utf8");

test("Kitty table rates and supported tables match Ledger billing", () => {
  assert.match(source, /table1:[\s\S]{0,420}ratePerHour:\s*600,[\s\S]{0,80}kittyEnabled:\s*true/);
  assert.match(source, /table2:[\s\S]{0,420}ratePerHour:\s*600,[\s\S]{0,80}kittyEnabled:\s*true/);
  assert.match(source, /table3:[\s\S]{0,420}ratePerHour:\s*500,[\s\S]{0,80}kittyEnabled:\s*true/);
  assert.match(source, /table4:[\s\S]{0,420}kittyEnabled:\s*false/);
});

test("Kitty table billing is fixed to winner-only with ₹100 minimum and nearest ₹10", () => {
  assert.match(source, /const tableChargeMode = "paid_by_winner"/);
  assert.match(source, /const tableRoundingMode = "nearest_10"/);
  assert.match(source, /Math\.max\(100, Math\.round\(value \/ 10\) \* 10\)/);
  assert.match(source, /Winner only/);
  assert.match(source, /₹100 minimum/);
  assert.match(source, /Nearest ₹10|nearest ₹10/);
  assert.doesNotMatch(source, /include_split/);
  assert.doesNotMatch(source, /handled_separately/);
  assert.doesNotMatch(source, /round_up/);
});

test("No-winner time carries exactly once and does not create a winner charge", () => {
  assert.match(source, /durationSeconds = secondsBetweenNumber/);
  assert.match(source, /kittyRoundHistory:\s*\[\.\.\.previousHistory, noWinnerRound\]/);
  assert.match(source, /state\?\.started && !state\?\.noWinner/);
  assert.match(source, /const roundedTableCharge = winnerName \? winnerChargeIfEndedNow : 0/);
  assert.match(source, /a no-winner game charges nobody and its time carries into the next game/);
});

test("Kitty billing stops when winner is declared rather than at Final Lock", () => {
  assert.match(source, /billingEndedAt:\s*autoWinner \?/);
  assert.match(source, /billingEndedAt:\s*s\.billingEndedAt \|\| nowText\(\)/);
  assert.match(source, /const endedAt = state\.billingEndedAt \|\| nowText\(\)/);
});

test("Kitty scorer enforces the official 2 to 6 player limit", () => {
  assert.match(source, /names\.length < 2/);
  assert.match(source, /names\.length > 6/);
  assert.match(source, /playerInputs\.length >= 6/);
  assert.match(source, /while \(padded\.length < 6\)/);
});

test("Kitty setup and public display visibly explain official billing", () => {
  assert.match(source, /Official Kitty Table Billing/);
  assert.match(source, /Winner Charge If Game Ends Now/);
  assert.match(source, /Kitty Billing/);
  assert.match(source, /No Winner/);
  assert.match(source, /time carries forward/);
});
