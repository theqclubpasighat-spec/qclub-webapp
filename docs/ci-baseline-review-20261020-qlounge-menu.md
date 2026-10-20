# Production baseline safety review — Q Lounge menu management (2026-10-20)

Follow-up review: the Pool QR setup allowance now appears as a signed `−03:00` timer offset and is excluded from live estimates, final settlement, and post-game rate corrections. New sessions start at scan time; the 180-second allowance is applied separately. The focused change was reviewed against the previous production baseline and its updated server hash is pinned in `tests/production-baseline.json`.

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

## Reviewed Pool QR scan start and Cashfree handoff

Opening an available Pool table QR starts its hourly `NORMAL_POOL` session automatically with a three-minute lead-in. The player page shows the live server timer and estimated time charge without asking for a name or phone number during play. QclubLedger detects the new session, uses the existing sound alert, and provides Finish Game. Finishing the session posts the final time charge; only then does the player enter their name and WhatsApp number. The public token-protected handoff creates a player bill at the verified member or walk-in rate, creates a Cashfree UPI order for that amount, and opens the existing secure Cashfree QR page on the player's phone. No schema migration is required.

The change uses existing individual player charges, bills and Cashfree payment records. The bill and payment amounts are calculated from server-side charges, and the player submission is authorized by the secret table QR request token. The existing Ledger alert/finish controls remain part of the reviewed Pool QR change.

Reviewed Git blob SHA-1 for `src/components/qclub-ledger-page.jsx`: `095616bac6d2f233749e3268452a7ea59b547e5a`.
Reviewed Git blob SHA-1 for `src/server/snooker-v1.js`: `f688af0b962fe5c99e4c1aec2f0519e398cf4963`.

Verification: production build, server syntax check, and full Node test suite are run for this update; database-gated tests remain skipped without the production database configuration.

## Reviewed finished Pool QR session recovery and charge display

The public request-status endpoint now returns the posted, unbilled table-time charge for finalized Pool sessions, so the player payment page no longer presents a false ₹0. When a claimed player's customer tab already includes that charge, the combined due display does not add it a second time. The player page distinguishes a finished session from an active one and uses the finished session's timer rather than another session currently at the table.

When the same phone restores a finished QR request, its payment link remains intact. If the table is available, the player can explicitly start a new session; the old request token is archived on that phone and can be reopened to return to its payment. This avoids silently discarding an unpaid bill or automatically charging a new player on refresh.

Reviewed Git blob SHA-1 for `src/server/snooker-v1.js`: `8363c9131fe105cbdb22851476314d50841b9246`.


## Pool payment return and timer correction — 20 October 2026

Reviewed limited changes: Pool-created Cashfree orders return to the signed QclubPay flow, not legacy payment-status. Public payment verification retains existing signatures and accepts the equivalent ISO expiry used before database insertion. It still verifies server-side Cashfree state; no client payment assertion is trusted. Returned pending checkout hides the pay button and advises against duplicate payment. Player timer interpolates active server samples locally; paused/ended/finalized clocks freeze, and the 180-second allowance and all billing calculations remain unchanged. Existing new-session top placement is preserved. No database migration or payment-state write is part of this release. MSG91 food template remains a separate unresolved configuration/template task.

Regression tests cover signed return routing, equivalent expiry signatures, wrong payment identity, sequential seconds, negative allowance and stopped timers. Local build passed. Database-gated tests are not run against production. No real payment was initiated for testing.


## Booking Submit crash and Cashfree checkout

The public BookTable handler called an App-scoped operational-write function, throwing before checkout. Submission now validates the form and opens the existing server-priced Cashfree hosted checkout. It no longer creates an unpaid public inbox entry before payment. The existing verified server fulfillment creates/confirms the reservation. The button reads Submit & Pay with Cashfree and guards concurrent clicks; entered fields are retained on errors. Member booking type is explicitly sent for server membership/rate validation. The shared checkout function now awaits checkout and reports success/failure to callers. No database or rate changes. Build and focused booking/payment tests passed; no live payment taken.
