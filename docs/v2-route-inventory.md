# V2 route integration inventory

Source snapshots: production `69e79b7`; donor V2 `a07af1a`.

This is a source-route inventory, not a claim that every route works or is deployed. V2 declares 105 routes. Production App declares 66 named routes plus its catch-all. 59 paths overlap, 46 V2 paths are absent from that production registry, and seven production paths are absent from V2. Aliases and alternate server routing need separate verification.

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
| `/kitty-table-4` | Kitty — Table 4 Scorer | scorer | No | Preserve current engines, rules, IDs and displays; migrate only after replay tests |
| `/kitty-table-1-display` | Kitty — Table 1 Display | public | Yes | Preserve current engines, rules, IDs and displays; migrate only after replay tests |
| `/kitty-table-2-display` | Kitty — Table 2 Display | public | Yes | Preserve current engines, rules, IDs and displays; migrate only after replay tests |
| `/kitty-table-3-display` | Kitty — Table 3 Display | public | Yes | Preserve current engines, rules, IDs and displays; migrate only after replay tests |
| `/kitty-table-4-display` | Kitty — Table 4 Display | public | No | Preserve current engines, rules, IDs and displays; migrate only after replay tests |
| `/kitty-records` | Kitty Records | public | Yes | Preserve current engines, rules, IDs and displays; migrate only after replay tests |
| `/kitty-monthly` | Kitty Monthly | public | Yes | Preserve current engines, rules, IDs and displays; migrate only after replay tests |
| `/staff-walkins` | Walk-ins | staff | Yes | Implement authenticated persistence; reject sample-state donor behaviour |
| `/inventory` | Inventory | staff | Yes | Use Ledger catalogue/stock API; no duplicate inventory |
| `/staff-shifts` | Staff Shifts | staff | No | Implement authenticated persistence; reject sample-state donor behaviour |
| `/expense` | Expenses | staff | No | Implement authenticated persistence; reject sample-state donor behaviour |
| `/staff-attendance` | Staff Attendance | staff | No | Implement authenticated persistence; reject sample-state donor behaviour |
| `/review-panel` | Review Panel | committee | Yes | Preserve current engines, rules, IDs and displays; migrate only after replay tests |
| `/match-ledger` | Match Ledger | staff | Yes | Preserve current engines, rules, IDs and displays; migrate only after replay tests |
| `/food-print-bridge` | Food Print Bridge | staff | Yes | Port presentation; retain current data/actions until feature-specific regression passes |
| `/admin-panel` | Admin Panel | admin | Yes | Map existing data and enforce server roles; review RLS and writes before enabling |
| `/admin/orders` | Orders | admin | Yes | Map existing data and enforce server roles; review RLS and writes before enabling |
| `/admin/orders-archive` | Orders Archive | admin | Yes | Map existing data and enforce server roles; review RLS and writes before enabling |
| `/admin/login` | Admin Sign In | public | No | Map existing data and enforce server roles; review RLS and writes before enabling |
| `/reset-password` | Reset Password | public | No | Map existing data and enforce server roles; review RLS and writes before enabling |
| `/admin` | CMS Dashboard | admin | No | Map existing data and enforce server roles; review RLS and writes before enabling |
| `/admin/club-details` | Club Profile | admin | No | Map existing data and enforce server roles; review RLS and writes before enabling |
| `/admin/membership-tiers` | Membership Content | admin | No | Map existing data and enforce server roles; review RLS and writes before enabling |
| `/admin/rates` | Rates & Happy Hours | admin | No | Map existing data and enforce server roles; review RLS and writes before enabling |
| `/admin/documents` | Pages & Policies | admin | No | Map existing data and enforce server roles; review RLS and writes before enabling |
| `/admin/notices` | Notices | admin | No | Map existing data and enforce server roles; review RLS and writes before enabling |
| `/admin/food-menu` | Food Menu | admin | No | Use Ledger catalogue/stock API; no duplicate inventory |
| `/admin/shop` | Q Shop Catalogue | admin | No | Keep production order/payment/receipt contracts; audit donor checkout and server prices |
| `/admin/media` | Media Library | admin | No | Map existing data and enforce server roles; review RLS and writes before enabling |
| `/admin/theme` | Theme | admin | No | Map existing data and enforce server roles; review RLS and writes before enabling |
| `/admin/templates` | Notification Templates | admin | No | Map existing data and enforce server roles; review RLS and writes before enabling |
| `/admin/feature-flags` | Feature Flags | admin | No | Map existing data and enforce server roles; review RLS and writes before enabling |
| `/admin/settings` | Settings Hierarchy | admin | No | Map existing data and enforce server roles; review RLS and writes before enabling |
| `/admin/data-tools` | Data Tools | admin | No | Map existing data and enforce server roles; review RLS and writes before enabling |
| `/admin/storage-migrate` | Storage Migration | admin | No | Retire obsolete staging migration action; keep production media paths |
| `/admin/audit-log` | Audit Log | admin | No | Map existing data and enforce server roles; review RLS and writes before enabling |
| `/admin/members` | Members | staff | No | Map existing data and enforce server roles; review RLS and writes before enabling |
| `/admin/bookings` | Bookings | staff | No | Map existing data and enforce server roles; review RLS and writes before enabling |
| `/admin/players` | Players | committee | No | Map existing data and enforce server roles; review RLS and writes before enabling |
| `/admin/tournaments` | Tournaments | committee | No | Map existing data and enforce server roles; review RLS and writes before enabling |
| `/admin/standings` | Standings | committee | No | Map existing data and enforce server roles; review RLS and writes before enabling |
| `/admin/hall-of-fame` | Hall of Fame Admin | committee | No | Map existing data and enforce server roles; review RLS and writes before enabling |
| `/admin/live-games` | Live Games | committee | No | Preserve current engines, rules, IDs and displays; migrate only after replay tests |
| `/admin/food-orders` | Food Orders | staff | No | Map existing data and enforce server roles; review RLS and writes before enabling |
| `/admin/shop-orders` | Q Shop Admin | staff | No | Keep production order/payment/receipt contracts; audit donor checkout and server prices |
| `/admin/payments` | Payments | staff | No | Keep production order/payment/receipt contracts; audit donor checkout and server prices |
| `/admin/reports` | Reports | staff | No | Map existing data and enforce server roles; review RLS and writes before enabling |
| `/receipt` | Receipt | public | No | Keep production order/payment/receipt contracts; audit donor checkout and server prices |
| `/payment-status` | Payment Status | public | Yes | Keep production order/payment/receipt contracts; audit donor checkout and server prices |
| `/Craxam` | Craxam Auth Bridge | public | No | Verify auth callback/deep-link contract separately; preserve legal routes |
| `/craxam` | Craxam Auth Bridge | public | No | Verify auth callback/deep-link contract separately; preserve legal routes |
| `/craxam/privacy` | CraXam Privacy Policy | public | Yes | Verify auth callback/deep-link contract separately; preserve legal routes |
| `/terms` | Terms of Use | public | Yes | Port presentation; retain current data/actions until feature-specific regression passes |
| `/refund` | Refund Policy | public | Yes | Port presentation; retain current data/actions until feature-specific regression passes |
| `/privacy` | Privacy Policy | public | Yes | Port presentation; retain current data/actions until feature-specific regression passes |
| `/tournament-legal` | Tournament Rules & Terms | public | Yes | Port presentation; retain current data/actions until feature-specific regression passes |
| `/rules` | Club Rules | public | No | Reconciled as a V2 bridge to the authoritative Terms & Conditions rules section; no duplicate rules copy |
| `/bylaws` | Bylaws | public | No | Add after content/schema/access review; no placeholder feature counted as complete |
| `/refund-policy` | Refund Policy | public | No | Reconciled as an alias to the existing production Refund Policy content; no duplicate policy state |
| `/pricing` | Pricing | public | No | Reconciled as a read-only V2 page using existing membership tiers and booking table rates |
| `/legal` | Legal Notice | public | No | Reconciled as a policy hub linking existing Terms, Refund, Privacy and Tournament Legal pages; no new legal text invented |
| `/disclaimer` | Disclaimer | public | No | Add after content/schema/access review; no placeholder feature counted as complete |
| `/anti-gambling` | Anti-Gambling Notice | public | No | Reconciled by reusing the existing Tournament Legal Notice, which already contains the club's skill-based/no-wagering position |
| `/feedback` | Feedback | public | No | Add after content/schema/access review; no placeholder feature counted as complete |

## Production-only routes to preserve

- `/QclubLedger`
- `/QclubPay`
- `/QclubQr`
- `/craxam/delete-account`
- `/qclubledger`
- `/qclubpay`
- `/qclubqr`

No route should be removed solely because it is missing from the donor. Ledger, Pay and QR retain their current PIN/payment contracts. The CraXam account-deletion page remains available.
