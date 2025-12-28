const ENABLE_RISE_AND_SET = false; // Disabled for inline prediction mode

const CONFIG = {
  DEBOUNCE_MS: 1000,
  MIN_TEXT_LENGTH: 10,
  MOBILE_BREAKPOINT_PX: 768,
  TOUCH_MOVE_THRESHOLD_PX: 5,
};

class PredictionManager {
  constructor(options = {}) {
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
    this.pointerSelecting = false;
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
    this.enableRiseMotion = ENABLE_RISE_AND_SET;
    this.motionRemainText = '';

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

    this.init();
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
      this.selectConfirmBtn.addEventListener('click', () => {
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

    // Debounce prediction request - get FRESH text when timer fires
    this.debounceTimer = setTimeout(() => {
      const text = this.getEditorText();
      if (text.trim().length >= this.minTextLength) {
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
    this.motionRemainText = '';
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
              if (wordBounds.end <= this.selectStartOffset) {
                this.selectPreviewOffset = wordBounds.start;
              } else {
                this.selectPreviewOffset = wordBounds.end;
              }
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
    const mode = this.selectModeActive ? 'SELECT' : 'NORMAL';

    console.log(`[TouchStart:${mode}] coords=(${x.toFixed(0)}, ${y.toFixed(0)})`);

    const withinPrediction = this.isPointWithinPrediction(x, y);
    console.log(`[TouchStart:${mode}] withinPrediction=${withinPrediction}`);

    if (!withinPrediction) {
      this.touchOnPrediction = false;
      console.log(`[TouchStart:${mode}] EARLY EXIT - not within prediction`);
      return;
    }

    const offsetAtStart = this.getOffsetFromPoint(x, y);
    console.log(`[TouchStart:${mode}] offsetAtStart=${offsetAtStart}`);

    if (offsetAtStart === null) {
      this.touchOnPrediction = false;
      console.log(`[TouchStart:${mode}] EARLY EXIT - offset is null`);
      return;
    }

    this.touchStartX = x;
    this.touchStartY = y;
    this.touchStartOffset = offsetAtStart;
    this.touchMoved = false;
    this.touchOnPrediction = true;

    console.log(`[TouchStart:${mode}] SUCCESS - touchOnPrediction=true, offset=${offsetAtStart}`);

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
        console.log(`[TouchStart:SELECT] First tap - setting start`);
        this.selectStartOffset = wordBounds.start;
        this.selectPreviewOffset = wordBounds.end;
        this.selectionFixed = false;
        this.updatePredictionDisplay();
        this.setSelectionReady(false);
      } else if (!this.selectionFixed) {
        // Second tap: set end point, fix selection
        console.log(`[TouchStart:SELECT] Second tap - setting end`);
        if (wordBounds.end <= this.selectStartOffset) {
          this.selectPreviewOffset = wordBounds.start;
        } else {
          this.selectPreviewOffset = wordBounds.end;
        }
        this.selectionFixed = true;
        this.updatePredictionDisplay();
        this.setSelectionReady(true);
      } else {
        // Third tap: reset and start fresh
        console.log(`[TouchStart:SELECT] Third tap - reset, new start`);
        this.selectStartOffset = wordBounds.start;
        this.selectPreviewOffset = wordBounds.end;
        this.selectionFixed = false;
        this.updatePredictionDisplay();
        this.setSelectionReady(false);
      }
    }
  }

  onEditorTouchMove(e) {
    const mode = this.selectModeActive ? 'SELECT' : 'NORMAL';
    console.log(`[TouchMove:${mode}] FIRED - touchOnPrediction=${this.touchOnPrediction}, selectTouchActive=${this.selectTouchActive}`);

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
      console.log(`[TouchMove:SELECT] offset=${offset}, selectTouchActive=${this.selectTouchActive}`);
      if (offset === null) return;
      const wordBounds = this.getWordBoundaries(offset);
      if (!wordBounds) return;

      if (wordBounds.end <= this.selectStartOffset) {
        this.selectPreviewOffset = wordBounds.start;
      } else {
        this.selectPreviewOffset = wordBounds.end;
      }
      console.log(`[TouchMove:SELECT] start=${this.selectStartOffset}, preview=${this.selectPreviewOffset}`);
      this.updatePredictionDisplay();
      this.setSelectionReady(this.selectStartOffset !== this.selectPreviewOffset);
    }
  }

  onEditorTouchEnd(e) {
    const mode = this.selectModeActive ? 'SELECT' : 'NORMAL';
    console.log(`[TouchEnd:${mode}] touchOnPrediction=${this.touchOnPrediction}`);

    if (!this.touchOnPrediction) {
      console.log(`[TouchEnd:${mode}] EARLY EXIT - touchOnPrediction is false`);
      return;
    }

    // Save touchStart coords before reset (more accurate for tap detection on mobile)
    const startX = this.touchStartX;
    const startY = this.touchStartY;
    const startOffset = this.touchStartOffset;

    const touch = e.changedTouches?.[0];
    if (!touch) {
      console.log(`[TouchEnd:${mode}] EARLY EXIT - no touch in changedTouches`);
      return;
    }

    const coords = { x: touch.clientX, y: touch.clientY };
    const gestureMoved = this.touchMoved;

    console.log(`[TouchEnd:${mode}] startOffset=${startOffset}, gestureMoved=${gestureMoved}`);

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
      console.log(`[TouchEnd:SELECT] Taking SELECT DRAG path`);
      const offset = this.getOffsetFromPoint(coords.x, coords.y);
      this.selectTouchActive = false;

      if (offset !== null) {
        const wordBounds = this.getWordBoundaries(offset);
        if (wordBounds) {
          if (wordBounds.end <= this.selectStartOffset) {
            this.selectPreviewOffset = wordBounds.start;
          } else {
            this.selectPreviewOffset = wordBounds.end;
          }
        }
      }
      this.updatePredictionDisplay();
      this.setSelectionReady(this.selectStartOffset !== this.selectPreviewOffset);
      return;
    }

    // Select mode tap
    if (this.selectModeActive) {
      console.log(`[TouchEnd:SELECT] Taking SELECT TAP path`);
      const offset = this.getOffsetFromPoint(coords.x, coords.y);
      this.handleSelectModeSelection(offset);
      return;
    }

    // Normal mode - ignore if finger moved
    if (gestureMoved) {
      console.log(`[TouchEnd:NORMAL] EARLY EXIT - finger moved`);
      return;
    }

    // Normal mode - use saved offset from touchStart (most reliable)
    // This fixes the bug where touchend coordinates drift or map to wrong range
    const offset = startOffset;
    console.log(`[TouchEnd:NORMAL] Using startOffset=${offset}`);

    if (offset !== null) {
      const wordBounds = this.getWordBoundaries(offset);
      console.log(`[TouchEnd:NORMAL] wordBounds=`, wordBounds);
      if (wordBounds) {
        this.hoverOffset = wordBounds.end;
      } else {
        this.hoverOffset = offset;
      }
      this.navigationOffset = 0;
      console.log(`[TouchEnd:NORMAL] Calling acceptPrediction() with hoverOffset=${this.hoverOffset}`);
      this.acceptPrediction();
    } else {
      console.log(`[TouchEnd:NORMAL] SKIP - offset is null`);
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
      const response = await fetch('/api/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          sessionId: window.contextManager?.getSessionId()
        }),
        signal: this.abortController.signal
      });

