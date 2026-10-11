import test from "node:test";
import assert from "node:assert/strict";
import { pasighatBusinessDate, mergeRegisterRows, validateRegisterAllocation } from "../src/lib/daily-register.js";

test("register date is Pasighat business date, not UTC date", () => {
  assert.equal(pasighatBusinessDate(new Date("2026-10-10T19:00:00Z")), "2026-10-11");
  assert.equal(pasighatBusinessDate(new Date("2026-10-11T18:00:00Z")), "2026-10-11");
});

test("daily sheet keeps chronological arrivals and puts carried-forward balances last", () => {
  const day = [
    { customer_id: "kamin", name: "KAMIN", first_activity_at: "2026-10-11T07:30:00Z" },
    { customer_id: "kiron", name: "KIRON", first_activity_at: "2026-10-11T07:00:00Z" },
    { customer_id: "katem", name: "KATEM", first_activity_at: "2026-10-11T08:00:00Z" },
  ];
  const open = [
    { customer_id: "kiron", name: "KIRON", current_due_inr: 950 },
    { customer_id: "older", name: "OLDER", current_due_inr: 100 },
  ];
  const today = mergeRegisterRows(day, open, "2026-10-11", "2026-10-11");
  assert.deepEqual(today.map(row => row.customer_id), ["kiron", "kamin", "katem", "older"]);
  assert.equal(today[0].open_tab.current_due_inr, 950);
  assert.equal(today[3].carried_forward, true);
  assert.deepEqual(mergeRegisterRows(day, open, "2026-10-11", "2026-10-12").map(x => x.customer_id), ["kiron","kamin","katem"]);
  assert.deepEqual(mergeRegisterRows(day, open, "2026-10-11", "2026-10-11", "KAMIN").map(x => x.customer_id), ["kamin"]);
});

test("one Red Bull each and a 2/1 split produce exactly allocated quantity", () => {
  const item = { id:"redbull", selling_price_inr:150, track_inventory:true, current_stock:10 };
  const ids = ["mibom","katem"];
  assert.deepEqual(validateRegisterAllocation(item,{mibom:2,katem:1},ids), {
    recipients:[{ customer_id:"mibom",quantity:2 },{ customer_id:"katem",quantity:1 }],
    totalQuantity:3,totalInr:450,
  });
  assert.throws(() => validateRegisterAllocation({ ...item,current_stock:2 },{mibom:2,katem:1},ids), /Insufficient stock/);
  assert.throws(() => validateRegisterAllocation(item,{mibom:0.5},ids), /whole quantity/);
  assert.throws(() => validateRegisterAllocation(item,{unknown:1},ids), /registered customer/);
  assert.throws(() => validateRegisterAllocation(item,{mibom:1},["katem"]), /registered customer/);
});
