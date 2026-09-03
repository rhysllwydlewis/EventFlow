/**
 * Photo Uploader Component
 * Drag-and-drop photo uploader with preview, progress tracking, and error handling
 *
 * Usage:
 *   const uploader = new PhotoUploader({
 *     uploadUrl: '/api/v1/photos/upload',
 *     maxFiles: 10,
 *     maxFileSize: 10 * 1024 * 1024, // 10MB
 *     onSuccess: (response) => { ... },
 *     onError: (error) => { ... }
 *   });
 */

class PhotoUploader {
  constructor(options = {}) {
    this.uploadUrl = options.uploadUrl || '/api/v1/photos/upload';
    this.maxFiles = options.maxFiles || 10;
    this.maxFileSize = options.maxFileSize || 10 * 1024 * 1024; // 10MB default
    this.acceptedTypes = options.acceptedTypes || [
      'image/jpeg',
      'image/jpg',
      'image/png',
      'image/webp',
      'image/gif',
      'image/avif',
      'image/heic',
    ];
    this.onSuccess = options.onSuccess || (() => {});
    this.onError = options.onError || (error => console.error(error));
    this.onProgress = options.onProgress || (() => {});

    this.files = [];
    this.uploading = false;

    this.init();
  }

  init() {
    this.createUI();
    this.attachEventListeners();
  }

  createUI() {
    // Create uploader container
    this.container = document.createElement('div');
    this.container.className = 'photo-uploader';
    // Build accept attribute with both MIME types and extensions
    const acceptAttr = [
      ...this.acceptedTypes,
      '.jpg',
      '.jpeg',
      '.png',
      '.webp',
      '.gif',
      '.avif',
      '.heic',
      '.heif',
    ].join(',');
    this.container.innerHTML = `
      <div class="photo-uploader__dropzone" id="photoDropzone">
        <div class="photo-uploader__icon">📸</div>
        <div class="photo-uploader__text">Drag & drop photos here</div>
        <div class="photo-uploader__hint">or click to browse (max ${this.maxFiles} files, ${this.formatFileSize(this.maxFileSize)} each)</div>
        <input type="file" class="photo-uploader__input" id="photoInput" accept="${acceptAttr}" multiple>
      </div>
      <div class="photo-uploader__previews" id="photoPreviews"></div>
      <div class="photo-uploader__controls" id="photoControls" style="display: none;">
        <button class="ef-cta photo-uploader__button photo-uploader__button--primary" id="uploadButton">
          Upload Photos
        </button>
        <button class="ef-cta photo-uploader__button photo-uploader__button--secondary" id="clearButton">
          Clear All
        </button>
      </div>
      <div class="photo-uploader__progress" id="uploadProgress" style="display: none;">
        <div class="photo-uploader__progress-bar">
          <div class="photo-uploader__progress-fill" id="progressFill"></div>
        </div>
        <div class="photo-uploader__progress-text" id="progressText">Uploading...</div>
      </div>
    `;

    // Add styles
    this.injectStyles();
  }

