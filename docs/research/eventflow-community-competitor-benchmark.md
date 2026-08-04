# EventFlow Community — competitor and best-practice benchmark

**Date:** 3 August 2026

## Methodology and its limits

The brief asked for inspection of a range of current public communities (Reddit
wedding and event-planning subreddits, The Knot / WeddingWire community areas,
Bridebook, Mumsnet Talk, Discourse-based communities, Stack Exchange, and other
UK event-planning groups).

**None of these were reachable from this execution environment.** The container's
egress policy denies all outbound hosts other than a package-registry allow list;
every attempt was rejected with `403 request rejected: host not permitted` at
the proxy, and the managed fetch and search tools returned nothing substantive.
See the methodology section of `eventflow-community-hitched-audit.md` for the
transcript.

This document therefore records **[PATTERN]** — durable, well-established design
patterns from those product categories — and the **[DECISION]** EventFlow took
in response. It is a design rationale, not a competitive audit, and every
pattern below should be re-verified by an operator with ordinary network access
before it is quoted as current fact.

---

## 1. Onboarding

**[PATTERN]** Discourse-style communities gate posting behind a short trust
progression rather than an approval queue: new accounts can post immediately but
with reduced privileges (no links, no images, no mentions), which lift
automatically with genuine participation.

**[DECISION]** EventFlow uses five trust tiers — restricted, new, established,
trusted, staff — derived server-side from verification, account age, activity
and standing. A new verified member can post immediately; their links appear as
plain text until they have taken part for a fortnight. There is no approval
queue for ordinary members, so the community never feels closed.

## 2. Search and duplicate prevention

**[PATTERN]** Stack Exchange's most valuable interaction is the one that happens
_before_ posting: as a title is typed, existing questions are surfaced. Combined
with canonical-question merging, this keeps the answer corpus small and good
rather than large and repetitive.

**[DECISION]** `GET /api/v1/community/similar` runs on title input and shows
existing discussions with their reply count, solved state and age. Moderators can
supersede an old discussion with a canonical one, which locks the old thread and
links forward. Search covers replies as well as original posts, because the
answer is usually not in the title.

## 3. Accepted answers versus authoritative answers

**[PATTERN]** Stack Exchange has one accepted answer, chosen by the asker.
Product forums often blur "the community thinks this is right" with "the company
says this is right", which is how confidently wrong advice acquires authority.

**[DECISION]** EventFlow keeps them apart. A **Helpful answer** is chosen by the
asker or a moderator. An **Official EventFlow answer** can only be set by staff,
carries a _last verified_ date, and is styled distinctly. A thread can have both,
one, or neither.

## 4. Moderation and transparency

**[PATTERN]** The healthiest communities publish their rules, tell people when
content is actioned, and offer an appeal. The least healthy use silent
visibility reduction, which destroys trust when discovered.

**[DECISION]** No shadow bans anywhere. A held post is visible to its own author
with an "awaiting review" marker. Every moderation action notifies the author
with a plain-English reason and an appeal link, and is written to an immutable
audit trail. Appeals are resolved by a senior moderator who was not involved in
the original decision.

## 5. Reputation

**[PATTERN]** Reputation systems that count posts reward volume; systems that
count upvotes reward popularity; systems that count accepted answers reward
usefulness. Only the last correlates with the thing a planning community exists
to produce.

**[DECISION]** Levels require posts **and** helpful answers **and** account age
simultaneously. Any two upheld reports hold a member at New member. Four
reactions exist but only "Helpful" feeds reputation. Community reputation has no
effect on marketplace supplier ranking — the two systems are entirely separate.

## 6. Supplier and expert disclosure

**[PATTERN]** Marketplaces that let businesses answer questions either label
them clearly or lose the trust of the people asking. The failure mode is a
badge that implies more verification than the platform actually performs.

