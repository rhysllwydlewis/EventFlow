# Community data protection impact assessment (draft)

**Date:** 3 August 2026 · **Owner:** to be assigned

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

## 1. Processing described

| Data                                                          | Source                                   | Purpose                                      | Lawful basis (proposed)                             | Retention (proposed) |
| ------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------- | --------------------------------------------------- | -------------------- |
| Public handle, display name, avatar                           | Existing account                         | Attribution                                  | Contract                                            | Life of account      |
| Discussion and reply content                                  | Member                                   | The service itself                           | Contract                                            | See retention policy |
| Optional broad UK region                                      | Member                                   | Local relevance in filters                   | Consent (optional field, off by default)            | Until changed        |
| Optional event type and event month (YYYY-MM)                 | Member                                   | Contextual relevance                         | Consent (optional, off by default)                  | Until changed        |
| Optional biography                                            | Member                                   | Public profile                               | Consent                                             | Until changed        |
| Community statistics (posts, helpful answers, upheld reports) | Derived                                  | Reputation and trust tiering                 | Legitimate interests (community safety and quality) | Life of account      |
| View de-duplication key                                       | Derived from IP + user agent, or user id | Privacy-conscious unique view counts         | Legitimate interests                                | 24 hours (TTL index) |
| Reports and moderation actions                                | Member and staff                         | Safety, and the ability to review a decision | Legal obligation / legitimate interests             | See retention policy |
| Risk signals on content                                       | Derived                                  | Anti-spam                                    | Legitimate interests                                | With the content     |

## 2. Data minimisation decisions

These are design decisions in the code, not aspirations:

- **No raw IP addresses are stored for view counting.** An anonymous viewer is
  a salted HMAC-SHA256 of IP + user agent, truncated to 24 hex characters, and
  the record expires after 24 hours via a TTL index (`viewerKey`, `recordView`,
  `community_view_ttl`). It cannot be used to re-identify anyone later.
- **Region is one of fourteen broad UK regions.** No town, address or postcode
  is stored on a community post.
- **Event date is month precision only** (`YYYY-MM`), validated server-side.
- **No date of birth is collected** for the community.
- Region, event type, event month and biography are all optional and empty by
  default.

## 3. What is never exposed publicly

Enforced by `stripInternalFields` and `publicAuthor`, and asserted by tests:
email address, phone number, exact address, postcode, date of birth, private
plans, private calendar, private messages, moderation risk scores, risk signals,
content fingerprints, trust tier of other members, IP or device data.

## 4. Data subject rights

| Right                   | How it is served                                                                                                                                                                                                                                                                                                                                   |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Access / portability    | `GET /api/v1/community/me/export` returns every discussion, reply, bookmark, follow and draft as JSON                                                                                                                                                                                                                                              |
| Rectification           | Members can edit their own content; edits are visibly marked                                                                                                                                                                                                                                                                                       |
| Erasure                 | Members can withdraw their own content. Withdrawal is a soft delete: the body is no longer served, the post's place in the conversation remains, and the record is retained for the periods in the retention policy so moderation decisions remain reviewable. **The operator must confirm this balance is acceptable** and document the reasoning |
| Objection / restriction | Mute member, category or discussion; notification preferences; withdraw optional profile fields                                                                                                                                                                                                                                                    |

## 5. Risks and mitigations

| Risk                                                         | Mitigation                                                                                       | Residual   |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ---------- |
| A member publishes their own or someone else's personal data | Pre-post detection and warning; report reason; moderator redaction that rewrites the stored body | Low–Medium |
| Region + event month + public handle allows identification   | Region is broad and date is month-precision; both optional and off by default                    | Low        |
| Moderators see more than they need                           | Risk signals and reported material are restricted to moderator endpoints; access is audited      | Low–Medium |
| Search engines index withdrawn content                       | `noindex` on all non-public states; sitemap only lists published and archived discussions        | Low        |

## 6. Operator actions required

1. Confirm the lawful bases above with the data protection lead.
2. Set the retention periods and record the balancing test for soft deletion.
3. Add the community to the record of processing activities.
4. Confirm whether `COMMUNITY_VIEW_SALT` should be a distinct secret from
   `JWT_SECRET` in production (the code supports both; a distinct salt is
   recommended).
