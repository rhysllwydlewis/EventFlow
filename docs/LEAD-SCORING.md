# Lead Scoring System Documentation

## Overview

EventFlow's lead scoring system is our **#1 competitive differentiator**. Unlike competitors (like Hitched) who are plagued by junk leads, spam, and tire-kickers, we provide suppliers with intelligent lead quality ratings to help them prioritize their time and energy.

Every enquiry is automatically scored from **0-100** and classified as:

- **High Quality** (75-100): Complete information, realistic timeline, verified contact details
- **Medium Quality** (50-74): Some missing details but appears legitimate
- **Low Quality** (0-49): Incomplete, suspicious, or spam indicators

## Why This Matters

Suppliers consistently report that junk leads are their biggest frustration with event marketplaces:

- **Time wasted** responding to spam or non-serious enquiries
- **Frustration** from fake contact details or disposable emails
- **ROI concerns** when paying for low-quality leads

EventFlow's lead scoring helps suppliers:

- ✅ **Prioritize** responses to high-quality leads first
- ✅ **Save time** by filtering out obvious spam
- ✅ **Track quality** over time in their dashboard
- ✅ **Justify cost** with measurable lead quality metrics

## Scoring Algorithm

The algorithm evaluates multiple factors to calculate a score:

### 1. Event Date Scoring (Max +20, Min -10)

```javascript
Timeline                    Points      Reasoning
------------------------------------------------------------------------------------------------
1-12 months out            +20         Sweet spot: serious planners, realistic timeline
12-24 months out           +10         Still good, early planners
< 1 month out              -10         Last-minute = risky, may not book
> 2 years out              -5          Too far = may ghost or plans change
No date provided           -10         Red flag: lack of planning or spam
Invalid date format        -5          Careless or bot
```

### 2. Contact Completeness (Max +20)

```javascript
Field                       Points      Reasoning
------------------------------------------------------------------------------------------------
Valid phone number         +7          Shows commitment, easy to reach
Valid email address        +8          Required for communication
Both phone AND email       +5 bonus    Multiple contact methods = serious
```

### 3. Optional Details (Max +20)

```javascript
Field                       Points      Reasoning
------------------------------------------------------------------------------------------------
Budget provided            +10         Shows realistic expectations
Guest count provided       +5          Planning detail = more serious
Valid UK postcode          +5          Location verified, local enquiry
```

### 4. Message Quality (Max +10, Min -5)

```javascript
Message Length              Points      Reasoning
------------------------------------------------------------------------------------------------
> 100 characters           +10         Detailed message = thoughtful enquiry
50-100 characters          +5          Decent message
< 20 characters            -5          Very brief = low effort
Spam keywords detected     -20         Obvious spam
No message                 -5          Low effort
```

**Spam Keywords**: "click here", "buy now", "limited time", "act now", "free money"

### 5. Email Quality (Max +5, Min -30)

```javascript
Email Type                  Points      Reasoning
------------------------------------------------------------------------------------------------
Disposable email           -30         Spam/bot indicator (10minutemail, mailinator, etc.)
Business domain            +5          Professional = more serious
Free provider (Gmail etc)  0           Neutral, most common
```

### 6. Behavior Signals (Max 0, Min -30)

```javascript
Behavior                    Points      Reasoning
------------------------------------------------------------------------------------------------
< 30 seconds on page       -10         Rushed = bot or spam
> 5 previous enquiries     -20         Spammer indicator
CAPTCHA failed             -50         Obvious bot
```

## Example Scores

### High Quality Lead (Score: 85)

