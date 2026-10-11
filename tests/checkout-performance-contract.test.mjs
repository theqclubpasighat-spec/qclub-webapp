import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ledger = readFileSync(new URL("../src/components/qclub-ledger-page.jsx", import.meta.url),"utf8");
const register = readFileSync(new URL("../src/components/daily-register-page.jsx", import.meta.url),"utf8");
const server = readFileSync(new URL("../src/server/snooker-v1.js", import.meta.url),"utf8");

test("customer checkout is immediately visible while authoritative balance loads",()=>{
  assert.ok(ledger.includes('setClubTabPendingCustomer({customer_id:playerTab.customer_id,name:playerTab.name,kind:"CHECKOUT"})'));
  assert.ok(ledger.includes('setClubTabPendingCustomer({customer_id:playerTab.customer_id,name:playerTab.name,kind:"VIEW"})'));
  assert.ok(ledger.includes('clubTabPendingCustomer && !clubTabDetail'));
  assert.ok(ledger.includes("No payment has been recorded."));
  assert.ok(ledger.includes("checkoutRequestRef.current"));
});

test("known unbilled player tab skips first detail round-trip, without trusting cached payment amount",()=>{
  const a=ledger.indexOf("async function prepareClubTabCheckout(playerTab) {");
  const b=ledger.indexOf("async function payClubTabManual() {",a);
  const body=ledger.slice(a,b);
  assert.ok(body.includes("Number(playerTab.unbilled_inr || 0) > 0.009"));
  assert.ok(body.includes("await finalize();"));
  assert.ok(body.includes('protectedCall("player-tabs/" + playerTab.customer_id + "/detail")'));
  assert.ok(body.includes('error?.payload?.error !== "NOTHING_TO_BILL"'));
  assert.ok(body.includes("setClubCheckoutAmount(Number(detail.current_due_inr || 0).toFixed(2))"));
  assert.equal(body.includes("payClubTabManual()"),false);
});

test("dated customer register separates viewing and checkout explicitly",()=>{
  assert.ok(register.includes("onCheckoutCustomer, onAddFnb"));
  assert.ok(register.includes(">View account</button>"));
  assert.ok(register.includes(">Checkout</button>"));
  assert.ok(register.includes("disabled={busy || demoMode || previewMode || !isToday}>Checkout"));
  assert.ok(ledger.includes("onCheckoutCustomer={prepareClubTabCheckout}"));
});

test("checkout history fetch runs independent reads concurrently, preserves bills and payments",()=>{
  const a=server.indexOf("async function customerTabDetailPayload(supabase,customerId)");
  const b=server.indexOf("async function customerTabDetail(req,res,customerId)",a);
  const body=server.slice(a,b);
  assert.ok(body.includes("const [chargeResult,fnbResult,billItemResult,paymentResult,settlementResult,sessionResult]=await Promise.all(["));
  assert.ok(body.includes('supabase.from("snooker_customer_settlements").select("*")'));
  assert.ok(body.includes('supabase.from("snooker_bill_payments").select("*")'));
  assert.ok(body.includes('supabase.from("snooker_bill_items").select("*")'));
  assert.ok(body.includes("const billedDue=money((openBills||[]).reduce("));
  assert.ok(body.includes("current_due_inr:money(unbilled+billedDue)"));
});
