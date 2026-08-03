# Community moderation policy (draft)

**Date:** 3 August 2026 · **Owner:** to be assigned

> **Status: draft for operator and legal review. Not legal advice, and not
> approved.** EventFlow has not been reviewed or approved by any regulator.
> Primary regulatory sources (ofcom.org.uk, ico.org.uk) could not be reached
> from the environment in which this draft was written and must be checked
> before it is relied upon. Statements about what the software does are
> verifiable against this repository.

## 1. Roles

| Role             | Granted by                                                     | May                                                                                                                                                                                |
| ---------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Member           | Any verified account                                           | Report content, mute, withdraw own content, appeal                                                                                                                                 |
| Moderator        | `user.communityRole = 'moderator'`                             | Review reports, hide, restore, remove, quarantine, approve, lock, unlock, move, redact, warn, restrict, pin, feature, mark official answers, view risk signals and account history |
| Senior moderator | `user.communityRole = 'senior_moderator'`, or any global admin | All moderator powers plus suspend, resolve appeals, manage settings, categories and domain lists, and read the full audit trail                                                    |

## 2. Automated decisions before publication

`assessContent` scores every submission. A blocked domain rejects outright; a
score of 45 or above, or any post from a restricted account, is quarantined for
human review. Signals include blocked domains, link count against the author's
tier, promotional language, excessive mentions, near-duplicate text, posting
velocity and — the key rule — an external link from a low-trust account on a
thread dormant for 180 days or more.

Automated quarantine is **not** a decision. It holds content for a human and
tells the author what has happened.

## 3. Report handling

| Priority | Reasons                                                                                                      | Target first response                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| Urgent   | Child safety, terrorism, threats of violence, encouraging serious self-harm, illegal goods, underage concern | To be set by the operator. These auto-escalate and the content is quarantined on report |
| High     | Scam or fraud, harassment, hate, sexual content, personal information                                        | To be set by the operator                                                               |
| Normal   | Spam, impersonation, copyright, other                                                                        | To be set by the operator                                                               |

**Response-time targets are deliberately blank.** They must reflect actual
staffing; publishing a target the team cannot meet is worse than publishing
none.

## 4. Sanctions ladder

1. **Warning** — recorded, member notified, no loss of access.
2. **Content action** — hide, remove or lock, with a member-facing reason.
3. **Link restriction** — external links held or disabled.
4. **Read-only** — may read and report, may not post.
5. **Suspension** — senior moderator only, time-limited or indefinite.

Every step notifies the member with a reason and an appeal link.

## 5. Principles

- **No shadow bans.** Held content is visible to its author, marked "awaiting
  review". Visibility is never silently reduced.
- **Every action is attributable.** The audit trail records the action, target,
  moderator, reason, note and timestamp, and cannot be edited through the API.
- **Reasons are in plain English**, written for the member, not for the file.
- **Risk signals stay internal.** They are never shown to the public, and never
  used to explain a decision to a member in raw form.
- **Moderators do not moderate content they are party to.** Operational rule to
  be enforced by the team; not enforced in software.

## 6. Supplier conduct

Suppliers are welcome and are held to the published code of conduct. Disguised
promotion, posting in unrelated threads to advertise, and harvesting leads
privately from public participants are sanctionable under the ladder above.
Community standing has no effect on marketplace supplier ranking.
