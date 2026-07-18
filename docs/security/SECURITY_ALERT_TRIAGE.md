# Security alert triage

This is the operational process for GitHub secret-scanning, code-scanning and Dependabot alerts.

## Source of truth

The GitHub **Security** tab is authoritative. Repository documentation must not copy an alert count because counts change continuously.

The scheduled `Security Alert Inventory` workflow produces a sanitised metadata report and maintains one issue named `[security] Active GitHub alert inventory`. It never records a secret value.

## Secret-scanning response

Treat a genuine credential committed to this public repository as compromised.

1. Revoke or rotate it at the issuing provider immediately.
2. Replace the credential in Railway or GitHub environment secrets.
3. Confirm the old credential no longer works.
4. Remove the credential from the current tree and, when necessary, repository history.
5. Review provider access logs for unexpected use.
6. Resolve the GitHub alert as revoked, false positive, test credential or other accurate resolution.
7. Record the provider, rotation date and alert number without recording the credential.

Do not close a real alert merely because the value was deleted from the latest commit.

## Code-scanning response

Triage in this order:

1. critical and high findings in application code;
2. authentication, authorisation, payment, upload and database paths;
3. GitHub Actions permissions and untrusted-input findings;
4. medium findings with a realistic external input path;
5. tests, generated files, vendored code and confirmed duplicates.

A dismissal must record why the data flow is unreachable, why the result is a duplicate, or why the finding is otherwise not exploitable. "Tests pass" is not sufficient evidence for dismissal.

## Dependabot response

- Merge safe patch/minor updates only after the full required test suite passes.
- Handle major framework and database upgrades in dedicated migration pull requests.
- Where no fixed version exists, record scope, reachability, compensating controls and a review date.
- Do not rely on `npm audit --omit=dev` alone; review development-tool vulnerabilities that execute in CI or consume untrusted repository content.

## Evidence register

For each genuine alert, record:

| Field              | Required value                                            |
| ------------------ | --------------------------------------------------------- |
| Alert number       | GitHub alert number                                       |
| Source             | Secret scanning, CodeQL/other scanner, or Dependabot      |
| Severity/validity  | GitHub-reported value                                     |
| Affected component | File, workflow or package                                 |
| Decision           | Fix, rotate, revoke, dismiss, accept temporarily          |
| Evidence           | PR, provider rotation confirmation or technical rationale |
| Owner              | Person responsible                                        |
| Review date        | Required for accepted risk                                |

The generated workflow artefact supplies metadata for this register. Provider-side rotation and access-log checks cannot be performed by a repository pull request and require an authorised account owner.
