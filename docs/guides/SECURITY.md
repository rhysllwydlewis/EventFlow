# Security Summary

## Overview

This document outlines security considerations, current protections, and recommended improvements for the EventFlow platform.

## Current Security Measures

### ✅ Implemented

1. **Authentication & Authorization**
   - JWT-based authentication with HTTP-only cookies
   - Role-based access control (customer, supplier, admin)
   - Secure password hashing with bcryptjs
   - Email verification for new accounts
   - Password reset with time-limited tokens

2. **Rate Limiting**
   - Authentication endpoints: 100 requests per 15 minutes
   - Write operations: 80 requests per 10 minutes
   - Prevents brute force attacks and abuse

3. **Input Validation**
   - Email validation using validator.js
   - File type and size validation for uploads
   - Content sanitization for user inputs

4. **File Upload Security**
   - Strict MIME type validation (images only)
   - File size limits (10MB max)
   - Separate upload directories
   - Admin approval workflow for photos

5. **HTTP Security Headers**
   - Helmet.js for security headers
   - X-Powered-By header disabled
   - Content Security Policy configured

6. **URL Validation**
   - S3 URL validation with strict regex patterns
   - Prevents URL manipulation attacks

7. **Database Security**
   - MongoDB schema validation
   - Prepared statements (no SQL injection risk)
   - Connection pooling with proper error handling

## ⚠️ Known Security Considerations

### 1. Known Vulnerabilities

#### xlsx Package (v0.18.5)

- **Severity:** High
- **Issues:**
  - Prototype Pollution (GHSA-4r6h-8v6p-xvw6)
  - Regular Expression Denial of Service - ReDoS (GHSA-5pgg-2g8v-p4x9)
- **Risk Assessment:** LOW
- **Reasoning:**
  - Used only by authenticated admin users for data export
  - Input is sanitized before processing
  - No user-controlled data is processed
  - Admin authentication required (role-based access control)
- **Mitigation:**
  - No fix currently available from package maintainer
  - Usage restricted to admin-only endpoints
  - Input validation and sanitization in place
- **Future Action:** Consider replacing with safer alternative when available

### 2. CSRF Protection

**Status:** Implemented (Double-Submit Cookie pattern)
**Risk Level:** Low
**Description:** All state-changing admin and API operations are protected with CSRF tokens using the Double-Submit Cookie pattern.

**Implementation:**

- Two cookies are set: `csrf` and `csrfToken` (non-HttpOnly so client JS can read them)
- Client reads the cookie value and sends it as the `X-CSRF-Token` request header
- Server validates that the header value matches the cookie value
- Admin frontend uses `AdminShared.api()` which automatically attaches the CSRF token for POST/PUT/DELETE requests

**Client-side pattern (via `AdminShared.api()`):**

```javascript
// AdminShared.api() handles CSRF automatically for write operations:
await AdminShared.api('/api/admin/packages/123/approve', 'POST');

// For custom fetch calls, read the token from the cookie:
function getCsrfToken() {
  const match = document.cookie.match(/(?:^|;\s*)csrfToken=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : window.__CSRF_TOKEN__ || window.csrfToken || '';
}
fetch('/api/...', {
  method: 'POST',
  headers: { 'X-CSRF-Token': getCsrfToken() },
  credentials: 'include',
});
```

**Server-side middleware:** `middleware/csrf.js` — `csrfProtection()` function validates the `X-CSRF-Token` header against the cookie value.

### 3. Two-Factor Authentication

**Status:** Not implemented  
**Risk Level:** Medium  
**Description:** No 2FA available for additional account security.

**Recommended Implementation:**

- Add TOTP support using speakeasy
- SMS verification using Twilio
- Backup codes for account recovery

### 4. Data Encryption at Rest

**Status:** Not implemented (relies on MongoDB Atlas)  
**Risk Level:** Low (if using Atlas with encryption)  
**Description:** Sensitive data is not encrypted before storage.

**Mitigation:**

- Use MongoDB Atlas with encryption at rest enabled
- For self-hosted: Enable MongoDB encryption
- Never store plain text passwords (using bcrypt)

### 5. API Versioning

**Status:** Not implemented  
**Risk Level:** Low  
**Description:** No API versioning strategy for backward compatibility.

**Recommended:**

```javascript
app.use('/api/v1', routes);
app.use('/api/v2', routesV2);
```

## 🔒 Security Best Practices

### For Deployment

1. **Environment Variables**
   - Never commit `.env` file
   - Use strong, random JWT_SECRET (32+ characters)
   - Rotate secrets regularly
   - Use different secrets for dev/staging/production

2. **HTTPS Enforcement**

   ```nginx
   # Force HTTPS redirect
   server {
       listen 80;
       return 301 https://$host$request_uri;
   }
   ```

