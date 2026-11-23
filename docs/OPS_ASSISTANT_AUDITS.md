# Ops Assistant data audits

The Ops Assistant checks three kinds of data problems. The audit scripts need a
live MongoDB connection, which the routine's sandbox cannot open (it reaches the
internet over HTTPS only), so they used to fall back to local storage and
report "0 findings" without having checked anything (issue #1680).

The same audits now run inside the production server and are served over the
existing HMAC-protected `/internal/ops-bot/*` API. Signing is unchanged; see
[OPS_ASSISTANT_SIGNING.md](OPS_ASSISTANT_SIGNING.md). Remember that a query
string is part of the signed path.

| Endpoint                                                     | Replaces                                         |
| ------------------------------------------------------------ | ------------------------------------------------ |
| `GET /internal/ops-bot/audits/orphaned-supplier-data`        | `scripts/audit-orphaned-supplier-data.js`        |
| `GET /internal/ops-bot/audits/marketplace-listing-locations` | `scripts/audit-marketplace-listing-locations.js` |
| `GET /internal/ops-bot/audits/supplier-locations`            | `scripts/audit-supplier-locations.js`            |

The two location endpoints take an optional `?limit=N` (default 100, maximum
500). `truncated: true` means more records exist than were audited.

## Guarantees

- **Dry-run only.** The server code always passes `apply: false`, and there is no
  write route. The scripts' own `--apply` safeguards are untouched, and the
  scripts remain the way to apply a change, run by a person.
- **Trimmed output.** Counts, record ids, statuses and a short reason. No user,
  owner, contact or free-text location fields.
- **No false all-clear.** `inconclusive: true` means the report was not read from
  a connected MongoDB, or a read fell back to local storage part-way through.
  Treat "0 findings" with `inconclusive: true` as not checked.

## Reading a response

- `counts` for the orphan audit are the numbers the script prints. Any non-zero
  `orphanSuppliers`, `orphanPackages` or `publicOrphanPackages` is worth a look;
  `legacyUnownedSuppliers` is reported but is not a defect on its own.
- For the location audits, `needsReview` lists only records that are not already
  mapped: `high_confidence` ones a person can apply with the script, and
  `review_required` or `unmapped` ones that need a decision.
