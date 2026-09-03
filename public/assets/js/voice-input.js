/**
 * Voice Input for Notes (P3-21)
 * Uses Web Speech API for voice-to-text note-taking
 */

'use strict';
(function () {
  const isDevelopment =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  class VoiceInput {
    constructor() {
      // Check for browser support
      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

      if (!SpeechRecognition) {
        this.supported = false;
        console.warn('Speech Recognition API not supported in this browser');
        return;
      }

      this.supported = true;
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = 'en-GB'; // British English

      this.isListening = false;
      this.targetTextarea = null;
      this.finalTranscript = '';
      this.interimTranscript = '';
      this.restartAttempts = 0;
      this.maxRestartAttempts = 5; // Prevent infinite restart loops

      // Set up event handlers
      this.setupEventHandlers();
    }

    /**
     * Setup speech recognition event handlers
     */
    setupEventHandlers() {
      if (!this.recognition) {
        return;
      }

      this.recognition.onstart = () => {
        this.isListening = true;
        this.onStart();
      };

      this.recognition.onend = () => {
        this.isListening = false;
        this.onEnd();

        // Restart if we're supposed to be listening (with retry limit)
        if (this.shouldBeListening && this.restartAttempts < this.maxRestartAttempts) {
          this.restartAttempts++;
          setTimeout(() => {
            try {
              this.recognition.start();
            } catch (e) {
              console.debug('Could not restart recognition:', e);
              this.shouldBeListening = false;
            }
          }, 100);
        } else if (this.restartAttempts >= this.maxRestartAttempts) {
          console.warn('Max restart attempts reached, stopping voice input');
          this.shouldBeListening = false;
          this.onError('Voice recognition stopped after multiple failures');
        }
      };

      this.recognition.onerror = event => {
        console.debug('Speech recognition error:', event.error);

        // Handle specific errors
        if (event.error === 'not-allowed') {
          this.onError('Microphone access denied. Please allow microphone access.');
        } else if (event.error === 'no-speech') {
          // Ignore no-speech errors, they're normal
        } else {
          this.onError(`Speech recognition error: ${event.error}`);
        }
      };

      this.recognition.onresult = event => {
        this.interimTranscript = '';

        // Process all results
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = event.results[i][0].transcript;

          if (event.results[i].isFinal) {
            this.finalTranscript += `${transcript} `;
          } else {
            this.interimTranscript += transcript;
          }
        }

        // Update the textarea
        this.updateTextarea();
        this.onResult(this.finalTranscript, this.interimTranscript);
      };
    }

    /**
     * Start listening to voice input
     * @param {HTMLTextAreaElement} textarea - The textarea to update with transcription
     */
    start(textarea) {
      if (!this.supported) {
        this.onError('Voice input not supported in this browser');
        return;
      }

      if (this.isListening) {
        console.debug('Already listening');
        return;
      }

      this.targetTextarea = textarea;
      this.finalTranscript = textarea.value || '';
      this.interimTranscript = '';
      this.shouldBeListening = true;
      this.restartAttempts = 0; // Reset retry counter

      try {
        this.recognition.start();
      } catch (error) {
        console.error('Failed to start voice input:', error);
        this.onError('Failed to start voice input');
      }
    }

    /**
     * Stop listening to voice input
     */
    stop() {
      if (!this.supported) {
        return;
      }

      this.shouldBeListening = false;
      this.isListening = false;

      try {
        this.recognition.stop();
      } catch (error) {
        console.debug('Error stopping recognition:', error);
      }
    }

    /**
     * Update the target textarea with transcription
     */
    updateTextarea() {
      if (!this.targetTextarea) {
        return;
      }

      // Combine final and interim transcript
      const fullTranscript = this.finalTranscript + this.interimTranscript;
      this.targetTextarea.value = fullTranscript;

      // Trigger input event for any listeners
      const event = new Event('input', { bubbles: true });
      this.targetTextarea.dispatchEvent(event);
    }

    /**
     * Clear transcription and reset
     */
    clear() {
      this.finalTranscript = '';
      this.interimTranscript = '';
      if (this.targetTextarea) {
        this.targetTextarea.value = '';
      }
    }

    /**
     * Check if voice input is supported
     */
    isSupported() {
      return this.supported;
    }

    /**
     * Check if currently listening
     */
    isActive() {
      return this.isListening;
    }

    // Override these methods to handle events
    onStart() {
      if (isDevelopment) {
        console.log('Voice input started');
      }
    }

    onEnd() {
      if (isDevelopment) {
        console.log('Voice input ended');
      }
    }

    /**
     * Override this method to handle transcription results
     * @param {string} _finalTranscript - The final transcribed text (unused in base implementation)
     * @param {string} _interimTranscript - The interim transcribed text (unused in base implementation)
     */
    onResult(_finalTranscript, _interimTranscript) {
      // Override to handle results
    }

    onError(error) {
      console.error('Voice input error:', error);
    }
  }

  /**
   * Create a voice input button for a textarea
   * @param {HTMLTextAreaElement} textarea - The textarea to attach voice input to
   * @param {Object} options - Configuration options
   * @returns {HTMLButtonElement} The voice input button
   */
  function createVoiceInputButton(textarea, options = {}) {
    const {
      buttonClass = 'voice-input-button',
      listeningClass = 'listening',
      position = 'after', // 'before' or 'after' textarea
    } = options;

    // Create button
    const button = document.createElement('button');
    button.type = 'button';
    button.className = buttonClass;
    button.innerHTML = '🎤';
    button.title = 'Voice input';
    button.setAttribute('aria-label', 'Start voice input');

    // Create voice input instance
    const voiceInput = new VoiceInput();

    // Check support
    if (!voiceInput.isSupported()) {
      button.disabled = true;
      button.title = 'Voice input not supported in this browser';
      button.style.opacity = '0.5';
      button.style.cursor = 'not-allowed';
    }

    // Handle button click
    button.addEventListener('click', () => {
      if (!voiceInput.isSupported()) {
        return;
      }

      if (voiceInput.isActive()) {
        // Stop listening
        voiceInput.stop();
        button.classList.remove(listeningClass);
        button.innerHTML = '🎤';
        button.setAttribute('aria-label', 'Start voice input');
      } else {
        // Start listening
        voiceInput.start(textarea);
        button.classList.add(listeningClass);
        button.innerHTML = '⏹️';
        button.setAttribute('aria-label', 'Stop voice input');
      }
    });

    // Override event handlers
    voiceInput.onStart = () => {
      button.classList.add(listeningClass);
      button.innerHTML = '⏹️';
    };

    voiceInput.onEnd = () => {
      button.classList.remove(listeningClass);
      button.innerHTML = '🎤';
    };

    voiceInput.onError = error => {
      alert(error);
      button.classList.remove(listeningClass);
      button.innerHTML = '🎤';
    };

    // Insert button
    if (position === 'before') {
      textarea.parentNode.insertBefore(button, textarea);
    } else {
      textarea.parentNode.insertBefore(button, textarea.nextSibling);
    }

    return button;
  }

  // Export for use in other scripts
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { VoiceInput, createVoiceInputButton };
  }

  // Make available globally
  window.VoiceInput = VoiceInput;
  window.createVoiceInputButton = createVoiceInputButton;
})();
