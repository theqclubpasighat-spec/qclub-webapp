# Package 1: isolated security foundation

Status: rehearsal only. This package does not remediate the live application's existing public state/PIN exposure. The opt-in `/__admin-preview` client now calls this API only in rehearsal builds. Existing production screens do not call it. Do not merge as a completed security cutover or apply this migration to a live database.

Base: `qclub-webapp` main `b8653b0d8df44248b3edcad0e6b1fae3a44cd838`.

## Included

- A new, disabled-by-default `/api/qclub-security?action=...` endpoint.
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
