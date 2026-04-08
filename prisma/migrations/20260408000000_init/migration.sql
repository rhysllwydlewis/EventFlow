-- EventFlow initial PostgreSQL schema (PR1 Foundation)
-- Generated from prisma/schema.prisma via: prisma migrate diff --from-empty --to-schema-datamodel
--
-- Design notes
-- ============
-- 1. packages.categories / eventTypes are TEXT[] with GIN indexes for efficient
--    overlap/contains queries (Postgres equivalent of MongoDB $in on array fields).
--
-- 2. conversations_v4.participants / .metadata / .context are JSONB.
--    Participants will be normalised into a conversation_participants table in PR4.
--
-- 3. TTL columns (notifications.expires_at, link_previews.expires_at,
--    webhook_events.expires_at) are created here.  pg_cron cleanup jobs will be
--    added in PR3.
--
-- 4. Sparse/partial indexes mirror MongoDB sparse indexes:
--      packages.slug, badges.slug              WHERE col IS NOT NULL
--      payments.*stripe*                        WHERE col IS NOT NULL
--      subscriptions.stripe_subscription_id    WHERE col IS NOT NULL
--      subscriptions.next_billing_date          WHERE col IS NOT NULL
--      invoices.stripe_invoice_id               WHERE col IS NOT NULL
--      invoices.due_date                        WHERE col IS NOT NULL

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "firstName" TEXT,
    "lastName" TEXT,
    "role" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "location" TEXT,
    "postcode" TEXT,
    "company" TEXT,
    "jobTitle" TEXT,
    "website" TEXT,
    "socials" JSONB,
    "avatarUrl" TEXT,
    "notify" BOOLEAN,
    "notifyAccount" BOOLEAN,
    "notifyMarketing" BOOLEAN,
    "marketingOptIn" BOOLEAN,
    "verified" BOOLEAN,
    "verificationToken" TEXT,
    "verificationTokenExpiresAt" TEXT,
    "emailVerified" BOOLEAN,
    "emailVerificationToken" TEXT,
    "emailVerificationExpires" TEXT,
    "phoneNumber" TEXT,
    "phoneVerified" BOOLEAN,
    "phoneVerificationCode" TEXT,
    "phoneVerificationExpires" TEXT,
    "phoneNumberToVerify" TEXT,
    "twoFactorEnabled" BOOLEAN,
    "twoFactorSecret" TEXT,
    "twoFactorBackupCodes" TEXT[],
    "resetToken" TEXT,
    "resetTokenExpiresAt" TEXT,
    "isPro" BOOLEAN,
    "subscriptionId" TEXT,
    "badges" TEXT[],
    "createdAt" TEXT,
    "lastLoginAt" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "name" TEXT NOT NULL,
    "logo" TEXT,
    "blurb" TEXT,
    "category" TEXT NOT NULL,
    "location" TEXT,
    "priceDisplay" TEXT,
    "website" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "license" TEXT,
    "amenities" TEXT[],
    "maxGuests" INTEGER,
    "descriptionShort" TEXT,
    "descriptionLong" TEXT,
    "photosGallery" JSONB,
    "bannerUrl" TEXT,
    "tagline" TEXT,
    "highlights" TEXT[],
    "featuredServices" TEXT[],
    "themeColor" TEXT,
    "socialLinks" JSONB,
    "approved" BOOLEAN,
    "isPro" BOOLEAN,
    "proExpiresAt" TEXT,
    "aiTags" TEXT[],
    "aiScore" DOUBLE PRECISION,
    "aiUpdatedAt" TEXT,
    "badges" TEXT[],
    "isTest" BOOLEAN,
    "seedBatch" TEXT,
    "createdAt" TEXT,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "packages" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT,
    "description" TEXT,
    "price" TEXT,
    "priceDisplay" TEXT,
    "location" TEXT,
    "image" TEXT,
    "gallery" JSONB,
    "categories" TEXT[],
    "primaryCategoryKey" TEXT,
    "eventTypes" TEXT[],
    "tags" TEXT[],
    "approved" BOOLEAN,
    "featured" BOOLEAN,
    "isFeatured" BOOLEAN,
    "isTest" BOOLEAN,
    "seedBatch" TEXT,
    "createdAt" TEXT,

    CONSTRAINT "packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "categories" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "heroImage" TEXT,
    "icon" TEXT,
    "order" INTEGER,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "supplierId" TEXT,
    "plan" JSONB,
    "eventType" TEXT,
    "eventName" TEXT,
    "location" TEXT,
    "date" TEXT,
    "guests" INTEGER,
    "budget" TEXT,
    "packages" TEXT[],
    "createdAt" TEXT,
    "updatedAt" TEXT,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notes" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "text" TEXT,
    "createdAt" TEXT,
    "updatedAt" TEXT,

    CONSTRAINT "notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "title" TEXT,
    "date" TEXT,
    "location" TEXT,
    "description" TEXT,
    "createdAt" TEXT,
    "updatedAt" TEXT,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "badges" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "color" TEXT,
    "autoAssign" BOOLEAN,
    "autoAssignCriteria" JSONB,
    "displayOrder" INTEGER,
    "active" BOOLEAN,
    "createdAt" TEXT,
    "updatedAt" TEXT,

    CONSTRAINT "badges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "stripePaymentId" TEXT,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "userId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "type" TEXT,
    "subscriptionDetails" JSONB,
    "metadata" JSONB,
    "createdAt" TEXT,
    "updatedAt" TEXT,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT,
    "stripeCustomerId" TEXT,
    "plan" TEXT NOT NULL,
    "pendingPlan" TEXT,
    "status" TEXT NOT NULL,
    "trialStart" TEXT,
    "trialEnd" TEXT,
    "currentPeriodStart" TEXT,
    "currentPeriodEnd" TEXT,
    "nextBillingDate" TEXT,
    "cancelAtPeriodEnd" BOOLEAN,
    "canceledAt" TEXT,
    "cancelReason" TEXT,
    "billingHistory" JSONB,
    "metadata" JSONB,
    "createdAt" TEXT,
    "updatedAt" TEXT,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "userId" TEXT NOT NULL,
    "stripeInvoiceId" TEXT,
    "stripePaymentIntentId" TEXT,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "dueDate" TEXT,
    "paidAt" TEXT,
    "lineItems" JSONB,
    "metadata" JSONB,
    "createdAt" TEXT,
    "updatedAt" TEXT,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reviews" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userName" TEXT,
    "rating" INTEGER NOT NULL,
    "title" TEXT,
    "comment" TEXT,
    "recommend" BOOLEAN,
    "eventType" TEXT,
    "eventDate" TEXT,
    "verified" BOOLEAN,
    "emailVerified" BOOLEAN,
    "approved" BOOLEAN,
    "approvedAt" TEXT,
    "approvedBy" TEXT,
    "flagged" BOOLEAN,
    "flagReason" TEXT[],
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "helpfulCount" INTEGER,
    "unhelpfulCount" INTEGER,
    "supplierResponse" JSONB,
    "createdAt" TEXT,
    "updatedAt" TEXT,

    CONSTRAINT "reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_votes" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "userId" TEXT,
    "voteType" TEXT NOT NULL,
    "ipAddress" TEXT,
    "createdAt" TEXT,

    CONSTRAINT "review_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_analytics" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "averageRating" DOUBLE PRECISION,
    "totalReviews" INTEGER,
    "ratingDistribution" JSONB,
    "recommendationRate" DOUBLE PRECISION,
    "trustScore" DOUBLE PRECISION,
    "responseRate" DOUBLE PRECISION,
    "averageResponseTime" DOUBLE PRECISION,
    "badges" TEXT[],
    "lastCalculated" TEXT,
    "updatedAt" TEXT,

    CONSTRAINT "supplier_analytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_moderations" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "moderatorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "notes" TEXT,
    "previousState" JSONB,
    "createdAt" TEXT,

    CONSTRAINT "review_moderations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" TEXT NOT NULL,
    "type" TEXT,
    "targetId" TEXT,
    "reportedBy" TEXT,
    "status" TEXT,
    "reason" TEXT,
    "details" TEXT,
    "createdAt" TEXT,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations_v4" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "participants" JSONB NOT NULL,
    "context" JSONB,
    "lastMessage" JSONB,
    "metadata" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TEXT,
    "updatedAt" TEXT,

    CONSTRAINT "conversations_v4_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_messages_v4" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "content" TEXT,
    "type" TEXT NOT NULL DEFAULT 'text',
    "reactions" JSONB,
    "readBy" JSONB,
    "replyToId" TEXT,
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "isEdited" BOOLEAN NOT NULL DEFAULT false,
    "editedAt" TEXT,
    "attachments" JSONB,
    "createdAt" TEXT,
    "updatedAt" TEXT,

    CONSTRAINT "chat_messages_v4_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "threads" (
    "id" TEXT NOT NULL,
    "participantIds" TEXT[],
    "subject" TEXT,
    "createdAt" TEXT,
    "updatedAt" TEXT,

    CONSTRAINT "threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "recipientId" TEXT,
    "content" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TEXT,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "actionUrl" TEXT,
    "actionText" TEXT,
    "icon" TEXT,
    "priority" TEXT,
    "category" TEXT,
    "metadata" JSONB,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TEXT,
    "isDismissed" BOOLEAN NOT NULL DEFAULT false,
    "dismissedAt" TEXT,
    "expiresAt" TEXT,
    "createdAt" TEXT,
    "updatedAt" TEXT,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actor" JSONB,
    "action" TEXT,
    "resource" JSONB,
    "changes" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "details" JSONB,
    "timestamp" TEXT,
    "createdAt" TEXT,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "search_history" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "sessionId" TEXT,
    "queryText" TEXT,
    "filters" JSONB,
    "resultsCount" INTEGER,
    "timestamp" TEXT,
    "createdAt" TEXT,

    CONSTRAINT "search_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "enquiries" INTEGER NOT NULL DEFAULT 0,
    "viewDetails" JSONB,
    "createdAt" TEXT,
    "updatedAt" TEXT,

    CONSTRAINT "analytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "link_previews" (
    "id" TEXT NOT NULL,
    "url" TEXT,
    "normalizedUrl" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "image" TEXT,
    "siteName" TEXT,
    "favicon" TEXT,
    "mediaType" TEXT,
    "metadata" JSONB,
    "fetchedAt" TEXT,
    "expiresAt" TEXT,
    "fetchError" TEXT,
    "createdAt" TEXT,

    CONSTRAINT "link_previews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "source" TEXT,
    "payload" JSONB,
    "expiresAt" TEXT,
    "createdAt" TEXT,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_images" (
    "id" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "imageData" TEXT,
    "size" TEXT,
    "mimeType" TEXT,
    "fileSize" INTEGER,
    "url" TEXT,
    "order" INTEGER,
    "filename" TEXT,
    "uploadedAt" TEXT,

    CONSTRAINT "marketplace_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_listings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "approved" BOOLEAN,
    "status" TEXT,
    "locationCoordinates" JSONB,
    "createdAt" TEXT,
    "updatedAt" TEXT,

    CONSTRAINT "marketplace_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_logs" (
    "id" TEXT NOT NULL,
    "messageId" TEXT,
    "recipient" TEXT,
    "subject" TEXT,
    "status" TEXT,
    "rawData" JSONB,
    "createdAt" TEXT,
    "updatedAt" TEXT,

    CONSTRAINT "email_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_bounces" (
    "id" TEXT NOT NULL,
    "messageId" TEXT,
    "email" TEXT,
    "bounceType" TEXT,
    "description" TEXT,
    "rawData" JSONB,
    "createdAt" TEXT,

    CONSTRAINT "email_bounces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_opens" (
    "id" TEXT NOT NULL,
    "messageId" TEXT,
    "email" TEXT,
    "userAgent" TEXT,
    "rawData" JSONB,
    "createdAt" TEXT,

    CONSTRAINT "email_opens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_clicks" (
    "id" TEXT NOT NULL,
    "messageId" TEXT,
    "email" TEXT,
    "clickedLink" TEXT,
    "userAgent" TEXT,
    "rawData" JSONB,
    "createdAt" TEXT,

    CONSTRAINT "email_clicks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_complaints" (
    "id" TEXT NOT NULL,
    "messageId" TEXT,
    "email" TEXT,
    "rawData" JSONB,
    "createdAt" TEXT,

    CONSTRAINT "email_complaints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partners" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "refCode" TEXT NOT NULL,
    "status" TEXT,
    "data" JSONB,
    "createdAt" TEXT,
    "updatedAt" TEXT,

    CONSTRAINT "partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_referrals" (
    "id" TEXT NOT NULL,
    "supplierUserId" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "attributionExpiresAt" TEXT,
    "data" JSONB,
    "createdAt" TEXT,
    "updatedAt" TEXT,

    CONSTRAINT "partner_referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_credit_transactions" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT NOT NULL,
    "supplierUserId" TEXT,
    "type" TEXT,
    "amount" DOUBLE PRECISION,
    "description" TEXT,
    "data" JSONB,
    "createdAt" TEXT,

    CONSTRAINT "partner_credit_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_calendar_events" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startDate" TEXT NOT NULL,
    "endDate" TEXT,
    "location" TEXT,
    "category" TEXT,
    "imageUrl" TEXT,
    "externalUrl" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "updatedByUserId" TEXT,
    "createdAt" TEXT,
    "updatedAt" TEXT,

    CONSTRAINT "public_calendar_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_calendar_entries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "time" TEXT,
    "description" TEXT,
    "createdAt" TEXT,
    "updatedAt" TEXT,

    CONSTRAINT "customer_calendar_entries_pkey" PRIMARY KEY ("id")
);

-- =============================================================================
-- Unique Indexes
-- =============================================================================

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");
CREATE UNIQUE INDEX "supplier_analytics_supplierId_key" ON "supplier_analytics"("supplierId");
CREATE UNIQUE INDEX "analytics_supplierId_date_key" ON "analytics"("supplierId", "date");
CREATE UNIQUE INDEX "link_previews_normalizedUrl_key" ON "link_previews"("normalizedUrl");
CREATE UNIQUE INDEX "webhook_events_eventId_key" ON "webhook_events"("eventId");
CREATE UNIQUE INDEX "partners_userId_key" ON "partners"("userId");
CREATE UNIQUE INDEX "partners_refCode_key" ON "partners"("refCode");
CREATE UNIQUE INDEX "partner_referrals_supplierUserId_key" ON "partner_referrals"("supplierUserId");

-- =============================================================================
-- Performance Indexes
-- =============================================================================

-- users
CREATE INDEX "users_role_idx" ON "users"("role");
CREATE INDEX "users_verificationToken_idx" ON "users"("verificationToken") WHERE "verificationToken" IS NOT NULL;
CREATE INDEX "users_resetToken_idx" ON "users"("resetToken") WHERE "resetToken" IS NOT NULL;

-- suppliers
CREATE INDEX "suppliers_ownerUserId_idx" ON "suppliers"("ownerUserId");
CREATE INDEX "suppliers_category_idx" ON "suppliers"("category");
CREATE INDEX "suppliers_approved_idx" ON "suppliers"("approved");
CREATE INDEX "suppliers_isPro_idx" ON "suppliers"("isPro");

-- packages: partial unique slug + GIN indexes for array columns
CREATE UNIQUE INDEX "packages_slug_key" ON "packages"("slug") WHERE "slug" IS NOT NULL;
CREATE INDEX "packages_supplierId_idx" ON "packages"("supplierId");
CREATE INDEX "packages_approved_idx" ON "packages"("approved");
CREATE INDEX "packages_categories_gin_idx" ON "packages" USING GIN ("categories");
CREATE INDEX "packages_eventTypes_gin_idx" ON "packages" USING GIN ("eventTypes");

-- badges: partial unique slug
CREATE UNIQUE INDEX "badges_slug_key" ON "badges"("slug") WHERE "slug" IS NOT NULL;

-- plans
CREATE INDEX "plans_userId_idx" ON "plans"("userId");
CREATE INDEX "plans_supplierId_idx" ON "plans"("supplierId");

-- notes / events
CREATE INDEX "notes_userId_idx" ON "notes"("userId");
CREATE INDEX "events_userId_idx" ON "events"("userId");

-- payments: partial indexes for sparse Stripe ID columns
CREATE INDEX "payments_userId_idx" ON "payments"("userId");
CREATE INDEX "payments_status_idx" ON "payments"("status");
CREATE INDEX "payments_stripePaymentId_idx" ON "payments"("stripePaymentId") WHERE "stripePaymentId" IS NOT NULL;
CREATE INDEX "payments_stripeCustomerId_idx" ON "payments"("stripeCustomerId") WHERE "stripeCustomerId" IS NOT NULL;
CREATE INDEX "payments_stripeSubscriptionId_idx" ON "payments"("stripeSubscriptionId") WHERE "stripeSubscriptionId" IS NOT NULL;

-- subscriptions: partial indexes for sparse Stripe ID columns
CREATE INDEX "subscriptions_userId_idx" ON "subscriptions"("userId");
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");
CREATE UNIQUE INDEX "subscriptions_stripeSubscriptionId_key" ON "subscriptions"("stripeSubscriptionId") WHERE "stripeSubscriptionId" IS NOT NULL;
CREATE INDEX "subscriptions_nextBillingDate_idx" ON "subscriptions"("nextBillingDate") WHERE "nextBillingDate" IS NOT NULL;

-- invoices: partial indexes for sparse Stripe ID columns
CREATE INDEX "invoices_userId_idx" ON "invoices"("userId");
CREATE INDEX "invoices_subscriptionId_idx" ON "invoices"("subscriptionId");
CREATE INDEX "invoices_status_idx" ON "invoices"("status");
CREATE UNIQUE INDEX "invoices_stripeInvoiceId_key" ON "invoices"("stripeInvoiceId") WHERE "stripeInvoiceId" IS NOT NULL;
CREATE INDEX "invoices_dueDate_idx" ON "invoices"("dueDate") WHERE "dueDate" IS NOT NULL;

-- reviews
CREATE INDEX "reviews_supplierId_idx" ON "reviews"("supplierId");
CREATE INDEX "reviews_userId_idx" ON "reviews"("userId");
CREATE INDEX "reviews_approved_idx" ON "reviews"("approved");
CREATE INDEX "reviews_supplierId_approved_idx" ON "reviews"("supplierId", "approved");
CREATE INDEX "reviews_supplierId_createdAt_idx" ON "reviews"("supplierId", "createdAt");

-- review_votes
CREATE INDEX "review_votes_reviewId_idx" ON "review_votes"("reviewId");
CREATE UNIQUE INDEX "review_votes_reviewId_userId_key" ON "review_votes"("reviewId", "userId") WHERE "userId" IS NOT NULL;

-- review_moderations
CREATE INDEX "review_moderations_reviewId_idx" ON "review_moderations"("reviewId");
CREATE INDEX "review_moderations_moderatorId_idx" ON "review_moderations"("moderatorId");

-- notifications: compound indexes matching MongoDB usage
CREATE INDEX "notifications_userId_idx" ON "notifications"("userId");
CREATE INDEX "notifications_userId_createdAt_idx" ON "notifications"("userId", "createdAt");
CREATE INDEX "notifications_userId_isRead_idx" ON "notifications"("userId", "isRead");
CREATE INDEX "notifications_expiresAt_idx" ON "notifications"("expiresAt") WHERE "expiresAt" IS NOT NULL;

-- audit_logs
CREATE INDEX "audit_logs_timestamp_idx" ON "audit_logs"("timestamp");

-- search_history
CREATE INDEX "search_history_userId_idx" ON "search_history"("userId");

-- analytics
CREATE INDEX "analytics_supplierId_idx" ON "analytics"("supplierId");

-- link_previews
CREATE INDEX "link_previews_expiresAt_idx" ON "link_previews"("expiresAt") WHERE "expiresAt" IS NOT NULL;

-- webhook_events (TTL cleanup helper)
CREATE INDEX "webhook_events_expiresAt_idx" ON "webhook_events"("expiresAt") WHERE "expiresAt" IS NOT NULL;

-- marketplace_images
CREATE INDEX "marketplace_images_listingId_idx" ON "marketplace_images"("listingId");
CREATE INDEX "marketplace_images_userId_idx" ON "marketplace_images"("userId");

-- conversations_v4
CREATE INDEX "conversations_v4_status_updatedAt_idx" ON "conversations_v4"("status", "updatedAt");
CREATE INDEX "conversations_v4_type_updatedAt_idx" ON "conversations_v4"("type", "updatedAt");

-- chat_messages_v4
CREATE INDEX "chat_messages_v4_conversationId_createdAt_idx" ON "chat_messages_v4"("conversationId", "createdAt");
CREATE INDEX "chat_messages_v4_senderId_idx" ON "chat_messages_v4"("senderId");

-- partner_credit_transactions
CREATE INDEX "partner_credit_transactions_partnerId_idx" ON "partner_credit_transactions"("partnerId");

-- public_calendar_events
CREATE INDEX "public_calendar_events_supplierId_idx" ON "public_calendar_events"("supplierId");
CREATE INDEX "public_calendar_events_startDate_idx" ON "public_calendar_events"("startDate");

-- customer_calendar_entries
CREATE INDEX "customer_calendar_entries_userId_idx" ON "customer_calendar_entries"("userId");

-- =============================================================================
-- Additional Tables (collections missed in initial draft)
-- =============================================================================

-- CreateTable
CREATE TABLE "tickets" (
    "id" TEXT NOT NULL,
    "senderId" TEXT,
    "senderType" TEXT,
    "senderName" TEXT,
    "senderEmail" TEXT,
    "subject" TEXT,
    "message" TEXT,
    "status" TEXT,
    "priority" TEXT,
    "accountTier" TEXT,
    "prioritySource" TEXT,
    "assignedTo" TEXT,
    "lastReplyAt" TEXT,
    "lastReplyBy" TEXT,
    "responses" JSONB,
    "createdAt" TEXT,
    "updatedAt" TEXT,

    CONSTRAINT "tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shortlists" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "supplierIds" TEXT[],
    "createdAt" TEXT,
    "updatedAt" TEXT,

    CONSTRAINT "shortlists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enquiries" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT,
    "supplierName" TEXT,
    "senderName" TEXT,
    "senderEmail" TEXT,
    "message" TEXT,
    "status" TEXT,
    "createdAt" TEXT,

    CONSTRAINT "enquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_enquiries" (
    "id" TEXT NOT NULL,
    "senderType" TEXT,
    "senderName" TEXT,
    "senderEmail" TEXT,
    "subject" TEXT,
    "message" TEXT,
    "status" TEXT,
    "responses" JSONB,
    "createdAt" TEXT,
    "updatedAt" TEXT,

    CONSTRAINT "contact_enquiries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quote_requests" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "eventType" TEXT,
    "eventDate" TEXT,
    "location" TEXT,
    "budget" TEXT,
    "notes" TEXT,
    "suppliers" JSONB,
    "status" TEXT,
    "createdAt" TEXT,
    "updatedAt" TEXT,

    CONSTRAINT "quote_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referrals" (
    "id" TEXT NOT NULL,
    "referrerId" TEXT,
    "referredUserId" TEXT,
    "referralCode" TEXT,
    "status" TEXT,
    "createdAt" TEXT,
    "updatedAt" TEXT,

    CONSTRAINT "referrals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_searches" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT,
    "description" TEXT,
    "criteria" JSONB,
    "notificationsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TEXT,
    "createdAt" TEXT,

    CONSTRAINT "saved_searches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_items" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "itemId" TEXT,
    "itemType" TEXT,
    "data" JSONB,
    "createdAt" TEXT,

    CONSTRAINT "saved_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "newsletter_subscribers" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "status" TEXT,
    "source" TEXT,
    "createdAt" TEXT,
    "updatedAt" TEXT,

    CONSTRAINT "newsletter_subscribers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_cashout_orders" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT,
    "partnerUserId" TEXT,
    "externalRef" TEXT,
    "debitTxnId" TEXT,
    "pointsDebited" INTEGER,
    "valueGbp" DOUBLE PRECISION,
    "currency" TEXT,
    "productId" TEXT,
    "recipientName" TEXT,
    "status" TEXT,
    "apiResponse" JSONB,
    "createdAt" TEXT,
    "updatedAt" TEXT,

    CONSTRAINT "partner_cashout_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_cashout_requests" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT,
    "partnerUserId" TEXT,
    "method" TEXT,
    "denominationGbp" INTEGER,
    "pointsHeld" INTEGER,
    "pointsPerGbpSnapshot" INTEGER,
    "status" TEXT,
    "partnerMessage" TEXT,
    "adminResponseMessage" TEXT,
    "data" JSONB,
    "createdAt" TEXT,
    "updatedAt" TEXT,

    CONSTRAINT "partner_cashout_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_code_history" (
    "id" TEXT NOT NULL,
    "partnerId" TEXT,
    "refCode" TEXT,
    "reason" TEXT,
    "changedBy" TEXT,
    "createdAt" TEXT,

    CONSTRAINT "partner_code_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "photos" (
    "id" TEXT NOT NULL,
    "url" TEXT,
    "thumbnail" TEXT,
    "large" TEXT,
    "original" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "approved" BOOLEAN NOT NULL DEFAULT true,
    "uploadedBy" TEXT,
    "metadata" JSONB,
    "uploadedAt" TEXT,

    CONSTRAINT "photos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_calendar_saves" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "eventId" TEXT,
    "createdAt" TEXT,

    CONSTRAINT "public_calendar_saves_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics_events" (
    "id" TEXT NOT NULL,
    "eventType" TEXT,
    "userId" TEXT,
    "supplierId" TEXT,
    "data" JSONB,
    "createdAt" TEXT,

    CONSTRAINT "analytics_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faq_votes" (
    "id" TEXT NOT NULL,
    "faqId" TEXT,
    "userId" TEXT,
    "voteType" TEXT,
    "createdAt" TEXT,

    CONSTRAINT "faq_votes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketplace_saved_items" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "listingId" TEXT,
    "createdAt" TEXT,

    CONSTRAINT "marketplace_saved_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "updatedAt" TEXT,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "content" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "type" TEXT,
    "body" JSONB,
    "createdAt" TEXT,
    "updatedAt" TEXT,

    CONSTRAINT "content_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "supplierId" TEXT,
    "packageId" TEXT,
    "status" TEXT,
    "eventDate" TEXT,
    "details" JSONB,
    "createdAt" TEXT,
    "updatedAt" TEXT,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "popular_searches" (
    "id" TEXT NOT NULL,
    "query" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TEXT,

    CONSTRAINT "popular_searches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_checks" (
    "id" TEXT NOT NULL,
    "status" TEXT,
    "results" JSONB,
    "triggeredBy" TEXT,
    "startedAt" TEXT,
    "completedAt" TEXT,
    "createdAt" TEXT,

    CONSTRAINT "system_checks_pkey" PRIMARY KEY ("id")
);

-- Unique indexes for new tables
CREATE UNIQUE INDEX "shortlists_userId_key" ON "shortlists"("userId");
CREATE UNIQUE INDEX "newsletter_subscribers_email_key" ON "newsletter_subscribers"("email");
CREATE UNIQUE INDEX "public_calendar_saves_userId_eventId_key" ON "public_calendar_saves"("userId", "eventId");
CREATE UNIQUE INDEX "marketplace_saved_items_userId_listingId_key" ON "marketplace_saved_items"("userId", "listingId");
CREATE UNIQUE INDEX "content_key_key" ON "content"("key");
CREATE UNIQUE INDEX "popular_searches_query_key" ON "popular_searches"("query");

-- Performance indexes for new tables
CREATE INDEX "tickets_senderId_idx" ON "tickets"("senderId");
CREATE INDEX "tickets_status_idx" ON "tickets"("status");
CREATE INDEX "tickets_createdAt_idx" ON "tickets"("createdAt");
CREATE INDEX "enquiries_supplierId_idx" ON "enquiries"("supplierId");
CREATE INDEX "enquiries_senderEmail_idx" ON "enquiries"("senderEmail");
CREATE INDEX "contact_enquiries_senderEmail_idx" ON "contact_enquiries"("senderEmail");
CREATE INDEX "contact_enquiries_status_idx" ON "contact_enquiries"("status");
CREATE INDEX "quote_requests_userId_idx" ON "quote_requests"("userId");
CREATE INDEX "saved_searches_userId_idx" ON "saved_searches"("userId");
CREATE INDEX "saved_items_userId_idx" ON "saved_items"("userId");
CREATE INDEX "partner_cashout_orders_partnerId_idx" ON "partner_cashout_orders"("partnerId");
CREATE INDEX "partner_cashout_requests_partnerId_idx" ON "partner_cashout_requests"("partnerId");
CREATE INDEX "partner_code_history_partnerId_idx" ON "partner_code_history"("partnerId");
CREATE INDEX "photos_entityType_entityId_idx" ON "photos"("entityType", "entityId");
CREATE INDEX "analytics_events_supplierId_idx" ON "analytics_events"("supplierId");
CREATE INDEX "analytics_events_createdAt_idx" ON "analytics_events"("createdAt");
CREATE INDEX "bookings_userId_idx" ON "bookings"("userId");
CREATE INDEX "bookings_supplierId_idx" ON "bookings"("supplierId");
CREATE INDEX "system_checks_startedAt_idx" ON "system_checks"("startedAt");

-- =============================================================================
-- Foreign Keys
-- =============================================================================

ALTER TABLE "chat_messages_v4" ADD CONSTRAINT "chat_messages_v4_conversationId_fkey"
    FOREIGN KEY ("conversationId") REFERENCES "conversations_v4"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "messages" ADD CONSTRAINT "messages_threadId_fkey"
    FOREIGN KEY ("threadId") REFERENCES "threads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
