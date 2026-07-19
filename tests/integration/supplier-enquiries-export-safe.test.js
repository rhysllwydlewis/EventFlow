'use strict';

const express = require('express');
const request = require('supertest');

const mockDb = {
  findOne: jest.fn(),
  find: jest.fn(),
  read: jest.fn(),
};

jest.mock('../../db-unified', () => mockDb);
jest.mock('../../utils/logger', () => ({
  error: jest.fn(),
}));
jest.mock('../../middleware/auth', () => ({
  authRequired: (req, res, next) => {
    if (req.headers['x-test-role'] === 'none') {
      return res.status(401).json({ error: 'Unauthorised' });
    }
    req.user = {
      id: 'supplier-owner-1',
      role: req.headers['x-test-role'] || 'supplier',
    };
    return next();
  },
}));

const safeExportRoutes = require('../../routes/supplier-export-safe');

function createApp() {
  const app = express();
  app.use('/api/v1/supplier', safeExportRoutes);
  return app;
}

describe('safe supplier enquiry CSV export', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockDb.findOne.mockResolvedValue({ id: 'supplier-1', ownerUserId: 'supplier-owner-1' });
    mockDb.find.mockResolvedValue([]);
    mockDb.read.mockResolvedValue([]);
  });

  test('preserves authentication and supplier-role checks', async () => {
    await request(createApp())
      .get('/api/v1/supplier/enquiries/export')
      .set('x-test-role', 'none')
      .expect(401);

    await request(createApp())
      .get('/api/v1/supplier/enquiries/export')
      .set('x-test-role', 'customer')
      .expect(403);
  });

  test('returns 404 when the supplier profile is missing', async () => {
    mockDb.findOne.mockResolvedValue(null);

    await request(createApp()).get('/api/v1/supplier/enquiries/export').expect(404);
    expect(mockDb.find).not.toHaveBeenCalled();
  });

  test('returns spreadsheet-safe UTF-8 CSV data', async () => {
    mockDb.find.mockResolvedValue([
      {
        customerId: 'customer-1',
        createdAt: '2026-07-19T10:00:00.000Z',
        eventType: 'Wedding',
        eventDate: '2027-06-12T00:00:00.000Z',
        location: 'Cardiff, Wales',
        budget: '=HYPERLINK("https://example.test")',
        guestCount: 120,
        status: 'new',
        message: 'First line\r\nSecond "quoted" line',
      },
    ]);
    mockDb.read.mockResolvedValue([
      {
        id: 'customer-1',
        name: '+SUM(A1:A2)',
        email: 'customer@example.test',
      },
    ]);

    const response = await request(createApp())
      .get('/api/v1/supplier/enquiries/export')
      .expect(200);

    expect(response.headers['content-type']).toMatch(/^text\/csv; charset=utf-8/);
    expect(response.headers['content-disposition']).toMatch(/^attachment; filename="enquiries-/);
    expect(response.text.startsWith('\uFEFF')).toBe(true);
    expect(response.text).toContain('"\'+SUM(A1:A2)"');
    expect(response.text).toContain('"\'=HYPERLINK(""https://example.test"")"');
    expect(response.text).toContain('"First line\nSecond ""quoted"" line"');
  });

  test('returns a controlled 500 response when export data cannot be loaded', async () => {
    mockDb.findOne.mockRejectedValue(new Error('database unavailable'));

    const response = await request(createApp())
      .get('/api/v1/supplier/enquiries/export')
      .expect(500);

    expect(response.body.error).toBe('Failed to export enquiries');
  });

  test('installs the hardened route first and only once', () => {
    const target = express.Router();
    target.get('/enquiries/export', (_req, res) => res.status(418).send('legacy'));
    const originalLength = target.stack.length;

    safeExportRoutes.installInto(target);
    safeExportRoutes.installInto(target);

    expect(target.stack).toHaveLength(originalLength + safeExportRoutes.stack.length);
    expect(target.stack[0]).toBe(safeExportRoutes.stack[0]);
    expect(target.__safeSupplierExportInstalled).toBe(true);
  });

  test('ignores invalid router installation targets', () => {
    expect(() => safeExportRoutes.installInto(null)).not.toThrow();
    expect(() => safeExportRoutes.installInto({})).not.toThrow();
  });
});
