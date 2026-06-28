/**
 * Template Renderer Middleware
 * Replaces placeholders in HTML files with dynamic content from content-config
 */

"use strict";

const path = require("path");
const logger = require("./logger");
const fs = require("fs").promises;
const { getPlaceholders } = require("../config/content-config");

const templateCache = new Map();
const ANONYMOUS_SANITIZER_COMMENT =
  "<!-- eventflow-anonymous-sanitizer: active -->";
const HOMEPAGE_V2_FILE = "/home-v2.html";
const HOMEPAGE_V2_PREVIEW_PATHS = new Set([
  "/home-v2",
  "/home-v2.html",
  "/home-v2-preview",
  "/home-v2-preview.html",
]);
const HOMEPAGE_DIRTY_COPY = {
  supplierClaim: ["All suppliers are verified", " and vetted"].join(""),
  testimonialsHeading: ["What Our Customers", " Say"].join(""),
  james: ["James", " Wilson"].join(""),
  emma: ["Emma", " Davies"].join(""),
};

function isCachingEnabled() {
  return process.env.NODE_ENV === "production";
}

function replacePlaceholders(content) {
  const placeholders = getPlaceholders();
  let result = content;

  for (const [key, value] of Object.entries(placeholders)) {
    const pattern = new RegExp(`\\{\\{${key}\\}\\}`, "g");
    result = result.replace(pattern, value);
  }

  return result;
}

function isAnonymousRequest(req) {
  return !(req && req.user);
}

function setHtmlNoStoreHeaders(res) {
  res.setHeader(
    "Cache-Control",
    "no-store, no-cache, must-revalidate, private",
  );
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");
}

function appendVaryHeader(res, value) {
  const existing = res.getHeader("Vary");
  if (!existing) {
    res.setHeader("Vary", value);
    return;
  }
  const values = String(existing)
    .split(",")
    .map((item) => item.trim().toLowerCase());
  if (!values.includes(value.toLowerCase())) {
    res.setHeader("Vary", `${existing}, ${value}`);
  }
}

function addAnonymousSanitizerMarker(content) {
  if (content.includes(ANONYMOUS_SANITIZER_COMMENT)) {
    return content;
  }
  if (/<body\b[^>]*>/i.test(content)) {
    return content.replace(
      /(<body\b[^>]*>)/i,
      `$1\n${ANONYMOUS_SANITIZER_COMMENT}`,
    );
  }
  return `${ANONYMOUS_SANITIZER_COMMENT}\n${content}`;
}

function stripAnonymousAuthText(content) {
  return content
    .replace(
      /<!--(?:(?!-->)[\s\S])*(?:Dashboard|Notification|Alerts|auth)(?:(?!-->)[\s\S])*-->/gi,
      "",
    )
    .replace(/aria-label="View notifications"/gi, 'aria-label=""')
    .replace(/aria-label="Go to dashboard"/gi, 'aria-label=""')
    .replace(
      /(<a\b[^>]*id="ef-dashboard-link"[\s\S]*?>)[\s\S]*?<\/a>/gi,
      "$1</a>",
    )
    .replace(
      /(<a\b[^>]*id="ef-mobile-dashboard"[\s\S]*?>)[\s\S]*?<\/a>/gi,
      "$1</a>",
    )
    .replace(
      /(<a\b[^>]*id="ef-mobile-logout"[\s\S]*?>)[\s\S]*?<\/a>/gi,
      "$1</a>",
    )
    .replace(
      /(<a\b[^>]*id="ef-bottom-dashboard"[\s\S]*?<span class="ef-bottom-label">)[\s\S]*?(<\/span>)/gi,
      "$1$2",
    )
    .replace(
      /<div\b[^>]*id="notification-dropdown"[\s\S]*?<a\b[^>]*class="notification-view-all"[\s\S]*?<\/a>\s*<\/div>\s*<\/div>/i,
      "",
    )
    .replace(/Dashboard\s+Log out/gi, "")
    .replace(/Mark all as read/gi, "")
    .replace(/View all/gi, "")
    .replace(/Version:\s*loading…?/gi, "");
}

