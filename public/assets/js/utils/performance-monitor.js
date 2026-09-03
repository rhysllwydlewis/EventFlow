/**
 * Performance Monitoring Utility
 * Tracks Core Web Vitals and custom metrics
 */

'use strict';
(function () {
  const isDevelopment =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  class PerformanceMonitor {
    constructor(options = {}) {
      this.options = {
        reportEndpoint: '/api/performance',
        sampleRate: 1.0, // 100% sampling by default
        enableConsoleLogging: true,
        enableRemoteLogging: false,
        ...options,
      };

      this.metrics = {
        navigation: {},
        vitals: {},
        custom: {},
      };

      this.init();
    }

    init() {
      if (!this.shouldSample()) {
        return;
      }

      // Wait for page load
      if (document.readyState === 'complete') {
        this.measurePerformance();
      } else {
        window.addEventListener('load', () => {
          this.measurePerformance();
        });
      }

      // Measure Core Web Vitals
      this.measureCoreWebVitals();

      // Report before page unload
      window.addEventListener('beforeunload', () => {
        this.report();
      });
    }

    shouldSample() {
      return Math.random() < this.options.sampleRate;
    }

    measurePerformance() {
      if (!window.performance || !window.performance.timing) {
        return;
      }

      const timing = window.performance.timing;
      const navigation = window.performance.navigation;

      // Navigation timing metrics
      this.metrics.navigation = {
        // DNS lookup time
        dnsTime: timing.domainLookupEnd - timing.domainLookupStart,

        // TCP connection time
        tcpTime: timing.connectEnd - timing.connectStart,

        // Request time (TTFB - Time to First Byte)
        requestTime: timing.responseStart - timing.requestStart,

        // Response time
        responseTime: timing.responseEnd - timing.responseStart,

        // DOM processing time
        domProcessingTime: timing.domComplete - timing.domLoading,

        // DOM Content Loaded
        domContentLoadedTime: timing.domContentLoadedEventEnd - timing.navigationStart,

        // Page load time
        loadTime: timing.loadEventEnd - timing.navigationStart,

        // Navigation type
        navigationType: this.getNavigationType(navigation.type),

        // Redirect count
        redirectCount: navigation.redirectCount,
      };

      // Paint timing
      if (window.performance.getEntriesByType) {
        const paintEntries = window.performance.getEntriesByType('paint');
        paintEntries.forEach(entry => {
          if (entry.name === 'first-paint') {
            this.metrics.navigation.firstPaint = Math.round(entry.startTime);
          } else if (entry.name === 'first-contentful-paint') {
            this.metrics.navigation.firstContentfulPaint = Math.round(entry.startTime);
          }
        });
      }

      // Log metrics
      if (this.options.enableConsoleLogging) {
        this.logMetrics();
      }
    }

    measureCoreWebVitals() {
      // Largest Contentful Paint (LCP)
      this.observeLCP();

      // First Input Delay (FID)
      this.observeFID();

      // Cumulative Layout Shift (CLS)
      this.observeCLS();

      // Time to First Byte (TTFB)
      this.measureTTFB();
    }

    observeLCP() {
      if (!window.PerformanceObserver) {
        return;
      }

      try {
        const observer = new PerformanceObserver(list => {
          const entries = list.getEntries();
          const lastEntry = entries[entries.length - 1];
          this.metrics.vitals.lcp = Math.round(lastEntry.startTime);
        });

        observer.observe({ entryTypes: ['largest-contentful-paint'] });
      } catch (e) {
        // LCP not supported
      }
    }

    observeFID() {
      if (!window.PerformanceObserver) {
        return;
      }

      try {
        const observer = new PerformanceObserver(list => {
          const entries = list.getEntries();
          entries.forEach(entry => {
            this.metrics.vitals.fid = Math.round(entry.processingStart - entry.startTime);
          });
        });

        observer.observe({ entryTypes: ['first-input'] });
      } catch (e) {
        // FID not supported
      }
    }

    observeCLS() {
      if (!window.PerformanceObserver) {
        return;
      }

      let clsValue = 0;
      const clsEntries = [];

      try {
        const observer = new PerformanceObserver(list => {
          const entries = list.getEntries();
          entries.forEach(entry => {
            // Only count layout shifts without recent user input
            if (!entry.hadRecentInput) {
              clsValue += entry.value;
              clsEntries.push(entry);
            }
          });

          this.metrics.vitals.cls = Math.round(clsValue * 1000) / 1000;
        });

        observer.observe({ entryTypes: ['layout-shift'] });
      } catch (e) {
        // CLS not supported
      }
    }

    measureTTFB() {
      if (!window.performance || !window.performance.timing) {
        return;
      }

      const timing = window.performance.timing;
      this.metrics.vitals.ttfb = timing.responseStart - timing.navigationStart;
    }

    getNavigationType(type) {
      const types = {
        0: 'navigate',
        1: 'reload',
        2: 'back_forward',
        255: 'reserved',
      };
      return types[type] || 'unknown';
    }

    // Mark custom timing
    mark(name) {
      if (window.performance && window.performance.mark) {
        window.performance.mark(name);
      }
    }

    // Measure custom timing between marks
    measure(name, startMark, endMark) {
      if (window.performance && window.performance.measure) {
        try {
          window.performance.measure(name, startMark, endMark);
          const measure = window.performance.getEntriesByName(name)[0];
          this.metrics.custom[name] = Math.round(measure.duration);
          return measure.duration;
        } catch (e) {
          console.warn('Performance measure failed:', e);
        }
      }
      return null;
    }

    // Track custom metric
    trackMetric(name, value, unit = 'ms') {
      this.metrics.custom[name] = { value, unit };
    }

    logMetrics() {
      console.group('📊 Performance Metrics');

      console.group('Navigation Timing');
      Object.entries(this.metrics.navigation).forEach(([key, value]) => {
        if (isDevelopment) {
          console.log(`${key}: ${value}${typeof value === 'number' ? 'ms' : ''}`);
        }
      });
      console.groupEnd();

      if (Object.keys(this.metrics.vitals).length > 0) {
        console.group('Core Web Vitals');
        const { lcp, fid, cls, ttfb } = this.metrics.vitals;

        if (lcp !== undefined) {
          if (isDevelopment) {
            console.log(
              `LCP (Largest Contentful Paint): ${lcp}ms ${this.getVitalRating('lcp', lcp)}`
            );
          }
        }
        if (fid !== undefined) {
          if (isDevelopment) {
            console.log(`FID (First Input Delay): ${fid}ms ${this.getVitalRating('fid', fid)}`);
          }
        }
        if (cls !== undefined) {
          if (isDevelopment) {
            console.log(`CLS (Cumulative Layout Shift): ${cls} ${this.getVitalRating('cls', cls)}`);
          }
        }
        if (ttfb !== undefined) {
          if (isDevelopment) {
            console.log(
              `TTFB (Time to First Byte): ${ttfb}ms ${this.getVitalRating('ttfb', ttfb)}`
            );
          }
        }
        console.groupEnd();
      }

      if (Object.keys(this.metrics.custom).length > 0) {
        console.group('Custom Metrics');
        Object.entries(this.metrics.custom).forEach(([key, value]) => {
          if (isDevelopment) {
            console.log(`${key}:`, value);
          }
        });
        console.groupEnd();
      }

      console.groupEnd();
    }

    getVitalRating(metric, value) {
      const thresholds = {
        lcp: { good: 2500, poor: 4000 },
        fid: { good: 100, poor: 300 },
        cls: { good: 0.1, poor: 0.25 },
        ttfb: { good: 800, poor: 1800 },
      };

      const t = thresholds[metric];
      if (!t) {
        return '';
      }

      if (value <= t.good) {
        return '✅ Good';
      }
      if (value <= t.poor) {
        return '⚠️ Needs Improvement';
      }
      return '❌ Poor';
    }

    getMetrics() {
      return this.metrics;
    }

    report() {
      if (!this.options.enableRemoteLogging) {
        return;
      }

      try {
        const payload = {
          metrics: this.metrics,
          page: window.location.pathname,
          userAgent: navigator.userAgent,
          timestamp: new Date().toISOString(),
        };

        // Use sendBeacon for reliable delivery on page unload
        if (navigator.sendBeacon) {
          const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
          navigator.sendBeacon(this.options.reportEndpoint, blob);
        } else {
          // Fallback to fetch
          fetch(this.options.reportEndpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
            keepalive: true,
          }).catch(() => {
            // Ignore errors on page unload
          });
        }
      } catch (e) {
        console.warn('Failed to report performance metrics:', e);
      }
    }
  }

  // Auto-initialize if enabled
  if (typeof window !== 'undefined') {
    window.performanceMonitor = new PerformanceMonitor({
      enableRemoteLogging: false, // Disabled by default
      enableConsoleLogging: window.location.hostname === 'localhost', // Only in dev
    });
  }

  window.PerformanceMonitor = PerformanceMonitor;

  // Export for module usage
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = PerformanceMonitor;
  }
})();
