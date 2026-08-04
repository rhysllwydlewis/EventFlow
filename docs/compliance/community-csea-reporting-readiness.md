# Community CSEA reporting readiness (draft)

**Date:** 3 August 2026 · **Owner:** to be assigned

> **Status: draft for operator and legal review. Not legal advice, and not
> approved.** EventFlow has not been reviewed or approved by any regulator.
> Primary regulatory sources (ofcom.org.uk, ico.org.uk) could not be reached
> from the environment in which this draft was written and must be checked
> before it is relied upon. Statements about what the software does are
> verifiable against this repository.

## 1. Purpose and an important limitation

This document records what the EventFlow Community software does when child
sexual exploitation and abuse content is reported, and what the operator must
put in place around it.

**EventFlow has no automated reporting integration with the NCA, the IWF, the
police or any regulator, and none is claimed, implied or simulated anywhere in
the product or its tests.** Reporting is a human process the operator must
define, staff and rehearse.

## 2. What the software does today

| Step                                                                                     | Implementation                              |
| ---------------------------------------------------------------------------------------- | ------------------------------------------- |
| A `child_safety` report can be made from any post, by anyone, with or without an account | `POST /api/v1/community/posts/:id/report`   |
| The report is created at `urgent` priority with status `escalated`                       | `REPORT_REASONS`, `ESCALATION_REASONS`      |
| The content is quarantined immediately, before any human sees the report                 | Same request, before the response is sent   |
| A content snapshot is captured at report time                                            | `report.snapshot`                           |
| A moderation action is written to the audit trail                                        | `community_moderation_actions`              |
| Only a senior moderator can resolve an escalated report                                  | `PATCH /api/v1/admin/community/reports/:id` |
| The queue sorts urgent first, then oldest first                                          | `community_report_queue` index              |

## 3. What the operator must put in place

1. **Named responsible person** for CSEA reports, plus a deputy.
2. **The reporting route** — how a confirmed report reaches the appropriate
   authority, in what form, within what time.
3. **Preservation** — what is preserved, where, for how long, and who may access
   it. Note that the content snapshot on the report is a text excerpt; image
   attachments live in the existing upload store and their preservation must be
   specified.
4. **Access control** — the minimum number of named individuals who may view
   reported material, and how that access is logged.
5. **Staff welfare** — support for anyone who has to review this material.
6. **Training** — before any moderator is given access.
7. **Record-keeping** — what is recorded about each report and for how long,
   consistent with the retention policy and legal advice.
8. **Rehearsal** — walk the process end to end before launch.

## 4. Explicitly out of scope for this implementation

- No hash-matching, classifier or scanning service is integrated. Adding one is
  a privacy-reviewed operator decision, not a product default.
- No illegal imagery is used anywhere in the test suite or fixtures, and none
  ever should be.
- No regulator relationship, approval or registration is claimed.

## 5. Status

**Not ready.** The software controls in §2 are implemented and tested. Every
item in §3 is outstanding and must be completed before the community accepts
public content.
