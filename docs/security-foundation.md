# Package 1: isolated security foundation

Status: rehearsal only. This package does not remediate the live application's existing public state/PIN exposure. The opt-in `/__admin-preview` client now calls this API only in rehearsal builds. Existing production screens do not call it. Do not merge as a completed security cutover or apply this migration to a live database.

Base: `qclub-webapp` main `b8653b0d8df44248b3edcad0e6b1fae3a44cd838`.

## Included

- A disabled-by-default rehearsal security/CMS action multiplexed through `/api/qclub-checkout-rehearsal?scope=security&action=...`, avoiding an extra Vercel function.
- Salted scrypt PIN hashes in a private schema; no browser grants to hashes or service RPCs.
- Server validation of existing Ledger-format bearer sessions, role checks, expiry and revocation.
- Fail-closed login throttling and credential-version checks that prevent a login finishing with a rotated PIN.
- Main-admin-only credential rotation with session revocation and audit in one database transaction.
- A deliberately small public content projection and ADMIN-only content edits with optimistic concurrency. This is not a replacement for the full application state contract.
- An insert-only credential import script, dry-run by default, without printing PINs or hashes.

Existing production UI, Ledger routes, payment handlers, shared state endpoints, database policies and dependencies are unchanged. The mobile design preview remains a separate review artifact.

## Rehearsal isolation

The endpoint fails before creating a database client unless `QCLUB_SECURITY_REHEARSAL=enabled`. It also refuses `VERCEL_ENV=production` and explicitly rejects the known production, V2 staging and CraXam project references.

Use a disposable local or separately provisioned rehearsal database with synthetic fixtures. Required server-only environment variables are `QCLUB_SECURITY_SUPABASE_URL` and `QCLUB_SECURITY_SERVICE_ROLE_KEY`; remote projects also require `QCLUB_SECURITY_PROJECT_REF` to match the URL. Never put the service key in a VITE-prefixed variable. Existing application database environment variables are not fallbacks.

The additive migration assumes the existing `qclub_state` and `snooker_auth_sessions` contracts have been provisioned in the rehearsal environment. Review and apply only `supabase/migrations/20260929113230_security_foundation.sql` there. Do not run a blanket migration push against existing projects.

Credential import: `node scripts/security-import-credentials.mjs` reports counts only; `--apply` imports missing identities. Invalid, missing or duplicate role PINs stop import. Existing credentials are never overwritten and source state is not scrubbed. Use synthetic source state during this package.

## Validation

Run `node --test tests/security-foundation.test.mjs tests/v2-preview.test.mjs` and `npm run build` after `npm ci`.

The actual Postgres test uses a separate pinned `@electric-sql/pglite@0.5.8` installation, without adding application dependencies. Set `QCLUB_PGLITE_MODULE` to its absolute `dist/index.js` path, then run `node --test tests/security-foundation-db.test.mjs`. Without that variable the database test is skipped; a skip is not database validation.

Tests cover client permission denial, service access, session checks, role checks, public filtering, write conflicts, login response compatibility, default isolation, throttle reservations, stale credential rejection, successful session creation, and transactional rollback when audit insertion fails. These are not production end-to-end tests or proof of zero regression.

## Required before activation

1. Connect web admin, committee and staff login to server sessions; remove browser PIN comparisons/defaults and private-state caching. Migrate scorer and final-lock credentials deliberately.
2. Replace whole-state public writes with validated booking, registration, order and payment fulfilment commands. Preserve Cashfree callbacks, MSG91 and Android Ledger contracts.
3. Complete safe public projections for every mobile screen, and protect operational/media mutations. Wire CMS edits through authorized server endpoints.
4. Rehearse with representative data, verify backup/restore, mobile flows and Android compatibility. Resolve duplicate-role PIN rotation behavior and add retention for expired attempt records before general rollout.
5. In a coordinated cutover, import/rotate credentials, revoke legacy sessions, remove plaintext from state/backups/caches where appropriate, and close legacy anonymous write/read exposures. Keeping the old login active would allow old PINs to issue sessions, so private rotation alone is not a production remedy.
6. Verify the final release and obtain live-release approval. Keep a tested rollback plan that does not re-expose credentials. Only then consider deleting staging after all data, assets, jobs and environment references have been accounted for.

