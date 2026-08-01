# Partner Programme PR3 — Final Reliability Review

The final pre-merge review of PR3 identified and corrected the following additional reliability issues:

- idempotent cashout retries now reach the existing replay lookup before submission exposure limits or pause controls are reapplied;
- cashout-operation indexes are initialised only when the unified database backend has confirmed MongoDB, avoiding unwanted Mongo connection activity in supported local-storage development and test setups;
- expired distributed-lock cleanup now includes the observed lease expiry in its atomic delete condition, so a concurrently renewed lease cannot be deleted by a stale cleaner;
- non-blocking administrator notification failures are logged rather than silently swallowed;
- the PR3 runtime and operations service are scoped consistently for the configured JavaScript static analyser.

Targeted regression coverage was added for idempotent replay, local index startup and same-owner lease renewal. The full hosted CI, changed-code coverage, E2E, CodeQL and DeepSource matrix must pass on the exact final head before PR3 is promoted from draft or merged.
