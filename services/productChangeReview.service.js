'use strict';

const reviewTasks = require('./contentReviewTask.service');

const RELEVANT_PATHS = [
  /^public\/(community|pricing|privacy|terms|legal|data-rights)/,
  /^public\/assets\/js\/.*(community|messag|subscription|payment|analytics|cookie|supplier|profile|location|photo|media|upload)/,
  /^routes\/integrations/,
  /^routes\/(community|payment|subscription|messag|analytics|cookie|supplier|profile|location|photo|media|upload|auth|reviews)/,
  /^services\/(community|payment|subscription|messag|analytics|cookie|supplier|profile|location|photo|media|upload|geocod)/,
  /^config\/(billing|policy|content|analytics|cookie)/,
  /^utils\/(postmark|stripe|geocod|analytics)/,
];

function isRelevantPath(file) {
  return RELEVANT_PATHS.some(pattern => pattern.test(String(file || '').replace(/\\/g, '/')));
}

async function inspectDeploymentChanges() {
  const headSha = process.env.RAILWAY_GIT_COMMIT_SHA || process.env.GIT_COMMIT_SHA || '';
  if (!/^[a-f0-9]{40}$/i.test(headSha)) {
    return { skipped: true, reason: 'deployment SHA unavailable' };
  }
  const settings = await reviewTasks.getSettings();
  const baseSha = settings.lastInspectedDeploymentSha;
  if (!baseSha) {
    await reviewTasks.updateSettings({ lastInspectedDeploymentSha: headSha }, { id: 'system' });
    return { skipped: true, reason: 'deployment baseline recorded', headSha };
  }
  if (baseSha === headSha) {
    return { skipped: true, reason: 'deployment already inspected', headSha };
  }

  const response = await fetch(
    `https://api.github.com/repos/rhysllwydlewis/EventFlow/compare/${encodeURIComponent(baseSha)}...${encodeURIComponent(headSha)}`,
    { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'EventFlow-policy-review' } }
  );
  if (!response.ok) {
    throw new Error(`GitHub comparison failed with ${response.status}`);
  }
  const comparison = await response.json();
  const files = (comparison.files || []).map(file => file.filename).filter(isRelevantPath);
  let task = null;
  if (files.length) {
    task = await reviewTasks.createProductChangeTask({ headSha, baseSha, files });
  }
  await reviewTasks.updateSettings({ lastInspectedDeploymentSha: headSha }, { id: 'system' });
  return { skipped: false, headSha, baseSha, files, task };
}

module.exports = { RELEVANT_PATHS, inspectDeploymentChanges, isRelevantPath };
