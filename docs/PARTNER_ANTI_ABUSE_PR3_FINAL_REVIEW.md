# Partner Programme PR3 — Final Reliability Review

The final pre-merge review of PR3 identified and corrected the following additional reliability issues:

- idempotent cashout retries now reach the existing replay lookup before submission exposure limits or pause controls are reapplied;
- cashout-operation indexes are initialised only when the unified database backend has confirmed MongoDB, avoiding unwanted Mongo connection activity in supported local-storage development and test setups;
- expired distributed-lock cleanup now includes the observed lease expiry in its atomic delete condition, so a concurrently renewed lease cannot be deleted by a stale cleaner;
- non-blocking administrator notification failures are logged rather than silently swallowed;
- the PR3 runtime, operations service and strict authoritative store are locally scoped for the configured JavaScript static analyser;
- cashout ledger reconciliation is split into focused snapshot, hold, ledger-shape and lifecycle-state validators, retaining the existing financial checks while reducing critical control-flow complexity;
- promise-returning strict-store wrappers no longer use unnecessary `async` declarations.

Targeted regression coverage was added for idempotent replay, local index startup and same-owner lease renewal. The cashout operations and strict-store regression suites also cover the reconciliation refactor. The full hosted CI, changed-code coverage, E2E, CodeQL and DeepSource matrix must pass on the exact final head before PR3 is promoted from draft or merged.
