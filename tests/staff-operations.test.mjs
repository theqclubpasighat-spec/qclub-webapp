import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const server = readFileSync(new URL("../src/server/snooker-v1.js", import.meta.url), "utf8");
const ledger = readFileSync(new URL("../src/components/qclub-ledger-page.jsx", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20261003_staff_operations.sql", import.meta.url), "utf8");

test("staff operations schema is server-only and append-only", () => {
  for (const table of ["qclub_staff_shifts", "qclub_staff_attendance", "qclub_operational_expenses"]) {
    assert.match(migration, new RegExp("create table if not exists public\\." + table));
    assert.match(migration, new RegExp("alter table public\\." + table + " enable row level security"));
    assert.match(migration, new RegExp("revoke all on public\\." + table + " from anon, authenticated"));
    assert.match(migration, new RegExp("grant select, insert on public\\." + table + " to service_role"));
  }
  assert.doesNotMatch(migration, /grant\s+(?:update|delete)/i);
});

test("staff operations API exposes authenticated list and append routes only", () => {
  for (const path of ["staff/shifts", "staff/attendance", "staff/expenses"]) {
    assert.ok(server.includes(`method === "GET" && path === "${path}"`), "missing GET " + path);
    assert.ok(server.includes(`method === "POST" && path === "${path}"`), "missing POST " + path);
    assert.ok(!server.includes(`method === "PATCH" && path === "${path}"`), "unexpected PATCH " + path);
    assert.ok(!server.includes(`method === "DELETE" && path === "${path}"`), "unexpected DELETE " + path);
  }
  assert.match(server, /async function createStaffShift[\s\S]*requireAuth\(req, res, \["ADMIN"\]\)/);
  assert.match(server, /async function createStaffAttendance[\s\S]*requireAuth\(req, res\)/);
  assert.match(server, /async function createOperationalExpense[\s\S]*requireAuth\(req, res\)/);
});

test("QclubLedger Staff Ops reuses the existing protected session and has no demo seed records", () => {
  assert.match(ledger, /\["staffops", "👥 Staff Ops"\]/);
  assert.match(ledger, /protectedCall\("staff\/shifts\?limit=100"\)/);
  assert.match(ledger, /protectedCall\("staff\/attendance\?limit=100"\)/);
  assert.match(ledger, /protectedCall\("staff\/expenses\?limit=100"\)/);
  assert.match(ledger, /Audit rule: this first version is append-only/);
  for (const demoMarker of ["DEFAULT_ATTENDANCE", "DEFAULT_EXPENSES", "Morning (9 AM - 3 PM)", "On time for evening floor duty", "Cafe Dairy Milk & Beverage Restock"]) {
    assert.ok(!ledger.includes(demoMarker), "donor demo marker leaked into production Staff Ops: " + demoMarker);
  }
});
