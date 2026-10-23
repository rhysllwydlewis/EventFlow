'use strict';

/**
 * The Photos page (/gallery) in jsdom against a scripted API: which gallery opens, what is shown
 * for each kind of account, adding files, uploading (including the CSRF token and its retry),
 * deleting, and the viewer. The page's own markup and script run; only the network and <dialog>
 * methods are stood in for (gallery-page-harness.js).
 *
 * This is a script, not a Jest file: jsdom cannot be loaded inside Jest here, so
 * tests/unit/gallery-page-behaviour.test.js runs it in a child process and reports each scenario
 * below as its own Jest test.
 */

const { describe, test, expect, run } = require('./mini-test');
const { openGalleryPage, supplierApi } = require('./gallery-page-harness');

const json = (status, body) => ({ status, body });

describe('which gallery opens', () => {
  test('a link to a package opens that package, and the picker lists the profile and packages', async () => {
    const page = await openGalleryPage({
      url: 'https://event-flow.co.uk/gallery?type=package&id=p2',
      api: supplierApi(),
    });
    expect(page.calls.some(c => c.url === '/api/me/packages/p2/photos')).toBe(true);
    expect(page.$('#gallery-target').value).toBe('package:p2');
    const options = page.$$('#gallery-target option').map(option => option.textContent);
    expect(options).toEqual(['Romeo Venues', 'Wedding day', 'Evening']);
    expect(page.$$('#gallery-target optgroup').map(group => group.label)).toEqual([
      'Profile',
      'Packages',
    ]);
  });

  test('with no id the supplier’s own profile opens, and the address says so', async () => {
    const page = await openGalleryPage({ api: supplierApi() });
    expect(page.$('#gallery-target').value).toBe('supplier:s1');
    expect(page.calls.some(c => c.url === '/api/me/suppliers/s1/photos')).toBe(true);
    expect(page.window.location.search).toBe('?type=supplier&id=s1');
  });

  test('the older supplierId link still works', async () => {
    const page = await openGalleryPage({
      url: 'https://event-flow.co.uk/gallery?supplierId=s1',
      api: supplierApi(),
    });
    expect(page.$('#gallery-target').value).toBe('supplier:s1');
  });

  test('an id that is not one of this account’s galleries falls back to the profile', async () => {
    const page = await openGalleryPage({
      url: 'https://event-flow.co.uk/gallery?type=package&id=someone-elses',
      api: supplierApi(),
    });
    expect(page.$('#gallery-target').value).toBe('supplier:s1');
  });

  test('changing the picker loads that gallery and updates the address', async () => {
    const page = await openGalleryPage({ api: supplierApi() });
    page.$('#gallery-target').value = 'package:p1';
    page.$('#gallery-target').dispatchEvent(new page.window.Event('change', { bubbles: true }));
    await page.settle();
    expect(page.calls.some(c => c.url === '/api/me/packages/p1/photos')).toBe(true);
    expect(page.window.location.search).toBe('?type=package&id=p1');
  });

  test('the dashboard link goes to the dashboard that matches the account', async () => {
    const page = await openGalleryPage({ api: supplierApi() });
    expect(page.$('#gallery-dashboard-link').hidden).toBe(false);
    expect(page.$('#gallery-dashboard-link').getAttribute('href')).toBe('/dashboard/supplier');
  });
});

