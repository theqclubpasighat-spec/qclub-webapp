# Production Route Registry

Last reconciled: 2026-10-03  
Production branch: `main`  
Purpose: authoritative map of every named client-side Q Club route after the V2 consolidation.

## Rules

- **Canonical**: authoritative route; new links should prefer it.
- **Alias**: compatibility/legacy URL that redirects or intentionally mirrors a canonical route. Keep until device/bookmark/Android dependencies are retired.
- **Legacy**: old working UI retained temporarily because it still contains production functionality.
- **Bridge**: V2 concept reconciled into an existing authoritative production tool rather than a duplicate data store.
- **Handler**: route pattern used to serve a controlled group of subroutes.
- **Main / Footer / Ops / Hidden** describe navigation placement, not security.
- Access labels describe intended operational ownership. Actual authorization remains enforced by the page/API contracts; this document is not itself an access-control mechanism.

## Current totals

- Named/recognized routes: **109**
- Canonical: **89**
- Aliases: **14**
- Bridges: **4**
- Legacy: **1**
- Route handlers: **1**

## Master route map

| Route | Area | Access | Navigation | Status | Purpose / canonical target |
|---|---|---|---|---|---|
| `/` | Public | Public | Main | Canonical | Home |
| `/about` | Public | Public | Footer | Canonical | About |
| `/contact` | Public | Public | Footer | Canonical | Contact |
| `/jobs` | Public | Public | Hidden | Canonical | Careers/application |
| `/photos` | Public | Public | Main | Canonical | Photos |
| `/offer` | Public | Public | Hidden | Canonical | Offers |
| `/membership` | Membership | Public | Main | Canonical | Membership |
| `/members` | Membership | Public | Main | Canonical | Public members |
| `/member-registry` | Membership | Admin | Ops | Canonical | Current registry editor; donor staff alias points here |
| `/book` | Booking | Public | Main | Canonical | Book a table |
| `/tournaments` | Tournament | Public | Main | Canonical | Tournaments |
| `/tournament-register` | Tournament | Public | Hidden | Canonical | Tournament registration |
| `/fixtures` | Tournament | Public | Main | Canonical | Fixtures/results |
| `/leaderboard` | Tournament | Public | Main | Canonical | Leaderboard |
| `/players` | Tournament | Public | Main | Canonical | Players |
| `/handicap` | Tournament | Public | Main | Canonical | Handicap/classification |
| `/halloffame` | Tournament | Public | Main | Canonical | Hall of Fame |
| `/live` | Tournament | Public | Hidden | Canonical | Live matches |
| `/air-hockey` | Facilities | Public | Hidden | Canonical | Air Hockey |
| `/foosball` | Facilities | Public | Hidden | Canonical | Foosball |
| `/massage-chair` | Facilities | Public | Hidden | Canonical | Massage Chair |
| `/air-hockey-info` | Facilities | Public | Hidden | Canonical | Air Hockey info |
| `/foosball-info` | Facilities | Public | Hidden | Canonical | Foosball info |
| `/massage-chair-info` | Facilities | Public | Hidden | Canonical | Massage Chair info |
| `/shop` | Commerce | Public | Main | Canonical | QShop |
| `/food` | Commerce | Public | Main | Canonical | Q Lounge |
| `/shop/successful-order-receipts` | Commerce | Staff/Admin | Ops | Canonical | QShop receipt lookup/history |
| `/rummy-snooker` | Q Chase | Public | Main | Canonical | Q Chase public/main page |
| `/rummy-snooker-table-1` | Q Chase | Scorer | Hidden | Canonical | T1 scorer |
| `/rummy-snooker-table-2` | Q Chase | Scorer | Hidden | Canonical | T2 scorer |
| `/rummy-snooker-table-3` | Q Chase | Scorer | Hidden | Canonical | T3 scorer |
| `/rummy-snooker-table-1-display` | Q Chase | Display | Hidden | Canonical | T1 spectator display |
| `/rummy-snooker-table-2-display` | Q Chase | Display | Hidden | Canonical | T2 spectator display |
| `/rummy-snooker-table-3-display` | Q Chase | Display | Hidden | Canonical | T3 spectator display |
| `/qchase-records` | Q Chase | Public | Hidden | Canonical | Q Chase records |
| `/qchase-monthly` | Q Chase | Public | Hidden | Canonical | Q Chase monthly |
| `/kitty` | Kitty | Public | Main | Canonical | Kitty public/main page |
| `/kitty-table-1` | Kitty | Scorer | Hidden | Canonical | T1 scorer |
| `/kitty-table-2` | Kitty | Scorer | Hidden | Canonical | T2 scorer |
| `/kitty-table-3` | Kitty | Scorer | Hidden | Canonical | T3 scorer |
| `/kitty-table-4` | Kitty | Scorer | Hidden | Canonical | T4 Pool scorer |
| `/kitty-table-1-display` | Kitty | Display | Hidden | Canonical | T1 spectator display |
| `/kitty-table-2-display` | Kitty | Display | Hidden | Canonical | T2 spectator display |
| `/kitty-table-3-display` | Kitty | Display | Hidden | Canonical | T3 spectator display |
| `/kitty-table-4-display` | Kitty | Display | Hidden | Canonical | T4 Pool spectator display |
| `/kitty-records` | Kitty | Public | Hidden | Canonical | Kitty records |
| `/kitty-monthly` | Kitty | Public | Hidden | Canonical | Kitty monthly |
| `/staff-walkins` | Operations | Staff/Admin | Ops | Canonical | Walk-ins |
| `/inventory` | Operations | Staff/Admin | Ops | Canonical | Inventory |
| `/staff-shifts` | Operations | Staff/Admin | Ops | Canonical | Staff shifts |
| `/staff-attendance` | Operations | Staff | Ops | Canonical | Clock in/out and attendance |
| `/expense` | Operations | Staff/Admin | Ops | Canonical | Operational expenses |
| `/review-panel` | Operations | Committee/Admin | Ops | Canonical | Classification review |
| `/match-ledger` | Operations | Staff/Committee/Admin | Ops | Canonical | Match ledger |
| `/food-print-bridge` | Operations | Staff/Admin | Hidden | Canonical | Printer bridge |
| `/tv` | Operations | Staff/Admin | Ops | Canonical | Club TV control/display mode |
| `/admin/orders` | Operations | Staff/Admin | Ops | Canonical | Live Q Lounge orders |
| `/admin/orders-archive` | Operations | Staff/Admin | Ops | Canonical | Order archive |
| `/admin-panel` | Admin | Admin | Ops | Legacy | Old production admin retained for compatibility |
| `/admin` | CMS | Admin/Staff/Committee | Hidden | Canonical | Live Website Manager / role tools |
| `/admin/*` | CMS | Admin/Staff/Committee | Hidden | Handler | CMS sub-route fallback |
| `/admin/club-details` | CMS | Admin | Hidden | Canonical | CMS: club profile |
| `/admin/documents` | CMS | Admin | Hidden | Canonical | CMS: pages/policies |
| `/admin/membership-tiers` | CMS | Admin | Hidden | Canonical | CMS: membership tiers |
| `/admin/rates` | CMS | Admin | Hidden | Canonical | CMS: table rates |
| `/admin/notices` | CMS | Admin | Hidden | Canonical | CMS: notices |
| `/admin/food-menu` | CMS | Admin | Hidden | Bridge | CMS bridge to authoritative F&B operations |
| `/admin/shop` | CMS | Admin | Hidden | Canonical | CMS: QShop catalogue |
| `/admin/media` | CMS | Admin | Hidden | Canonical | CMS: hero/media |
| `/admin/theme` | CMS | Admin | Hidden | Canonical | CMS: V2 theme |
| `/admin/templates` | CMS | Admin | Hidden | Canonical | CMS: notification template names |
| `/admin/feature-flags` | CMS | Admin | Hidden | Canonical | CMS: feature settings |
| `/admin/settings` | CMS | Admin | Hidden | Canonical | CMS settings hub |
| `/admin/data-tools` | CMS | Admin | Hidden | Bridge | Bounded data/report tools; no raw state editor |
| `/admin/audit-log` | CMS | Admin | Hidden | Bridge | Reports/audit directory |
| `/admin/reports` | CMS | Admin | Hidden | Bridge | Reports/audit directory |
| `/admin/members` | Alias | Staff/Admin | Hidden | Alias | → /member-registry |
| `/admin/bookings` | Alias | Staff/Admin | Hidden | Alias | → /QclubLedger |
| `/admin/players` | Alias | Committee/Admin | Hidden | Alias | → /review-panel |
| `/admin/tournaments` | Alias | Committee/Admin | Hidden | Alias | → /tournaments |
| `/admin/standings` | Alias | Committee/Admin | Hidden | Alias | → /leaderboard |
| `/admin/hall-of-fame` | Alias | Committee/Admin | Hidden | Alias | → /halloffame |
| `/admin/live-games` | Alias | Committee/Admin | Hidden | Alias | → /live |
| `/admin/food-orders` | Alias | Staff/Admin | Hidden | Alias | → /admin/orders |
| `/admin/shop-orders` | Alias | Staff/Admin | Hidden | Alias | → /shop/successful-order-receipts |
| `/admin/payments` | Alias | Staff/Admin | Hidden | Alias | → /QclubLedger |
| `/terms` | Legal | Public | Footer | Canonical | Terms |
| `/refund` | Legal | Public | Footer | Canonical | Refund policy |
| `/refund-policy` | Alias | Public | Hidden | Alias | → /refund |
| `/privacy` | Legal | Public | Footer | Canonical | Privacy |
| `/legal` | Legal | Public | Hidden | Canonical | Legal hub |
| `/pricing` | Legal | Public | Hidden | Canonical | Read-only pricing |
| `/tournament-legal` | Legal | Public | Hidden | Canonical | Tournament legal notice |
| `/anti-gambling` | Legal | Public | Hidden | Canonical | Anti-gambling/tournament notice |
| `/rules` | Legal | Public | Hidden | Canonical | Rules hub |
| `/feedback` | Public | Public | Hidden | Canonical | Feedback/contact bridge |
| `/craxam/privacy` | CraXam | Public | Hidden | Canonical | CraXam privacy |
| `/craxam/delete-account` | CraXam | Public | Hidden | Canonical | CraXam deletion request |
| `/payment-status` | Payment | Public | Hidden | Canonical | Cashfree return/status |
| `/T1` | Table Display | Display | Hidden | Canonical | Table 1 display |
| `/T2` | Table Display | Display | Hidden | Canonical | Table 2 display |
| `/T3` | Table Display | Display | Hidden | Canonical | Table 3 display |
| `/T4` | Table Display | Display | Hidden | Canonical | Table 4 display |
| `/QclubLedger` | Ledger | Staff/Admin | Hidden | Canonical | Ledger |
| `/qclubledger` | Alias | Staff/Admin | Hidden | Alias | → /QclubLedger |
| `/QclubPay` | Payment | Public/Controlled | Hidden | Canonical | Payment page |
| `/qclubpay` | Alias | Public/Controlled | Hidden | Alias | → /QclubPay |
| `/QclubQr` | Payment | Public/Controlled | Hidden | Canonical | QR payment page |
| `/qclubqr` | Alias | Public/Controlled | Hidden | Alias | → /QclubQr |

