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
  STORAGE_SESSION_ID: 'mindcomplete_session_id',
  STORAGE_FILES: 'mindcomplete_files',
  STORAGE_TOKENS: 'mindcomplete_tokens',
  STORAGE_RULES: 'mindcomplete_rules',
  STORAGE_STYLE: 'mindcomplete_style',
  STORAGE_CUSTOM_STYLE: 'mindcomplete_custom_style',

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
  API_PROJECTS: '/api/projects',
  API_AUTH_DELETE: '/api/auth/delete-account',
  API_GENERATE_IMAGE: '/api/generate-image',
};

// Global toast notification functions
let toastTimeout = null;

function showToast(message, duration = 1500) {
  let toast = document.querySelector('.toolbar-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toolbar-toast';
    document.body.appendChild(toast);
  }

  // Clear any pending hide
  if (toastTimeout) {
    clearTimeout(toastTimeout);
    toastTimeout = null;
  }

  toast.textContent = message;

  // Position centered above the toolbar
  const toolbar = document.querySelector('.editor-toolbar');
  if (toolbar) {
    const toolbarRect = toolbar.getBoundingClientRect();
    const toolbarCenter = toolbarRect.left + toolbarRect.width / 2;
    toast.style.left = `${toolbarCenter}px`;
  }

  toast.classList.add('visible');

  // Auto-hide after duration (0 = persistent until hideToast called)
  if (duration > 0) {
    toastTimeout = setTimeout(() => {
      toast.classList.remove('visible');
      toastTimeout = null;
    }, duration);
  }
}