describe('what each kind of visitor sees', () => {
  test('a customer is told galleries are for suppliers, and the cards are not shown', async () => {
    const page = await openGalleryPage({
      api: supplierApi({
        handle: pathname => {
          if (pathname === '/api/v1/auth/me') {
            return json(200, { user: { id: 'c1', role: 'customer' } });
          }
          if (pathname === '/api/me/suppliers' || pathname === '/api/me/packages') {
            return json(403, { error: 'Forbidden' });
          }
          return null;
        },
      }),
    });
    expect(page.$('#gallery-state').hidden).toBe(false);
    expect(page.text('gallery-state-title')).toBe('Photo galleries are for supplier accounts');
    expect(page.$('#gallery-stack').hidden).toBe(true);
    expect(page.$('#gallery-state-link').getAttribute('href')).toBe('/dashboard/customer');
  });

  test('a supplier with no profile is sent to create one', async () => {
    const page = await openGalleryPage({
      api: supplierApi({
        handle: pathname => (pathname === '/api/me/suppliers' ? json(200, { items: [] }) : null),
      }),
    });
    expect(page.text('gallery-state-title')).toBe('Create your profile first');
    expect(page.$('#gallery-state-link').getAttribute('href')).toBe('/dashboard/supplier');
  });

  test('someone who is not logged in is asked to log in', async () => {
    const page = await openGalleryPage({
      api: supplierApi({
        handle: pathname =>
          pathname === '/api/v1/auth/me' ? json(401, { error: 'Unauthorized' }) : null,
      }),
    });
    expect(page.text('gallery-state-title')).toBe('Log in to manage your photos');
    expect(page.$('#gallery-state-link').getAttribute('href')).toBe('/auth?redirect=%2Fgallery');
  });

  test('when the lists cannot be loaded the page says so, not that this is not a supplier account', async () => {
    const page = await openGalleryPage({
      api: supplierApi({
        handle: pathname =>
          pathname === '/api/me/suppliers' || pathname === '/api/me/packages'
            ? json(500, { error: 'Server error' })
            : null,
      }),
    });
    expect(page.text('gallery-state-title')).toBe('Your photos could not be loaded');
    expect(page.$('#gallery-state-link').textContent).toBe('Try again');
    expect(page.$('#gallery-stack').hidden).toBe(true);
  });

  test('an admin can open a gallery by link even though the lists are for suppliers only', async () => {
    const page = await openGalleryPage({
      url: 'https://event-flow.co.uk/gallery?type=supplier&id=s9',
      api: supplierApi({
        handle: pathname => {
          if (pathname === '/api/v1/auth/me') {
            return json(200, { user: { id: 'a1', role: 'admin' } });
          }
          if (pathname === '/api/me/suppliers' || pathname === '/api/me/packages') {
            return json(403, { error: 'Forbidden' });
          }
          return null;
        },
      }),
    });
    expect(page.calls.some(c => c.url === '/api/me/suppliers/s9/photos')).toBe(true);
    expect(page.$('#gallery-stack').hidden).toBe(false);
    // The plan limit would be the admin's own, so none is shown.
    expect(page.text('gallery-target-meta')).toBe('2 photos');
  });
});

