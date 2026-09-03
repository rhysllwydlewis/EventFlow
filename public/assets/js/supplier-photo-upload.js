/**
 * Supplier Photo Upload Module for EventFlow
 * Handles uploading supplier gallery photos via REST API.
 *
 * Images are transferred as base64 payloads and persisted by the backend's
 * MongoDB-backed photo pipeline. Supplier records store the returned URLs.
 */

const isDevelopment =
  window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
class SupplierPhotoUpload {
  constructor() {
    this.uploadedPhotos = [];
    // No photo count here: the allowance is per plan, resolved by the gallery
    // from /api/v2/subscriptions/me and enforced by the upload route. A second
    // hard-coded ceiling in this module is how every tier ended up capped at
    // the free tier's ten.
    this.maxFileSize = 5 * 1024 * 1024; // 5MB
    this.compressionQuality = 0.85; // 85% quality
    this.maxImageWidth = 1920;
    this.maxImageHeight = 1920;
    this.apiBase = '/api';
  }

  async ensureCsrfToken() {
    if (!window.__CSRF_TOKEN__) {
      try {
        const resp = await fetch('/api/v1/csrf-token', { credentials: 'include' });
        if (resp.ok) {
          const data = await resp.json();
          window.__CSRF_TOKEN__ = data.csrfToken;
        }
      } catch (e) {
        console.error('Failed to fetch CSRF token:', e);
      }
    }
    return window.__CSRF_TOKEN__ || '';
  }

  /**
   * Upload a photo to persistent storage via REST API.
   * @param {File} file - The image file to upload
   * @param {string} supplierId - The supplier ID
   * @returns {Promise<Object>} Photo metadata with download URL
   */
  async uploadPhoto(file, supplierId) {
    try {
      // Validate file
      if (!file || !file.type || !file.type.startsWith('image/')) {
        throw new Error('Invalid file type. Please upload an image.');
      }

      // Check file size (max 5MB)
      if (file.size > this.maxFileSize) {
        throw new Error(`File too large. Maximum size is ${this.maxFileSize / (1024 * 1024)}MB.`);
      }

      // Compress image and convert to base64
      const compressedBlob = await this.compressImage(file);
      const base64Image = await this.blobToBase64(compressedBlob);

      // Upload via API with base64 image
      const csrfToken = await this.ensureCsrfToken();
      const response = await fetch(
        `${this.apiBase}/me/suppliers/${encodeURIComponent(supplierId)}/photos`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken,
          },
          body: JSON.stringify({
            image: base64Image,
          }),
        }
      );

      if (!response.ok) {
        throw new Error('Failed to upload photo');
      }

      const data = await response.json();
      const serverPhoto =
        data && data.photo && typeof data.photo === 'object' && !Array.isArray(data.photo)
          ? data.photo
          : {};
      const photoUrl = serverPhoto.url || data.url;
      if (!photoUrl) {
        throw new Error('Photo upload did not return a usable URL');
      }
      const photoMetadata = {
        ...serverPhoto,
        // Prefer a server-generated id. Existing gallery routes also accept the
        // stored URL, so it is the stable compatibility fallback for legacy
        // responses that do not yet return a dedicated photo id.
        id: serverPhoto.id || data.photoId || data.id || photoUrl,
        url: photoUrl,
        filename: serverPhoto.filename || file.name,
        uploadedAt: serverPhoto.uploadedAt || new Date().toISOString(),
      };

