# Partner Anti-Abuse PR1 Validation

This implementation was synchronised with the current `main` branch before final validation.

Merge readiness requires the unchanged final head to pass the complete EventFlow pull-request workflow matrix. Infrastructure-only conclusions that terminate before checkout are not treated as evidence of test success or failure.

The first real smoke run identified and corrected Jest mock hoisting and legal-suffix company-name comparison defects. The two affected suites passed together before this final matrix was requested.