describe('the photos', () => {
  test('each photo is a tile with a view button and a delete button, numbered', async () => {
    const page = await openGalleryPage({ api: supplierApi() });
    expect(page.$$('#gallery-grid .gallery-tile')).toHaveLength(2);
    expect(page.$$('.gallery-tile__open').map(b => b.getAttribute('aria-label'))).toEqual([
      'View photo 1 of 2',
      'View photo 2 of 2',
    ]);
    expect(page.$$('.gallery-tile .gallery-btn').map(b => b.getAttribute('aria-label'))).toEqual([
      'Delete photo 1',
      'Delete photo 2',
    ]);
    expect(page.$('.gallery-tile__img').getAttribute('src')).toBe('/a-t.jpg');
    expect(page.text('gallery-count')).toBe('2 photos');
  });

  test('the plan’s limit is shown for a profile', async () => {
    const page = await openGalleryPage({ api: supplierApi() });
    expect(page.text('gallery-target-meta')).toBe('2 of 10 photos used on your plan');
  });

  test('a package shows its count and no limit', async () => {
    const page = await openGalleryPage({
      url: 'https://event-flow.co.uk/gallery?type=package&id=p1',
      api: supplierApi(),
    });
    expect(page.text('gallery-target-meta')).toBe('2 photos');
  });

  test('an empty gallery says so', async () => {
    const page = await openGalleryPage({ api: supplierApi({ photos: [] }) });
    expect(page.$('#gallery-empty').hidden).toBe(false);
    expect(page.text('gallery-empty-title')).toBe('No photos yet');
    expect(page.$('#gallery-grid').hidden).toBe(true);
  });

  test('a failed load shows an error with a retry that tries again', async () => {
    let failing = true;
    const page = await openGalleryPage({
      api: supplierApi({
        handle: (pathname, request) =>
          failing && /photos$/.test(pathname) && request.method === 'GET'
            ? json(500, { error: 'Database unavailable' })
            : null,
      }),
    });
    expect(page.$('#gallery-error').hidden).toBe(false);
    expect(page.text('gallery-error-text')).toBe('Database unavailable');
    failing = false;
    await page.click('#gallery-retry');
    expect(page.$('#gallery-error').hidden).toBe(true);
    expect(page.$$('#gallery-grid .gallery-tile')).toHaveLength(2);
  });

  test('a gallery that is not yours says so instead of showing the server’s wording', async () => {
    const page = await openGalleryPage({
      api: supplierApi({
        handle: (pathname, request) =>
          /photos$/.test(pathname) && request.method === 'GET'
            ? json(403, { error: 'Not owner' })
            : null,
      }),
    });
    expect(page.text('gallery-error-text')).toMatch(/not yours to manage/);
  });

  test('the status filter appears only when a photo is awaiting approval, and filters', async () => {
    const without = await openGalleryPage({ api: supplierApi() });
    expect(without.$('#gallery-filter-wrap').hidden).toBe(true);

    const page = await openGalleryPage({
      api: supplierApi({
        photos: [
          { id: 'a', url: '/a.jpg', thumbnail: '/a.jpg', approved: true },
          { id: 'b', url: '/b.jpg', thumbnail: '/b.jpg', approved: false },
        ],
      }),
    });
    expect(page.$('#gallery-filter-wrap').hidden).toBe(false);
    expect(page.$$('.gallery-pill').map(p => p.textContent)).toEqual(['Awaiting approval']);
    page.$('#gallery-filter').value = 'pending';
    page.$('#gallery-filter').dispatchEvent(new page.window.Event('change', { bubbles: true }));
    await page.settle();
    expect(page.$$('#gallery-grid .gallery-tile')).toHaveLength(1);
    expect(page.text('gallery-count')).toBe('1 of 2 photos');
    // The remaining tile keeps its place in the whole gallery.
    expect(page.$('.gallery-tile__open').getAttribute('aria-label')).toBe('View photo 2 of 2');
  });

  test('an image address that is not a web address or a site path is never used as a source', async () => {
    const page = await openGalleryPage({
      api: supplierApi({
        photos: [{ id: 'a', url: 'javascript:alert(1)', thumbnail: 'javascript:alert(1)' }],
      }),
    });
    expect(page.$('.gallery-tile__img').getAttribute('src')).toBe('data:,');
  });

  test('a slow answer for a gallery that is no longer shown is dropped', async () => {
    let releaseSlow;
    const slow = new Promise(resolve => {
      releaseSlow = resolve;
    });
    const page = await openGalleryPage({
      api: supplierApi({
        handle: async (pathname, request) => {
          if (pathname === '/api/me/suppliers/s1/photos' && request.method === 'GET') {
            await slow;
            return json(200, { photos: [{ id: 'old', url: '/old.jpg', thumbnail: '/old.jpg' }] });
          }
          return null;
        },
      }),
    });
    page.$('#gallery-target').value = 'package:p1';
    page.$('#gallery-target').dispatchEvent(new page.window.Event('change', { bubbles: true }));
    await page.settle();
    expect(page.$$('.gallery-tile')).toHaveLength(2);
    releaseSlow();
    await page.settle();
    expect(page.$$('.gallery-tile__img').map(img => img.getAttribute('src'))).toEqual([
      '/a-t.jpg',
      '/b-t.jpg',
    ]);
  });
});

