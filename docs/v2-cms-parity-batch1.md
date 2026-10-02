# V2 CMS parity — Batch 1

This branch is stacked on PR #25 and extends its secure rehearsal CMS with two real V2 administration capabilities backed by the current live state contract:

- Membership tier editing for existing tiers.
- Public table-rate editing for existing booking tables.

Safety constraints:
- Existing tier and table identities cannot be added, deleted or replaced in this batch.
- Membership price must be a non-negative integer.
- Table member rate cannot exceed the standard rate.
- Unknown nested fields are preserved rather than overwritten.
- Booking requests and blocked slots are never projected to the browser and are preserved during rate edits.
- Private operational fields remain absent from the CMS response.
- Saves still use the same optimistic revision compare-and-swap as the existing secure content editor.
- Staff accounts remain read-only for website CMS.
- Production remains disabled by the rehearsal deployment gate.

This is a feature-parity step from the retired V2 CMS, not a production activation. A disposable rehearsal database and final cutover review remain required.
