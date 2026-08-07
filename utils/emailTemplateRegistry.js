'use strict';

const fs = require('fs');
const path = require('path');

const APP_BASE_URL = process.env.APP_BASE_URL || process.env.BASE_URL || 'http://localhost:3000';
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || 'support@event-flow.co.uk';
const HELLO_EMAIL = process.env.HELLO_EMAIL || 'hello@event-flow.co.uk';

const TEMPLATES_DIR = path.join(__dirname, '..', 'email-templates');

const CATEGORY_LABELS = {
  account: 'Account/security',
  welcome: 'Welcome/onboarding',
  marketing: 'Marketing/newsletter',
  supplier: 'Supplier/admin',
  partner: 'Partner',
  billing: 'Billing/subscription',
};

const PREHEADERS = {
  verification: 'Confirm your email address to finish setting up your EventFlow account.',
  'password-reset': 'Use this secure link to reset your EventFlow password. It expires in 1 hour.',
  'password-reset-confirmation': 'Your EventFlow password was changed successfully.',
  welcome: 'Your EventFlow account is ready.',
  'welcome-customer': 'Your event planning dashboard is ready.',
  'welcome-supplier': 'Complete your supplier profile and prepare to receive enquiries.',
  marketing: 'See the latest EventFlow updates and planning improvements.',
  notification: 'You have a new EventFlow account update.',
  'new-message': 'You have a new message on EventFlow.',
  'action-prompts': 'Review the supplier profile improvements recommended by EventFlow.',
  'newsletter-confirm': 'Confirm your subscription to receive EventFlow updates.',
  'newsletter-welcome': 'You are subscribed to EventFlow updates.',
  'partner-welcome': 'Your referral code and partner dashboard are ready.',
  'supplier-verification-status': 'Your supplier verification status has been updated.',
  'subscription-activated': 'Your supplier subscription is now active.',
  'subscription-cancelled': 'Your supplier subscription cancellation has been confirmed.',
  'subscription-upgraded': 'Your supplier subscription has been upgraded.',
  'subscription-downgrade-scheduled': 'Your supplier subscription downgrade has been scheduled.',
  'subscription-payment-failed':
    'Please update your payment method to keep your supplier features active.',
  'subscription-renewal-reminder': 'Your supplier subscription renewal is coming up.',
  'subscription-trial-ending': 'Your supplier subscription trial is ending soon.',
  'support-ticket-reply': 'The EventFlow Support Team has replied to your ticket.',
  'contact-enquiry-reply': 'EventFlow has replied to your enquiry.',
  'review-request': 'You have been invited to share your experience on EventFlow.',
};