function hideToast() {
  if (toastTimeout) {
    clearTimeout(toastTimeout);
    toastTimeout = null;
  }
  const toast = document.querySelector('.toolbar-toast');
  if (toast) {
    toast.classList.remove('visible');
  }
}

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
        // First click: set start point
        this.selectStartOffset = wordBounds.start;
        this.selectPreviewOffset = wordBounds.end;
        this.hoverWordEnd = null;
        this.selectionFixed = false;
        this.updatePredictionDisplay();
        this.setSelectionReady(false);
        this.showSelectToast('Select end');
      } else if (!this.selectionFixed) {
        // Second click: set end point and auto-apply
        if (wordBounds.end <= this.selectStartOffset) {
          this.selectPreviewOffset = this.selectStartOffset;
          this.selectStartOffset = wordBounds.start;
        } else {
          this.selectPreviewOffset = wordBounds.end;
        }
        // Auto-apply
        if (this.selectStartOffset !== this.selectPreviewOffset) {
          this.confirmSelectSelection();
        }
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

      if (this.selectStartOffset === null) {
        // First tap: set start point
        this.selectStartOffset = wordBounds.start;
        this.selectPreviewOffset = wordBounds.end;
        this.selectionFixed = false;
        this.updatePredictionDisplay();
        this.setSelectionReady(false);
        this.showSelectToast('Select end');
      } else {
        // Second tap: set end point and auto-apply
        this.updateSelectPreviewOffset(wordBounds);
        if (this.selectStartOffset !== this.selectPreviewOffset) {
          this.confirmSelectSelection();
        }
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

    // Split new segment into words, preserving whitespace
    const tokens = newSegment.split(/(\s+)/);

    tokens.forEach((token) => {
      if (!token) return;

      if (/^\s+$/.test(token)) {
        // Whitespace - append as text
        this.inlinePredictionEl.appendChild(document.createTextNode(token));
      } else {
        // Word - wrap in span with fade animation
        const span = document.createElement('span');
        span.textContent = token;
        span.className = 'word-fade prediction-remain';
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

    // Change button to X for cancel
    const selectBtn = document.querySelector('.select-menu-btn');
    if (selectBtn) {
      selectBtn.classList.add('active');
      const icon = selectBtn.querySelector('.material-symbols-outlined');
      if (icon) icon.textContent = 'close';
    }

    // Show toast notification
    this.showSelectToast('Select beginning');
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

    // Restore button icon
    const selectBtn = document.querySelector('.select-menu-btn');
    if (selectBtn) {
      selectBtn.classList.remove('active');
      const icon = selectBtn.querySelector('.material-symbols-outlined');
      if (icon) icon.textContent = 'text_select_end';
    }

    // Hide toast
    this.hideSelectToast();
  }

  handleSelectModeSelection(offset) {
    if (offset === null) return;

    if (this.selectStartOffset === null) {
      // First selection - set beginning
      this.selectStartOffset = offset;
      this.selectPreviewOffset = this.isMobile ? offset : null;
      this.updatePredictionDisplay();
      this.setSelectionReady(false);

      // Show "Select end" toast
      this.showSelectToast('Select end');
    } else {
      // Second selection - set end and auto-apply
      this.selectPreviewOffset = offset;
      this.updatePredictionDisplay();

      // Auto-apply if we have a valid range
      if (this.selectPreviewOffset !== this.selectStartOffset) {
        this.confirmSelectSelection();
      }
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

  showSelectToast(message) {
    showToast(message, 0); // Persistent until hideToast called
  }

  hideSelectToast() {
    hideToast();
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
    this.fileInput = document.getElementById('context-file-input');

    // Brain Panel Elements
    this.brainAttachBtn = document.getElementById('brain-attach-btn');
    this.brainSendBtn = document.getElementById('brain-send-btn');
    this.brainInputText = document.getElementById('brain-input-text');
    this.brainAttachmentPreview = document.getElementById('brain-attachment-preview');
    this.attachmentName = document.getElementById('attachment-name');
    this.removeAttachmentBtn = document.getElementById('remove-attachment-btn');

    // Menu buttons
    this.filesMenuBtn = document.querySelector('.files-menu-btn');
    this.rulesMenuBtn = document.querySelector('.rules-menu-btn');

    // Side menu elements
    this.sideMenu = document.getElementById('side-menu');
    this.sideMenuBackdrop = document.getElementById('side-menu-backdrop');
    this.sideMenuClose = document.getElementById('side-menu-close');

    // Side Menu Rules/Styles Elements (Critical for Editor Menu)
    this.sideMenuRulesTextarea = document.getElementById('side-menu-rules-textarea');
    this.sideMenuSaveRulesBtn = document.getElementById('side-menu-save-rules-btn');
    this.sideMenuClearRulesBtn = document.getElementById('side-menu-clear-rules-btn');

    this.sideMenuStyleDropdown = document.getElementById('side-menu-style-dropdown');
    this.sideMenuCustomStyleTextarea = document.getElementById('side-menu-custom-style-textarea');
    this.sideMenuSaveStyleBtn = document.getElementById('side-menu-save-style-btn');
    this.sideMenuClearStyleBtn = document.getElementById('side-menu-clear-style-btn');

    // Legacy/Unused elements binding kept to prevent errors if elements missing
    this.filesModal = document.getElementById('files-modal');
    this.sideMenuFilesList = document.getElementById('side-menu-files-list');

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

    // Brain Panel bindings REMOVED: Managed by BrainManager

    // File input change REMOVED: Managed by BrainManager

    // Setup drag and drop
    this.setupDragDrop(this.filesDropzone);
    this.setupDragDrop(this.filesDropzoneMobile);
    // this.setupDragDrop(this.sideMenu); // Disabled: Managed by BrainManager

    // Legacy/Modal Bindings
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

    // Save/Clear logic from legacy panels (keep for compatibility if modals still exist)
    this.saveRulesBtn?.addEventListener('click', () => this.handleSaveRules());
    this.clearRulesBtn?.addEventListener('click', () => this.handleClearRules());
    this.saveStyleBtn?.addEventListener('click', () => this.handleSaveStyle());
    this.clearStyleBtn?.addEventListener('click', () => this.handleClearStyle());

    // Side menu handlers
    this.sideMenuClose?.addEventListener('click', () => this.closeSideMenu());
    this.sideMenuBackdrop?.addEventListener('click', () => this.closeSideMenu());

    // Restore Side Menu Rules/Style Bindings
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

    // Notify BrainManager to refresh if needed
    if (window.brainManager) {
      window.brainManager.loadAnchors();
    }

    this.sideMenu.classList.add('visible');
    document.body.classList.add('side-menu-open');
    if (this.sideMenuBackdrop) this.sideMenuBackdrop.classList.add('visible');
  }

  closeSideMenu() {
    if (this.sideMenu) {
      this.sideMenu.classList.remove('visible');
      document.body.classList.remove('side-menu-open');
      if (this.sideMenuBackdrop) this.sideMenuBackdrop.classList.remove('visible');
    }
  }

  toggleSideMenu() {
    if (this.sideMenu && this.sideMenu.classList.contains('visible')) {
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

  renderAnchors() {
    const anchorsList = document.getElementById('brain-anchors-list');
    const emptyState = document.getElementById('brain-empty-state');

    if (!anchorsList) return;

    // Clear existing (except empty state if we want to keep it logic, but usually we toggle visibility)
    // Actually, let's rebuild list.
    anchorsList.innerHTML = '';

    if (this.files.length === 0) {
      if (emptyState) {
        emptyState.style.display = 'flex';
        anchorsList.appendChild(emptyState);
      }
      return;
    } else {
      if (emptyState) emptyState.style.display = 'none';
    }

    // Render file items as anchors
    this.files.forEach((file, index) => {
      const anchorEl = document.createElement('div');
      anchorEl.className = 'brain-anchor-item';
      anchorEl.innerHTML = `
        <div class="anchor-icon">
          <span class="material-symbols-outlined">description</span>
        </div>
        <div class="anchor-info">
          <span class="anchor-name">${file.name || file}</span>
          <span class="anchor-type">File</span>
        </div>
        <button class="btn-icon-small anchor-remove" data-index="${index}">
          <span class="material-symbols-outlined">close</span>
        </button>
      `;

      const removeBtn = anchorEl.querySelector('.anchor-remove');
      removeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.removeFile(index);
      });

      anchorsList.appendChild(anchorEl);
    });
  }

  handleFileSelection(file) {
    if (!file) return;
    this.pendingUploadFile = file;

    // Update UI
    if (this.attachmentName) this.attachmentName.textContent = file.name;
    if (this.brainAttachmentPreview) this.brainAttachmentPreview.style.display = 'flex';
  }

  async handleSend() {
    const text = this.brainInputText ? this.brainInputText.value.trim() : '';
    const file = this.pendingUploadFile;

    if (!text && !file) return;

    // Disable send button
    if (this.brainSendBtn) {
      this.brainSendBtn.disabled = true;
      this.brainSendBtn.classList.add('loading');
    }

    try {
      // Prepare FormData
      const formData = new FormData();
      if (file) {
        formData.append('files', file);
      }
      if (text) {
        formData.append('text', text); // backend needs to handle this
      }
      // Also include sessionId if exists
      if (this.sessionId) {
        formData.append('sessionId', this.sessionId);
      }

      const response = await fetch(CONFIG.API_CONTEXT, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) throw new Error('Failed to upload context');

      const data = await response.json();
      this.sessionId = data.sessionId;
      this.files = data.files || []; // Assuming API returns updated files list

      this.estimatedTokens = data.estimatedTokens || 0;

      // Local Storage Updates
      localStorage.setItem(CONFIG.STORAGE_SESSION_ID, this.sessionId);
      localStorage.setItem(CONFIG.STORAGE_FILES, JSON.stringify(this.files));
      localStorage.setItem(CONFIG.STORAGE_TOKENS, this.estimatedTokens.toString());

      // Clear Inputs
      if (this.brainInputText) this.brainInputText.value = '';
      this.pendingUploadFile = null;
      if (this.brainAttachmentPreview) this.brainAttachmentPreview.style.display = 'none';
      if (this.fileInput) this.fileInput.value = '';

      this.updateUI();

    } catch (error) {
      console.error('Send error:', error);
      showToast('Failed to add context');
    } finally {
      if (this.brainSendBtn) {
        this.brainSendBtn.disabled = false;
        this.brainSendBtn.classList.remove('loading');
      }
    }
  }

  // Legacy methods kept but decoupled from new Brain Panel UI

  openModal() {
    // this.openFilesModal(); // Legacy
  }

  closeModal() {
    // this.closeFilesModal(); // Legacy
    // this.closeRulesModal(); // Legacy
  }

  handleSaveRules() {
    // Legacy logic
  }

  handleClearRules() {
    // Legacy logic
  }

  async handleFiles(fileList) {
    // Legacy logic - disabled to prevent interference with BrainManager
    console.warn('ContextManager.handleFiles is deprecated. Use BrainManager.');
  }

  async clearContext() {
    // Clear rules
    this.rulesText = '';
    if (this.rulesTextarea) this.rulesTextarea.value = '';
    if (this.rulesTextareaMobile) this.rulesTextareaMobile.value = '';
    if (this.sideMenuRulesTextarea) this.sideMenuRulesTextarea.value = '';
    localStorage.removeItem(CONFIG.STORAGE_RULES);

    // Clear style
    this.selectedStyle = 'none';
    this.customStyleText = '';
    if (this.styleDropdown) this.styleDropdown.value = 'none';
    if (this.customStyleTextarea) this.customStyleTextarea.value = '';
    localStorage.removeItem(CONFIG.STORAGE_STYLE);
    localStorage.removeItem(CONFIG.STORAGE_CUSTOM_STYLE);

    // Clear files
    await this.clearFiles();

    // Clear Brain anchors if available
    if (window.brainManager) {
      window.brainManager.anchors = [];
      window.brainManager.renderAnchors();
    }

    this.updateUI();
  }

  async clearFiles() {
    // Legacy logic
  }

  async removeFile(index) {
    // Legacy logic
  }

  updateUI() {
    // Legacy UI updates only
    if (this.filesMenuBtn) {
      // this.filesMenuBtn.classList.toggle('has-context', this.files.length > 0);
    }
    // Do NOT render into brain-anchors-list
  }

  renderFilesList(container) {
    // Legacy
  }

  renderSideMenuFilesList() {
    // Disabled
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

// Projects Manager - handles saving and loading projects
class ProjectsManager {
  constructor() {
    this.projects = [];
    this.tempProject = null;
    this.modal = document.getElementById('projects-modal');
    this.listContainer = document.getElementById('projects-list');
    this.emptyState = document.getElementById('projects-empty');
    this.sidebarList = document.getElementById('sidebar-projects-list');
    this.sidebarEmpty = document.getElementById('sidebar-projects-empty');
    this.activeProjectId = null;
    this.isLoading = false;
    this.autoSaveTimer = null;
    this.autoSaveDebounceMs = 2000;
    this.init();

    // Ensure we have access to emoji list
    this.PROJECT_EMOJIS = ['📝', '✏️', '📖', '📚', '💡', '🎯', '🚀', '⭐', '💎', '🔥', '🌟', '📌', '🎨', '🧠', '💭', '📊', '🔮', '🌈', '🎪', '🎭'];

    this.renderSidebarList();
  }

  getRandomEmoji() {
    return this.PROJECT_EMOJIS[Math.floor(Math.random() * this.PROJECT_EMOJIS.length)];
  }

  init() {
    // Editor auto-save listener
    const editor = document.querySelector('.editor');
    if (editor) {
      editor.addEventListener('input', () => this.handleAutoSave());
    }

    // Modal close button
    const closeBtn = document.getElementById('projects-modal-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.closeModal());
    }

    // Close on backdrop click
    if (this.modal) {
      this.modal.addEventListener('click', (e) => {
        if (e.target === this.modal) this.closeModal();
      });
    }

    // New project button
    const newProjectBtn = document.getElementById('new-project-btn');
    if (newProjectBtn) {
      newProjectBtn.addEventListener('click', () => this.newProject());
    }

    // Context Menu Handlers
    this.contextMenu = document.getElementById('project-context-menu');
    if (this.contextMenu) {
      this.contextMenu.addEventListener('click', (e) => {
        if (e.target === this.contextMenu) this.closeContextMenu();
      });

      const deleteBtn = this.contextMenu.querySelector('.delete-project-btn');
      if (deleteBtn) {
        deleteBtn.addEventListener('click', () => {
          if (this.contextProjectId && confirm('Delete this project?')) {
            this.deleteProject(this.contextProjectId);
            this.closeContextMenu();
          }
        });
      }

      const renameBtn = this.contextMenu.querySelector('.rename-project-btn');
      if (renameBtn) {
        renameBtn.addEventListener('click', () => {
          if (this.contextProjectId) {
            this.startRenaming(this.contextProjectId);
            this.closeContextMenu();
          }
        });
      }

      const shareBtn = this.contextMenu.querySelector('.share-project-btn');
      if (shareBtn) {
        shareBtn.addEventListener('click', () => {
          if (this.contextProjectId) {
            this.shareProject(this.contextProjectId);
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
      this.contextProjectId = null;
    }
  }

  openContextMenu(projectId, x, y) {
    if (this.contextMenu) {
      this.contextProjectId = projectId;
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

  async shareProject(id) {
    const project = this.projects.find(p => p.id === id) || (this.tempProject?.id === id ? this.tempProject : null);
    if (!project) return;

    // If it's the active one, we might have fresher text in the editor
    let textToShare = project.text;
    if (id === this.activeProjectId) {
      const editor = document.querySelector('.editor');
      if (editor) textToShare = editor.textContent;
    }

    const shareData = {
      title: project.title,
      text: textToShare,
      url: window.location.href
    };

    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(`${shareData.title}\n\n${shareData.text}`);
        alert('Project content copied to clipboard!');
      }
    } catch (err) {
      console.error('Error sharing:', err);
    }
  }

  startRenaming(id) {
    const row = document.querySelector(`.sidebar-project-card[data-id="${id}"]`) ||
      document.querySelector(`.project-item[data-id="${id}"]`);
    if (!row) return;

    const titleSpan = row.querySelector('.project-title') || row.querySelector('.project-item-title');
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
      if (newTitle && newTitle !== project.title) {
        await this.updateProjectTitle(id, newTitle);
      } else {
        titleSpan.textContent = project.title; // Revert
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
        titleSpan.textContent = project.title;
        titleSpan.blur();
      }
    };

    const project = this.projects.find(p => p.id === id) || (this.tempProject?.id === id ? this.tempProject : null);
    if (!project) return;

    titleSpan.addEventListener('blur', finishRenaming);
    titleSpan.addEventListener('keydown', keyHandler);
  }

  async updateProjectTitle(id, newTitle) {
    // For new project, title change triggers first save
    if (!id) {
      await this.saveProject(false);
      return;
    }

    // If it's a temp project, just update locally
    if (id.toString().startsWith('temp-')) {
      if (this.tempProject) {
        this.tempProject.title = newTitle;
        this.renderSidebarList();
      }
      return;
    }

    try {
      const token = await window.authManager.getAccessToken();
      const response = await fetch(`${CONFIG.API_PROJECTS}?id=${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ title: newTitle })
      });

      if (!response.ok) throw new Error('Failed to update title');

      const data = await response.json();
      const index = this.projects.findIndex(p => p.id === id);
      if (index !== -1) {
        this.projects[index].title = newTitle;
        this.renderSidebarList();
        this.renderList();
      }
    } catch (error) {
      console.error('Error updating title:', error);
    }
  }

  async updateProjectEmoji(id, newEmoji) {
    // If it's a temp project, just update locally
    if (id.toString().startsWith('temp-')) {
      if (this.tempProject) {
        this.tempProject.emoji = newEmoji;
      }
      return;
    }

    try {
      const token = await window.authManager.getAccessToken();
      const response = await fetch(`${CONFIG.API_PROJECTS}?id=${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ emoji: newEmoji })
      });

      if (!response.ok) throw new Error('Failed to update emoji');

      const data = await response.json();
      const index = this.projects.findIndex(p => p.id === id);
      if (index !== -1) {
        this.projects[index].emoji = newEmoji;
      }
    } catch (error) {
      console.error('Error updating emoji:', error);
    }
  }

  async newProject() {
    if (this.isLoading) return;

    // If we are currently saving, wait for it
    if (this.pendingSave) await this.pendingSave;

    // Save current active project before clearing
    if (this.activeProjectId) {
      if (this.autoSaveTimer) {
        clearTimeout(this.autoSaveTimer);
        this.autoSaveTimer = null;
      }
      await this.saveProject(true);
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

    // Requirement: New project should not save or show up until I change a name or content
    this.tempProject = null;
    this.activeProjectId = null;
    this.renderSidebarList(); // Updates list

    // Switch to Editor View
    if (window.dashboardManager) {
      window.dashboardManager.showEditor(null);
      window.dashboardManager.updateHeader('Untitled Project', '📝');
    }

    this.closeModal();
  }

  handleAutoSave() {
    if (this.autoSaveTimer) clearTimeout(this.autoSaveTimer);

    this.autoSaveTimer = setTimeout(() => {
      const editor = document.querySelector('.editor');
      if (editor && editor.textContent.trim().length > 0) {
        this.saveProject(true);
      }
    }, this.autoSaveDebounceMs);
  }

  async saveProject(isAutoSave = false) {
    // If already saving this specific content/project, return the existing promise
    if (this.isSaving) return this.pendingSave;

    const editor = document.querySelector('.editor');
    if (!editor) return { success: false, error: 'Editor not found' };

    // Capture current state synchronously to avoid race conditions with editor clearing/switching
    const idToSave = this.activeProjectId;
    const clone = editor.cloneNode(true);
    const predictionEl = clone.querySelector('.inline-prediction');
    if (predictionEl) predictionEl.remove();

    const text = clone.innerHTML;
    const plainText = editor.textContent.trim();

    // Requirement #3: If empty, it's not saved to DB unless explicitly saved
    if (isAutoSave && !plainText && !text.includes('img')) {
      return { success: false, error: 'Nothing to save' };
    }

    // Check if user is authenticated
    if (!window.authManager?.isAuthenticated()) {
      if (!isAutoSave) {
        window.authManager?.openModal();
      }
      return { success: false, error: 'Sign in to save projects' };
    }

    // Determine title: Use UI value if custom
    let title = document.getElementById('project-title-input')?.value.trim();

    // Default to 'Untitled Project' if empty
    if (!title) {
      title = 'Untitled Project';
    }



    const rules = window.contextManager?.getRulesText() || '';
    const writingStyle = window.contextManager?.getWritingStyleText() || '';
    const contextSessionId = window.contextManager?.getSessionId() || null;

    this.isSaving = true;
    this.pendingSave = (async () => {
      try {
        const token = await window.authManager.getAccessToken();
        const isRealProject = idToSave && !idToSave.toString().startsWith('temp-');
        const method = isRealProject ? 'PUT' : 'POST';
        const url = isRealProject ? `${CONFIG.API_PROJECTS}?id=${idToSave}` : CONFIG.API_PROJECTS;

        const currentProject = this.projects.find(p => p.id === idToSave) || (this.tempProject?.id === idToSave ? this.tempProject : null);
        const emoji = currentProject?.emoji || null;

        const response = await fetch(url, {
          method: method,
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({ title, emoji, text, rules, writingStyle, contextSessionId })
        });

        if (!response.ok) {
          const data = await response.json();
          // Tier check was removed from backend, but keeping robust handling in case
          if (response.status === 403 && data.upgradeRequired) {
            if (!isAutoSave && confirm(data.error + '\n\nWould you like to upgrade to Pro now?')) {
              window.authManager.openAccountModal();
            }
          }
          throw new Error(data.error || 'Failed to save project');
        }

        const data = await response.json();
        // Flatten emoji from files if present
        if (!data.emoji && data.files?.emoji) {
          data.emoji = data.files.emoji;
        }

        // Requirement #2: Promoting temp project to real one on first save
        if (idToSave && idToSave.toString().startsWith('temp-')) {
          this.tempProject = null;
          // Only update active ID if we are still on the same project
          if (this.activeProjectId === idToSave) {
            this.activeProjectId = data.id;
          }
          this.projects.unshift(data);
        } else if (!idToSave) {
          this.activeProjectId = data.id;
          this.projects.unshift(data);
        } else {
          const index = this.projects.findIndex(p => p.id === idToSave);
          if (index !== -1) {
            this.projects[index] = { ...this.projects[index], ...data };
          }
        }

        this.renderSidebarList();
        this.renderList();

        return { success: true, project: data };
      } catch (error) {
        console.error('Save project error:', error);
        return { success: false, error: error.message };
      } finally {
        this.isSaving = false;
        this.pendingSave = null;
      }
    })();

    return this.pendingSave;
  }

  async loadProjects() {
    try {
      const token = await window.authManager?.getAccessToken();
      const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

      const response = await fetch(CONFIG.API_PROJECTS, { headers });
      if (!response.ok) throw new Error('Failed to load projects');

      const data = await response.json();
      this.projects = (data.projects || []).map(p => {
        if (!p.emoji) p.emoji = this.getRandomEmoji ? this.getRandomEmoji() : '📝';
        return p;
      });
      this.renderList();
    } catch (error) {
      console.error('Load projects error:', error);
      this.projects = [];
      this.renderList();
    }
  }

  createInitialTempProject() {
    // Create temporary project visible in sidebar immediately
    this.tempProject = {
      id: 'temp-' + Date.now(),
      title: 'New project',
      emoji: this.getRandomEmoji ? this.getRandomEmoji() : '📝',
      created_at: new Date().toISOString()
    };

    this.activeProjectId = this.tempProject.id;
    this.renderSidebarList();
  }

  async loadProject(id) {
    if (this.isLoading) return;
    this.isLoading = true;

    // Requirement #4: Save current project before switching
    if (this.activeProjectId && this.activeProjectId !== id) {
      if (this.autoSaveTimer) {
        clearTimeout(this.autoSaveTimer);
        this.autoSaveTimer = null;
      }
      // Wait for any pending save OR trigger a new one
      if (this.pendingSave) {
        await this.pendingSave;
      } else {
        await this.saveProject(true);
      }
    }

    // Requirement #5: Clear temp project if we switch away from it
    if (this.tempProject && id !== this.tempProject.id) {
      this.tempProject = null;
      this.renderSidebarList();
    }

    try {
      // Clear editor immediately so user knows something is happening
      const editor = document.querySelector('.editor');
      if (editor) editor.innerHTML = '<div class="loading-editor">Loading project...</div>';

      const token = await window.authManager?.getAccessToken();
      const response = await fetch(`${CONFIG.API_PROJECTS}?id=${id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('Failed to load project');

      const project = await response.json();
      // Flatten emoji from files if present
      if (!project.emoji && project.files?.emoji) {
        project.emoji = project.files.emoji;
      }

      // Restore editor content
      if (editor) {
        editor.innerHTML = project.text;
        // Re-hydrate images
        editor.querySelectorAll('.editor-image-container').forEach(setupImageContainer);
      }

      // Restore context (rules + files)
      if (window.contextManager) {
        // Restore rules
        window.contextManager.rulesText = project.rules || '';
        const textarea = document.getElementById('context-textarea');
        if (textarea) textarea.value = project.rules || '';
        if (project.rules) {
          localStorage.setItem(CONFIG.STORAGE_RULES, project.rules);
        } else {
          localStorage.removeItem(CONFIG.STORAGE_RULES);
        }

        // Restore writing style
        if (window.contextManager.restoreWritingStyle) {
          window.contextManager.restoreWritingStyle(project.writing_style || '');
        }

        // Restore files
        if (project.files && project.files.content) {
          await this.restoreFilesFromProject(project.files);
        } else {
          await window.contextManager.clearFiles();
        }

        window.contextManager.updateUI();
      }

      this.activeProjectId = id;
      this.highlightSidebarProjects();
      this.closeModal();
      if (editor) editor.focus();

      // Update Dashboard/Header
      if (window.dashboardManager) {
        window.dashboardManager.showEditor(id);
        window.dashboardManager.updateHeader(project.title, project.emoji);
      }

    } catch (error) {
      console.error('Load project error:', error);
      // Restore empty editor on error
      const editor = document.querySelector('.editor');
      if (editor && editor.querySelector('.loading-editor')) editor.innerHTML = '';
      window.dashboardManager?.showDashboard(); // Go back on error
    } finally {
      this.isLoading = false;
    }
  }

  async restoreFilesFromProject(filesData) {
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

  async deleteProject(id) {
    try {
      const token = await window.authManager?.getAccessToken();
      const response = await fetch(`${CONFIG.API_PROJECTS}?id=${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) throw new Error('Failed to delete project');

      this.projects = this.projects.filter((p) => p.id !== id);
      if (this.activeProjectId === id) {
        this.activeProjectId = null;
      }
      this.renderList();
    } catch (error) {
      console.error('Delete project error:', error);
    }
  }

  renderList() {
    if (!this.listContainer) {
      this.renderSidebarList();
      // Also update dashboard grid if possible
      if (window.dashboardManager) {
        const displayProjects = this.tempProject ? [this.tempProject, ...this.projects] : this.projects;
        window.dashboardManager.renderProjects(displayProjects);
      }
      return;
    }

    if (this.emptyState) {
      this.emptyState.style.display = (this.projects.length || this.tempProject) ? 'none' : 'block';
    }

    const displayProjects = this.tempProject ? [this.tempProject, ...this.projects] : this.projects;

    // Sync with Dashboard Grid
    if (window.dashboardManager) {
      window.dashboardManager.renderProjects(displayProjects);
    }

    if (displayProjects.length === 0) {
      if (this.listContainer) this.listContainer.innerHTML = '';
      this.renderSidebarList();
      return;
    }

    if (this.listContainer) {
      this.listContainer.innerHTML = displayProjects
        .map(
          (project) => `
        <div class="project-item ${project.id.toString().startsWith('temp-') ? 'temp-item' : ''}" data-id="${project.id}">
          <div class="project-item-content">
            <span class="project-item-title">${this.escapeHtml(project.title)}</span>
            <span class="project-item-date">${this.formatDate(project.created_at)}</span>
          </div>
          <button class="project-item-delete" data-id="${project.id}">
            <span class="material-symbols-outlined">more_vert</span>
          </button>
        </div>
      `
        )
        .join('');

      // Add click handlers
      this.listContainer.querySelectorAll('.project-item').forEach((item) => {
        item.addEventListener('click', (e) => {
          const menuBtn = e.target.closest('.project-item-delete');
          if (menuBtn) {
            e.stopPropagation();
            const rect = menuBtn.getBoundingClientRect();
            this.openContextMenu(item.dataset.id, rect.left - 130, rect.top + 30);
            return;
          }
          this.loadProject(item.dataset.id);
        });
      });
    }

    this.renderSidebarList();
  }


  renderSidebarList() {
    if (window.dashboardManager) {
      const displayProjects = this.tempProject ? [this.tempProject, ...this.projects] : this.projects;
      window.dashboardManager.renderProjects(displayProjects);
    }
  }

  highlightSidebarProjects() {
    if (!this.sidebarList) return;
    this.sidebarList.querySelectorAll('.sidebar-project-card').forEach((row) => {
      row.classList.toggle('active', row.dataset.id === this.activeProjectId);
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
    this.loadProjects();
    if (this.modal) this.modal.classList.add('visible');
  }

  closeModal() {
    if (this.modal) this.modal.classList.remove('visible');
  }
}

// Dashboard Manager - Handles project grid and navigation
class DashboardManager {
  constructor() {
    this.dashboardView = document.getElementById('dashboard-view');
    this.editorView = document.getElementById('editor-view');
    this.projectsGrid = document.getElementById('projects-grid');
    this.titleInput = document.getElementById('project-title-input');
    this.titleDisplay = document.getElementById('project-title-display');
    this.emojiDisplay = document.getElementById('project-emoji-display');
    this.backBtn = document.getElementById('back-to-dashboard-btn');
    this.dashboardThemeBtn = document.getElementById('dashboard-theme-btn');
    this.dashboardAccountBtn = document.getElementById('dashboard-account-btn');
  }

  init() {
    // Check URL
    const urlParams = new URLSearchParams(window.location.search);
    const projectId = urlParams.get('project');

    if (projectId) {
      // Wait for Auth to be ready before creating logic? 
      // ProjectsManager.loadProjects checks auth.
      // We'll rely on global ProjectsManager to handle data loading loop;
      // Once loaded, we should open it.
      // But init runs before data is loaded.
      // We'll set a pending ID to open.
      this.pendingProjectId = projectId;
    } else {
      this.showDashboard();
    }

    // Bind Back Button - Auto save on exit and refresh dashboard
    if (this.backBtn) {
      this.backBtn.addEventListener('click', async () => {
        if (window.projectsManager) {
          // Force save before leaving
          await window.projectsManager.saveProject(true);
          this.showDashboard();
        } else {
          this.showDashboard();
        }
      });
    }

    // Bind Dashboard Theme Toggle
    if (this.dashboardThemeBtn) {
      this.dashboardThemeBtn.addEventListener('click', () => {
        document.body.classList.toggle('light-theme');
        const isLight = document.body.classList.contains('light-theme');
        localStorage.setItem(CONFIG.STORAGE_THEME, isLight ? 'light' : 'dark');
        const icon = this.dashboardThemeBtn.querySelector('.material-symbols-outlined');
        if (icon) icon.textContent = isLight ? 'light_mode' : 'dark_mode';
      });
    }

    // Bind Emoji Picker
    this.emojiBtn = document.getElementById('project-emoji-btn');
    this.emojiPicker = document.getElementById('emoji-picker-dropdown');
    this.emojiGrid = document.getElementById('emoji-grid');

    // Curated list of mindful/creative emojis
    const EMOJI_LIST = [
      '📝', '💡', '🚀', '🎨', '🧠', '⚡', '✨', '🔥',
      '📚', '🎯', '🌈', '🧩', '🎤', '🎧', '🎸', '🎹',
      '📷', '🎥', '🎬', '🎭', '👾', '🕹️', '🎲', '🎰',
      '💎', '🏆', '🥇', '🥈', '🥉', '🏅', '🎖️', '🎗️',
      '🎟️', '🎫', '🎪', '🎢', '🎡', '🎠', '🏗️', '🏛️'
    ];

    if (this.emojiBtn && this.emojiPicker && this.emojiGrid) {
      // Render emojis
      this.emojiGrid.innerHTML = EMOJI_LIST.map(emoji =>
        `<button class="emoji-option" data-emoji="${emoji}">${emoji}</button>`
      ).join('');

      // Toggle picker
      this.emojiBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.emojiPicker.classList.toggle('visible');
      });

      // Handle selection
      this.emojiGrid.addEventListener('click', (e) => {
        const option = e.target.closest('.emoji-option');
        if (option) {
          e.stopPropagation();
          const selectedEmoji = option.dataset.emoji;
          if (this.emojiDisplay) this.emojiDisplay.textContent = selectedEmoji;
          this.emojiPicker.classList.remove('visible');

          // Save functionality
          if (window.projectsManager && window.projectsManager.activeProjectId) {
            // We need a specific method to update just the emoji, or reuse saveProject? 
            // saveProject grabs emoji from activeProject object usually. 
            // Let's update the local object directly first.
            const project = window.projectsManager.projects.find(p => p.id === window.projectsManager.activeProjectId);
            if (project) {
              if (!project.files) project.files = {};
              project.files.emoji = selectedEmoji;
              project.emoji = selectedEmoji; // Critical: Update root property for saveProject to pick it up
              window.projectsManager.saveProject(false).then(() => {
                showToast('Icon updated');
              });
            }
          } else if (window.projectsManager && window.projectsManager.tempProject) {
            // Update temp project
            if (!window.projectsManager.tempProject.files) window.projectsManager.tempProject.files = {};
            window.projectsManager.tempProject.files.emoji = selectedEmoji;
            window.projectsManager.tempProject.emoji = selectedEmoji; // Critical: Update root property
            // No need to save to DB yet, will save on first edit or exit
          }
        }
      });

      // Close on outside click
      document.addEventListener('click', (e) => {
        if (!this.emojiPicker.contains(e.target) && !this.emojiBtn.contains(e.target)) {
          this.emojiPicker.classList.remove('visible');
        }
      });
    }

    if (this.titleInput && this.titleDisplay) {
      const syncInputWidth = () => {
        this.titleDisplay.textContent = this.titleInput.value || ' ';
      };

      this.titleInput.addEventListener('input', syncInputWidth);

      this.titleInput.addEventListener('focus', () => {
        document.querySelector('.project-title-container')?.classList.add('editing');
        syncInputWidth();
      });

      this.titleInput.addEventListener('blur', () => {
        document.querySelector('.project-title-container')?.classList.remove('editing');
        this.commitTitleChange();
      });

      this.titleInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          this.titleInput.blur();
        }
        if (e.key === 'Escape') {
          this.titleInput.value = this.titleDisplay.textContent;
          this.titleInput.blur();
        }
        syncInputWidth();
      });
    }



    // Bind Dashboard Account Button
    if (this.dashboardAccountBtn) {
      this.dashboardAccountBtn.addEventListener('click', () => {
        // Reusing existing user-menu-overlay or triggering Auth
        if (window.authManager && window.authManager.isAuthenticated()) {
          // Open user menu
          const userMenuOverlay = document.querySelector('.user-menu-overlay');
          if (userMenuOverlay) {
            userMenuOverlay.classList.add('visible');
            // Ensure menu is ready (timeout logic from valid openMenu if needed, or CSS handles it)
            setTimeout(() => userMenuOverlay.classList.add('menu-ready'), 100);
          }
        } else {
          // Open Auth Modal
          if (window.authManager) window.authManager.openModal();
        }
      });
    }

    // Bind existing static Create New card in case renderProjects hasn't run yet
    const existingCreateCard = document.getElementById('create-project-card');
    if (existingCreateCard) {
      existingCreateCard.onclick = () => {
        if (window.projectsManager) window.projectsManager.newProject();
      };
    }
  }



  commitTitleChange() {
    const newTitle = this.titleInput.value.trim();
    if (newTitle && window.projectsManager) {
      this.titleDisplay.textContent = newTitle;
      window.projectsManager.updateProjectTitle(window.projectsManager.activeProjectId, newTitle);
    } else {
      // Revert
      this.titleInput.value = this.titleDisplay.textContent;
    }
  }

  updateHeader(title, emoji) {
    if (this.titleDisplay) this.titleDisplay.textContent = title;
    if (this.titleInput) this.titleInput.value = title;
    if (this.emojiDisplay) this.emojiDisplay.textContent = emoji || '📝';
  }

  showDashboard() {
    if (this.editorView) this.editorView.style.display = 'none';
    if (this.dashboardView) this.dashboardView.style.display = 'block';

    // Clean URL
    if (window.history.pushState) {
      const newurl = window.location.protocol + "//" + window.location.host + window.location.pathname;
      window.history.pushState({ path: newurl }, '', newurl);
    }

    if (window.projectsManager) {
      window.projectsManager.loadProjects(); // Refresh data from server
    }
  }

  showEditor(projectId) {
    if (this.dashboardView) this.dashboardView.style.display = 'none';
    if (this.editorView) this.editorView.style.display = 'block';

    if (projectId) {
      const newurl = window.location.protocol + "//" + window.location.host + window.location.pathname + '?project=' + projectId;
      window.history.pushState({ path: newurl }, '', newurl);
    }
  }

  renderProjects(projects) {
    // Check for pending project load from URL
    if (this.pendingProjectId && projects) {
      const id = this.pendingProjectId;
      const exists = projects.find(p => p.id === id);
      if (exists) {
        this.pendingProjectId = null;
        window.projectsManager.loadProject(id);
        return;
      }
    }

    if (!this.projectsGrid) return;
    this.projectsGrid.innerHTML = '';

    // Create Card
    const createCard = document.createElement('div');
    createCard.className = 'project-card create-card';
    createCard.innerHTML = `
        <div class="create-icon-wrapper"><span class="material-symbols-outlined">add</span></div>
        <span class="create-label">Create new project</span>
     `;
    createCard.onclick = () => window.projectsManager.newProject();
    this.projectsGrid.appendChild(createCard);

    // Project Cards
    if (projects) {
      // Sort by updated_at desc
      const sorted = [...projects].sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));

      sorted.forEach(p => {
        const card = this.createProjectCard(p);
        this.projectsGrid.appendChild(card);
      });
    }
  }

  // Project emojis for random assignment and picker
  static PROJECT_EMOJIS = ['📝', '✏️', '📖', '📚', '💡', '🎯', '🚀', '⭐', '💎', '🔥', '🌟', '📌', '🎨', '🧠', '💭', '📊', '🔮', '🌈', '🎪', '🎭'];

  getRandomEmoji() {
    return DashboardManager.PROJECT_EMOJIS[Math.floor(Math.random() * DashboardManager.PROJECT_EMOJIS.length)];
  }

  createProjectCard(project) {
    const card = document.createElement('div');
    card.className = 'project-card';
    const sourceCount = project.sources_count !== undefined ? project.sources_count : (project.files ? (project.files.files ? project.files.files.length : 0) : 0);

    // Assign random emoji if not set
    if (!project.emoji) {
      project.emoji = this.getRandomEmoji();
    }

    // Determine if temp
    if (project.id.toString().startsWith('temp-')) {
      card.classList.add('temp-project');
    }

    card.innerHTML = `
        <div class="card-header">
            <div class="card-emoji" data-project-id="${project.id}">${project.emoji}</div>
            <button class="card-menu-btn"><span class="material-symbols-outlined">more_vert</span></button>
        </div>
        <div class="card-content">
            <h3 class="card-title">${this.escapeHtml(project.title)}</h3>
            <div class="card-meta">
                <span>${sourceCount} sources</span>
            </div>
        </div>
      `;

    // Emoji picker
    const emojiEl = card.querySelector('.card-emoji');
    emojiEl.onclick = (e) => {
      e.stopPropagation();
      this.showEmojiPicker(e, project, emojiEl);
    };

    const menuBtn = card.querySelector('.card-menu-btn');
    menuBtn.onclick = (e) => {
      e.stopPropagation();
      this.showCardContextMenu(e, project, card);
    };

    card.onclick = (e) => {
      if (!e.target.closest('.card-menu-btn') && !e.target.closest('.card-emoji')) {
        window.projectsManager.loadProject(project.id);
      }
    };
    return card;
  }

  showCardContextMenu(e, project, card) {
    // Remove any existing context menu
    const existingMenu = document.querySelector('.card-context-menu');
    if (existingMenu) existingMenu.remove();

    // Create context menu
    const menu = document.createElement('div');
    menu.className = 'card-context-menu';
    menu.innerHTML = `
      <button class="context-menu-item" data-action="rename">
        <span class="material-symbols-outlined">edit</span>
        <span>Rename</span>
      </button>
      <button class="context-menu-item context-menu-item--danger" data-action="delete">
        <span class="material-symbols-outlined">delete</span>
        <span>Delete</span>
      </button>
    `;

    // Position menu near the button
    const rect = e.target.closest('.card-menu-btn').getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = `${rect.bottom + 8}px`;
    menu.style.left = `${rect.left}px`;

    document.body.appendChild(menu);

    // Handle menu item clicks
    menu.querySelectorAll('.context-menu-item').forEach(item => {
      item.onclick = (ev) => {
        ev.stopPropagation();
        const action = item.dataset.action;
        menu.remove();

        if (action === 'rename') {
          this.startInlineRename(project, card);
        } else if (action === 'delete') {
          this.deleteProject(project);
        }
      };
    });

    // Close menu when clicking outside
    const closeMenu = (ev) => {
      if (!menu.contains(ev.target)) {
        menu.remove();
        document.removeEventListener('click', closeMenu);
      }
    };
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
  }

  showEmojiPicker(e, project, emojiEl) {
    // Remove any existing emoji picker
    const existingPicker = document.querySelector('.emoji-picker');
    if (existingPicker) existingPicker.remove();

    // Create emoji picker dropdown
    const picker = document.createElement('div');
    picker.className = 'emoji-picker';

    // Create grid of emojis
    const grid = document.createElement('div');
    grid.className = 'emoji-picker-grid';

    DashboardManager.PROJECT_EMOJIS.forEach(emoji => {
      const btn = document.createElement('button');
      btn.className = 'emoji-btn';
      btn.textContent = emoji;
      btn.onclick = (ev) => {
        ev.stopPropagation();
        emojiEl.textContent = emoji;
        project.emoji = emoji;
        window.projectsManager.updateProjectEmoji(project.id, emoji);
        picker.remove();
      };
      grid.appendChild(btn);
    });

    picker.appendChild(grid);

    // Position picker
    const rect = emojiEl.getBoundingClientRect();
    picker.style.position = 'fixed';
    picker.style.top = `${rect.bottom + 8}px`;
    picker.style.left = `${rect.left}px`;

    document.body.appendChild(picker);

    // Close on outside click
    const closePicker = (ev) => {
      if (!picker.contains(ev.target)) {
        picker.remove();
        document.removeEventListener('click', closePicker);
      }
    };
    setTimeout(() => document.addEventListener('click', closePicker), 0);
  }

  startInlineRename(project, card) {
    const titleEl = card.querySelector('.card-title');
    if (!titleEl) return;

    const originalTitle = project.title;

    // Make title editable
    titleEl.contentEditable = 'true';
    titleEl.focus();

    // Select all text
    const range = document.createRange();
    range.selectNodeContents(titleEl);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);

    const save = () => {
      titleEl.contentEditable = 'false';
      const newTitle = titleEl.textContent.trim();
      if (newTitle && newTitle !== originalTitle) {
        window.projectsManager.updateProjectTitle(project.id, newTitle);
        project.title = newTitle;
      } else {
        titleEl.textContent = originalTitle;
      }
    };

    titleEl.onblur = save;
    titleEl.onkeydown = (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        titleEl.blur();
      }
      if (e.key === 'Escape') {
        titleEl.textContent = originalTitle;
        titleEl.blur();
      }
    };
  }

  async deleteProject(project) {
    if (!confirm(`Are you sure you want to delete "${project.title}"? This cannot be undone.`)) {
      return;
    }

    await window.projectsManager.deleteProject(project.id);
    this.renderProjects(window.projectsManager.projects);
  }

  escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
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
      if (window.projectsManager) {
        window.projectsManager.handleAutoSave();
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

    // Auth Modal New Elements
    this.authGoogleBtn = document.getElementById('auth-google-btn');
    this.authToggleModeBtn = document.getElementById('auth-toggle-mode');
    this.authToggleText = document.getElementById('auth-toggle-text');

    this.currentMode = 'signin'; // 'signin' or 'signup'

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

      // Load projects on initial session restore
      if (window.projectsManager) {
        window.projectsManager.loadProjects();
      }
    }

    // Listen for auth state changes
    window.supabase.auth.onAuthStateChange((event, session) => {
      this.user = session?.user || null;
      this.updateMenuState();

      if (event === 'SIGNED_IN') {
        this.closeModal();
        // Reload projects if manager exists
        if (window.projectsManager) {
          window.projectsManager.loadProjects();
        }
      }
      if (event === 'SIGNED_OUT') {
        // Clear projects list
        if (window.projectsManager) {
          window.projectsManager.projects = [];
          window.projectsManager.renderList();
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

    // Toggle Mode Link
    if (this.authToggleModeBtn) {
      this.authToggleModeBtn.addEventListener('click', (e) => this.toggleMode(e));
    }

    // Google Sign In
    if (this.authGoogleBtn) {
      this.authGoogleBtn.addEventListener('click', () => this.signInWithGoogle());
    }

    // Submit Button (Email/Password) - Sign In
    if (this.submitBtn) {
      this.submitBtn.addEventListener('click', () => this.handleSubmit());
    }

    // Signup layout buttons
    const submitBtnSignup = document.getElementById('auth-submit-btn-signup');
    if (submitBtnSignup) {
      submitBtnSignup.addEventListener('click', () => this.handleSubmit());
    }
    const googleBtnSignup = document.getElementById('auth-google-btn-signup');
    if (googleBtnSignup) {
      googleBtnSignup.addEventListener('click', () => this.signInWithGoogle());
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

  toggleMode(e) {
    if (e) e.preventDefault();
    this.currentMode = this.currentMode === 'signin' ? 'signup' : 'signin';
    this.updateModalUI();
  }

  switchTab(tab) {
    if (tab === 'signup' || tab === 'signin') {
      this.currentMode = tab;
      this.updateModalUI();
    }
  }

  updateModalUI() {
    const signinLayout = document.getElementById('auth-signin-layout');
    const signupLayout = document.getElementById('auth-signup-layout');

    if (this.currentMode === 'signin') {
      if (this.authTitle) this.authTitle.textContent = 'Sign In';
      if (signinLayout) signinLayout.style.display = 'block';
      if (signupLayout) signupLayout.style.display = 'none';
      if (this.authToggleText) {
        this.authToggleText.innerHTML = 'Don\'t have an account? <a href="#" id="auth-toggle-mode">Create one</a>';
        const link = this.authToggleText.querySelector('a');
        if (link) link.addEventListener('click', (e) => this.toggleMode(e));
      }
    } else {
      if (this.authTitle) this.authTitle.textContent = 'Create Account';
      if (signinLayout) signinLayout.style.display = 'none';
      if (signupLayout) signupLayout.style.display = 'block';
      if (this.authToggleText) {
        this.authToggleText.innerHTML = 'Already have an account? <a href="#" id="auth-toggle-mode">Sign in</a>';
        const link = this.authToggleText.querySelector('a');
        if (link) link.addEventListener('click', (e) => this.toggleMode(e));
      }
    }
    // Clear errors
    const errorEl = document.getElementById('auth-error');
    const errorElSignup = document.getElementById('auth-error-signup');
    if (errorEl) errorEl.textContent = '';
    if (errorElSignup) errorElSignup.textContent = '';
  }

  async handleSubmit() {
    // Get values from current active layout
    let email, password, errorEl;
    if (this.currentMode === 'signin') {
      email = document.getElementById('auth-email')?.value.trim();
      password = document.getElementById('auth-password')?.value;
      errorEl = document.getElementById('auth-error');
    } else {
      email = document.getElementById('auth-email-signup')?.value.trim();
      password = document.getElementById('auth-password-signup')?.value;
      errorEl = document.getElementById('auth-error-signup');
    }

    if (!email || !password) {
      this.showError('Please fill in all fields');
      return;
    }

    if (this.submitBtn) this.submitBtn.disabled = true;
    this.showError('');

    try {
      if (this.currentMode === 'signin') {
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
    if (!confirm('Are you sure you want to delete your account? This will delete all your projects and cannot be undone.')) {
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

    // Dashboard and Editor avatars
    const dashboardAvatar = document.getElementById('dashboard-avatar');
    const editorAvatar = document.getElementById('editor-avatar');

    if (this.user) {
      if (profileLabel) profileLabel.textContent = 'Account';
      if (profileIcon) profileIcon.textContent = 'account_circle';
      if (this.sidebarAccountName) this.sidebarAccountName.textContent = this.user.email;
      if (this.sidebarAvatar) this.sidebarAvatar.textContent = (this.user.email?.[0] || 'P').toUpperCase();

      const userInitial = (this.user.email?.[0] || 'P').toUpperCase();
      if (dashboardAvatar) dashboardAvatar.textContent = userInitial;
      if (editorAvatar) editorAvatar.textContent = userInitial;

      // Update User Menu
      if (this.userMenuName) this.userMenuName.textContent = this.user.user_metadata?.full_name || this.user.email?.split('@')[0] || 'Account';
      if (this.userMenuEmail) this.userMenuEmail.textContent = this.user.email;
      if (this.userMenuAvatar) this.userMenuAvatar.textContent = userInitial;

      if (this.signoutBtn) this.signoutBtn.textContent = 'Sign Out';
      if (this.deleteAccountBtn) this.deleteAccountBtn.disabled = false;
    } else {
      if (profileLabel) profileLabel.textContent = 'Sign In';
      if (profileIcon) profileIcon.textContent = 'person';
      if (this.sidebarAccountName) this.sidebarAccountName.textContent = 'Guest';
      if (this.sidebarAvatar) this.sidebarAvatar.textContent = 'PV';

      if (dashboardAvatar) dashboardAvatar.innerHTML = '<span class="material-symbols-outlined">person</span>';
      if (editorAvatar) editorAvatar.innerHTML = '<span class="material-symbols-outlined">person</span>';

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
      this.currentMode = 'signin';
      this.updateModalUI();
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
      if (upgradeRow) upgradeRow.style.display = 'none';
    } else {
      if (tierEl) tierEl.textContent = 'Free Plan';
      if (priceEl) priceEl.textContent = '$0/month';
      if (badgeEl) {
        badgeEl.textContent = 'Free';
        badgeEl.style.background = '#666';
      }
      if (imagesEl) imagesEl.textContent = '0/month';
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
  const editor = document.querySelector('.editor');
  window.brainManager = new BrainManager();
  window.contextManager = new ContextManager();
  window.predictionManager = new PredictionManager();
  window.projectsManager = new ProjectsManager();
  window.dashboardManager = new DashboardManager();
  window.authManager = new AuthManager();

  // Dashboard Manager Init
  if (window.dashboardManager) {
    window.dashboardManager.init();
  } else {
    console.warn('DashboardManager not initialized');
  }

  // Modal handling
  const modal = document.getElementById('about-modal');
  const logo = document.querySelector('.logo');
  const modalClose = document.getElementById('about-modal-close');

  const openModal = () => modal.classList.add('visible');

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
  const settingsBtn = document.getElementById('settings-btn');
  const editorAccountBtn = document.getElementById('editor-account-btn');

  const rightMenuOverlay = document.querySelector('.right-menu-overlay');
  const userMenuOverlay = document.querySelector('.user-menu-overlay');

  const openMenu = (overlay) => {
    overlay.classList.add('visible');
    setTimeout(() => overlay.classList.add('menu-ready'), 10);
  };

  const closeMenu = () => {
    if (rightMenuOverlay) {
      rightMenuOverlay.classList.remove('visible');
      rightMenuOverlay.classList.remove('menu-ready');
    }
    if (userMenuOverlay) {
      userMenuOverlay.classList.remove('visible');
      userMenuOverlay.classList.remove('menu-ready');
    }
  };

  const closeAllMenus = () => {
    closeMenu();
    window.contextManager?.closeSideMenu();
  };

  if (editorAccountBtn) {
    editorAccountBtn.addEventListener('click', () => {
      if (window.authManager && window.authManager.isAuthenticated()) {
        if (userMenuOverlay.classList.contains('visible')) {
          closeMenu();
        } else {
          closeMenu();
          openMenu(userMenuOverlay);
        }
      } else {
        window.authManager?.openModal();
      }
    });
  }

  settingsBtn.addEventListener('click', () => {
    if (window.predictionManager.selectModeActive) {
      window.predictionManager.disableSelectMode();
      return;
    }

    // Toggle side menu
    window.contextManager.toggleSideMenu();
  });

  // Sidebar listeners removed as sidebar is deleted

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

  // Legacy header binding if present?
  // Current Editor Header has back-btn and project-title logic handled by DashboardManager


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
  // Edit Name Modal Logic (Now Account Modal)
  const userMenuHeader = document.getElementById('user-menu-header');
  const editNameModal = document.getElementById('edit-name-modal');
  const editNameClose = document.getElementById('edit-name-close');
  const editNameInput = document.getElementById('edit-name-input'); // Fixed ID mismatch if any
  const saveNameBtn = document.getElementById('edit-name-save');
  const accountEmailDisplay = document.getElementById('account-email-display');

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
        const user = window.authManager.user;
        if (editNameInput) {
          editNameInput.value = user.user_metadata?.full_name || user.email?.split('@')[0] || '';
          // editNameInput.focus(); // Optional: might be annoying on mobile
        }
        if (accountEmailDisplay) {
          accountEmailDisplay.value = user.email || '';
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

  // Sidebar code removed - sidebar is no longer in use

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
    showToast('Cleared');
    closeAllMenus();
  });

  const selectMenuButtons = document.querySelectorAll('.select-menu-btn');

  const updateSelectButtons = window.updateSelectButtons = () => {
    selectMenuButtons.forEach((btn) => {
      btn.classList.toggle('active', window.predictionManager.selectModeActive);
      const icon = btn.querySelector('.material-symbols-outlined');
      if (icon) {
        if (window.predictionManager.selectModeActive) {
          icon.textContent = 'close';
        } else {
          icon.textContent = 'text_select_end';
        }
      }
    });
  };

  selectMenuButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (window.predictionManager.selectModeActive) {
        // Cancel selection mode (don't apply)
        window.predictionManager.disableSelectMode();
      } else {
        window.predictionManager.enableSelectMode();
      }
      updateSelectButtons();
      closeAllMenus();
    });
  });

  bindMenuButtons('.copy-all-btn', async (_event, btn) => {
    if (!editor) return;

    // Clone to strip predictions before copying
    const clone = editor.cloneNode(true);
    const predictions = clone.querySelectorAll('.inline-prediction, .prediction-ghost');
    predictions.forEach(p => p.remove());

    const text = clone.textContent || '';

    try {
      await navigator.clipboard.writeText(text);
      showToast('Copied');
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

  const sidebarNewProjectBtn = document.getElementById('new-project-btn');
  if (sidebarNewProjectBtn) {
    sidebarNewProjectBtn.addEventListener('click', async () => {
      await window.projectsManager.newProject();
      closeAllMenus();
    });
  }

  // Close projects modal on Escape
  document.addEventListener('keydown', (e) => {
    const projectsModal = document.getElementById('projects-modal');
    if (e.key === 'Escape' && projectsModal?.classList.contains('visible')) {
      window.projectsManager.closeModal();
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
        throw new Error(data.error || 'Daily limit reached');
      }

      // 429 logic removed as credits are simplified out

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Image generation request failed:', response.status, errorText);
        throw new Error(`Image generation failed: ${response.status}`);
      }

      const data = await response.json();
      console.log('Image generation response data:', data);

      // Show remaining count if present
      // Show remaining count
      if (typeof data.remaining !== 'undefined') {
        if (data.remaining > 100) {
          showToast('Image created');
        } else {
          showToast(`Image created (${data.remaining} left today)`);
        }
      } else {
        showToast('Image created');
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
        if (window.projectsManager) {
          window.projectsManager.handleAutoSave();
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
