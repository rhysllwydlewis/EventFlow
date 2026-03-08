/**
 * Unit tests for Wizard Form Validation (WizardValidation)
 */

/* eslint-env browser */

describe('WizardValidation', () => {
  let mockLocalStorage;

  beforeEach(() => {
    // Mock localStorage (needed by WizardState which WizardValidation depends on)
    mockLocalStorage = {};
    global.localStorage = {
      getItem: jest.fn(key => mockLocalStorage[key] || null),
      setItem: jest.fn((key, value) => {
        mockLocalStorage[key] = value;
      }),
      removeItem: jest.fn(key => {
        delete mockLocalStorage[key];
      }),
    };

    global.window = global;

    // Load dependencies
    require('../../public/assets/js/utils/wizard-state.js');
    require('../../public/assets/js/pages/start-wizard-validation.js');
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('validateField', () => {
    describe('eventType', () => {
      it('should pass for a non-empty event type', () => {
        const result = window.WizardValidation.validateField('eventType', 'Wedding');
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should fail for an empty event type (required)', () => {
        const result = window.WizardValidation.validateField('eventType', '');
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });
    });

    describe('eventName', () => {
      it('should pass for an empty name (optional field)', () => {
        const result = window.WizardValidation.validateField('eventName', '');
        expect(result.valid).toBe(true);
      });

      it('should fail when name is too short (minLength: 3)', () => {
        const result = window.WizardValidation.validateField('eventName', 'AB');
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toMatch(/3/);
      });

      it('should pass for a name at least 3 characters', () => {
        const result = window.WizardValidation.validateField('eventName', 'Bob');
        expect(result.valid).toBe(true);
      });

      it('should fail when name exceeds maxLength: 100', () => {
        const longName = 'A'.repeat(101);
        const result = window.WizardValidation.validateField('eventName', longName);
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toMatch(/100/);
      });

      it('should pass for a name exactly 100 characters', () => {
        const result = window.WizardValidation.validateField('eventName', 'A'.repeat(100));
        expect(result.valid).toBe(true);
      });
    });

    describe('date', () => {
      it('should pass for an empty date (optional)', () => {
        const result = window.WizardValidation.validateField('date', '');
        expect(result.valid).toBe(true);
      });

      it('should fail for an invalid date string', () => {
        const result = window.WizardValidation.validateField('date', 'not-a-date');
        expect(result.valid).toBe(false);
      });

      it('should fail for a past date', () => {
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
        const result = window.WizardValidation.validateField('date', yesterday);
        expect(result.valid).toBe(false);
        expect(result.errors[0]).toMatch(/future/i);
      });

      it('should pass for a future date', () => {
        const result = window.WizardValidation.validateField('date', '2099-12-31');
        expect(result.valid).toBe(true);
      });
    });

    describe('guests', () => {
      it('should pass for empty (optional)', () => {
        const result = window.WizardValidation.validateField('guests', '');
        expect(result.valid).toBe(true);
      });

      it('should fail for zero guests', () => {
        const result = window.WizardValidation.validateField('guests', '0');
        expect(result.valid).toBe(false);
      });

      it('should fail for a negative number', () => {
        const result = window.WizardValidation.validateField('guests', '-5');
        expect(result.valid).toBe(false);
      });

      it('should fail for a non-integer (decimal)', () => {
        const result = window.WizardValidation.validateField('guests', '10.5');
        expect(result.valid).toBe(false);
      });

      it('should pass for a positive integer', () => {
        const result = window.WizardValidation.validateField('guests', '100');
        expect(result.valid).toBe(true);
      });
    });

    describe('unknown field', () => {
      it('should return valid for an unrecognised field name', () => {
        const result = window.WizardValidation.validateField('unknownField', 'anything');
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });
  });

  describe('validateStep', () => {
    describe('step 0 — EVENT_TYPE', () => {
      it('should fail when eventType is empty', () => {
        const result = window.WizardValidation.validateStep(0, { eventType: '' });
        expect(result.valid).toBe(false);
        expect(result.errors.eventType).toBeDefined();
      });

      it('should pass when eventType is set', () => {
        const result = window.WizardValidation.validateStep(0, { eventType: 'Wedding' });
        expect(result.valid).toBe(true);
      });
    });

    describe('step 1 — EVENT_BASICS', () => {
      it('should pass when all fields are empty (all optional)', () => {
        const result = window.WizardValidation.validateStep(1, {
          location: '',
          date: '',
          guests: '',
        });
        expect(result.valid).toBe(true);
      });

      it('should fail when an invalid date is provided', () => {
        const result = window.WizardValidation.validateStep(1, {
          date: '2000-01-01',
          location: '',
          guests: '',
        });
        expect(result.valid).toBe(false);
        expect(result.errors.date).toBeDefined();
      });

      it('should fail when guests is zero', () => {
        const result = window.WizardValidation.validateStep(1, {
          guests: '0',
          location: '',
          date: '',
        });
        expect(result.valid).toBe(false);
        expect(result.errors.guests).toBeDefined();
      });

      it('should pass with a valid location, future date, and positive guests', () => {
        const result = window.WizardValidation.validateStep(1, {
          location: 'London',
          date: '2099-12-31',
          guests: '50',
        });
        expect(result.valid).toBe(true);
      });
    });

    describe('other steps', () => {
      it('should always pass for steps > 1', () => {
        const result = window.WizardValidation.validateStep(5, {});
        expect(result.valid).toBe(true);
      });
    });
  });

  describe('canProceedFromStep', () => {
    it('should return false for step 0 when no event type is in WizardState', () => {
      // WizardState has no event type by default
      expect(window.WizardValidation.canProceedFromStep(0)).toBe(false);
    });

    it('should return true for step 0 after setting an event type', () => {
      window.WizardState.saveStep(0, { eventType: 'Wedding' });
      expect(window.WizardValidation.canProceedFromStep(0)).toBe(true);
    });

    it('should always return true for steps > 0', () => {
      expect(window.WizardValidation.canProceedFromStep(1)).toBe(true);
      expect(window.WizardValidation.canProceedFromStep(5)).toBe(true);
    });
  });
});
