const fs = require('fs');
const path = require('path');

describe('Messenger v4 attachment validation route wiring', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'routes/messenger-v4.js'), 'utf8');

  it('imports and uses the Messenger attachment validation utility before writing files', () => {
    expect(source.includes('../utils/messengerAttachmentValidation')).toBe(true);
    expect(source.includes('validateMessengerAttachment')).toBe(true);
    expect(source.includes('validateMessengerAttachment(file)')).toBe(true);
    expect(source.indexOf('validateMessengerAttachment(file)')).toBeLessThan(
      source.indexOf('fs.writeFile(filepath, file.buffer)')
    );
  });
});