Rollback for this package is removal of the new route/files in the isolated branch. No production data migration or staging deletion is part of this package.


## Package 2 progress — 30 September 2026

The preview-only mobile admin workspace now provides main/committee login, staff read-only denial, Club information, About & policies and Food page copy editing. It is deliberately limited to the foundation content contract; this is not the complete V2 CMS or catalogue/media manager.

- `src/main.jsx` conditionally loads an isolated entry only at `/__admin-preview`. Production builds hard-disable it even when the rehearsal flag is set. Existing routes still boot their original entry.
- `vite.config.js` defines the gate and excludes the rehearsal page/API from offline navigation fallback. The editor never starts production cloud sync, registers a service worker or falls back to browser PINs.
- The client holds its bearer token in memory, sends no cookies and requests no-store responses. Reload requires another sign-in. A failed or expired session never causes a fallback to legacy writes.
- Save sends only changed allowlisted fields with the original exact revision. A conflict preserves the draft and blocks save until the user compares and explicitly discards it. No automatic merge or overwrite occurs.
- Logout revokes the current server session before forgetting the local token. On a server failure the local token is still cleared, and the warning explains that server revocation was not confirmed.
- A local-only rehearsal server and Postgres fixture support repeatable testing with synthetic data. They are not imported into deployment code and have no real database connection.

Run the isolated local rehearsal after installing the pinned PGlite test dependency described above:

```sh
QCLUB_PGLITE_MODULE=/absolute/path/to/pglite/dist/index.js node scripts/admin-rehearsal.mjs
```

Open `http://127.0.0.1:5182/__admin-preview`. Synthetic fixture PINs are main `761239`, staff `852147`, committee `963258`. These values are exclusively local fixture credentials, never production defaults. The in-memory database disappears when the server stops. Do not enter real PINs into this rehearsal.

Validation: database-backed workflow tests cover login, content projection, successful save, stale-save rejection, unchanged private/payment data, staff denial, and rejection of a revoked bearer. Both production and opted-in preview bundles compile. The production bundle must contain no admin-preview module or unique editor strings. Browser/mobile visual verification remains pending: the local agent-browser daemon could not bind its socket, and the browser download failed. No claim of browser or real-device acceptance is made.

The next integration still requires public booking/order/payment commands and wider operational permissions before legacy shared-state access can be retired. Do not enable or promote this draft as a live security cutover.


## Package 3 progress — public notices

The rehearsal CMS now supports adding, editing and removing explicit public notices, with 2,000-character messages, optional safe website/HTTPS links, a 50-notice limit, and the same revision conflict protection as text editing. After saving, the editor adopts the server's canonical public projection. Content navigation uses a compact two-column grid for narrow screens.

The production announcement array mixes public copy with booking and tournament records. The new API therefore exposes and edits only entries explicitly marked `type: notice`; untyped legacy entries are deliberately excluded pending classification. Saving notices preserves all other array entries, their order, private metadata and unrelated state. It rejects duplicate IDs, collisions with operational records, invalid links and malformed existing notice identity. Removing a notice is a draft change until Save changes succeeds; do not mistake this for a production archive/restore feature.

V2 scheduling, audience targeting, media/catalogue editing and historical restore are not included in this slice. No V2 database rows have been copied into production.

Validation: 24 tests pass with no skips, including a Postgres-backed add/remove workflow that confirms booking and legacy records survive and stale changes fail. Production and preview builds pass. The alternative cloud browser returned `ERR_BLOCKED_BY_CLIENT` for the localhost rehearsal, so mobile visual acceptance remains blocked. No hosted functional preview or live release is claimed.

## Package 4 progress — atomic payment record finalization

