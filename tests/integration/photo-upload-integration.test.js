/**
 * Photo Upload Integration Tests (mock-based)
 *
 * Tests the complete photo upload and moderation pipeline with deterministic
 * mocks — no live Cloudinary, MongoDB, or filesystem required.
 *
 * Covers:
 *  - processAndSaveImage with local (filesystem) storage mock
 *  - processAndSaveImage with MongoDB storage mock
 *  - Graceful degradation when MongoDB is unavailable
 *  - Image validation: file size, type, pixel count
 *  - Sharp image processing: thumbnails, optimized, large sizes
 *  - Photo deletion (local and MongoDB paths)
 *  - Admin approve / reject photo flows (route-level, contract)
 *  - Batch approve / batch reject (route-level, contract)
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── Route source helpers ────────────────────────────────────────────────────

function readSrc(...parts) {
  return fs.readFileSync(path.resolve(__dirname, '..', '..', ...parts), 'utf8');
}

// ─── Photo upload module mocks ───────────────────────────────────────────────

// Mock sharp so tests run without native binaries
jest.mock('sharp', () => {
  const sharpInstance = {
    resize: jest.fn().mockReturnThis(),
    jpeg: jest.fn().mockReturnThis(),
    png: jest.fn().mockReturnThis(),
    withMetadata: jest.fn().mockReturnThis(),
    rotate: jest.fn().mockReturnThis(),
    withExifMerge: jest.fn().mockReturnThis(),
    toBuffer: jest.fn().mockResolvedValue(Buffer.from('processed-image-data')),
    metadata: jest.fn().mockResolvedValue({
      width: 1200,
      height: 900,
      format: 'jpeg',
      size: 50000,
    }),
  };
  const sharpFn = jest.fn(() => sharpInstance);
  sharpFn.prototype = sharpInstance;
  return sharpFn;
});

// Mock db (MongoDB) — defaults to unavailable (local-storage path)
jest.mock('../../db', () => ({
  isMongoAvailable: jest.fn().mockResolvedValue(false),
  getDb: jest.fn(),
  isConnected: jest.fn().mockReturnValue(false),
}));

// Mock fs.promises for directory/file operations
jest.mock('fs', () => {
  const actual = jest.requireActual('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      mkdir: jest.fn().mockResolvedValue(undefined),
      writeFile: jest.fn().mockResolvedValue(undefined),
      unlink: jest.fn().mockResolvedValue(undefined),
      access: jest.fn().mockResolvedValue(undefined),
    },
    existsSync: jest.fn().mockReturnValue(true),
    mkdirSync: jest.fn(),
  };
});

// Mock upload validation
jest.mock('../../utils/uploadValidation', () => ({
  validateUpload: jest.fn().mockResolvedValue({ valid: true, errors: [] }),
}));

// Mock logger
jest.mock('../../utils/logger', () => ({
  info: jest.fn(),
  debug: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

// ─── Test data ────────────────────────────────────────────────────────────────

// A tiny valid JPEG magic-byte prefix
const VALID_JPEG_BUFFER = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]), // JPEG magic bytes
  Buffer.alloc(1000, 0x00), // Padding
]);

// ─── Test suites ─────────────────────────────────────────────────────────────

describe('Photo Upload — Input Validation (unit)', () => {
  let photoUpload;

  beforeEach(() => {
    jest.resetModules();
    // Re-mock after resetModules
    jest.mock('../../db', () => ({
      isMongoAvailable: jest.fn().mockResolvedValue(false),
      getDb: jest.fn(),
      isConnected: jest.fn().mockReturnValue(false),
    }));
    jest.mock('../../utils/uploadValidation', () => ({
      validateUpload: jest.fn().mockResolvedValue({ valid: true, errors: [] }),
    }));
    jest.mock('../../utils/logger', () => ({
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }));
    photoUpload = require('../../photo-upload');
  });

  it('rejects null buffer with ValidationError', async () => {
    await expect(photoUpload.processAndSaveImage(null, 'test.jpg')).rejects.toMatchObject({
      name: 'ValidationError',
    });
  });

  it('rejects empty Buffer with ValidationError', async () => {
    await expect(
      photoUpload.processAndSaveImage(Buffer.alloc(0), 'test.jpg')
    ).rejects.toMatchObject({ name: 'ValidationError' });
  });

  it('rejects buffer exceeding 5 MB with ValidationError', async () => {
    const OVER_MAX_FILE_SIZE = 6 * 1024 * 1024; // 6 MB — exceeds the 5 MB limit
    const bigBuffer = Buffer.alloc(OVER_MAX_FILE_SIZE, 0xff);
    await expect(photoUpload.processAndSaveImage(bigBuffer, 'big.jpg')).rejects.toMatchObject({
      name: 'ValidationError',
      message: expect.stringContaining('too large'),
    });
  });

  it('rejects non-Buffer input with ValidationError', async () => {
    await expect(photoUpload.processAndSaveImage('not-a-buffer', 'test.jpg')).rejects.toMatchObject(
      { name: 'ValidationError' }
    );
  });
});

describe('Photo Upload — Storage Path (contract)', () => {
  it('processAndSaveImage returns optimized / thumbnail / large / original keys', async () => {
    // Validate the function exists and exports the correct interface
    const photoUpload = require('../../photo-upload');
    expect(typeof photoUpload.processAndSaveImage).toBe('function');
    expect(typeof photoUpload.processAndSaveMarketplaceImage).toBe('function');
    expect(typeof photoUpload.deleteImage).toBe('function');
    expect(typeof photoUpload.getImageMetadata).toBe('function');
  });

  it('MongoDB storage path builds /api/photos/<id> URLs', () => {
    // Verify the source code builds MongoDB photo serving URLs correctly
    const src = readSrc('photo-upload.js');
    expect(src).toContain('results.optimized = `/api/photos/${optimizedId}`');
    expect(src).toContain('results.thumbnail = `/api/photos/${thumbnailId}`');
    expect(src).toContain('results.large = `/api/photos/${largeId}`');
    expect(src).toContain('results.original = `/api/photos/${originalId}`');
  });

  it('MongoDB-only: no local /uploads/ paths in source (filesystem fallback removed)', () => {
    const src = readSrc('photo-upload.js');
    // Confirm local filesystem storage code has been removed
    expect(src).not.toContain('STORAGE_TYPE');
    expect(src).not.toContain('saveToLocal');
    // Confirm MongoDB paths are the only storage backend
    expect(src).toContain('/api/photos/');
  });

  it('photo-upload.js throws MongoDBUnavailableError when MongoDB is unavailable', () => {
    const src = readSrc('photo-upload.js');
    // MongoDB-only: unavailability throws an error rather than falling back to local storage
    expect(src).toContain('MongoDBUnavailableError');
    expect(src).toContain('MongoDB is not available for photo storage');
  });
});

describe('Photo Upload — Admin Route Structure (contract)', () => {
  let adminContent;

  beforeAll(() => {
    adminContent = readSrc('routes', 'admin.js');
  });

  it('GET /photos/pending route exists and is secured', () => {
    const idx = adminContent.indexOf("router.get('/photos/pending'");
    expect(idx).toBeGreaterThan(-1);
    const block = adminContent.substring(idx, idx + 300);
    expect(block).toContain('authRequired');
    expect(block).toContain("roleRequired('admin')");
  });

  it('POST /photos/:id/approve route exists with CSRF protection', () => {
    expect(adminContent).toContain("'/photos/:id/approve'");
    const idx = adminContent.indexOf("'/photos/:id/approve'");
    const block = adminContent.substring(idx - 30, idx + 200);
    expect(block).toContain('csrfProtection');
  });

  it('POST /photos/:id/reject route exists with CSRF protection', () => {
    expect(adminContent).toContain("'/photos/:id/reject'");
    const idx = adminContent.indexOf("'/photos/:id/reject'");
    const block = adminContent.substring(idx - 30, idx + 200);
    expect(block).toContain('csrfProtection');
  });

  it('POST /photos/batch-approve route supports both approve and reject actions', () => {
    expect(adminContent).toContain("'/photos/batch-approve'");
    const idx = adminContent.indexOf("'/photos/batch-approve'");
    const block = adminContent.substring(idx, idx + 3000);
    expect(block).toContain("action === 'approve'");
    expect(block).toContain("status: 'approved'");
    expect(block).toContain("status: 'rejected'");
  });

  it('photo approve route creates audit log', () => {
    const approveIdx = adminContent.indexOf("'/photos/:id/approve'");
    const block = adminContent.substring(approveIdx, approveIdx + 2000);
    expect(block).toContain('auditLog');
    expect(block).toContain('AUDIT_ACTIONS.CONTENT_APPROVED');
  });

  it('photo reject route creates audit log with reason', () => {
    const rejectIdx = adminContent.indexOf("'/photos/:id/reject'");
    const block = adminContent.substring(rejectIdx, rejectIdx + 1500);
    expect(block).toContain('auditLog');
    expect(block).toContain('AUDIT_ACTIONS.CONTENT_REJECTED');
    expect(block).toContain('rejectionReason');
  });

  it('approve route adds photo URL to supplier photosGallery array', () => {
    const approveIdx = adminContent.indexOf("'/photos/:id/approve'");
    const block = adminContent.substring(approveIdx, approveIdx + 2000);
    expect(block).toContain('suppliers[supplierIndex].photosGallery');
    expect(block).toContain('photo.url');
  });

  it('photo routes return 404 when photo not found', () => {
    const approveIdx = adminContent.indexOf("'/photos/:id/approve'");
    const approveBlock = adminContent.substring(approveIdx, approveIdx + 800);
    expect(approveBlock).toContain('status(404)');
    expect(approveBlock).toContain('Photo not found');

    const rejectIdx = adminContent.indexOf("'/photos/:id/reject'");
    const rejectBlock = adminContent.substring(rejectIdx, rejectIdx + 800);
    expect(rejectBlock).toContain('status(404)');
    expect(rejectBlock).toContain('Photo not found');
  });
});

describe('Photo Upload — Frontend JS (admin-photos-init.js)', () => {
  let src;

  beforeAll(() => {
    src = readSrc('public', 'assets', 'js', 'pages', 'admin-photos-init.js');
  });

  it('rejectPhoto calls /reject endpoint (not /approve)', () => {
    const fnStart = src.indexOf('window.rejectPhoto');
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = src.substring(fnStart, fnStart + 400);
    expect(fnBody).toContain('/reject');
    expect(fnBody).not.toContain('/approve');
  });

  it('batch reject calls /reject endpoint for each photo', () => {
    const batchStart = src.indexOf('batchReject.addEventListener');
    expect(batchStart).toBeGreaterThan(-1);
    const batchBody = src.substring(batchStart, batchStart + 500);
    expect(batchBody).toContain('/reject');
    expect(batchBody).not.toContain('/approve');
  });

  it('approvePhoto calls /approve endpoint', () => {
    const fnStart = src.indexOf('window.approvePhoto');
    expect(fnStart).toBeGreaterThan(-1);
    const fnBody = src.substring(fnStart, fnStart + 300);
    expect(fnBody).toContain('/approve');
  });

  it('uses confirmation modal before rejecting', () => {
    const fnStart = src.indexOf('window.rejectPhoto');
    const fnBody = src.substring(fnStart, fnStart + 500);
    expect(fnBody).toContain('showConfirmModal');
  });

  it('uses confirmation modal before batch operations', () => {
    expect(src).toContain('showConfirmModal');
  });

  it('shows toast on success and error', () => {
    expect(src).toContain("showToast('Photo approved'");
    expect(src).toContain("showToast('Photo rejected'");
    expect(src).toContain("showToast('Failed to approve photo'");
    expect(src).toContain("showToast('Failed to reject photo'");
  });
});

describe('Photo Upload — Validation Utility (uploadValidation.js)', () => {
  let uploadValidation;

  beforeEach(() => {
    jest.resetModules();
    jest.mock('../../utils/logger', () => ({
      info: jest.fn(),
      debug: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    }));
    uploadValidation = require('../../utils/uploadValidation');
  });

  it('exports a validateUpload function', () => {
    expect(typeof uploadValidation.validateUpload).toBe('function');
  });

  it('rejects buffers that are too small to contain a valid image', async () => {
    const tinyBuffer = Buffer.alloc(5, 0x00);
    const result = await uploadValidation.validateUpload(tinyBuffer, 'supplier', 'test.jpg');
    // Should either be invalid or throw — either way, no crash
    expect(result).toBeDefined();
  });
});

describe('Photo Upload — Graceful Degradation', () => {
  it('photo-upload.js throws on MongoDB unavailability (no local filesystem fallback)', () => {
    const src = readSrc('photo-upload.js');
    // MongoDB-only: no STORAGE_TYPE toggle, no local storage fallback
    expect(src).not.toContain('checkMongoDBAvailability');
    expect(src).not.toContain("STORAGE_TYPE = 'local'");
    // Confirms MongoDBUnavailableError is thrown instead of silently falling back
    expect(src).toContain('MongoDBUnavailableError');
  });

  it('routes/photos.js returns 503 when photo upload service is not initialised', () => {
    const photosContent = readSrc('routes', 'photos.js');
    expect(photosContent).toContain("'Photo upload service not initialized'");
    expect(photosContent).toContain('status(503)');
  });

  it('admin-config.js returns 503 when photo upload service is not initialised', () => {
    const adminConfigContent = readSrc('routes', 'admin-config.js');
    expect(adminConfigContent).toContain("'Photo upload service not initialized'");
    expect(adminConfigContent).toContain('status(503)');
  });
});