```javascript
{
  eventDate: "2025-08-15",           // 7 months out: +20
  email: "sarah@mybusiness.co.uk",   // Business email: +8, +5
  phone: "07123456789",              // Valid phone: +7
  budget: "£2,000-£3,000",           // Budget provided: +10
  guestCount: 80,                    // Guest count: +5
  postcode: "SW1A 1AA",              // Valid postcode: +5
  message: "We're planning our wedding... [120 chars]", // Detailed: +10
  timeOnPage: 145,                   // Good engagement: 0
  captchaPassed: true                // Human: 0
}
// Base: 50 + 20 + 8 + 7 + 5 + 10 + 5 + 5 + 10 = 120 (capped at 100)
// Rating: HIGH
```

### Medium Quality Lead (Score: 60)

```javascript
{
  eventDate: "2026-06-01",           // 18 months out: +10
  email: "john@gmail.com",           // Free provider: +8
  phone: "07987654321",              // Valid phone: +7
  budget: null,                      // No budget: 0
  guestCount: null,                  // No guest count: 0
  postcode: null,                    // No postcode: 0
  message: "Interested in your services", // Short: +5
  timeOnPage: 45,                    // Decent: 0
  captchaPassed: true                // Human: 0
}
// Base: 50 + 10 + 8 + 7 + 5 = 80 (before adjustments)
// Rating: MEDIUM
```

### Low Quality Lead (Score: 25)

```javascript
{
  eventDate: "2025-02-05",           // < 1 month: -10
  email: "test@10minutemail.com",    // Disposable: +8 -30 = -22
  phone: null,                       // No phone: 0
  budget: null,                      // No budget: 0
  guestCount: null,                  // No guest count: 0
  postcode: null,                    // No postcode: 0
  message: "hi",                     // Very short: -5
  timeOnPage: 12,                    // Rushed: -10
  captchaPassed: true                // Human: 0
}
// Base: 50 - 10 - 22 - 5 - 10 = 3
// Rating: LOW
```

## Implementation

### Backend (Node.js)

The lead scoring utility is located at `/utils/leadScoring.js`:

```javascript
const { calculateLeadScore, validateEnquiry } = require('./utils/leadScoring');

// When processing an enquiry
const result = validateEnquiry(enquiryData);

if (result.valid) {
  const enquiry = {
    ...result.validatedData,
    leadScore: result.leadScore.rating, // 'High', 'Medium', 'Low'
    leadScoreRaw: result.leadScore.score, // 0-100
    leadScoreFlags: result.leadScore.flags, // ['disposable-email', 'short-message']
    validationFlags: {
      captchaPassed: enquiryData.captchaPassed,
      emailVerified: false, // Will be true after email click-through
      phoneFormat: result.leadScore.breakdown.contactScore > 0,
      suspiciousActivity: result.leadScore.flags.includes('repeat-enquirer'),
    },
    metadata: {
      timeOnPage: enquiryData.timeOnPage,
      referrer: enquiryData.referrer,
      deviceType: enquiryData.deviceType,
    },
  };

  await saveEnquiry(enquiry);
}
```

### Database Schema

Update `models/index.js` Thread/Message schema:

```javascript
{
  // ... existing fields
  leadScore: { bsonType: 'string' },     // 'High', 'Medium', 'Low'
  leadScoreRaw: { bsonType: 'number' },  // 0-100
  leadScoreFlags: {
    bsonType: 'array',
    items: { bsonType: 'string' }
  },
  validationFlags: {
    bsonType: 'object',
    properties: {
      captchaPassed: { bsonType: 'bool' },
      emailVerified: { bsonType: 'bool' },
      phoneFormat: { bsonType: 'bool' },
      suspiciousActivity: { bsonType: 'bool' }
    }
  },
  metadata: {
    bsonType: 'object',
    properties: {
      timeOnPage: { bsonType: 'number' },
      referrer: { bsonType: 'string' },
      deviceType: { bsonType: 'string' }
    }
  }
}
```

### Frontend Display

Display lead score badges in supplier dashboard:

```html
<!-- High Quality Lead -->
<span class="lead-badge lead-badge-high"> ⭐ High Quality </span>

<!-- Medium Quality Lead -->
<span class="lead-badge lead-badge-medium"> ● Medium Quality </span>

<!-- Low Quality Lead -->
<span class="lead-badge lead-badge-low"> ⚠ Low Quality </span>
```

