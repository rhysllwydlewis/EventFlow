# EventFlow Deployment Guide

## Table of Contents

1. [Local Development Setup](#local-development-setup)
2. [Production Deployment](#production-deployment)
3. [Environment Configuration](#environment-configuration)
4. [Database Setup](#database-setup)
5. [Cloud Storage Setup](#cloud-storage-setup)
6. [Monitoring & Maintenance](#monitoring--maintenance)
7. [Troubleshooting](#troubleshooting)

## Local Development Setup

### Prerequisites

- **Node.js** v20.x LTS (Node 22+ not supported due to sharp compatibility)
- **npm** v8.0.0 or higher
- **MongoDB** v6.0 or higher (optional - can use MongoDB Atlas)
- **Git** for version control

### Step 1: Clone and Install

```bash
# Clone the repository
git clone https://github.com/yourusername/eventflow.git
cd eventflow

# Install dependencies
npm install
```

### Step 2: Environment Configuration

```bash
# Copy example environment file
cp .env.example .env

# Generate a secure JWT secret
openssl rand -base64 32

# Edit .env with your configuration
nano .env
```

**Minimum required settings for local development:**

```env
JWT_SECRET=your-generated-secret-here
MONGODB_LOCAL_URI=mongodb://localhost:27017/eventflow
PORT=3000
NODE_ENV=development
BASE_URL=http://localhost:3000
EMAIL_ENABLED=false
```

### Step 3: Database Setup

**Option A: Local MongoDB**

```bash
# Install MongoDB (macOS with Homebrew)
brew tap mongodb/brew
brew install mongodb-community@6.0

# Start MongoDB
brew services start mongodb-community@6.0

# Verify MongoDB is running
mongo --eval "db.version()"
```

**Option B: MongoDB Atlas (Cloud)**

1. Sign up at https://www.mongodb.com/cloud/atlas
2. Create a free cluster
3. Get your connection string
4. Add to `.env`:
   ```env
   MONGODB_URI=mongodb+srv://<USERNAME>:<PASSWORD>@<CLUSTER>.mongodb.net/eventflow?retryWrites=true&w=majority
   ```

### Step 4: Run Migrations

```bash
# Initialize database and create collections with schemas
npm run migrate
```

This will:

- Connect to MongoDB
- Create all collections with validation schemas
- Create indexes for performance
- Migrate existing JSON data (if any)

### Step 5: Start the Server

```bash
# Development mode (auto-restart on changes if using nodemon)
npm run dev

# Production mode
npm start
```

Server will start at http://localhost:3000

### Step 6: Verify Installation

Visit these URLs to verify:

- **Homepage:** http://localhost:3000
- **API Health:** http://localhost:3000/api/health
- **API Docs:** http://localhost:3000/api-docs
- **Gallery:** http://localhost:3000/gallery.html

## Production Deployment

### Platform Options

#### Option 1: Railway

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login
railway login

# Initialize project
railway init

# Add environment variables
railway variables set JWT_SECRET="your-secret"
railway variables set MONGODB_URI="your-atlas-connection"
railway variables set NODE_ENV="production"

# Deploy
railway up
```

#### Option 2: Heroku

```bash
# Install Heroku CLI
brew install heroku/brew/heroku

# Login
heroku login

# Create app
heroku create eventflow-app

# Add MongoDB addon
heroku addons:create mongodb:sandbox

# Set environment variables
heroku config:set JWT_SECRET="your-secret"
heroku config:set NODE_ENV="production"
heroku config:set EMAIL_ENABLED="true"

# Deploy
git push heroku main
```

#### Option 3: DigitalOcean App Platform

```bash
# Create app.yaml
cat > .do/app.yaml << EOF
name: eventflow
services:
  - name: api
    github:
      repo: yourusername/eventflow
      branch: main
    build_command: npm install
    run_command: npm start
    envs:
      - key: JWT_SECRET
        value: ${JWT_SECRET}
      - key: MONGODB_URI
        value: ${MONGODB_URI}
      - key: NODE_ENV
        value: production
    instance_count: 1
    instance_size_slug: basic-xs
databases:
  - name: eventflow-db
    engine: MONGODB
    version: "6"
EOF
```

Then deploy via DigitalOcean dashboard or CLI.

#### Option 4: AWS EC2 (Manual)

```bash
# SSH into your EC2 instance
ssh -i your-key.pem ubuntu@your-ec2-ip

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install MongoDB
wget -qO - https://www.mongodb.org/static/pgp/server-6.0.asc | sudo apt-key add -
echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/6.0 multiverse" | sudo tee /etc/apt/sources.list.d/mongodb-org-6.0.list
sudo apt-get update
sudo apt-get install -y mongodb-org

# Start MongoDB
sudo systemctl start mongod
sudo systemctl enable mongod

# Clone and setup app
git clone https://github.com/yourusername/eventflow.git
cd eventflow
npm install

# Set up environment
nano .env
# Add your production settings

# Use PM2 for process management
sudo npm install -g pm2
pm2 start server.js --name eventflow
pm2 save
pm2 startup
```

### Reverse Proxy with Nginx

**Important:** When running behind a reverse proxy (Nginx, Railway, Heroku, etc.), you must enable Express trust proxy setting for proper IP detection and rate limiting. EventFlow automatically enables this on Railway, or you can manually set `TRUST_PROXY=true` in your environment variables.

```nginx
# /etc/nginx/sites-available/eventflow
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Increase upload size for photos
    client_max_body_size 20M;
}
```

**Trust Proxy Configuration:**

When deploying behind a reverse proxy or load balancer, set the `TRUST_PROXY` environment variable to enable proper IP detection:

```bash
# Enable trust proxy (required for Railway, Heroku, load balancers, Nginx)
TRUST_PROXY=true
```

This setting:

- Enables proper client IP detection from `X-Forwarded-For` headers
- Fixes rate limiting to work correctly behind proxies
- Allows `X-Forwarded-Proto` to be trusted for protocol detection
- **Required on Railway** to avoid `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` errors

**Note:** EventFlow automatically enables trust proxy when `RAILWAY_ENVIRONMENT` is detected, but you can explicitly control it via the `TRUST_PROXY` variable. For local development, this defaults to `false` to avoid unexpected behavior.

```bash
# Enable site and restart nginx
sudo ln -s /etc/nginx/sites-available/eventflow /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

### SSL with Let's Encrypt

```bash
# Install certbot
sudo apt-get install certbot python3-certbot-nginx

# Get certificate
sudo certbot --nginx -d yourdomain.com

# Verify auto-renewal
sudo certbot renew --dry-run
```

## Environment Configuration

### Production Environment Variables

```env
# Security (REQUIRED)
JWT_SECRET=very-long-random-secret-at-least-32-chars

# Database
MONGODB_URI=mongodb+srv://<USERNAME>:<PASSWORD>@<CLUSTER>.mongodb.net/eventflow?retryWrites=true&w=majority
MONGODB_DB_NAME=eventflow

# Server
PORT=3000
NODE_ENV=production
BASE_URL=https://yourdomain.com

# Trust proxy (for Railway, Heroku, or reverse proxy deployments)
# Automatically enabled on Railway, or set to 'true' manually
TRUST_PROXY=true

# Email (REQUIRED for production)
EMAIL_ENABLED=true
FROM_EMAIL=no-reply@yourdomain.com
SENDGRID_API_KEY=SG.your-api-key

# OR SMTP
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# AWS S3 (Recommended for production)
AWS_S3_BUCKET=eventflow-photos
AWS_S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key

# Optional: Payment Processing
STRIPE_SECRET_KEY=sk_live_...
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_SUPPLIER_PRICE_ID=price_...

# Optional: AI Features
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4-turbo-mini
```

## Database Setup

### Production Database Options

EventFlow supports three database modes:

1. **MongoDB Atlas (Recommended for Production)** - Cloud-hosted, persistent, scalable
2. **Firebase Firestore** - Cloud-hosted, persistent, real-time capabilities
3. **Local JSON Storage (Fallback)** - Non-persistent, data lost on restart

⚠️ **IMPORTANT:** While EventFlow can run without a cloud database using local JSON storage, this mode is **not recommended for production** with real user data. Data is stored in local files and will be **permanently lost on server restart or redeployment**.

For production deployments:

- Use MongoDB Atlas or Firebase Firestore for data persistence
- Local storage mode is suitable only for testing, demos, or temporary deployments
- A clear warning will be displayed at startup when running in local storage mode

### MongoDB Atlas Production Setup

1. **Create Production Cluster**
   - Go to https://cloud.mongodb.com
   - Create new cluster (M10+ for production)
   - Choose your region
   - Configure backup (enabled by default)

2. **Security Configuration**
   - Database Access: Create user with read/write permissions
   - Network Access: Add your server's IP addresses
   - Enable IP Whitelist

3. **Get Connection String**

   ```
   mongodb+srv://<USERNAME>:<PASSWORD>@<CLUSTER>.mongodb.net/eventflow?retryWrites=true&w=majority
   ```

4. **Performance Optimization**
   - Enable connection pooling (already configured in `db.js`)
   - Monitor slow queries
   - Set up alerts for high CPU/memory usage

### Backup Strategy

```bash
# Manual backup with mongodump
mongodump --uri="mongodb+srv://..." --out=/backups/$(date +%Y%m%d)

# Restore from backup
mongorestore --uri="mongodb+srv://..." /backups/20240101

# Automated backups (add to crontab)
0 2 * * * mongodump --uri="$MONGODB_URI" --out=/backups/$(date +\%Y\%m\%d) && find /backups -mtime +7 -delete
```

## Cloud Storage Setup

### AWS S3 Configuration

1. **Create S3 Bucket**

   ```bash
   # Using AWS CLI
   aws s3 mb s3://eventflow-photos --region us-east-1
   ```

2. **Set Bucket Policy (Public Read)**

   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Sid": "PublicReadGetObject",
         "Effect": "Allow",
         "Principal": "*",
         "Action": "s3:GetObject",
         "Resource": "arn:aws:s3:::eventflow-photos/*"
       }
     ]
   }
   ```

3. **Enable CORS**

   ```json
   [
     {
       "AllowedHeaders": ["*"],
       "AllowedMethods": ["GET", "POST", "PUT"],
       "AllowedOrigins": ["https://yourdomain.com"],
       "ExposeHeaders": []
     }
   ]
   ```

4. **Create IAM User**
   - Create user: `eventflow-s3-user`
   - Attach policy: `AmazonS3FullAccess` (or custom policy for specific bucket)
   - Save access key and secret

5. **Configure CDN (Optional - CloudFront)**
   - Create CloudFront distribution
   - Origin: Your S3 bucket
   - Update `BASE_URL` to use CloudFront URL for faster delivery

## Monitoring & Maintenance

### Health Checks

```bash
# API health endpoint
curl https://yourdomain.com/api/health

# Should return:
# {"ok":true,"version":"v16.3.9","status":"online","time":"2024-01-01T00:00:00.000Z"}
```

### Logging

```javascript
// Application logs with PM2
pm2 logs eventflow

// Error logs only
pm2 logs eventflow --err

// Follow logs
pm2 logs eventflow --lines 100
```

### Performance Monitoring

**Recommended Tools:**

- **Sentry** - Error tracking
- **New Relic** - APM
- **DataDog** - Infrastructure monitoring
- **Uptime Robot** - Uptime monitoring

### Database Monitoring

```javascript
// Monitor MongoDB performance
use eventflow
db.currentOp()
db.serverStatus()
db.stats()

// Check slow queries
db.setProfilingLevel(1, { slowms: 100 })
db.system.profile.find().limit(5).sort({ ts: -1 }).pretty()
```

## Troubleshooting

### Server won't start

```bash
# Check if port is already in use
lsof -i :3000

# Check Node.js version
node --version  # Should be 16+

# Check for missing dependencies
npm install

# Check environment variables
printenv | grep -E "JWT_SECRET|MONGODB"
```

### Database connection fails

```bash
# Test MongoDB connection
mongosh "mongodb+srv://..."

# Check network access in MongoDB Atlas
# Verify IP whitelist includes your server

# Check credentials
# Verify username/password in connection string
```

### Photos not uploading

```bash
# Check upload directory permissions
ls -la uploads/

# Create directories if missing
mkdir -p uploads/{original,thumbnails,optimized}
chmod 755 uploads

# Check disk space
df -h

# For S3: Verify AWS credentials
aws s3 ls s3://eventflow-photos --profile eventflow
```

### Performance issues

```bash
# Check Node.js memory usage
pm2 monit

# Increase memory limit if needed
pm2 start server.js --max-memory-restart 1G

# Enable database indexes
npm run migrate

# Monitor slow queries
# Use MongoDB Atlas performance advisor
```

### SSL certificate issues

```bash
# Renew Let's Encrypt certificate
sudo certbot renew

# Test SSL configuration
curl -vI https://yourdomain.com

# Check certificate expiration
echo | openssl s_client -servername yourdomain.com -connect yourdomain.com:443 2>/dev/null | openssl x509 -noout -dates
```

## Security Checklist

- [ ] Set strong `JWT_SECRET` (32+ random characters)
- [ ] Enable HTTPS/SSL for production
- [ ] Configure MongoDB authentication
- [ ] Whitelist IP addresses in MongoDB Atlas
- [ ] Keep dependencies updated (`npm audit`)
- [ ] Enable rate limiting (already configured)
- [ ] Use environment variables for secrets (never commit `.env`)
- [ ] Enable CORS only for your domains
- [ ] Implement CSRF protection for sensitive operations
- [ ] Regular security audits
- [ ] Enable database backups
- [ ] Monitor error logs for suspicious activity

## Performance Optimization

- [ ] Enable gzip compression
- [ ] Implement caching (Redis recommended)
- [ ] Use CDN for static assets and images
- [ ] Optimize database queries with proper indexes
- [ ] Implement pagination for large result sets
- [ ] Lazy load images on frontend
- [ ] Minify CSS/JS assets
- [ ] Enable HTTP/2
- [ ] Use PM2 cluster mode for multi-core servers
- [ ] Monitor and optimize slow API endpoints

## Support Resources

- **Documentation:** See `API_DOCUMENTATION.md`
- **MongoDB Setup:** See `MONGODB_SETUP.md`
- **GitHub Issues:** https://github.com/yourusername/eventflow/issues
- **MongoDB Docs:** https://docs.mongodb.com/
- **AWS S3 Docs:** https://docs.aws.amazon.com/s3/
- **Node.js Docs:** https://nodejs.org/docs/