const META = {
  verification: {
    category: 'account',
    purpose: 'Email address verification',
    variables: ['name', 'verificationLink'],
  },
  'password-reset': {
    category: 'account',
    purpose: 'Password reset link',
    variables: ['name', 'resetLink'],
  },
  'password-reset-confirmation': {
    category: 'account',
    purpose: 'Password reset confirmation',
    variables: ['name', 'resetTime'],
  },
  welcome: {
    category: 'welcome',
    purpose: 'Generic verified account welcome',
    variables: ['name'],
  },
  'welcome-customer': {
    category: 'welcome',
    purpose: 'Customer onboarding welcome',
    variables: ['name'],
  },
  'welcome-supplier': {
    category: 'welcome',
    purpose: 'Supplier onboarding welcome',
    variables: ['name'],
  },
  marketing: {
    category: 'marketing',
    purpose: 'Marketing or admin campaign update',
    variables: ['name', 'title', 'message', 'unsubscribeLink'],
  },
  notification: {
    category: 'account',
    purpose: 'Transactional account notification',
    variables: ['name', 'title', 'message', 'ctaSection'],
  },
  'new-message': {
    category: 'account',
    purpose: 'New messenger message notification',
    variables: ['senderName', 'contextSuffix', 'previewHtml', 'conversationUrl'],
  },
  'support-ticket-reply': {
    category: 'account',
    purpose: 'Support ticket reply',
    variables: [
      'name',
      'ticketSubject',
      'replyMessageHtml',
      'ticketUrl',
      'supportEmail',
      'preheader',
    ],
  },
  'contact-enquiry-reply': {
    category: 'account',
    purpose: 'Contact form enquiry reply',
    variables: ['name', 'enquirySubject', 'replyMessageHtml', 'supportEmail'],
  },
  'review-request': {
    category: 'supplier',
    purpose: 'Customer review request sent on behalf of a supplier',
    variables: ['name', 'supplierName', 'reviewLink', 'expiresInDays'],
  },
  'action-prompts': {
    category: 'supplier',
    purpose: 'Supplier profile action prompt digest',
    variables: ['name', 'actionsHtml', 'loginUrl', 'managePrefsUrl', 'unsubscribeSection'],
  },
  'newsletter-confirm': {
    category: 'marketing',
    purpose: 'Newsletter double opt-in confirmation',
    variables: ['confirmLink'],
  },
  'newsletter-welcome': {
    category: 'marketing',
    purpose: 'Newsletter welcome',
    variables: ['unsubscribeLink'],
  },
  'partner-welcome': {
    category: 'partner',
    purpose: 'Partner portal welcome and referral code',
    variables: ['name', 'refCode', 'refLink', 'dashboardLink'],
  },
  'supplier-verification-status': {
    category: 'supplier',
    purpose: 'Supplier verification decision update',
    variables: [
      'name',
      'statusTitle',
      'statusMessage',
      'notesSection',
      'dashboardUrl',
      'supportEmail',
      'headerGradient',
      'ctaGradient',
      'ctaText',
    ],
  },
  'subscription-activated': {
    category: 'billing',
    purpose: 'Subscription activation confirmation',
    variables: [
      'name',
      'planName',
      'status',
      'trialRow',
      'renewalDate',
      'amount',
      'billingCycle',
      'features',
    ],
  },
  'subscription-cancelled': {
    category: 'billing',
    purpose: 'Subscription cancellation confirmation',
    variables: ['name', 'planName', 'endDate'],
  },
  'subscription-upgraded': {
    category: 'billing',
    purpose: 'Subscription upgrade confirmation',
    variables: [
      'name',
      'previousPlan',
      'newPlan',
      'effectiveDate',
      'amount',
      'billingCycle',
      'features',
    ],
  },
  'subscription-downgrade-scheduled': {
    category: 'billing',
    purpose: 'Scheduled subscription downgrade confirmation',
    variables: [
      'name',
      'currentPlan',
      'newPlan',
      'currentAmount',
      'newAmount',
      'billingCycle',
      'effectiveDate',
    ],
  },
  'subscription-payment-failed': {
    category: 'billing',
    purpose: 'Failed payment action required',
    variables: ['name', 'planName', 'amount', 'attemptDate', 'gracePeriodEnd'],
  },
  'subscription-renewal-reminder': {
    category: 'billing',
    purpose: 'Upcoming subscription renewal reminder',
    variables: [
      'name',
      'planName',
      'daysUntilRenewal',
      'renewalDate',
      'amount',
      'autoRenew',
      'renewalMessage',
      'ctaText',
    ],
  },
  'subscription-trial-ending': {
    category: 'billing',
    purpose: 'Subscription trial ending reminder',
    variables: [
      'name',
      'planName',
      'trialDays',
      'daysLeft',
      'trialEndDate',
      'amount',
      'billingCycle',
    ],
  },
};

