# Partner Programme anti-abuse controls

This document describes the technical and manual controls applied to EventFlow partner rewards before wider programme advertising.

## Reward eligibility

A referred supplier must:

- have a supplier account;
- have a verified email address;
- have a company name;
- have a valid referral record linked to an active partner; and
- not share a matching company identity or private business email domain with the referring partner.

Public email providers such as Gmail and Outlook are not treated as identity matches by themselves.

The eligibility guard applies to signup, package, first-review and paid-subscription rewards. A withheld reward is logged with a reason code and is not added to the partner ledger.

Verified signup rewards are reconciled before partner balances are calculated. This means an unverified signup does not create withdrawable value, but the reward can be added automatically after the supplier becomes eligible.

## Cashout fraud assessment

Every attempt to approve a partner cashout is assessed using current database records. The assessment considers:

- whether the partner account and email are active and verified;
- whether this is the partner's first cashout;
- how quickly the cashout follows partner registration;
- whether rewarded suppliers are verified;
- possible partner and supplier identity overlap;
- unusually rapid milestone completion;
- repeated supplier email domains; and
- reward transactions that do not have a matching referral record.

Assessments are persisted in `partner_fraud_assessments` and the risk summary is attached to the cashout request.

A high-risk assessment fails closed. The cashout remains unapproved and must be rejected or investigated before any reward is delivered.

## Database protections

MongoDB indexes enforce:

- one partner record per user;
- one referral attribution per supplier;
- one reward of each type per partner and supplier;
- one cashout request per partner and idempotency key; and
- one fraud assessment per cashout request.

The partial unique indexes exclude records that do not contain the relevant supplier or idempotency value.

## Launch operating procedure

During the initial launch:

1. Manually review every first cashout.
2. Review every high-risk signal against the supplier profile, package, review and payment records.
3. Reject cashouts involving fake, duplicate, test or self-referred suppliers.
4. Disable the partner account where deliberate abuse is established.
5. Record the reason in internal cashout notes and retain the fraud assessment.
6. Check Stripe for refunds, disputes or chargebacks before delivering larger rewards.

Shared infrastructure or a rapid milestone is an indicator, not proof by itself. Legitimate cases should be documented rather than automatically penalised.

## Current boundary

The current implementation prevents weak identities from earning new rewards and blocks high-risk cashout approval. Stripe refund and chargeback events should still be checked during manual review; automatic reward clawback is a separate follow-up hardening item.
