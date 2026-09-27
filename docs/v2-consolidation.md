# V2 consolidation — review checkpoint

Production baseline: `03b6148acb484b2983464df18932e237297e1ada`.
V2 donor: `a07af1a706c7e8809052599ef9fa3610bfcf2b1d`.

## First increment

This branch adds an isolated, read-only mobile UI preview at `/__v2-preview`
and `/__v2-preview/food` on Vercel preview deployments. Production builds
exclude its JavaScript and CSS. Local development requires
`QCLUB_LOCAL_V2_PREVIEW=1 npm run dev`.

The preview adapts V2's felt/brass public design without upgrading production
React, router, QR or Supabase dependencies. It does not import the production
App, auth client, background jobs or global styles. Its only API request is a
GET to the existing public F&B master catalogue without an application auth
token (same-origin cookies allow Vercel's protected preview access). No ordering,
payment, inventory, attendance or membership write is exposed in this preview.
Links labelled as live-site links open existing public workflows.

All ordinary URLs retain the existing production application. The existing
Ledger API rewrites, Cashfree webhook, MSG91 handlers, shared menu and player
account billing are preserved. The pinned baseline test checks their actual
Git blob hashes; it must not be relaxed to conceal a change.

## Verification commands

```sh
npm ci
node --test tests/v2-preview.test.mjs
VERCEL_ENV=production npm run build
node scripts/check-preview-bundle.mjs absent
VERCEL_ENV=preview npm run build
node scripts/check-preview-bundle.mjs present
```

These checks do not certify real payments or complete browser compatibility.
Mobile browser checks remain required: 320/360/390/430 px widths, navigation,
category selection, search, item dialog, keyboard focus, image failure,
network failure/retry, no horizontal overflow and phone keyboard behaviour.

## Remaining integration sequence

1. Review the preview on phones and keep the actual production content current.
2. Map all V2 routes/features to current production, recording replacement,
   enhancement or genuinely new functionality for each one.
3. Port remaining public UI in small increments, keeping existing checkout,
   receipt, booking and authentication contracts until replacements pass tests.
4. Add server-backed operations individually. V2 attendance/shifts/expenses
   and inventory sample-state pages are not accepted as working functionality.
5. Review V2 security paths: server-derived catalogue prices, real Cashfree
   checkout, webhook replay/fulfilment, role enforcement and private data access.
6. Prepare compatible database migrations and a restore-tested backup; reconcile
   members, players, historical receipts, orders and result identifiers.
7. Verify Ledger and Android end-to-end using isolated data, including member
   rates, join/leave timing, loser-pays splits, walk-in F&B, cash/UPI partial
   settlement, stock, receipts and staff/admin permissions.
8. Refresh from production main immediately before release. Obtain approval for
   the concrete live cutover. Preserve the prior deployment and compatible DB
   schema so rollback does not invalidate transactions created after cutover.
9. Delete qclub-staging only after verifying reconciliation, recovery and zero
   remaining dependencies from applications, storage URLs, functions and jobs.

## Known boundaries

No production deployment, database migration or staging deletion is performed
by this increment. Earlier local all-at-once integration code is not the base
for this branch. Baseline updates require explicitly reviewing new production
commits so later Ledger development is not overwritten.
