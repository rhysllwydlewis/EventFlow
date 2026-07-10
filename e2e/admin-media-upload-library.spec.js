import { test, expect } from '@playwright/test';

function emptySettings() {
  return {
    collageWidget: {
      enabled: true,
      source: 'pexels',
      mediaTypes: { photos: true, videos: true },
      uploadGallery: [],
      fallbackToPexels: true,
    },
    mediaLibrary: {
      mode: 'auto_pexels_mixed',
      mediaTypes: { photos: true, videos: true },
      fallback: { enabled: true, source: 'pexels', minimumItems: 6 },
      selectedPexels: [],
      selectedUploads: [],
      hero: { mode: 'auto', selectedMediaId: null, order: [] },
    },
  };
}

function managerFixture() {
  return {
    activeVersion: 'v1',
    versions: Object.fromEntries(
      ['v1', 'v2', 'v3'].map((version, index) => [
        version,
        {
          id: version,
          tabName: `Homepage ${index + 1}`,
          settings: emptySettings(),
        },
      ])
    ),
  };
}

async function mockMediaCentre(page) {
  let manager = managerFixture();
  let media = [];
  const versionUpdates = [];
  const authBody = JSON.stringify({
    user: { id: 'admin-1', role: 'admin', name: 'Admin', email: 'admin@example.com' },
  });

  for (const pattern of ['**/api/auth/me', '**/api/v1/auth/me']) {
    await page.route(pattern, route =>
      route.fulfill({ status: 200, contentType: 'application/json', body: authBody })
    );
  }

  await page.route('**/api/v1/csrf-token', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ csrfToken: 'test-csrf' }),
    })
  );

  await page.route('**/api/pexels/status', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ configured: true }),
    })
  );
  await page.route('**/api/pexels/categories', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ categories: [] }),
    })
  );
  await page.route('**/api/pexels/curated**', route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ photos: [], page: 1, totalResults: 0 }),
    })
  );

  await page.route('**/api/v1/admin/homepage/collage-media**', async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;

    if (request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ media }),
      });
      return;
    }

    if (request.method() === 'POST') {
      media = [
        {
          filename: 'collage-test-video.mp4',
          url: '/uploads/homepage-collage/collage-test-video.mp4',
          type: 'video',
          size: 1024,
          uploadedAt: new Date().toISOString(),
        },
      ];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, media }),
      });
      return;
    }

    if (request.method() === 'DELETE' && pathname.includes('collage-test-video.mp4')) {
      media = [];
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
      return;
    }

    await route.fulfill({ status: 400, contentType: 'application/json', body: '{}' });
  });

  await page.route('**/api/v1/admin/homepage/manager**', async route => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;

    if (request.method() === 'GET' && pathname.endsWith('/manager')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ manager }),
      });
      return;
    }

    const match = pathname.match(/\/manager\/version\/(v[123])$/);
    if (request.method() === 'PUT' && match) {
      const version = match[1];
      const payload = request.postDataJSON();
      versionUpdates.push({ version, payload });
      manager = {
        ...manager,
        versions: {
          ...manager.versions,
          [version]: {
            ...manager.versions[version],
            settings: payload.settings,
          },
        },
      };
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ manager, version: manager.versions[version] }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ manager, versions: {} }),
    });
  });

  return { versionUpdates };
}

test.describe('Media Centre uploaded media library', () => {
  test('uploads a video and assigns it to the V3 hero', async ({ page }) => {
    const state = await mockMediaCentre(page);
    await page.goto('/admin-media.html');

    await expect(page.getByRole('heading', { name: 'Uploaded media library' })).toBeVisible();
    await expect(page.locator('.admin-upload-empty')).toBeVisible();

    await page.locator('#uploadedMediaFiles').setInputFiles({
      name: 'hero-video.mp4',
      mimeType: 'video/mp4',
      buffer: Buffer.from('eventflow-test-video'),
    });
    await page.locator('#uploadMediaFiles').click();

    await expect(page.getByText('collage-test-video.mp4')).toBeVisible();
    await page.getByRole('button', { name: 'Assign to homepage' }).click();
    await page.locator('#uploadedAssignmentVersion').selectOption('v3');
    await page.locator('#uploadedAssignmentTarget').selectOption('hero');
    await page.locator('#uploadedAssignmentMode').selectOption('uploads');
    await page.locator('#uploadedAssignmentSave').click();

    await expect.poll(() => state.versionUpdates.length).toBe(1);
    const update = state.versionUpdates[0];
    expect(update.version).toBe('v3');
    expect(update.payload.settings.mediaLibrary.mode).toBe('uploads');
    expect(update.payload.settings.mediaLibrary.selectedUploads[0]).toMatchObject({
      type: 'video',
      assignedTargets: ['hero'],
      url: '/uploads/homepage-collage/collage-test-video.mp4',
    });
    expect(update.payload.settings.collageWidget.uploadGallery).toContain(
      '/uploads/homepage-collage/collage-test-video.mp4'
    );
  });
});