**[DECISION]** EventFlow shows only what it can prove: approved-supplier status,
supplier category, and email/phone verification. The guidelines say explicitly
that a supplier badge is _not_ a statement about insurance, qualifications,
vetting or identity. Self-recommendation is labelled automatically.

## 7. Local relevance

**[PATTERN]** Local relevance is the strongest differentiator for an
event-planning community, and the strongest privacy risk. Communities that ask
for a town plus a date have effectively published a home address for anyone
willing to correlate.

**[DECISION]** Region is one of fourteen broad UK regions, never a town, address
or postcode. Event date is month precision only. Both are optional and off by
default. Filters combine topic, event type and region so the relevance is
available without the exposure.

## 8. Old-thread handling

**[PATTERN]** Discourse warns before replying to a thread that has been quiet
for months, and can auto-close old topics. Reddit locks posts after six months.
Legacy forums do neither, which is why they accumulate necro-spam.

**[DECISION]** EventFlow warns at 365 days, applies stricter moderation from 180
days of dormancy, supports configurable auto-archiving, and lets moderators
supersede. Search de-weights archived-freshness content.

## 9. Notifications

**[PATTERN]** The reliable failure is over-notification followed by a global
mute, after which the member never returns.

**[DECISION]** Deterministic notification ids prevent duplicates, mutes are
respected, and preferences offer in-app, immediate email, daily digest, weekly
digest or none.

## 10. Mobile and accessibility

**[PATTERN]** Forum software is overwhelmingly desktop-first, with filter
controls that are unusable on a phone.

**[DECISION]** Mobile-first layouts, 44 px touch targets, filters behind an
accessible disclosure below 768 px, a skip link on every page, reduced-motion
support, and readable 13 px metadata. Verified: zero axe-core WCAG 2.1 AA
violations across eleven pages at two viewports.

## 11. Community health metrics

**[PATTERN]** Communities that optimise for engagement produce arguments;
communities that optimise for answered questions produce answers.

**[DECISION]** The admin dashboard reports median time to first reply, percentage
answered, helpful-answer rate, unanswered queue, active contributors over 30
days, open and urgent reports, median report-resolution time, spam prevented and
open appeals. It reports no member total and no online counter.

## 12. Converting discussion into action

**[PATTERN]** Most forums are disconnected from the product they sit next to, so
a good answer ends with the reader copying a supplier name into a search box.

**[DECISION]** Threads carry a "Take it further" panel linking to suppliers, the
public calendar, the marketplace and guides. Recommendation threads offer a
matching-suppliers action scoped to the stated region. Quote requests are never
auto-submitted — the member always confirms.

---

## Ideas adopted, and where they live

| Idea                                    | Source pattern         | Implementation                                  |
| --------------------------------------- | ---------------------- | ----------------------------------------------- |
| Trust-tiered posting privileges         | Discourse              | `TRUST_POLICY`, `computeTrustTier`              |
| Duplicate suggestions while typing      | Stack Exchange         | `GET /similar`                                  |
| Accepted answer, separate from official | Stack Exchange         | `solve` and `official-answer`                   |
| Canonical thread merging                | Stack Exchange         | `supersede` action, `community_canonical_links` |
| Old-thread warnings and auto-close      | Discourse, Reddit      | `assessFreshness`, `autoArchiveDays`            |
| Transparent moderation with appeals     | Discourse              | audit trail, notifications, `/me/appeals`       |
| Explainable personalised feed           | Modern feeds done well | `buildFollowingFeed.explanation`                |
| Facet-based search                      | Marketplace search     | `/search` `facets`                              |

## Ideas deliberately not adopted

- Infinite scroll — breaks pagination metadata, back-button behaviour and
  keyboard users.
- Karma visible as a single number — invites gaming and status anxiety.
- Nested reply trees — the brief excludes them and they harm mobile readability.
- Engagement notifications ("someone you follow posted!") — noise, not value.
- Any paid ranking of community answers, labelled or otherwise, in ranking code.
