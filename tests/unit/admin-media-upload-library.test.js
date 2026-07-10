const fs = require('fs');
const path = require('path');

describe('admin Media Centre uploaded media library', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../public/admin-media.html'), 'utf8');
  const script = fs.readFileSync(
    path.join(__dirname, '../../public/assets/js/pages/admin-media-upload-library.js'),
    'utf8'
  );

  test('loads the uploaded media library after the Pexels Media Centre script', () => {
    expect(html.indexOf('/assets/js/pages/admin-media-upload-library.js')).toBeGreaterThan(
      html.indexOf('/assets/js/pages/admin-media-init.js')
    );
    expect(html).toContain('Manage uploaded photos and videos');
  });

  test('uses the existing secured collage upload endpoints', () => {
    expect(script).toContain("api('/api/v1/admin/homepage/collage-media')");
    expect(script).toContain("formData.append('media', file)");
    expect(script).toContain("'X-CSRF-Token': await csrfToken()");
    expect(script).toContain('/api/v1/admin/homepage/collage-media/${encodeURIComponent(item.filename)}');
  });

  test('assigns uploads to an explicit homepage version and placement', () => {
    expect(script).toContain('/api/v1/admin/homepage/manager/version/${version}');
    expect(script).toContain('library.selectedUploads');
    expect(script).toContain("assignedTargets: [target]");
    expect(script).toContain("selectedMediaId: target === 'hero' ? id");
    expect(script).toContain("library.mode = mode");
  });

  test('keeps the legacy uploadGallery contract in sync for existing homepage clients', () => {
    expect(script).toContain('uploadGallery: Array.from');
    expect(script).toContain('library.selectedUploads.map(upload => upload.url)');
  });

  test('shows assignment usage badges and editable homepage names', () => {
    expect(script).toContain('assignmentBadges(item)');
    expect(script).toContain('versionName(version)');
    expect(script).toContain("document.getElementById('assignmentVersion')");
  });
});