A separate `/api/qclub-payment-rehearsal` command accepts only `orderId` and a 256-bit receipt token. It uses the same hard rehearsal database/production gate. Its Cashfree adapter performs read-only GETs against the fixed sandbox host, using dedicated `QCLUB_REHEARSAL_CASHFREE_ID` and `QCLUB_REHEARSAL_CASHFREE_SECRET` variables, without production-key fallbacks or redirects. No gateway call or payment was made during implementation; gateway responses were synthetic test fixtures.

The private `payment_intents` table stores server-prepared order terms, a receipt-token hash and the payload for one booking, lounge order or shop receipt. Client roles cannot read it or call the finalization RPCs. Browser-supplied prices, payloads and paid flags are rejected. The command compares gateway order identity, amount, currency and a successful payment against those private terms.

Finalization locks the intent, inserts the operational record once and marks the intent fulfilled in one transaction. Duplicate confirmations do not overwrite staff changes. A conflicting existing operational record produces a conflict; it is never silently adopted or overwritten. Reusing the same payment ID for a different intent rolls back the attempted record insertion. No full shared-state write occurs. Persisted status and total/amount are derived from the verified private terms.

This is an incomplete, disabled payment integration. The next steps are server-authoritative catalogue/rate validation and private intent creation, idempotent sandbox order creation, secure receipt-token handoff, booking slot/inventory reservations, return-page integration, and webhook recovery for customers who never return. Membership/tournament fulfilment, legacy dual-write reconciliation, inventory decrements, PrintBridge and MSG91 delivery still require dedicated adapters. No public intent-creation API has been added and existing payment handlers have not changed.

A paid booking record does not establish slot availability. A paid shop receipt does not adjust stock. The operational table's legacy policies remain unchanged, so this package does not close existing direct-write exposure. Those constraints must be resolved before cutover.

The new SQL migration was generated with Supabase CLI and executed only in disposable PGlite tests. Validation includes malformed/forged commands, pending/mismatched gateway evidence, denied client execution, retry preservation of staff state, record collisions, duplicate-payment rollback and unchanged shared state. Gateway contract references reviewed: https://www.cashfree.com/docs/api-reference/payments/latest/orders/get-order and https://www.cashfree.com/docs/api-reference/payments/latest/payments/get-payments-for-an-order . Adapter version is explicitly pinned to 2025-01-01; sandbox acceptance of that version remains to be verified before activation.

## Package 5 progress — server-priced food checkout

The new `/api/qclub-checkout-rehearsal` endpoint connects private order creation to a sandbox order adapter. It remains hard-disabled in production and uses the dedicated rehearsal database and sandbox credentials. No live food page calls it.

The browser command accepts a stable checkout UUID, a receipt capability token, item IDs/quantities and customer name/phone. Prices, totals, option overrides and duplicate item IDs are rejected. The receipt token must be generated using 32 random bytes by the future client and retained for retries; only its hash is stored on the server. This package does not yet provide browser token persistence/recovery or return-page UI.

The database resolves prices from `snooker_catalogue_items`, checks active category/item and online visibility flags, and freezes the cart, customer and integer-paise amount in one private intent. The same checkout ID and request fingerprint reuse those terms on retry; a changed cart/customer/token conflicts. A transient gateway failure therefore does not create a new private order or silently reprice the retry. Catalogue row/category locks protect quote creation from concurrent changes.

The sandbox adapter submits the stable order ID and checkout UUID as an idempotency key. A duplicate-order 409 response is recovered by reading that same order, and the caller verifies returned identity/currency/amount before exposing its payment session. The adapter never uses production credentials or a configurable gateway host. Gateway calls were simulated in tests; sandbox network acceptance remains unverified. The current explicit API version is 2025-01-01. No real/sandbox payment was initiated during this implementation.

Stock-tracked food is deliberately rejected with `STOCK_RESERVATION_REQUIRED`; option-bearing commands are rejected because the authoritative shared menu currently publishes base items. This is a restricted rehearsal subset, not permission to remove products or options from live production. It does not reserve inventory, cover shop or table checkout, add payment-return URLs, deliver MSG91 messages, or perform printing. Receipt expiry/recovery and late-payment reconciliation must be completed before customer use.

