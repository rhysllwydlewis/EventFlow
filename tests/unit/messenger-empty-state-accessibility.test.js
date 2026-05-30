const fs = require('fs');
const path = require('path');

describe('Messenger empty state accessibility', () => {
  it('marks chat empty/loading failure states as polite status regions', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'public/messenger/js/ChatViewV4.js'),
      'utf8'
    );

    expect(source).toContain('id="v4ChatEmpty" role="status" aria-live="polite"');
    expect(source).toContain('class="messenger-v4__empty-state" role="status" aria-live="polite"');
  });

  it('keeps conversation-list empty states accessible and actionable', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'public/messenger/js/ConversationListV4.js'),
      'utf8'
    );

    expect(source).toContain("wrapper.setAttribute('role', 'status')");
    expect(source).toContain("cta.setAttribute('aria-label', 'Start a new conversation')");
  });
});
