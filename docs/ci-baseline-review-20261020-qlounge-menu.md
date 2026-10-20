# Production baseline safety review — Q Lounge menu management (2026-10-20)

Base: `main` at `ee02e87e11bf7054938e81dbe66320e4f10eab32` (Q Lounge direct checkout, PR #113).

Reason: staff previously had to leave `/food` and use `/qclubledger` to change the shared F&B catalogue. This update adds an Admin-only menu manager directly to Q Lounge for category and item edits.

## Reviewed change to protected `src/server/snooker-v1.js`

The public catalogue remains read-only. New category POST, PATCH and DELETE routes each call `requireAuth` with `ADMIN`. Category deletion is a soft deactivation and returns `409 CATEGORY_IN_USE` while any active catalogue item still references the category. Existing item add/edit/deactivate endpoints continue to enforce `ADMIN`. No public write route or service credential is exposed to the browser.

Reviewed Git blob SHA-1: `182f8b59198352b911b8a3d1ba7ed4ca3d0b60cb`.

## UI scope

- `/food` exposes a Manage menu button. Editing requires the canonical Main Admin PIN login and reuses the existing website session token.
- The modal edits category title, image URL and display order; it can add categories and safely remove unused categories.
- The shared item editor adds, edits or deactivates F&B items, including selling/cost price, unit, description, image, Ledger category, Q Lounge visibility, online ordering and category assignment. New items can start stock tracking with an opening quantity and low-stock warning.
- Successful saves refresh the public catalogue so ordering immediately reflects the shared values. Existing Cashfree checkout remains unchanged.

## Verification

- `node --test`: 199 passing, 37 skipped database-gated tests; one baseline hash assertion required this separately reviewed update.
- `npm run build`: passed; existing chunk-size and stale Browserslist notices only.
- `tests/q-lounge-menu-manager.test.mjs`: confirms the shared Admin session, protected route registration, admin guards, and safe category deletion policy.

No database migration, payment handling, existing stock records or existing order records are changed. New items can be set up with Ledger stock tracking through the existing catalogue API.

## Reviewed Ledger category dropdown update — PR #118

The merged Ledger UI change adds active shared Q Lounge category names to the existing Ledger category selector and retains a current category if it is no longer active. It changes only the item editor's available category choices; it does not alter catalogue write authorization, item identity, billing, stock handling, payment processing, or database schema.

Reviewed production commit: `771918c899df8125513aa10aa4d35c0e43b5bf55`.
Reviewed Git blob SHA-1 for `src/components/qclub-ledger-page.jsx`: `633b7ae88bdd534099947552f5e9596f0459ca43`.
