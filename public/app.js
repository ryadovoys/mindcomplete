const ENABLE_WORD_FADE = true; // Enabled for Word Fade appearance as seen in motion lab

const CONFIG = {
  // Core settings
  DEBOUNCE_MS: 300,
  MIN_TEXT_LENGTH: 3,
  MOBILE_BREAKPOINT_PX: 768,
  DESKTOP_BREAKPOINT_PX: 1025,
  TOUCH_MOVE_THRESHOLD_PX: 5,

  // Timeouts
  TIMEOUT_FEEDBACK_MS: 800,
  TIMEOUT_MESSAGE_MS: 2000,
  AUTO_SAVE_DEBOUNCE_MS: 2000,
  SUPABASE_CHECK_INTERVAL_MS: 50,
  MENU_READY_DELAY_MS: 120,

  // Content limits
  TITLE_MAX_LENGTH: 30,
  TITLE_MIN_SPACE_POS: 10,
  FILE_SIZE_KB: 1024,
  FILE_SIZE_MB: 1024 * 1024,

  // Time thresholds (for relative dates)
  TIME_MINUTE_MS: 60000,
  TIME_HOUR_MS: 3600000,
  TIME_DAY_MS: 86400000,
  TIME_WEEK_MS: 604800000,

  // localStorage keys
  STORAGE_SESSION_ID: 'purplevalley_session_id',
  STORAGE_FILES: 'purplevalley_files',
  STORAGE_TOKENS: 'purplevalley_tokens',
  STORAGE_RULES: 'purplevalley_rules',
  STORAGE_STYLE: 'purplevalley_style',
  STORAGE_CUSTOM_STYLE: 'purplevalley_custom_style',

  // Prebuilt writing styles
  WRITING_STYLES: {
    social: "Write in a short, concise style suitable for social media platforms like Instagram and Twitter. Use emojis sparingly and focus on high engagement.",
    story: "Use a storytelling, explanatory, and descriptive style. Focus on narrative flow and vivid imagery.",
    ideation: "Focus on pushing boundaries, expanding ideas, and creative brainstorming. Be provocative and unconventional."
  },

  // API endpoints
  API_PREDICT: '/api/predict',
  API_CONTEXT: '/api/context',
  API_CONTEXT_RESTORE: '/api/context/restore',
  API_VALLEYS: '/api/valleys',
  API_AUTH_DELETE: '/api/auth/delete-account',
  API_GENERATE_IMAGE: '/api/generate-image',
};

class PredictionManager {
  constructor(options = {}) {
    console.log('PredictionManager: Initializing...');
    this.debounceMs = options.debounceMs || CONFIG.DEBOUNCE_MS;
    this.minTextLength = options.minTextLength || CONFIG.MIN_TEXT_LENGTH;
    this.debounceTimer = null;
    this.abortController = null;
    this.currentPrediction = '';
    this.navigationOffset = 0;
    this.hoverOffset = 0;

    // SELECT mode state
    this.selectModeActive = false;
    this.selectStartOffset = null;
    this.selectEndOffset = null;
    this.selectPreviewOffset = null;
    this.selectTouchActive = false;
    this.selectionReady = false;
    this.selectionFixed = false;
    this.hoverWordEnd = null;
    this.touchStartX = null;
    this.touchStartY = null;
    this.touchStartOffset = null;
    this.touchMoved = false;
    this.touchOnPrediction = false;
    this.isMobile = this.detectMobile();
    this.updateMobileBodyClass();

    this.editor = document.querySelector('.editor');
    if (!this.editor) {
      console.error('PredictionManager Error: .editor element not found in DOM!');
    } else {
      console.log('PredictionManager: Editor found.');
    }
    this.enableWordFade = ENABLE_WORD_FADE;
    this.lastStreamedText = ''; // Track already animated text to prevent flickers

    // Track caret locations so predictions can be anchored inline
    this.lastSelectionRange = null;
    this.predictionAnchorRange = null;
    this.selectionChangeHandler = () => this.onSelectionChange();
    document.addEventListener('selectionchange', this.selectionChangeHandler);
    window.addEventListener('beforeunload', () => {
      document.removeEventListener('selectionchange', this.selectionChangeHandler);
    });

    // Inline prediction element (will be created dynamically)
    this.inlinePredictionEl = null;

    // SELECT mode DOM elements
    this.selectConfirmBtn = null;
    this.enabled = true;

    this.init();
  }

  toggleEnabled() {
    this.enabled = !this.enabled;
    if (!this.enabled) {
      this.cancelPending();
      this.removeInlinePrediction();
    }
    return this.enabled;
  }

  detectMobile() {
    const userAgent = navigator.userAgent || navigator.vendor || window.opera;
    const isMobileUA = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent.toLowerCase());
    const matchesWidth = () => window.matchMedia(`(max-width: ${CONFIG.MOBILE_BREAKPOINT_PX}px)`).matches;
    const isMobileWidth = matchesWidth();

    window.addEventListener('resize', () => {
      const widthMatch = matchesWidth();
      this.isMobile = isMobileUA || widthMatch;
      this.updateMobileBodyClass();
    });