The endpoint has a separate checkout namespace in the fail-closed network-attempt limiter (five requests per 15 minutes), which is adequate only for rehearsal and needs operational sizing before rollout.

Validation adds request-tampering checks, fixed sandbox/idempotency checks and a Postgres-backed creation-to-fulfilment test. The latter simulates a lost gateway response, changes the catalogue price, retries the same checkout, confirms frozen terms and verifies a single paid operational record. It also checks unavailable/tracked products and conflicting receipt/cart retries. These tests do not establish real browser, gateway or inventory compatibility.

## Package 6 progress — customer checkout and status preview

`/__checkout-preview` now provides an isolated mobile-layout food form, order review and payment-status screen. It uses a dedicated gated menu API pointing only at the rehearsal database; there is no fallback to production catalogue/state. Tracked items remain excluded until reservation support is ready. The preview entry is removed from production builds and excluded from service-worker navigation fallback.

The browser generates a stable checkout UUID and 32-byte random receipt token and saves the attempt in same-tab sessionStorage before the first request. Refresh/retry reuses that exact request. No localStorage, shared-state sync or production authentication is used. This transient record contains the test customer's name/phone and receipt capability; it must not be logged or sent in URLs. It survives same-tab reload, not closing the tab or switching devices. Storage/corruption failures block new checkout. Expired attempts remain visible for reference and do not silently become new orders. Automated recovery for closed/lost tabs remains pending.

The inherited HTML already includes the Cashfree SDK. The new UI invokes checkout only after the user presses Pay in sandbox and fixes that invocation to sandbox mode. The popup's result never marks an order paid: after it closes or rejects, the client checks the server. The gateway integration follows the official popup contract at https://www.cashfree.com/devstudio/preview/pg/web/popupCheckout . No external SDK or real gateway interaction has been exercised here.

Customer recovery intentionally keeps an uncertain order locked to its original cart. Package 8 adds correction of a definitively uncreated order; this is still not a complete customer checkout. Callback/return redirect handling and webhook recovery also remain outstanding. The new screen is a gated implementation preview, not a published functional preview URL.

Client tests cover interrupted requests followed by reload, identical retry proof, repeated-tap exclusion, blocked storage, server-only payment status, and expired-order preservation. Browser/mobile visual testing is still blocked by the previously documented tool/network restrictions. Validation totals 41 passing checks (39 application/database checks plus two build-isolation checks). A clean production build excludes the customer client; the opted-in preview compiles. However, preview-to-production builds reusing the same output directory retained stale assets in this workspace despite explicit Vite cleanup. The new build plugin checks both emitted modules and final generated files after PWA generation, and rejects contaminated builds. The existing GitHub workflow now repeats that build sequence with the rehearsal flag enabled. GitHub CI run 36750123684 passed on implementation commit 1262e11ab2a7036771556509f529daf7133cbf65, including the production-after-preview rebuild with rehearsal enabled: https://github.com/theqclubpasighat-spec/qclub-webapp/actions/runs/36750123684 . This establishes isolation on the CI runner; the local reused-output anomaly is not claimed resolved. Browser/device and actual Cashfree sandbox acceptance remain outstanding.

## Package 7 progress — next purchase after confirmed completion

The customer preview now offers Start a new order after confirmed fulfilment. Pressing it makes a fresh server status request for the existing order and receipt token; pending, mismatched, expired or interrupted responses cannot release that order. A successful result preserves the most recent order reference in same-tab sessionStorage before clearing active recovery data. That reference contains no customer details or receipt capability, is not a receipt history, and disappears with the browser session. A subsequent checkout receives a new cryptographic identity/token.

Storage failure leaves the current attempt locked, and overlapping taps cannot clear or recreate orders concurrently. The form resets customer/cart details and reloads the authoritative rehearsal menu. No production checkout is connected. Three additional client checks cover success and reload, rejected/uncertain confirmations, storage failure and overlapping actions. The full suite now has 44 passing checks. CI now installs pinned PGlite outside app dependencies and runs all application/database tests before the build-isolation sequence; its result for this batch is pending at commit time.