function sanitiseHomepage(content) {
  return content
    .replace(/\s*<section id="stats-section"[\s\S]*?<\/section>/i, "")
    .replace(
      new RegExp(
        `<h3 class="ef-card__title">Verified Suppliers<\\/h3>\\s*<p class="ef-card__text">${HOMEPAGE_DIRTY_COPY.supplierClaim}<\\/p>`,
        "i",
      ),
      '<h3 class="ef-card__title">Suppliers opening in stages</h3><p class="ef-card__text">New supplier profiles are being added as EventFlow opens across the UK</p>',
    )
    .replace(new RegExp(HOMEPAGE_DIRTY_COPY.testimonialsHeading, "gi"), "")
    .replace(/Real experiences from real event planners/gi, "")
    .replace(/Sarah\s*&(?:amp;)?\s*Tom/gi, "")
    .replace(new RegExp(HOMEPAGE_DIRTY_COPY.james, "gi"), "")
    .replace(new RegExp(HOMEPAGE_DIRTY_COPY.emma, "gi"), "")
    .replace(/View All Marketplace Items/gi, "View marketplace");
}

function sanitiseStart(content) {
  return content.replace(
    /(<div class="wizard-card wizard-preload-card" id="wizard-preload")\s+aria-hidden="true"/i,
    "$1",
  );
}

function sanitisePublicCalendar(content) {
  return content
    .replace(
      /\/\*\s*Add event button \(publisher\)\s*\*\//i,
      "/* Publisher-only banner styles */",
    )
    .replace(
      /<div id="pc-publisher-banner"[\s\S]*?<\/div>\s*(<div id="pc-permission-notice")/i,
      '<div id="pc-publisher-banner" class="pc-publisher-banner" hidden style="display:none;" role="status"></div>\n\n        $1',
    )
    .replace(
      /<section id="pc-admin-requests-panel"[\s\S]*?<\/section>/i,
      '<section id="pc-admin-requests-panel" class="pc-publisher-banner pc-notice--slate" hidden style="display:none;" aria-labelledby="pc-admin-requests-title"><div id="pc-admin-requests-list" aria-live="polite"></div></section>',
    )
    .replace(
      /<!-- Add \/ Edit Event Modal -->[\s\S]*?<footer class="footer"/i,
      '<!-- Role-gated event modal shell: populated only for authenticated calendar publishers. -->\n    <div id="pc-modal-overlay" class="pc-modal-overlay" role="dialog" aria-modal="true" aria-labelledby="pc-modal-title">\n      <div class="pc-modal">\n        <div class="pc-modal__header">\n          <h2 class="pc-modal__title" id="pc-modal-title"></h2>\n          <button class="ef-cta pc-modal__close" id="pc-modal-close-btn" aria-label="Close modal" type="button">×</button>\n        </div>\n        <form id="pc-event-form" novalidate>\n          <input type="hidden" id="pc-form-id" />\n          <div id="pc-form-error" class="pc-form__error" role="alert"></div>\n          <button type="button" id="pc-modal-cancel" class="ef-cta pc-btn pc-btn-ghost" hidden></button>\n          <button type="submit" id="pc-modal-submit" class="ef-cta pc-btn pc-btn-primary" hidden></button>\n        </form>\n      </div>\n    </div>\n\n    <footer class="footer"',
    );
}

function sanitiseGuides(content) {
  return content
    .replace(
      /<div class="skeleton-grid" id="guides-loading"[^>]*>[\s\S]*?<\/div>/i,
      '<div class="skeleton-grid" id="guides-loading" hidden aria-hidden="true"></div>',
    )
    .replace(
      /<div class="guides-empty" id="guides-empty"[\s\S]*?<button[\s\S]*?<\/button>\s*<\/div>/i,
      '<div class="guides-empty" id="guides-empty" role="status" aria-live="polite" hidden></div>',
    )
    .replace(
      /Discover vetted photographers, caterers, venues, and more near you\./gi,
      "Discover photographers, caterers, venues and more near you.",
    );
}

function useHomepageV2() {
  return (
    String(process.env.HOMEPAGE_VARIANT || "v1")
      .trim()
      .toLowerCase() === "v2"
  );
}

function isHomepageV2PreviewPath(requestPath) {
  return HOMEPAGE_V2_PREVIEW_PATHS.has(requestPath);
}

function resolvePublicTemplatePath(requestPath) {
  if (requestPath === "/") {
    return useHomepageV2() ? HOMEPAGE_V2_FILE : "/index.html";
  }

  if (isHomepageV2PreviewPath(requestPath)) {
    return HOMEPAGE_V2_FILE;
  }

  if (!path.extname(requestPath)) {
    return `${requestPath}.html`;
  }

  return requestPath;
}

