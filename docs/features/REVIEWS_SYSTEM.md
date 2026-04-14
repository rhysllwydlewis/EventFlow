# EventFlow Review and Rating System

## Overview

The EventFlow Review and Rating System is a comprehensive, production-ready solution for collecting, managing, and displaying customer reviews for suppliers. It includes advanced features for anti-abuse protection, trust verification, and supplier engagement.

## Features

### Core Functionality

- ⭐ **5-star rating system** with written reviews
- 📝 **Title and detailed comments** (20-2000 characters)
- 👍 **Recommendation option** for suppliers
- 📊 **Rating distribution** visualization with progress bars
- 🔍 **Filtering and sorting** (by rating, date, helpfulness)
- 📄 **Pagination** support for large review lists
- 📸 **Photo attachments** for reviews

### Trust & Verification

- ✅ **Verified customer badges** (requires message history)
- 📧 **Email verified badges**
- 🛡️ **Trust score calculation** (0-100 scale)
- 🏆 **Badge system** for high-performing suppliers:
  - **Top Rated** (4.8+ stars, 10+ reviews)
  - **Responsive** (<2 hour response time, 80%+ response rate)
  - **Highly Reviewed** (50+ reviews)
  - **Customer Favorite** (4.7+ stars, 100+ reviews)

### Anti-Abuse Protection

- ⏱️ **IP-based rate limiting** (max 5 reviews/hour per IP)
- 🔒 **30-day cooldown** between reviews per supplier
- 🚫 **Automatic spam detection**:
  - Spam keywords and URL patterns
  - Competitor domain checking
  - New account patterns
  - Temporal clustering detection
- 🚩 **Automatic flagging** for suspicious reviews
- 📋 **Admin moderation queue** for flagged content

### Engagement Features

- 💬 **Supplier responses** to reviews
- 👍👎 **Helpful/unhelpful voting** on reviews
- 📧 **Email notifications** (suppliers notified of new reviews)
- 📈 **Supplier dashboard** with review analytics

## Architecture

### Database Collections

#### `reviews`

```javascript
{
  id: string,                    // Unique review ID
  supplierId: string,            // Supplier being reviewed
  userId: string,                // Reviewer user ID
  userName: string,              // Display name
  rating: number (1-5),          // Star rating
  title: string,                 // Review title
  comment: string,               // Review text
  recommend: boolean,            // Would recommend
  eventType: string,             // Event type (optional)
  eventDate: string,             // Event date (optional)
  verified: boolean,             // Has message history
  emailVerified: boolean,        // Email verified
  approved: boolean,             // Admin approved
  flagged: boolean,              // Flagged for moderation
  flagReason: string[],          // Reasons for flagging
  ipAddress: string,             // Hashed IP
  userAgent: string,             // Browser info
  helpfulCount: number,          // Helpful votes
  unhelpfulCount: number,        // Unhelpful votes
  photos: string[],              // Photo URLs
  supplierResponse: {
    text: string,
    respondedAt: string,
    respondedBy: string
  },
  createdAt: string,
  updatedAt: string
}
```

#### `reviewVotes`

```javascript
{
  id: string,
  reviewId: string,
  userId: string,              // Optional (allows anonymous)
  voteType: 'helpful' | 'unhelpful',
  ipAddress: string,           // Hashed
  createdAt: string
}
```

#### `supplierAnalytics`

```javascript
{
  id: string,
  supplierId: string,
  averageRating: number,
  totalReviews: number,
  ratingDistribution: { 1-5: number },
  recommendationRate: number,  // Percentage
  trustScore: number,          // 0-100
  responseRate: number,        // Percentage
  averageResponseTime: number, // Hours
  badges: string[],            // Earned badges
  lastCalculated: string,
  updatedAt: string
}
```

#### `reviewModerations`

```javascript
{
  id: string,
  reviewId: string,
  moderatorId: string,
  action: 'approve' | 'reject' | 'flag' | 'unflag',
  reason: string,
  notes: string,
  previousState: object,
  createdAt: string
}
```

### API Endpoints

#### Customer Endpoints

**Submit Review**

```http
POST /api/suppliers/:supplierId/reviews
Authorization: Required
Content-Type: application/json

{
  "rating": 5,
  "title": "Excellent service!",
  "comment": "We had an amazing experience...",
  "recommend": true,
  "eventType": "Wedding",
  "eventDate": "2025-06-15",
  "photos": ["url1", "url2"]
}

Response: 200 OK
{
  "success": true,
  "review": { ... },
  "message": "Review submitted successfully!"
}
```

