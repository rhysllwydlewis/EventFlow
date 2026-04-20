# EventFlow Messaging System - Complete Rebuild Plan

**Date**: February 19, 2026 (last status refresh: April 2026)  
**Status**: Shipped — production-grade (PR #949, #950, post-audit closure)  
**Version**: Messenger v4 (Gold Standard)

---

## Table of Contents

1. [Executive Summary](#executive-summary)
2. [Architecture Overview](#architecture-overview)
3. [UX Design Principles](#ux-design-principles)
4. [Phased Rollout Strategy](#phased-rollout-strategy)
5. [Technical Implementation](#technical-implementation)
6. [Security & Performance](#security--performance)
7. [Testing Strategy](#testing-strategy)
8. [Migration Plan](#migration-plan)
9. [Success Metrics](#success-metrics)

---

## Executive Summary

### Vision

Build a **gold-standard, purpose-built messaging & inbox system** that:

- Enables seamless user-to-user communication (customers, suppliers, admins)
- Provides contextual conversations from marketplace, supplier profiles, and packages
- Delivers real-time updates with typing indicators, read receipts, and presence
- Offers a polished, liquid-glass UI with smooth animations
- Scales efficiently with robust security and spam prevention

### Current State

- ✅ **Backend**: production (v4 API, service layer, `conversations_v4` / `chat_messages_v4`, WebSocket, BullMQ queue, replica-set-gated transactions)
- ✅ **Design**: production (liquid glass CSS, animations, polish)
- ✅ **Frontend**: production (orchestrator, reconciliation FSM, read-by modal, context banner, virtual list, quick compose, contact picker)
- ✅ **Integration**: production (supplier/package/marketplace entry points use canonical context types; admin console; redirects from legacy `/messages`)
- ✅ **Deployment**: Procfile `web` + `worker`; `railway.json` for the web service and `railway.worker.json` for the queue worker; `docker-compose.yml` includes Redis + worker; preflight rejects production boots without `REDIS_URL`.

### Post-audit closure (PR #950 follow-ups)

The cross-cutting audit after PR #950 identified and this workstream closed:

- Conversation `type` vs `context.type` mapping in `MessengerAppV4.createConversation` + deep links (`MessengerAppV4._resolveTypeAndContext`).
- Canonical context schema (`referenceId`/`referenceTitle`) everywhere (QuickCompose, admin search, ContextBannerV4).
- Per-message delivered socket event (`messenger:v4:message-delivered`) wired from server → socket client → orchestrator → UI tick.
- Delivery-receipt batch drain (queues larger than 50 no longer stranded).
- Reconciliation catch-up safety (explicit `MAX_CATCHUP_PAGES` with telemetry on hit).
- Read-observer MutationObserver lifecycle (tracked and disconnected on `destroy`).
- Deployment topology made explicit (worker in Procfile, Railway worker template, docker-compose Redis + worker service).
- Preflight now hard-fails on missing `REDIS_URL` in production so misconfigured deploys never serve traffic with a broken async pipeline.

---

## Architecture Overview

### System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend Layer                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │  Main App    │  │  Dashboard   │  │   Entry      │    │
│  │  /messenger/ │  │   Widgets    │  │   Points     │    │
│  │              │  │              │  │              │    │
│  │ • Chat View  │  │ • Customer   │  │ • Supplier   │    │
│  │ • Conv List  │  │ • Supplier   │  │   Profile    │    │
│  │ • Composer   │  │              │  │ • Package    │    │
│  │              │  │              │  │ • Marketplace│    │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘    │
│         │                 │                 │            │
│         └─────────────────┼─────────────────┘            │
│                           │                              │
│         ┌─────────────────┴─────────────────┐            │
│         │                                   │            │
│    ┌────▼────┐  ┌──────────┐  ┌───────────▼──┐          │
│    │   API   │  │  State   │  │  WebSocket   │          │
│    │ Client  │  │ Manager  │  │   Client     │          │
│    └────┬────┘  └────┬─────┘  └───────┬──────┘          │
│         │            │                │                  │
└─────────┼────────────┼────────────────┼──────────────────┘
          │            │                │
          │            │                │
┌─────────┼────────────┼────────────────┼──────────────────┐
│         │            │                │   Backend Layer  │
├─────────▼────────────▼────────────────▼──────────────────┤
│                                                           │
│  ┌──────────────────────────────────────────────────┐   │
│  │              API Routes                          │   │
│  │         /api/v4/messenger/                       │   │
│  │                                                   │   │
│  │ • POST /conversations          (create)          │   │
│  │ • GET  /conversations          (list)            │   │
│  │ • POST /conversations/:id/messages (send)        │   │
│  │ • GET  /conversations/:id/messages (history)     │   │
│  │ • POST /conversations/:id/read (mark read)       │   │
│  │ • POST /messages/:id/reactions (react)           │   │
│  │ • GET  /unread-count          (badge)            │   │
│  │ • GET  /contacts              (search users)     │   │
│  │                                                   │   │
│  └───────────────────┬──────────────────────────────┘   │
│                      │                                   │
│  ┌───────────────────▼──────────────────────────────┐   │
│  │         Messenger v4 Service Layer               │   │
│  │                                                   │   │
│  │ • Conversation CRUD + deduplication              │   │
│  │ • Message sending + editing                      │   │
│  │ • Content sanitization (DOMPurify)               │   │
│  │ • Spam detection + rate limiting                 │   │
│  │ • Read receipts + reactions                      │   │
│  │ • Typing indicators + presence                   │   │
│  │ • Full-text search (MongoDB indexes)             │   │
│  │ • Contact discovery                              │   │
│  │                                                   │   │
│  └───────────────────┬──────────────────────────────┘   │
│                      │                                   │
│  ┌───────────────────▼──────────────────────────────┐   │
│  │            WebSocket Server                      │   │
│  │          (Socket.IO with Redis)                  │   │
│  │                                                   │   │
│  │ Events: message, typing, read, reaction,         │   │
│  │         presence, conversation-updated           │   │
│  │                                                   │   │
│  └───────────────────┬──────────────────────────────┘   │
│                      │                                   │
│  ┌───────────────────▼──────────────────────────────┐   │
│  │              MongoDB Database                    │   │
│  │                                                   │   │
│  │ • conversations_v4  (conversation metadata)      │   │
│  │ • chat_messages_v4  (all messages)               │   │
│  │ • users             (participant info)           │   │
│  │                                                   │   │
│  │ Indexes: 13 total (7 conversations + 6 messages) │   │
│  │                                                   │   │
│  └──────────────────────────────────────────────────┘   │
│                                                           │
└───────────────────────────────────────────────────────────┘
```

### Data Flow

**1. User Sends Message**

```
User types → Composer → API Client → POST /conversations/:id/messages
                                   ↓
                            Service Layer validates
                                   ↓
                          Spam detection check
                                   ↓
                          Content sanitization
                                   ↓
                            Save to MongoDB
                                   ↓
                       Emit WebSocket event
                                   ↓
                    All participants receive
                                   ↓
                        Update UI in real-time
```

**2. Typing Indicator**

```
User typing → Debounced (1s) → POST /conversations/:id/typing
                                           ↓
                                WebSocket broadcast
                                           ↓
                           Other users see indicator
                                           ↓
                            Clears after 3 seconds
```

**3. Read Receipt**

```
User opens conversation → POST /conversations/:id/read
                                      ↓
                            Update readBy array
                                      ↓
                            Emit WebSocket event
                                      ↓
                          Sender sees "Read" status
```

### Component Hierarchy

```
MessengerApp (main orchestrator)
├── ConversationList (sidebar)
│   ├── ConversationItem (each conversation)
│   │   ├── Avatar (user photo)
│   │   ├── LastMessage (preview)
│   │   ├── UnreadBadge (count)
│   │   └── Timestamp
│   └── NewConversationButton
│
├── ChatView (main content area)
│   ├── ContextBanner (package/supplier info)
│   ├── MessageList (scrollable history)
│   │   └── MessageBubble (each message)
│   │       ├── Avatar
│   │       ├── Content (sanitized HTML)
│   │       ├── Attachments (images/docs)
│   │       ├── Reactions (emoji bar)
│   │       ├── ReadReceipts ("Read by...")
│   │       └── Timestamp
│   ├── TypingIndicator ("User is typing...")
│   └── MessageComposer (input area)
│       ├── TextInput (contenteditable)
│       ├── EmojiPicker (emoji selector)
│       ├── AttachmentButton (file upload)
│       └── SendButton
│
└── ContactPicker (new conversation modal)
    ├── SearchInput
    ├── UserList
    │   └── UserItem (each user)
    │       ├── Avatar
    │       ├── Name + Role
    │       └── PresenceIndicator
    └── ContextSelector (link to package/etc)
```

---

## UX Design Principles

### Visual Design: Liquid Glass Theme

**Core Aesthetic**:

- **Frosted glass backgrounds** with `backdrop-filter: blur(20px)`
- **Teal gradient accents** (#0B8073 → #14B8A6)
- **Smooth animations** (300ms ease-in-out)
- **Rounded corners** (8px-16px border-radius)
- **Subtle shadows** for depth
- **White/light gray text** on semi-transparent cards

**Component Styling**:

```css
/* Conversation List (sidebar) */
.messenger-v4__sidebar {
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(20px);
  border-right: 1px solid rgba(0, 0, 0, 0.1);
}

/* Message Bubble (sent) */
.messenger-v4__message--sent {
  background: linear-gradient(135deg, #0b8073 0%, #14b8a6 100%);
  color: white;
  margin-left: auto;
  border-radius: 16px 16px 4px 16px;
}

/* Message Bubble (received) */
.messenger-v4__message--received {
  background: rgba(255, 255, 255, 0.9);
  color: #1a1a1a;
  margin-right: auto;
  border-radius: 16px 16px 16px 4px;
}

/* Unread Badge */
.messenger-v4__unread-badge {
  background: #dc2626;
  color: white;
  border-radius: 12px;
  animation: pulse 2s infinite;
}
```

### Responsive Behavior

**Desktop (>1024px)**: 3-column layout

```
┌──────────────┬──────────────────────┬──────────────┐
│ Conversation │    Chat View         │   Context    │
│    List      │                      │   Panel      │
│  (300px)     │     (flex-1)         │   (280px)    │
│              │                      │              │
│ [Convos...]  │ [Messages...]        │ [Package...] │
│              │                      │              │
│ [Search]     │ [Composer]           │ [Details]    │
└──────────────┴──────────────────────┴──────────────┘
```

**Tablet (768px-1024px)**: 2-column layout

```
┌──────────────┬──────────────────────┐
│ Conversation │    Chat View         │
│    List      │                      │
│  (280px)     │     (flex-1)         │
│              │                      │
│ [Convos...]  │ [Messages...]        │
│              │                      │
│ [Search]     │ [Composer]           │
└──────────────┴──────────────────────┘
```

**Mobile (<768px)**: 1-column, swipe navigation

```
┌──────────────────────┐
│  Conversation List   │
│                      │
│  [Convos...]         │
│                      │
│  Tap to open →       │
└──────────────────────┘

       ↓ (on tap)

┌──────────────────────┐
│  ← Back    Chat View │
│                      │
│  [Messages...]       │
│                      │
│  [Composer]          │
└──────────────────────┘
```

### Animations & Interactions

**Micro-interactions**:

1. **Hover Effects**: Scale 1.02, shadow increase
2. **Button Press**: Scale 0.98
3. **Message Send**: Fade in + slide up (300ms)
4. **Typing Indicator**: 3 dots bouncing animation
5. **Unread Badge**: Pulse animation (2s loop)
6. **Reaction Add**: Pop animation (scale 0 → 1.2 → 1)
7. **Read Receipt**: Checkmark fade-in
8. **Presence Indicator**: Fade in/out (500ms)

**Loading States**:

- **Skeleton loaders** for conversations (gray pulse)
- **Spinner** for messages (teal gradient)
- **Progressive loading** for images (blur → sharp)

**Error States**:

- **Toast notifications** for errors (red, top-right, 5s auto-dismiss)
- **Inline errors** for form validation (under input, red text)
- **Retry buttons** for failed sends

### Accessibility

**Keyboard Navigation**:

- `Tab` through conversations
- `Enter` to open conversation
- `Escape` to close modals
- `Ctrl+Enter` to send message
- Arrow keys in emoji picker

**Screen Reader Support**:

- `role="navigation"` on sidebar
- `role="main"` on chat view
- `role="complementary"` on context panel
- `aria-label` on all interactive elements
- `aria-live="polite"` on message list
- `aria-live="assertive"` on typing indicator

**Visual Accessibility**:

- Minimum contrast ratio: 4.5:1 (WCAG AA)
- Focus indicators: 2px teal outline
- `prefers-reduced-motion`: Disable animations
- `prefers-contrast`: High contrast mode

---

## Phased Rollout Strategy

### Phase 1: Core Frontend (Week 1) - CRITICAL

**Goal**: Build essential v4 components to enable basic messaging

**Deliverables**:

1. `api-v4.js` (150 LOC) - HTTP client for v4 endpoints
2. `socket-v4.js` (200 LOC) - WebSocket client for v4 events
3. `state-v4.js` (300 LOC) - State management (conversations, messages, unread)
4. `ConversationListV4.js` (250 LOC) - Sidebar with conversation list
5. `ChatViewV4.js` (400 LOC) - Main chat interface with message history
6. `MessageBubbleV4.js` (200 LOC) - Individual message rendering
7. `MessageComposerV4.js` (350 LOC) - Message input with basic features

**Total**: ~1,850 LOC

**Acceptance Criteria**:

- ✅ User can view conversation list
- ✅ User can open a conversation
- ✅ User can see message history
- ✅ User can send a text message
- ✅ User can receive messages in real-time
- ✅ Unread counts update correctly

**Testing**: Manual QA in staging environment

### Phase 2: Advanced Features (Week 2) - HIGH

**Goal**: Add rich features (reactions, typing, attachments)

**Deliverables**:

1. Update `MessageComposerV4.js`:
   - Emoji picker integration
   - File attachment upload (drag-drop + click)
   - Typing indicator emission
2. Update `MessageBubbleV4.js`:
   - Reactions display + toggle
   - Read receipts ("Read by X, Y")
   - Attachment previews (images, docs)
3. `TypingIndicatorV4.js` (100 LOC) - "User is typing..." animation
4. `PresenceIndicatorV4.js` (80 LOC) - Online/offline dots
5. `ContextBannerV4.js` (150 LOC) - Display linked context (package, supplier)
6. `ContactPickerV4.js` (300 LOC) - User search for new conversations

**Total**: ~630 LOC (+ updates to existing)

**Acceptance Criteria**:

- ✅ User can add emoji reactions
- ✅ User can see typing indicators
- ✅ User can upload images/documents
- ✅ User can see read receipts
- ✅ User can see online/offline status
- ✅ User can start new conversation with search
- ✅ Context banner shows package/supplier details

**Testing**: Integration tests for API + WebSocket

### Phase 3: Main Page Integration (Week 2) - HIGH

**Goal**: Wire up all components into cohesive app

**Deliverables**:

1. Rebuild `/messenger/index.html`:
   - Update to load v4 components
   - Add proper CSP-compliant script loading
   - Update navbar integration
2. `app-v4.js` (400 LOC) - Main orchestrator:
   - Initialize all components
   - Handle routing (conversation ID from URL)
   - Coordinate state updates
   - Manage WebSocket connection
3. Update redirects in `routes/index.js`:
   - `/messages.html` → `/messenger/`
   - `/conversation/:id` → `/messenger/?conversation=:id`

**Total**: ~500 LOC + HTML updates

**Acceptance Criteria**:

- ✅ /messenger/ page loads successfully
- ✅ All components render correctly
- ✅ Real-time updates work end-to-end
- ✅ URL routing works (deep links to conversations)
- ✅ Old URLs redirect correctly
- ✅ No console errors
- ✅ CSP headers pass validation

**Testing**: E2E tests for complete workflows

### Phase 4: Dashboard Integration (Week 3) - MEDIUM

**Goal**: Embed messenger in customer/supplier dashboards

**Deliverables**:

1. `dashboard-widget-v4.js` (400 LOC):
   - Compact inbox widget (5 recent conversations)
   - Unread count badge in navbar
   - "View All" link to /messenger/
   - Real-time updates via WebSocket
2. Update `/public/dashboard-customer.html`:
   - Replace v3 widget with v4
   - Update API calls
3. Update `/public/dashboard-supplier.html`:
   - Same as customer
4. Update `/public/assets/js/components/UnreadBadge.js`:
   - Poll `/api/v4/messenger/unread-count`
   - Listen to WebSocket for real-time updates

**Total**: ~500 LOC + HTML updates

**Acceptance Criteria**:

- ✅ Dashboard shows recent conversations
- ✅ Unread badge updates in real-time
- ✅ Clicking conversation opens /messenger/
- ✅ "View All" link works
- ✅ Widget is responsive (desktop/mobile)

**Testing**: Manual QA + screenshot comparisons

### Phase 5: Entry Points (Week 3) - MEDIUM

**Goal**: Enable "Message Supplier" from all contexts

**Deliverables**:

1. Update `/public/supplier.html`:
   - "Message Supplier" button calls v4 API
   - Opens /messenger/ with new conversation
2. Update package detail pages:
   - "Ask About This Package" panel uses v4
   - Links conversation to package context
3. Update `/public/suppliers.html`:
   - "Message" button on each supplier card
4. Update marketplace listings:
   - "Contact Seller" button uses v4
5. "Find a Supplier" flow:
   - Lead form creates conversation with context

**Total**: ~400 LOC (mostly updates to existing)

**Acceptance Criteria**:

- ✅ "Message Supplier" creates v4 conversation
- ✅ Context is correctly linked (package ID, supplier ID, etc.)
- ✅ Conversation appears in inbox immediately
- ✅ Supplier receives real-time notification
- ✅ All entry points work on mobile

**Testing**: E2E tests for each entry point

### Phase 6: Migration & Deprecation (Week 3) - HIGH

**Goal**: Migrate existing users and deprecate v1/v2/v3

**Deliverables**:

1. Run migration script:
   - `node scripts/migrate-to-messenger-v4.js`
   - Migrate all v1/v2/v3 data to v4 collections
   - Verify no data loss
2. Add deprecation headers to v1/v2/v3 routes:
   - `X-API-Deprecation: true`
   - `X-API-Deprecation-Sunset: 2026-03-31`
   - `X-API-Deprecation-Replacement: /api/v4/messenger/`
3. Update `api-version.js`:
   - Change `CURRENT: 'v4'`
   - Add console warning for v3 usage
4. Add banner to old messenger:
   - "This version is deprecated. Upgrade to v4."

**Acceptance Criteria**:

- ✅ All conversations migrated successfully
- ✅ All messages migrated successfully
- ✅ No orphaned data
- ✅ v1/v2/v3 endpoints return deprecation headers
- ✅ Users see upgrade prompts

**Testing**: Data integrity checks, rollback plan prepared

### Phase 7: Testing & QA (Week 4) - CRITICAL

**Goal**: Comprehensive testing before production

**Deliverables**:

1. **Unit Tests** (15 test files):
   - `api-v4.test.js` - API client methods
   - `socket-v4.test.js` - WebSocket event handling
   - `state-v4.test.js` - State mutations
   - Component tests for each UI component
2. **Integration Tests** (8 test files):
   - API endpoint tests (auth, CSRF, validation)
   - WebSocket flow tests (connect, disconnect, events)
   - File upload tests (types, sizes, errors)
3. **E2E Tests** (12 scenarios):
   - Send/receive message
   - Create conversation from supplier profile
   - Upload attachment
   - Add reaction
   - Mark as read
   - Search messages
   - Start conversation from marketplace
   - Dashboard widget interaction
   - Mobile responsive behavior
   - Error handling (network failure, etc.)
4. **Security Tests**:
   - XSS injection attempts (content sanitization)
   - CSRF token validation
   - Rate limiting enforcement
   - Spam detection accuracy
5. **Performance Tests**:
   - Load 1,000 conversations (< 2s)
   - Load 10,000 messages (< 3s)
   - Send 100 messages/sec (no dropped events)
   - WebSocket reconnection (< 1s)

**Total**: ~50 test files, 500+ test cases

**Acceptance Criteria**:

- ✅ All tests pass (100% pass rate)
- ✅ Code coverage > 80%
- ✅ No security vulnerabilities (CodeQL scan)
- ✅ Performance benchmarks met
- ✅ Browser compatibility (Chrome, Firefox, Safari, Edge)

**Testing**: Automated CI/CD + manual QA

### Phase 8: Production Deployment (Week 4) - CRITICAL

**Goal**: Go live with v4 for all users

**Deliverables**:

1. **Deployment Checklist**:
   - [ ] All tests passing
   - [ ] Security scan clean
   - [ ] Performance benchmarks met
   - [ ] Database indexes created
   - [ ] Migration script tested
   - [ ] Rollback plan documented
   - [ ] Monitoring dashboards configured
   - [ ] Error alerts set up
2. **Deployment Steps**:
   - Run migration in maintenance window (Sunday 2AM UTC)
   - Deploy backend + frontend simultaneously
   - Enable v4 API routes
   - Monitor error rates for 24 hours
   - Gradual rollout: 10% → 50% → 100% over 3 days
3. **Monitoring**:
   - WebSocket connection stability
   - API response times
   - Error rates (< 0.1%)
   - User engagement metrics
4. **Rollback Triggers**:
   - Error rate > 1%
   - Page load time > 5s
   - WebSocket disconnect rate > 5%
   - User complaints > 10

**Acceptance Criteria**:

- ✅ v4 live for 100% of users
- ✅ Zero critical bugs
- ✅ Error rate < 0.1%
- ✅ User satisfaction maintained
- ✅ Performance SLAs met

**Testing**: Production monitoring + hotfix readiness

---

## Technical Implementation

### Frontend Components (13 files)

#### 1. `api-v4.js` (150 LOC)

```javascript
class MessengerAPIv4 {
  constructor() {
    this.baseUrl = '/api/v4/messenger';
  }

  // Conversations
  async createConversation(data) {
    /* POST /conversations */
  }
  async getConversations(filters) {
    /* GET /conversations */
  }
  async getConversation(id) {
    /* GET /conversations/:id */
  }
  async updateConversation(id, data) {
    /* PATCH /conversations/:id */
  }
  async deleteConversation(id) {
    /* DELETE /conversations/:id */
  }

  // Messages
  async sendMessage(conversationId, data) {
    /* POST /conversations/:id/messages */
  }
  async getMessages(conversationId, cursor) {
    /* GET /conversations/:id/messages */
  }
  async editMessage(messageId, content) {
    /* PATCH /messages/:id */
  }
  async deleteMessage(messageId) {
    /* DELETE /messages/:id */
  }

  // Reactions & Read Receipts
  async toggleReaction(messageId, emoji) {
    /* POST /messages/:id/reactions */
  }
  async markAsRead(conversationId) {
    /* POST /conversations/:id/read */
  }

  // Utilities
  async getUnreadCount() {
    /* GET /unread-count */
  }
  async searchContacts(query) {
    /* GET /contacts */
  }
  async searchMessages(query) {
    /* GET /search */
  }
  async sendTyping(conversationId) {
    /* POST /conversations/:id/typing */
  }
}
```

#### 2. `socket-v4.js` (200 LOC)

```javascript
class MessengerSocketv4 {
  constructor(callbacks) {
    this.socket = io({ autoConnect: false });
    this.callbacks = callbacks;
    this.setupEventListeners();
  }

  setupEventListeners() {
    this.socket.on('messenger:v4:message', this.callbacks.onMessage);
    this.socket.on('messenger:v4:typing', this.callbacks.onTyping);
    this.socket.on('messenger:v4:read', this.callbacks.onRead);
    this.socket.on('messenger:v4:reaction', this.callbacks.onReaction);
    this.socket.on('messenger:v4:presence', this.callbacks.onPresence);
    this.socket.on('messenger:v4:conversation-updated', this.callbacks.onConversationUpdated);
  }

  connect() {
    this.socket.connect();
  }
  disconnect() {
    this.socket.disconnect();
  }
  joinConversation(id) {
    this.socket.emit('join-conversation-v4', id);
  }
  leaveConversation(id) {
    this.socket.emit('leave-conversation-v4', id);
  }
}
```

#### 3. `state-v4.js` (300 LOC)

```javascript
class MessengerStatev4 {
  constructor() {
    this.conversations = [];
    this.messages = {}; // conversationId -> messages[]
    this.activeConversationId = null;
    this.unreadCount = 0;
    this.typingUsers = {}; // conversationId -> userId[]
    this.onlineUsers = new Set();
    this.listeners = [];
  }

  // Conversations
  setConversations(conversations) {
    /* ... */
  }
  addConversation(conversation) {
    /* ... */
  }
  updateConversation(id, updates) {
    /* ... */
  }
  removeConversation(id) {
    /* ... */
  }

  // Messages
  setMessages(conversationId, messages) {
    /* ... */
  }
  addMessage(message) {
    /* ... */
  }
  updateMessage(messageId, updates) {
    /* ... */
  }
  removeMessage(messageId) {
    /* ... */
  }

  // Typing
  setTyping(conversationId, userId, isTyping) {
    /* ... */
  }

  // Presence
  setUserOnline(userId) {
    /* ... */
  }
  setUserOffline(userId) {
    /* ... */
  }

  // Unread
  setUnreadCount(count) {
    /* ... */
  }
  incrementUnread() {
    /* ... */
  }
  decrementUnread(amount) {
    /* ... */
  }

  // Observer pattern
  subscribe(listener) {
    /* ... */
  }
  notify() {
    this.listeners.forEach(fn => fn(this));
  }
}
```

#### 4-13. UI Components

- `ConversationListV4.js` (250 LOC) - Sidebar list
- `ChatViewV4.js` (400 LOC) - Main chat area
- `MessageBubbleV4.js` (200 LOC) - Message rendering
- `MessageComposerV4.js` (350 LOC) - Input + emoji + attachments
- `TypingIndicatorV4.js` (100 LOC) - "User is typing..."
- `PresenceIndicatorV4.js` (80 LOC) - Online/offline dot
- `ContextBannerV4.js` (150 LOC) - Context display
- `ContactPickerV4.js` (300 LOC) - User search modal
- `app-v4.js` (400 LOC) - Main orchestrator
- `dashboard-widget-v4.js` (400 LOC) - Dashboard integration

### Backend (Already Complete)

**No backend changes needed** - v4 is production-ready:

- ✅ 15 API endpoints
- ✅ Service layer with all features
- ✅ WebSocket event handlers
- ✅ Database indexes
- ✅ Migration script
- ✅ Unit tests (23 test cases)

---

## Security & Performance

### Security Measures (Already Implemented)

1. **Authentication**: JWT cookie-based, all endpoints require auth
2. **Authorization**: Users can only access own conversations
3. **CSRF Protection**: All write operations (POST/PATCH/DELETE)
4. **XSS Prevention**: DOMPurify sanitization on all content
5. **Spam Detection**: Rate limiting + content analysis
6. **File Upload Validation**: Type + size checks (10MB max)
7. **Rate Limiting by Tier**:
   - Free: 50 messages/day
   - Premium: 200 messages/day
   - Pro: Unlimited

### Performance Optimizations (Already Implemented)

1. **Database Indexes**: 13 total (7 conversations + 6 messages)
2. **Cursor Pagination**: Scales to millions of messages
3. **WebSocket**: Real-time without polling
4. **Denormalized Data**: `senderName` in messages for fast rendering
5. **Text Search Indexes**: MongoDB full-text search
6. **Lazy Loading**: Messages loaded on scroll

### Additional Security (To Implement)

1. **Content Security Policy**: Verify no inline scripts
2. **Virus Scanning**: Scan uploaded files (future)
3. **End-to-End Encryption**: Optional for sensitive conversations (future)
4. **Audit Logging**: Track security events (future)

---

## Testing Strategy

### Unit Tests

**Backend** (already complete):

- ✅ 23 test cases in `messenger-v4.test.js`
- ✅ Service layer methods
- ✅ Validation logic
- ✅ Deduplication
- ✅ Search and filtering

**Frontend** (to create):

- [ ] API client methods (mocked fetch)
- [ ] WebSocket event handling (mocked socket)
- [ ] State mutations
- [ ] Component rendering (Jest + React Testing Library or vanilla JS)

### Integration Tests

**Backend** (to create):

- [ ] API endpoint auth (401 without token)
- [ ] CSRF protection (403 without token)
- [ ] File upload (success + failures)
- [ ] Rate limiting (429 after limit)

**Frontend** (to create):

- [ ] API + WebSocket flow (real network)
- [ ] State sync across components
- [ ] Error handling (network failure, etc.)

### E2E Tests

**Scenarios** (to create):

1. User logs in, sends message, receives reply
2. User starts conversation from supplier profile
3. User uploads image attachment
4. User adds emoji reaction
5. User sees typing indicator
6. User sees read receipt
7. Dashboard widget shows recent conversations
8. Unread badge updates in real-time
9. Mobile: swipe between conversation list and chat
10. Error: network failure during send (retry logic)
11. Error: invalid file type upload
12. Error: rate limit exceeded

### Performance Tests

**Scenarios**:

- Load 1,000 conversations (target: < 2s)
- Load 10,000 messages (target: < 3s)
- Send 100 messages/sec (target: 0 dropped events)
- WebSocket reconnection (target: < 1s)
- Search 100,000 messages (target: < 500ms)

---

## Migration Plan

### Data Migration (Already Implemented)

**Script**: `scripts/migrate-to-messenger-v4.js`

**Process**:

1. Read all `threads` (v1/v2) and `conversations` (v3)
2. Transform to v4 schema
3. Deduplicate (prevent duplicate direct conversations)
4. Migrate all messages with field mapping
5. Create indexes
6. Verify counts and integrity

**Downtime**: ~30 minutes for 100K conversations

### API Migration (To Implement)

**Deprecation Strategy**:

1. **Week 1**: Add deprecation headers to v1/v2/v3
2. **Week 2**: Show banner in old messenger UI
3. **Week 3**: Migrate users to v4 automatically
4. **Week 4**: v1/v2/v3 APIs return 410 Gone (except for read-only)

**Backward Compatibility**:

- Keep v3 API read-only for 90 days
- Redirect `/messages.html` → `/messenger/`
- Redirect `/conversation/:id` → `/messenger/?conversation=:id`

---

## Success Metrics

### Technical Metrics

| Metric                  | Target  | Measurement            |
| ----------------------- | ------- | ---------------------- |
| API Response Time (p95) | < 300ms | Application monitoring |
| WebSocket Latency (p95) | < 100ms | Socket.IO metrics      |
| Error Rate              | < 0.1%  | Error tracking         |
| Uptime                  | > 99.9% | Monitoring dashboards  |
| Test Coverage           | > 80%   | Jest coverage report   |
| Page Load Time (p95)    | < 2s    | Lighthouse             |

### User Engagement Metrics

| Metric                       | Target     | Measurement      |
| ---------------------------- | ---------- | ---------------- |
| Messages Sent/Day            | +50% vs v3 | Analytics        |
| Active Conversations         | +30%       | Database queries |
| User Satisfaction            | > 4.5/5    | In-app survey    |
| Feature Adoption (reactions) | > 40%      | Usage tracking   |
| Attachment Upload Rate       | > 20%      | Usage tracking   |

### Business Metrics

| Metric                       | Target | Measurement         |
| ---------------------------- | ------ | ------------------- |
| Supplier Inquiry Rate        | +25%   | Conversion tracking |
| Customer Response Time       | -30%   | Time to first reply |
| Spam Reports                 | < 0.5% | Support tickets     |
| Churn Rate (messaging users) | < 2%   | Retention analysis  |

---

## Timeline Summary

| Phase                | Duration | Effort   | Priority |
| -------------------- | -------- | -------- | -------- |
| 1. Core Frontend     | Week 1   | 30 hours | CRITICAL |
| 2. Advanced Features | Week 2   | 20 hours | HIGH     |
| 3. Main Page         | Week 2   | 10 hours | HIGH     |
| 4. Dashboards        | Week 3   | 12 hours | MEDIUM   |
| 5. Entry Points      | Week 3   | 10 hours | MEDIUM   |
| 6. Migration         | Week 3   | 8 hours  | HIGH     |
| 7. Testing           | Week 4   | 25 hours | CRITICAL |
| 8. Deployment        | Week 4   | 10 hours | CRITICAL |

**Total Effort**: ~125 hours over 4 weeks

---

## Conclusion

This rebuild plan transforms EventFlow's messaging from a **fragmented multi-version system** into a **unified gold-standard platform**.

The **backend foundation is rock-solid** (100% complete), requiring only **frontend components** to unlock the full feature set.

The **phased rollout** ensures:

- ✅ Minimal risk (gradual deployment)
- ✅ Continuous testing (each phase validated)
- ✅ Backward compatibility (old URLs redirected)
- ✅ User-centric design (liquid glass theme, real-time updates)

**Expected Outcomes**:

- 🎯 Universal messaging for all user types
- 🎯 Contextual conversations from all entry points
- 🎯 Real-time chat with rich features
- 🎯 Polished, accessible UI
- 🎯 Scalable, secure, spam-resistant architecture

**Go/No-Go Decision**: ✅ **GO** - Foundation is production-ready, execution plan is clear.