    return isMobileUA || isMobileWidth;
  }

  getEditorText() {
    if (!this.editor) return '';

    const parts = [];
    const walk = (node) => {
      if (!node || node === this.inlinePredictionEl) {
        return;
      }

      if (node.nodeType === Node.TEXT_NODE) {
        parts.push(node.textContent);
        return;
      }

      if (node.nodeName === 'BR') {
        parts.push('\n');
        return;
      }

      if (node.nodeType === Node.ELEMENT_NODE) {
        const isBlock = node !== this.editor && this.isBlockElement(node);
        Array.from(node.childNodes).forEach((child) => walk(child));
        if (isBlock) {
          parts.push('\n');
        }
      }
    };

    Array.from(this.editor.childNodes).forEach((child) => walk(child));
    return parts.join('').replace(/\n+$/, '');
  }

  isBlockElement(node) {
    if (!node || !node.nodeName) return false;
    return ['DIV', 'P'].includes(node.nodeName.toUpperCase());
  }

  onSelectionChange() {
    const range = this.getSelectionRangeWithinEditor();
    if (range) {
      this.lastSelectionRange = range;
    }
  }

  getSelectionRangeWithinEditor() {
    const selection = window.getSelection();
    if (!selection.rangeCount) return null;
    const range = selection.getRangeAt(0);
    if (!range.collapsed) return null;
    if (!this.isNodeInsideEditor(range.startContainer)) return null;
    return range.cloneRange();
  }

  saveCurrentSelection() {
    const range = this.getSelectionRangeWithinEditor();
    if (range) {
      this.lastSelectionRange = range;
    }
  }

  isNodeInsideEditor(node) {
    if (!node || !this.editor) return false;
    return node === this.editor || this.editor.contains(node);
  }

  createRangeAtEnd() {
    if (!this.editor) return null;
    const range = document.createRange();
    range.selectNodeContents(this.editor);
    range.collapse(false);
    return range;
  }

  preparePredictionAnchor() {
    const baseRange = this.lastSelectionRange
      ? this.lastSelectionRange.cloneRange()
      : this.createRangeAtEnd();

    if (!baseRange) return null;
    this.predictionAnchorRange = baseRange;
    return this.predictionAnchorRange;
  }

  refreshAnchorAfterPrediction() {
    if (!this.inlinePredictionEl || !this.editor.contains(this.inlinePredictionEl)) {
      this.predictionAnchorRange = null;
      return;
    }

    const range = document.createRange();
    range.setStartAfter(this.inlinePredictionEl);
    range.collapse(true);
    this.predictionAnchorRange = range;
  }

  updateMobileBodyClass() {
    if (!document.body) return;
    document.body.classList.toggle('mobile-touch', Boolean(this.isMobile));
  }

  init() {
    if (!this.editor) {
      console.warn('Editor element not found');
      return;
    }

    this.selectConfirmBtn = document.querySelector('.select-confirm-btn');

    // Handle input events
    this.editor.addEventListener('input', (e) => this.onInput(e));

    // Handle keydown for TAB acceptance
    this.editor.addEventListener('keydown', (e) => this.onKeyDown(e));

    // Track caret updates for accurate inline placement
    this.editor.addEventListener('mouseup', () => this.saveCurrentSelection());
    this.editor.addEventListener('keyup', () => this.saveCurrentSelection());

    // Handle touch events on editor (more reliable than on prediction element)
    this.editor.addEventListener('touchstart', (e) => this.onEditorTouchStart(e), { passive: false });
    this.editor.addEventListener('touchmove', (e) => this.onEditorTouchMove(e), { passive: false });
    this.editor.addEventListener('touchend', (e) => this.onEditorTouchEnd(e), { passive: false });
    this.editor.addEventListener('click', (e) => this.onEditorClick(e));

    // Focus editor on page load
    this.editor.focus();
    this.saveCurrentSelection();

    if (this.selectConfirmBtn) {
      this.selectConfirmBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.confirmSelectSelection();
      });
      this.selectConfirmBtn.disabled = true;
    }
  }

  onInput(e) {
    // Remove inline prediction when user types
    this.removeInlinePrediction();
    this.saveCurrentSelection();

    // Cancel any pending prediction
    this.cancelPending();

    if (!this.enabled) return;

    // Debounce prediction request - get FRESH text when timer fires
    this.debounceTimer = setTimeout(() => {
      const text = this.getEditorText();
      console.log(`Debounce finished. Text length: ${text.trim().length}, Min required: ${this.minTextLength}`);
      if (text.trim().length >= this.minTextLength) {
        console.log('Requesting prediction...');
        this.requestPrediction(text);
      }
    }, this.debounceMs);
  }

  onKeyDown(e) {
    if (e.key === 'Enter' && this.selectModeActive) {
      e.preventDefault();
      this.confirmSelectSelection();
      return;
    }

    if (e.key === 'Tab' && this.currentPrediction) {
      e.preventDefault();
      this.acceptPrediction();
    } else if (e.key === 'ArrowRight' && this.currentPrediction) {
      if (this.isCursorAtEnd() && this.navigationOffset < this.currentPrediction.length) {
        e.preventDefault();
        this.navigationOffset++;
        this.updatePredictionDisplay();
      }
    }
  }

  // Create or get inline prediction element
  createInlinePrediction() {
    if (!this.inlinePredictionEl) {
      this.inlinePredictionEl = document.createElement('span');
      this.inlinePredictionEl.className = 'inline-prediction';
      this.inlinePredictionEl.contentEditable = 'false';

      // Add pointer event listeners (for desktop hover/click)
      this.inlinePredictionEl.addEventListener('click', (e) => this.onPredictionClick(e));
      this.inlinePredictionEl.addEventListener('pointermove', (e) => this.onPredictionHover(e));
      this.inlinePredictionEl.addEventListener('pointerleave', () => this.onPredictionLeave());
      this.inlinePredictionEl.addEventListener('pointerup', (e) => this.onPredictionMouseUp(e));
      this.inlinePredictionEl.addEventListener('pointerdown', (e) => this.onPredictionMouseDown(e));
      // Touch events are now handled at editor level (onEditorTouchStart/Move/End)
    }
    return this.inlinePredictionEl;
  }

  // Insert inline prediction at the end of editor
  insertInlinePrediction() {
    if (!this.editor) {
      console.error('Cannot insert prediction: editor element not found');
      return;
    }
    const prediction = this.createInlinePrediction();
    if (!this.editor.contains(prediction)) {
      const anchor = this.predictionAnchorRange
        ? this.predictionAnchorRange.cloneRange()
        : this.preparePredictionAnchor() || this.createRangeAtEnd();

      if (!anchor) return;
      anchor.collapse(true);
      anchor.insertNode(prediction);
    }
    this.refreshAnchorAfterPrediction();
  }

  // Remove inline prediction from editor
  removeInlinePrediction() {
    if (this.inlinePredictionEl && this.editor.contains(this.inlinePredictionEl)) {
      this.inlinePredictionEl.remove();
    }
    this.currentPrediction = '';
    this.navigationOffset = 0;
    this.hoverOffset = 0;
    this.predictionAnchorRange = null;
    this.touchOnPrediction = false;
  }

  onPredictionHover(e) {
    if (e && e.pointerType && e.pointerType !== 'mouse') return;
    if (this.selectModeActive) {
      if (!this.isMobile && !this.selectionFixed) {
        const offset = this.getOffsetFromMouseEvent(e);
        if (offset !== null) {
          const wordBounds = this.getWordBoundaries(offset);
          if (wordBounds) {
            if (this.selectStartOffset === null) {
              this.selectPreviewOffset = wordBounds.start;
              this.hoverWordEnd = wordBounds.end;
            } else {
              this.hoverWordEnd = null;
              this.updateSelectPreviewOffset(wordBounds);
            }
            this.hoverOffset = 0;
            this.navigationOffset = 0;
            this.updatePredictionDisplay();
          }
        }
      }
      return;
    } else {
      const offset = this.getOffsetFromMouseEvent(e);
      if (offset !== null) {
        const wordBounds = this.getWordBoundaries(offset);
        if (wordBounds) {
          this.hoverOffset = wordBounds.end;
        } else {
          this.hoverOffset = offset;
        }
        this.updatePredictionDisplay();
      }
    }
  }

  onPredictionLeave() {
    if (this.selectModeActive) {
      this.hoverOffset = 0;
      this.navigationOffset = 0;
      if (this.selectStartOffset === null) {
        this.selectPreviewOffset = null;
        this.hoverWordEnd = null;
      }
      this.updatePredictionDisplay();
    } else {
      this.hoverOffset = 0;
      this.updatePredictionDisplay();
    }
  }

  onPredictionClick(e) {
    // Click handling is done in mouse/touch events
  }

  onPredictionMouseDown(e) {
    if ((e.pointerType && e.pointerType !== 'mouse') || this.isMobile || e.button !== 0) return;
    if (!this.selectModeActive) return;
    e.preventDefault();
  }

  onPredictionMouseUp(e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;

    if (!this.isMobile && this.selectModeActive) {
      const offset = this.getOffsetFromMouseEvent(e);
      if (offset === null) return;

      const wordBounds = this.getWordBoundaries(offset);
      if (!wordBounds) return;

      if (this.selectStartOffset === null) {
        this.selectStartOffset = wordBounds.start;
        this.selectPreviewOffset = wordBounds.end;
        this.hoverWordEnd = null;
        this.selectionFixed = false;
        this.updatePredictionDisplay();
        this.setSelectionReady(true);
      } else if (!this.selectionFixed) {
        if (wordBounds.end <= this.selectStartOffset) {
          this.selectPreviewOffset = this.selectStartOffset;
          this.selectStartOffset = wordBounds.start;
        } else {
          this.selectPreviewOffset = wordBounds.end;
        }
        this.selectionFixed = true;
        this.updatePredictionDisplay();
        this.setSelectionReady(this.selectStartOffset !== this.selectPreviewOffset);
      }
      return;
    }

    if (this.selectModeActive) {
      const offset = this.getOffsetFromMouseEvent(e);
      this.handleSelectModeSelection(offset);
      return;
    }

    // Normal mode - word-based selection
    const selection = window.getSelection();
    const selectedText = selection.toString();

    if (selectedText.length > 0) {
      this.acceptSelectedText(selection);
    } else {
      const offset = this.getOffsetFromMouseEvent(e);
      if (offset !== null) {
        const wordBounds = this.getWordBoundaries(offset);
        if (wordBounds) {
          this.hoverOffset = wordBounds.end;
        } else {
          this.hoverOffset = offset;
        }
        this.navigationOffset = 0;
        this.acceptPrediction();
      }
    }
  }

  onEditorClick(e) {
    if (!this.isMobile || this.selectModeActive) return;

    if (this.isPointWithinPrediction(e.clientX, e.clientY)) {
      const offset = this.getOffsetFromMouseEvent(e);
      if (offset !== null) {
        const wordBounds = this.getWordBoundaries(offset);
        if (wordBounds) {
          this.hoverOffset = wordBounds.end;
        } else {
          this.hoverOffset = offset;
        }
        this.navigationOffset = 0;
        this.acceptPrediction();
      }
    }
  }

  // Editor-level touch handlers (more reliable)
  onEditorTouchStart(e) {
    if (!this.isMobile || !e.touches || !e.touches.length) return;

    // Normal mode relies on native click events to distinguish tap vs swipe
    if (!this.selectModeActive) return;

    if (!this.currentPrediction) return;

    const touch = e.touches[0];
    const x = touch.clientX;
    const y = touch.clientY;

    const withinPrediction = this.isPointWithinPrediction(x, y);

    if (!withinPrediction) {
      this.touchOnPrediction = false;
      return;
    }

    const offsetAtStart = this.getOffsetFromPoint(x, y);

    if (offsetAtStart === null) {
      this.touchOnPrediction = false;
      return;
    }

    this.touchStartX = x;
    this.touchStartY = y;
    this.touchStartOffset = offsetAtStart;
    this.touchMoved = false;
    this.touchOnPrediction = true;

    // Normal mode: let TouchEnd handle logic to distinguish tap vs swipe
    if (!this.selectModeActive) {
      return;
    }

    if (this.selectModeActive) {
      e.preventDefault();
      const wordBounds = this.getWordBoundaries(offsetAtStart);
      if (!wordBounds) return;

      // Tap cycle: 1st tap = start, 2nd tap = end, 3rd tap = reset & new start
      if (this.selectStartOffset === null) {
        // First tap: set start point
        this.selectStartOffset = wordBounds.start;
        this.selectPreviewOffset = wordBounds.end;
        this.selectionFixed = false;
        this.updatePredictionDisplay();
        this.setSelectionReady(false);
      } else if (!this.selectionFixed) {
        // Second tap: set end point, fix selection
        this.updateSelectPreviewOffset(wordBounds);
        this.selectionFixed = true;
        this.updatePredictionDisplay();
        this.setSelectionReady(true);
      } else {
        // Third tap: reset and start fresh
        this.selectStartOffset = wordBounds.start;
        this.selectPreviewOffset = wordBounds.end;
        this.selectionFixed = false;
        this.updatePredictionDisplay();
        this.setSelectionReady(false);
      }
    }
  }

  onEditorTouchMove(e) {
    if (!this.touchOnPrediction) {
      return;
    }
    if (!e.touches || !e.touches.length) return;

    const touch = e.touches[0];
    const deltaX = Math.abs(touch.clientX - this.touchStartX);
    const deltaY = Math.abs(touch.clientY - this.touchStartY);

    if (deltaX > CONFIG.TOUCH_MOVE_THRESHOLD_PX || deltaY > CONFIG.TOUCH_MOVE_THRESHOLD_PX) {
      this.touchMoved = true;
    }

    if (this.selectModeActive && this.selectTouchActive) {
      e.preventDefault();
      const offset = this.getOffsetFromPoint(touch.clientX, touch.clientY);
      if (offset === null) return;
      const wordBounds = this.getWordBoundaries(offset);
      if (!wordBounds) return;

      this.updateSelectPreviewOffset(wordBounds);
      this.updatePredictionDisplay();
      this.setSelectionReady(this.selectStartOffset !== this.selectPreviewOffset);
    }
  }

  onEditorTouchEnd(e) {
    if (!this.touchOnPrediction) {
      return;
    }

    // Save touchStart coords before reset (more accurate for tap detection on mobile)
    const startOffset = this.touchStartOffset;

    const touch = e.changedTouches?.[0];
    if (!touch) {
      return;
    }

    const coords = { x: touch.clientX, y: touch.clientY };
    const gestureMoved = this.touchMoved;

    // Reset state
    this.touchStartX = null;
    this.touchStartY = null;
    this.touchStartOffset = null;
    this.touchMoved = false;
    this.touchOnPrediction = false;

    e.preventDefault();
    e.stopPropagation();

    // Select mode with drag
    if (this.selectModeActive && this.selectTouchActive) {
      const offset = this.getOffsetFromPoint(coords.x, coords.y);
      this.selectTouchActive = false;

      if (offset !== null) {
        const wordBounds = this.getWordBoundaries(offset);
        if (wordBounds) {
          this.updateSelectPreviewOffset(wordBounds);
        }
      }
      this.updatePredictionDisplay();
      this.setSelectionReady(this.selectStartOffset !== this.selectPreviewOffset);
      return;
    }

    // Select mode tap
    if (this.selectModeActive) {
      const offset = this.getOffsetFromPoint(coords.x, coords.y);
      this.handleSelectModeSelection(offset);
      return;
    }

    // Normal mode - ignore if finger moved
    if (gestureMoved) {
      return;
    }

    // Normal mode - use saved offset from touchStart (most reliable)
    // This fixes the bug where touchend coordinates drift or map to wrong range
    const offset = startOffset;

    if (offset !== null) {
      const wordBounds = this.getWordBoundaries(offset);
      if (wordBounds) {
        this.hoverOffset = wordBounds.end;
      } else {
        this.hoverOffset = offset;
      }
      this.navigationOffset = 0;
      this.acceptPrediction();
    }
  }

  getOffsetFromMouseEvent(e) {
    return this.getOffsetFromPoint(e.clientX, e.clientY);
  }

  getOffsetFromPoint(x, y) {
    const range = this.createRangeFromPoint(x, y);
    const precise = this.getOffsetFromRange(range);
    if (precise !== null) {
      return precise;
    }
    return this.approximateOffsetFromPoint(x, y);
  }

  isPointWithinPrediction(x, y) {
    if (!this.inlinePredictionEl) return false;
    const range = document.createRange();
    range.selectNodeContents(this.inlinePredictionEl);
    const rects = Array.from(range.getClientRects());
    range.detach?.();
    return rects.some((rect) =>
      x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
    );
  }

  createRangeFromPoint(x, y) {
    if (typeof x !== 'number' || typeof y !== 'number') return null;

    if (document.caretRangeFromPoint) {
      return document.caretRangeFromPoint(x, y);
    }

    if (document.caretPositionFromPoint) {
      const pos = document.caretPositionFromPoint(x, y);
      if (!pos) return null;
      const range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.collapse(true);
      return range;
    }

    return null;
  }

  approximateOffsetFromPoint(x, y) {
    if (!this.inlinePredictionEl || !this.currentPrediction) return null;

    const textNodes = this.getTextNodesIn(this.inlinePredictionEl);
    if (!textNodes.length) return null;

    let totalOffset = 0;
    let closestOffset = 0;
    let closestDistance = Infinity;

    const point = { x, y };

    textNodes.forEach((textNode) => {
      const text = textNode.textContent;
      const length = text.length;
      const probeRange = document.createRange();

      for (let i = 0; i <= length; i++) {
        probeRange.setStart(textNode, i);
        probeRange.setEnd(textNode, i);
        const rect = probeRange.getBoundingClientRect();
        if (!rect || (rect.width === 0 && rect.height === 0)) {
          continue;
        }

        const centerX = rect.left + rect.width / 2;
        const centerY = rect.top + rect.height / 2;
        const dx = point.x - centerX;
        const dy = point.y - centerY;
        const distance = Math.sqrt((dx * dx) + (dy * dy));

        if (distance < closestDistance) {
          closestDistance = distance;
          closestOffset = totalOffset + i;
        }
      }

      totalOffset += length;
      probeRange.detach?.();
    });

    return Math.max(0, Math.min(closestOffset, this.currentPrediction.length));
  }

  getTextNodesIn(node) {
    const nodes = [];
    const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT, null, false);
    let current;
    while ((current = walker.nextNode())) {
      nodes.push(current);
    }
    return nodes;
  }

  getOffsetFromRange(range) {
    if (!range || !this.inlinePredictionEl) return null;

    const container = range.startContainer;

    // Check if the click is within our inline prediction
    if (!this.inlinePredictionEl.contains(container) && container !== this.inlinePredictionEl) {
      return null;
    }

    // Calculate offset within the prediction text
    try {
      const clone = range.cloneRange();
      clone.setStart(this.inlinePredictionEl, 0);
      const offset = clone.toString().length;
      return Math.max(0, Math.min(offset, this.currentPrediction.length));
    } catch (e) {
      return null;
    }
  }

  getWordBoundaries(offset) {
    if (!this.currentPrediction || offset < 0 || offset > this.currentPrediction.length) {
      return null;
    }

    const text = this.currentPrediction;

    let wordStart = offset;
    while (wordStart > 0 && !/\s/.test(text[wordStart - 1])) {
      wordStart--;
    }

    let wordEnd = offset;
    while (wordEnd < text.length && !/\s/.test(text[wordEnd])) {
      wordEnd++;
    }

    return { start: wordStart, end: wordEnd };
  }

  // Helper to update selectPreviewOffset based on word boundaries
  updateSelectPreviewOffset(wordBounds) {
    if (wordBounds.end <= this.selectStartOffset) {
      this.selectPreviewOffset = wordBounds.start;
    } else {
      this.selectPreviewOffset = wordBounds.end;
    }
  }

  isCursorAtEnd() {
    const selection = window.getSelection();
    if (!selection.rangeCount) return false;
    if (!this.inlinePredictionEl || !this.editor.contains(this.inlinePredictionEl)) return false;

    const range = selection.getRangeAt(0);
    if (!range.collapsed) return false;

    try {
      return range.comparePoint(this.inlinePredictionEl, 0) === 0;
    } catch (err) {
      return false;
    }
  }

  cancelPending() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  async requestPrediction(text) {
    this.abortController = new AbortController();
    this.preparePredictionAnchor();

    try {
      const response = await fetch(CONFIG.API_PREDICT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          sessionId: window.contextManager?.getSessionId(),
          anchorIds: window.brainManager?.getAnchorIds(),
          rules: window.contextManager?.getRulesText(),
          writingStyle: window.contextManager?.getWritingStyleText()
        }),
        signal: this.abortController.signal
      });

      if (!response.ok) {
        console.error(`Prediction request failed with status: ${response.status}`);
        throw new Error('Prediction request failed');
      }

      await this.handleStreamingResponse(response);
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('Prediction error details:', error);
      }
    }
  }

  async handleStreamingResponse(response) {
    console.log('Starting to handle streaming response...');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let prediction = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          console.log('Stream done.');
          break;
        }

        const chunk = decoder.decode(value, { stream: true });
        console.log('Received chunk:', chunk);
        const lines = chunk.split('\n');

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') continue;

            try {
              const parsed = JSON.parse(data);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                prediction += content;
                this.updatePrediction(prediction);
              }
            } catch (e) {
              // Ignore JSON parse errors for incomplete chunks
            }
          }
        }
      }
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('Stream error:', error);
      }
    }
  }

  updatePrediction(text) {
    this.currentPrediction = text;
    this.navigationOffset = 0;
    this.hoverOffset = 0;
    this.selectPreviewOffset = null;
    if (!this.selectModeActive) {
      this.selectStartOffset = null;
    }

    this.insertInlinePrediction();
    // Pass true to indicate this is a streaming update (allow animations)
    this.updatePredictionDisplay(true);
  }

  updatePredictionDisplay(isStreamingUpdate = false) {
    if (!this.inlinePredictionEl || !this.currentPrediction) return;

    if (!isStreamingUpdate) {
      // For hover/interaction, we always redraw everything static to ensure correct segment classes
      this.fullRedraw();
      return;
    }

    // Determine segments for streaming (usually just remainPart)
    // We only support incremental animation for the standard 'remain' state
    const activeOffset = this.hoverOffset || this.navigationOffset;
    if (activeOffset > 0 || this.selectModeActive) {
      this.fullRedraw();
      return;
    }

    this.incrementalStreamDisplay(this.currentPrediction);
  }

  fullRedraw() {
    if (!this.inlinePredictionEl) return;
    this.inlinePredictionEl.innerHTML = '';
    this.lastStreamedText = '';

    let prePart = '';
    let acceptPart = '';
    let remainPart = '';

    if (this.selectModeActive) {
      if (this.selectStartOffset === null && this.selectPreviewOffset !== null && this.hoverWordEnd !== null) {
        prePart = this.currentPrediction.slice(0, this.selectPreviewOffset);
        acceptPart = this.currentPrediction.slice(this.selectPreviewOffset, this.hoverWordEnd);
        remainPart = this.currentPrediction.slice(this.hoverWordEnd);
      } else if (this.selectStartOffset !== null && this.selectPreviewOffset !== null) {
        const start = Math.min(this.selectStartOffset, this.selectPreviewOffset);
        const end = Math.max(this.selectStartOffset, this.selectPreviewOffset);
        if (start !== end) {
          prePart = this.currentPrediction.slice(0, start);
          acceptPart = this.currentPrediction.slice(start, end);
          remainPart = this.currentPrediction.slice(end);
        } else {
          remainPart = this.currentPrediction;
        }
      } else {
        remainPart = this.currentPrediction;
      }
    } else {
      const activeOffset = this.hoverOffset || this.navigationOffset;
      if (activeOffset === 0) {
        remainPart = this.currentPrediction;
      } else {
        acceptPart = this.currentPrediction.slice(0, activeOffset);
        remainPart = this.currentPrediction.slice(activeOffset);
      }
    }

    const append = (text, className) => {
      if (!text) return;
      const span = document.createElement('span');
      span.className = className;
      span.textContent = text;
      this.inlinePredictionEl.appendChild(span);
    };

    append(prePart, 'prediction-remain');
    append(acceptPart, 'prediction-accept');
    append(remainPart, 'prediction-remain');

    this.lastStreamedText = this.currentPrediction;
  }

  incrementalStreamDisplay(targetText) {
    if (!this.inlinePredictionEl) return;

    // If text doesn't extend what we have, or container was cleared, do a full reset
    if (!targetText.startsWith(this.lastStreamedText) || this.inlinePredictionEl.innerHTML === '') {
      this.inlinePredictionEl.innerHTML = '';
      this.lastStreamedText = '';
    }

    const newSegment = targetText.slice(this.lastStreamedText.length);
    if (!newSegment) return;

    // Split by character for letter-by-letter appearance
    const letters = newSegment.split('');
    letters.forEach((char, index) => {
      if (char === ' ') {
        this.inlinePredictionEl.appendChild(document.createTextNode(' '));
      } else {
        const span = document.createElement('span');
        span.textContent = char;
        span.className = 'word-fade prediction-remain';
        if (this.enableWordFade) {
          // Faster stagger for letters: 20ms
          span.style.animationDelay = `${index * 0.02}s`;
        }
        this.inlinePredictionEl.appendChild(span);
      }
    });

    this.lastStreamedText = targetText;
  }



  normalizeAcceptedText(text) {
    let output = text;

    if (output && !output.endsWith(' ')) {
      output += ' ';
    }

    return output;
  }

  insertAcceptedNodes(text) {
    if (!this.inlinePredictionEl) return null;
    const parent = this.inlinePredictionEl.parentNode;
    let lastNode = null;

    if (text) {
      lastNode = document.createTextNode(text);
      parent.insertBefore(lastNode, this.inlinePredictionEl);
    }

    return lastNode;
  }

  placeCursorAfterNode(node) {
    if (!node) return;
    const range = document.createRange();
    const selection = window.getSelection();

    if (node.nodeType === Node.TEXT_NODE) {
      range.setStart(node, node.textContent.length);
    } else {
      range.setStartAfter(node);
    }
    range.collapse(true);

    selection.removeAllRanges();
    selection.addRange(range);
    this.lastSelectionRange = range.cloneRange();
  }

  dispatchSyntheticInput() {
    const event = new Event('input', { bubbles: true });
    this.editor.dispatchEvent(event);
  }

  commitAcceptance(startOffset, endOffset) {
    if (!this.currentPrediction || startOffset === endOffset || !this.inlinePredictionEl) return;

    const safeStart = Math.max(0, Math.min(startOffset, endOffset));
    let safeEnd = Math.max(safeStart, Math.min(endOffset, this.currentPrediction.length));

    // Greedily consume a following space from the prediction if available
    // and we aren't already at the end
    if (safeEnd < this.currentPrediction.length && this.currentPrediction[safeEnd] === ' ') {
      safeEnd++;
    }

    if (safeStart === safeEnd) return;

    const textToAccept = this.currentPrediction.slice(safeStart, safeEnd);
    const remainingPrediction = safeEnd < this.currentPrediction.length
      ? this.currentPrediction.slice(safeEnd)
      : '';

    const normalizedText = this.normalizeAcceptedText(textToAccept);
    const caretNode = this.insertAcceptedNodes(normalizedText);
    if (caretNode) {
      this.placeCursorAfterNode(caretNode);
    }

    if (remainingPrediction) {
      this.currentPrediction = remainingPrediction;
      this.navigationOffset = 0;
      this.hoverOffset = 0;
      this.updatePredictionDisplay();
      this.refreshAnchorAfterPrediction();
    } else {
      this.removeInlinePrediction();
      this.dispatchSyntheticInput();
    }
  }

  acceptSelectedText(selection) {
    if (!this.currentPrediction || !selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    const startOffset = this.getOffsetFromRange(range);
    if (startOffset === null) return;

    const cloned = range.cloneRange();
    cloned.collapse(true);
    cloned.setEnd(range.endContainer, range.endOffset);
    const selectedTextLength = cloned.toString().length;
    const endOffset = startOffset + selectedTextLength;
    this.commitAcceptance(startOffset, endOffset);
    selection.removeAllRanges();
  }

  acceptPrediction() {
    if (!this.currentPrediction) {
      return;
    }

    const activeOffset = this.hoverOffset || this.navigationOffset;
    const endOffset = activeOffset > 0 && activeOffset <= this.currentPrediction.length
      ? activeOffset
      : this.currentPrediction.length;

    this.commitAcceptance(0, endOffset);
  }

  // SELECT MODE METHODS

  enableSelectMode() {
    this.selectModeActive = true;
    this.selectStartOffset = null;
    this.selectEndOffset = null;
    this.selectPreviewOffset = null;
    this.selectTouchActive = false;
    this.selectionFixed = false;
    this.setSelectionReady(false);

    document.body.classList.add('select-mode-active');

    this.hoverOffset = 0;
    this.navigationOffset = 0;
    this.updatePredictionDisplay();

    const selectBtn = document.querySelector('.select-menu-btn');
    if (selectBtn) selectBtn.classList.add('active');

    const settingsIcon = document.querySelector('#settings-btn .material-symbols-outlined');
    if (settingsIcon) settingsIcon.textContent = 'close';
  }

  disableSelectMode() {
    this.selectModeActive = false;
    this.selectStartOffset = null;
    this.selectEndOffset = null;
    this.selectPreviewOffset = null;
    this.selectTouchActive = false;
    this.selectionFixed = false;
    this.setSelectionReady(false);

    document.body.classList.remove('select-mode-active');

    this.hoverOffset = 0;
    this.navigationOffset = 0;
    this.updatePredictionDisplay();

    const selectBtn = document.querySelector('.select-menu-btn');
    if (selectBtn) {
      selectBtn.classList.remove('active');
      const icon = selectBtn.querySelector('.material-symbols-outlined');
      if (icon) icon.textContent = 'text_select_end';
    }

    const settingsIcon = document.querySelector('#settings-btn .material-symbols-outlined');
    if (settingsIcon) settingsIcon.textContent = 'more_horiz';
  }

  handleSelectModeSelection(offset) {
    if (offset === null) return;

    if (this.selectStartOffset === null) {
      this.selectStartOffset = offset;
      this.selectPreviewOffset = this.isMobile ? offset : null;
      this.updatePredictionDisplay();
      this.setSelectionReady(false);
    } else {
      this.selectPreviewOffset = offset;
      this.updatePredictionDisplay();
      this.setSelectionReady(this.selectStartOffset !== null && this.selectPreviewOffset !== null && this.selectPreviewOffset !== this.selectStartOffset);
    }
  }

  confirmSelectSelection() {
    if (!this.selectModeActive) return;

    // If we have a valid range, accept it
    if (this.selectStartOffset !== null && this.selectPreviewOffset !== null && this.selectPreviewOffset !== this.selectStartOffset) {
      const start = Math.min(this.selectStartOffset, this.selectPreviewOffset);
      const end = Math.max(this.selectStartOffset, this.selectPreviewOffset);
      this.acceptSelectModeRange(start, end);
    }

    // Always disable mode after "confirming"
    this.disableSelectMode();
  }

  setSelectionReady(isReady) {
    const ready = isReady && this.selectModeActive;
    this.selectionReady = ready;
    if (ready) {
      document.body.classList.add('selection-ready');
    } else {
      document.body.classList.remove('selection-ready');
    }

    // Trigger UI update if function exists (it's defined later in app.js)
    if (typeof window.updateSelectButtons === 'function') {
      window.updateSelectButtons();
    }

    if (this.selectConfirmBtn) {
      this.selectConfirmBtn.disabled = !ready;
    }
  }

  acceptSelectModeRange(startOffset, endOffset) {
    if (!this.currentPrediction) return;
    this.commitAcceptance(startOffset, endOffset);
  }
}

