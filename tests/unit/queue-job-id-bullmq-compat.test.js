'use strict';

const { Job } = require('bullmq');
const { notificationJobId, emailJobId } = require('../../services/queue');

function validateWithInstalledBullMq(jobId) {
  const job = Object.create(Job.prototype);
  job.name = 'compatibility-check';
  job.opts = { jobId };
  return () => job.validateOptions({ data: '{}' });
}

describe('BullMQ custom job ID compatibility', () => {
  it('accepts EventFlow notification and email IDs with the installed BullMQ version', () => {
    expect(validateWithInstalledBullMq(notificationJobId('message-1'))).not.toThrow();
    expect(validateWithInstalledBullMq(emailJobId('message-1', 'recipient-1'))).not.toThrow();
  });

  it('proves the superseded colon formats are rejected by BullMQ', () => {
    expect(validateWithInstalledBullMq('message:message-1')).toThrow('Custom Id cannot contain :');
    expect(validateWithInstalledBullMq('message:message-1:recipient:recipient-1')).toThrow(
      'Custom Id cannot contain :'
    );
  });
});
