import test from "node:test";
import assert from "node:assert/strict";
import { gameChoices, isHourlyPoolTable } from "../src/lib/table-game-options.mjs";

test("Pool QR requests only the hourly Pool session type", () => {
  assert.equal(isHourlyPoolTable("POOL"), true);
  assert.deepEqual(gameChoices("POOL"), [["NORMAL_POOL", "Pool (Hourly)"]]);
});

test("the legacy American Pool type also uses hourly Pool billing", () => {
  assert.equal(isHourlyPoolTable("AMERICAN_POOL"), true);
  assert.deepEqual(gameChoices("AMERICAN_POOL"), [["NORMAL_POOL", "Pool (Hourly)"]]);
});

test("snooker tables retain their existing game choices", () => {
  assert.equal(isHourlyPoolTable("FULL_SIZE_SNOOKER"), false);
  assert.deepEqual(gameChoices("MINI_SNOOKER").map(([type]) => type), [
    "NORMAL_SNOOKER",
    "QCHASE_RUMMY",
    "SIX_BALL_SNOOKER",
    "TEN_BALL_SNOOKER",
    "KITTY",
  ]);
  assert.deepEqual(gameChoices("FULL_SIZE_SNOOKER").map(([type]) => type), [
    "NORMAL_SNOOKER",
    "QCHASE_RUMMY",
    "SIX_BALL_SNOOKER",
    "TEN_BALL_SNOOKER",
    "KITTY",
  ]);
});
