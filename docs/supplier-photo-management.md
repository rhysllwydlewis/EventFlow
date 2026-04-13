# Supplier Dashboard Photo Management

## Overview

Suppliers can manage their gallery photos from the dashboard. Supported actions:

- **Upload** new photos (drag & drop or click-to-select, up to 10 photos)
- **Delete** existing uploaded photos
- **Reorder** existing photos (drag-and-drop) and save the new order
- **Edit supplier details** (name, category, description, etc.) independently of photo management

## UI Components (`public/dashboard-supplier.html`)

| Element                     | Purpose                                                                             |
| --------------------------- | ----------------------------------------------------------------------------------- |
| `#sup-photo-drop`           | Drop zone / click-to-upload                                                         |
| `#sup-photo-preview`        | Preview grid (pending uploads + existing photos; shows empty-state hint when empty) |
| `#sup-gallery-reorder-bar`  | Save-order toolbar (shown when ≥2 photos exist)                                     |
| `#sup-gallery-save-order`   | "Save order" button                                                                 |
| `#sup-gallery-order-status` | Status message after save                                                           |

## Client-side Logic (`public/assets/js/supplier-gallery.js`)

### `SupplierGalleryManager`

| Method                                    | Description                                                                                                                                                                                                           |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loadExistingPhotos()`                    | Reads `#sup-id`; delegates to `loadPhotosForSupplier()`                                                                                                                                                               |
| `loadPhotosForSupplier(supplierId)`       | Fetches supplier data via `supplierManager`; renders `photosGallery` into the preview grid. Also exposed as `window.loadSupplierGalleryPhotos(id)` so `app.js` can trigger it when populating the supplier edit form. |
| `renderExistingPhotos(container)`         | Renders existing-photo tiles with delete button and drag handle; shows an empty-state hint when there are no photos                                                                                                   |
| `deleteExistingPhoto(photoId, wrapperEl)` | Calls `DELETE /api/v1/me/suppliers/:id/photos/:photoId` and removes the tile                                                                                                                                          |
| `attachExistingPhotoDragDrop(container)`  | Wires HTML5 drag-and-drop on existing-photo tiles (guarded against handler accumulation with `data-drag-handlers-attached`)                                                                                           |
| `savePhotoOrder()`                        | Collects the current DOM order and calls `PATCH /api/v1/me/suppliers/:id/photos/order`. Exposed as `window.saveSupplierGalleryOrder()`.                                                                               |
| `uploadPendingPhotos(supplierId)`         | Uploads staged files; on success moves them into the existing-photos list                                                                                                                                             |
| `updateReorderBar()`                      | Shows/hides the "Save order" bar depending on photo count                                                                                                                                                             |

### `app.js` integration

`populateSupplierForm(supplier)` calls `window.loadSupplierGalleryPhotos(supplier.id)` after populating the edit form fields. This is needed because `supplier-gallery.js` initialises before `app.js` has fetched the supplier data (the `#sup-id` field is empty at setup time).

## API Endpoints

All endpoints are available at both `/api/v1/me/suppliers/...` and `/api/me/suppliers/...` (backward-compatibility alias).

### List photos

```
GET /api/v1/me/suppliers/:id/photos
```

- **Auth**: owner or admin, rate-limited
- **Response**: `{ success, count, photos: [{id, url, thumbnail, approved, uploadedAt}] }`

### Upload a photo

```
POST /api/v1/me/suppliers/:id/photos
```

- **Auth**: verified owner, CSRF, rate-limited, `photoUploads` feature flag
- **Body**: `{ image: "<base64 data URI>" }`
- **Response**: `{ ok: true, url }`

### Delete a photo

```
DELETE /api/v1/me/suppliers/:id/photos/:photoId
```

- **Auth**: verified owner or admin, CSRF, rate-limited
- **`:photoId`**: `id` field or URL of the photo in `photosGallery`
- **Effect**: removes the entry from `supplier.photosGallery`; deletes the physical file for `/api/photos/...` URLs
- **Response**: `{ success, message, remainingPhotos }`

### Reorder photos

```
PATCH /api/v1/me/suppliers/:id/photos/order
```

- **Auth**: verified owner, CSRF, rate-limited
- **Body**: `{ photoIds: [string, ...] }` — full ordered list of photo IDs (or URLs if no `id` field)
- **Validation**:
  - `photoIds` must be an array
  - Length ≤ 10
  - Every entry must identify a photo already in the supplier's gallery
- **Effect**: updates `supplier.photosGallery` in the requested order; busts the catalog cache
- **Response**: `{ success, message, photosGallery }`

## Data Model

```json
{
  "photosGallery": [
    {
      "id": "photo_abc123",
      "url": "/api/photos/photo_abc123",
      "approved": true,
      "uploadedAt": "2026-01-15T10:30:00.000Z"
    }
  ]
}
```

Photos are ordered as they appear in `photosGallery`. The **first entry is the cover image** shown on listing cards.

## Notes

- A supplier can have at most **10** gallery photos.
- Reordering the gallery also invalidates the public catalog cache so the new order is reflected immediately.
- `photosGallery` items uploaded before the `id` field was introduced may have `id: undefined`; these are matched by URL in the delete endpoint and keyed by URL in the reorder endpoint.
- Gallery tile transitions respect `prefers-reduced-motion` — all CSS transitions are disabled for users who prefer reduced motion.