## Intentionally retired donor routes

These are **not production pages** and should not be reintroduced merely because they existed in QclubV2:

| Retired route | Decision |
|---|---|
| `/receipt` | Retired duplicate generic resolver; use context-specific Q Lounge/QShop/payment receipt flows. |
| `/Craxam` | Retired web OAuth bridge; CraXam uses direct app callback. |
| `/craxam` | Retired web OAuth bridge; CraXam uses direct app callback. |
| `/admin/login` | Retired donor email/password login; production uses Q Club PIN/session authority. |
| `/reset-password` | Retired with donor email/password auth. |
| `/admin/storage-migrate` | One-time staging-era storage migration; staging project was deleted. |
| `/bylaws` | Not published because no formally approved bylaws copy has been supplied. |
| `/disclaimer` | Not published because donor text contained unverified claims; existing legal pages remain authoritative. |

## Navigation cleanup policy

1. Public main navigation should link only to routes marked **Main**.
2. Legal/about/contact material belongs in footer or direct contextual links.
3. Staff/committee/admin operational pages belong in authenticated operations menus, never the public menu.
4. Scorer and display URLs remain hidden/direct-access routes.
5. Aliases remain functional but should not be used for new links.
6. `/admin-panel` remains until every still-needed legacy control is proven present in `/admin`; do not delete it solely for visual cleanup.
7. Unknown `/admin/*` paths currently fall back to the Website Manager shell. New named CMS subpages must be added to this registry and the CMS path map.
