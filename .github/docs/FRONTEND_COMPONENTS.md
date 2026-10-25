# EventFlow Frontend Components Documentation

This document describes the frontend JavaScript components available for building EventFlow UI features.

## Table of Contents

1. [Photo Uploader Component](#photo-uploader-component)
2. [Photo Gallery Component](#photo-gallery-component)
3. [Usage Examples](#usage-examples)

---

## Photo Uploader Component

> **Removed.** No page loaded this component, so `photo-uploader.js` was deleted. The dashboards upload
> photos through their own drop zones (`app.js`, `supplier-gallery.js`). The notes below are kept for history only.

The `PhotoUploader` component provides a drag-and-drop photo upload interface with preview, progress tracking, and error handling.

### Location

`/public/assets/js/components/photo-uploader.js`

### Features

- ✅ Drag-and-drop zone with visual feedback
- ✅ Multi-file selection (configurable, default: 10 files)
- ✅ Live preview thumbnails before upload
- ✅ Progress bars (per-file and overall)
- ✅ Error handling with user-friendly messages
- ✅ Mobile-friendly touch support
- ✅ File type validation
- ✅ File size validation
- ✅ Automatic styling injection

### Basic Usage

```html
<script src="/assets/js/components/photo-uploader.js"></script>
<div id="upload-container"></div>

<script>
  const uploader = new PhotoUploader({
    uploadUrl: '/api/photos/upload',
    maxFiles: 10,
    maxFileSize: 10 * 1024 * 1024, // 10MB
    onSuccess: response => {
      console.log('Upload successful:', response);
      // Refresh gallery or update UI
    },
    onError: error => {
      console.error('Upload failed:', error);
    },
  });

  // Append to a container
  uploader.appendTo('#upload-container');
</script>
```

### Constructor Options

| Option          | Type     | Default                                                               | Description                        |
| --------------- | -------- | --------------------------------------------------------------------- | ---------------------------------- |
| `uploadUrl`     | String   | `/api/photos/upload`                                                  | API endpoint for photo upload      |
| `maxFiles`      | Number   | `10`                                                                  | Maximum number of files per upload |
| `maxFileSize`   | Number   | `10485760` (10MB)                                                     | Maximum file size in bytes         |
| `acceptedTypes` | Array    | `['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']` | Allowed MIME types                 |
| `onSuccess`     | Function | `() => {}`                                                            | Callback on successful upload      |
| `onError`       | Function | `(error) => {}`                                                       | Callback on error                  |
| `onProgress`    | Function | `(percent) => {}`                                                     | Callback on upload progress        |

### Methods

#### `appendTo(target)`

Appends the uploader to a DOM element.

```javascript
uploader.appendTo('#container');
// or
uploader.appendTo(document.getElementById('container'));
```

#### `getElement()`

Returns the uploader's DOM element.

```javascript
const element = uploader.getElement();
document.body.appendChild(element);
```

#### `clear()`

Clears selected files and resets the uploader.

```javascript
uploader.clear();
```

### Example: Supplier Dashboard Integration

```html
<div class="card">
  <h3>Upload Photos</h3>
  <div id="supplier-photo-uploader"></div>
</div>

<script>
  const supplierId = 'supplier-123'; // Get from current user

  const uploader = new PhotoUploader({
    uploadUrl: `/api/suppliers/${supplierId}/photos/upload`,
    maxFiles: 10,
    onSuccess: response => {
      alert(`Successfully uploaded ${response.photos.length} photo(s)!`);
      // Reload gallery
      loadSupplierGallery();
    },
    onError: error => {
      console.error('Upload error:', error);
    },
    onProgress: percent => {
      console.log(`Upload progress: ${percent}%`);
    },
  });

  uploader.appendTo('#supplier-photo-uploader');
</script>
```

---

## Photo Gallery Component

> **Removed in #1839.** No page loaded this component, so `public/assets/js/components/photo-gallery.js`
> was deleted. Nothing below (including the dashboard example further down) can be used as written; the
> notes are kept for history only.

The `PhotoGallery` component displays photos in a responsive grid with lightbox viewer, lazy loading, and optional editing features.

### Location

`/public/assets/js/components/photo-gallery.js`

### Features

- ✅ Responsive CSS grid layout (1-4 columns based on viewport)
- ✅ Lazy loading with Intersection Observer API
- ✅ Lightbox viewer with keyboard navigation (←, →, ESC)
- ✅ Zoom and swipe gestures for mobile
- ✅ Caption overlays
- ✅ Photo reordering (drag-drop)
- ✅ Delete confirmation modal
- ✅ Approval status badges (for admin)
- ✅ Automatic styling injection

### Basic Usage

```html
<script src="/assets/js/components/photo-gallery.js"></script>
<div id="gallery-container"></div>

<script>
  const gallery = new PhotoGallery({
    photos: [
      {
        id: 'photo-1',
        url: '/uploads/photo1.jpg',
        thumbnail: '/uploads/photo1-thumb.jpg',
        large: '/uploads/photo1-large.jpg',
        caption: 'Beautiful venue',
        approved: true,
      },
      {
        id: 'photo-2',
        url: '/uploads/photo2.jpg',
        caption: 'Reception hall',
      },
    ],
    lightbox: true,
    lazyLoad: true,
    editable: false,
    onDelete: photoId => {
      console.log('Delete photo:', photoId);
      // Call API to delete photo
    },
  });

  gallery.appendTo('#gallery-container');
</script>
```

### Constructor Options

| Option        | Type          | Default            | Description                        |
| ------------- | ------------- | ------------------ | ---------------------------------- |
| `photos`      | Array         | `[]`               | Array of photo objects             |
| `lightbox`    | Boolean       | `true`             | Enable lightbox viewer             |
| `lazyLoad`    | Boolean       | `true`             | Enable lazy loading                |
| `editable`    | Boolean       | `false`            | Show delete/edit buttons           |
| `reorderable` | Boolean       | `false`            | Enable drag-drop reordering        |
| `columns`     | String/Number | `'auto'`           | Grid columns ('auto', 1, 2, 3, 4)  |
| `onDelete`    | Function      | `() => {}`         | Callback when photo is deleted     |
| `onReorder`   | Function      | `(photoIds) => {}` | Callback when photos are reordered |

### Photo Object Structure

```javascript
{
  id: 'unique-id',           // Required: Unique identifier
  url: '/path/to/photo.jpg', // Required: Full-size image URL
  thumbnail: '/path/thumb.jpg', // Optional: Thumbnail URL
  large: '/path/large.jpg',  // Optional: Large/original URL for lightbox
  caption: 'Photo caption',  // Optional: Photo caption
  approved: true             // Optional: Approval status (for moderation)
}
```

### Methods

#### `updatePhotos(photos)`

Updates the gallery with new photos.

```javascript
gallery.updatePhotos([{ id: '1', url: '/photo1.jpg', caption: 'New photo' }]);
```

#### `addPhoto(photo)`

Adds a single photo to the gallery.

```javascript
gallery.addPhoto({
  id: 'new-1',
  url: '/new-photo.jpg',
  caption: 'Recently uploaded',
});
```

#### `appendTo(target)`

Appends the gallery to a DOM element.

```javascript
gallery.appendTo('#container');
```

#### `getElement()`

Returns the gallery's DOM element.

```javascript
const element = gallery.getElement();
```

#### `destroy()`

Removes the gallery and cleans up event listeners.

```javascript
gallery.destroy();
```

### Keyboard Navigation (Lightbox)

| Key               | Action         |
| ----------------- | -------------- |
| `←` (Left Arrow)  | Previous photo |
| `→` (Right Arrow) | Next photo     |
| `ESC`             | Close lightbox |

### Example: Supplier Detail Page Integration

```html
<div class="card">
  <h2>Photo Gallery</h2>
  <div id="supplier-gallery"></div>
</div>

<script>
  async function loadSupplierGallery() {
    const supplierId = 'supplier-123';

    // Fetch photos from API
    const response = await fetch(`/api/suppliers/${supplierId}/photos`);
    const data = await response.json();

    // Create gallery
    const gallery = new PhotoGallery({
      photos: data.photos,
      lightbox: true,
      lazyLoad: true,
      editable: false, // Set to true for supplier owner
      columns: 3,
    });

    gallery.appendTo('#supplier-gallery');
  }

  loadSupplierGallery();
</script>
```

### Example: Editable Gallery (Supplier Dashboard)

```html
<div class="card">
  <h3>Manage Your Photos</h3>
  <div id="editable-gallery"></div>
</div>

<script>
  const supplierId = 'current-supplier-id';

  async function loadEditableGallery() {
    const response = await fetch(`/api/suppliers/${supplierId}/photos`);
    const data = await response.json();

    const gallery = new PhotoGallery({
      photos: data.photos,
      editable: true,
      reorderable: true,
      onDelete: async photoId => {
        if (!confirm('Delete this photo?')) return;

        const response = await fetch(`/api/photos/${photoId}`, {
          method: 'DELETE',
        });

        if (response.ok) {
          // Photo will be removed from gallery automatically
          alert('Photo deleted successfully');
        } else {
          alert('Failed to delete photo');
        }
      },
      onReorder: async photoIds => {
        // Save new order to server
        await fetch(`/api/suppliers/${supplierId}/photos/reorder`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ order: photoIds }),
        });
      },
    });

    gallery.appendTo('#editable-gallery');
  }

  loadEditableGallery();
</script>
```

---

## Usage Examples

### Complete Supplier Dashboard Example

> **Outdated (#1839).** This example loads `photo-uploader.js` and `photo-gallery.js`, both deleted. Kept for history only.

```html
<!DOCTYPE html>
<html>
  <head>
    <title>Supplier Dashboard</title>
    <script src="/assets/js/components/photo-uploader.js"></script>
    <script src="/assets/js/components/photo-gallery.js"></script>
  </head>
  <body>
    <div class="container">
      <h1>My Supplier Dashboard</h1>

      <!-- Photo Upload Section -->
      <div class="card">
        <h2>Upload New Photos</h2>
        <div id="upload-section"></div>
      </div>

      <!-- Gallery Section -->
      <div class="card">
        <h2>My Photos</h2>
        <div id="gallery-section"></div>
      </div>
    </div>

    <script>
      const supplierId = 'my-supplier-id'; // Get from authenticated user

      // Initialize uploader
      const uploader = new PhotoUploader({
        uploadUrl: `/api/suppliers/${supplierId}/photos/upload`,
        onSuccess: response => {
          alert('Photos uploaded successfully!');
          // Reload gallery
          loadGallery();
        },
      });
      uploader.appendTo('#upload-section');

      // Initialize gallery
      let gallery;

      async function loadGallery() {
        const response = await fetch(`/api/suppliers/${supplierId}/photos`);
        const data = await response.json();

        // Destroy existing gallery if any
        if (gallery) gallery.destroy();

        // Create new gallery
        gallery = new PhotoGallery({
          photos: data.photos,
          editable: true,
          reorderable: true,
          onDelete: async photoId => {
            if (confirm('Delete this photo?')) {
              await fetch(`/api/photos/${photoId}`, { method: 'DELETE' });
              loadGallery(); // Reload
            }
          },
        });

        gallery.appendTo('#gallery-section');
      }

      // Load gallery on page load
      loadGallery();
    </script>
  </body>
</html>
```

### Mobile Responsive Considerations

Both components are mobile-friendly by default:

- **PhotoUploader**: Touch-friendly drag-and-drop, mobile file picker support
- **PhotoGallery**: Responsive grid (adjusts columns), swipe gestures in lightbox

### Browser Compatibility

- Modern browsers (Chrome, Firefox, Safari, Edge)
- Requires ES6 support
- Uses:
  - Intersection Observer API (lazy loading)
  - Drag and Drop API (reordering)
  - FormData API (file uploads)
  - Fetch API (HTTP requests)

### Styling Customization

Both components inject their own styles automatically. To customize:

```css
/* Override uploader styles */
.photo-uploader__dropzone {
  border-color: #your-color !important;
}

/* Override gallery styles */
.photo-gallery__grid {
  gap: 2rem !important;
}
```

Or modify the component source files directly in `/public/assets/js/components/`.

---

## API Endpoints for Components

### Photo Upload

```http
POST /api/suppliers/:id/photos/upload
Content-Type: multipart/form-data

photos: [File, File, ...]
```

### Get Photos

```http
GET /api/suppliers/:id/photos
```

Response:

```json
{
  "photos": [
    {
      "id": "photo-1",
      "url": "/uploads/photo1.jpg",
      "thumbnail": "/uploads/photo1-thumb.jpg",
      "caption": "Caption",
      "approved": true,
      "uploadedAt": "2024-01-15T10:30:00Z"
    }
  ]
}
```

### Delete Photo

```http
DELETE /api/photos/:photoId
```

### Reorder Photos

```http
POST /api/suppliers/:id/photos/reorder
Content-Type: application/json

{
  "order": ["photo-3", "photo-1", "photo-2"]
}
```

---

## Best Practices

1. **Always validate on the server**: Client-side validation is for UX only
2. **Use thumbnails**: Load thumbnails first, full images in lightbox
3. **Lazy load**: Enable lazy loading for better performance
4. **Error handling**: Always provide user feedback on errors
5. **Security**: Validate file types and sizes on server
6. **Accessibility**: Ensure images have alt text
7. **Progressive enhancement**: Components work without JavaScript (fallback to forms)

---

## Support

For issues or questions:

- Review the component source code
- Check browser console for errors
- Ensure API endpoints are working
- Verify authentication/authorization

---

**Last Updated**: December 2024
