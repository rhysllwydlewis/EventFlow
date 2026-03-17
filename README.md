# 📸 EventFlow - Comprehensive Event Services Marketplace

A production-ready, feature-rich platform connecting event service suppliers (photographers, venues, caterers, entertainment, etc.) with customers planning events. Built with Node.js, Express, MongoDB, and modern web technologies.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/badge/node-20.x%20LTS-brightgreen)](https://nodejs.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-6.0%2B-green)](https://www.mongodb.com/)

---

## 🚀 Quick Start - Production Deployment

**Deploying to production (Railway, Heroku, etc.)?** Follow these steps to avoid 502 errors:

### Prerequisites

- ✅ Node.js 20 LTS (v20.x) — **Node 22+ is not supported** (sharp may crash with "Bus error")
- ✅ **MongoDB Atlas account (free tier available)** ← Most important!
- ✅ Deployment platform account (Railway, Heroku, etc.)

### Essential Steps (15 minutes)

1. **Set up MongoDB Atlas** (Required - app won't start without this!)
   - 📚 **[Follow our simple step-by-step guide →](.github/docs/MONGODB_SETUP_SIMPLE.md)** (no technical knowledge needed)
   - 📚 Or see [MONGODB_SETUP.md](.github/docs/MONGODB_SETUP.md) for technical details
   - Get your connection string from MongoDB Atlas

2. **Configure Environment Variables** on your deployment platform:

   ```bash
   # Required
   MONGODB_URI=mongodb+srv://your-actual-connection-string
   JWT_SECRET=your-random-secret-min-32-chars
   NODE_ENV=production
   BASE_URL=https://event-flow.co.uk

   # Recommended (optional)
   EMAIL_ENABLED=true
   POSTMARK_API_KEY=your-server-token
   POSTMARK_FROM=admin@yourdomain.com
   ```

3. **Deploy your app** - Push to your platform (Railway, Heroku, etc.)

4. **Verify it works** - Visit `https://event-flow.co.uk/api/health`
   - Should show `"databaseStatus": "connected"`

### Troubleshooting 502 Errors

Getting "502 Bad Gateway" or "connection refused" errors? This usually means MongoDB isn't configured:

| Error Message                                   | Solution                                                                                                                                                 |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Invalid scheme, expected connection string..." | You're using the placeholder from `.env.example`. Get your real connection string from MongoDB Atlas - [see guide](.github/docs/MONGODB_SETUP_SIMPLE.md) |
| "Authentication failed" or "bad auth"           | Wrong password in connection string. Reset it in MongoDB Atlas → Database Access                                                                         |
| "Connection timeout" or "ENOTFOUND"             | IP not whitelisted. Add `0.0.0.0/0` in MongoDB Atlas → Network Access                                                                                    |
| "No cloud database configured"                  | `MONGODB_URI` environment variable not set on your deployment platform                                                                                   |

**📚 Detailed troubleshooting:** See [MONGODB_SETUP_SIMPLE.md](.github/docs/MONGODB_SETUP_SIMPLE.md#common-problems-and-solutions)

---

## 🌟 Features

### Core Platform

- ✅ **Multi-Step Planning Wizard** - Interactive wizard for creating event plans with package selection
- ✅ **Advanced Photo Management** - Upload, optimize, crop with AWS S3 or local storage
- ✅ **Reviews & Ratings System** - 5-star ratings with approval workflow
- ✅ **Advanced Search & Discovery** - Full-text search, filters, trending, recommendations
- ✅ **User Authentication** - JWT-based auth with role-based access (customer, supplier, admin)
- ✅ **Email Verification** - Secure token-based email verification with 24-hour expiration
- ✅ **Package Detail Pages** - Full-featured package view with gallery, supplier info, and messaging
- ✅ **Supplier Profiles** - Rich profiles with galleries, packages, and services
- ✅ **Admin Moderation** - Photo and review approval queues
- ✅ **MongoDB Integration** - Schema validation, indexes, connection pooling
- ✅ **API Documentation** - Interactive Swagger UI at `/api-docs`

### Planning Wizard

- Multi-step card-based UI with progress indicator
- Event type selection (Wedding or Other events)
- Location and event details (date, guest count, budget)
- Category-based package browsing (Venues, Photography, Catering, etc.)
- Skip functionality for flexible planning
- Persistent plan summary sidebar
- Plan persistence for logged-in users
- Draft mode for anonymous users (prompts login to save)
- Package classification by category and event type
- Backward compatibility with legacy planning flow

### Photo Management

- Multer middleware for secure uploads
- Sharp for image optimization (resize, compress, format conversion)
- Automatic thumbnail generation (300x300, 1200x1200, 2000x2000)
- AWS S3 cloud storage or local filesystem
- Batch upload (up to 10 photos)
- Image cropping and editing
- Admin approval workflow
- CDN-ready URLs

### Search & Discovery

- Full-text search across suppliers
- Advanced filters: category, location, price, rating, amenities, guest capacity
- Trending suppliers
- New arrivals
- Popular packages
- Personalized recommendations based on browsing history
- Search history tracking

### Reviews & Ratings

- 5-star rating system
- Written reviews with event details
- Admin moderation
- Helpful/unhelpful voting
- Rating distribution analytics
- Verified reviews

### Admin Dashboard

- **User Management** - Edit, delete, suspend, ban users
- **Admin Privilege Control** - Grant/revoke admin access with owner protection
- **Supplier Management** - Edit, approve, verify, delete suppliers
- **Manual Verification** - Admin can manually verify user emails and supplier identities
- **Package Management** - Edit, approve, feature, delete packages
- **Photo Moderation** - Batch approve/reject photo uploads
- **Review Moderation** - Approve/reject customer reviews
- **Smart Tagging** - Automatically generate relevant tags for suppliers based on descriptions
- **Comprehensive Audit Log** - Track all admin actions with timestamps
- **Data Export** - CSV and JSON exports for users, marketing lists, full database
- **Analytics Dashboard** - User signups, activity metrics, platform statistics
- **GDPR Compliance** - User data management and privacy controls

### Admin Authentication

EventFlow implements a gold-standard admin authentication system with two mechanisms:

**1. Protected Owner Account**

- Single, protected admin account that cannot be deleted or demoted
- Automatically created on server startup
- Pre-verified (no email verification required)
- Configured via environment variables (OWNER_EMAIL, OWNER_PASSWORD)

**2. Domain-Based Admin Promotion**

- Automatic admin role for verified emails from trusted domains
- Configured via ADMIN_DOMAINS environment variable (e.g., `your-company.com`)
- Requires email verification before promotion (security)
- Supports multiple domains (comma-separated)

**Quick Setup:**

```bash
# .env
OWNER_EMAIL=admin@your-company.com
OWNER_PASSWORD=your-strong-password
ADMIN_DOMAINS=your-company.com
```

📚 **[Complete Admin Setup Guide →](docs/ADMIN_SETUP.md)**

### Messaging System

- **Customer-Supplier Communication** - Direct messaging between customers and suppliers
- **Conversation Threads** - Organized message threads with read/unread status
- **Draft Messages** - Save and edit draft messages before sending
- **Inbox Management** - View all conversations with unread counts and last message preview
- **Smart Thread Reuse** - Automatically reuses existing conversations with the same parties
- **Admin Access** - Admins can view all conversations for support purposes
- **Real-time Updates** - Auto-refresh to show new messages

---

## 🔒 Security

EventFlow implements industry-standard security practices:

### HTTPS & Transport Security

- **HTTPS Enforcement**: All HTTP requests are redirected to HTTPS in production
- **HSTS**: HTTP Strict Transport Security enabled with 1-year max-age
- **Secure Cookies**: Authentication cookies use `httpOnly`, `secure` (production), and `sameSite` flags

### Security & Performance

- ✅ **Rate Limiting** - Protects against abuse with endpoint-specific limits
  - Authentication: 10 requests / 15 minutes
  - AI/OpenAI: 50 requests / hour
  - File Uploads: 20 requests / 15 minutes
  - Search/Discovery: 30 requests / minute
  - Notifications: 50 requests / 5 minutes
- ✅ **Input Validation** - Express-validator for all user inputs
- ✅ **Security Headers** - Helmet.js with CSP, HSTS, and other protections
- ✅ **API Versioning** - `/api/v1/` prefix with backward compatibility
- ✅ **CSRF Protection** - Token-based protection for all state-changing operations
- ✅ **MongoDB Sanitization** - Prevents NoSQL injection attacks
- ✅ **Password Hashing** - Bcrypt with salt rounds
- 📚 **[Full Security Documentation →](docs/SECURITY_FEATURES.md)** Headers (via Helmet)

- **Content Security Policy (CSP)**: Restricts resource loading to trusted domains
- **X-Frame-Options**: Prevents clickjacking with `DENY`
- **X-Content-Type-Options**: Prevents MIME-sniffing with `nosniff`
- **Referrer-Policy**: Set to `strict-origin-when-cross-origin`

### Input Validation & Sanitization

- MongoDB query sanitization via `express-mongo-sanitize`
- Input validation using `validator` library
- Rate limiting on authentication and write endpoints

### Monitoring

- CSP violation reporting endpoint at `/api/csp-report`
- Sentry integration for error tracking
- Audit logging for admin actions

---

## ⚡ Performance

EventFlow implements comprehensive performance optimizations for production deployments:

### Compression Strategy

- **Brotli Compression**: Primary compression method (15-20% better than gzip)
- **Gzip Fallback**: Automatic fallback for older clients
- **Selective Compression**: Only compresses text-based content > 1KB
- **Quality Tuning**: Balanced compression levels for optimal speed/size ratio
  - Brotli quality: 4 (good for dynamic content)
  - Gzip level: 6 (default balanced setting)

**Verify Compression:**

```bash
curl -H "Accept-Encoding: br" -I https://yourdomain.com/
# Should return: Content-Encoding: br
```

### Caching Strategy

EventFlow uses a multi-tier caching strategy for optimal performance:

- **HTML Pages**: 5-minute cache (`max-age=300, must-revalidate`)
- **Versioned Assets** (hashed filenames): 1-year cache (`max-age=31536000, immutable`)
- **Static Assets** (CSS/JS/images): 1-week cache (`max-age=604800, must-revalidate`)
- **User Uploads**: 1-year cache (`max-age=31536000, immutable`)

**Verify Caching:**

```bash
curl -I https://yourdomain.com/assets/css/styles.css
# Should return: Cache-Control: public, max-age=604800, must-revalidate
```

### Asset Optimization

- **Minified Assets**: CSS (~292KB) and JS (~1.2MB) are production-ready
- **Optimized Favicon**: 245 bytes SVG (extremely small)
- **Deferred Loading**: JavaScript loads with `defer` attribute
- **Lazy Loading**: Images load on-demand as they enter viewport

### Performance Verification

EventFlow includes a built-in performance verification endpoint:

```bash
# Check compression and caching configuration
curl http://localhost:3000/api/performance
```

**Response includes:**

- Client compression support (Brotli, gzip, deflate)
- Server compression configuration
- Caching strategy documentation
- Performance recommendations

**Full Testing Guide:** See [docs/PERFORMANCE_TESTING.md](docs/PERFORMANCE_TESTING.md)

### Image Optimization

- **Sharp** library for server-side image processing
- WebP format generation for modern browsers
- Responsive image sizes (thumbnail, large, optimized)
- Automatic thumbnail generation on upload

### CDN Recommendation

For production deployments, we recommend adding Cloudflare in front of Railway for:

- Global CDN with edge caching
- DDoS protection
- Additional image optimization
- Automatic Brotli compression

See `docs/CLOUDFLARE_SETUP.md` for setup instructions (coming soon).

---

## 🚀 Quick Start

### Prerequisites

- Node.js 20 LTS (v20.x) and npm — Node 22+ is not supported due to sharp compatibility
- **Optional:** MongoDB 6.0+ (local or Atlas) for production deployments

**Note:** EventFlow uses file-based JSON storage by default for zero-configuration setup. MongoDB is available for production use - see [MONGODB_SETUP.md](.github/docs/MONGODB_SETUP.md).

### Installation

```bash
# Clone repository
git clone https://github.com/yourusername/eventflow.git
cd eventflow

# Install dependencies
npm install

# Set up environment
cp .env.example .env
# Edit .env with your configuration (MongoDB is optional)

# Start server (no migration needed for file-based storage)
npm start

# Optional: Migrate to MongoDB (for production)
# npm run migrate
```

Visit http://localhost:3000

### Docker Quick Start

```bash
# Start all services (app + MongoDB + Mongo Express)
docker-compose up -d

# View logs
docker-compose logs -f

# Stop services
docker-compose down
```

**Services:**

- App: http://localhost:3000
- API Docs: http://localhost:3000/api-docs
- MongoDB UI: http://localhost:8081

See [DOCKER_GUIDE.md](DOCKER_GUIDE.md) for details.

## 📚 Documentation

### Getting Started

- **[Production Deployment Quick Start](#-quick-start---production-deployment)** - Deploy in 15 minutes
- **[MongoDB Setup (Simple Guide)](.github/docs/MONGODB_SETUP_SIMPLE.md)** - For non-technical users
- **[Troubleshooting 502 Errors](#troubleshooting-502-errors)** - Common deployment issues

### Complete Guides

- **[API Documentation](API_DOCUMENTATION.md)** - Complete API reference with examples
- **[Deployment Guide](DEPLOYMENT_GUIDE.md)** - Production deployment instructions
- **[MongoDB Setup (Technical)](.github/docs/MONGODB_SETUP.md)** - Database configuration guide
- **[MongoDB Migration Plan](docs/mongodb-migration.md)** - Complete MongoDB migration guide with architecture
- **[Performance Testing Guide](docs/PERFORMANCE_TESTING.md)** - Performance verification and QA procedures
- **[Docker Guide](DOCKER_GUIDE.md)** - Docker Compose usage
- **[Stripe Introductory Pricing Setup](STRIPE_INTRO_PRICING_SETUP.md)** - Configure intro pricing for Professional plan
- **[Stripe Integration Guide](STRIPE_INTEGRATION_GUIDE.md)** - General Stripe setup
- **[Interactive API Docs](http://localhost:3000/api-docs)** - Swagger UI (when running)

## 🛠️ Tech Stack

**Backend:**

- Node.js & Express.js
- MongoDB with Mongoose schemas
- JWT authentication
- Multer (file uploads)
- Sharp (image processing)
- AWS SDK (S3 storage)

**Email:**

- Postmark (transactional email delivery)
- Local HTML templates (no hosted templates required)

**Security:**

- Helmet (security headers)
- bcrypt (password hashing)
- Rate limiting
- Input validation (Validator.js)

**Documentation:**

- Swagger/OpenAPI 3.0
- Swagger UI Express

**Optional:**

- Stripe (payments)
- OpenAI (AI features)

## 📖 API Endpoints

### Authentication

```
POST   /api/auth/register        - Register new user
POST   /api/auth/login           - Login
POST   /api/auth/logout          - Logout
GET    /api/auth/me              - Get current user
GET    /api/auth/verify          - Verify email with token
POST   /api/auth/resend-verification - Resend verification email
POST   /api/auth/forgot          - Request password reset
```

### Search & Discovery

```
GET    /api/search/suppliers     - Advanced supplier search
GET    /api/search/categories    - Get all categories
GET    /api/search/amenities     - Get all amenities
GET    /api/discovery/trending   - Trending suppliers
GET    /api/discovery/new        - New suppliers
GET    /api/discovery/recommendations - Personalized recommendations
```

### Reviews & Ratings

```
POST   /api/reviews              - Create review
GET    /api/reviews/supplier/:id - Get supplier reviews
GET    /api/reviews/supplier/:id/distribution - Rating distribution
POST   /api/reviews/:id/helpful  - Mark review helpful
DELETE /api/reviews/:id          - Delete review
```

### Packages

```
GET    /api/packages/featured    - Get featured packages
GET    /api/packages/search      - Search packages
GET    /api/packages/:slug       - Get package details by slug
```

### Photo Management

```
POST   /api/photos/upload        - Upload single photo
POST   /api/photos/upload/batch  - Upload multiple photos
DELETE /api/photos/delete        - Delete photo
POST   /api/photos/crop          - Crop image
GET    /api/photos/pending       - Get pending photos (admin)
POST   /api/photos/approve       - Approve/reject photo (admin)
```

### Admin Endpoints

```
GET    /api/admin/users          - List all users
PUT    /api/admin/users/:id      - Edit user profile
DELETE /api/admin/users/:id      - Delete user
POST   /api/admin/users/:id/verify           - Manually verify user email
POST   /api/admin/users/:id/grant-admin      - Grant admin privileges
POST   /api/admin/users/:id/revoke-admin     - Revoke admin privileges
GET    /api/admin/suppliers      - List all suppliers
PUT    /api/admin/suppliers/:id  - Edit supplier
DELETE /api/admin/suppliers/:id  - Delete supplier
POST   /api/admin/suppliers/:id/verify       - Manually verify supplier identity
POST   /api/admin/suppliers/smart-tags       - Generate smart tags for suppliers
GET    /api/admin/packages       - List all packages
PUT    /api/admin/packages/:id   - Edit package
DELETE /api/admin/packages/:id   - Delete package
GET    /api/admin/metrics        - Get dashboard metrics
GET    /api/admin/users-export   - Export users (CSV)
GET    /api/admin/export/all     - Export all data (JSON)
```

### Messaging Endpoints

```
GET    /api/messages/threads                      - List conversation threads
POST   /api/messages/threads                      - Create new conversation
GET    /api/messages/threads/:id                  - Get thread details
GET    /api/messages/threads/:id/messages         - Get messages in thread
POST   /api/messages/threads/:id/messages         - Send message in thread
POST   /api/messages/threads/:id/mark-read        - Mark thread as read
GET    /api/messages/drafts                       - Get draft messages
PUT    /api/messages/:id                          - Update draft message
DELETE /api/messages/:id                          - Delete draft message
```

See [API_DOCUMENTATION.md](API_DOCUMENTATION.md) for complete reference.
See [ADMIN_API.md](ADMIN_API.md) for detailed admin endpoint documentation.

## 📱 User Flows & Pages

### Email Verification Flow

EventFlow implements a secure email verification system for new user accounts:

**User Journey:**

1. User registers for an account at `/auth.html`
2. System sends verification email with a unique 24-hour token via Postmark
3. User clicks verification link in email → redirects to `/verify.html?token=<token>`
4. Page automatically calls `/api/auth/verify` API with the token
5. System displays branded verification status:
   - ✅ **Success**: "Email Verified!" with auto-redirect to appropriate dashboard
   - ❌ **Expired**: Shows expiration message with resend form
   - ❌ **Invalid**: Shows invalid token message with resend form
   - ⚠️ **No Token**: Shows instructions with resend form
6. After successful verification, user is redirected to:
   - Admin users → `/admin.html`
   - Supplier users → `/dashboard-supplier.html`
   - Customer users → `/dashboard-customer.html`

**Features:**

- Token-based verification with 24-hour expiration for security
- Branded UI with appropriate icons and messages for all states
- Resend verification email functionality
- Auto-redirect after successful verification
- Manual navigation buttons (Go to Dashboard, Go to Home)
- Email validation and error handling

**Screenshot:**
![Email Verification Page](https://github.com/user-attachments/assets/ca0d5df7-24cd-45f9-8c80-ed7c4f38a0c1)

### Package Detail Page Flow

Users can browse and view detailed information about service packages:

**User Journey:**

1. User discovers packages on homepage featured carousel or category pages
2. Clicks on package card → navigates to `/package.html?slug=<package-slug>`
3. Page loads full package details via `/api/packages/:slug` API
4. User views comprehensive package information and supplier details
5. User can:
   - Browse package photo gallery
   - Read full description and pricing
   - View tags and categories
   - See supplier profile information
   - Message the supplier (requires authentication)
   - Navigate to supplier's other packages

**Package Detail Features:**

- **Image Gallery**: Multiple photos with thumbnail navigation and full-screen view
- **Package Information**:
  - Title, description, and detailed information
  - Pricing (or "Contact for price")
  - Location with map icon
  - Categories and tags
  - Featured badge (if applicable)
- **Supplier Card**:
  - Supplier logo and name
  - Business description
  - Contact information (email, phone)
  - Location
  - Link to view all supplier packages
- **Message Panel**: Auth-gated messaging system to contact supplier
- **Breadcrumb Navigation**: Home → Category → Package
- **Responsive Design**: Mobile-friendly layout

**Linking from Homepage:**

- Package cards on the homepage automatically link to detail pages
- Implemented via `PackageList` component: `window.location.href = '/package.html?slug=${pkg.slug}'`
- Featured packages carousel also links to detail pages
- All package cards are clickable with hover effects

**Screenshot:**
![Package Detail Page](https://github.com/user-attachments/assets/5a312a8d-0f34-4c54-9e27-895ed06b9c91)

**Technical Implementation:**

- URL Pattern: `/package.html?slug=<package-slug>`
- API Endpoint: `GET /api/packages/:slug`
- JavaScript Handler: `/assets/js/pages/package-init.js` (inline in package.html)
- Components Used:
  - `PackageGallery` - Image gallery component
  - `SupplierCard` - Supplier information display
  - `MessageSupplierPanel` - Messaging interface
- Authentication: Required only for messaging functionality

## 🔧 Environment Variables

**Required for Production:**

```env
# Database - MOST IMPORTANT! App won't start without this
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/eventflow
# 👆 Get this from MongoDB Atlas - see .github/docs/MONGODB_SETUP_SIMPLE.md

# Security
JWT_SECRET=your-secret-key-min-32-chars

# Environment
NODE_ENV=production
BASE_URL=https://yourdomain.com
```

**Recommended (Email functionality):**

```env
EMAIL_ENABLED=true
POSTMARK_API_KEY=your-server-token
POSTMARK_FROM=admin@yourdomain.com
```

**Optional - AWS S3:**

```env
AWS_S3_BUCKET=your-bucket
AWS_S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
```

**⚠️ Common mistake:** Using the placeholder value from `.env.example` will cause 502 errors!  
Get your real connection string: **[MongoDB Setup Guide](.github/docs/MONGODB_SETUP_SIMPLE.md)**

See [.env.example](.env.example) for all options.

### Database Configuration

**EventFlow uses MongoDB Atlas as the primary database for production deployments:**

1. **MongoDB Atlas (PRIMARY - Recommended for Production)**
   - The system automatically prioritizes MongoDB over local storage
   - All data (users, packages, posts, reviews, etc.) stored in MongoDB Atlas
   - Configured in `db-unified.js` to try MongoDB first
   - Set `MONGODB_URI` in environment variables with your Atlas connection string

   **Setup Instructions:**
   - Create a free MongoDB Atlas account at https://cloud.mongodb.com/
   - Follow the [MongoDB Setup Guide](.github/docs/MONGODB_SETUP_SIMPLE.md) for step-by-step instructions
   - Get your connection string and configure it in Railway or your hosting platform
   - **Important**: Never commit your actual connection string to git

   ```env
   # Production MongoDB Configuration
   MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/?retryWrites=true&w=majority
   MONGODB_DB_NAME=eventflow
   ```

2. **Local Storage (Development Only)**
   - If MongoDB is not configured, falls back to local file storage
   - **Not suitable for production** - data is stored in JSON files
   - Useful for quick local development and testing

3. **File Storage (Photos & Media)**
   - Photos and media files are stored locally or in S3
   - Supplier photos are uploaded via the photo upload system
   - Set `STORAGE_TYPE` in `.env` (local or s3)

   ```env
   # Storage Configuration
   STORAGE_TYPE=local  # or 's3' for AWS S3
   ```

4. **How Database Priority Works**:
   - On startup, `db-unified.js` attempts MongoDB connection first (PRIMARY)
   - If MongoDB is not available, falls back to local files (dev only)
   - Check logs on startup for connection status:
     - `✅ Using MongoDB for data storage (PRIMARY)` - Production ready
     - `⚠️  Using local file storage` - Development only, not for production

**To verify your database is connected**: Check server logs after starting the app, or visit `/api/health` endpoint. You should see MongoDB status, not local storage in production.

**Production Deployment Checklist**:

- ✅ MongoDB Atlas account created and cluster configured
- ✅ Database user with read/write permissions created
- ✅ Network access configured (IP whitelist or allow all)
- ✅ `MONGODB_URI` environment variable set in Railway/hosting platform
- ✅ Connection string uses actual credentials (not placeholders)
- ✅ Never commit real credentials to git - use environment variables only

### Email Configuration

EventFlow uses **Postmark exclusively** for all transactional emails:

1. Sign up at https://postmarkapp.com
2. Get your Server API Token from the dashboard
3. Verify your sender domain or email address
4. Create message streams: `outbound` (default), `password-reset`, `broadcasts`
5. Add to `.env`:
   ```bash
   POSTMARK_API_KEY=your-server-token
   POSTMARK_FROM=admin@event-flow.co.uk
   EMAIL_ENABLED=true
   ```

**📖 Full Setup Guide:** See [POSTMARK_SETUP.md](./POSTMARK_SETUP.md) for detailed configuration instructions including webhooks.

During development without Postmark configured, emails are saved to `/outbox` folder for inspection.

**Production Email Checklist**:

- ✅ Postmark account created
- ✅ Server API token obtained
- ✅ Sender domain/email verified in Postmark
- ✅ Message streams configured (outbound, password-reset, broadcasts)
- ✅ `POSTMARK_API_KEY` environment variable set
- ✅ `POSTMARK_FROM` set to verified sender address (admin@event-flow.co.uk)
- ✅ Webhooks configured for delivery tracking (optional but recommended)
- ✅ Never commit API keys to git - use environment variables only

**Webhook URL (optional):** `https://your-domain.com/api/webhooks/postmark`

## 📁 Project Structure

```
eventflow/
├── src/                # Source modules (npm imports)
│   ├── config/        # Configuration files
│   │   └── firebase.js # Firebase stub (not in use - see firebase-config.js)
│   └── firebase.js    # Firebase stub (MongoDB/Cloudinary in use)
├── middleware/         # Reusable middleware functions
│   ├── auth.js        # JWT cookie authentication & authorization
│   ├── validation.js  # Input validation helpers
│   └── rateLimit.js   # Rate limiting configuration
├── routes/            # Modular route handlers
│   ├── auth.js        # Authentication routes
│   └── admin.js       # Admin-only routes
├── models/            # Database models and schemas
├── public/            # Frontend assets
│   ├── assets/
│   │   ├── css/      # Stylesheets
│   │   └── js/       # JavaScript modules
│   └── *.html        # Page templates
├── data/             # JSON data storage (development fallback)
├── photo-upload.js   # Photo upload utilities
├── reviews.js        # Reviews system module
├── search.js         # Search & discovery module
├── websocket-server.js    # Real-time WebSocket server (v1 - legacy)
├── websocket-server-v2.js # Real-time WebSocket server (v2 - modern)
├── server.js         # Main application server
└── package.json      # Dependencies and scripts
```

**WebSocket Server Modes:**

EventFlow includes two WebSocket servers for real-time features. Only ONE can run at a time (configured via `WEBSOCKET_MODE` environment variable):

- **v2** (default, recommended): Modern WebSocket server with real-time messaging, presence tracking, typing indicators, read receipts, and emoji reactions
- **v1** (legacy): Basic WebSocket server for real-time notifications only (backwards compatibility)
- **off**: Disables WebSocket (not recommended - disables all real-time features)

⚠️ **Important**: Running both v1 and v2 simultaneously will cause crashes with "server.handleUpgrade() was called more than once" errors. The `WEBSOCKET_MODE` environment variable ensures only one WebSocket server attaches to the HTTP server.

## 🗄️ Database Schema

**Collections:**

- `users` - Customer, supplier, admin accounts
- `suppliers` - Supplier business profiles
- `packages` - Service packages
- `reviews` - Supplier reviews and ratings
- `messages` - Customer-supplier messages
- `threads` - Message conversations
- `plans` - Customer event plans
- `notes` - Customer planning notes
- `events` - Event records
- `searchHistory` - User search history

All collections have:

- JSON schema validation
- Optimized indexes
- Automatic timestamps

## 🚢 Deployment

**⚠️ First-time deploying?** See the [Production Quick Start](#-quick-start---production-deployment) section at the top!

### Railway

```bash
railway login
railway init
# Set environment variables (use your REAL MongoDB connection string!)
railway variables set JWT_SECRET="..." MONGODB_URI="mongodb+srv://..."
railway up
```

### Heroku

```bash
heroku create eventflow-app
# Set environment variables (use your REAL MongoDB connection string!)
heroku config:set JWT_SECRET="..." MONGODB_URI="mongodb+srv://..."
git push heroku main
```

### DigitalOcean App Platform

```bash
# Configure via dashboard or doctl CLI
doctl apps create --spec .do/app.yaml
```

### AWS EC2 / VPS

See [DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md) for detailed instructions.

## 🧪 Testing & Quality Assurance

EventFlow includes a comprehensive testing framework to ensure code quality and reliability.

### Test Infrastructure

- **Framework:** Jest with Supertest for integration testing
- **Coverage Target:** 70% for all code (branches, functions, lines, statements)
- **Test Types:** Unit tests, integration tests, end-to-end tests

### Running Tests

```bash
# Run all tests with coverage
npm test

# Run tests in watch mode (development)
npm run test:watch

# Run only unit tests
npm run test:unit

# Run only integration tests
npm run test:integration

# Run e2e tests with Playwright
npm run test:e2e
```

### Test Structure

```
tests/
├── fixtures/           # Test data (users, packages, suppliers)
├── utils/              # Test helpers and mock data generators
├── integration/        # Integration tests for routes
│   ├── auth.test.js           # Authentication (25 tests)
│   ├── packages.test.js       # Package management
│   ├── suppliers.test.js      # Supplier operations
│   ├── messaging.test.js      # Messaging system
│   ├── notifications.test.js  # Notifications
│   ├── ai.test.js             # AI features
│   └── ...                    # 40+ test files
└── unit/               # Unit tests for utilities
```

### Integration Test Examples

```javascript
// tests/integration/auth.test.js validates:
// ✓ Registration endpoint structure
// ✓ Login authentication flow
// ✓ Rate limiting enforcement
// ✓ Input validation (email, password)
// ✓ CSRF protection
// ✓ Secure cookie options
// ✓ Password hashing (bcrypt)
// ✓ JWT token generation
```

### Load Testing

EventFlow includes Artillery for load testing critical endpoints.

```bash
# Run load tests against local/staging server
npm run load-test

# Generate HTML report
npm run load-test:report
```

**Load Test Scenarios (tests/load/load-test.yml):**

- Authentication flows (registration, login)
- Search & discovery endpoints
- Package CRUD operations
- AI-powered features
- File uploads
- Real-time notifications
- Mixed traffic patterns (realistic user journeys)

**Load Test Configuration:**

- Warm-up: 60s @ 10 req/s
- Sustained: 120s @ 50 req/s
- Spike: 60s @ 100 req/s

## 📊 Monitoring & Logging

### Winston Logger

Structured logging with multiple transports:

```javascript
const logger = require('./utils/logger');

// Log levels: error, warn, info, debug
logger.info('Server starting...');
logger.error('An error occurred', { error: err });
```

**Features:**

- Console output (colorized in development)
- File rotation (5 files × 5MB each)
- JSON format for structured logs
- Environment-aware logging levels
- Automatic error stack traces

### Morgan HTTP Logging

HTTP request/response logging middleware:

```bash
# Development format (concise)
GET /api/packages 200 45.123 ms

# Production format (detailed)
2026-02-10T16:49:12.481Z GET /api/packages 200 45.123 ms - 1234
```

**Features:**

- Request method, URL, status code
- Response time tracking
- Content-length tracking
- ISO timestamps in production
- Custom tokens for extended info

### Log Files

```
logs/
├── error.log      # Error-level logs only
└── combined.log   # All logs (info, warn, error)
```

**Configuration:**

- Logs directory automatically created
- Files rotate at 5MB
- Keep 5 recent files
- Excluded from git (.gitignore)

### Health Monitoring

```bash
# Check API health
curl https://yourdomain.com/api/health

# Response includes:
# - Status (ok/degraded)
# - Database connection status
# - Uptime
# - Memory usage
# - Environment
```

## 📖 API Documentation

Interactive API documentation powered by Swagger/OpenAPI 3.0:

- **URL:** `https://yourdomain.com/api-docs`
- **Format:** OpenAPI 3.0
- **Features:**
  - Try-it-out functionality
  - Request/response examples
  - Authentication flows
  - Schema definitions

**Documented Endpoints:**

- Authentication (registration, login, password reset)
- Discovery (trending, new arrivals, popular)
- Packages (CRUD operations)
- Suppliers (management, search)
- Reviews & Ratings
- AI-powered features
- Admin operations

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Open Pull Request

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Built with [Express.js](https://expressjs.com/)
- Image processing by [Sharp](https://sharp.pixelplumbing.com/)
- File uploads with [Multer](https://github.com/expressjs/multer)
- Database: [MongoDB](https://www.mongodb.com/)

## 📞 Support

- 📧 Email: support@eventflow.com
- 🐛 Issues: [GitHub Issues](https://github.com/yourusername/eventflow/issues)
- 📖 Docs: [Documentation](API_DOCUMENTATION.md)

## 📚 Documentation

- **[README.md](README.md)** - Overview and quick start
- **[API_DOCUMENTATION.md](API_DOCUMENTATION.md)** - Complete API reference
- **[ADMIN_GUIDE.md](ADMIN_GUIDE.md)** - Admin dashboard user guide
- **[ADMIN_API.md](ADMIN_API.md)** - Admin API endpoint documentation
- **[GDPR_COMPLIANCE.md](GDPR_COMPLIANCE.md)** - Data protection and privacy
- **[DEPLOYMENT_GUIDE.md](DEPLOYMENT_GUIDE.md)** - Production deployment
- **[MONGODB_SETUP.md](.github/docs/MONGODB_SETUP.md)** - Database configuration
- **[MongoDB Migration Plan](docs/mongodb-migration.md)** - Complete MongoDB migration guide
- **[Performance Testing Guide](docs/PERFORMANCE_TESTING.md)** - Performance verification and testing
- **[AWS_SES_SETUP.md](AWS_SES_SETUP.md)** - Email service setup
- **[2FA_IMPLEMENTATION.md](2FA_IMPLEMENTATION.md)** - Two-factor auth (planned)
- **[PWA Icons Guide](docs/PWA_ICONS.md)** - PWA icon assets, locations, and regeneration steps

---

**Version:** v16.3.9 | **Status:** Production Ready ✅
