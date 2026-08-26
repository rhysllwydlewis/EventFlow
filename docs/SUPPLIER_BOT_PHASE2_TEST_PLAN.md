# Phase 2 regression test plan

The Phase 2 completion PR is expected to pass the repository's full required CI. New regression coverage additionally verifies:

- exact email and website collision detection;
- only unclaimed Supplier Bot records participate in collision routing;
- claim requests are idempotent and do not transfer ownership;
- unclaimed bot records cannot become public/indexable through an accidental approval flip;
- imported package and advertised-price evidence is retained;
- package grace defaults to 30 days and clamps configuration to 1–90 days;
- normal supplier signup records a pending claim reference while preserving the ownerless bot record.