function buildSampleData(name) {
  const common = {
    name: 'Amelia Clarke',
    preheader: getPreheader(name),
    supportEmail: SUPPORT_EMAIL,
    baseUrl: APP_BASE_URL,
  };
  const samples = {
    verification: { verificationLink: `${APP_BASE_URL}/verify?token=preview-token` },
    'password-reset': { resetLink: `${APP_BASE_URL}/reset-password?token=preview-token` },
    'password-reset-confirmation': { resetTime: '12 March 2026, 14:30' },
    welcome: {},
    'welcome-customer': {},
    'welcome-supplier': {},
    marketing: {
      title: 'Planning updates from EventFlow',
      message:
        '<p>We have improved supplier discovery and planning tools to help you keep your next event on track.</p><ul><li>Clearer supplier comparison</li><li>Updated planning guidance</li><li>More useful reminders</li></ul>',
      unsubscribeLink: `${APP_BASE_URL}/api/auth/unsubscribe?preview=1`,
    },
    notification: {
      title: 'Your EventFlow notification settings were updated',
      message: 'This is a sample account notification for preview and deliverability review.',
      preferencesLink: `${APP_BASE_URL}/settings/notifications`,
      ctaSection: `<table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center"><a href="${APP_BASE_URL}/settings" style="display:inline-block;padding:15px 40px;background:#0B8073;color:#ffffff;text-decoration:none;border-radius:10px;font-weight:700;">Review settings</a></td></tr></table>`,
    },
    'support-ticket-reply': {
      name: 'Olivia Hart',
      ticketSubject: 'Question about supplier package approval',
      replyMessageHtml:
        '<p>Thanks for getting in touch. Your package is now with our supplier review team.</p><p>We will update you as soon as the review is complete, usually within one working day.</p>',
      ticketUrl: `${APP_BASE_URL}/tickets/ticket-preview-123`,
      supportEmail: SUPPORT_EMAIL,
      preheader: 'The EventFlow Support Team has replied to your ticket.',
    },
    'action-prompts': {
      summaryHtml: '<p>Your supplier profile is nearly ready for review.</p>',
      actionsHtml:
        '<ul><li>Add two more portfolio images.</li><li>Confirm your service area.</li></ul>',
      loginUrl: `${APP_BASE_URL}/dashboard/supplier`,
      managePrefsUrl: `${APP_BASE_URL}/settings/notifications`,
      unsubscribeSection: ` &middot; <a href="${APP_BASE_URL}/api/auth/unsubscribe?preview=1" style="color:#94A3B8;text-decoration:none;">Unsubscribe from reminders</a>`,
    },
    'newsletter-confirm': {
      confirmLink: `${APP_BASE_URL}/api/newsletter/confirm?token=preview-token`,
    },
    'newsletter-welcome': {
      unsubscribeLink: `${APP_BASE_URL}/newsletter/unsubscribe?email=preview%40example.com`,
    },
    'partner-welcome': {
      refCode: 'EVENTFLOW25',
      refLink: `${APP_BASE_URL}/partner?ref=EVENTFLOW25`,
      dashboardLink: `${APP_BASE_URL}/partner/dashboard`,
    },
    'supplier-verification-status': {
      statusTitle: 'Verification approved',
      statusMessage: 'Your supplier profile has passed review and is ready to receive enquiries.',
      notesSection:
        '<div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:10px;padding:12px 14px;"><strong>Reviewer note:</strong> Portfolio and insurance details look complete.</div>',
      dashboardUrl: `${APP_BASE_URL}/dashboard/supplier`,
      headerGradient: 'linear-gradient(135deg,#059669,#10B981)',
      ctaGradient: 'linear-gradient(135deg,#059669,#10B981)',
      ctaText: 'Open Supplier Dashboard',
    },
    // NOTE: `amount` is always a bare number string (e.g. "29.00") in every
    // billing template below — each template's own markup prepends the "£"
    // symbol (`£{{amount}}`), matching exactly how webhooks/stripeWebhookHandler.js
    // calls (unitAmount / 100).toFixed(2). Including "£" here double-renders it.
    'subscription-activated': {
      planName: 'Professional',
      status: 'Active',
      trialRow: '',
      renewalDate: '12 April 2026',
      amount: '29.00',
      billingCycle: 'monthly',
      features:
        '<li>Unlimited messaging</li><li>Advanced analytics</li><li>Priority listing</li><li>Priority support</li>',
    },
    'subscription-cancelled': {
      planName: 'Professional',
      endDate: '12 April 2026',
    },
    'subscription-upgraded': {
      previousPlan: 'Starter',
      newPlan: 'Professional',
      effectiveDate: '12 March 2026',
      amount: '29.00',
      billingCycle: 'monthly',
      features: '<li>Unlimited packages</li><li>Priority placement</li>',
    },
    'subscription-downgrade-scheduled': {
      currentPlan: 'Professional',
      newPlan: 'Starter',
      currentAmount: '29.00',
      newAmount: '9.00',
      billingCycle: 'monthly',
      effectiveDate: '12 April 2026',
    },
    'subscription-payment-failed': {
      planName: 'Professional',
      amount: '29.00',
      attemptDate: '12 March 2026',
      gracePeriodEnd: '19 March 2026',
    },
    'subscription-renewal-reminder': {
      planName: 'Professional',
      daysUntilRenewal: '3',
      renewalDate: '12 April 2026',
      amount: '29.00',
      autoRenew: 'Enabled',
      renewalMessage: 'Your subscription will renew automatically.',
      ctaText: 'Manage Subscription',
    },
    'subscription-trial-ending': {
      planName: 'Professional',
      trialDays: '14',
      daysLeft: '3',
      trialEndDate: '19 March 2026',
      amount: '29.00',
      billingCycle: 'monthly',
    },
    'new-message': {
      senderName: 'Jordan Lee',
      contextSuffix: ' about "Wedding catering enquiry"',
      previewHtml:
        'Hi! Just checking if you have availability for a 120-guest wedding in June — could you send over a quote?',
      conversationUrl: `${APP_BASE_URL}/messenger/?conversation=preview-convo-id`,
    },
    'contact-enquiry-reply': {
      name: 'Jordan Lee',
      enquirySubject: 'Question about listing a venue',
      replyMessageHtml:
        '<p>Thanks for reaching out — venues can list for free during our launch period.</p><p>Let us know if you have any other questions!</p>',
      supportEmail: SUPPORT_EMAIL,
    },
    'review-request': {
      supplierName: 'Bloom & Co Florists',
      reviewLink: `${APP_BASE_URL}/review-request/preview-token`,
      expiresInDays: '14',
    },
  };
  return { ...common, ...(samples[name] || {}) };
}

