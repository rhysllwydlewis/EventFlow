# Partner Programme anti-abuse controls

This document describes the technical and manual controls applied to EventFlow partner rewards before wider programme advertising.

## Reward eligibility

A referred supplier must:

- have a supplier account and verified email address;
- have a completed, administrator-approved supplier profile;
- have a company identity;
- have a valid referral linked to an active, verified partner; and
- not share a matching company identity or private business email domain with the partner.

Public providers such as Gmail and Outlook are not treated as identity matches by themselves.

The controls apply to signup, package, first-review and paid-subscription rewards. Withheld activity is logged with a structured reason and is not added to the ledger.

Additional milestone evidence is required:

- package rewards require a complete, active and approved package with a title, price, category and event type;
- review rewards require an approved, unflagged review from a verified customer with genuine message history;
- the reviewer must not be the supplier, the partner or another supplier account; and
- a reviewer account created less than 24 hours before the review does not qualify for the partner reward.

Eligible signup, package and first-review rewards are reconciled before partner balances are calculated. Weak or unapproved activity therefore creates no withdrawable value, while a legitimate milestone can receive its deferred reward after supplier, package or review approval. Existing ledger entries are skipped so reconciliation remains idempotent.

## Cashout fraud assessment

Every attempted cashout approval is reassessed from current records. Signals include:

- missing, disabled or unverified partner identity;
- first cashout and unusually rapid cashout requests;
- unverified or unapproved referred suppliers;
- partner and supplier identity overlap;
- unusually rapid milestone completion;
- repeated private supplier email domains;
- package rewards without a qualifying package;
- review rewards without an independently verified review; and
- reward transactions without a matching referral.

Assessments are persisted in `partner_fraud_assessments` and the risk summary is attached to the cashout request.

A high-risk assessment fails closed and cannot be approved. A first or review-level cashout also requires an internal review note of at least 20 characters before approval. Successful approval records the assessment and review time.

## Refund, dispute and chargeback clawbacks

When a recorded subscription payment changes to `refunded`, `disputed` or `chargeback`, EventFlow automatically creates an idempotent debit equal to the original partner subscription reward.

The debit is linked to the original reward, supplier and payment reference. Repeated delivery of the same adverse payment status cannot create a second clawback. The referral record retains the reversal date and reference for investigation.

The existing Stripe `charge.refunded` handler therefore triggers automatic partner clawback. Any future dispute handler that marks a payment as disputed or charged back receives the same protection automatically.

## Database protections

MongoDB indexes enforce:

- one partner per user;
- one referral attribution per supplier;
- one qualifying reward of each type per partner and supplier;
- one transaction per type and external reference;
- one cashout per partner and idempotency key; and
- one fraud assessment per cashout.

The reward uniqueness index is deliberately limited to the four milestone reward types. It does not prevent legitimate adjustments, cashout releases or clawbacks for the same supplier.

## Launch operating procedure

During the initial launch:

1. Review every first cashout and record the checks in internal notes.
2. Compare assessment signals with the supplier profile, package, review and payment records.
3. Reject fake, duplicate, test or self-referred suppliers.
4. Disable the partner where deliberate abuse is established.
5. Retain the assessment and internal decision record.
6. Confirm the relevant Stripe payment remains paid before delivering a larger reward.
7. Treat shared infrastructure and rapid activity as indicators rather than proof in isolation.

## Operational boundary

The platform does not currently collect a dedicated device fingerprint or registration-IP fingerprint for partner matching. This avoids introducing a new privacy-sensitive identifier solely for the programme. Existing review IP hashing and account, business, content, payment and timing evidence are used instead.

Device or network fingerprinting should only be added after a documented privacy assessment, retention rule and false-positive appeal process.
