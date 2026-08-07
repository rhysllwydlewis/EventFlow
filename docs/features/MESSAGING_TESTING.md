# Messaging System Testing Guide

## Overview

This guide covers testing procedures for the EventFlow messaging system features including offline queue, search, editing, moderation, and advanced features.

---

## Prerequisites

### Environment Setup

```bash
# Install dependencies
npm install

# Run database migration
node scripts/migrate-messaging-features.js

# Start server
npm run dev
```

### Test Users

Create test users with different roles:

- Customer user: `customer@test.com`
- Supplier user: `supplier@test.com`
- Admin user: `admin@event-flow.co.uk`

---

## Manual Testing Checklist

### ✅ Offline Message Queue

**Test Scenario:** Send messages while offline

1. Open browser DevTools → Network tab
2. Set network to "Offline"
3. Send a message
4. Verify message shows "sending..." status
5. Set network back to "Online"
6. Verify message sends automatically
7. Check `localStorage` for queued messages

**Expected Results:**

- Message queued in localStorage
- Visual "sending" indicator
- Auto-retry on reconnect
- Message delivered within 2 seconds

**API Tests:**

```bash
# Add to queue
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message":{"threadId":"123","content":"Test"}}' \
  http://localhost:3000/api/v2/messages/queue

# Get queue
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/v2/messages/queue

# Retry failed
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/v2/messages/queue/$QUEUE_ID/retry

# Delete from queue
curl -X DELETE -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/v2/messages/queue/$QUEUE_ID
```

### ✅ Message Search

**Test Scenario:** Search message content

1. Send messages with unique keywords
2. Use search bar
3. Type search query
4. Verify results appear
5. Test filters (participant, date range, attachments)

**Expected Results:**

- Results appear within 200ms
- Matched terms highlighted
- Pagination works correctly
- Filters apply correctly

**API Tests:**

```bash
# Basic search
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/v2/messages/search?q=meeting"

# Search with filters
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3000/api/v2/messages/search?q=urgent&participant=$USER_ID&startDate=2026-01-01&hasAttachments=true&page=1&limit=20"

# Expected response format
{
  "results": [...],
  "total": 42,
  "page": 1,
  "hasMore": true
}
```

### ✅ Message Editing

**Test Scenario:** Edit sent messages

1. Send a message
2. Hover over message (should show edit button)
3. Click edit button
4. Modify text
5. Press Enter to save
6. Verify "(edited)" badge appears
7. Click badge to view edit history

**Time Window Test:**

1. Send a message
2. Wait 16 minutes
3. Try to edit
4. Verify error: "Can only edit within 15 minutes"

**Expected Results:**

- Edit saves within 100ms
- Real-time update for all participants
- Edit history preserved
- Time limit enforced

**API Tests:**

```bash
# Edit message
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"content":"Updated message text"}' \
  http://localhost:3000/api/v2/messages/$MESSAGE_ID/edit

# Get edit history
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/v2/messages/$MESSAGE_ID/history

# Expected response
{
  "history": [
    {"content": "Original text", "editedAt": "2026-02-11T10:30:00Z"}
  ],
  "currentContent": "Updated message text",
  "editedAt": "2026-02-11T10:35:00Z"
}
```

### ✅ User Blocking

**Test Scenario:** Block unwanted users

1. Open user profile or message menu
2. Click "Block User"
3. Confirm blocking
4. Verify messages from blocked user are hidden
5. Try to send message to blocked user (should fail)
6. Unblock user
7. Verify messages reappear

**Expected Results:**

- Block takes effect immediately
- Existing threads remain accessible
- Cannot receive new messages from blocked user
- Unblock restores normal messaging

**API Tests:**

```bash
# Block user
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason":"Spam messages"}' \
  http://localhost:3000/api/v2/users/$USER_ID/block

# Get blocked users
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/v2/users/blocked

# Unblock user
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/v2/users/$USER_ID/unblock
```

### ✅ Message Reporting

**Test Scenario:** Report inappropriate content

1. Click three-dot menu on message
2. Select "Report"
3. Choose reason (spam, harassment, etc.)
4. Add optional details
5. Submit report
6. Verify confirmation message

**Admin Test:**

1. Log in as admin
2. Navigate to `/admin/moderation`
3. View reported messages
4. Filter by status/reason
5. Review report and take action
6. Update status to "reviewed"

**API Tests:**

```bash
# Report message
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason":"spam","details":"Promotional content"}' \
  http://localhost:3000/api/v2/messages/$MESSAGE_ID/report

# Admin: Get reports
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  "http://localhost:3000/api/v2/admin/reports?status=pending"

# Admin: Update report
curl -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"status":"reviewed","reviewNotes":"Confirmed spam"}' \
  http://localhost:3000/api/v2/admin/reports/$REPORT_ID
```

### ✅ Thread Pinning

**Test Scenario:** Pin important conversations

