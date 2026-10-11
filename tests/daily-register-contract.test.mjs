import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const server = readFileSync(new URL("../src/server/snooker-v1.js", import.meta.url), "utf8");
const page = readFileSync(new URL("../src/components/qclub-ledger-page.jsx", import.meta.url), "utf8");

test("dated register GET uses actual F&B opened_at schema and Pasighat boundaries", () => {
  const start = server.indexOf("async function listDailyRegister(");
  const end = server.indexOf("async function listPlayerTabs(", start);
  assert.ok(start > 0 && end > start, "separate read-only endpoint exists");
  const fn = server.slice(start, end);
  assert.match(fn, /T00:00:00\+05:30/);
  assert.match(fn, /snooker_fnb_tabs"\)\.select\("id,customer_id,customer_name,opened_at"\)\.gte\("opened_at"/);
  assert.doesNotMatch(fn, /snooker_fnb_tabs"\)\.select\("id,customer_id,customer_name,created_at"/);
  assert.match(fn, /snooker_bills"\)\.select\("id,customer_id,customer_name,created_at"\)\.gte\("created_at"/);
  assert.doesNotMatch(fn, /snooker_bills"\)\.select\("id,customer_id,customer_name,opened_at"/);
  assert.match(server, /path === "daily-register"\) return await listDailyRegister\(req, res\)/);
});

test("branch preview must reject Ledger writes before fetch, except auth login/logout", () => {
  const start = page.indexOf("async function apiRequest(");
  const end = page.indexOf("function allowedGames(", start);
  const fn = page.slice(start, end);
  assert.match(fn, /isBranchPreview && isLedgerWrite/);
  assert.match(fn, /READ-ONLY PREVIEW/);
  assert.match(fn, /"auth\/login", "auth\/logout"/);
});

test("customer register exposes selectable game charges without direct manual writes", () => {
  const register = readFileSync(new URL("../src/components/daily-register-page.jsx", import.meta.url), "utf8");
  assert.match(register, /Add Table \/ Frame Charges/);
  assert.match(register, /Game \/ Format/);
  assert.match(register, /Billing rule/);
  assert.match(register, /onConfigureGameCharge/);
  assert.match(register, /onContinueGame/);
  assert.match(register, /Preview selected charges/);
  assert.doesNotMatch(register, /person-charges.*method: "POST"/);
  assert.match(page, /function configureRegisterGameCharge\(/);
  assert.match(page, /function continueRegisterGameCharge\(/);
  assert.match(page, /setStartTable\(table\)/);
  assert.match(page, /setTableViewSessionId\(liveSession.session_id\)/);
});