**Get Reviews (with pagination)**

```http
GET /api/suppliers/:supplierId/reviews?page=1&perPage=10&sortBy=date&minRating=4&verifiedOnly=false

Response: 200 OK
{
  "success": true,
  "reviews": [...],
  "pagination": {
    "page": 1,
    "perPage": 10,
    "total": 45,
    "totalPages": 5,
    "hasNext": true,
    "hasPrev": false
  }
}
```

**Vote on Review**

```http
POST /api/reviews/:reviewId/vote
Content-Type: application/json

{
  "voteType": "helpful" // or "unhelpful"
}

Response: 200 OK
{
  "success": true,
  "review": { ... },
  "message": "Marked as helpful. Thank you for your feedback!"
}
```

**Get Rating Distribution**

```http
GET /api/reviews/supplier/:supplierId/distribution

Response: 200 OK
{
  "success": true,
  "distribution": { 1: 0, 2: 1, 3: 5, 4: 15, 5: 30 },
  "total": 51,
  "average": 4.6
}
```

#### Supplier Endpoints

**Respond to Review**

```http
POST /api/reviews/:reviewId/respond
Authorization: Required (Supplier role)
Content-Type: application/json

{
  "response": "Thank you for your kind words..."
}

Response: 200 OK
{
  "success": true,
  "review": { ... },
  "message": "Response posted successfully"
}
```

**Get Dashboard Reviews**

```http
GET /api/supplier/dashboard/reviews
Authorization: Required (Supplier role)

Response: 200 OK
{
  "success": true,
  "summary": {
    "total": 50,
    "approved": 48,
    "pending": 1,
    "flagged": 1,
    "needsResponse": 5
  },
  "analytics": { ... },
  "recentReviews": [...],
  "needsResponseReviews": [...]
}
```

#### Admin Endpoints

**Get Flagged Reviews**

```http
GET /api/admin/reviews/flagged
Authorization: Required (Admin role)

Response: 200 OK
{
  "success": true,
  "count": 3,
  "reviews": [...]
}
```

**Moderate Review**

```http
POST /api/admin/reviews/:reviewId/moderate
Authorization: Required (Admin role)
Content-Type: application/json

{
  "action": "approve", // or "reject"
  "reason": "Legitimate customer review"
}

Response: 200 OK
{
  "success": true,
  "review": { ... },
  "message": "Review approved"
}
```

## Frontend Integration

### 1. Include Required Files

Add to your HTML `<head>`:

```html
<link rel="stylesheet" href="/assets/css/reviews.css" />
<script src="/assets/js/reviews.js" defer></script>
```

### 2. Add Review Widget

Include the widget HTML in your supplier page:

```html
<!-- Copy content from /public/components/review-widget.html -->
<div class="reviews-widget" id="reviews-widget">
  <!-- Widget content -->
</div>
```

### 3. Initialize JavaScript

```javascript
// Get supplier ID from URL or page data
const supplierId = 'sup_abc123';

// Get current user (if logged in)
const currentUser = {
  id: 'usr_xyz789',
  name: 'John Doe',
  role: 'customer',
};

// Initialize review system
if (window.reviewsManager) {
  reviewsManager.init(supplierId, currentUser);
}
```

### 4. Customization

The review system can be customized via CSS variables or by overriding the default styles in `reviews.css`.

## Anti-Abuse Strategy

### Rate Limiting

- **Per IP**: Maximum 5 reviews per hour
- **Per User/Supplier**: One review every 30 days
- **Enforced at**: API level with hashed IP tracking

### Spam Detection

The system automatically flags reviews that match any of these patterns:

1. **Spam Keywords**: URLs, promotional language, call-to-action phrases
2. **Competitor Domains**: Email addresses from known competitor domains
3. **New Account Pattern**: Accounts less than 1 day old giving 5-star reviews
4. **Temporal Clustering**: Multiple reviews for same supplier within 1 hour
5. **Suspicious Patterns**: Multiple 5-star reviews from new accounts

### Moderation Workflow

1. Review submitted by customer
2. Automatic spam detection runs
3. If flagged: Review goes to moderation queue
4. If clean: Review auto-approved and displayed
5. Admin reviews flagged content
6. Admin approves or rejects with reason
7. Moderation action logged in audit trail

## Trust Score Calculation

Trust score is calculated on a 0-100 scale:

