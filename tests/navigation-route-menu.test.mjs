import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../src/components/layout-shell.jsx", import.meta.url), "utf8");

test("authenticated menu exposes the promoted Website Manager", () => {
  assert.match(source, /admin \? <PublicLink to="\/admin"[^>]*>Website Manager<\/PublicLink>/);
});

test("staff and admin menu exposes consolidated staff operations", () => {
  assert.match(source, /\(admin \|\| staffAdmin\) \? <PublicLink to="\/staff-shifts"[^>]*>Staff Operations<\/PublicLink>/);
});

test("legacy admin remains visibly distinguished during compatibility period", () => {
  assert.match(source, /to="\/admin-panel"[^>]*>Legacy Admin Panel<\/PublicLink>/);
});
