# Production baseline safety review — Q Lounge menu management (2026-10-20)

Base: `main` at `ee02e87e11bf7054938e81dbe66320e4f10eab32` (Q Lounge direct checkout, PR #113).

Reason: staff previously had to leave `/food` and use `/qclubledger` to change the shared F&B catalogue. This update adds an Admin-only menu manager directly to Q Lounge for category and item edits.

## Reviewed change to protected `src/server/snooker-v1.js`

The public catalogue remains read-only. New category POST, PATCH and DELETE routes each call `requireAuth` with `ADMIN`. Category deletion is a soft deactivation and returns `409 CATEGORY_IN_USE` while any active catalogue item still references the category. Existing item add/edit/deactivate endpoints continue to enforce `ADMIN`. No public write route or service credential is exposed to the browser.

Reviewed Git blob SHA-1: `182f8b59198352b911b8a3d1ba7ed4ca3d0b60cb`.

## UI scope

- `/food` exposes a Manage menu button. Editing requires the canonical Main Admin PIN login and reuses the existing website session token.
- The modal edits category title, image URL and display order; it can add categories and safely remove unused categories.
- The shared item editor adds, edits or deactivates F&B items, including price, description, image, Ledger category, Q Lounge visibility, online ordering and category assignment.
- Successful saves refresh the public catalogue so ordering immediately reflects the shared values. Existing Cashfree checkout remains unchanged.

## Verification

- `node --test`: 198 passing, 37 skipped database-gated tests; one baseline hash assertion required this separately reviewed update.
- `npm run build`: passed; existing chunk-size and stale Browserslist notices only.
- `tests/q-lounge-menu-manager.test.mjs`: confirms the shared Admin session, protected route registration, admin guards, and safe category deletion policy.

No database migration, payment handling, stock system or existing order records are changed.