// ===========================================
// BRAIN MANAGER - Unified Context Management
// ===========================================
class BrainManager {
  constructor() {
    this.anchors = [];
    this.pendingAttachment = null;
    this.isLoading = false;

    // UI Elements
    this.brainPanel = document.querySelector('.brain-panel');
    this.brainContent = document.querySelector('.brain-content');
    this.brainInputArea = document.querySelector('.brain-input-area');

    // Fallback or specific selectors
    this.inputText = document.querySelector('.brain-textarea');
    this.attachBtn = document.querySelector('.brain-attach-btn');
    this.sendBtn = document.querySelector('.brain-send-btn');
    this.attachmentPreview = document.querySelector('.brain-attachment-preview');
    this.fileInput = document.getElementById('context-file-input');

    // Bind methods
    this.handleFileSelect = this.handleFileSelect.bind(this);
    this.handleSend = this.handleSend.bind(this);
    this.removeAnchor = this.removeAnchor.bind(this);
    this.handleResizeStart = this.handleResizeStart.bind(this);
    this.handleResizeMove = this.handleResizeMove.bind(this);
    this.handleResizeEnd = this.handleResizeEnd.bind(this);

    this.init();
  }

  init() {
    // Attach global access
    window.brainManager = this;

    // Initialize Resizer
    this.initResizer();

    if (!this.brainPanel) return;

    // Listeners
    this.attachBtn?.addEventListener('click', () => this.fileInput?.click());
    this.fileInput?.addEventListener('change', (e) => this.handleFileSelect(e.target.files[0]));

    this.sendBtn?.addEventListener('click', this.handleSend);
    this.inputText?.addEventListener('keydown', (e) => {
      // Allow Shift+Enter for newline, Enter for send
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
      }
    });

    // Auto-resize textarea
    this.inputText?.addEventListener('input', () => {
      this.inputText.style.height = 'auto';
      this.inputText.style.height = (this.inputText.scrollHeight) + 'px';
    });

    // Initial Load
    this.loadAnchors();
  }

  async loadAnchors() {
    try {
      this.setLoading(true);
      // Auth handling: try to get session from supabase if available
      let headers = { 'Content-Type': 'application/json' };

      if (window.supabase) {
        const { data: { session } } = await window.supabase.auth.getSession();
        if (session) {
          headers['Authorization'] = `Bearer ${session.access_token}`;
        }
      }

      const response = await fetch('/api/context-anchor', { headers });
      if (response.ok) {
        const data = await response.json();
        // API returns array if listing, or single object if ID passed (but we didn't pass ID)
        this.anchors = Array.isArray(data) ? data : (data ? [data] : []);
        this.renderAnchors();
      } else {
        console.warn('[BrainManager] Failed to load anchors', response.status);
        // If 401, maybe clear anchors
        if (response.status === 401) {
          this.anchors = [];
          this.renderAnchors();
        }
      }
    } catch (error) {
      console.error('[BrainManager] Load anchors error:', error);
    } finally {
      this.setLoading(false);
    }
  }

  renderAnchors() {
    if (!this.brainContent) return;

    if (this.anchors.length === 0) {
      this.brainContent.innerHTML = `
        <div class="brain-empty-state">
          <span class="material-symbols-outlined">psychology</span>
          <p>Add context to help the AI understand your project.</p>
        </div>
      `;
      return;
    }

    this.brainContent.innerHTML = this.anchors.map(anchor => {
      // items details
      const items = anchor.items || [];
      const imageCount = items.filter(i => i.type === 'image' || (i.type === 'text' && i.source === 'image_analysis')).length;
      const urlCount = items.filter(i => i.type === 'url').length;
      const fileCount = items.filter(i => i.type === 'file').length;

      let metaText = [];
      if (imageCount) metaText.push(`${imageCount} Image${imageCount > 1 ? 's' : ''}`);
      if (urlCount) metaText.push(`${urlCount} URL${urlCount > 1 ? 's' : ''}`);
      if (fileCount) metaText.push(`${fileCount} File${fileCount > 1 ? 's' : ''}`);

      const metaString = metaText.join(' • ');

      return `
        <div class="brain-anchor-card" data-id="${anchor.id}">
          <div class="brain-anchor-header">
            <div class="brain-anchor-title">
              <span class="material-symbols-outlined">lightbulb</span>
              <span>Context Anchor</span>
            </div>
            <div class="brain-anchor-actions">
               <button class="anchor-action-btn delete" onclick="window.brainManager.removeAnchor('${anchor.id}')" title="Delete Anchor">
                <span class="material-symbols-outlined">delete</span>
              </button>
            </div>
          </div>
          <div class="brain-anchor-summary">${this.escapeHtml(anchor.summary || 'No summary available')}</div>
          ${metaString ? `<div class="context-item-meta" style="margin-top:8px">${metaString}</div>` : ''}
        </div>
      `;
    }).join('');
  }

  handleFileSelect(file) {
    if (!file) return;
    this.pendingAttachment = file;
    this.renderAttachmentPreview();
    this.inputText?.focus();
  }

  renderAttachmentPreview() {
    if (!this.attachmentPreview) return;

    if (!this.pendingAttachment) {
      this.attachmentPreview.innerHTML = '';
      this.attachmentPreview.style.display = 'none';
      return;
    }

    const name = this.pendingAttachment.name || 'Attachment';
    const isImage = this.pendingAttachment.type?.startsWith('image/');
    const icon = isImage ? 'image' : 'description';

    this.attachmentPreview.style.display = 'flex';
    this.attachmentPreview.innerHTML = `
      <div class="attachment-chip">
        <span class="material-symbols-outlined">${icon}</span>
        <span class="attachment-name">${name}</span>
        <button class="btn-icon-small" onclick="window.brainManager.clearAttachment()">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
    `;
  }

  clearAttachment() {
    this.pendingAttachment = null;
    this.fileInput.value = '';
    this.renderAttachmentPreview();
  }

  async handleSend() {
    const text = this.inputText?.value.trim();
    const attachment = this.pendingAttachment;

    if (!text && !attachment) return;

    this.setLoading(true);

    try {
      let analysisResult = '';
      let contextItems = [];

      // 1. Process Attachment
      if (attachment) {
        if (attachment.type && attachment.type.startsWith('image/')) {
          // Image Analysis (Unified Endpoint)
          const result = await this.analyzeImage(attachment, 'Describe this image in detail.');
          analysisResult = result.description;

          contextItems.push({
            type: 'text',
            source: 'image_analysis',
            content: analysisResult,
            meta: {
              imageName: attachment.name
            }
          });

          // If there was a user prompt, add it as a separate instructions item
          if (text) {
            contextItems.push({
              type: 'instruction',
              content: text
            });
          }
        } else if (attachment.type === 'text/plain' || attachment.name.endsWith('.md') || attachment.name.endsWith('.txt')) {
          // Text File
          const content = await this.readTextFile(attachment);
          contextItems.push({
            type: 'file',
            name: attachment.name,
            content: content
          });
          if (text) {
            contextItems.push({
              type: 'instruction',
              content: text
            });
          }
        }
      } else if (text) {
        // Check if text contains a URL
        const urlMatch = text.match(/https?:\/\/[^\s]+/);

        if (urlMatch) {
          const url = urlMatch[0];
          const userComment = text.replace(url, '').trim();

          // Scrape the URL
          console.log('[BrainManager] Detected URL, scraping:', url);
          const scrapeResult = await this.scrapeUrl(url);

          if (scrapeResult) {
            contextItems.push({
              type: 'url',
              source: 'scraped_url',
              content: scrapeResult.content,
              meta: {
                title: scrapeResult.title,
                description: scrapeResult.description,
                url: url
              }
            });

            // If user added comments alongside the URL, add as instruction
            if (userComment) {
              contextItems.push({
                type: 'instruction',
                content: userComment
              });
            }
          }
        } else {
          // Plain text instruction (no URL)
          contextItems.push({
            type: 'instruction',
            content: text
          });
        }
      }

      // 2. Create Anchor via API
      let headers = { 'Content-Type': 'application/json' };
      if (window.supabase) {
        const { data: { session } } = await window.supabase.auth.getSession();
        if (session) headers['Authorization'] = `Bearer ${session.access_token}`;
      }

      const response = await fetch('/api/context-anchor', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          items: contextItems,
          // We assume 'synthesizeContextAnchor' handles generating the summary from these items
        })
      });

      if (!response.ok) throw new Error('Failed to create anchor');

      // 3. Reset UI
      if (this.inputText) {
        this.inputText.value = '';
        this.inputText.style.height = 'auto';
      }
      this.clearAttachment();

      // 4. Reload anchors
      await this.loadAnchors();

    } catch (error) {
      console.error('[BrainManager] Send error:', error);
      alert('Failed: ' + error.message);
    } finally {
      this.setLoading(false);
    }
  }

  async analyzeImage(file, prompt) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const base64Data = e.target.result.split(',')[1];
          const response = await fetch('/api/process-input', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              type: 'image',
              imageData: base64Data,
              mimeType: file.type,
              prompt: prompt
            })
          });

          if (!response.ok) throw new Error('Image analysis failed');
          const data = await response.json();
          resolve(data);
        } catch (err) {
          reject(err);
        }
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async readTextFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsText(file);
    });
  }

  async scrapeUrl(url) {
    try {
      const response = await fetch('/api/process-input', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'url',
          url: url
        })
      });

      if (!response.ok) {
        console.warn('[BrainManager] URL scrape failed:', response.status);
        return null;
      }

      return await response.json();
    } catch (error) {
      console.error('[BrainManager] URL scrape error:', error);
      return null;
    }
  }

  async removeAnchor(id) {
    if (!confirm('Delete this context anchor?')) return;

    try {
      this.setLoading(true);
      let headers = { 'Content-Type': 'application/json' };
      if (window.supabase) {
        const { data: { session } } = await window.supabase.auth.getSession();
        if (session) headers['Authorization'] = `Bearer ${session.access_token}`;
      }

      await fetch(`/api/context-anchor?id=${id}`, {
        method: 'DELETE',
        headers
      });

      // Reload or filter locally
      this.anchors = this.anchors.filter(a => a.id !== id);
      this.renderAnchors();

    } catch (error) {
      console.error('Delete error', error);
      alert('Failed to delete anchor');
    } finally {
      this.setLoading(false);
    }
  }

  setLoading(isLoading) {
    this.isLoading = isLoading;
    // Show/hide spinner or disable buttons
    if (this.sendBtn) {
      this.sendBtn.disabled = isLoading;
      this.sendBtn.innerHTML = isLoading ?
        `<span class="material-symbols-outlined" style="animation:spin 1s linear infinite; display:block">refresh</span>` :
        `<span class="material-symbols-outlined">arrow_upward</span>`;
    }
    if (this.brainInputArea) {
      this.brainInputArea.style.opacity = isLoading ? '0.5' : '1';
      this.brainInputArea.style.pointerEvents = isLoading ? 'none' : 'auto';
    }
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  getAnchorIds() {
    return this.anchors ? this.anchors.map(a => a.id) : [];
  }

  initResizer() {
    // 1. Restore width
    const savedWidth = localStorage.getItem('BRAIN_PANEL_WIDTH');
    if (savedWidth && this.brainPanel) {
      // Only restore on desktop (or let CSS media query override on mobile)
      if (window.innerWidth > 768) {
        this.brainPanel.style.width = savedWidth + 'px';
      }
    }

    // 2. Setup Resizer
    this.resizer = document.querySelector('.side-menu-resizer');
    if (this.resizer) {
      this.resizer.addEventListener('mousedown', this.handleResizeStart);
    }
  }

  handleResizeStart(e) {
    if (window.innerWidth <= 768) return; // Disable on mobile
    e.preventDefault();
    document.addEventListener('mousemove', this.handleResizeMove);
    document.addEventListener('mouseup', this.handleResizeEnd);
    document.body.style.cursor = 'ew-resize';
    this.brainPanel.style.transition = 'none'; // Disable transition during drag
  }

  handleResizeMove(e) {
    // Width is distance from right edge
    const newWidth = window.innerWidth - e.clientX;

    // Constraints
    if (newWidth < 300) return;
    if (newWidth > 800) return;
    if (newWidth > window.innerWidth - 50) return;

    this.brainPanel.style.width = newWidth + 'px';
  }

  handleResizeEnd() {
    document.removeEventListener('mousemove', this.handleResizeMove);
    document.removeEventListener('mouseup', this.handleResizeEnd);
    document.body.style.cursor = '';
    this.brainPanel.style.transition = ''; // Re-enable transition

    // Save width
    const width = parseInt(this.brainPanel.style.width);
    if (width) {
      localStorage.setItem('BRAIN_PANEL_WIDTH', width);
    }
  }
}

class ContextManager {
  constructor() {
    this.sessionId = null;
    this.files = [];
    this.rulesText = '';
    this.selectedStyle = 'none';
    this.customStyleText = '';
    this.estimatedTokens = 0;
    this.isMobile = window.matchMedia('(max-width: 768px)').matches;

    // Files modal elements (desktop)
    this.filesModal = document.getElementById('files-modal');
    this.filesDropzone = document.getElementById('files-dropzone');
    this.browseFilesBtn = document.getElementById('browse-files-btn');
    this.filesList = document.getElementById('files-list');
    this.filesCount = document.getElementById('files-count');

    // Files bottom sheet elements (mobile)
    this.filesBottomSheet = document.getElementById('files-bottom-sheet');
    this.filesDropzoneMobile = document.getElementById('files-dropzone-mobile');
    this.browseFilesBtnMobile = document.getElementById('browse-files-btn-mobile');
    this.filesListMobile = document.getElementById('files-list-mobile');
    this.filesCountMobile = document.getElementById('files-count-mobile');

    // Rules modal elements (desktop)
    this.rulesModal = document.getElementById('rules-modal');
    this.rulesTextarea = document.getElementById('rules-textarea');
    this.saveRulesBtn = document.getElementById('save-rules-btn');
    this.clearRulesBtn = document.getElementById('clear-rules-btn');
    this.rulesStatusEl = document.getElementById('rules-status');

    // Writing Style modal elements (desktop)
    this.styleDropdown = document.getElementById('style-dropdown');
    this.customStyleTextarea = document.getElementById('custom-style-textarea');
    this.saveStyleBtn = document.getElementById('save-style-btn');
    this.clearStyleBtn = document.getElementById('clear-style-btn');
    this.styleStatusEl = document.getElementById('style-status');

    // Rules bottom sheet elements (mobile)
    this.rulesBottomSheet = document.getElementById('rules-bottom-sheet');
    this.rulesTextareaMobile = document.getElementById('rules-textarea-mobile');
    this.saveRulesBtnMobile = document.getElementById('save-rules-btn-mobile');
    this.clearRulesBtnMobile = document.getElementById('clear-rules-btn-mobile');

    // Writing Style bottom sheet elements (mobile)
    this.styleDropdownMobile = document.getElementById('style-dropdown-mobile');
    this.customStyleTextareaMobile = document.getElementById('custom-style-textarea-mobile');
    this.saveStyleBtnMobile = document.getElementById('save-style-btn-mobile');
    this.clearStyleBtnMobile = document.getElementById('clear-rules-btn-mobile');

    // Shared file input
    this.fileInput = document.getElementById('file-input');

    // Menu buttons
    this.filesMenuBtn = document.querySelector('.files-menu-btn');
    this.rulesMenuBtn = document.querySelector('.rules-menu-btn');

    // Side menu elements
    this.sideMenu = document.getElementById('side-menu');
    this.sideMenuBackdrop = document.getElementById('side-menu-backdrop');
    this.sideMenuClose = document.getElementById('side-menu-close');
    this.sideMenuFilesList = document.getElementById('side-menu-files-list');
    this.sideMenuUploadBtn = document.getElementById('side-menu-upload-btn');
    this.sideMenuRemoveFilesBtn = document.getElementById('side-menu-remove-files-btn');
    this.sideMenuRulesTextarea = document.getElementById('side-menu-rules-textarea');
    this.sideMenuSaveRulesBtn = document.getElementById('side-menu-save-rules-btn');
    this.sideMenuClearRulesBtn = document.getElementById('side-menu-clear-rules-btn');
    this.sideMenuStyleDropdown = document.getElementById('side-menu-style-dropdown');
    this.sideMenuCustomStyleTextarea = document.getElementById('side-menu-custom-style-textarea');
    this.sideMenuSaveStyleBtn = document.getElementById('side-menu-save-style-btn');
    this.sideMenuClearStyleBtn = document.getElementById('side-menu-clear-style-btn');

    this.init();
  }

