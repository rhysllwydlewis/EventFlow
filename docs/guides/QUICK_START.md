# Quick Start Guide - EventFlow

## For Developers

### Local Development Setup

1. **Clone and Install**

   ```bash
   git clone https://github.com/rhysllwydlewis/eventflow.git
   cd eventflow
   npm install
   ```

2. **Environment Setup**

   ```bash
   cp .env.example .env
   # Edit .env with your MongoDB connection string and other settings
   ```

3. **Start Local Development**

   ```bash
   npm run dev
   ```

   Visit http://localhost:3000

### Architecture Overview

EventFlow uses:

- **Database**: MongoDB (primary) with fallback to local file storage (dev only)
- **Authentication**: JWT-based cookie auth (not localStorage bearer tokens)
- **Image Storage**: Cloudinary for cloud storage or local filesystem
- **Email**: Postmark for transactional emails
- **Payments**: Stripe for subscription payments (not Google Pay)

### Key Files to Know

| File                               | Purpose                    | When to Edit                      |
| ---------------------------------- | -------------------------- | --------------------------------- |
| `server.js`                        | Main Express server        | Add routes, middleware            |
| `middleware/auth.js`               | JWT cookie authentication  | Modify auth logic                 |
| `public/assets/js/auth-nav.js`     | Navigation auth state      | Update dashboard routing          |
| `public/assets/js/admin-shared.js` | Admin API helper with CSRF | Add admin utility functions       |
| `routes/admin.js`                  | Admin API endpoints        | Add admin features                |
| `db-unified.js`                    | Database abstraction layer | Modify database operations        |
| `.env`                             | Environment configuration  | Set MongoDB URI, JWT secret, etc. |

### Authentication Flow

EventFlow uses **cookie-based JWT authentication**:

1. User logs in at `/auth.html`
2. Server validates credentials and sets `token` cookie (httpOnly, secure in production)
3. Frontend makes requests with `credentials: 'include'` (not Authorization header)
4. Server validates cookie via `middleware/auth.js`
5. CSRF token is fetched from `/api/csrf-token` and stored in `window.__CSRF_TOKEN__`
6. State-changing requests include `X-CSRF-Token` header

### Common Tasks

#### Add a New Admin Feature

1. Add route in `routes/admin.js`:

   ```javascript
   router.get('/my-feature', authRequired, roleRequired('admin'), async (req, res) => {
     // Your logic here
     res.json({ data: 'value' });
   });
   ```

2. Call from frontend using AdminShared helper:

   ```javascript
   const data = await AdminShared.api('/api/admin/my-feature');
   ```

#### Update Dashboard

Edit the appropriate dashboard file:

- Admin: `public/admin.html`
- Supplier: `public/dashboard-supplier.html`
- Customer: `public/dashboard-customer.html`

#### Modify Feature Access

Edit role-based middleware in `middleware/auth.js`:

```javascript
function roleRequired(role) {
  return (req, res, next) => {
    if (req.user.role !== role) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}
```

#### Add Email Templates

1. Create template in `email-templates/`
2. Use Postmark service in `services/email.js`
3. Test locally (emails saved to `/outbox` if Postmark not configured)

### Debugging

#### View Application Logs

```bash
# Check server logs
npm run dev
# Monitor MongoDB connection and queries in the terminal
```

#### Check Database

```bash
# MongoDB Atlas: https://cloud.mongodb.com/
# Or use MongoDB Compass to connect locally
```

### Deployment

#### Deploy to Railway

```bash
railway login
railway init
# Set environment variables (use your REAL MongoDB connection string!)
railway variables set JWT_SECRET="..." MONGODB_URI="mongodb+srv://..."
railway up
```

#### Deploy to Heroku

```bash
heroku create eventflow-app
# Set environment variables
heroku config:set JWT_SECRET="..." MONGODB_URI="mongodb+srv://..."
git push heroku main
```

### Environment Variables

**Required for production:**

```bash
MONGODB_URI=mongodb+srv://<USERNAME>:<PASSWORD>@<CLUSTER>.mongodb.net/eventflow
JWT_SECRET=your-secret-key-min-32-chars
NODE_ENV=production
BASE_URL=https://yourdomain.com

# WebSocket Configuration (optional)
WEBSOCKET_MODE=v2  # Options: v2 (default, recommended), v1 (legacy), or off
```

**Recommended:**

```bash
# Email (Postmark)
POSTMARK_API_KEY=your-server-token
POSTMARK_FROM=admin@yourdomain.com
EMAIL_ENABLED=true

# Image storage (Cloudinary)
CLOUDINARY_CLOUD_NAME=your-cloud
CLOUDINARY_API_KEY=your-key
CLOUDINARY_API_SECRET=your-secret
```

**WebSocket Modes:**

- `v2` (default): Modern WebSocket server with real-time messaging, presence tracking, typing indicators, and read receipts
- `v1`: Legacy WebSocket server for basic real-time notifications (backwards compatibility only)
- `off`: Disables WebSocket servers (not recommended - disables real-time features)

⚠️ **Important**: Only ONE WebSocket server can run at a time. WEBSOCKET_MODE ensures that v1 and v2 don't both attach to the HTTP server, which would cause crashes.

See `.env.example` for all options.

### Testing

```bash
# Run linter
npm run lint

# Run tests
npm test

# Run specific test suite
npm run test:unit
npm run test:integration
```

### Troubleshooting

| Issue                             | Solution                                                           |
| --------------------------------- | ------------------------------------------------------------------ |
| "Unauthenticated" errors          | Check cookie is being sent (`credentials: 'include'`)              |
| CSRF token missing                | Ensure `auth-nav.js` loaded and `window.__CSRF_TOKEN__` available  |
| Database connection failed        | Verify `MONGODB_URI` in environment, check network access in Atlas |
| Admin pages not loading           | Check user role is 'admin', verify `middleware/auth.js` role check |
| Dashboard redirects to wrong page | Check `auth-nav.js` dashboard routing logic                        |

### Security Checklist

- [x] JWT tokens stored in httpOnly cookies (not localStorage)
- [x] CSRF protection on state-changing requests
- [x] Input validation and sanitization
- [x] Rate limiting on auth endpoints
- [x] Helmet security headers enabled
- [ ] Never commit `.env` files
- [ ] Use strong JWT_SECRET (min 32 chars)
- [ ] Use HTTPS only in production

### Resources

- 📚 [README.md](./README.md) - Full documentation
- 📚 [API Documentation](./API_DOCUMENTATION.md) - Complete API reference
- 📚 [Admin Guide](./ADMIN_GUIDE.md) - Admin dashboard user guide
- 📚 [MongoDB Setup](./.github/docs/MONGODB_SETUP_SIMPLE.md) - Database configuration
- 📚 [Postmark Setup](./POSTMARK_SETUP.md) - Email configuration
- 📚 [Stripe Integration](./STRIPE_INTEGRATION_GUIDE.md) - Payment setup

### Getting Help

1. Check server logs: `npm run dev` output
2. Review documentation in this repo
3. Check MongoDB Atlas for connection issues
4. Review Express route handlers in `routes/`
5. Contact the development team

---

**Quick Links:**

- [Admin Dashboard](http://localhost:3000/admin.html)
- [Supplier Dashboard](http://localhost:3000/dashboard-supplier.html)
- [Customer Dashboard](http://localhost:3000/dashboard-customer.html)
- [API Documentation](http://localhost:3000/api-docs)
