/**
 * Integration tests for Dashboard WebSocket Real-time Updates
 * Tests that the dashboard-supplier.html file has the correct WebSocket integration
 */

'use strict';

const fs = require('fs');
const path = require('path');

describe('Dashboard WebSocket Real-time Updates Integration', () => {
  let dashboardContent;

  beforeAll(() => {
    // Use path.resolve from project root for robustness
    const dashboardPath = path.resolve(__dirname, '..', '..', 'public', 'dashboard-supplier.html');
    const modulePath = path.resolve(
      __dirname,
      '..',
      '..',
      'public',
      'assets',
      'js',
      'pages',
      'dashboard-supplier-module.js'
    );
    if (fs.existsSync(dashboardPath)) {
      dashboardContent = `${fs.readFileSync(dashboardPath, 'utf8')}\n${
        fs.existsSync(modulePath) ? fs.readFileSync(modulePath, 'utf8') : ''
      }`;
    }
  });

  describe('Required Script Imports', () => {
    it('should load the WebSocketClient script', () => {
      expect(dashboardContent).toBeDefined();
      expect(dashboardContent).toContain('websocket-client.js');
    });

    it('should load the notification system script', () => {
      expect(dashboardContent).toContain('notification-system.js');
    });
  });

  describe('Module-level Variables', () => {
    it('should declare analyticsChartInstance variable', () => {
      expect(dashboardContent).toMatch(/let\s+analyticsChartInstance\s*=\s*null/);
    });
  });

  describe('Chart Instance Storage', () => {
    it('should store the chart instance when creating performance chart', () => {
      expect(dashboardContent).toMatch(
        /analyticsChartInstance\s*=\s*await\s+createPerformanceChart/
      );
    });
  });

  describe('WebSocket Initialization', () => {
    it('should initialize WebSocketClient', () => {
      expect(dashboardContent).toMatch(/new\s+WebSocketClient\s*\(/);
    });

    it('should configure onConnect handler', () => {
      expect(dashboardContent).toMatch(/onConnect:\s*\(\)\s*=>/);
      expect(dashboardContent).toContain('Live Dashboard Connected');
    });

    it('should configure onNotification handler', () => {
      expect(dashboardContent).toMatch(
        /onNotification:\s*\(?data\)?\s*=>\s*handleRealtimeNotification/
      );
    });

    it('should check if WebSocketClient is defined before initializing', () => {
      expect(dashboardContent).toMatch(/typeof\s+WebSocketClient\s*!==\s*['"]undefined['"]/);
    });
  });

  describe('Real-time Notification Handler', () => {
    it('should define handleRealtimeNotification function', () => {
      expect(dashboardContent).toMatch(/function\s+handleRealtimeNotification\s*\(\s*data\s*\)/);
    });

    it('should handle enquiry_received events', () => {
      expect(dashboardContent).toMatch(/data\.type\s*===\s*['"]enquiry_received['"]/);
    });

    it('should handle profile_view events', () => {
      expect(dashboardContent).toMatch(/data\.type\s*===\s*['"]profile_view['"]/);
    });

    it('should show notification toast for enquiry_received', () => {
      const handlerMatch = dashboardContent.match(
        /data\.type\s*===\s*['"]enquiry_received['"][\s\S]{0,500}EventFlowNotifications\.info/
      );
      expect(handlerMatch).toBeTruthy();
    });

    it('should update quick-stat-enquiries element', () => {
      expect(dashboardContent).toContain("getElementById('quick-stat-enquiries')");
    });

    it('should update chart data when chart instance exists', () => {
      expect(dashboardContent).toMatch(
        /analyticsChartInstance\s*&&\s*analyticsChartInstance\.data/
      );
      expect(dashboardContent).toMatch(/analyticsChartInstance\.update\(\)/);
    });

    it('should have error handling in notification handler', () => {
      const handlerMatch = dashboardContent.match(
        /function\s+handleRealtimeNotification[\s\S]*?catch\s*\(/
      );
      expect(handlerMatch).toBeTruthy();
    });
  });

  describe('Enquiry Counter Updates', () => {
    it('should increment enquiry counter value', () => {
      const enquiryHandlerSection = dashboardContent.match(
        /data\.type\s*===\s*['"]enquiry_received['"][\s\S]{0,800}/
      );
      expect(enquiryHandlerSection).toBeTruthy();
      expect(enquiryHandlerSection[0]).toMatch(/currentValue\s*\+\s*1/);
    });

    it('should update data-target attribute', () => {
      const enquiryHandlerSection = dashboardContent.match(
        /data\.type\s*===\s*['"]enquiry_received['"][\s\S]{0,800}/
      );
      expect(enquiryHandlerSection).toBeTruthy();
      expect(enquiryHandlerSection[0]).toMatch(/setAttribute\s*\(\s*['"]data-target['"]/);
    });
  });

  describe('Chart Updates', () => {
    it('should update enquiries dataset (index 1)', () => {
      const enquiryHandlerSection = dashboardContent.match(
        /data\.type\s*===\s*['"]enquiry_received['"][\s\S]{0,1000}/
      );
      expect(enquiryHandlerSection).toBeTruthy();
      expect(enquiryHandlerSection[0]).toMatch(/datasets\[1\]/);
    });

    it('should update views dataset (index 0) for profile_view', () => {
      const viewHandlerSection = dashboardContent.match(
        /data\.type\s*===\s*['"]profile_view['"][\s\S]{0,1000}/
      );
      expect(viewHandlerSection).toBeTruthy();
      expect(viewHandlerSection[0]).toMatch(/datasets\[0\]/);
    });

    it('should increment last data point in dataset', () => {
      expect(dashboardContent).toMatch(/lastIndex\s*=\s*.*\.length\s*-\s*1/);
    });
  });

  describe('HTML Elements', () => {
    it('should have quick-stat-enquiries element in HTML', () => {
      expect(dashboardContent).toContain('id="quick-stat-enquiries"');
    });

    it('should have stat-number class for dynamic stats', () => {
      expect(dashboardContent).toMatch(/class="[^"]*stat-number[^"]*"/);
    });
  });
});
