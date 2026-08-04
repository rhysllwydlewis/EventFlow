# Community illegal content risk assessment (draft)

**Date:** 3 August 2026 · **Owner:** to be assigned · **Review:** before launch, then at least annually and on material change

> **Status: draft for operator and legal review. Not legal advice, and not
> approved.** EventFlow has not been reviewed or approved by any regulator, and
> nothing here should be read as claiming otherwise.
>
> **Primary sources could not be consulted.** The environment in which this
> draft was written could not reach `ofcom.org.uk` or `ico.org.uk` (egress
> blocked at the proxy). Every regulatory reference below must be checked
> against the current primary source before this document is relied upon:
>
> - https://www.ofcom.org.uk/online-safety/
> - https://www.ofcom.org.uk/online-safety/illegal-and-harmful-content/illegal-content-duties-under-the-online-safety-act
> - https://www.ofcom.org.uk/online-safety/illegal-and-harmful-content/duty-to-report-child-sexual-exploitation-and-abuse-csea-content-know-the-rules-and-how-to-comply
> - https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/
>
> What _is_ verifiable here is the description of what the EventFlow Community
> software actually does; each such statement points at code in this repository.

## 1. Service description

EventFlow Community is a UK-facing, 18+, public user-to-user discussion area
within the EventFlow event-planning platform. Members post discussions and
replies; approved suppliers may participate with a disclosed badge. All content
is public to read. There is no private messaging within the community, no
livestreaming, no ephemeral content and no user-to-user file sharing beyond
image attachments to a public post.

## 2. User base

Adults planning weddings, parties, corporate events, conferences, festivals,
charity events and similar, plus approved EventFlow suppliers. Registration
requires a verified email address; posting additionally requires an explicit
18+ self-declaration.

## 3. Risk register

| #   | Harm                                                             | Likelihood | Impact    | Controls in the product                                                                                                                                                                                        | Residual                                      |
| --- | ---------------------------------------------------------------- | ---------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 1   | Fraud and financial scams (fake suppliers, advance-fee deposits) | Medium     | High      | Blocked-domain list; progressive link privileges; supplier badges limited to provable facts; marketplace safety notice; `scam` report reason at high priority                                                  | Medium                                        |
| 2   | Promotional spam and link farms                                  | High       | Medium    | Trust tiers; link ceilings; dormant-thread rule; duplicate detection; velocity limits; bulk account reporting; `rel="ugc nofollow"` on all external links                                                      | Low                                           |
| 3   | Harassment and abuse between members                             | Medium     | High      | Report categories at high priority; mute and block; moderator hide/remove/restrict/suspend; audit trail                                                                                                        | Medium                                        |
| 4   | Hate speech                                                      | Low–Medium | High      | Same as 3, plus a dedicated `hate` reason at high priority                                                                                                                                                     | Medium                                        |
| 5   | Threats of violence                                              | Low        | Very high | `violence` reason escalates automatically and quarantines the content pending senior review                                                                                                                    | Low–Medium                                    |
| 6   | Child sexual exploitation and abuse material                     | Very low   | Very high | `child_safety` escalates and quarantines immediately; restricted moderator access to reported material; escalation runbook                                                                                     | Low, but requires the operator actions in §5  |
| 7   | Terrorism and extremism                                          | Very low   | Very high | `terrorism` escalates and quarantines                                                                                                                                                                          | Low–Medium                                    |
| 8   | Encouraging serious self-harm                                    | Low        | Very high | `self_harm` escalates and quarantines                                                                                                                                                                          | Low–Medium                                    |
| 9   | Illegal goods and services                                       | Low        | High      | `illegal_goods` escalates; blocked-domain tokens cover common categories                                                                                                                                       | Low–Medium                                    |
| 10  | Unlawful sharing of personal information                         | Medium     | High      | Automated detection of postcodes, phone numbers, emails and bank details, warning the member before posting; `personal_information` reason at high priority; moderator redaction that rewrites the stored body | Low–Medium                                    |
| 11  | Impersonation                                                    | Low        | Medium    | Handles are unique; official and moderator badges are server-derived and cannot be set by a member; `impersonation` reason                                                                                     | Low                                           |
| 12  | Underage access                                                  | Low–Medium | High      | 18+ self-declaration gate before posting; `underage` reason escalates                                                                                                                                          | Medium — self-declaration is not verification |

## 4. Design features that reduce risk

- Content from restricted accounts, and any high-scoring content, is held before
  public display rather than removed after the fact.
- Six report categories quarantine content automatically on report.
- No shadow bans: authors always know the state of their own content, which
  reduces repeat offending through misunderstanding.
- Every moderation decision is written to an immutable audit trail with the
  acting moderator's identity.
- External links can never pass ranking signal, open a tab with window access,
  or leak a referrer.

## 5. Operator actions required before launch

1. Name an accountable owner for community safety.
2. Agree and document moderator response-time targets per priority band, and
   staff to meet them.
3. Complete the CSEA reporting readiness steps in
   `community-csea-reporting-readiness.md`, including the named reporting route.
4. Legal review of the guidelines, terms and privacy wording.
5. Decide the retention periods in `community-content-retention.md`.
6. Record-keeping: decide where this assessment and its reviews are stored and
   who signs them off.
