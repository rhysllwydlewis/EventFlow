# Security and Performance Features

This document describes the comprehensive security and performance improvements implemented in EventFlow.

## Table of Contents

- [Rate Limiting](#rate-limiting)
- [Input Validation](#input-validation)
- [Security Headers](#security-headers)
- [API Versioning](#api-versioning)
- [CSRF Protection](#csrf-protection)

## Rate Limiting

### Overview

Rate limiting protects the application from abuse, DoS attacks, and ensures fair resource usage across all users. Different endpoints have different rate limits based on their resource intensity and security requirements.

### Configuration

Rate limiters are configured in `middleware/rateLimits.js` with the following configurations:

#### Authentication Endpoints

- **Limiter**: `strictAuthLimiter`
- **Window**: 15 minutes
- **Max Requests**: 5
- **Applied To**: `POST /login`, `POST /login-2fa`
- **Purpose**: Tight brute-force and credential-stuffing protection on credential-submission endpoints

- **Limiter**: `passwordResetLimiter`
- **Window**: 15 minutes
- **Max Requests**: 5
- **Applied To**: `POST /forgot`, `POST /reset-password`, `POST /validate-reset-token`
- **Purpose**: Prevents reset-link spam and email-enumeration attacks

- **Limiter**: `authLimiter`
- **Window**: 15 minutes
- **Max Requests**: 10
- **Applied To**: Registration and other general auth endpoints
- **Purpose**: Prevents registration spam while keeping the experience smooth for legitimate users

```javascript
// Example usage
router.post('/login', strictAuthLimiter, async (req, res) => { ... });
router.post('/forgot', passwordResetLimiter, async (req, res) => { ... });
router.post('/register', authLimiter, async (req, res) => { ... });
```

#### AI/OpenAI Endpoints

- **Limiter**: `aiLimiter`
- **Window**: 1 hour
- **Max Requests**: 50
- **Applied To**: All AI-powered endpoints (`/api/v1/ai/*`)
- **Purpose**: Prevents excessive usage of expensive AI services

```javascript
// Example usage
router.post('/api/v1/ai/suggestions', aiLimiter, authRequired, async (req, res) => { ... });
```

#### File Upload Endpoints

- **Limiter**: `uploadLimiter`
- **Window**: 15 minutes
- **Max Requests**: 20
- **Applied To**: Photo and file upload endpoints
- **Purpose**: Prevents storage abuse and resource exhaustion

```javascript
// Example usage
router.post('/photos/upload', uploadLimiter, authRequired, async (req, res) => { ... });
```

#### Search/Discovery Endpoints

- **Limiter**: `searchLimiter`
- **Window**: 1 minute
- **Max Requests**: 30
- **Applied To**: Search and discovery endpoints
- **Purpose**: Prevents database overload from excessive searches

```javascript
// Example usage
router.get('/api/v1/discovery/trending', searchLimiter, async (req, res) => { ... });
router.get('/api/v1/search/suppliers', searchLimiter, async (req, res) => { ... });
```

#### Notification Endpoints

- **Limiter**: `notificationLimiter`
- **Window**: 5 minutes
- **Max Requests**: 50
- **Applied To**: All notification endpoints (`/api/v1/notifications/*`)
- **Purpose**: Prevents notification spam and API abuse

```javascript
// Example usage
router.get('/api/v1/notifications', notificationLimiter, authRequired, async (req, res) => { ... });
```

#### General API Endpoints

- **Limiter**: `apiLimiter`
- **Window**: 15 minutes
- **Max Requests**: 100
- **Applied To**: General API endpoints (can be applied globally)
- **Purpose**: Default protection for all API endpoints

### Rate Limit Headers

All rate-limited responses include standard rate limit headers:

```
RateLimit-Limit: 100
RateLimit-Remaining: 99
RateLimit-Reset: 1633036800
```

### Error Response

When rate limit is exceeded:

```json
{
  "error": "Too many requests, please try again later."
}
```

HTTP Status: `429 Too Many Requests`

---

## Input Validation

### Overview

Input validation is implemented using `express-validator` to ensure all user input is validated before processing. This prevents injection attacks, data corruption, and improves data quality.

### Configuration

Validation middleware is configured in `middleware/validation.js` with reusable validation chains.

### Available Validators

#### User Registration

```javascript
validateUserRegistration = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('username').trim().isLength({ min: 3 }).withMessage('Username must be at least 3 characters'),
  validate
];

// Usage
router.post('/register', validateUserRegistration, async (req, res) => { ... });
```

#### User Login

```javascript
validateUserLogin = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('password').notEmpty().withMessage('Password is required'),
  validate,
];
```

#### Password Reset

```javascript
validatePasswordResetRequest = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  validate,
];

validatePasswordReset = [
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('token').notEmpty().withMessage('Reset token is required'),
  validate,
];
```

#### Package Operations

```javascript
validatePackageCreation = [
  body('name').trim().notEmpty().withMessage('Package name is required'),
  body('description').optional().trim(),
  body('price').isNumeric().withMessage('Price must be a number'),
  body('supplierId').isMongoId().withMessage('Invalid supplier ID'),
  validate,
];

validatePackageUpdate = [
  param('id').isMongoId().withMessage('Invalid package ID'),
  body('name').optional().trim().notEmpty().withMessage('Package name cannot be empty'),
  body('description').optional().trim(),
  body('price').optional().isNumeric().withMessage('Price must be a number'),
  validate,
];
```

#### Review Submission

```javascript
validateReviewSubmission = [
  body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
  body('comment').optional().trim(),
  body('packageId').isMongoId().withMessage('Invalid package ID'),
  validate,
];
```

#### Search Queries

```javascript
validateSearch = [
  query('q').optional().trim().isLength({ max: 200 }).withMessage('Search query too long'),
  query('category').optional().trim(),
  query('location').optional().trim(),
  validate,
];
```

### Error Response

When validation fails:

```json
{
  "errors": [
    {
      "msg": "Valid email is required",
      "param": "email",
      "location": "body"
    }
  ]
}
```

HTTP Status: `400 Bad Request`

### Custom Validators

You can create custom validators using the exported methods:

```javascript
const { body, param, query, validate } = require('../middleware/validation');

const customValidator = [
  body('customField').custom(value => {
    if (!isValid(value)) {
      throw new Error('Custom validation failed');
    }
    return true;
  }),
  validate,
];
```

---

## Security Headers

### Overview

Security headers are configured using Helmet.js to protect against common web vulnerabilities.

### Configuration

Security headers are configured in `middleware/security.js`:

#### Content Security Policy (CSP)

Restricts resource loading to prevent XSS attacks:

```javascript
contentSecurityPolicy: {
  directives: {
    defaultSrc: ["'self'"],
    scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", ...],
    styleSrc: ["'self'", "'unsafe-inline'", "https://cdn.jsdelivr.net", ...],
    imgSrc: ["'self'", "data:", "https:", "blob:"],
    connectSrc: ["'self'", "https:", "wss:", "ws:"],
    frameSrc: ["'self'", "https://www.google.com", ...],
    frameAncestors: ["'none'"], // Clickjacking protection
    objectSrc: ["'none'"],
  }
}
```

#### HTTP Strict Transport Security (HSTS)

Forces HTTPS in production:

```javascript
hsts: {
  maxAge: 31536000, // 1 year
  includeSubDomains: true,
  preload: false
}
```

#### Other Security Headers

- **X-Frame-Options**: `DENY` - Prevents clickjacking
- **X-Content-Type-Options**: `nosniff` - Prevents MIME sniffing
- **X-DNS-Prefetch-Control**: `off` - Disables DNS prefetching
- **Referrer-Policy**: `strict-origin-when-cross-origin` - Controls referrer information
- **Permissions-Policy**: Restricts browser features (geolocation, camera, microphone)

### Header Examples

Example response headers:

```
Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' ...
Strict-Transport-Security: max-age=31536000; includeSubDomains
X-Frame-Options: DENY
X-Content-Type-Options: nosniff
X-DNS-Prefetch-Control: off
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: geolocation=(), camera=(), microphone=()
```

---

## API Versioning

### Overview

All API endpoints are now available with `/api/v1/` prefix to support future versioning without breaking existing clients. Backward compatibility is maintained with the original `/api/` paths.

### Versioned Endpoints

All routes are available in both formats:

- **New (v1)**: `/api/v1/...`
- **Legacy**: `/api/...` (backward compatible)

#### Examples

| Legacy Endpoint           | Versioned Endpoint           | Description         |
| ------------------------- | ---------------------------- | ------------------- |
| `/api/auth/login`         | `/api/v1/auth/login`         | User authentication |
| `/api/packages`           | `/api/v1/packages`           | Package listings    |
| `/api/suppliers`          | `/api/v1/suppliers`          | Supplier directory  |
| `/api/search/suppliers`   | `/api/v1/search/suppliers`   | Supplier search     |
| `/api/notifications`      | `/api/v1/notifications`      | User notifications  |
| `/api/ai/suggestions`     | `/api/v1/ai/suggestions`     | AI suggestions      |
| `/api/discovery/trending` | `/api/v1/discovery/trending` | Trending suppliers  |

### Version Headers

All API responses include version information:

```
X-API-Version: v1
```

### Migration Path

1. **Current State**: Both `/api/` and `/api/v1/` work
2. **Recommended**: Start using `/api/v1/` for new integrations
3. **Future**: `/api/` (legacy) paths may be deprecated in future versions with advance notice

### Version Detection

The API automatically detects the version from the request path:

```javascript
// Middleware automatically sets req.apiVersion
req.apiVersion = 'v1'; // For /api/v1/* requests
```

### Future Versions

When `/api/v2/` is introduced (some endpoints already use v2):

- `/api/v1/*` endpoints will remain stable
- Breaking changes will be introduced in `/api/v2/*`
- Deprecation warnings will be provided for old versions
- Migration guides will be published

---

## CSRF Protection

### Overview

CSRF (Cross-Site Request Forgery) protection is implemented for all state-changing operations (POST, PUT, PATCH, DELETE) to prevent unauthorized actions.

### How It Works

1. **Token Generation**: Server generates a unique CSRF token for each session
2. **Token Delivery**: Token is provided via `/api/csrf-token` endpoint
3. **Token Validation**: Token must be included in headers for protected requests

### Getting a CSRF Token

```javascript
// Request
GET /api/csrf-token

// Response
{
  "csrfToken": "unique-token-here"
}
```

### Using the CSRF Token

Include the token in the `X-CSRF-Token` header:

```javascript
fetch('/api/v1/packages', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-CSRF-Token': 'your-token-here',
  },
  body: JSON.stringify({ name: 'Wedding Package' }),
});
```

### Protected Routes

All state-changing operations require CSRF tokens:

- User authentication (login, register, password reset)
- Package/supplier CRUD operations
- Photo uploads
- Review submissions
- Notification management
- Admin operations

### Exempt Routes

The following routes are exempt from CSRF protection:

- **Webhooks** (Stripe, Postmark) - External services can't provide tokens
- **Public endpoints** (GET requests, newsletter subscriptions)
- **Health checks** (`/api/health`, `/api/ready`)

### Error Response

When CSRF token is missing or invalid:

```json
{
  "error": "Invalid CSRF token"
}
```

HTTP Status: `403 Forbidden`

---

## Environment-Specific Settings

### Development

- More relaxed rate limits
- Detailed error messages
- HSTS disabled
- CORS allows localhost

### Production

- Strict rate limits
- Generic error messages
- HSTS enabled (1 year)
- CORS restricted to configured domains
- CSP strictly enforced

---

## Testing Rate Limits

To test rate limiting:

1. Make multiple requests to a rate-limited endpoint
2. After exceeding the limit, you'll receive a 429 response
3. Check the `RateLimit-*` headers for details
4. Wait for the window to reset

Example:

```bash
# Test auth limiter (10 requests per 15 minutes)
for i in {1..11}; do
  curl -X POST https://event-flow.co.uk/api/v1/auth/login \
    -H "Content-Type: application/json" \
    -d '{"email":"test@example.com","password":"test123"}'
  echo ""
done

# The 11th request should return 429 Too Many Requests
```

---

## Monitoring

### Metrics to Monitor

1. **Rate Limit Hits**: Track how often users hit rate limits
2. **Validation Errors**: Monitor validation failure rates
3. **CSRF Failures**: Track invalid CSRF token attempts
4. **Response Times**: Monitor impact of security middleware on performance

### Logging

All security events are logged:

- Rate limit exceeded
- Validation failures
- CSRF token validation failures
- Suspicious activity patterns

---

## Best Practices

### For Developers

1. Always use validation middleware for user input
2. Apply appropriate rate limiters to new endpoints
3. Test with CSRF protection enabled
4. Use versioned API paths (`/api/v1/`) for new code
5. Keep security dependencies updated

### For API Consumers

1. Store CSRF tokens securely
2. Refresh tokens when they expire
3. Handle 429 responses gracefully (implement backoff)
4. Use versioned endpoints (`/api/v1/`)
5. Check rate limit headers to avoid hitting limits

---

## Security Checklist

- [x] Rate limiting implemented on all critical endpoints
- [x] Input validation on all data-accepting endpoints
- [x] CSRF protection on all state-changing operations
- [x] Security headers configured (Helmet.js)
- [x] API versioning implemented with backward compatibility
- [x] Environment-specific security settings
- [x] Comprehensive error handling
- [x] Security event logging

---

## Additional Resources

- [CSRF Testing Guide](./CSRF_TESTING_GUIDE.md)
- [Token Security](./TOKEN_SECURITY.md)
- [Production Deployment Checklist](./PRODUCTION_DEPLOYMENT_CHECKLIST.md)
- [Production Readiness Summary](./PRODUCTION_READINESS_SUMMARY.md)
