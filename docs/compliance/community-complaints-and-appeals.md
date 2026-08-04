# Community complaints and appeals (draft)

**Date:** 3 August 2026 · **Owner:** to be assigned

> **Status: draft for operator and legal review. Not legal advice, and not
> approved.** EventFlow has not been reviewed or approved by any regulator.
> Primary regulatory sources (ofcom.org.uk, ico.org.uk) could not be reached
> from the environment in which this draft was written and must be checked
> before it is relied upon. Statements about what the software does are
> verifiable against this repository.

## 1. Routes in

| Situation                             | Route                                                               | Implementation                            |
| ------------------------------------- | ------------------------------------------------------------------- | ----------------------------------------- |
| Content breaks the guidelines         | Report button on every post                                         | `POST /api/v1/community/posts/:id/report` |
| An account is running a spam campaign | Bulk account report                                                 | `POST /api/v1/community/reports/bulk`     |
| Content may be illegal                | The report flow, plus the platform's existing illegal-content route | `/legal`                                  |
| A moderation decision seems wrong     | Appeal                                                              | `POST /api/v1/community/me/appeals`       |
| Something else                        | Existing support channels                                           | `/support`, `/contact`                    |

Reporting content does not require an account. Appealing does, because an appeal
concerns a decision about that account's own content.

## 2. Appeal handling

1. The member submits an appeal explaining why the decision was wrong (minimum
   20 characters, maximum 1,500).
2. The appeal enters the senior-moderator queue, oldest first.
3. A senior moderator **who was not involved in the original decision** reviews
   the content snapshot, the original decision and its reason.
4. The outcome is `upheld` (decision stands) or `overturned` (decision
   reversed), each with a written reason.
5. The member is notified of the outcome and the reason.
6. The resolution is written to the audit trail.

Operational rule: the same person must not decide their own appeal. This is a
staffing rule, not a software constraint — the system records who decided what,
which makes the rule auditable after the fact.

## 3. Reporter feedback

Reporters are told the outcome of their report: either that action was taken, or
that the content was reviewed and found not to break the guidelines. Reporters
are not told which specific sanction was applied to another member.

## 4. Operator actions required

1. Set and publish target response times for reports and appeals.
2. Decide the escalation route beyond senior moderator (a named individual).
3. Decide whether appeal outcomes are reportable in transparency records, and in
   what form.
4. Confirm the wording members see on `/community/help#appeals`.