```javascript
trustScore =
  averageRating * 15 + // Max 75 points
  min(totalReviews / 100, 1) * 10 + // Max 10 points for volume
  verifiedReviewRate * 10 + // Max 10 points for verification
  min(responseRate / 10, 5); // Max 5 points for responsiveness
```

## Badge System

> **Note:** There are two badge systems in EventFlow. The table below describes the **analytics-only badges** stored in `supplierAnalytics.badges` by `calculateSupplierAnalytics()` — these are **not** rendered as visible supplier-facing badges. They exist for internal metrics and potential future use. For the authoritative supplier-facing badge system (the one rendered on profiles), see [`docs/BADGE_AUDIT.md`](../BADGE_AUDIT.md#dual-badge-systems).

Analytics badges computed and stored in `supplierAnalytics`:

| Badge                 | Criteria                                         |
| --------------------- | ------------------------------------------------ |
| **Top Rated**         | 4.8+ stars AND 10+ reviews                       |
| **Responsive**        | <2 hour avg response time AND 80%+ response rate |
| **Highly Reviewed**   | 50+ reviews                                      |
| **Customer Favorite** | 4.7+ stars AND 100+ reviews                      |

## Security Considerations

### XSS Prevention

- All user input is sanitized server-side
- HTML escaped before rendering client-side
- Content Security Policy headers recommended

### CSRF Protection

- All POST requests require CSRF token
- Token included in request headers
- Validated server-side

### IP Hashing

- IP addresses are hashed using SHA-256
- Never stored in plain text
- Used only for rate limiting

### Data Privacy

- User names displayed, but can be pseudonymized
- Email addresses never displayed publicly
- GDPR-compliant data handling

## Mobile Responsiveness

The review system is fully responsive with breakpoints at:

- **768px**: Tablet layout adjustments
- **480px**: Mobile optimizations

Features:

- Touch-friendly buttons and controls
- Optimized modal for small screens
- Collapsible filters on mobile
- Readable typography across devices

## Accessibility

WCAG 2.1 AA compliant features:

- Semantic HTML structure
- ARIA labels for screen readers
- Keyboard navigation support
- Focus indicators
- Color contrast ratios meet standards
- Reduced motion support

## Performance

- **Lazy loading**: Reviews loaded on demand
- **Pagination**: Prevents large data transfers
- **Debounced filtering**: Reduces API calls
- **Cached analytics**: Trust scores pre-calculated
- **Indexed queries**: MongoDB indexes for fast lookups

## Testing

### Manual Testing Checklist

- [ ] Submit review (authenticated user)
- [ ] Submit review (unauthenticated - should redirect)
- [ ] Verify verified badge appears (with message history)
- [ ] Test rate limiting (try >5 reviews/hour)
- [ ] Test spam detection (URL in comment)
- [ ] Vote on review (helpful/unhelpful)
- [ ] Filter reviews by rating
- [ ] Sort reviews (date, rating, helpful)
- [ ] Pagination works correctly
- [ ] Supplier can respond to review
- [ ] Admin can moderate flagged reviews
- [ ] Mobile layout displays correctly
- [ ] Animations are smooth and performant

### Edge Cases

- Review with no comment (should fail - min 20 chars)
- Review with >2000 char comment (should fail)
- Rating <1 or >5 (should fail)
- Duplicate vote on same review (should fail)
- Non-verified supplier responding (should fail)

## Troubleshooting

### Reviews Not Loading

1. Check browser console for errors
2. Verify supplier ID is correctly passed
3. Confirm API endpoint is accessible
4. Check network tab for failed requests

### Modal Not Opening

1. Ensure user is authenticated
2. Check `reviewsManager` is loaded
3. Verify button ID matches
4. Check for JavaScript errors

### Votes Not Registering

1. Confirm CSRF token is present
2. Check if already voted (one vote per review)
3. Verify API endpoint is working
4. Check browser console for errors

## Future Enhancements

Potential additions for future versions:

- Photo gallery lightbox for review images
- Review threads/conversations
- Review sharing (social media)
- Review templates for common scenarios
- Multi-language support
- Sentiment analysis
- Review rewards/incentives program
- Review export (CSV/PDF)
- Advanced analytics dashboard
- Review reminders via email
- Video review attachments

## Support

For issues or questions:

- GitHub Issues: [Repository Issues](https://github.com/rhysllwydlewis/eventflow/issues)
- Email: support@eventflow.com
- Documentation: See repository README

## License

Part of the EventFlow project - see main LICENSE file.