  init() {
    // Restore session from localStorage if available
    const savedSessionId = localStorage.getItem(CONFIG.STORAGE_SESSION_ID);
    const savedFiles = localStorage.getItem(CONFIG.STORAGE_FILES);
    const savedTokens = localStorage.getItem(CONFIG.STORAGE_TOKENS);
    const savedRules = localStorage.getItem(CONFIG.STORAGE_RULES);
    const savedStyle = localStorage.getItem(CONFIG.STORAGE_STYLE);
    const savedCustomStyle = localStorage.getItem(CONFIG.STORAGE_CUSTOM_STYLE);

    if (savedSessionId && savedFiles) {
      this.sessionId = savedSessionId;
      this.files = JSON.parse(savedFiles);
      this.estimatedTokens = parseInt(savedTokens) || 0;
    }

    // Restore rules text
    if (savedRules) {
      this.rulesText = savedRules;
      if (this.rulesTextarea) this.rulesTextarea.value = savedRules;
      if (this.rulesTextareaMobile) this.rulesTextareaMobile.value = savedRules;
      if (this.sideMenuRulesTextarea) this.sideMenuRulesTextarea.value = savedRules;
    }

    // Restore writing style
    if (savedStyle) {
      this.selectedStyle = savedStyle;
      this.updateDropdownUI(this.styleDropdown, savedStyle);
      this.updateDropdownUI(this.styleDropdownMobile, savedStyle);
      this.updateDropdownUI(this.sideMenuStyleDropdown, savedStyle);
    }

    if (savedCustomStyle) {
      this.customStyleText = savedCustomStyle;
      if (this.customStyleTextarea) this.customStyleTextarea.value = savedCustomStyle;
      if (this.customStyleTextareaMobile) this.customStyleTextareaMobile.value = savedCustomStyle;
      if (this.sideMenuCustomStyleTextarea) this.sideMenuCustomStyleTextarea.value = savedCustomStyle;
    }

    this.toggleCustomStyleTextarea();
    this.updateUI();

    // Listen for resize to update isMobile
    window.addEventListener('resize', () => {
      this.isMobile = window.matchMedia('(max-width: 768px)').matches;
    });

    // Browse buttons
    this.browseFilesBtn?.addEventListener('click', () => this.fileInput?.click());
    this.browseFilesBtnMobile?.addEventListener('click', () => this.fileInput?.click());

    // File input change
    this.fileInput?.addEventListener('change', (e) => this.handleFiles(e.target.files));

    // Setup drag and drop
    this.setupDragDrop(this.filesDropzone);
    this.setupDragDrop(this.filesDropzoneMobile);

    // Files modal close buttons
    document.getElementById('files-modal-close')?.addEventListener('click', () => this.closeFilesModal());
    document.getElementById('files-sheet-close')?.addEventListener('click', () => this.closeFilesModal());

    // Rules modal close buttons
    document.getElementById('rules-modal-close')?.addEventListener('click', () => this.closeRulesModal());
    document.getElementById('rules-sheet-close')?.addEventListener('click', () => this.closeRulesModal());

    // Backdrop click to close
    this.filesModal?.addEventListener('click', (e) => { if (e.target === this.filesModal) this.closeFilesModal(); });
    this.rulesModal?.addEventListener('click', (e) => { if (e.target === this.rulesModal) this.closeRulesModal(); });
    this.filesBottomSheet?.addEventListener('click', (e) => { if (e.target === this.filesBottomSheet) this.closeFilesModal(); });
    this.rulesBottomSheet?.addEventListener('click', (e) => { if (e.target === this.rulesBottomSheet) this.closeRulesModal(); });

    // Save rules buttons
    this.saveRulesBtn?.addEventListener('click', () => this.handleSaveRules());
    this.saveRulesBtnMobile?.addEventListener('click', () => this.handleSaveRules());

    // Clear rules buttons
    this.clearRulesBtn?.addEventListener('click', () => this.handleClearRules());
    this.clearRulesBtnMobile?.addEventListener('click', () => this.handleClearRules());

    // Save style buttons
    this.saveStyleBtn?.addEventListener('click', () => this.handleSaveStyle());
    this.saveStyleBtnMobile?.addEventListener('click', () => this.handleSaveStyle());

    // Clear style buttons
    this.clearStyleBtn?.addEventListener('click', () => this.handleClearStyle());
    this.clearStyleBtnMobile?.addEventListener('click', () => this.handleClearStyle());

    // Sync textarea values between desktop and mobile
    this.rulesTextarea?.addEventListener('input', () => {
      if (this.rulesTextareaMobile) this.rulesTextareaMobile.value = this.rulesTextarea.value;
    });
    this.rulesTextareaMobile?.addEventListener('input', () => {
      if (this.rulesTextarea) this.rulesTextarea.value = this.rulesTextareaMobile.value;
    });

    // Initialize custom dropdowns
    this.initDropdown(this.styleDropdown);
    this.initDropdown(this.styleDropdownMobile);
    this.initDropdown(this.sideMenuStyleDropdown);

    // Close dropdowns on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('.custom-dropdown')) {
        document.querySelectorAll('.custom-dropdown.active').forEach(d => d.classList.remove('active'));
      }
    });

    // Custom style textarea sync
    this.customStyleTextarea?.addEventListener('input', () => {
      if (this.customStyleTextareaMobile) this.customStyleTextareaMobile.value = this.customStyleTextarea.value;
      if (this.sideMenuCustomStyleTextarea) this.sideMenuCustomStyleTextarea.value = this.customStyleTextarea.value;
    });
    this.customStyleTextareaMobile?.addEventListener('input', () => {
      if (this.customStyleTextarea) this.customStyleTextarea.value = this.customStyleTextareaMobile.value;
      if (this.sideMenuCustomStyleTextarea) this.sideMenuCustomStyleTextarea.value = this.customStyleTextareaMobile.value;
    });
    this.sideMenuCustomStyleTextarea?.addEventListener('input', () => {
      if (this.customStyleTextarea) this.customStyleTextarea.value = this.sideMenuCustomStyleTextarea.value;
      if (this.customStyleTextareaMobile) this.customStyleTextareaMobile.value = this.sideMenuCustomStyleTextarea.value;
    });

    // Side menu handlers
    this.sideMenuClose?.addEventListener('click', () => this.closeSideMenu());
    this.sideMenuBackdrop?.addEventListener('click', () => this.closeSideMenu());
    this.sideMenuUploadBtn?.addEventListener('click', () => this.fileInput?.click());
    this.sideMenuRemoveFilesBtn?.addEventListener('click', () => this.clearFiles());
    this.sideMenuSaveRulesBtn?.addEventListener('click', () => this.handleSaveRulesFromSideMenu());
    this.sideMenuClearRulesBtn?.addEventListener('click', () => this.handleClearRulesFromSideMenu());
    this.sideMenuSaveStyleBtn?.addEventListener('click', () => this.handleSaveStyleFromSideMenu());
    this.sideMenuClearStyleBtn?.addEventListener('click', () => this.handleClearStyleFromSideMenu());

    // Sync side menu rules textarea with other textareas
    this.sideMenuRulesTextarea?.addEventListener('input', () => {
      if (this.rulesTextarea) this.rulesTextarea.value = this.sideMenuRulesTextarea.value;
      if (this.rulesTextareaMobile) this.rulesTextareaMobile.value = this.sideMenuRulesTextarea.value;
    });
  }

  setupDragDrop(dropzone) {
    if (!dropzone) return;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      dropzone.addEventListener(eventName, (e) => {
        e.preventDefault();
        e.stopPropagation();
      });
    });

    ['dragenter', 'dragover'].forEach(eventName => {
      dropzone.addEventListener(eventName, () => {
        dropzone.classList.add('drag-active');
      });
    });

    ['dragleave', 'drop'].forEach(eventName => {
      dropzone.addEventListener(eventName, () => {
        dropzone.classList.remove('drag-active');
      });
    });

    dropzone.addEventListener('drop', (e) => {
      const files = e.dataTransfer.files;
      if (files.length) this.handleFiles(files);
    });
  }

  openFilesModal() {
    if (this.isMobile) {
      this.filesBottomSheet?.classList.add('visible');
    } else {
      this.filesModal?.classList.add('visible');
    }
    this.updateUI();
  }

  closeFilesModal() {
    this.filesModal?.classList.remove('visible');
    this.filesBottomSheet?.classList.remove('visible');
  }

  initDropdown(dropdown) {
    if (!dropdown) return;
    const trigger = dropdown.querySelector('.custom-dropdown-trigger');
    const items = dropdown.querySelectorAll('.custom-dropdown-item');

    trigger?.addEventListener('click', (e) => {
      e.stopPropagation();
      // Close other dropdowns
      document.querySelectorAll('.custom-dropdown.active').forEach(d => {
        if (d !== dropdown) d.classList.remove('active');
      });
      dropdown.classList.toggle('active');
    });

    items.forEach(item => {
      item.addEventListener('click', () => {
        const value = item.dataset.value;
        this.handleStyleChange(value);
        dropdown.classList.remove('active');
      });
    });
  }

  updateDropdownUI(dropdown, value) {
    if (!dropdown) return;
    const trigger = dropdown.querySelector('.custom-dropdown-trigger .selected-value');
    const items = dropdown.querySelectorAll('.custom-dropdown-item');
    const selectedItem = dropdown.querySelector(`.custom-dropdown-item[data-value="${value}"]`);

    if (trigger && selectedItem) {
      trigger.textContent = selectedItem.textContent;
    }

    items.forEach(item => {
      item.classList.toggle('selected', item.dataset.value === value);
    });
  }

  handleStyleChange(value) {
    this.selectedStyle = value;
    this.updateDropdownUI(this.styleDropdown, value);
    this.updateDropdownUI(this.styleDropdownMobile, value);
    this.updateDropdownUI(this.sideMenuStyleDropdown, value);
    this.toggleCustomStyleTextarea();
  }

  openRulesModal() {
    if (this.isMobile) {
      this.rulesBottomSheet?.classList.add('visible');
    } else {
      this.rulesModal?.classList.add('visible');
    }
  }

  closeRulesModal() {
    this.rulesModal?.classList.remove('visible');
    this.rulesBottomSheet?.classList.remove('visible');
  }

  openSideMenu() {
    // Sync rules textarea values before opening
    if (this.sideMenuRulesTextarea) {
      this.sideMenuRulesTextarea.value = this.rulesText || '';
    }
    // Sync style values before opening
    if (this.sideMenuStyleDropdown) {
      this.updateDropdownUI(this.sideMenuStyleDropdown, this.selectedStyle || 'none');
    }
    if (this.sideMenuCustomStyleTextarea) {
      this.sideMenuCustomStyleTextarea.value = this.customStyleText || '';
    }
    this.toggleCustomStyleTextarea();

    // Render files list
    this.renderSideMenuFilesList();
    document.body.classList.add('side-menu-open');
  }

  closeSideMenu() {
    document.body.classList.remove('side-menu-open');
  }

  toggleSideMenu() {
    if (document.body.classList.contains('side-menu-open')) {
      this.closeSideMenu();
    } else {
      this.openSideMenu();
    }
  }

  toggleCustomStyleTextarea() {
    const show = this.selectedStyle === 'custom';
    if (this.customStyleTextarea) this.customStyleTextarea.style.display = show ? 'block' : 'none';
    if (this.customStyleTextareaMobile) this.customStyleTextareaMobile.style.display = show ? 'block' : 'none';
    if (this.sideMenuCustomStyleTextarea) this.sideMenuCustomStyleTextarea.style.display = show ? 'block' : 'none';
  }

  handleSaveStyleFromSideMenu() {
    const style = this.selectedStyle || 'none';
    const customText = (this.sideMenuCustomStyleTextarea?.value || '').trim();

    this.selectedStyle = style;
    this.customStyleText = customText;

    // Save to localStorage
    localStorage.setItem(CONFIG.STORAGE_STYLE, style);
    if (customText) {
      localStorage.setItem(CONFIG.STORAGE_CUSTOM_STYLE, customText);
    } else {
      localStorage.removeItem(CONFIG.STORAGE_CUSTOM_STYLE);
    }

    this.updateUI();
  }

  handleClearStyleFromSideMenu() {
    this.selectedStyle = 'none';
    this.customStyleText = '';

    this.updateDropdownUI(this.sideMenuStyleDropdown, 'none');
    this.updateDropdownUI(this.styleDropdown, 'none');
    this.updateDropdownUI(this.styleDropdownMobile, 'none');

    if (this.sideMenuCustomStyleTextarea) this.sideMenuCustomStyleTextarea.value = '';
    if (this.customStyleTextarea) this.customStyleTextarea.value = '';
    if (this.customStyleTextareaMobile) this.customStyleTextareaMobile.value = '';

    localStorage.removeItem(CONFIG.STORAGE_STYLE);
    localStorage.removeItem(CONFIG.STORAGE_CUSTOM_STYLE);
    this.toggleCustomStyleTextarea();
    this.updateUI();
  }

  handleSaveStyle() {
    const style = this.selectedStyle || 'none';
    const customText = (this.customStyleTextarea?.value || this.customStyleTextareaMobile?.value || '').trim();

    this.selectedStyle = style;
    this.customStyleText = customText;

    // Save to localStorage
    localStorage.setItem(CONFIG.STORAGE_STYLE, style);
    if (customText) {
      localStorage.setItem(CONFIG.STORAGE_CUSTOM_STYLE, customText);
    } else {
      localStorage.removeItem(CONFIG.STORAGE_CUSTOM_STYLE);
    }

    if (this.styleStatusEl) {
      this.styleStatusEl.textContent = 'Style saved';
      setTimeout(() => {
        if (this.styleStatusEl && this.styleStatusEl.textContent === 'Style saved') {
          this.styleStatusEl.textContent = '';
        }
      }, 2000);
    }

    this.updateUI();
  }

  handleClearStyle() {
    this.selectedStyle = 'none';
    this.customStyleText = '';

    this.updateDropdownUI(this.styleDropdown, 'none');
    this.updateDropdownUI(this.styleDropdownMobile, 'none');
    this.updateDropdownUI(this.sideMenuStyleDropdown, 'none');

    if (this.customStyleTextarea) this.customStyleTextarea.value = '';
    if (this.customStyleTextareaMobile) this.customStyleTextareaMobile.value = '';
    if (this.sideMenuCustomStyleTextarea) this.sideMenuCustomStyleTextarea.value = '';

    localStorage.removeItem(CONFIG.STORAGE_STYLE);
    localStorage.removeItem(CONFIG.STORAGE_CUSTOM_STYLE);

    if (this.styleStatusEl) {
      this.styleStatusEl.textContent = 'Style cleared';
      setTimeout(() => {
        if (this.styleStatusEl && this.styleStatusEl.textContent === 'Style cleared') {
          this.styleStatusEl.textContent = '';
        }
      }, 2000);
    }

    this.toggleCustomStyleTextarea();
    this.updateUI();
  }

  getWritingStyleText() {
    if (this.selectedStyle === 'none') return '';
    if (this.selectedStyle === 'custom') return this.customStyleText;
    return CONFIG.WRITING_STYLES[this.selectedStyle] || '';
  }

  restoreWritingStyle(styleText) {
    if (!styleText) {
      this.selectedStyle = 'none';
      this.customStyleText = '';
    } else {
      // Find if it matches a prebuilt style
      let foundKey = 'custom';
      for (const [key, prompt] of Object.entries(CONFIG.WRITING_STYLES)) {
        if (prompt === styleText) {
          foundKey = key;
          break;
        }
      }
      this.selectedStyle = foundKey;
      this.customStyleText = foundKey === 'custom' ? styleText : '';
    }

    // Update UI elements
    this.updateDropdownUI(this.styleDropdown, this.selectedStyle);
    this.updateDropdownUI(this.styleDropdownMobile, this.selectedStyle);
    this.updateDropdownUI(this.sideMenuStyleDropdown, this.selectedStyle);

    if (this.customStyleTextarea) this.customStyleTextarea.value = this.customStyleText;
    if (this.customStyleTextareaMobile) this.customStyleTextareaMobile.value = this.customStyleText;
    if (this.sideMenuCustomStyleTextarea) this.sideMenuCustomStyleTextarea.value = this.customStyleText;

    this.toggleCustomStyleTextarea();

    // Save to localStorage
    localStorage.setItem(CONFIG.STORAGE_STYLE, this.selectedStyle);
    if (this.customStyleText) {
      localStorage.setItem(CONFIG.STORAGE_CUSTOM_STYLE, this.customStyleText);
    } else {
      localStorage.removeItem(CONFIG.STORAGE_CUSTOM_STYLE);
    }

    this.updateUI();
  }

  handleSaveRulesFromSideMenu() {
    const text = (this.sideMenuRulesTextarea?.value || '').trim();
    this.rulesText = text;

    // Sync with other textareas
    if (this.rulesTextarea) this.rulesTextarea.value = text;
    if (this.rulesTextareaMobile) this.rulesTextareaMobile.value = text;

    // Save to localStorage
    if (text) {
      localStorage.setItem(CONFIG.STORAGE_RULES, text);
    } else {
      localStorage.removeItem(CONFIG.STORAGE_RULES);
    }

    this.updateUI();
  }

  handleClearRulesFromSideMenu() {
    this.rulesText = '';
    if (this.sideMenuRulesTextarea) this.sideMenuRulesTextarea.value = '';
    if (this.rulesTextarea) this.rulesTextarea.value = '';
    if (this.rulesTextareaMobile) this.rulesTextareaMobile.value = '';
    localStorage.removeItem(CONFIG.STORAGE_RULES);
    this.updateUI();
  }

  renderSideMenuFilesList() {
    if (!this.sideMenuFilesList) return;

    // Get tokens display element
    const tokensDisplay = document.getElementById('side-menu-tokens-display');

    if (this.files.length === 0) {
      this.sideMenuFilesList.innerHTML = '';
      if (tokensDisplay) tokensDisplay.style.display = 'none';
      return;
    }

    // Render file items
    this.sideMenuFilesList.innerHTML = this.files.map((file, index) =>
      `<div class="side-menu-file" data-index="${index}">` +
      `<div class="side-menu-file-icon">` +
      `<span class="material-symbols-outlined">description</span>` +
      `</div>` +
      `<span class="side-menu-file-name">${file.name || file}</span>` +
      `<button class="side-menu-file-remove" data-index="${index}" aria-label="Remove file">` +
      `<span class="material-symbols-outlined">close</span>` +
      `</button>` +
      `</div>`
    ).join('');

    // Show estimated tokens
    if (tokensDisplay) {
      tokensDisplay.textContent = `~${this.estimatedTokens.toLocaleString()} tokens`;
      tokensDisplay.style.display = 'block';
    }

    // Add delete handlers
    this.sideMenuFilesList.querySelectorAll('.side-menu-file-remove').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeFile(parseInt(btn.dataset.index));
      });
    });
  }

  // Legacy methods for backwards compatibility
  openModal() {
    this.openFilesModal();
  }

  closeModal() {
    this.closeFilesModal();
    this.closeRulesModal();
  }

  handleSaveRules() {
    // Get text from whichever textarea is available
    const text = (this.rulesTextarea?.value || this.rulesTextareaMobile?.value || '').trim();
    this.rulesText = text;

    // Save to localStorage
    if (text) {
      localStorage.setItem(CONFIG.STORAGE_RULES, text);
    } else {
      localStorage.removeItem(CONFIG.STORAGE_RULES);
    }

    if (this.rulesStatusEl) {
      this.rulesStatusEl.textContent = text ? 'Rules saved' : 'Rules cleared';
      setTimeout(() => {
        if (this.rulesStatusEl && (this.rulesStatusEl.textContent === 'Rules saved' || this.rulesStatusEl.textContent === 'Rules cleared')) {
          this.rulesStatusEl.textContent = '';
        }
      }, 2000);
    }

    this.updateUI();
  }

  handleClearRules() {
    this.rulesText = '';
    if (this.rulesTextarea) this.rulesTextarea.value = '';
    if (this.rulesTextareaMobile) this.rulesTextareaMobile.value = '';
    localStorage.removeItem(CONFIG.STORAGE_RULES);

    if (this.rulesStatusEl) {
      this.rulesStatusEl.textContent = 'Rules cleared';
      setTimeout(() => {
        if (this.rulesStatusEl && this.rulesStatusEl.textContent === 'Rules cleared') {
          this.rulesStatusEl.textContent = '';
        }
      }, 2000);
    }

    this.updateUI();
  }

  async handleFiles(fileList) {
    if (!fileList || fileList.length === 0) return;

    // Store new files in pending array for accumulation
    if (!this.pendingFiles) this.pendingFiles = [];

    // Add new files to pending (for re-upload with existing)
    for (const file of fileList) {
      // Check if file with same name already exists
      const existingIndex = this.pendingFiles.findIndex(f => f.name === file.name);
      if (existingIndex >= 0) {
        this.pendingFiles[existingIndex] = file; // Replace
      } else {
        this.pendingFiles.push(file); // Add new
      }
    }

    const formData = new FormData();
    for (const file of this.pendingFiles) {
      formData.append('files', file);
    }

    if (this.statusEl) {
      this.statusEl.textContent = 'Uploading...';
    }

    try {
      const response = await fetch(CONFIG.API_CONTEXT, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        let errorMessage = 'Upload failed';
        try {
          const error = await response.json();
          errorMessage = error.error || errorMessage;
        } catch (e) {
          // Response wasn't JSON (iOS Safari compatibility)
          try {
            errorMessage = await response.text() || errorMessage;
          } catch (e2) {
            // Use default error message
          }
        }
        throw new Error(errorMessage);
      }

      const data = await response.json();
      this.sessionId = data.sessionId;
      this.files = data.files;
      this.estimatedTokens = data.estimatedTokens;

      // Save to localStorage for session recovery
      localStorage.setItem(CONFIG.STORAGE_SESSION_ID, this.sessionId);
      localStorage.setItem(CONFIG.STORAGE_FILES, JSON.stringify(this.files));
      localStorage.setItem(CONFIG.STORAGE_TOKENS, this.estimatedTokens.toString());

      this.updateUI();
    } catch (error) {
      console.error('Upload error:', error);
      if (this.statusEl) {
        this.statusEl.textContent = `Error: ${error.message}`;
      }
    }

    // Reset file input so same file can be re-selected
    if (this.fileInput) {
      this.fileInput.value = '';
    }
  }

  async clearFiles() {
    if (this.sessionId) {
      try {
        await fetch(`${CONFIG.API_CONTEXT}/${this.sessionId}`, { method: 'DELETE' });
      } catch (e) {
        console.error('Error clearing files:', e);
      }
    }

    this.sessionId = null;
    this.files = [];
    this.pendingFiles = []; // Clear pending files too
    this.estimatedTokens = 0;

    // Clear file-related localStorage (keep rules)
    localStorage.removeItem(CONFIG.STORAGE_SESSION_ID);
    localStorage.removeItem(CONFIG.STORAGE_FILES);
    localStorage.removeItem(CONFIG.STORAGE_TOKENS);

    this.updateUI();
  }

  async removeFile(index) {
    if (index < 0 || index >= this.files.length) return;

    // Get the filename being removed
    const removedFile = this.files[index];
    const removedFileName = removedFile.name || removedFile;

    // Remove from files array
    this.files.splice(index, 1);

    // Remove from pendingFiles array (the actual File objects)
    if (this.pendingFiles) {
      const pendingIndex = this.pendingFiles.findIndex(f => f.name === removedFileName);
      if (pendingIndex >= 0) {
        this.pendingFiles.splice(pendingIndex, 1);
      }
    }

    // If no files left, clear session on server
    if (this.files.length === 0) {
      await this.clearFiles();
    } else if (this.pendingFiles && this.pendingFiles.length > 0) {
      // Re-upload remaining files to get new session
      const formData = new FormData();
      for (const file of this.pendingFiles) {
        formData.append('files', file);
      }

      try {
        const response = await fetch(CONFIG.API_CONTEXT, {
          method: 'POST',
          body: formData
        });

        if (response.ok) {
          const data = await response.json();
          this.sessionId = data.sessionId;
          this.files = data.files;
          this.estimatedTokens = data.estimatedTokens;

          localStorage.setItem(CONFIG.STORAGE_SESSION_ID, this.sessionId);
          localStorage.setItem(CONFIG.STORAGE_FILES, JSON.stringify(this.files));
          localStorage.setItem(CONFIG.STORAGE_TOKENS, this.estimatedTokens.toString());
        }
      } catch (e) {
        console.error('Error re-uploading files:', e);
      }

      this.updateUI();
    } else {
      // Just update localStorage and UI
      localStorage.setItem(CONFIG.STORAGE_FILES, JSON.stringify(this.files));
      this.updateUI();
    }
  }

  async clearContext() {
    await this.clearFiles();
    this.handleClearRules();
  }

  updateUI() {
    // Render file lists (both desktop, mobile, and side menu)
    this.renderFilesList(this.filesList);
    this.renderFilesList(this.filesListMobile);
    this.renderSideMenuFilesList();

    // Update file counts
    const count = this.files.length;
    if (this.filesCount) {
      this.filesCount.textContent = `${count} file${count !== 1 ? 's' : ''}`;
    }
    if (this.filesCountMobile) {
      this.filesCountMobile.textContent = count.toString();
    }

    // Update menu button indicators (separate for files and rules)
    if (this.filesMenuBtn) {
      this.filesMenuBtn.classList.toggle('has-context', this.files.length > 0);
    }
    if (this.rulesMenuBtn) {
      const hasRules = this.rulesText.length > 0;
      const hasStyle = this.selectedStyle !== 'none';
      this.rulesMenuBtn.classList.toggle('has-context', hasRules || hasStyle);
    }
  }

  renderFilesList(container) {
    if (!container) return;

    if (this.files.length === 0) {
      container.innerHTML = '<div class="files-list-empty">No files uploaded</div>';
      return;
    }

    container.innerHTML = this.files.map((file, index) => `
      <div class="file-row" data-index="${index}">
        <div class="file-thumb">
          <span class="material-symbols-outlined">${this.getFileIcon(file.name || file)}</span>
        </div>
        <div class="file-details">
          <div class="file-name">${file.name || file}</div>
          <div class="file-meta">${file.size ? this.formatFileSize(file.size) : 'Uploaded'}</div>
        </div>
        <button class="file-delete" data-index="${index}">
          <span class="material-symbols-outlined">delete</span>
        </button>
      </div>
    `).join('');

    // Add delete handlers
    container.querySelectorAll('.file-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeFile(parseInt(btn.dataset.index));
      });
    });
  }

  getFileIcon(filename) {
    if (filename.endsWith('.pdf')) return 'picture_as_pdf';
    if (filename.endsWith('.md')) return 'description';
    return 'article';
  }

  formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  getSessionId() {
    return this.sessionId;
  }

  getRulesText() {
    return this.rulesText;
  }
}