function listTemplateNames() {
  return fs
    .readdirSync(TEMPLATES_DIR)
    .filter(file => file.endsWith('.html'))
    .map(file => path.basename(file, '.html'))
    .sort();
}

function isKnownTemplate(name) {
  return (
    typeof name === 'string' && /^[a-z0-9_-]+$/.test(name) && listTemplateNames().includes(name)
  );
}

function getPreheader(name) {
  return PREHEADERS[name] || 'An update from EventFlow.';
}

function getTemplateDetails(name) {
  if (!isKnownTemplate(name)) {
    return null;
  }
  const meta = META[name] || {
    category: 'account',
    purpose: 'EventFlow email template',
    variables: [],
  };
  return {
    name,
    filePath: `email-templates/${name}.html`,
    category: meta.category,
    categoryLabel: CATEGORY_LABELS[meta.category] || meta.category,
    purpose: meta.purpose,
    variables: meta.variables,
    preheader: getPreheader(name),
    sampleData: buildSampleData(name),
  };
}

function listTemplateDetails() {
  return listTemplateNames().map(getTemplateDetails).filter(Boolean);
}

function stripHtml(value) {
  return String(value || '')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\s+\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

function renderPlainTextTemplate(name, data = {}) {
  const merged = { ...buildSampleData(name), ...data };
  const lines = [`EventFlow`, '', `Hi ${merged.name || 'there'},`, ''];
  switch (name) {
    case 'verification':
      lines.push(
        'Confirm your email address to finish setting up your EventFlow account.',
        '',
        `Confirm your email: ${merged.verificationLink}`,
        '',
        'If you did not create an EventFlow account, you can ignore this email.'
      );
      break;
    case 'password-reset':
      lines.push(
        'Use this secure link to reset your EventFlow password. It expires in 1 hour.',
        '',
        `Reset your password: ${merged.resetLink}`,
        '',
        'If you did not request this reset, ignore this email and your password will stay unchanged.'
      );
      break;
    case 'password-reset-confirmation':
      lines.push(
        `Your EventFlow password was changed successfully${merged.resetTime ? ` at ${merged.resetTime}` : ''}.`,
        '',
        `If this was not you, contact ${SUPPORT_EMAIL} immediately.`
      );
      break;
    case 'welcome-customer':
    case 'welcome':
      lines.push(
        'Your event planning dashboard is ready.',
        '',
        `Start planning: ${APP_BASE_URL}/start`,
        '',
        `Need help? Email ${HELLO_EMAIL}.`
      );
      break;
    case 'welcome-supplier':
      lines.push(
        'Complete your supplier profile and prepare to receive enquiries.',
        '',
        `Open your supplier dashboard: ${APP_BASE_URL}/dashboard/supplier`,
        '',
        `Need support? Email ${SUPPORT_EMAIL}.`
      );
      break;
    case 'partner-welcome':
      lines.push(
        `Your referral code is ${merged.refCode}.`,
        '',
        `Referral link: ${merged.refLink}`,
        `Partner dashboard: ${merged.dashboardLink}`
      );
      break;
    case 'supplier-verification-status':
      lines.push(
        merged.statusTitle,
        stripHtml(merged.statusMessage),
        stripHtml(merged.notesSection),
        '',
        `${merged.ctaText || 'Open dashboard'}: ${merged.dashboardUrl}`,
        '',
        `Questions? Email ${merged.supportEmail || SUPPORT_EMAIL}.`
      );
      break;
    case 'support-ticket-reply':
      lines.push(
        'We’ve replied to your support ticket.',
        '',
        `Ticket: ${merged.ticketSubject}`,
        '',
        stripHtml(merged.replyMessageHtml),
        '',
        `View your ticket: ${merged.ticketUrl}`,
        '',
        `The EventFlow Support Team — ${merged.supportEmail || SUPPORT_EMAIL}`
      );
      break;
    case 'contact-enquiry-reply':
      lines.push(
        'We’ve replied to your enquiry.',
        '',
        `Enquiry: ${merged.enquirySubject}`,
        '',
        stripHtml(merged.replyMessageHtml),
        '',
        `Contact us again: ${APP_BASE_URL}/contact`,
        '',
        `The EventFlow Team — ${merged.supportEmail || SUPPORT_EMAIL}`
      );
      break;
    case 'review-request':
      lines.push(
        `${merged.supplierName} invited you to leave a review on EventFlow.`,
        '',
        `Leave a review: ${merged.reviewLink}`,
        '',
        `This link expires in ${merged.expiresInDays} days.`
      );
      break;
    case 'new-message': {
      const contextText = merged.contextSuffix ? ` ${stripHtml(merged.contextSuffix)}` : '';
      lines.push(
        `${merged.senderName} sent you a message${contextText}:`,
        '',
        `"${stripHtml(merged.previewHtml)}"`,
        '',
        `View conversation: ${merged.conversationUrl}`
      );
      break;
    }
    case 'marketing':
      lines.push(
        merged.title,
        '',
        stripHtml(merged.message),
        '',
        `Unsubscribe: ${merged.unsubscribeLink}`
      );
      break;
    case 'newsletter-confirm':
      lines.push(
        'Confirm your subscription to receive EventFlow updates.',
        '',
        `Confirm subscription: ${merged.confirmLink}`
      );
      break;
    case 'newsletter-welcome':
      lines.push(
        'You are now subscribed to EventFlow updates.',
        '',
        `Browse suppliers: ${APP_BASE_URL}/suppliers`,
        '',
        `Unsubscribe: ${merged.unsubscribeLink}`
      );
      break;
    case 'subscription-payment-failed':
      lines.push(
        `We could not collect ${merged.amount} for your ${merged.planName} supplier subscription on ${merged.attemptDate}.`,
        '',
        `Please update your payment method by ${merged.gracePeriodEnd} to keep your supplier features active.`,
        '',
        `Manage billing: ${APP_BASE_URL}/supplier/subscription`,
        '',
        `Need help? Email ${SUPPORT_EMAIL}.`
      );
      break;
    case 'subscription-activated':
      lines.push(
        `Your ${merged.planName} supplier subscription is active.`,
        '',
        `Amount: ${merged.amount} (${merged.billingCycle})`,
        `Next billing date: ${merged.nextBillingDate}`,
        '',
        `Manage subscription: ${APP_BASE_URL}/supplier/subscription`
      );
      break;
    case 'subscription-cancelled':
      lines.push(
        `Your ${merged.planName} supplier subscription cancellation has been confirmed.`,
        '',
        `Access remains available until: ${merged.accessEndDate}`,
        '',
        `Manage subscription: ${APP_BASE_URL}/supplier/subscription`
      );
      break;
    default:
      lines.push(
        merged.title || getPreheader(name),
        '',
        stripHtml(merged.message || merged.statusMessage || ''),
        '',
        `Open EventFlow: ${APP_BASE_URL}`
      );
  }
  return lines
    .filter((line, index, arr) => line !== '' || arr[index - 1] !== '')
    .join('\n')
    .replace(/\{\{[^}]+\}\}/g, '')
    .trim();
}

module.exports = {
  TEMPLATES_DIR,
  CATEGORY_LABELS,
  PREHEADERS,
  listTemplateNames,
  listTemplateDetails,
  getTemplateDetails,
  getPreheader,
  buildSampleData,
  renderPlainTextTemplate,
  isKnownTemplate,
  stripHtml,
};