  injectStyles() {
    if (document.getElementById('photo-uploader-styles')) {
      return;
    }

    const style = document.createElement('style');
    style.id = 'photo-uploader-styles';
    style.textContent = `
      .photo-uploader {
        width: 100%;
        max-width: 100%;
      }
      
      .photo-uploader__dropzone {
        border: 3px dashed #667eea;
        border-radius: 12px;
        padding: 3rem 2rem;
        text-align: center;
        cursor: pointer;
        transition: all 0.3s ease;
        background: #f8f9ff;
        position: relative;
      }
      
      .photo-uploader__dropzone:hover,
      .photo-uploader__dropzone.dragover {
        background: #e8ebff;
        border-color: #764ba2;
        transform: scale(1.01);
      }
      
      .photo-uploader__dropzone.uploading {
        background: #fff3cd;
        border-color: #ffc107;
        pointer-events: none;
      }
      
      .photo-uploader__icon {
        font-size: 3rem;
        margin-bottom: 1rem;
      }
      
      .photo-uploader__text {
        font-size: 1.125rem;
        color: #667eea;
        margin-bottom: 0.5rem;
        font-weight: 600;
      }
      
      .photo-uploader__hint {
        color: #666;
        font-size: 0.875rem;
      }
      
      .photo-uploader__input {
        display: none;
      }
      
      .photo-uploader__previews {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
        gap: 1rem;
        margin-top: 1.5rem;
      }
      
      .photo-uploader__preview {
        position: relative;
        aspect-ratio: 1;
        border-radius: 8px;
        overflow: hidden;
        background: #f0f0f0;
        border: 2px solid #e0e0e0;
      }
      
      .photo-uploader__preview img {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }
      
      .photo-uploader__preview-remove {
        position: absolute;
        top: 0.5rem;
        right: 0.5rem;
        background: rgba(239, 68, 68, 0.92);
        color: white;
        border: none;
        border-radius: 50%;
        width: 14px;
        height: 14px;
        cursor: pointer;
        font-size: 0.6875rem;
        line-height: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background 0.2s;
      }
      
      .photo-uploader__preview-remove:hover {
        background: rgba(220,38,38,1);
      }
      
      .photo-uploader__preview-name {
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        background: rgba(0, 0, 0, 0.7);
        color: white;
        padding: 0.5rem;
        font-size: 0.75rem;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      
      .photo-uploader__controls {
        display: flex;
        gap: 1rem;
        margin-top: 1.5rem;
        justify-content: center;
        flex-wrap: wrap;
      }
      
      .photo-uploader__button {
        padding: 0.75rem 1.5rem;
        border: none;
        border-radius: 8px;
        font-size: 1rem;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s;
      }
      
      .photo-uploader__button--primary {
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
      }
      
      .photo-uploader__button--primary:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
      }
      
      .photo-uploader__button--secondary {
        background: #f0f0f0;
        color: #333;
      }
      
      .photo-uploader__button--secondary:hover {
        background: #e0e0e0;
      }
      
      .photo-uploader__button:disabled {
        opacity: 0.5;
        cursor: not-allowed;
      }
      
      .photo-uploader__progress {
        margin-top: 1.5rem;
      }
      
      .photo-uploader__progress-bar {
        width: 100%;
        height: 8px;
        background: #e0e0e0;
        border-radius: 4px;
        overflow: hidden;
      }
      
      .photo-uploader__progress-fill {
        height: 100%;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        transition: width 0.3s ease;
        width: 0%;
      }
      
      .photo-uploader__progress-text {
        text-align: center;
        margin-top: 0.5rem;
        color: #667eea;
        font-weight: 600;
      }
      
      .photo-uploader__error {
        background: #fee;
        border: 1px solid #fcc;
        color: #c00;
        padding: 1rem;
        border-radius: 8px;
        margin-top: 1rem;
      }
      
      @media (max-width: 768px) {
        .photo-uploader__dropzone {
          padding: 2rem 1rem;
        }
        
        .photo-uploader__icon {
          font-size: 2rem;
        }
        
        .photo-uploader__text {
          font-size: 1rem;
        }
        
        .photo-uploader__previews {
          grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
          gap: 0.5rem;
        }
      }
    `;
    document.head.appendChild(style);
  }

  attachEventListeners() {
    // Get elements after container is added to DOM
    setTimeout(() => {
      this.dropzone = this.container.querySelector('#photoDropzone');
      this.input = this.container.querySelector('#photoInput');
      this.previews = this.container.querySelector('#photoPreviews');
      this.controls = this.container.querySelector('#photoControls');
      this.uploadButton = this.container.querySelector('#uploadButton');
      this.clearButton = this.container.querySelector('#clearButton');
      this.progressContainer = this.container.querySelector('#uploadProgress');
      this.progressFill = this.container.querySelector('#progressFill');
      this.progressText = this.container.querySelector('#progressText');

      // Click to browse
      this.dropzone.addEventListener('click', e => {
        if (
          !this.uploading &&
          (e.target === this.dropzone ||
            e.target.closest('.photo-uploader__icon, .photo-uploader__text, .photo-uploader__hint'))
        ) {
          this.input.click();
        }
      });

      // File input change
      this.input.addEventListener('change', e => {
        this.handleFiles(Array.from(e.target.files));
      });

      // Drag and drop
      this.dropzone.addEventListener('dragover', e => {
        e.preventDefault();
        this.dropzone.classList.add('dragover');
      });

      this.dropzone.addEventListener('dragleave', () => {
        this.dropzone.classList.remove('dragover');
      });

      this.dropzone.addEventListener('drop', e => {
        e.preventDefault();
        this.dropzone.classList.remove('dragover');

        if (!this.uploading) {
          const files = Array.from(e.dataTransfer.files);
          this.handleFiles(files);
        }
      });

      // Upload button
      this.uploadButton.addEventListener('click', () => {
        this.upload();
      });

      // Clear button
      this.clearButton.addEventListener('click', () => {
        this.clear();
      });
    }, 0);
  }

  handleFiles(newFiles) {
    // Filter valid files
    const validFiles = newFiles.filter(file => {
      if (!this.acceptedTypes.includes(file.type)) {
        this.showError(`Invalid file type: ${file.name}`);
        return false;
      }
      if (file.size > this.maxFileSize) {
        this.showError(
          `File too large: ${file.name} (max ${this.formatFileSize(this.maxFileSize)})`
        );
        return false;
      }
      return true;
    });

    // Check total count
    const totalFiles = this.files.length + validFiles.length;
    if (totalFiles > this.maxFiles) {
      this.showError(`Maximum ${this.maxFiles} files allowed`);
      return;
    }

    // Add files
    validFiles.forEach(file => {
      this.files.push(file);
      this.addPreview(file);
    });

    // Show controls
    if (this.files.length > 0) {
      this.controls.style.display = 'flex';
    }
  }

