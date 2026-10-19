# Production baseline safety review — PR #113 (2026-10-19)

Base: `main` at `4dabe20c7c15a12355c9edf0ded60d396cbc4c43` (merged PR #112).

Reason: The V2 Q Lounge route `/food` previously displayed a read-only menu and forced customers to re-browse the legacy ordering page `/offer`. PR #113 enables same-page cart/checkout while retaining the existing payment and fulfillment implementation.

## Reviewed changes to protected `src/App.jsx`

Three exact one-line substitutions **only**:

1. `<Route path="/food" element={<V2Food />} />` -> `<Route path="/food" element={<V2Food startPayment={startPayment} />} />`. The existing payment function is passed as a prop; no new payment or backend functions.
2. For `paymentContext === "food"`, `retryPath()` returns `/food?retry=1` instead of `/offer` so the new Q Lounge menu can restore an interrupted cart only on explicit retry, not on a normal visit.
3. Food payment success **Order More** button navigates to `/food` instead of `/offer`.

Reviewed Git blob SHA-1 of `src/App.jsx`: `9e67d5806f3ab2a478f86da1f1d37eb18d664c77`.

Previous pinned SHA-1: `51614e8a300b72bd3159aa813097d2399da5dcd3`.

All remaining 30 production-baseline file hashes are unchanged. No changes were made to Cashfree, MSG91, webhook fulfillment, print, QclubLedger, Q Shop, state writes, database schema, dependencies or styles in `src/styles.css`.

## UI scope

- `src/v2-live/V2Food.jsx`: cart and details add buttons, live catalogue quantity/total projection, checkout fields and reuse of the established `startPayment` tags.
- `src/v2-live/lounge-order.mjs`: pure testable catalogue-based item availability, quantity and price calculations.
- `src/v2-live/v2-live.css`: selectors scoped to V2 Q Lounge.
- Existing `/offer` remains available as a compatibility fallback, without redirect until real flow verification.

## Verification gates

PR #113 needs all CI regression tests, production/preview Vite build checks and mobile browser tests. Actual Cashfree payment/MSG91 notification/printing remains a separate real-world verification; no unverified payment success should be claimed.

Baseline `tests/production-baseline.json` is updated to the reviewed App.jsx blob SHA only after an explicit three-hunk diff review. This is **not** a change to production deployment until merge.
