# Community transparency records (draft)

**Date:** 3 August 2026 · **Owner:** to be assigned

> **Status: draft for operator and legal review. Not legal advice, and not
> approved.** EventFlow has not been reviewed or approved by any regulator.
> Primary regulatory sources (ofcom.org.uk, ico.org.uk) could not be reached
> from the environment in which this draft was written and must be checked
> before it is relied upon. Statements about what the software does are
> verifiable against this repository.

## 1. What the product can already report

The admin dashboard (`GET /api/v1/admin/community/dashboard`) computes the
following from live data, with no manual collation:

**Content**

- Published discussions and replies
- Content currently quarantined
- Unanswered discussions and the percentage answered
- Helpful-answer rate
- Official answers
- Supplier contributions

**Responsiveness**

- Median hours to first reply
- Median hours to report resolution
- Active contributors in the last 30 days

**Safety**

- Open reports, and how many are urgent
- Escalated reports
- Spam prevented (automated quarantine decisions)
- Active moderator-applied restrictions
- Open appeals

The immutable audit trail (`GET /api/v1/admin/community/audit`) provides the
per-action detail behind these figures.

## 2. Metrics deliberately not collected

Member totals, users online, raw post volume and any engagement-maximising
metric. These are vanity numbers that do not describe whether the community is
useful or safe, and publishing them creates an incentive to inflate them.

## 3. What the operator must decide

1. Which of the above are published externally, at what cadence, and where.
2. Whether report counts are broken down by reason category in public.
3. Who signs off a transparency record before publication.
4. How long transparency records are retained.
5. Whether any regulatory transparency duty applies to EventFlow at its current
   size, based on current primary-source guidance and legal advice.

## 4. Suggested internal review cadence

| Cadence   | Review                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------- |
| Weekly    | Open reports, urgent queue age, unanswered questions                                              |
| Monthly   | Median time to first reply, helpful-answer rate, spam prevented, appeals upheld versus overturned |
| Quarterly | Risk assessment review; category coverage; moderator staffing against response targets            |
| Annually  | Full review of every document in this directory                                                   |