describe('choosing files', () => {
  test('valid photos are listed with a remove button and Upload names how many', async () => {
    const page = await openGalleryPage({ api: supplierApi() });
    expect(page.$('#gallery-actions').hidden).toBe(true);
    await page.pickFiles([page.makeFile('one.jpg'), page.makeFile('two.png', 'image/png')]);
    expect(page.$$('#gallery-staged .gallery-staged__item')).toHaveLength(2);
    expect(page.$('#gallery-actions').hidden).toBe(false);
    expect(page.text('gallery-upload')).toBe('Upload 2 photos');
    expect(page.$('#gallery-upload').disabled).toBe(false);
  });

  test('a file that is not a photo, or is too large, is refused with its name and the reason', async () => {
    const page = await openGalleryPage({ api: supplierApi() });
    await page.pickFiles([
      page.makeFile('notes.pdf', 'application/pdf'),
      page.makeFile('huge.jpg', 'image/jpeg', 11 * 1024 * 1024),
    ]);
    expect(page.text('gallery-upload-status')).toContain(
      'notes.pdf is not a JPEG, PNG, WebP or GIF image.'
    );
    expect(page.text('gallery-upload-status')).toContain('huge.jpg is larger than 10 MB.');
    expect(page.$('#gallery-upload-status').dataset.state).toBe('error');
    expect(page.$$('#gallery-staged .gallery-staged__item')).toHaveLength(0);
  });

  test('only ten photos can be added at a time', async () => {
    const page = await openGalleryPage({ api: supplierApi({ photos: [] }) });
    await page.pickFiles(Array.from({ length: 12 }, (_, i) => page.makeFile(`p${i}.jpg`)));
    expect(page.$$('#gallery-staged .gallery-staged__item')).toHaveLength(10);
    expect(page.text('gallery-upload-status')).toContain('Up to 10 photos can be added at a time');
    expect(page.$('#gallery-upload-status').dataset.state).toBe('warn');
  });

  test('a profile cannot be filled past its plan, and the message says how many fit', async () => {
    const photos = Array.from({ length: 9 }, (_, i) => ({
      id: `x${i}`,
      url: `/x${i}.jpg`,
      thumbnail: `/x${i}.jpg`,
    }));
    const page = await openGalleryPage({ api: supplierApi({ photos }) });
    await page.pickFiles([page.makeFile('a.jpg'), page.makeFile('b.jpg')]);
    expect(page.$$('#gallery-staged .gallery-staged__item')).toHaveLength(1);
    expect(page.text('gallery-upload-status')).toContain('room for 1 more photo');
  });

  test('choosing the same file twice lists it once, and Remove and Clear work', async () => {
    const page = await openGalleryPage({ api: supplierApi() });
    await page.pickFiles([
      page.makeFile('one.jpg'),
      page.makeFile('one.jpg'),
      page.makeFile('two.jpg'),
    ]);
    expect(page.$$('#gallery-staged .gallery-staged__item')).toHaveLength(2);
    await page.click('.gallery-staged__remove');
    expect(page.$$('#gallery-staged .gallery-staged__item')).toHaveLength(1);
    await page.click('#gallery-clear');
    expect(page.$('#gallery-staged').hidden).toBe(true);
    expect(page.$('#gallery-actions').hidden).toBe(true);
  });

  test('a photo dropped on the zone is added', async () => {
    const page = await openGalleryPage({ api: supplierApi() });
    const drop = new page.window.Event('drop', { bubbles: true, cancelable: true });
    drop.dataTransfer = { files: [page.makeFile('dropped.jpg')] };
    page.$('#gallery-drop').dispatchEvent(drop);
    await page.settle();
    expect(page.$$('#gallery-staged .gallery-staged__item')).toHaveLength(1);
  });
});