1. Open thread list
2. Click pin icon on thread
3. Verify thread moves to top
4. Try to pin 11th thread (should fail)
5. Unpin a thread
6. Verify it returns to normal position

**Expected Results:**

- Max 10 pinned threads enforced
- Pinned threads sort by lastMessageAt
- Pin persists across page refreshes
- Per-user pinning (doesn't affect other participants)

**API Tests:**

```bash
# Pin thread
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/v2/threads/$THREAD_ID/pin

# Unpin thread
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/v2/threads/$THREAD_ID/unpin
```

### ✅ Thread Muting

**Test Scenario:** Mute noisy threads

1. Click mute icon on thread
2. Select duration (1h, 8h, 1d, forever)
3. Verify mute icon appears
4. Send message in thread (no notification should appear)
5. Unmute thread
6. Verify notifications resume

**Expected Results:**

- No notifications while muted
- Visual muted indicator
- Mute expires after duration
- Forever mute requires manual unmute

**API Tests:**

```bash
# Mute thread
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"duration":"8h"}' \
  http://localhost:3000/api/v2/threads/$THREAD_ID/mute

# Unmute thread
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/v2/threads/$THREAD_ID/unmute
```

### ✅ Message Forwarding

**Test Scenario:** Forward messages to new recipients

1. Click forward button on message
2. Select recipients (can select multiple)
3. Add optional note
4. Send
5. Verify forwarded messages appear in recipient threads
6. Check "Forwarded from [user]" header

**Expected Results:**

- Multiple recipients supported
- Original attachments included
- Forwarding header visible
- New thread created if needed

**API Tests:**

```bash
# Forward message
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"recipientIds":["user123","user456"],"note":"FYI"}' \
  http://localhost:3000/api/v2/messages/$MESSAGE_ID/forward
```

### ✅ Link Previews

**Test Scenario:** Generate preview cards for URLs

1. Paste URL in message input
2. Wait for preview to load
3. Verify preview card shows (title, description, image)
4. Option to remove preview before sending
5. Send message
6. Verify preview renders in sent message

**Expected Results:**

- Preview loads within 2 seconds
- Graceful fallback if fetch fails
- Preview cached for 30 days
- Lazy-load images

**API Tests:**

```bash
# Generate link preview
curl -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://github.com"}' \
  http://localhost:3000/api/v2/messages/preview-link

# Expected response
{
  "url": "https://github.com",
  "title": "GitHub: Let's build from here",
  "description": "GitHub is where over 100 million developers...",
  "image": "https://github.githubassets.com/images/modules/open_graph/github-mark.png",
  "siteName": "GitHub"
}
```

### ✅ Spam Detection

**Test Scenario:** Verify spam prevention

**Rate Limit Test:**

1. Send 31 messages rapidly
2. Verify 31st message is rejected
3. Wait 1 minute
4. Verify rate limit resets

**Duplicate Test:**

1. Send message "Test 123"
2. Send same message within 5 seconds
3. Verify second message rejected

**URL Spam Test:**

1. Send message with 6+ URLs
2. Verify warning or rejection

**Keyword Test:**

1. Configure spam keywords in `.env`
2. Send message with spam keyword
3. Verify rejection or flagging

**API Tests:**

```bash
# Test rate limit (send 31 messages)
for i in {1..31}; do
  curl -X POST -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"threadId\":\"$THREAD_ID\",\"content\":\"Message $i\"}" \
    http://localhost:3000/api/v2/messages
done

# Expected: 31st message returns 429 Too Many Requests
```

### ✅ Content Sanitization

**Test Scenario:** Verify XSS protection

1. Send message with HTML: `<script>alert('xss')</script>`
2. Verify script is stripped
3. Send message with safe HTML: `<b>bold</b>`
4. Verify bold formatting preserved

**Expected Results:**

- Malicious scripts removed
- Safe formatting preserved
- Links sanitized with rel="noopener"
- Event handlers stripped

---

## Automated Testing

### Unit Tests

```bash
# Run unit tests
npm run test:unit

# Test spam detection
npm test -- services/spamDetection.test.js

# Test content sanitizer
npm test -- services/contentSanitizer.test.js
```

### Integration Tests

```bash
# Run integration tests
npm run test:integration

# Test messaging endpoints
npm test -- tests/integration/messaging-v2.test.js
```

### E2E Tests (Playwright)

```bash
# Run E2E tests
npm run test:e2e

# Run specific test
npx playwright test tests/e2e/messaging-features.spec.js

# Run in headed mode
npx playwright test --headed
```

### Load Testing (Artillery)

```bash
# Run load test
npm run load-test

# Generate report
npm run load-test:report
```

**Load Test Scenarios:**

- 100 concurrent users sending messages
- 50 users uploading files
- 500 WebSocket connections
- 1000 searches per minute

**Success Criteria:**

- 95th percentile response time < 500ms
- WebSocket reconnect time < 2s
- Zero message loss under load

---

## Performance Benchmarks

### Message Search

- **Target:** < 200ms for 10,000+ messages
- **Test:** Run search with 10,000 messages in database
- **Command:** `time curl "http://localhost:3000/api/v2/messages/search?q=test"`

### Message Queue Retry

- **Target:** 2s, 4s, 8s, 16s, 30s intervals
- **Test:** Queue message and observe retry attempts
- **Verify:** Check `nextRetry` timestamp in database

### Link Preview Cache

- **Target:** 30-day TTL
- **Test:** Fetch same URL twice
- **Verify:** Second fetch returns cached result (< 10ms)

### Spam Detection

- **Target:** < 1ms per check
- **Test:** Check 1000 messages for spam
- **Command:** Run unit test with performance measurement

---

## Troubleshooting

### Search Not Working

**Problem:** Text search returns no results

**Debug Steps:**

1. Check if text index exists:
   ```bash
   mongo eventflow --eval "db.messages.getIndexes()"
   ```
2. Verify messages have content
3. Re-run migration
4. Check MongoDB logs

### Rate Limiting Issues

**Problem:** Users getting rate limited incorrectly

**Debug Steps:**

1. Check `MAX_MESSAGES_PER_MINUTE` in `.env`
2. Clear rate limit cache (restart server)
3. Check system clock (time sync issues)
4. Review Sentry logs

### Link Previews Failing

**Problem:** Link preview endpoint returns errors

**Debug Steps:**

1. Test URL directly: `curl -I https://example.com`
2. Check firewall rules
3. Verify DNS resolution
4. Check link-preview-js logs
5. Test with simple URL (github.com)

### Database Migration Errors

**Problem:** Migration script fails

**Debug Steps:**

1. Check MongoDB connection string
2. Verify database permissions
3. Check for existing indexes
4. Run with verbose logging
5. Manual index creation

---

## CI/CD Integration

### GitHub Actions

```yaml
name: Messaging Tests

on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      mongodb:
        image: mongo:6
        ports:
          - 27017:27017

    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v4
        with:
          node-version-file: '.node-version'

      - name: Install dependencies
        run: npm ci

      - name: Run migration
        run: node scripts/migrate-messaging-features.js
        env:
          MONGODB_LOCAL_URI: mongodb://localhost:27017/eventflow-test

      - name: Run unit tests
        run: npm run test:unit

      - name: Run E2E tests
        run: npm run test:e2e

      - name: Run load tests
        run: npm run load-test
```

---

## Monitoring & Alerts

### Sentry Error Tracking

Key events to monitor:

- Message send failures after max retries
- WebSocket connection failures
- Search query timeouts
- Edit conflicts
- Rate limit violations
- Spam detection triggers

### Metrics to Track

- Message delivery rate (target: > 99.9%)
- Search response time (target: < 200ms)
- WebSocket reconnect time (target: < 2s)
- Queue retry success rate (target: > 95%)
- Spam detection accuracy (target: > 90%)

---

## Test Data Setup

### Create Test Messages

```javascript
// scripts/seed-test-messages.js
const { MongoClient } = require('mongodb');
const Message = require('./models/Message');

async function seed() {
  const client = await MongoClient.connect(process.env.MONGODB_URI);
  const db = client.db('eventflow');

  // Create 1000 test messages
  for (let i = 0; i < 1000; i++) {
    const message = Message.createMessage({
      threadId: 'test-thread-1',
      senderId: 'user1',
      recipientIds: ['user2'],
      content: `Test message ${i} with searchable keywords like meeting, urgent, deadline`,
    });

    await db.collection('messages').insertOne(message);
  }

  console.log('✅ Seeded 1000 test messages');
  await client.close();
}

seed();
```

### Run Seed Script

```bash
node scripts/seed-test-messages.js
```

---

## Manual QA Checklist

Before each release, verify:

- [ ] Offline queue persists across page refresh
- [ ] Search returns relevant results within 200ms
- [ ] Message editing works within 15-minute window
- [ ] Edit history shows all versions
- [ ] User blocking hides messages immediately
- [ ] Message reports reach admin dashboard
- [ ] Thread pinning enforces max limit (10)
- [ ] Thread muting stops notifications
- [ ] Message forwarding includes attachments
- [ ] Link previews cache for 30 days
- [ ] Rate limiting enforced (30/min)
- [ ] Duplicate detection works (5s window)
- [ ] Content sanitization strips XSS
- [ ] WebSocket reconnects automatically
- [ ] All 24 new endpoints return correct responses
- [ ] Database migration runs without errors
- [ ] No regressions in existing features

---

## Contact & Support

For testing issues or questions:

- Create GitHub issue with `[Testing]` label
- Include error logs and reproduction steps
- Tag @rhysllwydlewis for urgent issues

**Last Updated:** Feb 2026  
**Version:** 2.0  
**Maintainer:** EventFlow Development Team
