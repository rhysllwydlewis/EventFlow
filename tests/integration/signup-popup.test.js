/**
 * Integration tests for the public sign-up popup settings endpoint.
 */

const request = require('supertest');
const express = require('express');
const dbUnified = require('../../db-unified');
const publicRouter = require('../../routes/public');

describe('Sign-up Popup Settings Integration', () => {
  let app;
  let originalSettings;

  beforeAll(async () => {
    await dbUnified.initializeDatabase();
    // Snapshot settings so we can restore after the suite (avoids cross-test pollution)
    originalSettings = await dbUnified.read('settings');
  });

  afterAll(async () => {
    if (originalSettings !== undefined) {
      await dbUnified.write('settings', originalSettings);
    }
  });

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/public', publicRouter);
  });

  describe('GET /api/public/signup-popup', () => {
    it('returns the configured mode/enabled flag and delay for popup mode', async () => {
      const settings = (await dbUnified.read('settings')) || {};
      await dbUnified.write('settings', {
        ...settings,
        signupPopup: { mode: 'popup', delaySeconds: 8 },
      });

      const response = await request(app).get('/api/public/signup-popup');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ mode: 'popup', enabled: true, delaySeconds: 8 });
    });

    it('returns the configured mode/enabled flag and delay for banner mode', async () => {
      const settings = (await dbUnified.read('settings')) || {};
      await dbUnified.write('settings', {
        ...settings,
        signupPopup: { mode: 'banner', delaySeconds: 8 },
      });

      const response = await request(app).get('/api/public/signup-popup');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ mode: 'banner', enabled: true, delaySeconds: 8 });
    });

    it('migrates a legacy enabled:true record (predating the banner mode) to popup', async () => {
      const settings = (await dbUnified.read('settings')) || {};
      await dbUnified.write('settings', {
        ...settings,
        signupPopup: { enabled: true, delaySeconds: 8 },
      });

      const response = await request(app).get('/api/public/signup-popup');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ mode: 'popup', enabled: true, delaySeconds: 8 });
    });

    it('defaults to disabled with a 5 second delay when no signupPopup setting exists', async () => {
      const settings = { ...((await dbUnified.read('settings')) || {}) };
      delete settings.signupPopup;
      await dbUnified.write('settings', settings);

      const response = await request(app).get('/api/public/signup-popup');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ mode: 'disabled', enabled: false, delaySeconds: 5 });
    });

    it('never leaks admin metadata such as updatedBy', async () => {
      const settings = (await dbUnified.read('settings')) || {};
      await dbUnified.write('settings', {
        ...settings,
        signupPopup: {
          mode: 'popup',
          delaySeconds: 3,
          updatedAt: '2026-01-01T00:00:00.000Z',
          updatedBy: 'admin@example.com',
        },
      });

      const response = await request(app).get('/api/public/signup-popup');

      expect(response.body).toEqual({ mode: 'popup', enabled: true, delaySeconds: 3 });
      expect(response.body.updatedBy).toBeUndefined();
    });

    it('fails closed when the settings read throws, so a storage blip cannot force the popup onto every visitor', async () => {
      const spy = jest
        .spyOn(dbUnified, 'read')
        .mockRejectedValueOnce(new Error('settings unavailable'));

      try {
        const response = await request(app).get('/api/public/signup-popup');

        expect(response.status).toBe(200);
        expect(response.body.mode).toBe('disabled');
        expect(response.body.enabled).toBe(false);
      } finally {
        spy.mockRestore();
      }
    });

    it('falls back to a non-blocking default when delaySeconds is not a whole number', async () => {
      const settings = (await dbUnified.read('settings')) || {};
      await dbUnified.write('settings', {
        ...settings,
        signupPopup: { mode: 'popup', delaySeconds: 'soon' },
      });

      const response = await request(app).get('/api/public/signup-popup');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ mode: 'popup', enabled: true, delaySeconds: 5 });
    });
  });
});