describe('uploading', () => {
  const chosen = async page => {
    await page.pickFiles([page.makeFile('one.jpg'), page.makeFile('two.jpg')]);
  };

  test('sends the photos to the gallery on screen, with the CSRF token, then shows the new list', async () => {
    let photos = [{ id: 'a', url: '/a.jpg', thumbnail: '/a.jpg' }];
    const page = await openGalleryPage({
      url: 'https://event-flow.co.uk/gallery?type=package&id=p1',
      api: supplierApi({
        handle: (pathname, request) =>
          /photos$/.test(pathname) && request.method === 'GET' ? json(200, { photos }) : null,
      }),
      upload: () => {
        photos = [...photos, { id: 'b', url: '/b.jpg', thumbnail: '/b.jpg' }];
        return json(200, { success: true, uploaded: 2 });
      },
    });
    await chosen(page);
    await page.click('#gallery-upload');

    expect(page.uploads).toHaveLength(1);
    const [sent] = page.uploads;
    expect(sent.url).toBe('/api/photos/upload/batch?type=package&id=p1');
    expect(sent.method).toBe('POST');
    expect(sent.headers['X-CSRF-Token']).toBe('token-1');
    expect(sent.body.getAll('photos').map(file => file.name)).toEqual(['one.jpg', 'two.jpg']);

    expect(page.text('gallery-upload-status')).toBe('2 photos added.');
    expect(page.$('#gallery-upload-status').dataset.state).toBe('success');
    expect(page.$$('#gallery-staged .gallery-staged__item')).toHaveLength(0);
    expect(page.$$('#gallery-grid .gallery-tile')).toHaveLength(2);
    expect(page.$('#gallery-progress').hidden).toBe(true);
  });

  test('a refused CSRF token is replaced and the upload is tried once more', async () => {
    let attempts = 0;
    const page = await openGalleryPage({
      api: supplierApi(),
      upload: (url, headers) => {
        attempts += 1;
        return headers['X-CSRF-Token'] === 'token-1'
          ? json(403, { error: 'Invalid CSRF token' })
          : json(200, { success: true, uploaded: 2 });
      },
    });
    // The page asks for a fresh token the second time, so give it a different one.
    let tokens = 0;
    const original = page.window.fetch;
    page.window.fetch = async (url, init) =>
      /csrf-token/.test(url) && ++tokens > 1
        ? { ok: true, status: 200, text: async () => JSON.stringify({ csrfToken: 'token-2' }) }
        : original(url, init);
    await chosen(page);
    await page.click('#gallery-upload');
    expect(attempts).toBe(2);
    expect(page.uploads.map(u => u.headers['X-CSRF-Token'])).toEqual(['token-1', 'token-2']);
    expect(page.text('gallery-upload-status')).toBe('2 photos added.');
  });

  test('photos that are held for approval say so', async () => {
    const page = await openGalleryPage({
      api: supplierApi(),
      upload: () => json(200, { success: true, uploaded: 2, pending: true }),
    });
    await chosen(page);
    await page.click('#gallery-upload');
    expect(page.text('gallery-upload-status')).toContain('once they have been approved');
  });

  test('when some photos fail the page says which and why, and keeps the ones that did upload', async () => {
    const page = await openGalleryPage({
      api: supplierApi(),
      upload: () =>
        json(200, {
          success: true,
          uploaded: 1,
          errors: [{ filename: 'two.jpg', error: 'Corrupt image' }],
        }),
    });
    await chosen(page);
    await page.click('#gallery-upload');
    expect(page.text('gallery-upload-status')).toBe(
      '1 photo added. Some could not be uploaded. two.jpg: Corrupt image'
    );
    expect(page.$('#gallery-upload-status').dataset.state).toBe('warn');
  });

  test('a plan limit refusal shows the server’s words and keeps the photos to try again', async () => {
    const page = await openGalleryPage({
      api: supplierApi(),
      upload: () =>
        json(403, {
          error: 'Your plan includes up to 10 photos. You currently have 10.',
          code: 'PHOTO_LIMIT_REACHED',
          limit: 10,
          current: 10,
        }),
    });
    await chosen(page);
    await page.click('#gallery-upload');
    expect(page.text('gallery-upload-status')).toBe(
      'Your plan includes up to 10 photos. You currently have 10.'
    );
    expect(page.$('#gallery-upload-status').dataset.state).toBe('error');
    expect(page.$$('#gallery-staged .gallery-staged__item')).toHaveLength(2);
    expect(page.$('#gallery-upload').disabled).toBe(false);
  });

  test('a dropped connection is reported and the photos are kept', async () => {
    const page = await openGalleryPage({
      api: supplierApi(),
      upload: () => ({ networkError: true }),
    });
    await chosen(page);
    await page.click('#gallery-upload');
    expect(page.text('gallery-upload-status')).toContain('The connection failed');
    expect(page.$$('#gallery-staged .gallery-staged__item')).toHaveLength(2);
  });

  test('a plain-text refusal (a rate limiter’s) is shown, not swallowed', async () => {
    const page = await openGalleryPage({
      api: supplierApi(),
      upload: () => ({ status: 429, body: 'Too many requests, slow down.' }),
    });
    await chosen(page);
    await page.click('#gallery-upload');
    expect(page.text('gallery-upload-status')).toBe('Too many requests, slow down.');
  });

  test('while uploading, the controls are off, so nothing is sent twice', async () => {
    let release;
    const held = new Promise(resolve => {
      release = resolve;
    });
    const page = await openGalleryPage({
      api: supplierApi(),
      upload: async () => {
        await held;
        return json(200, { success: true, uploaded: 2 });
      },
    });
    await chosen(page);
    page.$('#gallery-upload').dispatchEvent(new page.window.MouseEvent('click', { bubbles: true }));
    await page.settle();
    expect(page.$('#gallery-upload').disabled).toBe(true);
    expect(page.$('#gallery-target').disabled).toBe(true);
    expect(page.$('#gallery-progress').hidden).toBe(false);
    expect(page.$('#gallery-progress').getAttribute('aria-valuenow')).toBe('50');
    page.$('#gallery-upload').dispatchEvent(new page.window.MouseEvent('click', { bubbles: true }));
    release();
    await page.settle();
    expect(page.uploads).toHaveLength(1);
  });
});

