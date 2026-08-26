# Supplier Bot Phase 2 security invariants

The following must remain true after Phase 2:

1. Supplier Bot ingestion is disabled unless `SUPPLIER_BOT_INGESTION_ENABLED=true`.
2. Every Supplier Bot ingestion request is authenticated with the shared HMAC secret.
3. Bot-created suppliers are ownerless/unclaimed and cannot become public through the normal public eligibility policy while unclaimed.
4. Signup/claim collision signals are evidence for review, not proof of ownership.
5. No collision path overwrites an existing supplier owner.
6. Package grace is bounded and time-limited.
7. Suppressed `do_not_list` candidates are not sent to EventFlow.
8. Secrets remain deployment variables and are never committed.