      if (!response.ok) {
        throw new Error('Prediction request failed');
      }

      await this.handleStreamingResponse(response);
    } catch (error) {
      if (error.name !== 'AbortError') {
        console.error('Prediction error:', error);
      }
    }
  }

  async handleStreamingResponse(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let prediction = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
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
    this.motionRemainText = '';
    this.insertInlinePrediction();
    this.updatePredictionDisplay();
  }

  updatePredictionDisplay() {
    if (!this.inlinePredictionEl || !this.currentPrediction) return;

    if (this.selectModeActive) {
      // Before first click - show hovered word preview
      if (this.selectStartOffset === null && this.selectPreviewOffset !== null && this.hoverWordEnd !== null) {
        this.renderPredictionParts(
          this.currentPrediction.slice(0, this.selectPreviewOffset),
          this.currentPrediction.slice(this.selectPreviewOffset, this.hoverWordEnd),
          this.currentPrediction.slice(this.hoverWordEnd)
        );
        return;
      }
      // After first click - show selection range
      if (this.selectStartOffset !== null && this.selectPreviewOffset !== null) {
        const start = Math.min(this.selectStartOffset, this.selectPreviewOffset);
        const end = Math.max(this.selectStartOffset, this.selectPreviewOffset);
        if (start === end) {
          this.renderPredictionParts('', '', this.currentPrediction);
          return;
        }
        this.renderPredictionParts(
          this.currentPrediction.slice(0, start),
          this.currentPrediction.slice(start, end),
          this.currentPrediction.slice(end)
        );
        return;
      }
      this.renderPredictionParts('', '', this.currentPrediction);
      return;
    }

    // Normal mode
    const activeOffset = this.hoverOffset || this.navigationOffset;

    if (activeOffset === 0) {
      this.renderPredictionParts('', '', this.currentPrediction);
    } else {
      const acceptPart = this.currentPrediction.slice(0, activeOffset);
      const remainPart = this.currentPrediction.slice(activeOffset);
      this.renderPredictionParts('', acceptPart, remainPart);
    }
  }

  renderPredictionParts(prePart, acceptPart, remainPart) {
    if (!this.inlinePredictionEl) return;

    this.inlinePredictionEl.innerHTML = '';
    const shouldAnimate = this.enableRiseMotion && !acceptPart && !prePart;

    if (!shouldAnimate) {
      this.motionRemainText = '';
    }

    if (prePart) {
      const preSpan = document.createElement('span');
      preSpan.className = 'prediction-remain';
      preSpan.textContent = prePart;
      this.inlinePredictionEl.appendChild(preSpan);
    }

    if (acceptPart) {
      const acceptSpan = document.createElement('span');
      acceptSpan.className = 'prediction-accept';
      acceptSpan.textContent = acceptPart;
      this.inlinePredictionEl.appendChild(acceptSpan);
    }

    if (remainPart) {
      if (shouldAnimate) {
        this.applyRiseMotion(remainPart);
      } else {
        const remainSpan = document.createElement('span');
        remainSpan.className = 'prediction-remain';
        remainSpan.textContent = remainPart;
        this.inlinePredictionEl.appendChild(remainSpan);
        this.motionRemainText = remainPart;
      }
    } else {
      this.motionRemainText = '';
    }
  }

  applyRiseMotion(targetText) {
    const previous = this.motionRemainText || '';

    if (!targetText.startsWith(previous)) {
      const remainSpan = document.createElement('span');
      remainSpan.className = 'prediction-remain';
      remainSpan.textContent = targetText;
      this.inlinePredictionEl.appendChild(remainSpan);
      this.motionRemainText = targetText;
      return;
    }

    // Keep existing content
    const newSegment = targetText.slice(previous.length);
    if (!newSegment) return;

    const tokens = newSegment.match(/\S+|\s+/g) || [];
    tokens.forEach((token) => {
      if (/^\s+$/.test(token)) {
        this.inlinePredictionEl.appendChild(document.createTextNode(token));
      } else {
        const span = document.createElement('span');
        span.textContent = token;
        span.className = 'word-rise';
        this.inlinePredictionEl.appendChild(span);
      }
    });

    this.motionRemainText = targetText;
  }

  normalizeAcceptedText(text) {
    let output = text;
    const endsWithSentence = output.trimEnd().endsWith('.');

    if (output && !output.endsWith(' ') && !endsWithSentence) {
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
    const safeEnd = Math.max(safeStart, Math.min(endOffset, this.currentPrediction.length));
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
      this.motionRemainText = '';
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
    console.log(`[acceptPrediction] currentPrediction="${this.currentPrediction?.substring(0, 30)}...", hoverOffset=${this.hoverOffset}, navigationOffset=${this.navigationOffset}`);

    if (!this.currentPrediction) {
      console.log(`[acceptPrediction] EARLY EXIT - no currentPrediction`);
      return;
    }

    const activeOffset = this.hoverOffset || this.navigationOffset;
    const endOffset = activeOffset > 0 && activeOffset <= this.currentPrediction.length
      ? activeOffset
      : this.currentPrediction.length;

    console.log(`[acceptPrediction] activeOffset=${activeOffset}, endOffset=${endOffset}, calling commitAcceptance(0, ${endOffset})`);
    this.commitAcceptance(0, endOffset);
  }

  // SELECT MODE METHODS

  enableSelectMode() {
    this.selectModeActive = true;
    this.selectStartOffset = null;
    this.selectEndOffset = null;
    this.selectPreviewOffset = null;
    this.selectTouchActive = false;
    this.pointerSelecting = false;
    this.selectionFixed = false;
    this.setSelectionReady(false);

    document.body.classList.add('select-mode-active');

    this.hoverOffset = 0;
    this.navigationOffset = 0;
    this.updatePredictionDisplay();

    const selectBtn = document.querySelector('.select-menu-btn');
    if (selectBtn) selectBtn.classList.add('active');

    const burgerIcon = document.querySelector('.burger-btn .material-symbols-outlined');
    if (burgerIcon) burgerIcon.textContent = 'close';
  }

  disableSelectMode() {
    this.selectModeActive = false;
    this.selectStartOffset = null;
    this.selectEndOffset = null;
    this.selectPreviewOffset = null;
    this.selectTouchActive = false;
    this.pointerSelecting = false;
    this.selectionFixed = false;
    this.setSelectionReady(false);

    document.body.classList.remove('select-mode-active');

    this.hoverOffset = 0;
    this.navigationOffset = 0;
    this.updatePredictionDisplay();

    const selectBtn = document.querySelector('.select-menu-btn');
    if (selectBtn) selectBtn.classList.remove('active');

    const burgerIcon = document.querySelector('.burger-btn .material-symbols-outlined');
    if (burgerIcon) burgerIcon.textContent = 'edit';
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
    if (this.selectStartOffset === null || this.selectPreviewOffset === null) return;
    if (this.selectPreviewOffset === this.selectStartOffset) return;

    const start = Math.min(this.selectStartOffset, this.selectPreviewOffset);
    const end = Math.max(this.selectStartOffset, this.selectPreviewOffset);
    this.acceptSelectModeRange(start, end);
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
    if (this.selectConfirmBtn) {
      this.selectConfirmBtn.disabled = !ready;
    }
  }

  acceptSelectModeRange(startOffset, endOffset) {
    if (!this.currentPrediction) return;
    this.commitAcceptance(startOffset, endOffset);
  }
}

