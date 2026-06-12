const {
  detectMimeFromBuffer,
  validateMessengerAttachment,
  MAX_ATTACHMENT_SIZE_BYTES,
} = require('../../utils/messengerAttachmentValidation');

function file({ mimetype, buffer, size, originalname = 'file.bin' }) {
  return {
    mimetype,
    buffer,
    size: size === null || size === undefined ? buffer.length : size,
    originalname,
  };
}

describe('messenger attachment validation', () => {
  it('detects safe image and PDF signatures', () => {
    expect(detectMimeFromBuffer(Buffer.from([0xff, 0xd8, 0xff, 0x00]))).toBe('image/jpeg');
    expect(detectMimeFromBuffer(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]))).toBe('image/png');
    expect(detectMimeFromBuffer(Buffer.from('%PDF-1.7\n'))).toBe('application/pdf');
  });

  it('accepts a file when declared type matches signature', () => {
    const result = validateMessengerAttachment(
      file({
        mimetype: 'application/pdf',
        buffer: Buffer.from('%PDF-1.7\n'),
        originalname: 'quote.pdf',
      })
    );

    expect(result.ok).toBe(true);
    expect(result.extension).toBe('.pdf');
  });

  it('rejects mismatched declared type and file content', () => {
    const result = validateMessengerAttachment(
      file({
        mimetype: 'image/png',
        buffer: Buffer.from('%PDF-1.7\n'),
        originalname: 'not-a-real.png',
      })
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/does not match/i);
  });

  it('rejects unsupported file types', () => {
    const result = validateMessengerAttachment(
      file({
        mimetype: 'application/x-msdownload',
        buffer: Buffer.from('MZ fake exe'),
        originalname: 'bad.exe',
      })
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/unsupported/i);
  });

  it('rejects oversized attachments', () => {
    const result = validateMessengerAttachment(
      file({
        mimetype: 'text/plain',
        buffer: Buffer.from('safe text'),
        size: MAX_ATTACHMENT_SIZE_BYTES + 1,
        originalname: 'too-large.txt',
      })
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/10MB/i);
  });
});

describe('messenger v4 route attachment wiring', () => {
  function routeFile({ mimetype, buffer, size, originalname = 'file.bin' }) {
    return file({ mimetype, buffer, size, originalname });
  }

  it('imports and uses validateMessengerAttachment instead of an inline MIME map', () => {
    const source = require('fs').readFileSync(
      require('path').join(process.cwd(), 'routes/messenger-v4.js'),
      'utf8'
    );

    expect(source).toContain("require('../utils/messengerAttachmentValidation')");
    expect(source).toContain('validateMessengerAttachment(file)');
    expect(source).not.toContain('MIME_TO_EXT');
  });

  it('validates every attachment before writing any file to disk', async () => {
    const { persistValidatedMessengerAttachments } = require('../../routes/messenger-v4')._private;
    const writeFile = jest.fn();
    const mkdir = jest.fn().mockResolvedValue(undefined);

    await expect(
      persistValidatedMessengerAttachments(
        [
          routeFile({
            mimetype: 'application/pdf',
            buffer: Buffer.from('%PDF-1.7\n'),
            originalname: 'safe.pdf',
          }),
          routeFile({
            mimetype: 'image/png',
            buffer: Buffer.from('%PDF-1.7\n'),
            originalname: 'spoof.png',
          }),
        ],
        { fsImpl: { mkdir, writeFile }, uploadsDir: '/tmp/eventflow-messenger-test' }
      )
    ).rejects.toMatchObject({ statusCode: 400, message: expect.stringMatching(/does not match/i) });

    expect(mkdir).not.toHaveBeenCalled();
    expect(writeFile).not.toHaveBeenCalled();
  });

  it('rejects spoofed and oversized attachments with safe 400 errors', async () => {
    const { persistValidatedMessengerAttachments } = require('../../routes/messenger-v4')._private;

    await expect(
      persistValidatedMessengerAttachments([
        routeFile({
          mimetype: 'image/png',
          buffer: Buffer.from('%PDF-1.7\n'),
          originalname: 'spoof.png',
        }),
      ])
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'File content does not match declared type',
    });

    await expect(
      persistValidatedMessengerAttachments([
        routeFile({
          mimetype: 'text/plain',
          buffer: Buffer.from('safe text'),
          size: MAX_ATTACHMENT_SIZE_BYTES + 1,
          originalname: 'too-large.txt',
        }),
      ])
    ).rejects.toMatchObject({ statusCode: 400, message: 'Attachment exceeds 10MB limit' });
  });

  it('accepts valid PDF, image, and text files and keeps saved filenames random and safe', async () => {
    const { persistValidatedMessengerAttachments } = require('../../routes/messenger-v4')._private;
    const writes = [];
    const fsImpl = {
      mkdir: jest.fn().mockResolvedValue(undefined),
      writeFile: jest.fn((filepath, buffer) => {
        writes.push({ filepath, buffer });
        return Promise.resolve();
      }),
    };
    let counter = 0;
    const cryptoImpl = {
      randomBytes: jest.fn(() => Buffer.alloc(16, ++counter)),
    };

    const attachments = await persistValidatedMessengerAttachments(
      [
        routeFile({
          mimetype: 'application/pdf',
          buffer: Buffer.from('%PDF-1.7\n'),
          originalname: '../../quote.pdf',
        }),
        routeFile({
          mimetype: 'image/png',
          buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]),
          originalname: 'photo.png',
        }),
        routeFile({
          mimetype: 'text/plain',
          buffer: Buffer.from('hello from EventFlow'),
          originalname: 'notes.txt',
        }),
      ],
      { fsImpl, cryptoImpl, uploadsDir: '/tmp/eventflow-messenger-test' }
    );

    expect(fsImpl.mkdir).toHaveBeenCalledWith('/tmp/eventflow-messenger-test', { recursive: true });
    expect(fsImpl.writeFile).toHaveBeenCalledTimes(3);
    expect(attachments.map(attachment => attachment.url)).toEqual([
      expect.stringMatching(/^\/uploads\/messenger\/[a-f0-9]{32}\.pdf$/),
      expect.stringMatching(/^\/uploads\/messenger\/[a-f0-9]{32}\.png$/),
      expect.stringMatching(/^\/uploads\/messenger\/[a-f0-9]{32}\.txt$/),
    ]);
    expect(attachments[0].filename).toBe('../../quote.pdf');
    expect(
      writes.every(
        write =>
          !write.filepath.includes('quote.pdf') &&
          !write.filepath.includes('photo.png') &&
          !write.filepath.includes('notes.txt')
      )
    ).toBe(true);
  });
});
