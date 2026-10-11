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
  assert.match(fn, /snooker_bills"\)\.select\("id,customer_id,customer_name,finalized_at"\)\.gte\("finalized_at"/);
  assert.doesNotMatch(fn, /snooker_bills"\)\.select\("id,customer_id,customer_name,(?:created_at|opened_at)"/);
  assert.match(fn, /for\(const x of bills\|\|\[\]\)mark\(x.customer_id,x.customer_name,x.finalized_at\)/);
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

test("customer register has one Add button and preview-only unsaved entry", () => {
  const register = readFileSync(new URL("../src/components/daily-register-page.jsx", import.meta.url), "utf8");
  const modal = readFileSync(new URL("../src/components/daily-register-charge-modal.jsx", import.meta.url), "utf8");
  assert.ok(register.includes("Add Table / Frame Charges"));
  assert.ok(register.includes("DailyRegisterChargeModal"));
  assert.ok(register.includes("SIMULATED CHARGES"));
  assert.ok(register.includes("onSimulate={simulateCharge}"));
  assert.ok(modal.includes('role="dialog"'));
  assert.ok(modal.includes("Chargeable frames"));
  assert.ok(modal.includes('fixed?"Add "+price(total)'));
  assert.ok(modal.includes("onPost({"));
  assert.ok(modal.includes("onSimulate({"));
  assert.ok(modal.includes("onStartTimed("));
  assert.ok(modal.includes("onContinue("));
  assert.ok(modal.includes("Championship format"));
  assert.equal(modal.includes("Preview amount"),false);
  assert.equal(modal.includes("Billing rule"),false);
  assert.equal(modal.includes("Normal Snooker / Championship"),false);
  assert.ok(page.includes("async function postRegisterFrames(payload)"));
});

test("manual frame charge API never trusts client amounts and uses atomic RPC", () => {
  const start = server.indexOf("async function createRegisterFrameCharge(req,res){");
  const end = server.indexOf("async function listPlayerTabs(req,res){",start);
  assert.ok(start>0&&end>start);
  const handler=server.slice(start,end);
  assert.match(handler, /requireAuth\(req,res\)/);
  assert.match(handler, /qclub_register_add_frame_bill/);
  assert.match(handler, /p_idempotency_key:key/);
  assert.doesNotMatch(handler, /req.body\?\.amount/);
  assert.match(server, /path === "register\/charges"\) return await createRegisterFrameCharge/);
});
