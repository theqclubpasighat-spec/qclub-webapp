# V2 preview verification — 27 September 2026

Tested application commit: `1229d425d454ba1a34ec96a7361fe09345da1e03`.
Production baseline: `69e79b722bf245eb41dbad123a117371b6d388b1`.

## Results

- Latest six production fixes incorporated without changing their Ledger/server/migration contents.
- Six Node safety tests pass, including protected-file identity and catalogue validation.
- Production build passes; V2 preview assets are excluded.
- Preview build passes; preview assets are included.
- GitHub Actions run 36311304818 succeeds.
- Vercel preview deployment dpl_GFET6YRJPf5EWHVf5Rx2r7bpu9Tm is usable.
- Browser iframe checks at widths 320, 360, 390 and 430: Home and Q Lounge have no horizontal overflow; catalogue retains two columns; visible buttons meet 44px height.
- Navigation, menu dismissal, category filtering, search, item details and Escape dismissal verified.
- Catalogue reads the existing public master. No ordering, payment or database writes were exercised.

## Scope and remaining gates

These are Chromium iframe-width checks, not physical iPhone/Android or Safari tests. Authenticated Ledger, bookings, payment and game flows have not been regression-tested in this increment. This does not establish full V2 parity or a zero-regression guarantee.

The integration remains a draft preview. Production has not been changed by this work. No database migration was applied and staging was not deleted. Complete feature-specific tests, role/RLS review, recoverable backup checks and dependency reconciliation before release or staging removal.

See v2-route-inventory.md for the source-route mapping. Source-route counts do not establish functional completeness.