      this.uploadedPhotos.push(photoMetadata);
      if (isDevelopment) {
        console.log('Photo uploaded successfully:', photoMetadata);
      }
      return photoMetadata;
    } catch (error) {
      console.error('Error uploading photo:', error);
      throw error;
    }
  }

  /**
   * Delete a photo from persistent storage via REST API.
   * @param {string} photoId - Photo ID or legacy stored URL
   * @param {string} supplierId - Supplier ID
   * @returns {Promise<void>}
   */
  async deletePhoto(photoId, supplierId) {
    try {
      const csrfToken = await this.ensureCsrfToken();
      const response = await fetch(
        `${this.apiBase}/me/suppliers/${encodeURIComponent(supplierId)}/photos/${encodeURIComponent(photoId)}`,
        {
          method: 'DELETE',
          credentials: 'include',
          headers: {
            'X-CSRF-Token': csrfToken,
          },
        }
      );

      if (!response.ok) {
        throw new Error('Failed to delete photo');
      }

      this.uploadedPhotos = this.uploadedPhotos.filter(p => p.id !== photoId);
      if (isDevelopment) {
        console.log('Photo deleted successfully:', photoId);
      }
    } catch (error) {
      console.error('Error deleting photo:', error);
      throw error;
    }
  }

  /**
   * Get all photos for a supplier via REST API.
   * @param {string} supplierId - Supplier ID
   * @returns {Promise<Array>} Array of photo metadata
   */
  async getSupplierPhotos(supplierId) {
    try {
      const response = await fetch(
        `${this.apiBase}/me/suppliers/${encodeURIComponent(supplierId)}/photos`,
        {
          credentials: 'include',
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch photos');
      }

      const data = await response.json();
      const photos = Array.isArray(data) ? data : Array.isArray(data.photos) ? data.photos : [];
      this.uploadedPhotos = photos;
      return photos;
    } catch (error) {
      console.error('Error fetching photos:', error);
      throw error;
    }
  }

  /**
   * Compress an image file before upload
   * @param {File} file - The image file
   * @returns {Promise<Blob>} Compressed image blob
   */
  compressImage(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = e => {
        const img = new Image();

        img.onload = () => {
          const canvas = document.createElement('canvas');
          let width = img.width;
          let height = img.height;

          // Calculate new dimensions while maintaining aspect ratio
          if (width > this.maxImageWidth || height > this.maxImageHeight) {
            if (width > height) {
              height = (height / width) * this.maxImageWidth;
              width = this.maxImageWidth;
            } else {
              width = (width / height) * this.maxImageHeight;
              height = this.maxImageHeight;
            }
          }

          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          canvas.toBlob(
            blob => {
              if (!blob) {
                reject(new Error('Failed to compress image'));
                return;
              }
              resolve(blob);
            },
            'image/jpeg',
            this.compressionQuality
          );
        };

        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = e.target.result;
      };

      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  /**
   * Convert Blob to base64 string
   * @param {Blob} blob - Blob to convert
   * @returns {Promise<string>} Base64 string
   */
  blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Validate image dimensions
   * @param {File} file - Image file
   * @returns {Promise<{width: number, height: number}>}
   */
  getImageDimensions(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = e => {
        const img = new Image();
        img.onload = () => {
          resolve({ width: img.width, height: img.height });
        };
        img.onerror = () => reject(new Error('Failed to load image'));
        img.src = e.target.result;
      };

      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }

  /**
   * Batch upload multiple photos
   * @param {File[]} files - Array of image files
   * @param {string} supplierId - The supplier ID
   * @param {Function} progressCallback - Progress callback (optional)
   * @returns {Promise<Array>} Array of uploaded photo metadata
   */
  async batchUpload(files, supplierId, progressCallback) {
    const results = [];
    const errors = [];

    for (let i = 0; i < files.length; i++) {
      try {
        const photo = await this.uploadPhoto(files[i], supplierId);
        results.push(photo);

        if (progressCallback) {
          progressCallback({
            current: i + 1,
            total: files.length,
            success: results.length,
            errors: errors.length,
          });
        }
      } catch (error) {
        errors.push({ file: files[i].name, error: error.message });
        console.error(`Failed to upload ${files[i].name}:`, error);
      }
    }

    return { results, errors };
  }

  /**
   * Upload multiple photos with per-photo callback
   * This method provides compatibility with supplier-gallery.js callback signature
   * @param {File[]} files - Array of image files
   * @param {string} supplierId - The supplier ID
   * @param {Function} progressCallback - Callback with signature (current, total, photoData, error)
   * @returns {Promise<Array>} Array of upload results
   */
  async uploadMultiplePhotos(files, supplierId, progressCallback) {
    const results = [];

    for (let i = 0; i < files.length; i++) {
      try {
        const photoData = await this.uploadPhoto(files[i], supplierId);
        results.push({ success: true, photo: photoData });

        if (progressCallback) {
          progressCallback(i + 1, files.length, photoData, null);
        }
      } catch (error) {
        results.push({ success: false, error: error.message, file: files[i].name });
        console.error(`Failed to upload ${files[i].name}:`, error);

        if (progressCallback) {
          progressCallback(i + 1, files.length, null, error);
        }
      }
    }

    return results;
  }

  /**
   * Clear uploaded photos cache
   */
  clearCache() {
    this.uploadedPhotos = [];
  }
}

// Create singleton instance
const supplierPhotoUpload = new SupplierPhotoUpload();

export default supplierPhotoUpload;
