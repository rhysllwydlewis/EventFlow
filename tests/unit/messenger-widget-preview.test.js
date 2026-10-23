'use strict';

/**
 * The inbox widget on the dashboards shows a one-line preview of each conversation's last message.
 * A message that is only an attachment has no text, so the preview must say that rather than claim
 * the conversation has no messages.
 */

const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '../..');
const runner = path.join(__dirname, '../helpers/messenger-widget-scenario.js');

/** Renders the widget with the given last message and returns the preview line it showed. */
const previewFor = lastMessage => {
  const options = Buffer.from(JSON.stringify({ lastMessage }), 'utf8').toString('base64');
  const log = JSON.parse(
    execFileSync(process.execPath, [runner, options], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000,
    })
  );
  return log.previews[0];
};

describe('MessengerWidgetV4 conversation preview', () => {
  const sentAt = new Date().toISOString();

  test('shows the text of a text message', () => {
    expect(previewFor({ content: 'See you there', senderId: 'u2', sentAt })).toBe('See you there');
  });

  test('says "Attachment" for a message with no text, not "No messages yet"', () => {
    expect(previewFor({ content: '', senderId: 'u2', sentAt, type: 'file' })).toBe('📎 Attachment');
  });

  test('treats a whitespace-only message like an attachment', () => {
    expect(previewFor({ content: '   ', senderId: 'u2', sentAt })).toBe('📎 Attachment');
  });

  test('still says "No messages yet" when the conversation has no last message', () => {
    expect(previewFor(null)).toBe('No messages yet');
  });
});
