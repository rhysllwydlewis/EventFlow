/**
 * Homepage V2 hero bootstrap.
 *
 * V2 carries the same hero markup as V1 but not `home-init.js`, which owns
 * everything else on the V1 page. This is the V2-side driver for the shared
 * collage module, mirroring the calls `home-init.js` makes: the initial load,
 * the CSP-safe media error handlers, the parallax enhancement, and the unload
 * cleanup that stops the cycling interval and its watchdog.
 *
 * The retry ladder (`load`/`online` fallbacks) lives here too because the
 * collage silently no-ops when the settings fetch fails on a cold connection,
 * and `EFHeroCollage.load` guards itself with `window.__collageWidgetInitialized`.
 */
'use strict';
(() => {
  /*
   * These are reference traces, not generated squircles/superellipses.
   *
   * Several design passes tried to infer the approved render's silhouettes
   * from a shape family (border radii, squircles and finally Lamé curves). The
   * bounding boxes were right but the silhouettes still looked wrong. These
   * paths instead follow the visible edges of the approved 1672x941 render in
   * objectBoundingBox coordinates. The three foreground cards are direct
   * raster traces. Venues is partly obscured by them, so its visible top/left
   * edge is traced and its hidden edge is smoothly continued behind them.
   *
   * Keep this in sync with docs/assets/hero-collage-blob.py. The SVG defs live
   * in home-v2.html because clip-path url() needs them in-document; updating
   * their `d` here before DOMContentLoaded lets the existing mask plumbing
   * continue to cover both images and admin-supplied videos.
   */
  const referenceMasks = Object.freeze({
    venues:
      'M0.26,0.03 L0.3071,0.0172 L0.3552,0.0089 L0.4039,0.0046 L0.4527,0.004 L0.5015,0.0072 L0.5498,0.0143 L0.5973,0.0257 L0.6432,0.0422 L0.6866,0.0646 L0.727,0.0921 L0.7647,0.1231 L0.8009,0.1559 L0.8376,0.1881 L0.8725,0.2223 L0.9031,0.2603 L0.9295,0.3014 L0.9515,0.345 L0.9691,0.3906 L0.9823,0.4376 L0.9912,0.4856 L0.9958,0.5342 L0.997,0.5831 L0.9956,0.6319 L0.9913,0.6805 L0.9819,0.7283 L0.9589,0.7713 L0.9281,0.8092 L0.892,0.8421 L0.8525,0.8707 L0.8108,0.8961 L0.7676,0.9189 L0.7234,0.9397 L0.6785,0.9591 L0.6328,0.9763 L0.5859,0.9898 L0.5376,0.9974 L0.4889,0.9958 L0.4409,0.9868 L0.3941,0.9729 L0.3485,0.9554 L0.3042,0.9348 L0.2612,0.9116 L0.2194,0.8864 L0.1789,0.8591 L0.1442,0.8247 L0.1143,0.7861 L0.0898,0.7439 L0.0708,0.699 L0.0575,0.652 L0.0308,0.6126 L0.0096,0.5688 L0.0012,0.5208 L0.0032,0.4721 L0.0074,0.4234 L0.0157,0.3753 L0.0278,0.328 L0.0433,0.2817 L0.0624,0.2367 L0.0853,0.1936 L0.1111,0.1521 L0.141,0.1135 L0.1764,0.0799 L0.2164,0.0519 Z',
    catering:
      'M0.3987,0 L0.4472,0 L0.4947,0.0091 L0.5409,0.024 L0.5863,0.0419 L0.6313,0.0611 L0.6762,0.0803 L0.7212,0.0995 L0.7649,0.1216 L0.8077,0.1462 L0.8489,0.1737 L0.8865,0.207 L0.9202,0.245 L0.9497,0.2869 L0.9751,0.332 L0.9945,0.3806 L1,0.4322 L1,0.486 L1,0.5393 L0.9879,0.5894 L0.9663,0.6368 L0.9407,0.6819 L0.9147,0.7266 L0.8885,0.7711 L0.8622,0.8155 L0.8361,0.8601 L0.8104,0.905 L0.7847,0.95 L0.7529,0.9898 L0.7114,1 L0.6659,1 L0.6177,1 L0.5678,1 L0.5172,1 L0.4669,1 L0.4178,0.9922 L0.37,0.9827 L0.3229,0.9739 L0.2761,0.9652 L0.229,0.956 L0.1815,0.9466 L0.1354,0.9318 L0.0913,0.91 L0.0528,0.8781 L0.0225,0.837 L0.0029,0.7886 L0,0.7362 L0,0.6829 L0,0.6297 L0.0089,0.5776 L0.0203,0.526 L0.0332,0.4749 L0.0475,0.4242 L0.0625,0.3738 L0.0778,0.3235 L0.0934,0.2732 L0.1097,0.2233 L0.1278,0.1741 L0.1491,0.1266 L0.1777,0.0839 L0.2148,0.0499 L0.2573,0.0248 L0.3026,0.0067 L0.3501,0 Z',
    entertainment:
      'M0.6765,0 L0.7261,0 L0.7744,0.0137 L0.8192,0.0371 L0.8596,0.0687 L0.893,0.1088 L0.9197,0.154 L0.9408,0.2025 L0.9559,0.2536 L0.9683,0.3055 L0.9789,0.3578 L0.9874,0.4106 L0.9949,0.4635 L1,0.5167 L1,0.5705 L1,0.6243 L1,0.6779 L0.9981,0.7308 L0.9839,0.7821 L0.9602,0.8292 L0.9281,0.8704 L0.8908,0.9059 L0.8478,0.9332 L0.8015,0.9532 L0.7528,0.9657 L0.7037,0.976 L0.6545,0.9857 L0.6052,0.9943 L0.5555,1 L0.5046,1 L0.4533,1 L0.4022,1 L0.3522,1 L0.3041,1 L0.2588,0.9846 L0.2189,0.9524 L0.1855,0.9126 L0.1564,0.8691 L0.1329,0.8218 L0.1136,0.7723 L0.0951,0.7226 L0.0781,0.6722 L0.0615,0.6217 L0.0456,0.5709 L0.0306,0.5198 L0.0161,0.4685 L0.0039,0.4166 L0,0.3634 L0,0.3097 L0.0068,0.2571 L0.027,0.2082 L0.0566,0.1651 L0.0946,0.13 L0.1373,0.1022 L0.183,0.0803 L0.2304,0.0633 L0.2791,0.051 L0.3281,0.0401 L0.3775,0.0316 L0.427,0.0238 L0.4765,0.0165 L0.5262,0.0094 L0.5762,0.002 L0.6264,0 Z',
    photography:
      'M0.4858,0 L0.5354,0 L0.5835,0 L0.6299,0 L0.6746,0.0241 L0.7185,0.0523 L0.7624,0.0806 L0.8063,0.108 L0.847,0.14 L0.8845,0.1759 L0.9181,0.2155 L0.9481,0.258 L0.9715,0.3045 L0.9896,0.3533 L1,0.4039 L1,0.4562 L0.9992,0.5085 L0.9893,0.5598 L0.9746,0.6097 L0.9569,0.6588 L0.9355,0.7062 L0.9095,0.7513 L0.8789,0.7933 L0.8451,0.8328 L0.8088,0.8699 L0.7677,0.9014 L0.7233,0.9278 L0.6759,0.9484 L0.6265,0.9634 L0.5769,0.9773 L0.5263,0.9873 L0.4753,0.9948 L0.4241,1 L0.3724,1 L0.3211,0.9984 L0.2708,0.9874 L0.2215,0.9721 L0.1764,0.9468 L0.1363,0.9144 L0.1023,0.8749 L0.0738,0.8314 L0.0513,0.7845 L0.0352,0.7349 L0.0217,0.6845 L0.012,0.6332 L0.0049,0.5819 L0,0.5291 L0,0.4728 L0,0.4143 L0,0.3552 L0,0.2969 L0,0.2409 L0,0.1888 L0,0.1422 L0,0.1025 L0.017,0.0712 L0.0594,0.048 L0.1094,0.0306 L0.1638,0.0168 L0.2195,0.0044 L0.2747,0 L0.329,0 L0.3824,0 L0.4347,0 Z',
  });

  function applyReferenceMasks() {
    Object.entries(referenceMasks).forEach(([name, path]) => {
      const target = document.querySelector(`#hv2-mask-${name} path`);
      if (target) {
        target.setAttribute('d', path);
        target.dataset.maskSource = 'approved-render-trace';
      }
    });
  }

  /* This deferred script executes after the document has been parsed and before
     DOMContentLoaded, so the live clipPath nodes are corrected before the
     collage module starts loading/cycling media. */
  applyReferenceMasks();

  function collage() {
    return window.EFHeroCollage || null;
  }

  function load() {
    const api = collage();
    if (api) {
      api.load();
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const api = collage();
    if (!api) {
      return;
    }

    api.load();
    api.initErrorHandlers();
    api.initParallax();

    window.addEventListener('beforeunload', () => api.cleanup());
  });

  window.addEventListener('load', () => {
    if (!window.__collageWidgetInitialized) {
      load();
    }
  });

  window.addEventListener('online', () => {
    if (!window.__collageWidgetInitialized) {
      // Small delay so the connection has settled before the settings fetch.
      window.setTimeout(load, 500);
    }
  });
})();