class ContextManager {
  constructor() {
    this.sessionId = null;
    this.files = [];
    this.estimatedTokens = 0;

    this.modal = document.getElementById('context-modal');
    this.uploadZone = document.getElementById('upload-zone');
    this.uploadBtn = document.getElementById('upload-btn');
    this.fileInput = document.getElementById('file-input');
    this.filesContainer = document.getElementById('context-files');
    this.clearBtn = document.getElementById('context-clear-btn');
    this.statusEl = document.getElementById('context-status');
    this.contextMenuBtn = document.querySelector('.context-menu-btn');

    this.init();
  }

  init() {
    if (!this.uploadZone || !this.fileInput) return;

    // Click to upload (desktop zone)
    this.uploadZone.addEventListener('click', () => this.fileInput.click());

    // Click to upload (mobile button)
    if (this.uploadBtn) {
      this.uploadBtn.addEventListener('click', () => this.fileInput.click());
    }

    // File input change
    this.fileInput.addEventListener('change', (e) => this.handleFiles(e.target.files));

    // Drag and drop
    this.uploadZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.uploadZone.classList.add('dragover');
    });

    this.uploadZone.addEventListener('dragleave', () => {
      this.uploadZone.classList.remove('dragover');
    });

    this.uploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      this.uploadZone.classList.remove('dragover');
      this.handleFiles(e.dataTransfer.files);
    });

    // Clear button
    if (this.clearBtn) {
      this.clearBtn.addEventListener('click', () => this.clearContext());
    }

    // Modal close
    if (this.modal) {
      const closeBtn = this.modal.querySelector('.modal-close');
      if (closeBtn) {
        closeBtn.addEventListener('click', () => this.closeModal());
      }
      this.modal.addEventListener('click', (e) => {
        if (e.target === this.modal) this.closeModal();
      });
    }
  }

  async handleFiles(fileList) {
    if (!fileList || fileList.length === 0) return;

    const formData = new FormData();
    for (const file of fileList) {
      formData.append('files', file);
    }

    if (this.statusEl) {
      this.statusEl.textContent = 'Uploading...';
    }

    try {
      const response = await fetch('/api/context', {
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

  async clearContext() {
    if (this.sessionId) {
      try {
        await fetch(`/api/context/${this.sessionId}`, { method: 'DELETE' });
      } catch (e) {
        console.error('Error clearing context:', e);
      }
    }

    this.sessionId = null;
    this.files = [];
    this.estimatedTokens = 0;
    this.updateUI();
  }

  updateUI() {
    // Update files list
    if (this.filesContainer) {
      this.filesContainer.innerHTML = this.files
        .map(
          (filename) => `
        <div class="context-file">
          <span class="context-file-name">
            <span class="material-symbols-outlined">description</span>
            ${filename}
          </span>
        </div>
      `
        )
        .join('');
    }

    // Update status
    if (this.files.length > 0) {
      if (this.statusEl) {
        this.statusEl.textContent = `~${this.estimatedTokens.toLocaleString()} tokens`;
      }
      if (this.clearBtn) {
        this.clearBtn.disabled = false;
      }
    } else {
      if (this.statusEl) {
        this.statusEl.textContent = '';
      }
      if (this.clearBtn) {
        this.clearBtn.disabled = true;
      }
    }

    // Update menu button indicator
    if (this.contextMenuBtn) {
      this.contextMenuBtn.classList.toggle('has-context', this.files.length > 0);
    }
  }

  openModal() {
    if (this.modal) {
      this.modal.classList.add('visible');
    }
  }

  closeModal() {
    if (this.modal) {
      this.modal.classList.remove('visible');
    }
  }

  getSessionId() {
    return this.sessionId;
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const predictionManager = new PredictionManager();
  window.contextManager = new ContextManager();

  // Modal handling
  const modal = document.getElementById('about-modal');
  const logo = document.querySelector('.logo');
  const modalClose = document.querySelector('.modal-close');

  setTimeout(() => {
    logo.classList.add('animate');
  }, 100);

  const openModal = () => modal.classList.add('visible');
  logo.addEventListener('click', openModal);

  modalClose.addEventListener('click', () => {
    modal.classList.remove('visible');
  });

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

  // BURGER MENU FUNCTIONALITY
  const burgerBtn = document.querySelector('.burger-btn');
  const burgerIcon = burgerBtn.querySelector('.material-symbols-outlined');
  const menuOverlay = document.querySelector('.menu-overlay');
  const copyMenuBtn = document.querySelector('.copy-menu-btn');
  const clearMenuBtn = document.querySelector('.clear-menu-btn');
  const selectMenuBtn = document.querySelector('.select-menu-btn');
  const editor = document.querySelector('.editor');
  let menuReadyTimeout = null;

  const openMenu = () => {
    menuOverlay.classList.add('visible');
    if (burgerIcon) burgerIcon.textContent = 'close';
    if (menuReadyTimeout) {
      clearTimeout(menuReadyTimeout);
    }
    menuReadyTimeout = setTimeout(() => {
      menuOverlay.classList.add('menu-ready');
      menuReadyTimeout = null;
    }, 120);
  };

  const closeMenu = () => {
    if (!menuOverlay.classList.contains('visible')) return;
    if (menuReadyTimeout) {
      clearTimeout(menuReadyTimeout);
      menuReadyTimeout = null;
    }
    menuOverlay.classList.remove('menu-ready');
    menuOverlay.classList.remove('visible');
    if (!predictionManager.selectModeActive && burgerIcon) {
      burgerIcon.textContent = 'edit';
    }
  };

  burgerBtn.addEventListener('click', () => {
    if (predictionManager.selectModeActive) {
      predictionManager.disableSelectMode();
      if (burgerIcon) burgerIcon.textContent = 'edit';
      return;
    }

    if (menuOverlay.classList.contains('visible')) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  menuOverlay.addEventListener('click', (e) => {
    if (e.target === menuOverlay) {
      closeMenu();
    }
  });

  copyMenuBtn.addEventListener('click', async () => {
    const text = predictionManager.getEditorText();
    if (!text) {
      closeMenu();
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      const copyLabel = copyMenuBtn.querySelector('.menu-label');
      const originalText = copyLabel ? copyLabel.textContent : 'Copy';
      if (copyLabel) copyLabel.textContent = 'Copied';

      setTimeout(() => {
        if (copyLabel) copyLabel.textContent = originalText;
        closeMenu();
      }, 800);
    } catch (err) {
      console.error('Failed to copy:', err);
      closeMenu();
    }
  });

  clearMenuBtn.addEventListener('click', () => {
    predictionManager.removeInlinePrediction();
    editor.textContent = '';
    editor.focus();
    editor.dispatchEvent(new Event('input'));
    closeMenu();
  });

  selectMenuBtn.addEventListener('click', () => {
    if (predictionManager.selectModeActive) {
      predictionManager.disableSelectMode();
    } else {
      predictionManager.enableSelectMode();
    }
    closeMenu();
  });

  // Context menu button
  const contextMenuBtn = document.querySelector('.context-menu-btn');
  if (contextMenuBtn) {
    contextMenuBtn.addEventListener('click', () => {
      window.contextManager.openModal();
      closeMenu();
    });
  }

  // Theme toggle button
  const themeMenuBtn = document.querySelector('.theme-menu-btn');
  if (themeMenuBtn) {
    const themeLabel = themeMenuBtn.querySelector('.menu-label');

    const updateThemeButton = () => {
      const isLight = document.documentElement.getAttribute('data-theme') === 'light';
      if (themeLabel) {
        themeLabel.textContent = isLight ? 'Dark mode' : 'Light mode';
      }
    };

    themeMenuBtn.addEventListener('click', () => {
      const html = document.documentElement;
      const isCurrentlyLight = html.getAttribute('data-theme') === 'light';
      html.setAttribute('data-theme', isCurrentlyLight ? 'dark' : 'light');
      updateThemeButton();
      closeMenu();
    });

    // Initialize button text based on current theme
    updateThemeButton();
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menuOverlay.classList.contains('visible')) {
      closeMenu();
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

