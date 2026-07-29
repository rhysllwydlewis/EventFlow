(function () {
  'use strict';

  const original = window.efSetupPhotoDropZone;
  if (typeof original !== 'function' || window.__eventFlowBannerUploadCompatInstalled) {
    return;
  }
  window.__eventFlowBannerUploadCompatInstalled = true;

  // Supplier profile saves use the normal JSON API, whose global body limit is
  // intentionally conservative. Compress only the banner data URL before it is
  // put into that JSON payload; the server then persists it to MongoDB and stores
  // a stable /api/photos/... URL on the supplier record.
  const TARGET_DATA_URL_CHARS = 1_350_000;
  const MAX_DIMENSION = 1800;

  function notifyError(message) {
    if (window.NotificationDispatcher?.error) {
      window.NotificationDispatcher.error(message);
    } else if (window.EventFlowNotifications?.error) {
      window.EventFlowNotifications.error(message);
    } else {
      console.error('[BannerUpload]', message);
    }
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('The banner image could not be read.'));
      image.src = dataUrl;
    });
  }

  function renderJpeg(image, width, height, quality) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) {
      throw new Error('Image processing is not available in this browser.');
    }
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', quality);
  }

  async function compressBannerDataUrl(dataUrl) {
    if (!dataUrl || dataUrl.length <= TARGET_DATA_URL_CHARS) {
      return dataUrl;
    }

    const image = await loadImage(dataUrl);
    const naturalWidth = Math.max(1, image.naturalWidth || image.width || 1);
    const naturalHeight = Math.max(1, image.naturalHeight || image.height || 1);
    const scale = Math.min(1, MAX_DIMENSION / Math.max(naturalWidth, naturalHeight));
    let width = Math.max(1, Math.round(naturalWidth * scale));
    let height = Math.max(1, Math.round(naturalHeight * scale));
    let quality = 0.86;
    let result = renderJpeg(image, width, height, quality);

    // Progressively reduce quality, then dimensions, until the JSON-safe target
    // is met. The server performs the final validated optimisation/storage step.
    for (let attempt = 0; result.length > TARGET_DATA_URL_CHARS && attempt < 8; attempt += 1) {
      if (quality > 0.62) {
        quality -= 0.08;
      } else {
        width = Math.max(640, Math.round(width * 0.84));
        height = Math.max(360, Math.round(height * 0.84));
      }
      result = renderJpeg(image, width, height, quality);
    }

    if (result.length > TARGET_DATA_URL_CHARS) {
      throw new Error('This image is too large to prepare as a banner. Please choose a smaller image.');
    }
    return result;
  }

  window.efSetupPhotoDropZone = function wrappedPhotoDropZone(
    dropId,
    previewId,
    onImage,
    onRemove
  ) {
    if (dropId !== 'sup-banner-drop') {
      return original(dropId, previewId, onImage, onRemove);
    }

    return original(
      dropId,
      previewId,
      async (dataUrl, file) => {
        try {
          const compressed = await compressBannerDataUrl(dataUrl);
          if (typeof onImage === 'function') {
            onImage(compressed, file);
          }
        } catch (error) {
          const preview = previewId ? document.getElementById(previewId) : null;
          if (preview) {
            preview.replaceChildren();
          }
          notifyError(error.message || 'The banner image could not be prepared.');
        }
      },
      onRemove
    );
  };
})();