```css
.lead-badge {
  display: inline-block;
  padding: 0.25rem 0.75rem;
  border-radius: 12px;
  font-size: 0.875rem;
  font-weight: 600;
}

.lead-badge-high {
  background: #d1fae5;
  color: #065f46;
}

.lead-badge-medium {
  background: #fef3c7;
  color: #92400e;
}

.lead-badge-low {
  background: #fee2e2;
  color: #991b1b;
}
```

## CAPTCHA Integration

To prevent bot spam, EventFlow uses [ALTCHA](https://altcha.org) — a privacy-focused, self-hosted proof-of-work CAPTCHA:

1. **Set `ALTCHA_HMAC_KEY`** environment variable (generate with `openssl rand -base64 32`)
2. **Add to enquiry form**:

   ```html
   <script src="https://cdn.jsdelivr.net/npm/@altcha-org/altcha/dist/altcha.min.js" async defer></script>
   <form id="enquiry-form">
     <!-- form fields -->
     <altcha-widget challengeurl="/api/v1/altcha/challenge"></altcha-widget>
     <button type="submit">Send Enquiry</button>
   </form>
   ```

3. **Verify server-side** (no external API calls):

   ```javascript
   const { verifySolution } = require('altcha-lib');

   async function verifyCaptcha(payload) {
     const ok = await verifySolution(payload, process.env.ALTCHA_HMAC_KEY);
     return ok;
   }
   ```

## Analytics & Reporting

### Supplier Dashboard

Show lead quality breakdown:

```
Your Enquiries (Last 30 Days)

High Quality:   12 (60%)  ████████████░░░░░░░░
Medium Quality:  6 (30%)  ██████░░░░░░░░░░░░░░
Low Quality:     2 (10%)  ██░░░░░░░░░░░░░░░░░░

Average Lead Score: 72/100 (High)
```

### Admin Analytics

Track platform-wide quality:

- Average lead score across all enquiries
- % of enquiries by quality tier
- Spam detection rate
- Top spam indicators (disposable emails, failed CAPTCHA, etc.)

## Future Enhancements

Not in 90-day scope, but consider for future:

1. **Machine Learning**: Train model on supplier feedback (Won/Lost deals)
2. **Email Verification**: Send verification link and boost score when clicked
3. **Phone Verification**: SMS verification for additional +10 points
4. **Historical Scoring**: Track customer's enquiry history across suppliers
5. **Supplier Feedback Loop**: "Was this lead quality accurate?" to refine algorithm
6. **Geographic Scoring**: Boost score if customer location matches supplier service area

## Testing

See `/tests/unit/lead-scoring.test.js` for comprehensive test coverage:

- ✅ High quality lead scenarios
- ✅ Medium quality lead scenarios
- ✅ Low quality lead scenarios
- ✅ Spam detection
- ✅ Disposable email detection
- ✅ Edge cases and validation

## Support & Troubleshooting

**Q: A supplier says a "Low Quality" lead was actually great. What do we do?**
A: This is expected occasionally. The algorithm is a guide, not gospel. Consider:

- Was there information we couldn't see (phone conversation, prior relationship)?
- Is there a pattern (specific supplier/category gets more false lows)?
- Collect feedback and refine algorithm quarterly

**Q: Can suppliers filter out Low Quality leads entirely?**
A: Not recommended initially. Better to show them but de-prioritized. Some suppliers may want to respond to all leads. Consider adding this as a Pro feature later.

**Q: What if spam gets through with a High score?**
A: Rare but possible. Add "Report Spam" button that:

- Flags the enquiry for admin review
- Adjusts scoring algorithm if pattern detected
- Potentially bans persistent spam email domains

---

**Last Updated**: December 2025
**Version**: 1.0
**Owner**: Product Team
