# CI baseline reconciliation — 16 October 2026

Reviewed production commit: `93d8e30128617ddc6fb79b4cfcd5ec51fb3beea6`.
This repair changes tests and documentation only. It does not change application
source, API handlers, dependencies, migrations, deployment configuration or workflows.

The previous baseline described the October 5 server-payment cutover. Its hashes
were no longer aligned with subsequent production releases. All 31 protected paths
remain protected; 27 are byte-for-byte unchanged from that baseline. Only these four
hashes change:

| File | Production evolution reviewed | Relevant regression coverage |
|---|---|---|
| `src/App.jsx` | Server login and state transport (#67–69); storefront/fixtures (#70–71); permanent QR routes (#87); operational navigation (#97); protected storage (#108) | Website-state, legacy-payment, booking, QShop, tournament, navigation and browser checkout tests |
| `src/cloud.js` | Role-specific server reads, authenticated patches, exact revision conflict handling (#68–69); refresh signed applicant links without persisting them (#108) | Website-state database tests plus new cloud transport tests |
| `src/components/qclub-ledger-page.jsx` | Manual/online payment distinction and balances (#73); shared/hourly and per-game controls; separate presence/payment controls (#76–89); continuous games (#90–91); receipt recovery (#92–93); stale-client lock (#95); corrections/championship (#98–101); admin cleanup (#102); Daily Register (#103–105); checkout speed (#107); signed uploads (#108) | Shared-hourly Postgres scenario, Kitty, Daily Register, checkout performance/recovery, payment and storage tests |
| `src/server/snooker-v1.js` | Private credential verification and session creation; server-priced charges, balance/payment RPCs, pending online settlement guards; QR access/order approval; token-scoped QChase lifecycle; admin-only correction/deletion; stale-client mutation rejection; Daily Register and protected storage routes | Security/database, payment fulfilment/webhook/reconciliation, reservation, Daily Register, state-concurrency and storage tests |

Review concentrated on authentication boundaries, keeping payment separate from
player presence, server pricing, pending-payment guards, idempotency calls, state
revision checks and matching client/server command paths. Payment webhook wrappers,
legacy payment handlers, package files, Supabase client configuration and all previously
pinned migrations still have their original hashes. This is a reconciliation of
existing production releases, not certification that every historical feature is
free of defects; the automated scenarios define the verification scope.

## Corrected expectations

- CMS authentication now verifies private credentials using `qclub_security_login_pin`
  and creates sessions through `qclub_security_create_session`. The test must not demand
  the removed plaintext `admin.committeePin` lookup. Committee remains a distinct role;
  CMS writes still require ADMIN and `admin-main`.
- QChase presence uses **Leave Table • Keep Club Tab**, **Rejoin**, and a separate payment
  button. The test checks LEAVE/REJOIN wiring and settling shared time before updating
  presence, rather than requiring the retired combined button labels.
- The actual route set has 117 entries. The registry already documented 115, while its
  test expected 111. Add the two existing table QR routes to the registry and preserve
  exact route-set equality and retired-route checks.
- Keep the exact-content baseline assertion for every protected file. Updating only
  the four reviewed hashes means future application changes still fail until reviewed.

## Verification requirements

Run all application/Postgres tests, production → preview → production build-isolation
checks, and all three existing mobile browser fixtures. Do not skip failing checks or
remove workflow jobs. Browser fixtures use synthetic payment APIs and disposable
Postgres; no real payments or production writes are part of this repair.