## Package 8 progress — correction of an unused checkout

Fix a rejected cart calls a dedicated, hard-gated recovery endpoint with only the checkout ID and receipt token. It never treats a 404, gateway error or client-side paid flag as permission to clear recovery data. The database uses the same transaction advisory lock as intent creation. If any private intent exists, including an expired intent, recovery refuses to abandon it. If none exists, it records a permanent closed ID and creation rejects every later retry of that ID before reaching the gateway. Repeating closure with the same receipt capability is idempotent; mismatched proof conflicts. This prevents a delayed original request from creating an order after the customer begins another checkout.

The new closed-ID table is private with RLS, no client grants and no service-role update/delete grants. The RPC uses SECURITY INVOKER and is executable only by the service role. The endpoint shares checkout's fail-closed attempt budget and cannot use any known production database. No gateway call is needed for closure. The migration was created through Supabase CLI and executed only in disposable Postgres/PGlite fixtures, not a remote project. No hosted-database advisor run or simultaneous multi-session load test is claimed.

After server-confirmed closure, the client removes the active attempt, preserves the customer's details for the current form and reloads available items for correction. Unavailable products are explicitly removed from the draft. Existing, mismatched, missing-order or interrupted responses keep the original recovery proof. Local removal failure can retry the same closure. A new checkout identity is generated only when the customer submits the corrected form. These are unpaid draft edits, not order cancellation, refunds or changes to an existing order.

Closed IDs must not be purged while old creation commands remain valid indefinitely. Deploy the migration before exposing recovery, and preserve closed IDs on rollback; rolling back the closure check while accepting old IDs would reopen delayed-request risk. Rate-limit sizing, expired-payment reconciliation, lost-tab recovery, inventory reservations, actual Cashfree/browser tests and operational integrations remain release prerequisites.

Validation: 50 local checks passed without skips. Added actual Postgres permission/RLS checks and both creation/closure orderings, including closure while the gateway response is outstanding, a lost gateway response, idempotent close retries, blocked delayed creation, unchanged intent/shared-state data and existing expired-order protection. These are controlled interleavings, not proof from concurrent production load. The original food creation/finalization test now also applies the recovery migration. CI repeats the full suite and production/preview/production build sequence for this batch.

## Production reconciliation — 1 October 2026

The rehearsal branch now incorporates production commit `99428d38a3c82e71ce6a4a6dd8ee115e1d0596f6`, including the 26 production commits since the original rehearsal base. Preserved changes include MSG91 receipt formatting and automatic receipts, payment-screen mobile persistence, running F&B tabs, regular-customer autocomplete, persistent cross-table player accounts, T1–T4 displays, Kitty winner-time billing and nearest-₹10 rounding, and Singapore Vercel routing. No production code was replaced with an older rehearsal copy.

The two branches changed disjoint files. Production files were incorporated using their exact Git blob IDs. The production baseline was advanced to that exact main commit, including its Vercel configuration, the new display component and five new migrations (30 protected files total). The inherited baseline had retained an older Vercel configuration hash; the updated assertion now checks the actual current production file. This reconciliation does not certify all recent Ledger features end-to-end: it verifies that this draft preserves their source exactly.

All 50 local application/database regression checks pass after reconciliation. CI runs the full suite, production/preview/production build isolation, and the synthetic mobile checkout workflow against the combined branch. The Android repository main remains `09118147c4b645413a617dd53fc11cf083669d5e` at this check; no Android files were changed. No production deployment or remote migration was performed by this reconciliation.


## Package 9 progress — Cashfree return and webhook recovery

This package closes the rehearsal gap where a successful Cashfree payment could remain unfulfilled if the browser closed, navigated away or returned through Cashfree instead of the popup callback. It remains rehearsal-only and does not alter the live Cashfree routes.

