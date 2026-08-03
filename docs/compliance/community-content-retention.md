# Community content retention (draft)

**Date:** 3 August 2026 · **Owner:** to be assigned

> **Status: draft for operator and legal review. Not legal advice, and not
> approved.** EventFlow has not been reviewed or approved by any regulator.
> Primary regulatory sources (ofcom.org.uk, ico.org.uk) could not be reached
> from the environment in which this draft was written and must be checked
> before it is relied upon. Statements about what the software does are
> verifiable against this repository.

## 1. Proposed schedule

**Every period below is a proposal for the operator to confirm.** None has been
set in code as an automated deletion job; the community currently retains
records until a person or a future job removes them, with one exception (view
de-duplication, which expires automatically).

| Data                                       | Proposed retention                                     | Rationale                                                   |
| ------------------------------------------ | ------------------------------------------------------ | ----------------------------------------------------------- |
| Published discussions and replies          | Life of the account, or until withdrawn                | The content is the service                                  |
| Withdrawn or removed content               | 12 months from removal, then purge                     | Long enough to review a decision or respond to a complaint  |
| Content held for review and never approved | 90 days                                                | Anti-spam pattern analysis                                  |
| Reports and their snapshots                | 24 months from resolution                              | Repeat-offender detection and complaint handling            |
| Moderation actions (audit trail)           | 24 months                                              | Accountability and transparency reporting                   |
| Appeals                                    | 24 months                                              | Same                                                        |
| Restrictions and suspensions               | Life of the account, or 24 months after lifting        | Sanction history informs later decisions                    |
| Community statistics                       | Life of the account                                    | Reputation and trust tiering                                |
| Drafts                                     | 12 months since last edit                              | Convenience data only                                       |
| View de-duplication keys                   | **24 hours — automated**, enforced by a TTL index      | Already implemented; no long-lived viewer identifier exists |
| Notifications                              | Follows the platform's existing notification retention | Reuses the shared collection                                |

## 2. Deletion behaviour today

- A member withdrawing their own content performs a **soft delete**: the state
  becomes `removed`, the body is no longer served, and the thread shows
  "Withdrawn by the author" in its place so the conversation still reads.
- Account deletion is handled by the platform's existing deletion service. **The
  operator must decide whether community content is deleted, anonymised or
  retained on account deletion, and the deletion service must be extended
  accordingly.** This is an outstanding action, not a completed one.

## 3. Special categories

Content reported under child safety, terrorism or threats of violence must not
be routinely purged before the CSEA and law-enforcement escalation steps have
completed. Retention of such material is governed by
`community-csea-reporting-readiness.md` and the operator's legal advice, not by
the schedule above.

## 4. Operator actions required

1. Confirm every period above.
2. Extend the account-deletion service to cover community content.
3. Implement the scheduled purge jobs for the periods that require them.
4. Record the balancing test for retaining removed content for 12 months.