3. **MongoDB Security**
   - Enable authentication
   - Use strong passwords
   - Whitelist IP addresses
   - Enable audit logging
   - Regular backups

4. **AWS S3 Security**
   - Use IAM roles instead of access keys when possible
   - Restrict bucket policy to minimum required permissions
   - Enable versioning for accidental deletions
   - Enable server-side encryption

5. **Monitoring & Logging**
   - Monitor failed login attempts
   - Track suspicious activity patterns
   - Log all admin actions
   - Set up alerts for anomalies

### For Development

1. **Dependency Security**

   ```bash
   # Regular security audits
   npm audit
   npm audit fix

   # Check for vulnerabilities
   npm install -g snyk
   snyk test
   ```

2. **Code Review**
   - Review all code changes
   - Use automated security scanning (CodeQL)
   - Follow secure coding guidelines

3. **Testing**
   - Test authentication flows
   - Test authorization checks
   - Test input validation
   - Test file upload restrictions

## 🚨 Incident Response

### If a security breach is suspected:

1. **Immediately:**
   - Disable affected accounts
   - Change all secrets and credentials
   - Review access logs

2. **Investigate:**
   - Identify affected users/data
   - Determine attack vector
   - Document timeline

3. **Remediate:**
   - Patch vulnerabilities
   - Reset passwords for affected users
   - Notify affected users (if required by law)

4. **Prevent:**
   - Implement additional security measures
   - Update documentation
   - Review security practices

## 📋 Security Checklist for Production

- [ ] Set strong `JWT_SECRET` (32+ random characters)
- [ ] Enable HTTPS with valid SSL certificate
- [ ] Configure MongoDB authentication
- [ ] Whitelist IP addresses for database access
- [ ] Enable rate limiting (✅ already configured)
- [ ] Set up monitoring and alerting
- [ ] Regular security audits with `npm audit`
- [ ] Regular backups of database
- [ ] Document incident response plan
- [ ] Review and update security regularly
- [ ] Consider implementing CSRF protection
- [ ] Consider adding 2FA for admin accounts
- [ ] Enable MongoDB encryption at rest
- [ ] Use environment-specific secrets
- [ ] Implement API versioning

## 🔐 Compliance Considerations

### GDPR (if applicable)

- [ ] Implement user data export functionality
- [ ] Implement user data deletion functionality
- [ ] Add privacy policy acceptance tracking
- [ ] Implement cookie consent
- [ ] Document data processing activities
- [ ] Appoint Data Protection Officer (if required)

### PCI DSS (if handling payments)

- [ ] Never store full credit card numbers
- [ ] Use Stripe.js for PCI-compliant payment handling
- [ ] Implement additional security measures as required

## 📞 Security Contact

For security issues or vulnerabilities:

- Email: security@eventflow.com
- Report privately via GitHub Security Advisories
- DO NOT create public issues for security vulnerabilities

## Version History

- **v1.2** (2026-03-17): Error detail disclosure fixed
  - **Fixed (Medium):** 117 route handler catch blocks across 21 files that included `details: error.message` in `500` JSON responses now guard the value behind `process.env.NODE_ENV !== 'production' ? error.message : undefined`. When `NODE_ENV=production` the `details` key is omitted from the JSON response entirely (JSON.stringify drops `undefined` values), preventing internal error messages (file paths, MongoDB field names, stack details) from leaking to clients.
  - **Added:** Regression tests in `tests/unit/security-regression.test.js` (section D) to prevent reintroduction — any new route file that exposes `details: error.message` without a `NODE_ENV` guard will cause CI to fail.

- **v1.1** (2026-03-17): Critical security fixes applied
  - **Fixed (Critical):** `store.js` and `db-utils.js` `uid()` replaced `Math.random()` with `crypto.randomBytes()`. Previously, all entity IDs including password reset tokens, email verification tokens, and guest plan tokens were generated using `Math.random()`, which is not cryptographically secure and could allow an attacker to predict or brute-force token values.
  - **Fixed (Medium):** `services/dateManagementService.js` replaced `execSync` (shell command string) with `spawnSync` (argument array). The previous implementation invoked a shell to run `git log`, which could be exploited for shell injection if the input validation regex were ever bypassed. Using `spawnSync` with an explicit argument array eliminates shell interpretation entirely.
  - **Fixed (Medium):** Upload file naming in `routes/admin.js` (hero image and collage upload) replaced `Math.random()` with `crypto.randomBytes()` to prevent guessable file names.
  - **Fixed (Low):** Various non-security-critical IDs (request IDs, enquiry IDs, history entry IDs, category IDs) updated to use `crypto.randomBytes()` or `crypto.randomUUID()` for consistency.

- **v1.0** (2024-12-09): Initial security documentation
  - Documented current security measures
  - Identified CSRF protection gap
  - Recommended improvements