Sandbox order creation now requires an explicit `QCLUB_REHEARSAL_PUBLIC_URL`. The URL must be HTTPS (localhost is allowed for local rehearsal), cannot contain credentials and explicitly refuses `theqclubpasighat.com`. Cashfree order metadata supplies both a return URL back to `/__checkout-preview?order_id={order_id}` and a notify URL at `/api/qclub-payment-rehearsal?action=webhook`. The dedicated rehearsal App ID/secret and fixed Cashfree sandbox host remain mandatory; there is still no fallback to production credentials.

The checkout client reconciles a Cashfree return only when the returned order ID exactly matches the same-tab saved checkout identity. It then asks the existing server verification endpoint for status; a return URL, SDK callback or query parameter never marks an order paid. Mismatched return IDs preserve the original recovery record and stop fulfilment.

The existing rehearsal payment endpoint now multiplexes a webhook action and disables automatic body parsing, verifies Cashfree's HMAC-SHA256 signature over the exact timestamp plus raw request body, and ignores non-success events. For a signed success event, the webhook still does not trust the webhook's amount or paid flag: it re-reads the order and payments from the fixed Cashfree sandbox API and requires the authoritative order ID, INR amount and a successful payment to match the private intent before fulfilment.

Because webhooks do not have the browser's receipt capability, the rehearsal database now exposes two service-role-only RPCs for intent lookup and finalization. Neither `anon` nor `authenticated` can execute them. The service fulfilment path uses the same immutable private terms, unique gateway payment identity and insert-only operational-record behavior as browser verification. It can reconcile a genuine late successful payment even after the browser receipt window has expired; repeated webhook delivery is idempotent and does not re-run gateway verification after fulfilment.

Validation adds strict raw-body signature tests, callback-URL tests, exact return-ID recovery, service-role permission checks, an expired-intent webhook recovery case and duplicate webhook replay. All gateway responses in automated tests remain synthetic. A real Cashfree sandbox order/payment and physical Android/iPhone acceptance are still required before any release claim. The preview deployment also needs the isolated rehearsal database variables, Cashfree sandbox credentials and `QCLUB_REHEARSAL_PUBLIC_URL` configured before hosted end-to-end testing. Reusing the existing payment function keeps the deployment within the current Vercel Hobby serverless-function limit.

No production database migration, production environment variable change, live Cashfree order, MSG91 message, stock movement or production deployment is part of this package.


### Rehearsal API consolidation

The Vercel Hobby function-count limit is satisfied by consolidating the rehearsal menu and unused-checkout recovery actions into the existing `/api/qclub-checkout-rehearsal` function. Menu uses `?action=menu`; recovery uses `?action=recover`; normal checkout creation keeps the original route without an action. The signed Cashfree webhook remains an action on the existing payment rehearsal function. No production API route was removed or merged.


## Package 10 progress — tracked inventory reservation

Tracked Q Lounge items are no longer rejected by the rehearsal checkout. The server now validates the complete cart first, locks catalogue rows in deterministic item-ID order, and reserves tracked stock only after every line has passed validation. Reservation and private payment-intent creation occur in one database transaction. A mixed cart that later fails validation therefore leaves all previously inspected stock unchanged.

A private `checkout_stock_reservations` ledger records the order, item, quantity and lifecycle state. It is RLS-protected and inaccessible to `anon` and `authenticated`. Reservation immediately reduces `snooker_catalogue_items.current_stock` in the isolated rehearsal database, so another checkout cannot sell the same units. Replaying the same checkout identity does not decrement stock again. A second checkout that would exceed remaining stock fails before a Cashfree order is created.

Food checkout intents now use a one-hour server expiry and pass that exact expiry to Cashfree as `order_expiry_time`. Payment verification always retrieves the order and its payment attempts. Stock remains reserved while Cashfree reports an ACTIVE order, TERMINATION_REQUESTED, any PENDING transaction, or contradictory evidence such as an ACTIVE order accompanied by a SUCCESS payment. Contradictory gateway snapshots fail closed and are rechecked instead of either fulfilling or releasing stock.

