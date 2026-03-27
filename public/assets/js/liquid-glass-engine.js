/**
 * EventFlow Liquid Glass Engine v19.0.0
 * Mobile-only (≤768px) — Supplier Dashboard
 *
 * Adapted from:
 *  • shuding/liquid-glass  (Shader class, smoothStep, roundedRectSDF, texture)
 *  • rdev/liquid-glass-react (ShaderDisplacementGenerator, chromatic aberration SVG pipeline)
 *  • lucasromerodb/liquid-glass-effect-macos (4-layer architecture, turbulence + specular SVG filter)
 *
 * Exposed as window.LiquidGlass  — IIFE, no dependencies, ES6+
 */
(function () {
  'use strict';

  /* =========================================================
     0. FEATURE GATES
     ========================================================= */
  const isMobile = () => window.matchMedia('(max-width: 768px)').matches;
  const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const prefersHighContrast = () => window.matchMedia('(prefers-contrast: high)').matches;

  /* =========================================================
     1. MATH UTILITIES
        Ported from shuding/liquid-glass & rdev/liquid-glass-react
     ========================================================= */

  /** Hermite interpolation (smooth transition between a and b). */
  function smoothStep(a, b, t) {
    t = Math.max(0, Math.min(1, (t - a) / (b - a)));
    return t * t * (3 - 2 * t);
  }

  /** Euclidean length of a 2-D vector. */
  function vecLength(x, y) {
    return Math.sqrt(x * x + y * y);
  }

  /**
   * Signed Distance Field for a rounded rectangle.
   * Returns negative values inside, positive outside.
   */
  function roundedRectSDF(x, y, width, height, radius) {
    const qx = Math.abs(x) - width + radius;
    const qy = Math.abs(y) - height + radius;
    return Math.min(Math.max(qx, qy), 0) + vecLength(Math.max(qx, 0), Math.max(qy, 0)) - radius;
  }

  /** UV coordinate wrapper — returns a {x, y} position object. */
  function texture(x, y) {
    return { x, y };
  }

  /* =========================================================
     2. SHADER DISPLACEMENT GENERATOR
        Ported from rdev/liquid-glass-react — ShaderDisplacementGenerator
     ========================================================= */

  /**
   * Generates a canvas-based displacement map for SVG feDisplacementMap.
   * Encodes X displacement in Red channel, Y in Green (and Blue for SVG compat).
   * Includes rdev's edge-smoothing (edgeFactor) and improved normalisation.
   */
  class ShaderDisplacementGenerator {
    constructor(options) {
      this.options = Object.assign({ width: 120, height: 60 }, options);
      this.canvas = document.createElement('canvas');
      this.canvas.width = this.options.width;
      this.canvas.height = this.options.height;
      this.canvas.style.display = 'none';
      this.ctx = this.canvas.getContext('2d');
    }

    /** Compute displacement map and return it as a data-URL string. */
    generate(mousePosition) {
      const { width: w, height: h, fragment } = this.options;
      let maxScale = 0;
      const rawValues = [];

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const uv = { x: x / w, y: y / h };
          const pos = fragment(uv, mousePosition);
          const dx = pos.x * w - x;
          const dy = pos.y * h - y;
          maxScale = Math.max(maxScale, Math.abs(dx), Math.abs(dy));
          rawValues.push(dx, dy);
        }
      }

      /* rdev improvement: prevent over-normalisation */
      maxScale = Math.max(maxScale, 1);

      const imageData = this.ctx.createImageData(w, h);
      const data = imageData.data;
      let ri = 0;

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const dx = rawValues[ri++];
          const dy = rawValues[ri++];

          /* rdev improvement: smooth edge artefacts (2-pixel fade) */
          const edgeDist = Math.min(x, y, w - x - 1, h - y - 1);
          const edgeFactor = Math.min(1, edgeDist / 2);
          const sdx = dx * edgeFactor;
          const sdy = dy * edgeFactor;

          const r = sdx / maxScale + 0.5;
          const g = sdy / maxScale + 0.5;
          const pi = (y * w + x) * 4;
          data[pi] = Math.max(0, Math.min(255, r * 255)); // R → X
          data[pi + 1] = Math.max(0, Math.min(255, g * 255)); // G → Y
          data[pi + 2] = Math.max(0, Math.min(255, g * 255)); // B = G (SVG compat)
          data[pi + 3] = 255;
        }
      }

      this.ctx.putImageData(imageData, 0, 0);
      return this.canvas.toDataURL();
    }

    destroy() {
      if (this.canvas.parentNode) {
        this.canvas.parentNode.removeChild(this.canvas);
      }
    }
  }

  /* =========================================================
     3. FRAGMENT SHADERS
        from rdev/liquid-glass-react — fragmentShaders.liquidGlass
        from shuding/liquid-glass — createLiquidGlass fragment
     ========================================================= */

  const fragmentShaders = {
    /** Standard rounded-rect liquid glass (rdev default). */
    standard: function (uv) {
      const ix = uv.x - 0.5;
      const iy = uv.y - 0.5;
      const d = roundedRectSDF(ix, iy, 0.3, 0.2, 0.6);
      const displacement = smoothStep(0.8, 0, d - 0.15);
      const scaled = smoothStep(0, 1, displacement);
      return texture(ix * scaled + 0.5, iy * scaled + 0.5);
    },

    /** Polar/radial variant — stronger centre-to-edge warp. */
    polar: function (uv) {
      const ix = uv.x - 0.5;
      const iy = uv.y - 0.5;
      const dist = vecLength(ix, iy);
      const d = roundedRectSDF(ix, iy, 0.25, 0.15, 0.5);
      const displacement = smoothStep(0.9, 0, d - 0.1) * smoothStep(0.5, 0, dist);
      const scaled = smoothStep(0, 1, displacement);
      return texture(ix * scaled + 0.5, iy * scaled + 0.5);
    },

    /** Prominent — more aggressive displacement (shuding demo variant). */
    prominent: function (uv) {
      const ix = uv.x - 0.5;
      const iy = uv.y - 0.5;
      const d = roundedRectSDF(ix, iy, 0.35, 0.25, 0.7);
      const displacement = smoothStep(1.0, 0, d - 0.12);
      const scaled = smoothStep(0, 1.2, displacement);
      return texture(ix * scaled * 1.1 + 0.5, iy * scaled * 1.1 + 0.5);
    },
  };

  /* =========================================================
     4. SVG FILTER BUILDERS
     ========================================================= */

  const NS = 'http://www.w3.org/2000/svg';

  function svgEl(tag, attrs) {
    const el = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      el.setAttribute(k, v);
    }
    return el;
  }

  /**
   * Build the "glass distortion" SVG filter.
   * Adapted from lucasromerodb/liquid-glass-effect-macos — uses
   * feTurbulence + feGaussianBlur + feSpecularLighting + feDisplacementMap.
   *
   * @param {string} id  filter id attribute
   */
  function buildDistortionFilter(id) {
    const filter = svgEl('filter', {
      id,
      x: '-30%',
      y: '-30%',
      width: '160%',
      height: '160%',
      colorInterpolationFilters: 'sRGB',
    });

    /* Fractal noise texture */
    filter.appendChild(
      svgEl('feTurbulence', {
        type: 'fractalNoise',
        baseFrequency: '0.65',
        numOctaves: '3',
        seed: '2',
        result: 'NOISE',
      })
    );

    /* Blur the source to soften specular response */
    filter.appendChild(
      svgEl('feGaussianBlur', {
        in: 'SourceGraphic',
        stdDeviation: '2.5',
        result: 'BLUR',
      })
    );

    /* Specular lighting pass — stronger exponent for tighter glass-like highlight */
    const specLit = svgEl('feSpecularLighting', {
      in: 'BLUR',
      surfaceScale: '5',
      specularConstant: '1.4',
      specularExponent: '20',
      'lighting-color': 'white',
      result: 'SPECULAR',
    });
    specLit.appendChild(
      /* x/y/z must be unitless numbers for fePointLight (not percentages).
         x=300 ≈ centre of a 375–600px mobile viewport. A fixed value is
         intentional: the filter is applied at the element level and the
         light position need only be roughly centred rather than exact.
         Updating it on every resize would cause expensive filter regens. */
      svgEl('fePointLight', { x: '300', y: '-80', z: '120' })
    );
    filter.appendChild(specLit);

    /* Composite specular onto original to keep colours */
    filter.appendChild(
      svgEl('feComposite', {
        in: 'SPECULAR',
        in2: 'SourceGraphic',
        operator: 'in',
        result: 'LIT',
      })
    );

    /* Displace the lit result with the turbulence */
    filter.appendChild(
      svgEl('feDisplacementMap', {
        in: 'LIT',
        in2: 'NOISE',
        scale: '18',
        xChannelSelector: 'R',
        yChannelSelector: 'G',
        result: 'DISPLACED',
      })
    );

    /* archisvaze: saturation boost on displaced content — vibrancy in refracted areas */
    filter.appendChild(
      svgEl('feColorMatrix', {
        in: 'DISPLACED',
        type: 'saturate',
        values: '1.4',
        result: 'DISPLACED_SAT',
      })
    );

    /* Final composite to clip to source shape */
    filter.appendChild(
      svgEl('feComposite', {
        in: 'DISPLACED_SAT',
        in2: 'SourceGraphic',
        operator: 'in',
      })
    );

    return filter;
  }

  /**
   * Build the chromatic-aberration SVG filter.
   * Adapted from rdev/liquid-glass-react — GlassFilter component.
   * Splits R / G / B into separate feDisplacementMap passes at slightly
   * different scales, blends with screen mode, then applies edge-only masking.
   *
   * @param {string}  id               filter id attribute
   * @param {string}  displacementMapUrl  data-URL of the displacement image
   * @param {number}  scale            base displacement scale
   * @param {number}  aberrationIntensity  0–5, how strong chromatic aberration is
   */
  function buildAberrationFilter(id, displacementMapUrl, scale, aberrationIntensity) {
    const ai = aberrationIntensity || 2;
    const filter = svgEl('filter', {
      id,
      x: '-35%',
      y: '-35%',
      width: '170%',
      height: '170%',
      colorInterpolationFilters: 'sRGB',
    });

    /* Displacement map image */
    filter.appendChild(
      svgEl('feImage', {
        x: '0',
        y: '0',
        width: '100%',
        height: '100%',
        result: 'DISPLACEMENT_MAP',
        href: displacementMapUrl,
        preserveAspectRatio: 'xMidYMid slice',
      })
    );

    /* Edge intensity from displacement map greyscale */
    const edgeIntensity = svgEl('feColorMatrix', {
      in: 'DISPLACEMENT_MAP',
      type: 'matrix',
      values: '0.3 0.3 0.3 0 0  0.3 0.3 0.3 0 0  0.3 0.3 0.3 0 0  0 0 0 1 0',
      result: 'EDGE_INTENSITY',
    });
    filter.appendChild(edgeIntensity);

    /* Threshold edge mask */
    const edgeMaskEl = svgEl('feComponentTransfer', {
      in: 'EDGE_INTENSITY',
      result: 'EDGE_MASK',
    });
    const feFuncA = svgEl('feFuncA', {
      type: 'discrete',
      tableValues: `0 ${(ai * 0.05).toFixed(3)} 1`,
    });
    edgeMaskEl.appendChild(feFuncA);
    filter.appendChild(edgeMaskEl);

    /* Undisplaced centre */
    filter.appendChild(
      svgEl('feOffset', {
        in: 'SourceGraphic',
        dx: '0',
        dy: '0',
        result: 'CENTER_ORIGINAL',
      })
    );

    /* ── Red channel displacement ── */
    filter.appendChild(
      svgEl('feDisplacementMap', {
        in: 'SourceGraphic',
        in2: 'DISPLACEMENT_MAP',
        scale: (-scale).toString(),
        xChannelSelector: 'R',
        yChannelSelector: 'B',
        result: 'RED_DISPLACED',
      })
    );
    filter.appendChild(
      svgEl('feColorMatrix', {
        in: 'RED_DISPLACED',
        type: 'matrix',
        values: '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0',
        result: 'RED_CHANNEL',
      })
    );

    /* ── Green channel displacement (slightly smaller scale) ── */
    filter.appendChild(
      svgEl('feDisplacementMap', {
        in: 'SourceGraphic',
        in2: 'DISPLACEMENT_MAP',
        scale: (-(scale - ai * 0.05)).toFixed(3),
        xChannelSelector: 'R',
        yChannelSelector: 'B',
        result: 'GREEN_DISPLACED',
      })
    );
    filter.appendChild(
      svgEl('feColorMatrix', {
        in: 'GREEN_DISPLACED',
        type: 'matrix',
        values: '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0',
        result: 'GREEN_CHANNEL',
      })
    );

    /* ── Blue channel displacement (smallest scale) ── */
    filter.appendChild(
      svgEl('feDisplacementMap', {
        in: 'SourceGraphic',
        in2: 'DISPLACEMENT_MAP',
        scale: (-(scale - ai * 0.1)).toFixed(3),
        xChannelSelector: 'R',
        yChannelSelector: 'B',
        result: 'BLUE_DISPLACED',
      })
    );
    filter.appendChild(
      svgEl('feColorMatrix', {
        in: 'BLUE_DISPLACED',
        type: 'matrix',
        values: '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0',
        result: 'BLUE_CHANNEL',
      })
    );

    /* ── Screen-blend channels back together ── */
    filter.appendChild(
      svgEl('feBlend', {
        in: 'GREEN_CHANNEL',
        in2: 'BLUE_CHANNEL',
        mode: 'screen',
        result: 'GB_COMBINED',
      })
    );
    filter.appendChild(
      svgEl('feBlend', {
        in: 'RED_CHANNEL',
        in2: 'GB_COMBINED',
        mode: 'screen',
        result: 'RGB_COMBINED',
      })
    );

    /* ── Blur to soften aberration ── */
    filter.appendChild(
      svgEl('feGaussianBlur', {
        in: 'RGB_COMBINED',
        stdDeviation: Math.max(0.1, 0.5 - ai * 0.1).toFixed(2),
        result: 'ABERRATED_BLURRED',
      })
    );

    /* ── Apply edge mask → only edges get aberration ── */
    filter.appendChild(
      svgEl('feComposite', {
        in: 'ABERRATED_BLURRED',
        in2: 'EDGE_MASK',
        operator: 'in',
        result: 'EDGE_ABERRATION',
      })
    );

    /* ── Invert mask for centre ── */
    const invertedMaskEl = svgEl('feComponentTransfer', {
      in: 'EDGE_MASK',
      result: 'INVERTED_MASK',
    });
    invertedMaskEl.appendChild(svgEl('feFuncA', { type: 'table', tableValues: '1 0' }));
    filter.appendChild(invertedMaskEl);

    /* ── Keep centre clean ── */
    filter.appendChild(
      svgEl('feComposite', {
        in: 'CENTER_ORIGINAL',
        in2: 'INVERTED_MASK',
        operator: 'in',
        result: 'CENTER_CLEAN',
      })
    );

    /* ── Merge edge aberration over clean centre ── */
    filter.appendChild(
      svgEl('feComposite', {
        in: 'EDGE_ABERRATION',
        in2: 'CENTER_CLEAN',
        operator: 'over',
      })
    );

    return filter;
  }

  /* =========================================================
     5. SVG CONTAINER — single hidden <svg> holding all filters
     ========================================================= */

  let _svg = null;
  let _defs = null;
  let _generatedFilters = {};

  function ensureSVGContainer() {
    if (_svg) {
      return;
    }
    _svg = svgEl('svg', {
      xmlns: NS,
      width: '0',
      height: '0',
      'aria-hidden': 'true',
    });
    _svg.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;pointer-events:none;';
    _defs = svgEl('defs');
    _svg.appendChild(_defs);
    document.body.insertBefore(_svg, document.body.firstChild);
  }

  function getOrCreateFilter(filterId, builder) {
    if (_generatedFilters[filterId]) {
      return filterId;
    }
    /* Also skip if a filter with this ID already exists in the DOM
       (e.g. the static #lg-distortion injected in the HTML). */
    if (document.getElementById(filterId)) {
      _generatedFilters[filterId] = true; /* mark as known */
      return filterId;
    }
    ensureSVGContainer();
    const filter = builder();
    _defs.appendChild(filter);
    _generatedFilters[filterId] = true;
    return filterId;
  }

  /* =========================================================
     6. 4-LAYER WRAPPER
        Architecture from lucasromerodb/liquid-glass-effect-macos
        wrapper → effect → tint → shine → content
     ========================================================= */

  /**
   * Wraps the *children* of `el` in the 4-layer liquid-glass structure.
   * Returns the wrapper div so callers can store / remove it.
   *
   * @param {HTMLElement} el
   * @param {object} opts
   */
  function wrapInGlassLayers(el, opts) {
    const o = Object.assign(
      {
        filterIds: ['lg-distortion'],
        blurAmount: 6,
        saturation: 160,
        tintColor: 'rgba(255,255,255,0.18)',
        borderRadius: '',
        className: '',
      },
      opts
    );

    /* Move all existing children into a content div */
    const contentDiv = document.createElement('div');
    contentDiv.className = 'lg-content';
    while (el.firstChild) {
      contentDiv.appendChild(el.firstChild);
    }

    /* Effect layer — backdrop-filter + SVG filter */
    const effectDiv = document.createElement('div');
    effectDiv.className = 'lg-effect';
    const filterStr = o.filterIds.map(id => `url(#${id})`).join(' ');
    effectDiv.style.cssText = `
      position:absolute;inset:0;z-index:0;overflow:hidden;isolation:isolate;
      backdrop-filter:${filterStr} blur(${o.blurAmount}px) saturate(${o.saturation}%);
      -webkit-backdrop-filter:${filterStr} blur(${o.blurAmount}px) saturate(${o.saturation}%);
      ${o.borderRadius ? `border-radius:${o.borderRadius};` : ''}
      will-change:transform;
    `;

    /* Tint layer */
    const tintDiv = document.createElement('div');
    tintDiv.className = 'lg-tint';
    tintDiv.style.cssText = `
      position:absolute;inset:0;z-index:1;
      background:${o.tintColor};
      ${o.borderRadius ? `border-radius:${o.borderRadius};` : ''}
      pointer-events:none;
    `;

    /* Shine layer */
    const shineDiv = document.createElement('div');
    shineDiv.className = 'lg-shine';
    shineDiv.style.cssText = `
      position:absolute;inset:0;z-index:2;overflow:hidden;
      box-shadow:inset 2px 2px 1px 0 rgba(255,255,255,0.5),
                 inset -1px -1px 1px 1px rgba(255,255,255,0.3);
      ${o.borderRadius ? `border-radius:${o.borderRadius};` : ''}
      pointer-events:none;
    `;

    /* Content layer */
    contentDiv.style.position = 'relative';
    contentDiv.style.zIndex = '3';

    /* Wrapper — position:relative container */
    const wrapper = document.createElement('div');
    wrapper.className = `lg-wrapper${o.className ? ` ${o.className}` : ''}`;
    wrapper.style.cssText = `
      position:relative;overflow:hidden;
      ${o.borderRadius ? `border-radius:${o.borderRadius};` : ''}
    `;

    wrapper.appendChild(effectDiv);
    wrapper.appendChild(tintDiv);
    wrapper.appendChild(shineDiv);
    wrapper.appendChild(contentDiv);

    el.appendChild(wrapper);
    return wrapper;
  }

  /* =========================================================
     7. PUBLIC API
     ========================================================= */

  const _applied = new WeakMap(); /* element → { wrapper, generator } */

  /**
   * Apply liquid glass to a single element.
   *
   * @param {HTMLElement} element
   * @param {object} [options]
   * @param {'standard'|'polar'|'prominent'} [options.mode='standard']
   * @param {number} [options.displacementScale=25]
   * @param {number} [options.blurAmount=6]
   * @param {number} [options.saturation=160]
   * @param {number} [options.aberrationIntensity=2]
   * @param {string} [options.cornerRadius='16px']
   * @param {string} [options.tintColor]
   * @param {boolean} [options.wrapLayers=true]  set false to only inject filter
   */
  function apply(element, options) {
    if (!element) {
      return;
    }
    if (!isMobile()) {
      return;
    }
    if (prefersHighContrast()) {
      return;
    }

    const o = Object.assign(
      {
        mode: 'standard',
        displacementScale: 25,
        blurAmount: 6,
        saturation: 160,
        aberrationIntensity: 2,
        cornerRadius: '16px',
        tintColor: 'rgba(255,255,255,0.18)',
        wrapLayers: true,
      },
      options
    );

    /* Generate displacement map for aberration filter */
    const generator = new ShaderDisplacementGenerator({
      width: 120,
      height: 60,
      fragment: fragmentShaders[o.mode] || fragmentShaders.standard,
    });
    const mapUrl = generator.generate();

    /* Ensure filters are in the DOM */
    const aberrationId = `lg-aberration-${o.mode}`;
    getOrCreateFilter('lg-distortion', () => buildDistortionFilter('lg-distortion'));
    getOrCreateFilter(aberrationId, () =>
      buildAberrationFilter(aberrationId, mapUrl, o.displacementScale, o.aberrationIntensity)
    );

    if (o.wrapLayers) {
      const wrapper = wrapInGlassLayers(element, {
        filterIds: ['lg-distortion', aberrationId],
        blurAmount: o.blurAmount,
        saturation: o.saturation,
        tintColor: o.tintColor,
        borderRadius: o.cornerRadius,
      });
      _applied.set(element, { wrapper, generator });
    } else {
      /* wrapLayers:false — no DOM wrapper, but still track for cleanup */
      _applied.set(element, { wrapper: null, generator });
    }
  }

  /**
   * Remove liquid glass from an element previously `apply()`-d.
   *
   * @param {HTMLElement} element
   */
  function remove(element) {
    if (!element || !_applied.has(element)) {
      return;
    }
    const { wrapper, generator } = _applied.get(element);
    if (wrapper && wrapper.parentNode) {
      /* Move children back out */
      const content = wrapper.querySelector('.lg-content');
      if (content) {
        while (content.firstChild) {
          wrapper.parentNode.appendChild(content.firstChild);
        }
      }
      wrapper.parentNode.removeChild(wrapper);
    }
    generator.destroy();
    _applied.delete(element);
  }

  /**
   * Destroy all liquid-glass effects and remove the SVG container.
   */
  function destroy() {
    _generatedFilters = {};
    if (_svg && _svg.parentNode) {
      _svg.parentNode.removeChild(_svg);
    }
    _svg = null;
    _defs = null;
  }

  /* =========================================================
     8. AUTO-INIT — apply to supplier dashboard components
     ========================================================= */

  /**
   * Initialise liquid glass on all supplier-dashboard mobile components.
   * Respects prefers-reduced-motion and prefers-contrast.
   * Only activates on mobile (≤768px).
   */
  function init() {
    if (!isMobile()) {
      return;
    }
    if (prefersHighContrast()) {
      return;
    }
    if (prefersReducedMotion()) {
      return;
    }

    /* Ensure SVG filters exist (distortion filter used by CSS too) */
    ensureSVGContainer();
    getOrCreateFilter('lg-distortion', () => buildDistortionFilter('lg-distortion'));

    /* We use CSS (liquid-glass-mobile.css) for the visual layers on most
       components.  The JS engine only programmatically wraps components that
       benefit from the full 4-layer structure with dynamic displacement maps. */

    const heroEl = document.querySelector('.dashboard-hero');
    if (heroEl) {
      apply(heroEl, {
        mode: 'prominent',
        displacementScale: 30,
        blurAmount: 4,
        saturation: 170,
        aberrationIntensity: 3,
        cornerRadius: '20px',
        tintColor: 'rgba(11,128,115,0.08)',
        wrapLayers: false /* hero already has its own layer structure */,
      });
    }

    const bottomNav = document.querySelector('.ef-bottom-nav');
    if (bottomNav) {
      apply(bottomNav, {
        mode: 'standard',
        displacementScale: 20,
        blurAmount: 8,
        saturation: 150,
        aberrationIntensity: 2,
        cornerRadius: '24px',
        tintColor: 'rgba(255,255,255,0.2)',
        wrapLayers: false,
      });
    }
  }

  /* =========================================================
     9. EXPOSE GLOBAL API
     ========================================================= */
  window.LiquidGlass = { apply, remove, destroy, init };

  /* Auto-run after DOM is ready */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    /* Use rAF to avoid layout thrash on first paint */
    requestAnimationFrame(init);
  }
})();
