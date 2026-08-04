# Community incident runbook (draft)

**Date:** 3 August 2026 · **Owner:** to be assigned

> **Status: draft for operator and legal review. Not legal advice, and not
> approved.** EventFlow has not been reviewed or approved by any regulator.
> Primary regulatory sources (ofcom.org.uk, ico.org.uk) could not be reached
> from the environment in which this draft was written and must be checked
> before it is relied upon. Statements about what the software does are
> verifiable against this repository.

## 1. Severity

| Severity | Examples                                                                                                   | First response                                       |
| -------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **S1**   | Suspected CSEA material; credible threat to life; coordinated attack publishing personal data              | Immediate. Follow §3 and the CSEA readiness document |
| **S2**   | Sustained spam campaign; a moderation or permission defect exposing non-public content; mass account abuse | Same working day                                     |
| **S3**   | Individual abusive account; a single incorrect moderation decision                                         | Next working day                                     |

## 2. Immediate containment levers

These exist in the product today:

| Lever                            | How                                                                                                                     |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Take the whole community offline | Set `COMMUNITY_ENABLED=false` and redeploy. Every community API returns 404 and the pages fall through. No data is lost |
| Quarantine specific content      | Admin centre → Content → Quarantine, or a report under an escalating reason                                             |
| Stop an account posting          | Admin centre → restriction `read_only` or `suspended` (senior moderator)                                                |
| Block a domain platform-wide     | Admin centre → Settings → Blocked domains. Takes effect within 30 seconds (settings cache TTL)                          |
| Tighten dormant-thread handling  | Settings → "Hold links from low-trust accounts on dormant threads"                                                      |
| Reduce posting rate              | Settings → `maxDiscussionsPerDay`, `maxRepliesPerHour`                                                                  |

## 3. S1 procedure

1. Quarantine the content. Do not delete it — deletion may destroy evidence.
2. Restrict or suspend the account.
3. Notify the named accountable owner immediately.
4. Preserve: the content snapshot already captured on the report, the audit
   trail entries, and the account's post history.
5. Follow `community-csea-reporting-readiness.md` for CSEA, or the operator's
   law-enforcement escalation route for threats to life.
6. Limit access to the material to the minimum number of named people.
7. Record every step with timestamps.

**EventFlow does not have, and must not claim to have, any automated reporting
integration with the police, the NCA, the IWF or any regulator.** Escalation is
a documented human process the operator must define and staff.

## 4. Data-breach path

If an incident involves personal data, it is a data-breach incident as well as a
safety incident: follow the platform's existing breach procedure and the 72-hour
assessment clock alongside this runbook.

## 5. Post-incident

1. Written timeline within five working days.
2. Root cause, including whether an automated control should have caught it.
3. Product changes raised as issues, with owners.
4. Update the illegal-content risk assessment if the risk register changed.

## 6. Operator actions required

1. Name the accountable owner and a deputy.
2. Define the law-enforcement escalation route and contacts.
3. Agree S1/S2/S3 response times and put them on call.
4. Rehearse an S1 once before launch.
