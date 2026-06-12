'use strict';

const {
  buildPackageImageRepair,
  dataUriToUploadFile,
  repairPackageImages,
} = require('../../utils/packageImageRepair');

const PNG_DATA_URI = 'data:image/png;base64,QUJDRA==';

describe('package image data URI repair', () => {
  it('converts data URIs into public /api/photos URLs via the injected photo pipeline', async () => {
    const photoUpload = {
      processAndSaveImage: jest.fn().mockResolvedValue({
        optimized: '/api/photos/photo_optimized',
        thumbnail: '/api/photos/photo_thumb',
        large: '/api/photos/photo_large',
        original: '/api/photos/photo_original',
      }),
    };

    const result = await buildPackageImageRepair(
      { id: 'pkg_data_uri', image: PNG_DATA_URI, gallery: [] },
      { dryRun: false, photoUpload }
    );

    expect(photoUpload.processAndSaveImage).toHaveBeenCalledWith(
      Buffer.from('ABCD'),
      expect.stringMatching(/^package_pkg_data_uri_\d+\.png$/),
      'package'
    );
    expect(result.changed).toBe(true);
    expect(result.update.image).toBe('/api/photos/photo_optimized');
    expect(result.update.gallery[0]).toEqual(
      expect.objectContaining({
        url: '/api/photos/photo_optimized',
        thumbnail: '/api/photos/photo_thumb',
        large: '/api/photos/photo_large',
        original: '/api/photos/photo_original',
      })
    );
    expect(result.after.resolvedImage).toBe('/api/photos/photo_optimized');
  });

  it('dry-runs by default and reports before state without writing', async () => {
    const result = await buildPackageImageRepair({ id: 'pkg_dry', image: PNG_DATA_URI });
    expect(result).toEqual(
      expect.objectContaining({
        id: 'pkg_dry',
        changed: false,
        dryRun: true,
        reason: 'would-convert-data-uri',
        source: 'pkg.image',
      })
    );
  });

  it('applies package updates and cache invalidation once when requested', async () => {
    const dbUnified = { updateOne: jest.fn().mockResolvedValue(true) };
    const invalidateCaches = jest.fn();
    const photoUpload = {
      processAndSaveImage: jest.fn().mockResolvedValue({ optimized: '/api/photos/photo_applied' }),
    };

    const report = await repairPackageImages([{ id: 'pkg_apply', image: PNG_DATA_URI }], {
      dryRun: false,
      dbUnified,
      photoUpload,
      invalidateCaches,
    });

    expect(report.changed).toBe(1);
    expect(dbUnified.updateOne).toHaveBeenCalledWith(
      'packages',
      { id: 'pkg_apply' },
      { $set: expect.objectContaining({ image: '/api/photos/photo_applied' }) }
    );
    expect(invalidateCaches).toHaveBeenCalledTimes(1);
  });

  it('throws instead of writing an empty image when storage returns no public URL', async () => {
    const photoUpload = {
      processAndSaveImage: jest.fn().mockResolvedValue({}),
    };

    await expect(
      buildPackageImageRepair(
        { id: 'pkg_no_storage_url', image: PNG_DATA_URI, gallery: [] },
        { dryRun: false, photoUpload }
      )
    ).rejects.toThrow('Image processing returned no public URL');
  });

  it('parses base64 data URIs into upload files', () => {
    expect(dataUriToUploadFile(PNG_DATA_URI, 'package_test')).toEqual({
      buffer: Buffer.from('ABCD'),
      filename: 'package_test.png',
      mimeType: 'image/png',
    });
  });
});
