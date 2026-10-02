# V2 salvage manifest before qclub-staging retirement

Date: 2026-10-02

This document records what must be preserved from the separate QclubV2 donor before the paid Supabase project `qclub-staging` is retired. The authoritative live application remains `qclub-webapp`; QclubV2 is a donor, not a replacement backend.

## Audit result

The original goal — merge the best V2 features and UI into production without breaking the current live engines — is **not yet fully complete**.

Current donor route count: 105.
Current live route count: 71.
PR #41 adds the V2 public shell plus `/food`, but most existing public page bodies still use the legacy production UI.
PR #25 contains the new secure CMS/payment rehearsal backend but does not expose the full V2 CMS route set.

## Preserve / still port

### Public UI
- V2 felt/brass/ivory design system and responsive layout.
- Rich V2 Q Shop product UX: gallery, option selection, cart sheet, share/deep-link behaviour, stock display.
- Rich V2 Q Lounge UX: category dock, product images/lightbox, live card quantities, cart sheet and checkout presentation.
- Public Membership, Booking, Players, Tournaments, Fixtures, Leaderboard, Hall of Fame, Photos and static/legal pages should receive the same V2 visual language instead of dropping back to legacy page bodies.
- V2 public route registry/navigation structure remains a useful reference.

### Real V2 CMS capabilities not yet replaced by PR #25
- CMS dashboard.
- Club profile/details.
- Membership-tier editor.
- Rates / happy-hours editor.
- Documents / policy editor and version history.
- Food-menu CMS.
- Q Shop CMS.
- Media library.
- Theme editor.
- Notification-template editor.
- Feature flags.
- System / organisation / branch settings.
- CSV/data tools and backup/restore tooling.
- Searchable append-only audit log.
- Admin operational pages for members, bookings, players, tournaments, standings, hall of fame, live games, food/shop orders, payments and reports.

PR #25 currently provides a deliberately smaller secure content editor (club information, policies, food-page copy and notices). It is a security foundation, not yet a feature-equivalent replacement for the full V2 CMS.

### API-backed V2 operational surfaces worth carrying forward
- Operational reports computed live from the database.
- Bookings queue with guarded state transitions and optimistic concurrency.
- Trusted payments ledger.
- API-backed member registry.
- Other V2 admin/operations pages should be assessed individually against QclubLedger so we keep the clearer UI without duplicating stronger live workflows.

## Already superseded by current production / do not port blindly
- Kitty and Q Chase donor engines: current production has newer billing, persistent customer accounts, table displays, winner-pays flow and later hardening. Keep live engines.
- Table billing / Club Tabs: current production implementation is newer and authoritative.
- Running F&B tabs and F&B autocomplete: current production is newer.
- Cashfree/MSG91/PrintBridge: preserve current production contracts; PR #25 adds safer future fulfilment/effect handling.
- V2 static TV showcase uses hard-coded sample slides; current live TV/display implementation is the better source.
- V2 sample Inventory page is local-state demo data, not a production inventory system.
- V2 Staff Shifts, Staff Attendance and Staff Expenses pages are local-state demo pages. Do not treat them as completed operational features; implement server-backed versions only if required.

## PR mapping

- PR #25 — secure CMS/payment/rehearsal foundation. Current with production and passing 112/112 tests at the latest audited checkpoint.
- PR #41 — V2 public shell. Home/Q Lounge/navigation/theme only; refresh on latest production before merge.
- PR #28 — Android TWA. Rebuild only after final web consolidation.
- A later public-page/CMS integration PR is still required to complete V2 visual and CMS parity.

## Staging database retirement

Source code, migrations and the V2 architecture remain preserved in GitHub even after Supabase staging deletion.

Before deleting `qclub-staging`:
1. Preserve non-sensitive configuration snapshot (adjacent archive JSON).
2. Keep this feature manifest.
3. Do not copy staging customer/order/player history into production unless a later reconciliation explicitly requires it.
4. Do not use qclub-staging for PR #25 rehearsal; use a disposable development branch instead.
5. Remove/retire any Vercel qclubv2 deployment or environment references after confirming they are no longer needed for visual comparison.

Deleting qclub-staging must not be interpreted as declaring the V2 merge complete. It only retires the obsolete paid donor database.
