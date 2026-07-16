interface Navigator {
  connection?: {
    saveData?: boolean;
    effectiveType?: string;
  };
}

interface Window {
  __EF_HOME_V3_PREVIEW__?: boolean;
  __collageWidgetInitialized?: boolean;
  __efHomepageUploadBridgeInstalled?: boolean;
  pexelsClient?: unknown;
}

interface HTMLElement {
  _target?: HTMLElement;
  _placeGuide?: () => void;
}

interface HomepageVideoSettings {
  enabled?: boolean;
  source?: string;
  fallbackToPexels?: boolean;
  intervalSeconds?: number;
  uploadGallery?: string[];
  selectedMedia?: any[];
  heroSelectedMedia?: any;
  pexelsVideoQueries?: {
    venues?: string;
    photography?: string;
    entertainment?: string;
    catering?: string;
  };
  mediaTypes?: {
    videos?: boolean;
  };
  heroVideo?: {
    enabled?: boolean;
    autoplay?: boolean;
    muted?: boolean;
    loop?: boolean;
    quality?: string;
  };
  videoQuality?: {
    preference?: string;
    adaptive?: boolean;
    mobileOptimized?: boolean;
  };
  transition?: {
    effect?: string;
    duration?: number;
  };
  preloading?: {
    enabled?: boolean;
    count?: number;
  };
  mobileOptimizations?: {
    slowerTransitions?: boolean;
    disableVideos?: boolean;
    touchControls?: boolean;
  };
  contentFiltering?: {
    aspectRatio?: string;
    orientation?: string;
    minResolution?: string;
  };
  playbackControls?: {
    showControls?: boolean;
    pauseOnHover?: boolean;
    fullscreen?: boolean;
  };
}
