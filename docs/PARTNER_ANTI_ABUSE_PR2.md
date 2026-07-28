# Partner Programme Anti-Abuse — PR2 Reward Integrity

PR2 protects the point-earning side of EventFlow's Partner Programme. It is intentionally stacked on PR1 so registration/device/network controls remain a separate reviewable layer.

## Principles

- Rewards are earned from durable marketplace evidence, not merely from calling a milestone endpoint.
- Time-based qualification can be deferred and reconciled later rather than permanently lost.
- Strong duplicate-business evidence can withhold rewards from multiple accounts representing the same underlying business.
- Ambiguous network/device signals remain review evidence from PR1 and do not become standalone reward bans here.
- First referral attribution is immutable. A later attempt to move the same supplier to another partner is recorded but does not reassign the supplier.
- Rolling caps limit financial exposure from sudden reward bursts without changing the underlying referral record.

## Signup reward

The supplier must already satisfy the PR1/partner anti-abuse requirements, including verified email, an active verified partner and an approved supplier profile.

PR2 additionally requires the supplier account to be at least `PARTNER_REWARD_SIGNUP_MIN_AGE_HOURS` old before the signup reward can be issued. Default: 24 hours.

A reward withheld only because the account is too new can be awarded later by deferred reconciliation.

## Package reward

A package qualifies only when it:

- belongs to an approved supplier profile;
- is approved and not paused;
- has a meaningful title rather than placeholder/test content;
- has a meaningful description of at least the configured minimum length;
- has a primary category;
- has at least one event type;
- contains a positive specific numeric price;
- has existed in its approved/live state for the configured minimum period.

Defaults:

- `PARTNER_REWARD_PACKAGE_MIN_DESCRIPTION_LENGTH=40`
- `PARTNER_REWARD_PACKAGE_MIN_LIVE_HOURS=24`

This prevents an account from creating a one-line placeholder package and immediately earning a reward.

## Review reward

A review qualifies only when:

- the supplier profile is approved;
- the review is approved and is not flagged;
- the review has EventFlow's verified-customer marker;
- the reviewer's email is verified;
- the reviewer is not the supplier, the referring partner or another supplier account;
- the reviewer's account has existed for the configured minimum period;
- the review has remained available for the configured moderation period;
- EventFlow can find a real two-way message conversation between the reviewer and supplier;
- the review text is not an exact normalised copy of another approved review written by a different account.

Defaults:

- `PARTNER_REWARD_REVIEWER_MIN_ACCOUNT_HOURS=24`
- `PARTNER_REWARD_REVIEW_MIN_AGE_HOURS=24`

A review submitted today therefore does not create immediately withdrawable partner value merely because it passed the first automated spam check.

## Subscription reward

A subscription reward requires persisted billing evidence:

- a paid invoice belonging to the referred supplier;
- a non-free subscription belonging to the same supplier;
- a Stripe invoice identifier;
- an amount at or above `PARTNER_REWARD_MIN_SUBSCRIPTION_AMOUNT` (default 1 major currency unit).

The existing 30-day referral attribution window and reward maturation rules continue to apply. Existing refund/dispute/chargeback clawbacks remain authoritative after the reward is issued.

Subscription rewards are now part of deferred reconciliation, so a webhook arriving before all local billing evidence is ready does not require an unsafe fallback award.

## Duplicate supplier businesses

Before any milestone reward is issued, PR2 compares the approved supplier business against other approved supplier accounts. Automatic withholding requires strong evidence, currently one of:

- identical registered company number;
- identical VAT registration number;
- identical website plus postcode;
- identical telephone number plus postcode;
- identical normalised company identity plus postcode.

A company name alone is not enough to block a reward.

## Reward exposure caps

PR2 applies configurable rolling caps to positive milestone rewards for each partner:

- `PARTNER_REWARD_DAILY_POINTS_CAP` — default 5,000 points in 24 hours;
- `PARTNER_REWARD_WEEKLY_POINTS_CAP` — default 20,000 points in 7 days;
- `PARTNER_REWARD_MONTHLY_POINTS_CAP` — default 60,000 points in 30 days.

The attempted reward is withheld only when adding it would exceed the applicable rolling cap. Because the underlying milestone remains unrewarded, deferred reconciliation can retry after the rolling window moves.

These are exposure controls, not accusations of fraud.

## Campaign burst cap

If a referral carries a campaign identifier, `PARTNER_REWARD_CAMPAIGN_DAILY_SUPPLIER_CAP` limits the number of distinct suppliers attributed to that same campaign within a rolling 24-hour window before more rewards are issued. Default: 50.

This is intended to contain promotional-code or paid-signup abuse without changing existing attribution.

## Attribution integrity

`partner_referrals.supplierUserId` is already unique and the first referral record wins. PR2 adds explicit audit evidence when code attempts to attribute an already-referred supplier to a different partner.

Those events use the reason code:

`REFERRAL_ATTRIBUTION_REASSIGNMENT_ATTEMPT`

The supplier remains attached to the original partner.

## Integrity event ledger

Reward-withholding and attribution-conflict evidence is stored in `partner_reward_integrity_events` with a deterministic event ID. Repeated observations of the same partner/supplier/reward/reason increment an occurrence counter rather than creating unlimited duplicate records.

PR3 can surface these events in the administrator investigation UI.

## Existing protections retained

PR2 does not replace the controls merged previously:

- one reward of each milestone type per partner/supplier at database level;
- verified partner and supplier identity requirements;
- self-referral/business-overlap checks;
- 30-day package/subscription attribution window;
- 30-day reward maturity before cashout;
- manual first-cashout review;
- refund/dispute/chargeback clawbacks;
- cashout ledger/idempotency protections.

## Validation

PR2 has focused unit coverage for qualification evidence, duplicate businesses, two-way review interaction, copied reviews, paid invoices, rolling caps and attribution preservation. These tests must be included in the permanent smoke gate before merge.

The PR remains draft while GitHub Actions usage is unavailable. Once hosted runners are available again, the full repository matrix must run against the exact final head and every genuine failure must be fixed and rerun before merge.
