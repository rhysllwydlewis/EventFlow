const express = require('express');
const path = require('path');
const app = express();
const PUBLIC_DIR = '/home/runner/work/EventFlow/EventFlow/public';

app.get('/api/v1/auth/me', (req, res) => {
  res.json({ user: { id: 'admin1', role: 'admin', email: 'admin@test.com', name: 'Admin User' } });
});
app.get('/api/auth/me', (req, res) => {
  res.json({ user: { id: 'admin1', role: 'admin', email: 'admin@test.com', name: 'Admin User' } });
});
app.get('/api/v4/messenger/admin/conversations', (req, res) => {
  res.json({
    total: 3,
    conversations: [
      {
        _id: 'conv1',
        type: 'marketplace_listing',
        participants: [
          { displayName: 'Alice Smith', userId: 'u1' },
          { displayName: 'Bob Jones', userId: 'u2' },
        ],
        lastMessage: {
          content: 'Hello there, I am interested in booking this package for my wedding.',
        },
        updatedAt: new Date().toISOString(),
        status: 'active',
      },
      {
        _id: 'conv2',
        type: 'supplier_profile',
        participants: [{ displayName: 'Carol White', userId: 'u3' }],
        lastMessage: { content: 'Thank you for the quick reply!' },
        updatedAt: new Date(Date.now() - 86400000).toISOString(),
        status: 'active',
      },
      {
        _id: 'conv3',
        type: 'marketplace_listing',
        participants: [
          { displayName: 'Dave Brown', userId: 'u4' },
          { displayName: 'Eve Davis', userId: 'u5' },
        ],
        lastMessage: { content: 'Please let me know when you are available.' },
        updatedAt: new Date(Date.now() - 172800000).toISOString(),
        status: 'archived',
      },
    ],
  });
});
app.get('/api/admin/packages', (req, res) => {
  res.json({ packages: [] });
});
app.get('/api/admin/navbar-counts', (req, res) => {
  res.json({});
});
app.get('/api/admin/metrics', (req, res) => {
  res.json({ counts: {} });
});

app.use(express.static(PUBLIC_DIR));

app.listen(4200, '0.0.0.0', () => console.log('Mock server ready on 4200'));