describe('deleting a photo', () => {
  const openDelete = async (page, label) => {
    await page.click(`.gallery-tile .gallery-btn[aria-label="${label}"]`);
  };

  test('asks first, in a dialog, and Keep photo changes nothing', async () => {
    const page = await openGalleryPage({ api: supplierApi() });
    await openDelete(page, 'Delete photo 2');
    expect(page.$('#gallery-delete-dialog').hasAttribute('open')).toBe(true);
    expect(page.text('gallery-delete-text')).toBe(
      'Photo 2 will be removed from Romeo Venues. This cannot be undone.'
    );
    await page.click('#gallery-delete-cancel');
    expect(page.$('#gallery-delete-dialog').hasAttribute('open')).toBe(false);
    expect(page.calls.filter(c => c.method === 'DELETE')).toHaveLength(0);
  });

  test('a profile photo is deleted by its id, with the CSRF token, then the list reloads', async () => {
    let photos = [
      { id: 'photo_a', url: '/a.jpg', thumbnail: '/a.jpg' },
      { id: 'https://x.test/a b.jpg', url: '/b.jpg', thumbnail: '/b.jpg' },
    ];
    const page = await openGalleryPage({
      api: supplierApi({
        handle: (pathname, request) => {
          if (request.method === 'GET' && /photos$/.test(pathname)) {
            return json(200, { photos });
          }
          if (request.method === 'DELETE') {
            photos = photos.slice(0, 1);
            return json(200, { success: true });
          }
          return null;
        },
      }),
    });
    await openDelete(page, 'Delete photo 2');
    await page.click('#gallery-delete-confirm');
    const [del] = page.calls.filter(c => c.method === 'DELETE');
    expect(del.url).toBe('/api/me/suppliers/s1/photos/https%3A%2F%2Fx.test%2Fa%20b.jpg');
    expect(del.headers['X-CSRF-Token']).toBe('token-1');
    expect(page.$('#gallery-delete-dialog').hasAttribute('open')).toBe(false);
    expect(page.text('gallery-photos-status')).toBe('Photo deleted.');
    expect(page.$$('#gallery-grid .gallery-tile')).toHaveLength(1);
    // Keyboard focus is not left on a button that has gone.
    expect(page.document.activeElement.id).toBe('gallery-photos-title');
  });

  test('the photos stay on screen while the list reloads, instead of collapsing to the skeleton', async () => {
    let photos = [
      { id: 'a', url: '/a.jpg', thumbnail: '/a.jpg' },
      { id: 'b', url: '/b.jpg', thumbnail: '/b.jpg' },
    ];
    let release;
    let hold = null;
    const page = await openGalleryPage({
      api: supplierApi({
        handle: async (pathname, request) => {
          if (request.method === 'GET' && /photos$/.test(pathname)) {
            if (hold) {
              await hold;
            }
            return json(200, { photos });
          }
          if (request.method === 'DELETE') {
            photos = photos.slice(0, 1);
            return json(200, { success: true });
          }
          return null;
        },
      }),
    });
    await openDelete(page, 'Delete photo 2');
    hold = new Promise(resolve => {
      release = resolve;
    });
    page
      .$('#gallery-delete-confirm')
      .dispatchEvent(new page.window.MouseEvent('click', { bubbles: true }));
    await page.settle();
    // The reload is in flight: the grid is still there and the skeleton is not shown.
    expect(page.$('#gallery-grid').hidden).toBe(false);
    expect(page.$$('#gallery-grid .gallery-tile')).toHaveLength(2);
    expect(page.$('#gallery-loading').hidden).toBe(true);
    release();
    await page.settle();
    expect(page.$$('#gallery-grid .gallery-tile')).toHaveLength(1);
  });

  test('a reload that fails after an upload clears the stale photos and shows the error', async () => {
    let failing = false;
    const page = await openGalleryPage({
      api: supplierApi({
        handle: (pathname, request) =>
          failing && request.method === 'GET' && /photos$/.test(pathname)
            ? json(500, { error: 'Database unavailable' })
            : null,
      }),
      upload: () => {
        failing = true;
        return json(200, { success: true, uploaded: 1 });
      },
    });
    await page.pickFiles([page.makeFile('one.jpg')]);
    await page.click('#gallery-upload');
    expect(page.$('#gallery-error').hidden).toBe(false);
    expect(page.$$('#gallery-grid .gallery-tile')).toHaveLength(0);
    expect(page.$('#gallery-grid').hidden).toBe(true);
  });

  test('a package photo is deleted by its address', async () => {
    const page = await openGalleryPage({
      url: 'https://event-flow.co.uk/gallery?type=package&id=p1',
      api: supplierApi({
        handle: (pathname, request) =>
          request.method === 'DELETE' ? json(200, { ok: true }) : null,
      }),
    });
    await openDelete(page, 'Delete photo 1');
    await page.click('#gallery-delete-confirm');
    const [del] = page.calls.filter(c => c.method === 'DELETE');
    expect(del.url).toBe('/api/me/packages/p1/photos');
    expect(JSON.parse(del.body)).toEqual({ url: '/a.jpg' });
    expect(del.headers['Content-Type']).toBe('application/json');
  });

  test('a refusal keeps the dialog open and says why', async () => {
    const page = await openGalleryPage({
      api: supplierApi({
        handle: (pathname, request) =>
          request.method === 'DELETE'
            ? json(403, { error: 'Your profile has to be approved first' })
            : null,
      }),
    });
    await openDelete(page, 'Delete photo 1');
    await page.click('#gallery-delete-confirm');
    expect(page.$('#gallery-delete-dialog').hasAttribute('open')).toBe(true);
    expect(page.$('#gallery-delete-error').hidden).toBe(false);
    expect(page.text('gallery-delete-error')).toBe('Your profile has to be approved first');
    expect(page.$('#gallery-delete-confirm').disabled).toBe(false);
    expect(page.$$('#gallery-grid .gallery-tile')).toHaveLength(2);
  });

  test('a refused CSRF token is replaced and the delete is tried once more', async () => {
    let attempts = 0;
    const page = await openGalleryPage({
      api: supplierApi({
        handle: (pathname, request) => {
          if (request.method !== 'DELETE') {
            return null;
          }
          attempts += 1;
          return attempts === 1
            ? json(403, { error: 'CSRF token missing' })
            : json(200, { success: true });
        },
      }),
    });
    await openDelete(page, 'Delete photo 1');
    await page.click('#gallery-delete-confirm');
    expect(attempts).toBe(2);
    expect(page.$('#gallery-delete-dialog').hasAttribute('open')).toBe(false);
  });
});

