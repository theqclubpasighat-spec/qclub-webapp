# V2 route integration inventory

Source snapshots: production baseline `1b94906c`; donor V2 `a07af1a`; public reconciliation PR #48; production Website Manager PR #52; final parity PR #53.

This file records the original V2 integration decisions. The V2 public shell, production Website Manager and final staff-operations parity block are now merged and deployed to production. For the authoritative current route/access/alias map, use `docs/production-route-registry.md`. Do not use the older "Existing exact path" column below as a current production census; it reflects the earlier reconciliation baseline.

| V2 route | Page | Declared role | Existing exact path | Integration decision |
|---|---|---|---|---|
| `/` | Home | public | Yes | Preview implemented; preserve production content and admin edits before replacement |
| `/about` | About | public | Yes | Port presentation; retain current data/actions until feature-specific regression passes |
| `/contact` | Contact | public | Yes | Port presentation; retain current data/actions until feature-specific regression passes |
| `/jobs` | Careers | public | Yes | Port presentation; retain current data/actions until feature-specific regression passes |
| `/photos` | Photos | public | Yes | Port presentation; retain current data/actions until feature-specific regression passes |
| `/offer` | Offers | public | Yes | Use existing Q Lounge master catalogue; browse preview complete, checkout stays production |
| `/live` | Live Matches | public | Yes | Preserve current engines, rules, IDs and displays; migrate only after replay tests |
| `/tv` | Club TV Display | staff | Yes | Preserve current engines, rules, IDs and displays; migrate only after replay tests |
| `/membership` | Membership | public | Yes | Port presentation; retain current data/actions until feature-specific regression passes |
| `/members` | Members | public | Yes | Port presentation; retain current data/actions until feature-specific regression passes |
| `/member-registry` | Member Registry | staff | Yes | Map existing data and enforce server roles; review RLS and writes before enabling |
| `/book` | Book a Table | public | Yes | Port presentation; retain current data/actions until feature-specific regression passes |
| `/tournaments` | Tournaments | public | Yes | Port presentation; retain current data/actions until feature-specific regression passes |
| `/tournament-register` | Tournament Registration | public | Yes | Port presentation; retain current data/actions until feature-specific regression passes |
| `/fixtures` | Fixtures & Results | public | Yes | Port presentation; retain current data/actions until feature-specific regression passes |
| `/leaderboard` | Leaderboard | public | Yes | Port presentation; retain current data/actions until feature-specific regression passes |
| `/players` | Players | public | Yes | Port presentation; retain current data/actions until feature-specific regression passes |
| `/handicap` | Handicap & Classification | public | Yes | Port presentation; retain current data/actions until feature-specific regression passes |
| `/halloffame` | Hall of Fame | public | Yes | Port presentation; retain current data/actions until feature-specific regression passes |
| `/air-hockey` | Air Hockey | public | Yes | Port presentation; retain current data/actions until feature-specific regression passes |
| `/foosball` | Foosball | public | Yes | Port presentation; retain current data/actions until feature-specific regression passes |
| `/massage-chair` | Massage Chair | public | Yes | Port presentation; retain current data/actions until feature-specific regression passes |
| `/air-hockey-info` | Air Hockey Info | public | Yes | Port presentation; retain current data/actions until feature-specific regression passes |
| `/foosball-info` | Foosball Info | public | Yes | Port presentation; retain current data/actions until feature-specific regression passes |
| `/massage-chair-info` | Massage Chair Info | public | Yes | Port presentation; retain current data/actions until feature-specific regression passes |
| `/shop` | The Q Shop | public | Yes | Keep production order/payment/receipt contracts; audit donor checkout and server prices |
| `/food` | Q Lounge / Food | public | No | Use existing Q Lounge master catalogue; browse preview complete, checkout stays production |
| `/shop/successful-order-receipts` | Order Receipts | staff | Yes | Keep production order/payment/receipt contracts; audit donor checkout and server prices |
| `/rummy-snooker` | Q Chase Snooker | public | Yes | Preserve current engines, rules, IDs and displays; migrate only after replay tests |
| `/rummy-snooker-table-1` | Q Chase — Table 1 Scorer | scorer | Yes | Preserve current engines, rules, IDs and displays; migrate only after replay tests |
| `/rummy-snooker-table-2` | Q Chase — Table 2 Scorer | scorer | Yes | Preserve current engines, rules, IDs and displays; migrate only after replay tests |
| `/rummy-snooker-table-3` | Q Chase — Table 3 Scorer | scorer | Yes | Preserve current engines, rules, IDs and displays; migrate only after replay tests |
| `/rummy-snooker-table-1-display` | Q Chase — Table 1 Display | public | Yes | Preserve current engines, rules, IDs and displays; migrate only after replay tests |
| `/rummy-snooker-table-2-display` | Q Chase — Table 2 Display | public | Yes | Preserve current engines, rules, IDs and displays; migrate only after replay tests |
| `/rummy-snooker-table-3-display` | Q Chase — Table 3 Display | public | Yes | Preserve current engines, rules, IDs and displays; migrate only after replay tests |
| `/qchase-records` | Q Chase Records | public | Yes | Preserve current engines, rules, IDs and displays; migrate only after replay tests |
| `/qchase-monthly` | Q Chase Monthly | public | Yes | Preserve current engines, rules, IDs and displays; migrate only after replay tests |
| `/kitty` | Snooker & Pool Kitty | public | Yes | Preserve current engines, rules, IDs and displays; migrate only after replay tests |
| `/kitty-table-1` | Kitty — Table 1 Scorer | scorer | Yes | Preserve current engines, rules, IDs and displays; migrate only after replay tests |
| `/kitty-table-2` | Kitty — Table 2 Scorer | scorer | Yes | Preserve current engines, rules, IDs and displays; migrate only after replay tests |
| `/kitty-table-3` | Kitty — Table 3 Scorer | scorer | Yes | Preserve current engines, rules, IDs and displays; migrate only after replay tests |
| `/kitty-table-4` | Kitty — Table 4 Scorer | scorer | Yes | Reconciled to current T4 Pool mapping using the existing Kitty engine; legacy mismatched local snapshots are archived instead of restored |
| `/kitty-table-1-display` | Kitty — Table 1 Display | public | Yes | Preserve current engines, rules, IDs and displays; migrate only after replay tests |
| `/kitty-table-2-display` | Kitty — Table 2 Display | public | Yes | Preserve current engines, rules, IDs and displays; migrate only after replay tests |
| `/kitty-table-3-display` | Kitty — Table 3 Display | public | Yes | Preserve current engines, rules, IDs and displays; migrate only after replay tests |
| `/kitty-table-4-display` | Kitty — Table 4 Display | public | Yes | Added T4 Pool display route using the existing Kitty display engine |
| `/kitty-records` | Kitty Records | public | Yes | Preserve current engines, rules, IDs and displays; migrate only after replay tests |
| `/kitty-monthly` | Kitty Monthly | public | Yes | Preserve current engines, rules, IDs and displays; migrate only after replay tests |
| `/staff-walkins` | Walk-ins | staff | Yes | Implement authenticated persistence; reject sample-state donor behaviour |
| `/inventory` | Inventory | staff | Yes | Use Ledger catalogue/stock API; no duplicate inventory |
| `/staff-shifts` | Staff Shifts | staff | No | **Promoted in PR #53:** authenticated production persistence via canonical Q Club session/API; sample-state donor behaviour rejected |
| `/expense` | Expenses | staff | No | **Promoted in PR #53:** authenticated production expense persistence with admin void controls |
| `/staff-attendance` | Staff Attendance | staff | No | **Promoted in PR #53:** authenticated clock-in/out persistence via canonical Q Club session/API |
| `/review-panel` | Review Panel | committee | Yes | Preserve current engines, rules, IDs and displays; migrate only after replay tests |
| `/match-ledger` | Match Ledger | staff | Yes | Preserve current engines, rules, IDs and displays; migrate only after replay tests |
| `/food-print-bridge` | Food Print Bridge | staff | Yes | Port presentation; retain current data/actions until feature-specific regression passes |
| `/admin-panel` | Admin Panel | admin | Yes | Map existing data and enforce server roles; review RLS and writes before enabling |
| `/admin/orders` | Orders | admin | Yes | Map existing data and enforce server roles; review RLS and writes before enabling |
| `/admin/orders-archive` | Orders Archive | admin | Yes | Map existing data and enforce server roles; review RLS and writes before enabling |
| `/admin/login` | Admin Sign In | public | No | Retired: donor uses a separate Supabase email/password/magic-link auth stack; merged production admin remains PIN/session based |
| `/reset-password` | Reset Password | public | No | Retired with donor email/password auth; no second credential system is introduced beside the production PIN/session model |
| `/admin` | CMS Dashboard | admin | No | **Promoted in PR #52:** live Website Manager using canonical Q Club PIN/session authority |
| `/admin/club-details` | Club Profile | admin | No | Reconciled into protected CMS content sections; no duplicate state |
| `/admin/membership-tiers` | Membership Content | admin | No | Reconciled into protected Membership tiers editor |
| `/admin/rates` | Rates & Happy Hours | admin | No | Standard/member table-rate editing reconciled; happy-hours donor behavior not activated |
| `/admin/documents` | Pages & Policies | admin | No | Reconciled into protected About & policies/content editors |
| `/admin/notices` | Notices | admin | No | Reconciled into protected public Notices editor; operational entries preserved |
| `/admin/food-menu` | Food Menu | admin | No | Reconciled by bridge to authoritative `/QclubLedger` catalogue; no duplicate menu/inventory state |
| `/admin/shop` | Q Shop Catalogue | admin | No | Reconciled into protected QShop catalogue CMS while preserving stock/checkout identity |
| `/admin/media` | Media Library | admin | No | Hero/media presentation fields reconciled; destructive storage management not activated |
| `/admin/theme` | Theme | admin | No | **Promoted in PR #52:** protected theme editor; saved tokens are consumed by the live V2 shell |
| `/admin/templates` | Notification Templates | admin | No | Reconciled as non-secret template-name CMS; live MSG91 credentials/dispatch remain separate |
| `/admin/feature-flags` | Feature Flags | admin | No | Reconciled as configuration-only flags; live route activation remains pending |
| `/admin/settings` | Settings Hierarchy | admin | No | Reconciled into protected Settings hub over existing editors and canonical operational masters |
| `/admin/data-tools` | Data Tools | admin | No | Retire generic mutation-console behavior; use bounded canonical exports/tools only, with no direct state editor |
| `/admin/storage-migrate` | Storage Migration | admin | No | Retired: one-off donor copier targeted the staging-era storage migration; staging is deleted and production media paths are retained |
| `/admin/audit-log` | Audit Log | admin | No | Reconciled as read-only Reports & audit directory over existing Ledger/game/order/committee records |
| `/admin/members` | Members | staff | No | Canonical destination mapped to `/member-registry`; new STAFF write-role grant not activated |
| `/admin/bookings` | Bookings | staff | No | **Promoted in PR #53:** alias routes to authoritative `/QclubLedger`; no duplicate booking store |
| `/admin/players` | Players | committee | No | Canonical destinations mapped to `/players` and `/review-panel`; COMMITTEE write-role grant pending |
| `/admin/tournaments` | Tournaments | committee | No | Canonical destination mapped to `/tournaments`; COMMITTEE write-role grant pending |
| `/admin/standings` | Standings | committee | No | **Promoted in PR #53:** alias routes to authoritative `/leaderboard` |
| `/admin/hall-of-fame` | Hall of Fame Admin | committee | No | Canonical destination mapped to `/halloffame`; COMMITTEE write-role grant pending |
| `/admin/live-games` | Live Games | committee | No | Canonical destination mapped to `/live`; scorer/game-engine permissions remain unchanged |
| `/admin/food-orders` | Food Orders | staff | No | Canonical destination mapped to existing `/admin/orders`; no duplicate order store |
| `/admin/shop-orders` | Q Shop Admin | staff | No | Canonical destination mapped to `/shop/successful-order-receipts`; payment/receipt contracts unchanged |
| `/admin/payments` | Payments | staff | No | Canonical billing/payment destination mapped to `/QclubLedger`; no alternate payment admin path |
| `/admin/reports` | Reports | staff | No | Reconciled via Reports & audit directory over existing Ledger, Kitty, Q Chase and review records |
| `/receipt` | Receipt | public | No | Generic donor receipt route retired: production keeps context-specific food/shop/payment receipt flows so no second receipt resolver is introduced |
| `/payment-status` | Payment Status | public | Yes | Keep production order/payment/receipt contracts; audit donor checkout and server prices |
| `/Craxam` | Craxam Auth Bridge | public | No | Retired after CraXam verification: current Google OAuth redirects directly to `craxam://callback`; no web callback hop required |
| `/craxam` | Craxam Auth Bridge | public | No | Retired after CraXam verification: Android manifest/auth configuration handles `craxam://callback` directly |
| `/craxam/privacy` | CraXam Privacy Policy | public | Yes | Preserve production legal route; independent of the retired OAuth bridge |
| `/terms` | Terms of Use | public | Yes | Port presentation; retain current data/actions until feature-specific regression passes |
| `/refund` | Refund Policy | public | Yes | Port presentation; retain current data/actions until feature-specific regression passes |
| `/privacy` | Privacy Policy | public | Yes | Port presentation; retain current data/actions until feature-specific regression passes |
| `/tournament-legal` | Tournament Rules & Terms | public | Yes | Port presentation; retain current data/actions until feature-specific regression passes |
| `/rules` | Club Rules | public | No | Reconciled as a V2 bridge to the authoritative Terms & Conditions rules section; no duplicate rules copy |
| `/bylaws` | Bylaws | public | No | Not promoted: donor text is an unapproved governance document; publish only after formal club bylaws are approved |
| `/refund-policy` | Refund Policy | public | No | Reconciled as an alias to the existing production Refund Policy content; no duplicate policy state |
| `/pricing` | Pricing | public | No | Reconciled as a read-only V2 page using existing membership tiers and booking table rates |
| `/legal` | Legal Notice | public | No | Reconciled as a policy hub linking existing Terms, Refund, Privacy and Tournament Legal pages; no new legal text invented |
| `/disclaimer` | Disclaimer | public | No | Not promoted: donor copy includes unverified operational claims; existing Terms/Legal pages remain authoritative |
| `/anti-gambling` | Anti-Gambling Notice | public | No | Reconciled by reusing the existing Tournament Legal Notice, which already contains the club's skill-based/no-wagering position |
| `/feedback` | Feedback | public | No | Reconciled as a safe V2 bridge to the existing Contact page; donor placeholder phone/email and duplicate feedback storage are not used |

## Production-only routes to preserve

- `/QclubLedger`
- `/QclubPay`
- `/QclubQr`
- `/craxam/delete-account`
- `/qclubledger`
- `/qclubpay`
- `/qclubqr`

No route should be removed solely because it is missing from the donor. Ledger, Pay and QR retain their current PIN/payment contracts. The CraXam account-deletion page remains available.
