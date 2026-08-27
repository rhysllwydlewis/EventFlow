# Supplier Bot Phase 2 completion

Phase 2 closes the EventFlow integration boundary around ownerless Supplier Bot records.

Implemented safeguards:

- HMAC-authenticated, idempotent bot ingestion remains the only Supplier Bot write path.
- Imported suppliers remain `draft`, unclaimed, unapproved and unverified.
- Unclaimed Supplier Bot records are hard-blocked from public view, directory discovery and indexing even if an approval flag is accidentally changed.
- Normal supplier signup checks for exact public-email and website collisions with unclaimed Supplier Bot records.
- Collisions create durable, idempotent claim requests instead of silently creating an unsafe ownership transfer.
- Manual claim requests require an authenticated supplier account and do not auto-transfer ownership.
- Imported package and advertised-price evidence is retained on acquisition provenance for later handover.
- Package grace is defined as a bounded, time-limited post-claim allowance (default 30 days, configurable 1–90 days), never a permanent package-limit bypass.
- Supplier Bot `do_not_list` suppression is enforced on the sender immediately before EventFlow publication.

Actual identity-proof verification and disputed-claim resolution remain Phase 5 by design. Phase 2 provides the safe claim/collision plumbing without pretending a weak signal proves ownership.
