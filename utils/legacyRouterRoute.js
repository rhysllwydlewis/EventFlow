'use strict';

/**
 * Remove an obsolete route layer from an Express router without loading the
 * module solely for the purpose of patching it.
 *
 * EventFlow still mounts a small number of legacy routers directly in
 * server.js before the modular route index is mounted. During migration, a
 * replacement route can safely disable only the already-loaded legacy handler
 * and allow the request to fall through to the canonical implementation.
 *
 * @param {object} router Express Router instance
 * @param {string} routePath Exact router-local path, for example `/postmark`
 * @param {string} method Lower-case HTTP method, for example `post`
 * @returns {number} Number of matching route layers removed
 */
function removeRouterRoute(router, routePath, method = 'post') {
  if (!router || !Array.isArray(router.stack)) {
    return 0;
  }

  const normalizedMethod = String(method || '').toLowerCase();
  let removed = 0;

  for (let index = router.stack.length - 1; index >= 0; index -= 1) {
    const layer = router.stack[index];
    const route = layer && layer.route;
    if (!route) {
      continue;
    }

    const paths = Array.isArray(route.path) ? route.path : [route.path];
    const methodMatches = Boolean(route.methods && route.methods[normalizedMethod]);
    if (paths.includes(routePath) && methodMatches) {
      router.stack.splice(index, 1);
      removed += 1;
    }
  }

  return removed;
}

/**
 * Remove a route only when the target CommonJS module has already been loaded.
 * This avoids changing isolated modular-route tests where the legacy router is
 * not mounted ahead of the replacement.
 *
 * @param {string} resolvedModulePath Absolute path returned by require.resolve
 * @param {string} routePath Exact router-local path
 * @param {string} method Lower-case HTTP method
 * @returns {number} Number of matching route layers removed
 */
function removeLoadedRouterRoute(resolvedModulePath, routePath, method = 'post') {
  const cachedModule = require.cache[resolvedModulePath];
  if (!cachedModule) {
    return 0;
  }
  return removeRouterRoute(cachedModule.exports, routePath, method);
}

module.exports = {
  removeLoadedRouterRoute,
  removeRouterRoute,
};