A reservation is consumed only after a Cashfree order is PAID and a matching SUCCESS payment has the same order ID, INR currency and server-frozen amount. Fulfilment marks the reservation fulfilled without decrementing stock a second time. The operational record and reservation/payment lifecycle still commit atomically.

Reserved stock is restored only after the server independently reads Cashfree and receives a final EXPIRED or TERMINATED order with no successful or pending transaction. The service-role-only terminal-close RPC restores each reserved quantity under row locks, marks reservation rows released and permanently marks the payment intent terminal so a later browser replay cannot fulfil it. Repeated terminal checks are idempotent. Cashfree documents EXPIRED as no longer accepting new transactions; TERMINATION_REQUESTED is deliberately not treated as final.

The customer preview can recover a server-confirmed terminal order. It preserves the previous order reference, clears the active recovery identity only after the server reports the terminal state, reloads the authoritative menu, removes unavailable items, caps tracked quantities to currently available stock and requires a fresh checkout identity for another attempt.

Validation now includes oversell prevention, idempotent reservation reuse, exact stock restoration after terminal Cashfree state, no second decrement on successful payment, mixed-cart rollback, pending-payment reservation retention, browser terminal recovery and the previous checkout/recovery suite. The full application/database suite reached 61/61 passing checks after the compatibility fixes.

Package 11 adds the server-side stale-intent reconciler described below. Automatic scheduling is deliberately not enabled yet; without an authorized invocation, an abandoned order that never returns and produces no useful webhook remains safely reserved rather than being released speculatively. Real Cashfree sandbox acceptance and physical Android/iPhone testing are also still required.

No production database migration, live stock movement, production Cashfree order, production environment-variable change, MSG91 send or Android change is part of Package 10.


## Package 11 progress — stale Cashfree reconciliation

Package 11 adds a bounded reconciliation path for checkout reservations that outlive the browser. It does not infer failure from local age. Instead, a service-role-only database function discovers only expired, pending rehearsal food intents, and the server independently re-reads Cashfree for every discovered order before taking any action.

The discovery function `qclub_payment_stale_intents(before, limit)` is restricted to `q_lounge_order` intents with rehearsal `qcr_...` order IDs, no terminal marker, and an expiry at or before the requested cutoff. It returns at most 20 oldest rows. `anon` and `authenticated` cannot execute it.

The existing rehearsal payment function now also accepts `?action=reconcile`, protected by a separate `QCLUB_REHEARSAL_RECONCILE_SECRET` supplied in `x-qclub-reconcile-secret`. The secret must be at least 32 bytes and is compared using `timingSafeEqual`. The action accepts no customer-supplied reconciliation parameters and runs a fixed maximum batch of 10. It returns only aggregate counts: checked, fulfilled, released, pending and errors.

For each stale order, the reconciler calls the same server-only Cashfree verification path already used by signed webhooks. A verified PAID order with a matching SUCCESS transaction is fulfilled and consumes its stock reservation. EXPIRED or TERMINATED with no SUCCESS/PENDING transaction releases stock through the same idempotent terminal-close RPC. ACTIVE, TERMINATION_REQUESTED, PENDING-payment and inconsistent gateway states remain reserved. A failure on one order increments the error count and does not release that order or abort the remaining batch.

The action shares the existing rehearsal payment serverless function, so it does not increase the Vercel function count. It is also protected by the existing rehearsal deployment gate: production Vercel and the known production/staging database project references are refused before database access.

Validation covers mixed fulfilled/released/pending/error batches, service-role-only stale discovery, qcr-food scoping, exclusion of future and already-terminal intents, a hard 20-row database cap, and the disabled-by-default HTTP gate. After correcting an SQL literal editing error found by CI, the complete application/database suite passes 64/64 checks. Build isolation also passes on the corrected head.

No cron/scheduler has been enabled and no reconciliation secret has been installed in a hosted environment. Scheduling remains a release-time operational decision after isolated rehearsal infrastructure and real Cashfree sandbox acceptance are available. No production database migration, stock movement, Cashfree order, MSG91 send, Android change or production deployment is part of Package 11.
