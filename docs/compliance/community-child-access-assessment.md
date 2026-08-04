# Community children's access assessment (draft)

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

## 1. Conclusion sought

EventFlow is an 18+ service. This assessment records the basis for concluding
that the community is not likely to be accessed by children, and — importantly —
the reasons that conclusion is **not yet safe to rely on**.

## 2. Measures currently in the product

| Measure                                          | Implementation                                                           |
| ------------------------------------------------ | ------------------------------------------------------------------------ |
| Account required to post                         | `authRequired` on every mutation                                         |
| Verified email required to post                  | `requireVerifiedUser`                                                    |
| Explicit 18+ self-declaration before first post  | `requireAdultDeclaration`; `POST /api/v1/community/me/adult-declaration` |
| 18+ stated in the community guidelines           | `/community/guidelines`                                                  |
| Underage concern report category, auto-escalated | `REPORT_REASONS` `underage`                                              |
| Content minimisation                             | No private messaging, no livestreaming, no ephemeral content             |

## 3. Honest limitations

- **Self-declaration is not age verification** and must not be described as
  such in any public wording.
- Reading the community requires no account at all. Published discussions are
  public and indexable. The gate is on _posting_, not on _reading_.
- EventFlow does not currently collect date of birth, and the assessment does
  not recommend collecting it: it would be additional personal data for little
  assurance. Any decision to introduce stronger age assurance is an operator and
  legal decision, not a product one.

## 4. Wording inconsistency to resolve

The repository's terms describe an 18+ service; other policy wording is less
explicit, and registration does not currently state the age requirement in the
same terms. **This session did not amend the approved legal documents.** The
operator must reconcile, in one change:

1. Terms
2. Privacy notice
3. Legal hub
4. Registration copy
5. Community guidelines (already states 18+)

Unless a superseding approved policy exists, the 18+ position should be
preserved and made consistent across all five.

## 5. Operator actions required

1. Reconcile the wording above.
2. Decide whether the _reading_ of community content requires any additional
   measure, and record the reasoning either way.
3. Confirm the conclusion of this assessment in writing, with a named owner and
   a review date.
