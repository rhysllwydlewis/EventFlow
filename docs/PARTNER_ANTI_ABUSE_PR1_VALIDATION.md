# Partner Anti-Abuse PR1 Validation

This implementation was synchronised with the current `main` branch before final validation.

Merge readiness requires the unchanged final head to pass the complete EventFlow pull-request workflow matrix. Infrastructure-only conclusions that terminate before checkout are not treated as evidence of test success or failure.

The first real smoke run identified and corrected Jest mock hoisting and legal-suffix company-name comparison defects. The two affected suites then passed together.

The subsequent full regression identified two stale supplier-registration test fixtures that did not provide the new fail-closed risk service with its required pseudonymous evidence collections and indexed query mock. Those fixtures were corrected without weakening production enforcement. The focused supplier-registration regression passed.

The mobile authentication regression was corrected by scoping the password-toggle assertion to its own input wrapper and anchoring the direct-child toggle to the actual input height. The focused mobile Playwright regression passed.

Changed-code coverage is 86.8%, above the required 80% threshold. Exact Prettier output was applied to every file reported by the formatting gate. The temporary diagnostic workflow removed itself before this final repository workflow matrix was requested.