  addPreview(file) {
    const reader = new FileReader();
    reader.addEventListener('load', e => {
      const preview = document.createElement('div');
      preview.className = 'photo-uploader__preview';
      preview.dataset.filename = file.name;
      preview.innerHTML = `
        <img src="${e.target.result}" alt="${file.name}">
        <button class="ef-cta photo-uploader__preview-remove" title="Remove">×</button>
        <div class="photo-uploader__preview-name">${file.name}</div>
      `;

      // Remove button
      const removeBtn = preview.querySelector('.photo-uploader__preview-remove');
      removeBtn.addEventListener('click', () => {
        this.removeFile(file.name);
        preview.remove();

        if (this.files.length === 0) {
          this.controls.style.display = 'none';
        }
      });

      this.previews.appendChild(preview);
    });
    reader.readAsDataURL(file);
  }

  removeFile(filename) {
    this.files = this.files.filter(f => f.name !== filename);
  }

  clear() {
    this.files = [];
    this.previews.innerHTML = '';
    this.controls.style.display = 'none';
    this.input.value = '';
    this.hideError();
  }

  upload() {
    if (this.files.length === 0 || this.uploading) {
      return;
    }

    this.uploading = true;
    this.uploadButton.disabled = true;
    this.clearButton.disabled = true;
    this.dropzone.classList.add('uploading');
    this.progressContainer.style.display = 'block';
    this.hideError();

    try {
      const formData = new FormData();
      this.files.forEach(file => {
        formData.append('photos', file);
      });

      // Upload with progress tracking
      const xhr = new XMLHttpRequest();

      xhr.upload.addEventListener('progress', e => {
        if (e.lengthComputable) {
          const percent = Math.round((e.loaded / e.total) * 100);
          this.updateProgress(percent);
        }
      });

      xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const response = JSON.parse(xhr.responseText);
          this.handleUploadSuccess(response);
        } else {
          const error = JSON.parse(xhr.responseText);
          this.handleUploadError(error.error || 'Upload failed');
        }
      });

      xhr.addEventListener('error', () => {
        this.handleUploadError('Network error occurred');
      });

      xhr.open('POST', this.uploadUrl);
      xhr.send(formData);
    } catch (error) {
      this.handleUploadError(error.message);
    }
  }

  updateProgress(percent) {
    this.progressFill.style.width = `${percent}%`;
    this.progressText.textContent = `Uploading... ${percent}%`;
    this.onProgress(percent);
  }

  handleUploadSuccess(response) {
    this.uploading = false;
    this.uploadButton.disabled = false;
    this.clearButton.disabled = false;
    this.dropzone.classList.remove('uploading');
    this.progressContainer.style.display = 'none';

    this.onSuccess(response);
    this.clear();

    // Show success message
    this.showSuccess(
      `Successfully uploaded ${response.photos?.length || this.files.length} photo(s)`
    );
  }

  handleUploadError(error) {
    this.uploading = false;
    this.uploadButton.disabled = false;
    this.clearButton.disabled = false;
    this.dropzone.classList.remove('uploading');
    this.progressContainer.style.display = 'none';

    this.showError(error);
    this.onError(error);
  }

  showError(message) {
    this.hideError();
    const error = document.createElement('div');
    error.className = 'photo-uploader__error';
    error.textContent = message;
    this.container.appendChild(error);

    setTimeout(() => {
      error.remove();
    }, 5000);
  }

  showSuccess(message) {
    const success = document.createElement('div');
    success.className = 'photo-uploader__error';
    success.style.background = '#e8f5e9';
    success.style.borderColor = '#c8e6c9';
    success.style.color = '#2e7d32';
    success.textContent = message;
    this.container.appendChild(success);

    setTimeout(() => {
      success.remove();
    }, 3000);
  }

  hideError() {
    const errors = this.container.querySelectorAll('.photo-uploader__error');
    errors.forEach(error => error.remove());
  }

  formatFileSize(bytes) {
    if (!bytes || bytes <= 0) {
      return '0 Bytes';
    }
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
    return `${Math.round((bytes / Math.pow(k, i)) * 100) / 100} ${sizes[i]}`;
  }

  // Public method to get the container element
  getElement() {
    return this.container;
  }

  // Public method to append to a target element
  appendTo(target) {
    const element = typeof target === 'string' ? document.querySelector(target) : target;
    if (element) {
      element.appendChild(this.container);
    }
    return this;
  }
}

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PhotoUploader;
}
