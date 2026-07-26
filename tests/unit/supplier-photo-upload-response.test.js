'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadSupplierPhotoUpload() {
  const source = fs.readFileSync(
    path.join(__dirname, '../../public/assets/js/supplier-photo-upload.js'),
    'utf8'
  );
  const transformed = source.replace(
    'export default supplierPhotoUpload;',
    'module.exports = { SupplierPhotoUpload, supplierPhotoUpload };'
  );
  const fetchMock = jest.fn();
  const context = {
    module: { exports: {} },
    exports: {},
    window: {
      location: { hostname: 'example.test' },
      __CSRF_TOKEN__: 'csrf-token',
    },
    fetch: fetchMock,
    FileReader: function FileReader() {},
    Image: function Image() {},
    document: { createElement: jest.fn() },
    console: {
      error: jest.fn(),
      log: jest.fn(),
    },
    Date,
    JSON,
    Promise,
    Error,
  };

  vm.runInNewContext(transformed, context, {
    filename: 'supplier-photo-upload.js',
  });

  return {
    SupplierPhotoUpload: context.module.exports.SupplierPhotoUpload,
    fetchMock,
  };
}

function createUploader(SupplierPhotoUpload) {
  const uploader = new SupplierPhotoUpload();
  uploader.compressImage = jest.fn().mockResolvedValue({});
  uploader.blobToBase64 = jest.fn().mockResolvedValue('data:image/jpeg;base64,AAAA');
  uploader.ensureCsrfToken = jest.fn().mockResolvedValue('csrf-token');
  return uploader;
}

describe('supplier photo upload response normalisation', () => {
  test('uses server ids, preserves derivatives, and encodes supplier ids', async () => {
    const { SupplierPhotoUpload, fetchMock } = loadSupplierPhotoUpload();
    const uploader = createUploader(SupplierPhotoUpload);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        photo: {
          id: 'photo_123',
          url: '/api/photos/optimized_123',
          thumbnail: '/api/photos/thumb_123',
          large: '/api/photos/large_123',
          uploadedAt: '2026-07-24T12:00:00.000Z',
        },
      }),
    });

    const result = await uploader.uploadPhoto(
      { type: 'image/jpeg', size: 1024, name: 'portfolio.jpg' },
      'sup/123'
    );

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/me/suppliers/sup%2F123/photos',
      expect.objectContaining({ method: 'POST' })
    );
    expect(result).toMatchObject({
      id: 'photo_123',
      url: '/api/photos/optimized_123',
      thumbnail: '/api/photos/thumb_123',
      large: '/api/photos/large_123',
      filename: 'portfolio.jpg',
      uploadedAt: '2026-07-24T12:00:00.000Z',
    });
    expect(uploader.uploadedPhotos).toEqual([result]);
  });

  test('uses the stored URL as the stable identity for legacy responses', async () => {
    const { SupplierPhotoUpload, fetchMock } = loadSupplierPhotoUpload();
    const uploader = createUploader(SupplierPhotoUpload);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        url: '/api/photos/optimized_legacy',
        photo: {
          url: '/api/photos/optimized_legacy',
          thumbnail: '/api/photos/thumb_legacy',
        },
      }),
    });

    const result = await uploader.uploadPhoto(
      { type: 'image/png', size: 2048, name: 'legacy.png' },
      'sup_legacy'
    );

    expect(result.id).toBe('/api/photos/optimized_legacy');
    expect(result.url).toBe('/api/photos/optimized_legacy');
    expect(result.thumbnail).toBe('/api/photos/thumb_legacy');
    expect(result.id).not.toMatch(/^\d+$/);
  });

  test('encodes URL-shaped legacy identities when deleting', async () => {
    const { SupplierPhotoUpload, fetchMock } = loadSupplierPhotoUpload();
    const uploader = createUploader(SupplierPhotoUpload);
    const legacyId = '/api/photos/optimized_legacy';
    uploader.uploadedPhotos = [
      { id: legacyId, url: legacyId },
      { id: 'photo_keep', url: '/api/photos/keep' },
    ];
    fetchMock.mockResolvedValue({ ok: true });

    await uploader.deletePhoto(legacyId, 'sup/legacy');

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/me/suppliers/sup%2Flegacy/photos/%2Fapi%2Fphotos%2Foptimized_legacy',
      expect.objectContaining({
        method: 'DELETE',
        credentials: 'include',
      })
    );
    expect(uploader.uploadedPhotos).toEqual([{ id: 'photo_keep', url: '/api/photos/keep' }]);
  });

  test('normalises the current wrapped photo-list response', async () => {
    const { SupplierPhotoUpload, fetchMock } = loadSupplierPhotoUpload();
    const uploader = createUploader(SupplierPhotoUpload);
    const photos = [
      {
        id: 'photo_1',
        url: '/api/photos/one',
        thumbnail: '/api/photos/one-thumb',
      },
    ];
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, count: 1, photos }),
    });

    const result = await uploader.getSupplierPhotos('sup/list');

    expect(fetchMock).toHaveBeenCalledWith('/api/me/suppliers/sup%2Flist/photos', {
      credentials: 'include',
    });
    expect(result).toEqual(photos);
    expect(uploader.uploadedPhotos).toEqual(photos);
  });

  test('rejects a successful response that contains no usable photo URL', async () => {
    const { SupplierPhotoUpload, fetchMock } = loadSupplierPhotoUpload();
    const uploader = createUploader(SupplierPhotoUpload);
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ photo: {} }),
    });

    await expect(
      uploader.uploadPhoto(
        { type: 'image/webp', size: 4096, name: 'missing-url.webp' },
        'sup_missing'
      )
    ).rejects.toThrow('Photo upload did not return a usable URL');
  });
});
