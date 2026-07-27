# EventFlow Partner Portal

## Purpose

The Partner Portal is the private EventFlow workspace for community partners, creators, group administrators and other approved referrers who introduce genuine event suppliers to EventFlow.

The programme lives under `/partner` and is intentionally excluded from search indexing. Partners receive a unique referral code and link. Supplier activity attributed to that link can create reward points.

## Main pages

| URL                        | Purpose                              |
| -------------------------- | ------------------------------------ |
| `/partner`                 | Partner sign-in and registration     |
| `/partner/dashboard`       | Partner workspace                    |
| `/partner/media-pack.html` | Approved copy-ready sharing material |
| `/partner/terms.html`      | Partner Programme Terms              |
| `/admin-partners`          | Administrator partner moderation     |
| `/admin-cashout-requests`  | Administrator redemption processing  |

## Dashboard structure

The dashboard is organised into six accessible sections on one route:

1. **Overview** – available, maturing, potential and total rewards; current referral link; redemption progress; recent referrals.
2. **Referrals** – privacy-masked suppliers, milestone progress, attribution deadlines, earned points and remaining potential.
3. **Rewards** – earnings breakdown, points activity, redemption form and redemption history.
4. **Share Tools** – links to the existing Share Pack and Programme Terms plus current-link quick actions.
5. **Support** – ticket creation, ticket history, detail and replies.
6. **Settings** – profile, password and partner-code management.

Secondary sections load independently. A failure in one endpoint must not prevent the rest of the dashboard from working.

## Reward milestones

The standard reward model is:

| Milestone                                                                | Points | Eligibility window                                                                             |
| ------------------------------------------------------------------------ | -----: | ---------------------------------------------------------------------------------------------- |
| Referred supplier signs up                                               |      5 | Recorded when the supplier registers through a valid current or historical code                |
| Referred supplier creates their first package                            |     10 | Must occur within 30 days of supplier signup                                                   |
| Referred supplier receives their first customer review                   |     15 | No attribution expiry is currently applied by the reward service                               |
| Referred supplier makes their first successful paid subscription payment |    100 | Must occur within 30 days of supplier signup; £0 invoices and trial activations do not qualify |

Each reward is idempotent per partner, supplier and reward type.

The deprecated `PROFILE_APPROVED_BONUS` ledger type remains recognised for historical compatibility but no new profile-approval reward is issued.

## Referral status

`GET /api/v1/partner/referrals` returns a privacy-safe view of each referral including:

- masked supplier name;
- signup date;
- attribution expiry date;
- days remaining for package and subscription milestones;
- package qualification and timestamp;
- review qualification and timestamp;
- subscription qualification and timestamp;
- points earned from that supplier;
- remaining potential points;
- current state: `active`, `completed` or `expired`;
- stored campaign metadata where available.

Review qualification is derived from existing `FIRST_REVIEW_BONUS` ledger transactions. This avoids a risky data migration and ensures already rewarded referrals display correctly.

Package and subscription expiry must not be applied to the review milestone.

## Point maturity

Reward points mature after the configured maturity period, currently 30 days.

| State         | Meaning                                                             |
| ------------- | ------------------------------------------------------------------- |
| **Maturing**  | Earned reward points that have not reached the maturity date        |
| **Available** | Mature reward points that can be redeemed                           |
| **Potential** | Milestones that remain available for current referrals              |
| **Held**      | Available points reserved against a submitted redemption request    |
| **Redeemed**  | Points permanently deducted after reward delivery                   |
| **Released**  | A previous hold returned after rejection or failed request creation |

Positive administrator adjustments are immediately available. Cashout holds reduce available balance. A release restores held points.

## Programme configuration

The backend is the single source of truth for the current programme rules. `GET /api/v1/partner/me` and `GET /api/v1/partner/stats` expose:

```json
{
  "pointsPerGbp": 100,
  "maturityDays": 30,
  "attributionDays": 30,
  "minimumCashoutGbp": 15,
  "cashoutDenominations": [15, 20, 25],
  "cashoutMethods": ["amazon_voucher", "prepaid_debit_card"]
}
```

The dashboard must use this object rather than hardcoding reward values, minimums or denominations.

Environment variables:

| Variable                    | Purpose                                                           |
| --------------------------- | ----------------------------------------------------------------- |
| `POINTS_PER_GBP`            | Number of points equal to £1; default 100                         |
| `CASHOUT_DENOMINATIONS`     | Comma-separated allowed GBP amounts; default £15–£500 in £5 steps |
| `BASE_URL` / `APP_BASE_URL` | Canonical origin used for referral links                          |
| `JWT_SECRET`                | Authentication signing secret                                     |
| `MONGODB_URI`               | Production database connection                                    |

## Redemption integrity

### Request requirements

`POST /api/v1/partner/cashout-requests` requires:

- authenticated active partner;
- supported reward method;
- configured denomination;
- enough **available** points;
- a valid `Idempotency-Key` header or matching `idempotencyKey` body field.

Maturing points and points already held against another request cannot be reused.

### Safe creation sequence

Cashout creation is serialised per partner within the application process:

1. Look for an existing request with the same partner and idempotency key.
2. Return that request when found.
3. Re-read the available balance inside the protected section.
4. Persist a `CASHOUT_HOLD` ledger transaction.
5. Refuse to continue if the hold was not durably written.
6. Persist the cashout request referencing the hold.
7. Re-read and return the refreshed balance.

If request insertion fails after the hold is written, the service immediately persists a `CASHOUT_RELEASE`.

If both request insertion and rollback fail, the response contains:

- `reconciliationRequired: true`;
- a cashout reference;
- instructions to contact support.

This condition must be logged as a critical operational error.

### Idempotency

The same idempotency key for the same partner returns the original request and does not create another hold.

The browser keeps the same key after a network/server error so a safe retry cannot duplicate the request. The key is reset after success or after a client-side validation error.

### Status workflow

```text
submitted → approved → processing → delivered
     └──────────────→ rejected
```

- `submitted`: points are held.
- `approved`: administrator has accepted the request.
- `processing`: reward delivery is underway.
- `delivered`: hold is finalised and points are permanently redeemed.
- `rejected`: held points are released.

Typical processing time is 3–5 working days.

## Disabled-account support

Financial, referral, transaction, code and settings endpoints continue to reject disabled partners.

Disabled partners retain access only to restricted support functions:

- create an account-access support ticket;
- list their own support tickets;
- open their own support tickets;
- reply to their own tickets unless closed.

Tickets raised while disabled use:

- category `partner_account_access`;
- high priority;
- the authenticated partner/user identifiers.

The disabled dashboard hides financial and referral content and opens the Support section. It also provides `hello@event-flow.co.uk` as a fallback through the programme wording.

## Partner code management

Partners can generate a new current code.

The previous code is stored in `partner_code_history` and remains valid so old Facebook posts, messages and campaign links continue to attribute suppliers correctly.

The dashboard stores the current partner code and referral URL in one client-side state object. All copy, WhatsApp and email actions read from that current state at click time. Regeneration updates:

- displayed URL;
- displayed code badge;
- settings code display;
- copy action;
- WhatsApp action;
- email action;
- code history.

## Support ticket endpoints

| Method | Endpoint                                    | Description                                         |
| ------ | ------------------------------------------- | --------------------------------------------------- |
| `POST` | `/api/v1/partner/support-ticket`            | Create a normal or restricted account-access ticket |
| `GET`  | `/api/v1/partner/support-tickets`           | List the current partner’s tickets                  |
| `GET`  | `/api/v1/partner/support-tickets/:id`       | Read one owned ticket                               |
| `POST` | `/api/v1/partner/support-tickets/:id/reply` | Reply to one owned, non-closed ticket               |

Partner-specific detail/reply endpoints are used by the dashboard so disabled partners are not routed through unrelated generic ticket access rules.

## API summary

| Method  | Endpoint                               | Purpose                                             |
| ------- | -------------------------------------- | --------------------------------------------------- |
| `POST`  | `/api/v1/partner/register`             | Register partner account                            |
| `GET`   | `/api/v1/partner/me`                   | Core profile, balance and configuration             |
| `PATCH` | `/api/v1/partner/me`                   | Update profile                                      |
| `POST`  | `/api/v1/partner/change-password`      | Change password                                     |
| `GET`   | `/api/v1/partner/referrals`            | Enriched referral milestone list                    |
| `GET`   | `/api/v1/partner/transactions`         | Enriched ledger history and maturity state          |
| `GET`   | `/api/v1/partner/stats`                | Breakdown, redemption progress and referral summary |
| `POST`  | `/api/v1/partner/regenerate-code`      | Generate a new current partner code                 |
| `GET`   | `/api/v1/partner/code-history`         | Historical codes                                    |
| `POST`  | `/api/v1/partner/cashout-requests`     | Submit idempotent redemption request                |
| `GET`   | `/api/v1/partner/cashout-requests`     | List owned requests                                 |
| `GET`   | `/api/v1/partner/cashout-requests/:id` | Read owned request                                  |

## Accessibility and responsive behaviour

The dashboard provides:

- tab/tabpanel relationships;
- Left/Right/Home/End keyboard tab navigation;
- visible focus indicators;
- dialog focus trapping;
- Escape-to-close;
- focus restoration after closing;
- live regions for loading, success and error messages;
- reduced-motion handling;
- 44px primary touch targets;
- single-column mobile reward cards;
- responsive transaction rows and referral milestone cards.

## Testing

Relevant focused checks:

```bash
npx jest --runInBand --coverage=false \
  tests/unit/partner-cashout-requests.test.js \
  tests/unit/partner-ledger-integrity.test.js \
  tests/unit/partner-new-endpoints.test.js \
  tests/unit/partner-payout-validation.test.js \
  tests/unit/partner-dashboard-frontend.test.js \
  tests/unit/partner-points-enhancements.test.js
```

The full repository test, formatting, linting, E2E, visual and accessibility workflows should also run in CI.

## Operational reconciliation

Administrators should investigate any log containing:

```text
[PARTNER-CASHOUT] CRITICAL rollback failure
```

Use the logged partner ID, cashout ID and hold transaction ID to reconcile the ledger and cashout request collection before manually adjusting points.