function addPreviewRobotsMeta(content) {
  if (/<meta\s+name=["']robots["'][^>]*noindex[^>]*>/i.test(content)) {
    return content;
  }

  const robotsMeta = '    <meta name="robots" content="noindex,nofollow" />\n';

  if (/<head\b[^>]*>/i.test(content)) {
    return content.replace(/(<head\b[^>]*>\s*)/i, `$1\n${robotsMeta}`);
  }

  return `${robotsMeta}${content}`;
}

function sanitizeAnonymousPublicHtml(content, requestPath, req) {
  if (!isAnonymousRequest(req)) {
    return content;
  }

  let result = stripAnonymousAuthText(content);

  if (requestPath === "/index.html") {
    result = sanitiseHomepage(result);
  } else if (requestPath === "/start.html") {
    result = sanitiseStart(result);
  } else if (requestPath === "/public-calendar.html") {
    result = sanitisePublicCalendar(result);
  } else if (requestPath === "/guides.html") {
    result = sanitiseGuides(result);
  }

  return addAnonymousSanitizerMarker(result);
}

function shouldProcessFile(filePath) {
  if (!filePath.endsWith(".html")) {
    return false;
  }

  const fileName = path.basename(filePath);
  const processFiles = [
    "legal.html",
    "terms.html",
    "privacy.html",
    "data-rights.html",
    "admin-settings.html",
  ];

  if (processFiles.includes(fileName)) {
    return true;
  }

  if (filePath.includes("/articles/")) {
    return true;
  }

  if (fileName.startsWith("test-")) {
    return false;
  }

  return true;
}

async function getFile(filePath, requestPath, req) {
  const cachingEnabled = isCachingEnabled();
  const stats = await fs.stat(filePath);
  const mtime = stats.mtime.getTime();
  const configPath = path.join(__dirname, "..", "config", "content-config.js");
  let configMtime = 0;

  try {
    const configStats = await fs.stat(configPath);
    configMtime = configStats.mtime.getTime();
  } catch (err) {
    // Config file doesn't exist or can't be read - use 0
  }

  const authBucket = isAnonymousRequest(req) ? "anon" : "auth";
  const cacheKey = `${filePath}:${configMtime}:${authBucket}`;

  if (cachingEnabled && templateCache.has(cacheKey)) {
    const cached = templateCache.get(cacheKey);
    if (cached.mtime === mtime) {
      return { content: cached.content, fromCache: true };
    }
  }

  const content = await fs.readFile(filePath, "utf8");
  const processedContent = sanitizeAnonymousPublicHtml(
    replacePlaceholders(content),
    requestPath,
    req,
  );

  if (cachingEnabled) {
    templateCache.set(cacheKey, {
      content: processedContent,
      mtime: mtime,
    });
  }

  return { content: processedContent, fromCache: false };
}

function clearCache() {
  templateCache.clear();
}

function templateMiddleware() {
  return async (req, res, next) => {
    if (req.method !== "GET") {
      return next();
    }

    const originalRequestPath = req.path;
    const requestPath = resolvePublicTemplatePath(originalRequestPath);
    const isHomepageV2Preview = isHomepageV2PreviewPath(originalRequestPath);

    if (!shouldProcessFile(requestPath)) {
      return next();
    }

    const publicDir = path.join(__dirname, "..", "public");
    const filePath = path.join(publicDir, requestPath);

    try {
      const { content } = await getFile(filePath, requestPath, req);
      const responseContent = isHomepageV2Preview
        ? addPreviewRobotsMeta(content)
        : content;

      setHtmlNoStoreHeaders(res);
      if (isHomepageV2Preview) {
        res.setHeader("X-Robots-Tag", "noindex, nofollow");
      }
      res.setHeader("X-EventFlow-Template-Renderer", "active");
      res.setHeader(
        "X-EventFlow-Public-Sanitizer",
        isAnonymousRequest(req) ? "anonymous-v2" : "skipped-authenticated",
      );
      appendVaryHeader(res, "Cookie");
      res.type("html");
      res.send(responseContent);
    } catch (error) {
      if (error.code === "ENOENT") {
        return next();
      }
      logger.error("Template rendering error:", error);
      return next(error);
    }
  };
}

module.exports = {
  templateMiddleware,
  replacePlaceholders,
  sanitizeAnonymousPublicHtml,
  clearCache,
  setHtmlNoStoreHeaders,
  appendVaryHeader,
  getFile,
  getPlaceholders,
  useHomepageV2,
  isHomepageV2PreviewPath,
  resolvePublicTemplatePath,
  addPreviewRobotsMeta,
};
