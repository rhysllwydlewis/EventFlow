# EventFlow Stripe Subscription System Guide

## Overview

EventFlow uses Stripe for all payment processing. Google Pay integration has been removed in favor of a streamlined Stripe-only approach for better reliability and maintenance.

## Current Pricing Structure

### Free

- **Price**: £0/month
- **Features**:
  - Up to 3 packages
  - Up to 10 event bookings per month
  - Messaging enabled
  - No analytics
  - Email support

### Pro Monthly

- **Price**: £39/month for first 3 months, then £59/month
- **Trial**: 14 days free
- **Features**:
  - Pro supplier badge on profile
  - Priority listing in search results
  - Up to 50 event bookings per month
  - Up to 50 packages
  - Email support
  - Analytics dashboard

### Pro+ Monthly

- **Price**: £199/month
- **Trial**: 14 days free
- **Features**:
  - Premium Pro+ badge on profile
  - All Pro features
  - Unlimited bookings
  - Unlimited packages
  - Advanced analytics dashboard
  - Priority phone support
  - Custom branding options
  - Featured in homepage carousel

### Pro Yearly

- **Price**: £468/year (save £240 vs monthly)
- **Trial**: 28 days free
- Same features as Pro Monthly

### Pro+ Yearly

- **Price**: £2,388/year
- **Trial**: 28 days free
- Same features as Pro+ Monthly

## Architecture

### Components

1. **Frontend**: `/public/supplier/subscription.html`
   - Subscription management UI
   - Plan selection and comparison
   - Stripe checkout integration

2. **Backend Routes**: `/routes/subscriptions-v2.js`
   - RESTful API for subscription operations
   - Stripe integration
   - CSRF protection

3. **Business Logic**: `/services/subscriptionService.js`
   - Subscription lifecycle management
   - Feature access control
   - User feature checks

4. **Payment Service**: `/services/paymentService.js`
   - Stripe API wrapper with retry logic
   - Customer creation and management
   - Payment error handling

5. **Data Models**: `/models/Subscription.js`
   - Feature definitions per plan
   - Schema validation
   - Plan configuration

6. **Webhooks**: `/webhooks/stripeWebhookHandler.js`
   - Stripe event processing
   - Subscription status updates
   - Payment notifications

7. **Middleware**: `/middleware/subscriptionGate.js`
   - Feature gating
   - Subscription requirement checks
   - Access control

### Subscription Flow

1. **User selects plan** → Click "Subscribe" on `/supplier/subscription.html`
2. **Frontend calls** `POST /api/v2/subscriptions` with plan details
3. **Backend creates** Stripe subscription with trial period
4. **Stripe redirects** to hosted checkout page
5. **User completes** payment setup
6. **Stripe webhook** notifies backend of subscription creation
7. **Backend activates** subscription and updates user record
8. **User redirected** to dashboard with active subscription

## Feature Gating

### Server-Side

All routes use `subscriptionService` to check feature access:

```javascript
const subscriptionService = require('../services/subscriptionService');

// Check if user has access to a feature
const hasAnalytics = await subscriptionService.checkFeatureAccess(userId, 'analytics');

// Get user's feature configuration
const features = await subscriptionService.getUserFeatures(userId);
const maxPackages = features.features.maxPackages;

// Check subscription tier
const subscription = await subscriptionService.getSubscriptionByUserId(userId);
const isPro = ['pro', 'pro_plus'].includes(subscription?.plan);
```

### Middleware

Use `subscriptionGate` middleware for route-level protection:

```javascript
const { requireSubscription, checkFeatureLimit } = require('../middleware/subscriptionGate');

// Require Pro or higher
router.post('/advanced-analytics', requireSubscription('pro'), async (req, res) => {
  // Only Pro+ users can access this
});

// Check specific feature
router.post('/custom-branding', checkFeatureLimit('customBranding'), async (req, res) => {
  // Only users with customBranding feature can access
});
```

### Client-Side

Feature tiers are defined in `/public/supplier/js/feature-access.js`:

```javascript
const FEATURE_TIERS = {
  free: {
    maxPackages: 3,
    maxBookings: 10,
    priorityListing: false,
    analytics: false,
    badge: null,
  },
  pro: {
    maxPackages: 50,
    maxBookings: 50,
    priorityListing: true,
    analytics: true,
    badge: 'pro',
  },
  pro_plus: {
    maxPackages: -1, // unlimited
    maxBookings: -1, // unlimited
    priorityListing: true,
    analytics: true,
    badge: 'pro_plus',
    customBranding: true,
    homepageCarousel: true,
  },
};
```

## Testing

### Test Cards (Stripe Test Mode)

- **Success**: 4242 4242 4242 4242
- **Decline**: 4000 0000 0000 0002
- **3D Secure**: 4000 0025 0000 3155
- **Insufficient Funds**: 4000 0000 0000 9995

### Webhook Testing

Listen to Stripe webhooks locally:

```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Login
stripe login

# Forward webhooks to local server
stripe listen --forward-to localhost:3000/api/v2/webhooks/stripe

# Test specific events
stripe trigger customer.subscription.created
stripe trigger customer.subscription.trial_will_end
stripe trigger invoice.payment_failed
stripe trigger invoice.payment_succeeded
```

