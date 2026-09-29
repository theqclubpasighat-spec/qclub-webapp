# Package 1: isolated security foundation

Status: rehearsal only. This package does not remediate the live application's existing public state/PIN exposure. No client calls this API yet. Do not merge as a completed security cutover or apply this migration to a live database.

Base: `qclub-webapp` main `b8653b0d8df44248b3edcad0e6b1fae3a44cd838`.

## Included

- A new, disabled-by-default `/api/qclub-security?action=...` endpoint.
- Salted scrypt PIN hashes in a private schema; no browser grants to hashes or service RPCs.
- Server validation of existing Ledger-format bearer sessions, role checks, expiry and revocation.
- Fail-closed login throttling and credential-version checks that prevent a login finishing with a rotated PIN.
- Main-admin-only credential rotation with session revocation and audit in one database transaction.
- A deliberately small public content projection and ADMIN-only content edits with optimistic concurrency. This is not a replacement for the full application state contract.
- An insert-only credential import script, dry-run by default, without printing PINs or hashes.

Existing UI, Ledger routes, payment handlers, shared state endpoints, database policies and dependencies are unchanged. The mobile design preview remains a separate review artifact.

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
