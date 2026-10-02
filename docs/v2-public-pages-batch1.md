# V2 public pages — Batch 1

This stacked preview continues the V2 visual merge without replacing current production behaviour.

Covered public page bodies:
- Q Shop
- Table Booking
- Membership
- Photos
- Players
- Tournaments
- Fixtures
- Leaderboards
- Hall of Fame

The implementation is presentation-only. Existing state mutations, payment initiation, booking validation, admin edit controls, storage uploads, player calculations and tournament engines remain in the current production components.

Protected operational routes are intentionally outside the `qclub-v2-live` body class. This batch must not visually or behaviourally modify QclubLedger, QclubPay, QclubQr, admin orders or Food PrintBridge.

Release sequence:
1. PR #41 public shell.
2. This Batch 1 page-body skin.
3. Subsequent CMS/admin parity batches.
4. Android TWA rebuilt only after the web surface is final.

No production deployment is authorized by this branch.