### Manual Testing Checklist

- [ ] Subscribe to Pro Monthly plan
- [ ] Verify trial period applied (14 days)
- [ ] Create packages up to limit (50)
- [ ] Verify limit enforcement (51st package fails)
- [ ] Cancel subscription
- [ ] Verify downgrade to Free tier
- [ ] Verify Free tier limit (3 packages)
- [ ] Subscribe to Pro+ plan
- [ ] Create 100+ packages (unlimited)
- [ ] Test payment failure scenario
- [ ] Verify subscription status updates to past_due

## Stripe Events Handled

| Event                                  | Handler                          | Purpose                              |
| -------------------------------------- | -------------------------------- | ------------------------------------ |
| `customer.subscription.created`        | `handleSubscriptionCreated`      | Initialize subscription              |
| `customer.subscription.updated`        | `handleSubscriptionUpdated`      | Update status and dates              |
| `customer.subscription.deleted`        | `handleSubscriptionDeleted`      | Cancel and downgrade                 |
| `customer.subscription.trial_will_end` | `handleSubscriptionTrialWillEnd` | Notify user 3 days before trial ends |
| `invoice.created`                      | `handleInvoiceCreated`           | Create invoice record                |
| `invoice.payment_succeeded`            | `handleInvoicePaymentSucceeded`  | Mark invoice paid                    |
| `invoice.payment_failed`               | `handleInvoicePaymentFailed`     | Update to past_due, notify user      |
| `payment_intent.succeeded`             | `handlePaymentIntentSucceeded`   | Update payment record                |
| `payment_intent.payment_failed`        | `handlePaymentIntentFailed`      | Handle payment failure               |
| `charge.refunded`                      | `handleChargeRefunded`           | Process refund                       |

## Database Schema

### Subscriptions Collection

```javascript
{
  id: 'sub_xxx',
  userId: 'usr_xxx',
  plan: 'pro', // free, pro, pro_plus
  status: 'active', // active, trialing, past_due, canceled, unpaid
  stripeSubscriptionId: 'sub_stripe_xxx',
  stripeCustomerId: 'cus_stripe_xxx',
  trialStart: '2024-01-01T00:00:00.000Z',
  trialEnd: '2024-01-15T00:00:00.000Z',
  currentPeriodStart: '2024-01-01T00:00:00.000Z',
  currentPeriodEnd: '2024-02-01T00:00:00.000Z',
  nextBillingDate: '2024-02-01T00:00:00.000Z',
  cancelAtPeriodEnd: false,
  canceledAt: null,
  cancelReason: null,
  billingHistory: [],
  metadata: {},
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
}
```

## Error Handling

### Retry Logic

Payment service automatically retries failed Stripe API calls with exponential backoff:

- Attempt 1: Immediate
- Attempt 2: 1 second delay
- Attempt 3: 2 second delay
- Attempt 4: 4 second delay

User errors (invalid card, authentication failures) are not retried.

### Error Types

| Error                           | Status | Description                  |
| ------------------------------- | ------ | ---------------------------- |
| `Authentication required`       | 401    | User not logged in           |
| `Subscription upgrade required` | 403    | Feature requires higher tier |
| `Payment failed`                | 402    | Payment processing error     |
| `Stripe not configured`         | 500    | Missing Stripe credentials   |

## Environment Variables

Required environment variables:

```bash
# Stripe Configuration (Required)
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...

# Stripe Price IDs (Required)
STRIPE_PRO_PRICE_ID=price_xxxxx
STRIPE_PRO_PLUS_PRICE_ID=price_xxxxx
STRIPE_PRO_YEARLY_PRICE_ID=price_xxxxx
STRIPE_PRO_PLUS_YEARLY_PRICE_ID=price_xxxxx

# Optional: Introductory Pricing
STRIPE_PRO_INTRO_COUPON_ID=coup_xxxxx # £20 off for 3 months
```

## Production Checklist

Before deploying to production:

- [ ] Update Stripe keys from test to live mode
- [ ] Configure Stripe webhook endpoint in dashboard
- [ ] Test all payment scenarios in production
- [ ] Set up monitoring and alerts for failed payments
- [ ] Configure email notifications for trial endings
- [ ] Set up dunning management for failed payments
- [ ] Review and test cancellation flow
- [ ] Verify all feature limits enforced
- [ ] Test upgrade/downgrade flows
- [ ] Backup database before deployment

## Troubleshooting

### Subscription not activating

1. Check webhook endpoint is configured in Stripe dashboard
2. Verify webhook secret matches environment variable
3. Check webhook logs in Stripe dashboard
4. Verify subscription record created in database

### Payment failed

1. Check Stripe dashboard for error details
2. Verify card details are valid
3. Check if 3D Secure is required
4. Review payment intent status

### Feature access issues

1. Verify subscription status is 'active' or 'trialing'
2. Check subscription plan matches expected tier
3. Verify feature exists in PLAN_FEATURES
4. Check middleware is applied to route

## Support

For technical issues:

- Check Stripe dashboard for payment errors
- Review webhook logs
- Check server logs for errors
- Verify environment variables are set

For business questions:

- Pricing changes require updating PLAN_FEATURES
- Feature additions require updating models and frontend
- Plan changes require database migration