// Valleys Manager - handles saving and loading valleys
class ValleysManager {
  constructor() {
    this.valleys = [];
    this.tempValley = null;
    this.modal = document.getElementById('valleys-modal');
    this.listContainer = document.getElementById('valleys-list');
    this.emptyState = document.getElementById('valleys-empty');
    this.sidebarList = document.getElementById('sidebar-valleys-list');
    this.sidebarEmpty = document.getElementById('sidebar-valleys-empty');
    this.activeValleyId = null;
    this.autoSaveTimer = null;
    this.autoSaveDebounceMs = 2000;
    this.init();
    this.renderSidebarList();
  }

  init() {
    // Editor auto-save listener
    const editor = document.querySelector('.editor');
    if (editor) {
      editor.addEventListener('input', () => this.handleAutoSave());
    }

    // Modal close button
    const closeBtn = document.getElementById('valleys-modal-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.closeModal());
    }

    // Close on backdrop click
    if (this.modal) {
      this.modal.addEventListener('click', (e) => {
        if (e.target === this.modal) this.closeModal();
      });
    }

    // New valley button
    const newValleyBtn = document.getElementById('new-valley-btn');
    if (newValleyBtn) {
      newValleyBtn.addEventListener('click', () => this.newValley());
    }

    // Context Menu Handlers
    this.contextMenu = document.getElementById('valley-context-menu');
    if (this.contextMenu) {
      this.contextMenu.addEventListener('click', (e) => {
        if (e.target === this.contextMenu) this.closeContextMenu();
      });

      const deleteBtn = this.contextMenu.querySelector('.delete-valley-btn');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
          if (this.contextValleyId && confirm('Delete this valley?')) {
            this.deleteValley(this.contextValleyId);
            this.closeContextMenu();
          }
        });
      }

      const renameBtn = this.contextMenu.querySelector('.rename-valley-btn');
      if (renameBtn) {
        renameBtn.addEventListener('click', () => {
          if (this.contextValleyId) {
            this.startRenaming(this.contextValleyId);
            this.closeContextMenu();
          }
        });
      }

      const shareBtn = this.contextMenu.querySelector('.share-valley-btn');
      if (shareBtn) {
        shareBtn.addEventListener('click', () => {
          if (this.contextValleyId) {
            this.shareValley(this.contextValleyId);
            this.closeContextMenu();
          }
        });
      }
    }
  }

  closeContextMenu() {
    if (this.contextMenu) {
      this.contextMenu.classList.remove('visible');
      this.contextMenu.classList.remove('menu-ready');
      this.contextValleyId = null;
    }
  }

  openContextMenu(valleyId, x, y) {
    if (this.contextMenu) {
      this.contextValleyId = valleyId;
      const content = this.contextMenu.querySelector('.menu-content');

      // Position the menu
      content.style.top = `${y}px`;
      content.style.left = `${x}px`;
      content.style.right = 'auto';
      content.style.transformOrigin = 'top left';

      this.contextMenu.classList.add('visible');
      setTimeout(() => this.contextMenu.classList.add('menu-ready'), 10);
    }
  }

  async shareValley(id) {
    const valley = this.valleys.find(v => v.id === id) || (this.tempValley?.id === id ? this.tempValley : null);
    if (!valley) return;

    // If it's the active one, we might have fresher text in the editor
    let textToShare = valley.text;
    if (id === this.activeValleyId) {
      const editor = document.querySelector('.editor');
      if (editor) textToShare = editor.textContent;
    }

    const shareData = {
      title: valley.title,
      text: textToShare,
      url: window.location.href
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(`${shareData.title}\n\n${shareData.text}`);
        alert('Valley content copied to clipboard!');
      }
    } catch (err) {
      console.error('Error sharing:', err);
    }
  }

  startRenaming(id) {
    const row = document.querySelector(`.sidebar-valley-row[data-id="${id}"]`) ||
      document.querySelector(`.valley-item[data-id="${id}"]`);
    if (!row) return;

    const titleSpan = row.querySelector('.valley-title') || row.querySelector('.valley-item-title');
    if (!titleSpan) return;

    titleSpan.contentEditable = true;
    titleSpan.focus();

    // Select all text
    const range = document.createRange();
    range.selectNodeContents(titleSpan);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    const finishRenaming = async () => {
      titleSpan.contentEditable = false;
      const newTitle = titleSpan.textContent.trim();
      if (newTitle && newTitle !== valley.title) {
        await this.updateValleyTitle(id, newTitle);
      } else {
        titleSpan.textContent = valley.title; // Revert
      }
      titleSpan.removeEventListener('blur', finishRenaming);
      titleSpan.removeEventListener('keydown', keyHandler);
    };

    const keyHandler = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        titleSpan.blur();
      }
      if (e.key === 'Escape') {
        titleSpan.textContent = valley.title;
        titleSpan.blur();
      }
    };

    const valley = this.valleys.find(v => v.id === id) || (this.tempValley?.id === id ? this.tempValley : null);
    if (!valley) return;

    titleSpan.addEventListener('blur', finishRenaming);
    titleSpan.addEventListener('keydown', keyHandler);
  }

  async updateValleyTitle(id, newTitle) {
    // If it's a temp valley, just update locally
    if (id.startsWith('temp-')) {
      if (this.tempValley) {
        this.tempValley.title = newTitle;
        this.renderSidebarList();
      }
      return;
    }

    try {
      const token = await window.authManager.getAccessToken();
      const response = await fetch(`${CONFIG.API_VALLEYS}?id=${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ title: newTitle })
      });

      if (!response.ok) throw new Error('Failed to update title');

      const data = await response.json();
      const index = this.valleys.findIndex(v => v.id === id);
      if (index !== -1) {
        this.valleys[index].title = newTitle;
        this.renderSidebarList();
        this.renderList();
      }
    } catch (err) {
      console.error('Rename error:', err);
      this.renderSidebarList();
      this.renderList();
    }
  }

  async newValley() {
    if (this.isLoading) return;

    // If we are currently saving, wait for it
    if (this.pendingSave) await this.pendingSave;

    // Save current active valley before clearing
    if (this.activeValleyId) {
      if (this.autoSaveTimer) {
        clearTimeout(this.autoSaveTimer);
        this.autoSaveTimer = null;
      }
      await this.saveValley(true);
    }

    const editor = document.querySelector('.editor');
    if (editor) {
      editor.textContent = '';
      editor.focus();
    }

    // Clear context (rules + files)
    if (window.contextManager) {
      await window.contextManager.clearContext();
    }

    // Create temporary valley (requirement #1: visible in UI immediately)
    this.tempValley = {
      id: 'temp-' + Date.now(),
      title: 'New valley',
      created_at: new Date().toISOString()
    };

    this.activeValleyId = this.tempValley.id;
    this.renderSidebarList();
    this.renderList();
    this.closeModal();
  }

  handleAutoSave() {
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);

    this.autoSaveTimer = setTimeout(() => {
      const editor = document.querySelector('.editor');
      if (editor && editor.textContent.trim().length > 0) {
        this.saveValley(true);
      }
    }, this.autoSaveDebounceMs);
  }

  generateTitle(text) {
    // Take first 200 chars and normalize whitespace. CSS handles truncation.
    return text.replace(/\s+/g, ' ').trim().slice(0, 200) || 'Untitled';
  }

  async saveValley(isAutoSave = false) {
    // If already saving this specific content/valley, return the existing promise
    if (this.isSaving) return this.pendingSave;

    const editor = document.querySelector('.editor');
    if (!editor) return { success: false, error: 'Editor not found' };

    // Capture current state synchronously to avoid race conditions with editor clearing/switching
    const idToSave = this.activeValleyId;
    const clone = editor.cloneNode(true);
    const predictionEl = clone.querySelector('.inline-prediction');
    if (predictionEl) predictionEl.remove();

    const text = clone.innerHTML;
    const plainText = editor.textContent.trim();

    // Requirement #3: If empty, it's not saved to DB
    if (!plainText && !text.includes('img')) {
      return { success: false, error: 'Nothing to save' };
    }

    // Check if user is authenticated
    if (!window.authManager?.isAuthenticated()) {
      if (!isAutoSave) {
        window.authManager?.openModal();
      }
      return { success: false, error: 'Sign in to save valleys' };
    }

    const title = this.generateTitle(plainText);
    const rules = window.contextManager?.getRulesText() || '';
    const writingStyle = window.contextManager?.getWritingStyleText() || '';
    const contextSessionId = window.contextManager?.getSessionId() || null;

    this.isSaving = true;
    this.pendingSave = (async () => {
      try {
        const token = await window.authManager.getAccessToken();
        const isRealValley = idToSave && !idToSave.toString().startsWith('temp-');
        const method = isRealValley ? 'PUT' : 'POST';
        const url = isRealValley ? `${CONFIG.API_VALLEYS}?id=${idToSave}` : CONFIG.API_VALLEYS;

        const response = await fetch(url, {
          method: method,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ title, text, rules, writingStyle, contextSessionId })
        });

        if (!response.ok) {
          const data = await response.json();
          if (response.status === 403 && data.upgradeRequired) {
            if (!isAutoSave && confirm(data.error + '\n\nWould you like to upgrade to Pro now?')) {
              window.authManager.openAccountModal();
            }
          }
          throw new Error(data.error || 'Failed to save valley');
        }

        const data = await response.json();

        // Requirement #2: Promoting temp valley to real one on first save
        if (idToSave && idToSave.toString().startsWith('temp-')) {
          this.tempValley = null;
          // Only update active ID if we are still on the same valley
          if (this.activeValleyId === idToSave) {
            this.activeValleyId = data.id;
          }
          this.valleys.unshift(data);
        } else if (!idToSave) {
          this.activeValleyId = data.id;
          this.valleys.unshift(data);
        } else {
          const index = this.valleys.findIndex(v => v.id === idToSave);
          if (index !== -1) {
            this.valleys[index] = { ...this.valleys[index], ...data };
          }
        }

        this.renderSidebarList();
        this.renderList();

        return { success: true, valley: data };
      } catch (error) {
        console.error('Save valley error:', error);
        return { success: false, error: error.message };
      } finally {
        this.isSaving = false;
        this.pendingSave = null;
      }
    })();

    return this.pendingSave;
  }

  async loadValleys() {
    try {
      const token = await window.authManager?.getAccessToken();
      const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

      const response = await fetch(CONFIG.API_VALLEYS, { headers });
      if (!response.ok) throw new Error('Failed to load valleys');

      const data = await response.json();
      this.valleys = data.valleys || [];
      this.renderList();

      // Always start with a new temp valley
      this.createInitialTempValley();
    } catch (error) {
      console.error('Load valleys error:', error);
      this.valleys = [];
      this.renderList();

      // Still create temp valley even if load fails
      this.createInitialTempValley();
    }
  }

  createInitialTempValley() {
    // Create temporary valley visible in sidebar immediately
    this.tempValley = {
      id: 'temp-' + Date.now(),
      title: 'New valley',
      created_at: new Date().toISOString()
    };

    this.activeValleyId = this.tempValley.id;
    this.renderSidebarList();
  }

  async loadValley(id) {
    if (this.isLoading) return;
    this.isLoading = true;

    // Requirement #4: Save current valley before switching
    if (this.activeValleyId && this.activeValleyId !== id) {
      if (this.autoSaveTimer) {
        clearTimeout(this.autoSaveTimer);
        this.autoSaveTimer = null;
      }
      // Wait for any pending save OR trigger a new one
      if (this.pendingSave) {
        await this.pendingSave;
      } else {
        await this.saveValley(true);
      }
    }

    // Requirement #5: Clear temp valley if we switch away from it
    if (this.tempValley && id !== this.tempValley.id) {
      this.tempValley = null;
      this.renderSidebarList();
    }

    try {
      // Clear editor immediately so user knows something is happening
      const editor = document.querySelector('.editor');
      if (editor) editor.innerHTML = '<div class="loading-editor">Loading valley...</div>';

      const token = await window.authManager?.getAccessToken();
      const response = await fetch(`${CONFIG.API_VALLEYS}?id=${id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('Failed to load valley');

      const valley = await response.json();

      // Restore editor content
      if (editor) {
        editor.innerHTML = valley.text;
        // Re-hydrate images
        editor.querySelectorAll('.editor-image-container').forEach(setupImageContainer);
      }

      // Restore context (rules + files)
      if (window.contextManager) {
        // Restore rules
        window.contextManager.rulesText = valley.rules || '';
        const textarea = document.getElementById('context-textarea');
        if (textarea) textarea.value = valley.rules || '';
        if (valley.rules) {
          localStorage.setItem(CONFIG.STORAGE_RULES, valley.rules);
        } else {
          localStorage.removeItem(CONFIG.STORAGE_RULES);
        }

        // Restore writing style
        if (window.contextManager.restoreWritingStyle) {
          window.contextManager.restoreWritingStyle(valley.writing_style || '');
        }

        // Restore files
        if (valley.files && valley.files.content) {
          await this.restoreFilesFromValley(valley.files);
        } else {
          await window.contextManager.clearFiles();
        }

        window.contextManager.updateUI();
      }

      this.activeValleyId = id;
      this.highlightSidebarValleys();
      this.closeModal();
      if (editor) editor.focus();
    } catch (error) {
      console.error('Load valley error:', error);
      // Restore empty editor on error
      const editor = document.querySelector('.editor');
      if (editor && editor.querySelector('.loading-editor')) editor.innerHTML = '';
    } finally {
      this.isLoading = false;
    }
  }

  async restoreFilesFromValley(filesData) {
    if (!filesData || !filesData.content) {
      await window.contextManager.clearFiles();
      return;
    }

    try {
      const token = await window.authManager?.getAccessToken();
      const response = await fetch(CONFIG.API_CONTEXT_RESTORE, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          content: filesData.content,
          files: filesData.files,
          estimatedTokens: filesData.estimatedTokens
        })
      });

      if (!response.ok) throw new Error('Failed to restore files');

      const data = await response.json();

      // Update context manager with new session
      window.contextManager.sessionId = data.sessionId;
      window.contextManager.files = filesData.files || [];
      window.contextManager.estimatedTokens = filesData.estimatedTokens || 0;

      // Save to localStorage
      localStorage.setItem(CONFIG.STORAGE_SESSION_ID, data.sessionId);
      localStorage.setItem(CONFIG.STORAGE_FILES, JSON.stringify(filesData.files || []));
      localStorage.setItem(CONFIG.STORAGE_TOKENS, (filesData.estimatedTokens || 0).toString());
    } catch (error) {
      console.error('Failed to restore files:', error);
      await window.contextManager.clearFiles();
    }
  }

  async deleteValley(id) {
    try {
      const token = await window.authManager?.getAccessToken();
      const response = await fetch(`${CONFIG.API_VALLEYS}?id=${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('Failed to delete valley');

      this.valleys = this.valleys.filter((v) => v.id !== id);
      if (this.activeValleyId === id) {
        this.activeValleyId = null;
      }
      this.renderList();
    } catch (error) {
      console.error('Delete valley error:', error);
    }
  }

  renderList() {
    if (!this.listContainer) {
      this.renderSidebarList();
      return;
    }

    if (this.emptyState) {
      this.emptyState.style.display = (this.valleys.length || this.tempValley) ? 'none' : 'block';
    }

    const displayValleys = this.tempValley ? [this.tempValley, ...this.valleys] : this.valleys;

    if (displayValleys.length === 0) {
      if (this.listContainer) this.listContainer.innerHTML = '';
      this.renderSidebarList();
      return;
    }

    if (this.listContainer) {
      this.listContainer.innerHTML = displayValleys
        .map(
          (valley) => `
        <div class="valley-item ${valley.id.toString().startsWith('temp-') ? 'temp-item' : ''}" data-id="${valley.id}">
          <div class="valley-item-content">
            <span class="valley-item-title">${this.escapeHtml(valley.title)}</span>
            <span class="valley-item-date">${this.formatDate(valley.created_at)}</span>
          </div>
          <button class="valley-item-delete" data-id="${valley.id}">
            <span class="material-symbols-outlined">more_vert</span>
          </button>
        </div>
      `
        )
        .join('');

      // Add click handlers
      this.listContainer.querySelectorAll('.valley-item').forEach((item) => {
        item.addEventListener('click', (e) => {
          const menuBtn = e.target.closest('.valley-item-delete');
          if (menuBtn) {
            e.stopPropagation();
            const rect = menuBtn.getBoundingClientRect();
            this.openContextMenu(item.dataset.id, rect.left - 130, rect.top + 30);
            return;
          }
          this.loadValley(item.dataset.id);
        });
      });
    }

    this.renderSidebarList();
  }


  renderSidebarList() {
    if (!this.sidebarList) return;

    const displayValleys = this.tempValley ? [this.tempValley, ...this.valleys] : this.valleys;

    if (!displayValleys.length) {
      this.sidebarList.innerHTML = '';
      if (this.sidebarEmpty) this.sidebarEmpty.classList.add('visible');
      return;
    }

    if (this.sidebarEmpty) this.sidebarEmpty.classList.remove('visible');

    this.sidebarList.innerHTML = displayValleys
      .map(
        (valley) => `
        <div class="sidebar-valley-row" data-id="${valley.id}">
          <span class="valley-title">${this.escapeHtml(valley.title)}</span>
          <button class="btn-icon sidebar-valley-menu" title="Menu">
            <span class="material-symbols-outlined">more_horiz</span>
          </button>
        </div>
      `
      )
      .join('');

    this.sidebarList.querySelectorAll('.sidebar-valley-row').forEach((item) => {
      item.addEventListener('click', (e) => {
        const menuBtn = e.target.closest('.sidebar-valley-menu');
        if (menuBtn) {
          e.stopPropagation();
          const rect = menuBtn.getBoundingClientRect();
          this.openContextMenu(item.dataset.id, rect.left - 130, rect.top + 30);
          return;
        }

        if (item.dataset.id.startsWith('temp-')) return;

        this.loadValley(item.dataset.id);
        if (window.innerWidth < CONFIG.DESKTOP_BREAKPOINT_PX) {
          document.body.classList.remove('sidebar-open');
        }
      });
    });

    this.highlightSidebarValleys();
  }

  highlightSidebarValleys() {
    if (!this.sidebarList) return;
    this.sidebarList.querySelectorAll('.sidebar-valley-row').forEach((row) => {
      row.classList.toggle('active', row.dataset.id === this.activeValleyId);
    });
  }

  escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  formatDate(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;

    return date.toLocaleDateString();
  }

  openModal() {
    this.loadValleys();
    if (this.modal) this.modal.classList.add('visible');
  }

  closeModal() {
    if (this.modal) this.modal.classList.remove('visible');
  }
}

function setupImageContainer(container) {
  const img = container.querySelector('.editor-image');
  const removeBtn = container.querySelector('.editor-image-remove');

  const handleBrokenImage = () => {
    container.classList.add('is-broken');
    if (removeBtn) removeBtn.style.opacity = '1';
  };

  if (img) {
    // Check if already broken or becomes broken
    if (img.complete && img.naturalWidth === 0) {
      handleBrokenImage();
    }
    img.addEventListener('error', handleBrokenImage);
  }

  if (removeBtn) {
    removeBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const scrollElement = document.scrollingElement || document.documentElement || document.body;
      const scrollLeft = scrollElement ? scrollElement.scrollLeft : 0;
      const scrollTop = scrollElement ? scrollElement.scrollTop : 0;

      // Find the trailing BR if it exists
      const next = container.nextElementSibling;
      container.remove();
      if (next && next.tagName === 'BR') next.remove();

      // Trigger auto-save
      if (window.valleysManager) {
        window.valleysManager.handleAutoSave();
      }

      requestAnimationFrame(() => {
        if (scrollElement?.scrollTo) {
          scrollElement.scrollTo({ left: scrollLeft, top: scrollTop });
        } else {
          scrollElement.scrollLeft = scrollLeft;
          scrollElement.scrollTop = scrollTop;
        }
        if (window.scrollX !== scrollLeft || window.scrollY !== scrollTop) {
          window.scrollTo(scrollLeft, scrollTop);
        }
      });
    });
  }

  container.addEventListener('click', (e) => {
    if (removeBtn && (e.target === removeBtn || removeBtn.contains(e.target))) return;
    container.classList.toggle('show-remove');
  });
}

// Auth Manager - handles user authentication
class AuthManager {
  constructor() {
    this.user = null;
    this.modal = document.getElementById('auth-modal');
    this.accountModal = document.getElementById('account-modal');
    this.authTitle = document.getElementById('auth-modal-title');
    this.emailInput = document.getElementById('auth-email');
    this.passwordInput = document.getElementById('auth-password');
    this.submitBtn = document.getElementById('auth-submit-btn');
    this.errorEl = document.getElementById('auth-error');
    this.accountEmailEl = document.getElementById('account-email');
    this.sidebarAccountName = document.getElementById('sidebar-account-name');
    this.sidebarAccountPlan = document.getElementById('sidebar-account-plan');
    this.sidebarAvatar = document.getElementById('sidebar-avatar');

    // User Menu Elements
    this.userMenuName = document.getElementById('user-menu-name');
    this.userMenuEmail = document.getElementById('user-menu-email');
    this.userMenuAvatar = document.getElementById('user-menu-avatar');

    this.signoutBtn = document.getElementById('signout-btn');
    this.deleteAccountBtn = document.getElementById('delete-account-btn');
    this.currentTab = 'signin';

    this.init();
  }

  async init() {
    // Wait for supabase to be available
    await this.waitForSupabase();

    // Check for existing session
    const { data: { session } } = await window.supabase.auth.getSession();
    if (session) {
      this.user = session.user;
      this.updateMenuState();

      // Load valleys on initial session restore
      if (window.valleysManager) {
        window.valleysManager.loadValleys();
      }
    }

    // Listen for auth state changes
    window.supabase.auth.onAuthStateChange((event, session) => {
      this.user = session?.user || null;
      this.updateMenuState();

      if (event === 'SIGNED_IN') {
        this.closeModal();
        // Reload valleys if manager exists
        if (window.valleysManager) {
          window.valleysManager.loadValleys();
        }
      }
      if (event === 'SIGNED_OUT') {
        // Clear valleys list
        if (window.valleysManager) {
          window.valleysManager.valleys = [];
          window.valleysManager.renderList();
        }
      }
    });

    this.bindEvents();
  }

  waitForSupabase() {
    return new Promise((resolve) => {
      if (window.supabase) {
        resolve();
      } else {
        const check = setInterval(() => {
          if (window.supabase) {
            clearInterval(check);
            resolve();
          }
        }, 50);
      }
    });
  }

  bindEvents() {
    // Auth modal close
    const closeBtn = document.getElementById('auth-modal-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.closeModal());
    }
    if (this.modal) {
      this.modal.addEventListener('click', (e) => {
        if (e.target === this.modal) this.closeModal();
      });
    }

    // Tab switching
    document.querySelectorAll('.auth-tab').forEach(tab => {
      tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
    });

    // Form submission
    if (this.submitBtn) {
      this.submitBtn.addEventListener('click', () => this.handleSubmit());
    }

    // Enter key submits form
    if (this.emailInput) {
      this.emailInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.handleSubmit();
      });
    }
    if (this.passwordInput) {
      this.passwordInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.handleSubmit();
      });
    }

    // Google sign in
    const googleBtn = document.getElementById('google-signin-btn');
    if (googleBtn) {
      googleBtn.addEventListener('click', () => this.signInWithGoogle());
    }

    // Account modal
    const accountCloseBtn = document.getElementById('account-modal-close');
    if (accountCloseBtn) {
      accountCloseBtn.addEventListener('click', () => this.closeAccountModal());
    }
    if (this.accountModal) {
      this.accountModal.addEventListener('click', (e) => {
        if (e.target === this.accountModal) this.closeAccountModal();
      });
    }

    // Sign out
    if (this.signoutBtn) {
      this.signoutBtn.addEventListener('click', () => {
        if (this.user) {
          this.signOut();
        } else {
          this.closeAccountModal();
          this.openModal();
        }
      });
    }

    if (this.deleteAccountBtn) {
      this.deleteAccountBtn.addEventListener('click', () => this.deleteAccount());
    }

    // Subscription buttons
    const upgradeBtn = document.getElementById('upgrade-btn');
    if (upgradeBtn) {
      upgradeBtn.addEventListener('click', () => this.handleUpgrade());
    }

    const buyCreditsBtn = document.getElementById('buy-credits-btn');
    if (buyCreditsBtn) {
      buyCreditsBtn.addEventListener('click', () => this.handleBuyCredits());
    }

    // Escape key closes modals
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (this.modal?.classList.contains('visible')) {
          this.closeModal();
        }
        if (this.accountModal?.classList.contains('visible')) {
          this.closeAccountModal();
        }
      }
    });
  }

  switchTab(tab) {
    this.currentTab = tab;
    document.querySelectorAll('.auth-tab').forEach(t => {
      t.classList.toggle('active', t.dataset.tab === tab);
    });
    if (this.authTitle) {
      this.authTitle.textContent = tab === 'signin' ? 'Sign In' : 'Sign Up';
    }
    if (this.submitBtn) {
      this.submitBtn.textContent = tab === 'signin' ? 'Sign In' : 'Sign Up';
    }
    if (this.errorEl) {
      this.errorEl.textContent = '';
      this.errorEl.classList.remove('success');
    }
  }

  async handleSubmit() {
    const email = this.emailInput?.value.trim();
    const password = this.passwordInput?.value;

    if (!email || !password) {
      this.showError('Please fill in all fields');
      return;
    }

    if (this.submitBtn) this.submitBtn.disabled = true;
    this.showError('');

    try {
      if (this.currentTab === 'signin') {
        const { error } = await window.supabase.auth.signInWithPassword({
          email,
          password
        });
        if (error) throw error;
      } else {
        const { error } = await window.supabase.auth.signUp({
          email,
          password
        });
        if (error) throw error;
        this.showError('Check your email to confirm your account', true);
      }
    } catch (error) {
      this.showError(error.message);
    } finally {
      if (this.submitBtn) this.submitBtn.disabled = false;
    }
  }

  showError(message, isSuccess = false) {
    if (this.errorEl) {
      this.errorEl.textContent = message;
      this.errorEl.classList.toggle('success', isSuccess);
    }
  }

  async signInWithGoogle() {
    const { error } = await window.supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin
      }
    });
    if (error) {
      this.showError(error.message);
    }
  }

  async signOut() {
    await window.supabase.auth.signOut();
    this.closeAccountModal();
  }

  async deleteAccount() {
    if (!confirm('Are you sure you want to delete your account? This will delete all your valleys and cannot be undone.')) {
      return;
    }

    try {
      const { data: { session } } = await window.supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch(CONFIG.API_AUTH_DELETE, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${session.access_token}`
        }
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to delete account');
      }

      await window.supabase.auth.signOut();
      this.closeAccountModal();
    } catch (error) {
      alert('Failed to delete account: ' + error.message);
    }
  }

  updateMenuState() {
    const profileBtn = document.querySelector('.profile-menu-btn');
    const profileLabel = profileBtn?.querySelector('.menu-label');
    const profileIcon = profileBtn?.querySelector('.material-symbols-outlined');

    if (this.user) {
      if (profileLabel) profileLabel.textContent = 'Account';
      if (profileIcon) profileIcon.textContent = 'account_circle';
      if (this.sidebarAccountName) this.sidebarAccountName.textContent = this.user.email;
      if (this.sidebarAvatar) this.sidebarAvatar.textContent = (this.user.email?.[0] || 'P').toUpperCase();

      // Update User Menu
      if (this.userMenuName) this.userMenuName.textContent = this.user.user_metadata?.full_name || this.user.email?.split('@')[0] || 'Account';
      if (this.userMenuEmail) this.userMenuEmail.textContent = this.user.email;
      if (this.userMenuAvatar) this.userMenuAvatar.textContent = (this.user.email?.[0] || 'P').toUpperCase();

      if (this.signoutBtn) this.signoutBtn.textContent = 'Sign Out';
      if (this.deleteAccountBtn) this.deleteAccountBtn.disabled = false;
    } else {
      if (profileLabel) profileLabel.textContent = 'Sign In';
      if (profileIcon) profileIcon.textContent = 'person';
      if (this.sidebarAccountName) this.sidebarAccountName.textContent = 'Guest';
      if (this.sidebarAvatar) this.sidebarAvatar.textContent = 'PV';

      // Update User Menu (Guest)
      if (this.userMenuName) this.userMenuName.textContent = 'Guest';
      if (this.userMenuEmail) this.userMenuEmail.textContent = 'Tap to sign in';
      if (this.userMenuAvatar) this.userMenuAvatar.textContent = 'PV';

      if (this.signoutBtn) this.signoutBtn.textContent = 'Sign In';
      if (this.deleteAccountBtn) this.deleteAccountBtn.disabled = true;
    }
  }

  openModal() {
    if (this.modal) {
      this.modal.classList.add('visible');
      if (this.emailInput) this.emailInput.value = '';
      if (this.passwordInput) this.passwordInput.value = '';
      this.showError('');
      this.switchTab('signin');
    }
  }

  closeModal() {
    if (this.modal) {
      this.modal.classList.remove('visible');
    }
  }

  openAccountModal() {
    if (!this.accountModal) return;
    if (this.accountEmailEl) {
      this.accountEmailEl.textContent = this.user?.email || 'Sign in to manage your account';
    }
    this.accountModal.classList.add('visible');
    this.loadSubscriptionInfo();
  }

  closeAccountModal() {
    if (this.accountModal) {
      this.accountModal.classList.remove('visible');
    }
  }

  isAuthenticated() {
    return !!this.user;
  }

  getUserId() {
    return this.user?.id || null;
  }

  async getAccessToken() {
    const { data: { session } } = await window.supabase.auth.getSession();
    return session?.access_token || null;
  }

  async loadSubscriptionInfo() {
    if (!this.user) return;

    try {
      const { data: { session } } = await window.supabase.auth.getSession();
      if (!session) return;

      // Fetch subscription and credits info from Supabase
      const [subResult, creditsResult] = await Promise.all([
        window.supabase.from('user_subscriptions').select('*').eq('user_id', this.user.id).single(),
        window.supabase.from('user_credits').select('*').eq('user_id', this.user.id).single()
      ]);

      const subscription = subResult.data;
      const credits = creditsResult.data?.credits || 0;
      const tier = subscription?.tier === 'pro' && subscription?.status === 'active' ? 'pro' : 'free';

      this.updateSubscriptionUI(tier, credits);
    } catch (error) {
      console.error('Failed to load subscription info:', error);
    }
  }

  updateSubscriptionUI(tier, credits) {
    const tierEl = document.getElementById('subscription-tier');
    const priceEl = document.getElementById('subscription-price');
    const badgeEl = document.getElementById('subscription-badge');
    const imagesEl = document.getElementById('feature-images');
    const valleysEl = document.getElementById('feature-valleys');
    const creditsEl = document.getElementById('feature-credits');
    const upgradeRow = document.getElementById('upgrade-row');

    if (tier === 'pro') {
      if (tierEl) tierEl.textContent = 'Pro Plan';
      if (priceEl) priceEl.textContent = '$5.99/month';
      if (badgeEl) {
        badgeEl.textContent = 'Pro';
        badgeEl.style.background = 'var(--accent)';
      }
      if (imagesEl) imagesEl.textContent = '30/month';
      if (valleysEl) valleysEl.textContent = '20 max';
      if (upgradeRow) upgradeRow.style.display = 'none';
    } else {
      if (tierEl) tierEl.textContent = 'Free Plan';
      if (priceEl) priceEl.textContent = '$0/month';
      if (badgeEl) {
        badgeEl.textContent = 'Free';
        badgeEl.style.background = '#666';
      }
      if (imagesEl) imagesEl.textContent = '0/month';
      if (valleysEl) valleysEl.textContent = '0';
      if (upgradeRow) upgradeRow.style.display = 'flex';
    }

    if (creditsEl) creditsEl.textContent = credits;
  }

  async handleUpgrade() {
    if (!this.user) {
      alert('Please sign in to upgrade');
      this.openModal();
      return;
    }

    try {
      const { data: { session } } = await window.supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ product: 'pro' })
      });

      if (!response.ok) throw new Error('Failed to create checkout');

      const { checkoutUrl } = await response.json();
      window.location.href = checkoutUrl;
    } catch (error) {
      alert('Failed to start checkout: ' + error.message);
    }
  }

  async handleBuyCredits() {
    if (!this.user) {
      alert('Please sign in to buy credits');
      this.openModal();
      return;
    }

    try {
      const { data: { session } } = await window.supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify({ product: 'credits' })
      });

      if (!response.ok) throw new Error('Failed to create checkout');

      const { checkoutUrl } = await response.json();
      window.location.href = checkoutUrl;
    } catch (error) {
      alert('Failed to start checkout: ' + error.message);
    }
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.brainManager = new BrainManager();
  window.contextManager = new ContextManager();
  window.predictionManager = new PredictionManager();
  window.valleysManager = new ValleysManager();
  window.authManager = new AuthManager();

  // Modal handling
  const modal = document.getElementById('about-modal');
  const logo = document.querySelector('.logo');
  const modalClose = document.getElementById('about-modal-close');

  const openModal = () => modal.classList.add('visible');
  /* Logo click listener removed as requested */

  if (modalClose) {
    modalClose.addEventListener('click', () => {
      modal.classList.remove('visible');
    });
  }

  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('visible');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal.classList.contains('visible')) {
      modal.classList.remove('visible');
    }
  });

  // Settings modal navigation
  const settingsNavButtons = document.querySelectorAll('.settings-nav-btn');
  const settingsSections = document.querySelectorAll('.settings-section');
  settingsNavButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const panel = btn.dataset.settingsPanel;
      settingsNavButtons.forEach((navBtn) => navBtn.classList.toggle('active', navBtn === btn));
      settingsSections.forEach((section) => {
        section.classList.toggle('active', section.dataset.settingsPanel === panel);
      });
    });
  });

  // MENU FUNCTIONALITY
  // MENU FUNCTIONALITY
  const settingsBtn = document.getElementById('settings-btn');
  const settingsIcon = settingsBtn.querySelector('.material-symbols-outlined');

  const menuBtn = document.getElementById('menu-btn');
  const menuIcon = menuBtn ? menuBtn.querySelector('.material-symbols-outlined') : null;

  // Initialize menu icon for desktop
  if (window.innerWidth >= CONFIG.DESKTOP_BREAKPOINT_PX && menuIcon) {
    // Icon is handled by CSS class now
  }

  const rightMenuOverlay = document.querySelector('.right-menu-overlay');
  const userMenuOverlay = document.querySelector('.user-menu-overlay');
  const sidebar = document.getElementById('sidebar');
  const sidebarBackdrop = document.getElementById('sidebar-backdrop');

  const selectMenuButtons = Array.from(document.querySelectorAll('.select-menu-btn'));
  const editor = document.querySelector('.editor');
  let menuReadyTimeout = null;

  const openMenu = (overlay, icon, openIconName = 'close') => {
    overlay.classList.add('visible');
    if (icon) icon.textContent = openIconName;
    if (menuReadyTimeout) {
      clearTimeout(menuReadyTimeout);
    }
    menuReadyTimeout = setTimeout(() => {
      overlay.classList.add('menu-ready');
      menuReadyTimeout = null;
    }, 120);
  };

  const closeMenu = () => {
    if (rightMenuOverlay && rightMenuOverlay.classList.contains('visible')) {
      if (menuReadyTimeout) {
        clearTimeout(menuReadyTimeout);
        menuReadyTimeout = null;
      }
      rightMenuOverlay.classList.remove('menu-ready');
      rightMenuOverlay.classList.remove('visible');
      if (settingsIcon) settingsIcon.textContent = 'more_horiz';
    }
    if (userMenuOverlay && userMenuOverlay.classList.contains('visible')) {
      if (menuReadyTimeout) {
        clearTimeout(menuReadyTimeout);
        menuReadyTimeout = null;
      }
      userMenuOverlay.classList.remove('menu-ready');
      userMenuOverlay.classList.remove('visible');
    }
  };

  const openSidebarDrawer = () => {
    document.body.classList.add('sidebar-open');
  };

  const closeSidebarDrawer = () => {
    document.body.classList.remove('sidebar-open');
  };

  const closeAllMenus = () => {
    closeMenu();
    closeSidebarDrawer();
    window.contextManager?.closeSideMenu();
  };

  settingsBtn.addEventListener('click', () => {
    if (window.predictionManager.selectModeActive) {
      window.predictionManager.disableSelectMode();
      if (settingsIcon) settingsIcon.textContent = 'edit';
      return;
    }

    // Toggle side menu
    window.contextManager.toggleSideMenu();
  });

  if (menuBtn) {
    menuBtn.addEventListener('click', () => {
      // Desktop toggle
      if (window.innerWidth >= CONFIG.DESKTOP_BREAKPOINT_PX) {
        document.body.classList.toggle('sidebar-collapsed');
        return;
      }

      if (document.body.classList.contains('sidebar-open')) {
        closeSidebarDrawer();
      } else {
        closeMenu();
        closeSidebarDrawer();
        openSidebarDrawer();
      }
    });
  }

  // Sidebar close button and logo click handlers
  const sidebarCloseBtn = document.getElementById('sidebar-close-btn');
  const sidebarCreateBtn = document.getElementById('sidebar-create-valley-btn');

  const collapseSidebar = () => {
    if (window.innerWidth >= CONFIG.DESKTOP_BREAKPOINT_PX) {
      document.body.classList.add('sidebar-collapsed');
    } else {
      closeSidebarDrawer();
    }
  };

  if (sidebarCreateBtn) {
    sidebarCreateBtn.addEventListener('click', async () => {
      await window.valleysManager.newValley();
      closeSidebarDrawer();
    });
  }

  if (sidebarCloseBtn) {
    sidebarCloseBtn.addEventListener('click', collapseSidebar);
  }

  if (rightMenuOverlay) {
    rightMenuOverlay.addEventListener('click', (e) => {
      if (e.target === rightMenuOverlay) {
        closeMenu();
      }
    });
  }

  if (userMenuOverlay) {
    userMenuOverlay.addEventListener('click', (e) => {
      if (e.target === userMenuOverlay) {
        closeMenu();
      }
    });
  }

  const sidebarAccountTrigger = document.getElementById('sidebar-account-trigger');
  if (sidebarAccountTrigger) {
    sidebarAccountTrigger.addEventListener('click', () => {
      if (userMenuOverlay.classList.contains('visible')) {
        closeMenu();
      } else {
        closeMenu(); // Close other menus
        openMenu(userMenuOverlay);
      }
    });
  }

  const userSettingsBtn = document.getElementById('user-settings-btn');
  if (userSettingsBtn) {
    userSettingsBtn.addEventListener('click', () => {
      closeAllMenus();
      window.authManager?.openAccountModal();
    });
  }

  const userLogoutBtn = document.getElementById('user-logout-btn');
  if (userLogoutBtn) {
    userLogoutBtn.addEventListener('click', () => {
      closeAllMenus();
      if (window.authManager?.isAuthenticated()) {
        window.authManager.signOut();
      } else {
        window.authManager?.openModal();
      }
    });
  }

  // Edit Name Modal Logic
  const userMenuHeader = document.getElementById('user-menu-header');
  const editNameModal = document.getElementById('edit-name-modal');
  const editNameClose = document.getElementById('edit-name-close');
  const editNameInput = document.getElementById('edit-user-name-input');
  const saveNameBtn = document.getElementById('save-user-name-btn');

  if (userMenuHeader) {
    userMenuHeader.addEventListener('click', () => {
      if (!window.authManager?.isAuthenticated()) {
        closeAllMenus();
        window.authManager?.openModal();
        return;
      }
      closeAllMenus();
      if (editNameModal) {
        editNameModal.classList.add('visible');
        if (editNameInput) {
          const user = window.authManager.user;
          editNameInput.value = user.user_metadata?.full_name || user.email?.split('@')[0] || '';
          editNameInput.focus();
        }
      }
    });
  }

  const closeEditNameModal = () => {
    if (editNameModal) editNameModal.classList.remove('visible');
  };

  if (editNameClose) editNameClose.addEventListener('click', closeEditNameModal);

  if (editNameModal) {
    editNameModal.addEventListener('click', (e) => {
      if (e.target === editNameModal) closeEditNameModal();
    });
  }

  if (saveNameBtn) {
    saveNameBtn.addEventListener('click', async () => {
      const newName = editNameInput?.value.trim();
      if (!newName) return;

      saveNameBtn.disabled = true;
      saveNameBtn.textContent = 'Saving...';

      try {
        const { error } = await window.supabase.auth.updateUser({
          data: { full_name: newName }
        });

        if (error) throw error;

        // Update local state immediately
        if (window.authManager.user) {
          window.authManager.user.user_metadata = { ...window.authManager.user.user_metadata, full_name: newName };
          window.authManager.updateMenuState();
        }

        closeEditNameModal();
      } catch (error) {
        console.error('Error updating name:', error);
        alert('Failed to update name');
      } finally {
        saveNameBtn.disabled = false;
        saveNameBtn.textContent = 'Save';
      }
    });
  }

  if (sidebarBackdrop) {
    sidebarBackdrop.addEventListener('click', closeSidebarDrawer);
  }

  window.addEventListener('resize', () => {
    if (window.innerWidth >= CONFIG.DESKTOP_BREAKPOINT_PX) {
      closeSidebarDrawer();
    }
  });

  // Swipe to open/close sidebar on mobile
  (function initSidebarSwipe() {
    let touchStartX = null;
    let touchStartY = null;
    let isSwiping = false;

    const EDGE_THRESHOLD = 30; // pixels from left edge to trigger
    const SWIPE_THRESHOLD = 50; // minimum swipe distance

    document.addEventListener('touchstart', (e) => {
      // Only enable swipe on mobile
      if (window.innerWidth >= CONFIG.DESKTOP_BREAKPOINT_PX) return;

      const touch = e.touches[0];
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;

      // Track swipes starting from left edge (to open) or anywhere when sidebar is open (to close)
      const sidebarOpen = document.body.classList.contains('sidebar-open');
      isSwiping = touchStartX <= EDGE_THRESHOLD || sidebarOpen;
    }, { passive: true });

    document.addEventListener('touchend', (e) => {
      if (!isSwiping || touchStartX === null) return;

      // Only process on mobile
      if (window.innerWidth >= CONFIG.DESKTOP_BREAKPOINT_PX) {
        touchStartX = null;
        touchStartY = null;
        isSwiping = false;
        return;
      }

      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - touchStartX;
      const deltaY = Math.abs(touch.clientY - touchStartY);

      // Must be primarily horizontal swipe
      if (Math.abs(deltaX) > deltaY && Math.abs(deltaX) > SWIPE_THRESHOLD) {
        const sidebarOpen = document.body.classList.contains('sidebar-open');

        if (deltaX > 0 && !sidebarOpen && touchStartX <= EDGE_THRESHOLD) {
          // Swipe right from edge - open sidebar
          openSidebarDrawer();
        } else if (deltaX < 0 && sidebarOpen) {
          // Swipe left - close sidebar
          closeSidebarDrawer();
        }
      }

      // Reset
      touchStartX = null;
      touchStartY = null;
      isSwiping = false;
    }, { passive: true });
  })();

  // Swipe to open/close right side menu on mobile
  (function initRightMenuSwipe() {
    let touchStartX = null;
    let touchStartY = null;
    let isSwiping = false;

    const EDGE_THRESHOLD = 30; // pixels from right edge to trigger
    const SWIPE_THRESHOLD = 50; // minimum swipe distance

    document.addEventListener('touchstart', (e) => {
      // Only enable swipe on mobile
      if (window.innerWidth >= CONFIG.DESKTOP_BREAKPOINT_PX) return;

      const touch = e.touches[0];
      touchStartX = touch.clientX;
      touchStartY = touch.clientY;

      // Track swipes starting from right edge (to open) or anywhere when menu is open (to close)
      const sideMenuOpen = document.body.classList.contains('side-menu-open');
      isSwiping = touchStartX >= window.innerWidth - EDGE_THRESHOLD || sideMenuOpen;
    }, { passive: true });

    document.addEventListener('touchend', (e) => {
      if (!isSwiping || touchStartX === null) return;

      // Only process on mobile
      if (window.innerWidth >= CONFIG.DESKTOP_BREAKPOINT_PX) {
        touchStartX = null;
        touchStartY = null;
        isSwiping = false;
        return;
      }

      const touch = e.changedTouches[0];
      const deltaX = touch.clientX - touchStartX;
      const deltaY = Math.abs(touch.clientY - touchStartY);

      // Must be primarily horizontal swipe
      if (Math.abs(deltaX) > deltaY && Math.abs(deltaX) > SWIPE_THRESHOLD) {
        const sideMenuOpen = document.body.classList.contains('side-menu-open');

        if (deltaX < 0 && !sideMenuOpen && touchStartX >= window.innerWidth - EDGE_THRESHOLD) {
          // Swipe left from right edge - open menu
          window.contextManager.openSideMenu();
        } else if (deltaX > 0 && sideMenuOpen) {
          // Swipe right - close menu
          window.contextManager.closeSideMenu();
        }
      }

      // Reset
      touchStartX = null;
      touchStartY = null;
      isSwiping = false;
    }, { passive: true });
  })();

  // Left menu specific items
  const aboutMenuBtn = document.querySelector('.about-menu-btn');
  if (aboutMenuBtn) {
    aboutMenuBtn.addEventListener('click', () => {
      openModal();
      closeMenu();
    });
  }

  // Profile/Sign In menu button
  const profileMenuBtn = document.querySelector('.profile-menu-btn');
  if (profileMenuBtn) {
    profileMenuBtn.addEventListener('click', () => {
      closeMenu();
      if (window.authManager?.isAuthenticated()) {
        window.authManager.openAccountModal();
      } else {
        window.authManager?.openModal();
      }
    });
  }

  const bindMenuButtons = (selector, handler) => {
    document.querySelectorAll(selector).forEach((btn) => {
      btn.addEventListener('click', (event) => handler(event, btn));
    });
  };

  bindMenuButtons('.share-menu-btn', async (_event, btn) => {
    const text = window.predictionManager.getEditorText();
    if (!text) {
      closeAllMenus();
      return;
    }

    const shareLabel = btn.querySelector('.menu-label');
    const originalText = shareLabel ? shareLabel.textContent : 'Share';

    let imageFile = null;
    if (editor && editor.querySelector('img')) {
      const editorImg = editor.querySelector('img');
      try {
        const response = await fetch(editorImg.src);
        const blob = await response.blob();
        imageFile = new File([blob], 'image.png', { type: blob.type || 'image/png' });
      } catch {
        // Image conversion failed, continue without image
      }
    }

    try {
      if (navigator.share) {
        const shareData = { text };
        if (imageFile && navigator.canShare && navigator.canShare({ files: [imageFile] })) {
          shareData.files = [imageFile];
        }
        await navigator.share(shareData);
        closeAllMenus();
      } else {
        await navigator.clipboard.writeText(text);
        if (shareLabel) shareLabel.textContent = 'Copied!';
        setTimeout(() => {
          if (shareLabel) shareLabel.textContent = originalText;
          closeAllMenus();
        }, 800);
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        try {
          await navigator.clipboard.writeText(text);
          if (shareLabel) shareLabel.textContent = 'Copied!';
          setTimeout(() => {
            if (shareLabel) shareLabel.textContent = originalText;
            closeAllMenus();
          }, 800);
        } catch (copyErr) {
          console.error('Failed to share or copy:', copyErr);
          closeAllMenus();
        }
      } else {
        closeAllMenus();
      }
    }
  });

  bindMenuButtons('.clear-menu-btn', () => {
    window.predictionManager.removeInlinePrediction();
    editor.textContent = '';
    editor.focus();
    editor.dispatchEvent(new Event('input'));
    closeAllMenus();
  });

  const updateSelectButtons = window.updateSelectButtons = () => {
    selectMenuButtons.forEach((btn) => {
      btn.classList.toggle('active', window.predictionManager.selectModeActive);
      const icon = btn.querySelector('.material-symbols-outlined');
      if (icon) {
        if (window.predictionManager.selectModeActive) {
          icon.textContent = 'check';
        } else {
          icon.textContent = 'text_select_end';
        }
      }
    });
  };

  selectMenuButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (window.predictionManager.selectModeActive) {
        // Confirm selection (even if empty/no selection made)
        window.predictionManager.confirmSelectSelection();
      } else {
        window.predictionManager.enableSelectMode();
      }
      updateSelectButtons();
      closeAllMenus();
    });
  });

  bindMenuButtons('.copy-all-btn', async (_event, btn) => {
    const editor = document.querySelector('.editor');
    if (!editor) return;

    // Clone to strip predictions before copying
    const clone = editor.cloneNode(true);
    const predictions = clone.querySelectorAll('.inline-prediction, .prediction-ghost');
    predictions.forEach(p => p.remove());

    const text = clone.textContent || '';

    try {
      await navigator.clipboard.writeText(text);

      // Visual feedback
      const icon = btn.querySelector('.material-symbols-outlined');
      const originalIcon = icon.textContent;
      icon.textContent = 'check';
      btn.classList.add('active');

      setTimeout(() => {
        icon.textContent = originalIcon;
        btn.classList.remove('active');
      }, 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }

    closeAllMenus();
  });

  bindMenuButtons('.files-menu-btn', () => {
    window.contextManager.openFilesModal();
    closeAllMenus();
  });

  bindMenuButtons('.rules-menu-btn', () => {
    window.contextManager.openRulesModal();
    closeAllMenus();
  });

  bindMenuButtons('.toggle-prediction-btn', (_event, btn) => {
    const isEnabled = window.predictionManager.toggleEnabled();
    const label = btn.querySelector('.menu-label');
    const icon = btn.querySelector('.material-symbols-outlined');

    if (isEnabled) {
      if (label) label.textContent = 'Auto-prediction';
      if (icon) icon.textContent = 'auto_fix_high';
      btn.classList.remove('disabled');
    } else {
      if (label) label.textContent = 'Auto-prediction (Off)';
      if (icon) icon.textContent = 'auto_fix_off';
      btn.classList.add('disabled');
    }
    closeAllMenus();
  });

  const sidebarNewValleyBtn = document.getElementById('sidebar-new-valley');
  if (sidebarNewValleyBtn) {
    sidebarNewValleyBtn.addEventListener('click', async () => {
      await window.valleysManager.newValley();
      closeAllMenus();
    });
  }

  // Close valleys modal on Escape
  document.addEventListener('keydown', (e) => {
    const valleysModal = document.getElementById('valleys-modal');
    if (e.key === 'Escape' && valleysModal?.classList.contains('visible')) {
      window.valleysManager.closeModal();
    }
  });

  // Create image button and guidance modal
  const createImageButtons = Array.from(document.querySelectorAll('.create-image-btn'));
  const primaryCreateImageBtn = createImageButtons[0] || null;
  const imageGuidanceModal = document.getElementById('image-guidance-modal');
  const imageGuidanceTextarea = document.getElementById('image-guidance-textarea');
  const applyGuidanceBtn = document.getElementById('apply-guidance-btn');
  const skipGuidanceBtn = document.getElementById('skip-guidance-btn');
  const imageGuidanceCloseBtn = document.getElementById('image-guidance-close');

  // Function to generate image with optional guidance
  async function generateImageWithGuidance(text, guidance = '', style = 'realistic') {
    // Remove any existing predictions and cancel pending requests
    window.predictionManager.cancelPending();
    window.predictionManager.removeInlinePrediction();

    // Add loading state
    primaryCreateImageBtn.classList.add('loading');
    const imageIcon = primaryCreateImageBtn.querySelector('.material-symbols-outlined');
    if (imageIcon) imageIcon.textContent = 'progress_activity';

    // Insert loading placeholder into editor
    const placeholder = document.createElement('div');
    placeholder.className = 'image-loading-placeholder';
    placeholder.innerHTML = '<span class="material-symbols-outlined">progress_activity</span> Creating image...';
    editor.appendChild(placeholder);

    // Add a break and move cursor after the placeholder immediately
    const br = document.createElement('br');
    editor.appendChild(br);
    window.predictionManager.placeCursorAfterNode(br);

    try {
      if (!window.authManager.isAuthenticated()) {
        window.authManager.openModal();
        throw new Error('Please sign in to generate images');
      }

      const token = await window.authManager.getAccessToken();
      console.log('Image generation started for text:', text.substring(0, 50) + '...');
      const response = await fetch(CONFIG.API_GENERATE_IMAGE, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ text, guidance, style })
      });

      if (response.status === 401) {
        window.authManager.openModal();
        throw new Error('Please sign in to generate images');
      }

      if (response.status === 403) {
        const data = await response.json();
        if (data.upgradeRequired) {
          if (confirm(data.error + '\n\nWould you like to upgrade to Pro now?')) {
            window.authManager.openAccountModal();
          }
        }
        throw new Error(data.error || 'Upgrade required');
      }

      if (response.status === 429) {
        const data = await response.json();
        if (data.needsCredits) {
          if (confirm(data.error + '\n\nWould you like to buy more credits?')) {
            window.authManager.openAccountModal();
          }
        }
        throw new Error(data.error || "You've reached your limit");
      }

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Image generation request failed:', response.status, errorText);
        throw new Error(`Image generation failed: ${response.status}`);
      }

      const data = await response.json();
      console.log('Image generation response data:', data);

      // Show remaining count if present
      if (typeof data.remaining === 'number' && data.remaining < 5) {
        console.log(`Images remaining today: ${data.remaining}`);
        // Optional: show a small toast or notification
      }

      // Remove placeholder
      placeholder.remove();

      // Get the image URL or base64 data from the response
      const imageData = data.image;
      if (imageData) {
        // Create container for image with remove button
        const container = document.createElement('div');
        container.className = 'editor-image-container';
        container.contentEditable = 'false';

        // Detect if it's already a base64 string, an object with url/b64, or just a URL
        let finalSrc = '';
        if (typeof imageData === 'string') {
          finalSrc = imageData; // Could be URL or data:image/...
        } else if (imageData.b64_json) {
          finalSrc = `data:image/png;base64,${imageData.b64_json}`;
        } else {
          finalSrc = imageData.url || imageData.data?.[0]?.url || '';
        }

        container.innerHTML = `
          <img class="editor-image" src="${finalSrc}" alt="Generated illustration">
          <button class="editor-image-remove"><span class="material-symbols-outlined">close</span></button>
        `;

        setupImageContainer(container);
        editor.appendChild(container);

        // Add line break after image for continued writing
        editor.appendChild(document.createElement('br'));

        // Trigger auto-save since DOM was modified programmatically
        if (window.valleysManager) {
          window.valleysManager.handleAutoSave();
        }
      }
    } catch (error) {
      console.error('Image generation error:', error);
      placeholder.innerHTML = 'Failed to generate image';
      setTimeout(() => placeholder.remove(), CONFIG.TIMEOUT_MESSAGE_MS);
    } finally {
      // Remove loading state
      if (primaryCreateImageBtn) primaryCreateImageBtn.classList.remove('loading');
      if (imageIcon) imageIcon.textContent = 'image';
    }
  }

  // Store text for image generation
  let pendingImageText = '';

  if (createImageButtons.length && imageGuidanceModal) {
    const authView = document.getElementById('image-guidance-auth-view');
    const unauthView = document.getElementById('image-guidance-unauth-view');
    const unauthSignupBtn = document.getElementById('image-unauth-signup-btn');
    const unauthSigninBtn = document.getElementById('image-unauth-signin-btn');

    createImageButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const text = window.predictionManager.getEditorText();
        pendingImageText = text || '';
        closeAllMenus();

        // Check authentication state
        const isAuth = window.authManager.isAuthenticated();
        if (isAuth) {
          if (authView) authView.style.display = 'flex';
          if (unauthView) unauthView.style.display = 'none';
        } else {
          if (authView) authView.style.display = 'none';
          if (unauthView) unauthView.style.display = 'flex';
        }

        imageGuidanceModal.classList.add('visible');

        if (isAuth && imageGuidanceTextarea) {
          imageGuidanceTextarea.value = '';
          imageGuidanceTextarea.focus();
        }
      });
    });

    if (unauthSignupBtn) {
      unauthSignupBtn.addEventListener('click', () => {
        imageGuidanceModal.classList.remove('visible');
        window.authManager.switchTab('signup');
        window.authManager.openModal();
      });
    }

    if (unauthSigninBtn) {
      unauthSigninBtn.addEventListener('click', () => {
        imageGuidanceModal.classList.remove('visible');
        window.authManager.switchTab('signin');
        window.authManager.openModal();
      });
    }

    // Apply guidance button
    if (applyGuidanceBtn) {
      applyGuidanceBtn.addEventListener('click', () => {
        const guidance = imageGuidanceTextarea.value.trim();
        const styleSelect = document.getElementById('image-style-select');
        const style = styleSelect ? styleSelect.value : 'realistic';

        if (!pendingImageText && !guidance) {
          imageGuidanceTextarea.placeholder = "Please describe the image first...";
          imageGuidanceTextarea.focus();
          return;
        }

        imageGuidanceModal.classList.remove('visible');
        generateImageWithGuidance(pendingImageText, guidance, style);
      });
    }

    // Skip guidance button (now Cancel)
    if (skipGuidanceBtn) {
      skipGuidanceBtn.addEventListener('click', () => {
        imageGuidanceModal.classList.remove('visible');
      });
    }

    // Close button (cancel without generating)
    if (imageGuidanceCloseBtn) {
      imageGuidanceCloseBtn.addEventListener('click', () => {
        imageGuidanceModal.classList.remove('visible');
      });
    }

    // Close modal on backdrop click
    imageGuidanceModal.addEventListener('click', (e) => {
      if (e.target === imageGuidanceModal) {
        imageGuidanceModal.classList.remove('visible');
      }
    });

    // Close modal on Escape
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && imageGuidanceModal.classList.contains('visible')) {
        imageGuidanceModal.classList.remove('visible');
      }
    });
  }

  // Theme dissolve overlay helper
  const ensureThemeDissolveOverlay = (() => {
    let overlayEl = null;
    return () => {
      if (!overlayEl) {
        overlayEl = document.createElement('div');
        overlayEl.className = 'theme-dissolve-overlay';
        overlayEl.addEventListener('animationend', () => {
          overlayEl.classList.remove('active');
        });
        document.body.appendChild(overlayEl);
      }
      return overlayEl;
    };
  })();

  const playThemeDissolve = () => {
    const overlay = ensureThemeDissolveOverlay();
    const currentBg = getComputedStyle(document.body).backgroundColor || 'rgba(0,0,0,1)';
    overlay.style.background = currentBg;
    overlay.classList.remove('active');
    // Force reflow so animation can retrigger
    void overlay.offsetWidth;
    overlay.classList.add('active');
  };

  // Theme toggle button (in header or menu)
  const themeToggleButtons = Array.from(document.querySelectorAll('.theme-toggle-btn'));
  if (themeToggleButtons.length) {
    const updateThemeButtons = () => {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
      themeToggleButtons.forEach((btn) => {
        const themeIcon = btn.querySelector('.material-symbols-outlined');
        const themeLabel = btn.querySelector('.menu-label');
        if (themeIcon) {
          themeIcon.textContent = isDark ? 'light_mode' : 'dark_mode';
        }
        if (themeLabel) {
          themeLabel.textContent = isDark ? 'Light mode' : 'Dark mode';
        }
      });
    };

    themeToggleButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        const html = document.documentElement;
        const isCurrentlyDark = html.getAttribute('data-theme') === 'dark';
        playThemeDissolve();
        html.setAttribute('data-theme', isCurrentlyDark ? 'light' : 'dark');
        updateThemeButtons();
        closeAllMenus();
      });
    });

    updateThemeButtons();
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeMenu();
      window.contextManager?.closeSideMenu();
    }
  });

  // Also close context modal on Escape
  document.addEventListener('keydown', (e) => {
    const contextModal = document.getElementById('context-modal');
    if (e.key === 'Escape' && contextModal?.classList.contains('visible')) {
      window.contextManager.closeModal();
    }
  });
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .catch((err) => console.error('Service worker registration failed:', err));
  });
}
