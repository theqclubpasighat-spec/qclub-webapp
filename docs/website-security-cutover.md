# Website security cutover — work in progress

This branch is based on production commit 4b2623c1e4cf70a9c541d347db1acb75b80e707b and preserves the shared-hourly QChase/Rummy work.

## Implemented in this branch

- Legacy payment creation calculates amounts from the current catalogue and saves canonical line prices. Duplicate cart lines cannot bypass the stock check.
- Cashfree lookup is required before server-side fulfilment. The browser's acknowledgement no longer establishes fulfilment.
- Food receipts and print requests, Q Shop stock/receipts, bookings, memberships, tournament entries, speaker notices and ticker notices are applied in a server state transition.
- Completion and effects use the same exact-revision conditional write. Concurrent callbacks are idempotent; retries re-read state instead of restoring a stale full snapshot.
- Legacy create-order, status and webhook payment writes use the shared compare-and-swap helper.
- The browser skips its Q Shop recovery writer when the server reports fulfilment.

## Release gate — do not merge this draft yet

This is an incomplete security cutover. Production's existing public full-state read and unauthenticated writer have NOT been closed by this branch. No production storage policy, credential or database schema has been changed.

Still required before the complete cutover:

1. Migrate cloud.js reads and writes, PIN login/change, CMS and operations to server sessions. Remove private full-state browser caches and test expired/revoked sessions.
2. Migrate the separate Kitty/QChase access, reset, final-lock and master-edit PIN checks with restricted server authorization; preserve their gameplay workflows.
3. Move job submissions and uploads to dedicated commands. Transfer existing applicant documents into private storage, verify copies, update references and remove old public copies. Ledger product-image uploads also require authenticated signed uploads before removing public storage writes.
4. Verify booking availability, member-rate eligibility, public receipt access and customer submission flows with the filtered state. Public read projections must preserve the complete V2 content contract.
5. Add reservation handling for concurrent Q Shop checkout attempts. Current stock validation is a quote-time check, not a stock reservation. Reconcile paid legacy orders before enabling new completion behavior.
6. Verify all payment contexts through hosted preview using synthetic gateway evidence, including printer and notification contracts. Unit/database tests alone are not the release gate.
7. Audit other full-state server writers, including printing and CMS, for concurrent-save behavior.
8. Deploy verified client/server changes; restrict legacy table/storage policies and retire the old writer; rotate exposed credentials and revoke old sessions; verify production reads, edits, payments, uploads, scoring and printing.

## Verification performed

The new tests cover catalogue-price tampering, invalid quantities, duplicate stock lines, repeated fulfilment for all five contexts, historical membership compatibility, and concurrent callbacks plus a staff edit against disposable PostgreSQL. These tests do not constitute a complete live security audit or payment rehearsal.

No real customer charge, applicant upload, paid WhatsApp test or production data mutation is part of these checks.
