/**
 * What a deleted supplier or package leaves in image storage: the list of records to delete.
 *
 * @jest-environment node
 */
'use strict';

const { packagePhotoRecords, supplierPhotoRecords } = require('../../utils/removedRecordPhotos');

describe('packagePhotoRecords', () => {
  test('is the gallery items (addresses and upload objects) and the cover image', () => {
    const upload = { url: '/api/photos/a', thumbnail: '/api/photos/b' };

    expect(
      packagePhotoRecords({ gallery: ['/api/photos/c', upload], image: '/api/photos/c' })
    ).toEqual(['/api/photos/c', upload, '/api/photos/c']);
  });

  test('ignores a missing or malformed gallery, and an empty cover', () => {
    expect(packagePhotoRecords({ gallery: null, image: '' })).toEqual([]);
    expect(packagePhotoRecords({ gallery: 'nope' })).toEqual([]);
    expect(packagePhotoRecords({})).toEqual([]);
  });

  test('answers nothing for something that is not a record', () => {
    for (const value of [null, undefined, 'x', 42]) {
      expect(packagePhotoRecords(value)).toEqual([]);
    }
  });
});

describe('supplierPhotoRecords', () => {
  test('is the gallery, the image list, and the logo, cover, banner and social image', () => {
    const upload = { url: '/api/photos/a' };
    const supplier = {
      photosGallery: [upload],
      images: ['/api/photos/i'],
      logo: '/api/photos/logo',
      coverImage: '/api/photos/cover',
      bannerUrl: '/api/photos/banner',
      openGraphImage: '/api/photos/og',
    };

    expect(supplierPhotoRecords(supplier)).toEqual([
      upload,
      '/api/photos/i',
      '/api/photos/logo',
      '/api/photos/cover',
      '/api/photos/banner',
      '/api/photos/og',
    ]);
  });

  test('leaves out fields that are not set, and answers nothing for a non-record', () => {
    expect(
      supplierPhotoRecords({ logo: '/api/photos/logo', coverImage: '', images: null })
    ).toEqual(['/api/photos/logo']);
    for (const value of [null, undefined, 'x']) {
      expect(supplierPhotoRecords(value)).toEqual([]);
    }
  });
});
