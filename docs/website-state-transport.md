# Website state server transport

The production-capable transport is `/api/snooker/v1/website/state`. It adds a safe server contract without switching the legacy browser sync path.

- Anonymous GET returns explicit public field projections, including catalogues, published players/fixtures, membership tiers and table rates.
- Authenticated GET validates a stored, unexpired, unrevoked session and returns only sections allowed for ADMIN, STAFF or COMMITTEE.
- PATCH requires a valid server session. Caller-supplied role claims are ignored. It preserves server credentials and payment records, limits staff/committee edits and uses an atomic revision predicate.
- All responses are uncached. Cross-site mutations and malformed requests are rejected with generic errors.

Application/database tests cover projection and nested secret exclusion, revoked sessions, stale revisions, role restrictions, malformed payloads and preservation of server-owned data. Existing checkout, CMS, Ledger and public mobile browser regressions must pass before release.

## Remaining security cutover

This transport alone does not remediate the live legacy exposure. `src/cloud.js` still reads the full `qclub_state` row and posts whole objects to `/api/qclub-state-write`. Existing public read policy, legacy PIN login, applicant document storage and browser payment fulfilment still require replacement.

Before restricting those paths, migrate legacy login/state polling, public submissions, authoritative payment fulfilment and private applicant uploads/downloads. Verify compatibility and cache cleanup, deploy the compatible clients, then restrict database/storage policies and retire the old write route. Credential rotation must include the legacy login path; rotating only rehearsal credentials does not protect production.
