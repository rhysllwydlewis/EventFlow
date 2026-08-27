# Supplier Bot Phase 2 runtime configuration

EventFlow production requires:

- `SUPPLIER_BOT_INGESTION_ENABLED=true`
- `EVENTFLOW_BOT_HMAC_SECRET=<shared secret, at least 32 characters>`

Supplier Bot production requires:

- `EVENTFLOW_INTERNAL_BASE_URL=https://event-flow.co.uk`
- `EVENTFLOW_BOT_HMAC_SECRET=<the same shared secret>`

The HMAC secret is operational configuration only. It must not be committed to source control.

During Phase 3 validation the Supplier Bot Control Centre must remain in Shadow mode with Publishing, Claim notices, Marketing and SEO indexing all disabled.
