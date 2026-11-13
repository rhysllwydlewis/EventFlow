# EventFlow API Documentation

## Table of Contents

1. [Overview](#overview)
2. [Getting Started](#getting-started)
3. [Authentication](#authentication)
4. [API Endpoints](#api-endpoints)
5. [Error Handling](#error-handling)
6. [Rate Limiting](#rate-limiting)

## Overview

EventFlow is a comprehensive event services marketplace platform that connects event service suppliers (photographers, venues, caterers, etc.) with customers planning events.

**Base URL**: `http://localhost:3000` (development) or `https://api.eventflow.com` (production)

**API Documentation UI**: Visit `/api-docs` for interactive Swagger UI documentation

## Getting Started

### Prerequisites

- Node.js 16+
- MongoDB (local or Atlas)
- npm or yarn

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/eventflow.git
cd eventflow

# Install dependencies
npm install

# Set up environment variables
cp .env.example .env
# Edit .env with your configuration

# Run database migrations (if using MongoDB)
npm run migrate

# Start the server
npm start
```

The server will start on http://localhost:3000

## Authentication

EventFlow uses **JWT tokens stored in HTTP-only cookies** for authentication.

### Register a New User

```http
POST /api/auth/register
Content-Type: application/json

{
  "name": "John Doe",
  "email": "john@example.com",
  "password": "securePassword123",
  "role": "customer"
}
```

### Login

```http
POST /api/auth/login
Content-Type: application/json

{
  "email": "john@example.com",
  "password": "securePassword123"
}
```

Response includes a cookie with JWT token that's automatically sent with subsequent requests.

### Logout

```http
POST /api/auth/logout
```

### Check Authentication Status

```http
GET /api/auth/me
```

Returns current user information if authenticated.

### Email Verification

```http
GET /api/auth/verify?token=verify_abc123xyz789
```

Verifies a user's email address using the token sent to their email.

### Resend Verification Email

```http
POST /api/auth/resend-verification
Content-Type: application/json

{
  "email": "john@example.com"
}
```

**Response:**

```json
{
  "ok": true,
  "message": "A new verification email has been sent. Please check your inbox."
}
```

**Notes:**

- Rate limited to prevent abuse (100 requests per 15 minutes)
- Returns generic success message to prevent email enumeration
- Previous verification token is invalidated
- New token expires in 24 hours

## API Endpoints

### Search & Discovery

#### Advanced Search

```http
GET /api/search/suppliers?q=photography&category=Photography&location=New%20York&minRating=4&sortBy=rating&page=1&perPage=20
```

**Query Parameters:**

- `q` - Search term (searches name, description, category, location, amenities)
- `category` - Filter by category
- `location` - Filter by location
- `minPrice`, `maxPrice` - Price range filter
- `minRating` - Minimum rating (1-5)
- `amenities` - Comma-separated list of required amenities
- `minGuests` - Minimum guest capacity
- `proOnly` - Show only Pro suppliers (true/false)
- `verifiedOnly` - Show only verified suppliers (true/false)
- `sortBy` - Sort order: `relevance`, `rating`, `reviews`, `name`, `newest`, `priceAsc`, `priceDesc`
- `page` - Page number (default: 1)
- `perPage` - Results per page (default: 20)

**Response:**

```json
{
  "success": true,
  "results": [...],
  "total": 150,
  "page": 1,
  "perPage": 20,
  "totalPages": 8
}
```

#### Get Trending Suppliers

```http
GET /api/discovery/trending?limit=10
```

#### Get New Arrivals

```http
GET /api/discovery/new?limit=10
```

#### Get Popular Packages

```http
GET /api/discovery/popular-packages?limit=10
```

#### Get Personalized Recommendations

```http
GET /api/discovery/recommendations?limit=10
```

Requires authentication. Returns recommendations based on browsing history.

#### Get Categories

```http
GET /api/search/categories
```

Returns all available categories with supplier counts.

#### Get Amenities

```http
GET /api/search/amenities
```

Returns all available amenities with counts.

### Reviews & Ratings

#### Create Review

```http
POST /api/reviews
Content-Type: application/json

{
  "supplierId": "sup_abc123",
  "rating": 5,
  "comment": "Excellent service!",
  "eventType": "Wedding",
  "eventDate": "2024-06-15"
}
```

Requires authentication. Review will be pending until admin approval.

#### Get Supplier Reviews

```http
GET /api/reviews/supplier/sup_abc123?minRating=4&sortBy=helpful
```

**Query Parameters:**

- `minRating` - Filter by minimum rating
- `sortBy` - Sort by `date` or `helpful`

#### Get Rating Distribution

```http
GET /api/reviews/supplier/sup_abc123/distribution
```

Returns distribution of ratings (1-5 stars) for the supplier.

#### Mark Review as Helpful

```http
POST /api/reviews/rev_abc123/helpful
```

#### Delete Review

```http
DELETE /api/reviews/rev_abc123
```

Requires authentication. Can only delete own reviews (or admin can delete any).

### Photo Management

#### Upload Single Photo

```http
POST /api/photos/upload?type=supplier&id=sup_abc123
Content-Type: multipart/form-data

photo: [file]
```

Requires authentication. Uploads photo for supplier, package, or marketplace listing.

**Query Parameters:**

- `type` - Either `supplier`, `package`, or `marketplace`
- `id` - ID of the supplier, package, or marketplace listing

**Supported Formats:** JPEG, PNG, WebP, GIF  
**Max Size:** 10MB per file

**Response:**

```json
{
  "success": true,
  "photo": {
    "url": "https://...",
    "thumbnail": "https://...",
    "large": "https://...",
    "original": "https://...",
    "approved": false,
    "uploadedAt": 1234567890,
    "metadata": {
      "width": 1920,
      "height": 1080,
      "format": "jpeg",
      "size": 524288
    }
  },
  "message": "Photo uploaded successfully. Pending admin approval."
}
```

**Marketplace Response:**

For marketplace type, the response is simplified and returns URLs directly:

```json
{
  "success": true,
  "urls": ["https://...", "https://..."]
}
```

#### Batch Upload Photos

```http
POST /api/photos/upload/batch?type=supplier&id=sup_abc123
Content-Type: multipart/form-data

photos: [file1, file2, file3, ...]
```

Upload up to 10 photos at once for suppliers/packages, or up to 5 photos total for marketplace listings (capped at 5 images per listing).

**Marketplace Listings:**

- Uses `type=marketplace&id=<listingId>`
- Maximum 5 images total per listing
- Requires listing ownership or admin role
- Images are stored directly in the listing's `images` array

#### Delete Photo

```http
DELETE /api/photos/delete?type=supplier&id=sup_abc123&photoUrl=https://...
```

#### Get a Stored Photo

```http
GET /api/photos/photo_abc123
GET /api/photos/photo_abc123?w=640
```

Serves a photo held in storage (public, no authentication). Without `w` the image is returned exactly as stored.

`w` asks for a smaller rendition so a card that shows the photo at roughly 300 px does not download the 1200 px original:

- The width is snapped **up** to one of `160, 240, 320, 480, 640, 800, 1200`. Anything else (non-numeric, zero, or larger than 1200) is ignored and the original is returned.
- The rendition is a WebP when the request sends `Accept: image/webp`, otherwise the same format as the original. The response carries `Vary: Accept`.
- A photo that is already no wider than the requested width is returned unchanged (images are never upscaled), as is any type that cannot be resized (for example GIF) or an image that fails to decode.
- Renditions are cached in memory (150 entries) and the response is cacheable for a year, like the original.

#### Crop Image

```http
POST /api/photos/crop
Content-Type: application/json

{
  "imageUrl": "https://...",
  "cropData": {
    "x": 100,
    "y": 100,
    "width": 800,
    "height": 600
  }
}
```

### Admin Endpoints

All admin endpoints require authentication with admin role.

#### Get Pending Reviews

```http
GET /api/admin/reviews/pending
```

#### Approve/Reject Review

```http
POST /api/admin/reviews/rev_abc123/approve
Content-Type: application/json

{
  "approved": true
}
```

#### Get Pending Photos

```http
GET /api/photos/pending
```

#### Approve/Reject Photo

```http
POST /api/photos/approve
Content-Type: application/json

{
  "type": "supplier",
  "id": "sup_abc123",
  "photoUrl": "https://...",
  "approved": true
}
```

## Error Handling

All errors follow this format:

```json
{
  "error": "Error message",
  "details": "Additional error details (in development mode)"
}
```

**Common HTTP Status Codes:**

- `200` - Success
- `201` - Created
- `400` - Bad Request (invalid input)
- `401` - Unauthorized (not authenticated)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `429` - Too Many Requests (rate limit exceeded)
- `500` - Internal Server Error

## Rate Limiting

### Authentication Endpoints

- **Limit:** 100 requests per 15 minutes
- **Applies to:** `/api/auth/*`

### Write Operations

- **Limit:** 80 requests per 10 minutes
- **Applies to:** POST, PUT, DELETE operations

Rate limit headers are included in responses:

```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1234567890
```

## Image Processing

All uploaded images are automatically processed into multiple sizes:

1. **Thumbnail** - 300x300px, 80% quality, cover fit
2. **Optimized** - 1200x1200px max, 85% quality, inside fit
3. **Large** - 2000x2000px max, 90% quality, inside fit
4. **Original** - Preserved for backup

Images are converted to JPEG format with progressive loading and optimized using mozjpeg.

## Storage Options

### Local Storage (Development)

Images stored in `/uploads` directory and served at `/uploads/*`

### AWS S3 (Production)

Configure these environment variables:

```
AWS_S3_BUCKET=your-bucket-name
AWS_S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
```

When S3 is configured, images are automatically uploaded to S3 and URLs point to S3.

## Best Practices

1. **Always check authentication status** before making protected API calls
2. **Handle rate limits** gracefully with exponential backoff
3. **Validate file sizes** on the client before uploading
4. **Use pagination** for large result sets
5. **Cache search results** when appropriate
6. **Respect photo approval workflow** - display only approved photos to end users

## Support

For issues or questions:

- GitHub Issues: https://github.com/yourusername/eventflow/issues
- Email: support@eventflow.com
- Documentation: https://docs.eventflow.com
