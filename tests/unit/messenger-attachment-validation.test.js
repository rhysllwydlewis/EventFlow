const {
  detectMimeFromBuffer,
  validateMessengerAttachment,
  MAX_ATTACHMENT_SIZE_BYTES,
} = require('../../utils/messengerAttachmentValidation');

function file({ mimetype, buffer, size, originalname = 'file.bin' }) {
  return {
    mimetype,
    buffer,
    size: size == null ? buffer.length : size,
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
      file({ mimetype: 'application/pdf', buffer: Buffer.from('%PDF-1.7\n'), originalname: 'quote.pdf' })
    );

    expect(result.ok).toBe(true);
    expect(result.extension).toBe('.pdf');
  });

  it('rejects mismatched declared type and file content', () => {
    const result = validateMessengerAttachment(
      file({ mimetype: 'image/png', buffer: Buffer.from('%PDF-1.7\n'), originalname: 'not-a-real.png' })
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/does not match/i);
  });

  it('rejects unsupported file types', () => {
    const result = validateMessengerAttachment(
      file({ mimetype: 'application/x-msdownload', buffer: Buffer.from('MZ fake exe'), originalname: 'bad.exe' })
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
