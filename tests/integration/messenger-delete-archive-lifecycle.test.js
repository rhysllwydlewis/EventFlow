'use strict';

const fs = require('fs');
const path = require('path');

describe('Messenger delete/archive lifecycle', () => {
  const read = rel => fs.readFileSync(path.join(__dirname, '..', '..', rel), 'utf8');

  it('loads the backend lifecycle patch before mounting Messenger v4 routes', () => {
    const routesIndex = read('routes/index.js');
    expect(routesIndex).toContain("require('../services/messenger-v4-lifecycle-patch')");
    expect(routesIndex.indexOf("require('../services/messenger-v4-lifecycle-patch')")).toBeLessThan(
      routesIndex.indexOf("require('./messenger-v4')")
    );
  });

  it('keeps archive and delete as separate participant states', () => {
    const patch = read('services/messenger-v4-lifecycle-patch.js');
    expect(patch).toContain('isDeleted: { $ne: true }');
    expect(patch).toContain('[`participants.${participantIndex}.isDeleted`]: true');
    expect(patch).toContain('[`participants.${participantIndex}.isArchived`]: false');
    expect(patch).toContain('isArchived: filters.archived');
  });

  it('does not reuse archived or deleted conversations for new generic starts', () => {
    const patch = read('services/messenger-v4-lifecycle-patch.js');
    expect(patch).toContain('withVisibleCreatorFilter');
    expect(patch).toContain('participantVisibleMatch');
    expect(patch).toContain('isArchived: { $ne: true }');
    expect(patch).toContain('isDeleted: true');
    expect(patch).toContain('Found existing visible context-based conversation');
    expect(patch).toContain('Found existing visible direct conversation');
  });

  it('hides deleted conversations from direct fetches, unread counts and message search', () => {
    const patch = read('services/messenger-v4-lifecycle-patch.js');
    expect(patch).toContain('isDeletedForUser(conversation, userId)');
    expect(patch).toContain('searchMessages');
    expect(patch).toContain("$text: { $search: query }");
    expect(patch).toContain('!participant.isDeleted');
  });

  it('loads client hardening that turns delete into a stable delete action', () => {
    const html = read('public/messenger/index.html');
    const client = read('public/messenger/js/MessengerDeleteArchiveLifecycle.js');
    expect(html).toContain('/messenger/js/MessengerDeleteArchiveLifecycle.js?v=1.0.0');
    expect(client).toContain('Delete conversation');
    expect(client).toContain('event.stopImmediatePropagation');
    expect(client).toContain('MutationObserver');
    expect(client).toContain('Conversation deleted from your Messenger.');
  });
});