describe('the viewer', () => {
  test('opens on the photo chosen, shows the large version, and the arrows wrap around', async () => {
    const page = await openGalleryPage({
      api: supplierApi({
        photos: [
          { id: 'a', url: '/a.jpg', thumbnail: '/a-t.jpg', large: '/a-l.jpg' },
          { id: 'b', url: '/b.jpg', thumbnail: '/b-t.jpg' },
          { id: 'c', url: '/c.jpg', thumbnail: '/c-t.jpg' },
        ],
      }),
    });
    await page.click('.gallery-tile__open');
    expect(page.$('#gallery-lightbox').hasAttribute('open')).toBe(true);
    expect(page.$('#gallery-lightbox-image').getAttribute('src')).toBe('/a-l.jpg');
    expect(page.text('gallery-lightbox-count')).toBe('Photo 1 of 3');
    expect(page.$('#gallery-lightbox-full').getAttribute('href')).toBe('/a-l.jpg');

    await page.click('#gallery-lightbox-prev');
    expect(page.text('gallery-lightbox-count')).toBe('Photo 3 of 3');
    await page.click('#gallery-lightbox-next');
    expect(page.text('gallery-lightbox-count')).toBe('Photo 1 of 3');

    page
      .$('#gallery-lightbox')
      .dispatchEvent(
        new page.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })
      );
    expect(page.text('gallery-lightbox-count')).toBe('Photo 2 of 3');
    expect(page.$('#gallery-lightbox-image').getAttribute('src')).toBe('/b.jpg');

    await page.click('#gallery-lightbox-close');
    expect(page.$('#gallery-lightbox').hasAttribute('open')).toBe(false);
  });

  test('with one photo there are no arrows', async () => {
    const page = await openGalleryPage({
      api: supplierApi({ photos: [{ id: 'a', url: '/a.jpg', thumbnail: '/a.jpg' }] }),
    });
    await page.click('.gallery-tile__open');
    expect(page.$('#gallery-lightbox-prev').hidden).toBe(true);
    expect(page.$('#gallery-lightbox-next').hidden).toBe(true);
  });
});

run().then(results => {
  process.stdout.write(JSON.stringify(results));
  process.exit(0);
});
