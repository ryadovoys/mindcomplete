const ENABLE_RISE_AND_SET = true; // Flip to false to return to classic streaming

class PredictionManager {
  constructor(options = {}) {
    this.debounceMs = options.debounceMs || 1000;
    this.minTextLength = options.minTextLength || 10;
    this.debounceTimer = null;
    this.abortController = null;
    this.thinkingTimer = null;
    this.currentPrediction = '';
    this.navigationOffset = 0; // How many chars into prediction we've navigated (clicked)
    this.hoverOffset = 0; // Hover position (temporary)

    // SELECT mode state
    this.selectModeActive = false;
    this.selectStartOffset = null;
    this.selectEndOffset = null;
    this.selectPreviewOffset = null;
    this.selectTouchActive = false;
    this.pointerSelecting = false;
    this.selectionReady = false;
    this.selectionFixed = false; // True after second click (stop hover updates)
    this.hoverWordEnd = null; // End of hovered word (before first click)
    this.touchStartX = null;
    this.touchStartY = null;
    this.touchMoved = false;
    this.isMobile = this.detectMobile();
    this.updateMobileBodyClass();

    this.editor = document.querySelector('.editor');
    this.ghostLayer = document.querySelector('.ghost-layer');
    this.userTextMirror = document.querySelector('.user-text-mirror');
    this.thinkingIndicator = document.querySelector('.thinking-indicator');
    this.predictionEl = document.querySelector('.prediction');
    this.predictionPreEl = document.querySelector('.prediction-pre');
    this.predictionAcceptEl = document.querySelector('.prediction-accept');
    this.predictionRemainEl = document.querySelector('.prediction-remain');
    this.enableRiseMotion = ENABLE_RISE_AND_SET;
    this.motionRemainText = '';

    // SELECT mode DOM elements
    this.selectModeIndicator = null;
    this.selectStartLine = null;
    this.selectConfirmBtn = null;

    this.init();
  }

  detectMobile() {
    // Check for mobile devices via UA or viewport width
    const userAgent = navigator.userAgent || navigator.vendor || window.opera;
    const isMobileUA = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent.toLowerCase());
    const matchesWidth = () => window.matchMedia('(max-width: 768px)').matches;
    const isMobileWidth = matchesWidth();

    // Listen for resize events to keep class in sync with viewport
    window.addEventListener('resize', () => {
      const widthMatch = matchesWidth();
      this.isMobile = isMobileUA || widthMatch;
      this.updateMobileBodyClass();
    });

    return isMobileUA || isMobileWidth;
  }

  updateMobileBodyClass() {
    if (!document.body) return;
    document.body.classList.toggle('mobile-touch', Boolean(this.isMobile));
  }

  init() {
    // Get SELECT mode DOM elements
    this.selectModeIndicator = document.querySelector('.select-mode-indicator');
    this.selectStartLine = document.querySelector('.select-start-line');
    this.selectConfirmBtn = document.querySelector('.select-confirm-btn');

    // Handle input events
    this.editor.addEventListener('input', () => this.onInput());

    // Handle keydown for TAB acceptance
    this.editor.addEventListener('keydown', (e) => this.onKeyDown(e));

    // Handle clicks on prediction
    this.predictionEl.addEventListener('click', (e) => this.onPredictionClick(e));

    // Handle hover on prediction
    this.predictionEl.addEventListener('pointermove', (e) => this.onPredictionHover(e));
    this.predictionEl.addEventListener('pointerleave', () => this.onPredictionLeave());

    // Handle selection on prediction (using pointer events)
    this.predictionEl.addEventListener('pointerup', (e) => this.onPredictionMouseUp(e));
    this.predictionEl.addEventListener('pointerdown', (e) => this.onPredictionMouseDown(e));
    this.predictionEl.addEventListener('touchstart', (e) => this.onPredictionTouchStart(e), { passive: false });
    this.predictionEl.addEventListener('touchmove', (e) => this.onPredictionTouchMove(e), { passive: false });
    this.predictionEl.addEventListener('touchend', (e) => this.onPredictionTouchEnd(e), { passive: false });

    // Focus editor on page load
    this.editor.focus();

    if (this.selectConfirmBtn) {
      this.selectConfirmBtn.addEventListener('click', () => {
        this.confirmSelectSelection();
      });
      this.selectConfirmBtn.disabled = true;
    }
  }

  onInput() {
    const text = this.editor.textContent;

    // Cancel any pending prediction
    this.cancelPending();

    // Clear ghost text immediately when typing
    this.clearPrediction();

    // Update the mirror text (for positioning)
    this.userTextMirror.textContent = text;

    // Only request prediction if we have enough text
    if (text.trim().length >= this.minTextLength) {
      this.debounceTimer = setTimeout(() => {
        this.requestPrediction(text);
      }, this.debounceMs);
    }
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
      // Check if cursor is at the end of user text
      if (this.isCursorAtEnd() && this.navigationOffset < this.currentPrediction.length) {
        e.preventDefault();
        this.navigationOffset++;
        this.updatePredictionDisplay();
      }
    }
  }

  onPredictionHover(e) {
    if (e && e.pointerType && e.pointerType !== 'mouse') return;
    if (this.selectModeActive) {
      // Desktop: show word-based preview
      if (!this.isMobile && !this.selectionFixed) {
        const offset = this.getOffsetFromMouseEvent(e);
        if (offset !== null) {
          const wordBounds = this.getWordBoundaries(offset);
          if (wordBounds) {
            if (this.selectStartOffset === null) {
              // Before first click - preview the word that will be selected
              this.selectPreviewOffset = wordBounds.start;
              this.hoverWordEnd = wordBounds.end;
            } else {
              // After first click - extend selection to include the hovered word
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
      // Normal mode: word-based hover
      const offset = this.getOffsetFromMouseEvent(e);
      if (offset !== null) {
        const wordBounds = this.getWordBoundaries(offset);
        if (wordBounds) {
          this.hoverOffset = wordBounds.end; // Highlight up to end of word
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
      // Clear hover preview before first click
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
    // Click handling is now done in mouse/touch events to distinguish from drag selection
  }

  onPredictionMouseDown(e) {
    // Desktop: do nothing on mousedown, handle clicks in mouseup
    if ((e.pointerType && e.pointerType !== 'mouse') || this.isMobile || e.button !== 0) return;
    if (!this.selectModeActive) return;
    e.preventDefault();
  }

  onPredictionMouseUp(e) {
    if (e.pointerType && e.pointerType !== 'mouse') return;
    // Desktop select mode: two-click selection (word-based)
    if (!this.isMobile && this.selectModeActive) {
      const offset = this.getOffsetFromMouseEvent(e);
      if (offset === null) return;

      const wordBounds = this.getWordBoundaries(offset);
      if (!wordBounds) return;

      if (this.selectStartOffset === null) {
        // First click - set start to beginning of clicked word
        this.selectStartOffset = wordBounds.start;
        this.selectPreviewOffset = wordBounds.end; // Select the first word immediately
        this.hoverWordEnd = null; // Clear hover preview state
        this.selectionFixed = false; // Allow hover to update preview
        this.updatePredictionDisplay();
        this.setSelectionReady(true);
      } else if (!this.selectionFixed) {
        // Second click - fix the end point
        if (wordBounds.end <= this.selectStartOffset) {
          // Clicking before start - extend backwards
          this.selectPreviewOffset = this.selectStartOffset;
          this.selectStartOffset = wordBounds.start;
        } else {
          this.selectPreviewOffset = wordBounds.end;
        }
        this.selectionFixed = true; // Stop hover updates
        this.updatePredictionDisplay();
        this.setSelectionReady(this.selectStartOffset !== this.selectPreviewOffset);
      }
      return;
    }

    // If SELECT mode is active (mobile), handle differently
    if (this.selectModeActive) {
      const offset = this.getOffsetFromMouseEvent(e);
      this.handleSelectModeSelection(offset);
      return;
    }

    // Normal mode - word-based selection
    const selection = window.getSelection();
    const selectedText = selection.toString();

    // Check if user selected text (drag) vs just clicked
    if (selectedText.length > 0) {
      // User dragged to select text - accept the selected portion
      this.acceptSelectedText(selection);
    } else {
      // User just clicked - accept up to end of clicked word
      const offset = this.getOffsetFromMouseEvent(e);
      if (offset !== null) {
        const wordBounds = this.getWordBoundaries(offset);
        if (wordBounds) {
          this.hoverOffset = wordBounds.end; // Accept to end of word
        } else {
          this.hoverOffset = offset;
        }
        this.navigationOffset = 0;
        this.acceptPrediction();
      }
    }
  }

  onPredictionTouchStart(e) {
    if (!this.isMobile || !e.touches || !e.touches.length) return;
    const touch = e.touches[0];
    this.touchStartX = touch.clientX;
    this.touchStartY = touch.clientY;
    this.touchMoved = false;

    if (!this.selectModeActive) return;

    const offset = this.getOffsetFromPoint(touch.clientX, touch.clientY);
    if (offset === null) return;

    const wordBounds = this.getWordBoundaries(offset);
    if (!wordBounds) return;

    e.preventDefault();
    this.selectTouchActive = true;
    this.selectStartOffset = wordBounds.start;
    this.selectPreviewOffset = wordBounds.end;
    this.updatePredictionDisplay();
    this.showStartLineForOffset(wordBounds.start);
    this.setSelectionReady(true);
  }

  onPredictionTouchMove(e) {
    if (!this.isMobile || !e.touches || !e.touches.length) return;
    const touch = e.touches[0];

    if (this.touchStartX !== null && this.touchStartY !== null) {
      const deltaX = Math.abs(touch.clientX - this.touchStartX);
      const deltaY = Math.abs(touch.clientY - this.touchStartY);
      if (deltaX > 5 || deltaY > 5) {
        this.touchMoved = true;
      }
    }

    if (!this.selectModeActive || !this.selectTouchActive) return;

    const offset = this.getOffsetFromPoint(touch.clientX, touch.clientY);
    if (offset === null) return;

    const wordBounds = this.getWordBoundaries(offset);
    if (!wordBounds) return;

    e.preventDefault();
    // Extend selection to include the touched word
    if (wordBounds.end <= this.selectStartOffset) {
      this.selectPreviewOffset = wordBounds.start;
    } else {
      this.selectPreviewOffset = wordBounds.end;
    }
    this.updatePredictionDisplay();
    this.setSelectionReady(this.selectStartOffset !== this.selectPreviewOffset);
  }

  onPredictionTouchEnd(e) {
    if (!this.isMobile || !e.changedTouches || !e.changedTouches.length) return;
    const touch = e.changedTouches[0];
    const coords = { x: touch.clientX, y: touch.clientY };
    const gestureMoved = this.touchMoved;
    this.touchStartX = null;
    this.touchStartY = null;
    this.touchMoved = false;

    if (this.selectModeActive && this.isMobile && this.selectTouchActive) {
      e.preventDefault();
      e.stopPropagation();

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

    if (this.selectModeActive) {
      e.preventDefault();
      e.stopPropagation();
      const offset = this.getOffsetFromPoint(coords.x, coords.y);
      this.handleSelectModeSelection(offset);
      return;
    }

    if (gestureMoved) {
      return;
    }

    // Normal mode - word-based touch
    const offset = this.getOffsetFromPoint(coords.x, coords.y);
    if (offset !== null) {
      e.preventDefault();
      e.stopPropagation();
      const wordBounds = this.getWordBoundaries(offset);
      if (wordBounds) {
        this.hoverOffset = wordBounds.end; // Accept to end of word
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
    return this.getOffsetFromRange(range);
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

  getOffsetFromRange(range) {
    if (!range) return null;

    const container = range.startContainer;
    const preLength = this.predictionPreEl?.textContent.length || 0;
    const acceptLength = this.predictionAcceptEl.textContent.length;
    const offsetWithin = (node, base = 0) => {
      try {
        const clone = range.cloneRange();
        clone.setStart(node, 0);
        return base + clone.toString().length;
      } catch (err) {
        return null;
      }
    };

    let offset = null;

    if (this.predictionPreEl && (this.predictionPreEl === container || this.predictionPreEl.contains(container))) {
      offset = offsetWithin(this.predictionPreEl, 0);
    } else if (this.predictionAcceptEl && (this.predictionAcceptEl === container || this.predictionAcceptEl.contains(container))) {
      offset = offsetWithin(this.predictionAcceptEl, preLength);
    } else if (this.predictionRemainEl && (this.predictionRemainEl === container || this.predictionRemainEl.contains(container))) {
      offset = offsetWithin(this.predictionRemainEl, preLength + acceptLength);
    } else if (container === this.predictionEl) {
      offset = range.startOffset === 0 ? 0 : this.currentPrediction.length;
    }

    if (offset === null) return null;

    const clamped = Math.max(0, Math.min(offset, this.currentPrediction.length));
    return clamped;
  }

  // Get word boundaries at a given character offset
  getWordBoundaries(offset) {
    if (!this.currentPrediction || offset < 0 || offset > this.currentPrediction.length) {
      return null;
    }

    const text = this.currentPrediction;

    // Find word start (go backwards to find space or start)
    let wordStart = offset;
    while (wordStart > 0 && !/\s/.test(text[wordStart - 1])) {
      wordStart--;
    }

    // Find word end (go forwards to find space or end)
    let wordEnd = offset;
    while (wordEnd < text.length && !/\s/.test(text[wordEnd])) {
      wordEnd++;
    }

    return { start: wordStart, end: wordEnd };
  }

  resolveNodeForOffset(rawOffset) {
    if (!this.currentPrediction) return null;
    const totalLength = this.currentPrediction.length;
    const offset = Math.max(0, Math.min(rawOffset, totalLength));

    const preLength = this.predictionPreEl?.textContent.length || 0;
    const acceptLength = this.predictionAcceptEl?.textContent.length || 0;

    let node;
    let localOffset = offset;

    if (offset <= preLength) {
      node = this.predictionPreEl.firstChild || this.predictionPreEl;
    } else if (offset <= preLength + acceptLength) {
      node = this.predictionAcceptEl.firstChild || this.predictionAcceptEl;
      localOffset = offset - preLength;
    } else {
      node = this.predictionRemainEl.firstChild || this.predictionRemainEl;
      localOffset = offset - preLength - acceptLength;
    }

    if (!node) return null;
    const maxOffset = node.nodeType === Node.TEXT_NODE
      ? node.textContent.length
      : node.childNodes.length;

    return {
      node,
      offset: Math.max(0, Math.min(localOffset, maxOffset))
    };
  }

  getRangeForOffset(offset) {
    const resolved = this.resolveNodeForOffset(offset);
    if (!resolved) return null;
    const range = document.createRange();
    range.setStart(resolved.node, resolved.offset);
    range.collapse(true);
    return range;
  }

  isCursorAtEnd() {
    const selection = window.getSelection();
    if (!selection.rangeCount) return false;

    const range = selection.getRangeAt(0);
    const cursorOffset = range.endOffset;
    const textLength = this.editor.textContent.length;

    // Check if cursor is at the end of the text
    return cursorOffset === textLength ||
           (range.endContainer === this.editor && cursorOffset === this.editor.childNodes.length);
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
    this.hideThinking();
  }

  clearPrediction() {
    this.currentPrediction = '';
    this.navigationOffset = 0;
    this.hoverOffset = 0;
    this.selectPreviewOffset = null;
    this.predictionPreEl.textContent = '';
    this.predictionAcceptEl.textContent = '';
    this.useClassicRemain('');
    this.hideThinking();
  }

  async requestPrediction(text) {
    this.abortController = new AbortController();

    // Show thinking indicator after a delay (only if request is still pending)
    this.showThinkingDelayed();

    try {
      const response = await fetch('/api/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
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
      this.hideThinking();
    }
  }

  showThinkingDelayed(delay = 200) {
    // Clear any existing thinking timer
    if (this.thinkingTimer) {
      clearTimeout(this.thinkingTimer);
    }

    // Show thinking indicator only after delay
    this.thinkingTimer = setTimeout(() => {
      this.thinkingIndicator.classList.add('visible');
    }, delay);
  }

  hideThinking() {
    // Clear the timer if it hasn't fired yet
    if (this.thinkingTimer) {
      clearTimeout(this.thinkingTimer);
      this.thinkingTimer = null;
    }
    // Hide the indicator
    this.thinkingIndicator.classList.remove('visible');
  }

  async handleStreamingResponse(response) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let prediction = '';
    let firstChunk = true;

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
                // Hide thinking indicator on first content
                if (firstChunk) {
                  this.hideThinking();
                  firstChunk = false;
                }
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
    this.navigationOffset = 0; // Reset navigation when prediction updates
    this.hoverOffset = 0; // Reset hover when prediction updates
    this.selectPreviewOffset = null;
    if (!this.selectModeActive) {
      this.selectStartOffset = null;
    }
    this.updatePredictionDisplay();
  }

  updatePredictionDisplay() {
    const userText = this.editor.textContent;
    this.userTextMirror.textContent = userText;

    if (this.selectModeActive) {
      // Before first click - show hovered word preview
      if (this.selectStartOffset === null && this.selectPreviewOffset !== null && this.hoverWordEnd !== null) {
        this.predictionPreEl.textContent = this.currentPrediction.slice(0, this.selectPreviewOffset);
        this.predictionAcceptEl.textContent = this.currentPrediction.slice(this.selectPreviewOffset, this.hoverWordEnd);
        this.useClassicRemain(this.currentPrediction.slice(this.hoverWordEnd));
        return;
      }
      // After first click - show selection range
      if (this.selectStartOffset !== null && this.selectPreviewOffset !== null) {
        const start = Math.min(this.selectStartOffset, this.selectPreviewOffset);
        const end = Math.max(this.selectStartOffset, this.selectPreviewOffset);
        if (start === end) {
          this.predictionPreEl.textContent = '';
          this.predictionAcceptEl.textContent = '';
          this.useClassicRemain(this.currentPrediction);
          return;
        }
        this.predictionPreEl.textContent = this.currentPrediction.slice(0, start);
        this.predictionAcceptEl.textContent = this.currentPrediction.slice(start, end);
        this.useClassicRemain(this.currentPrediction.slice(end));
        return;
      }
      this.predictionPreEl.textContent = '';
      this.predictionAcceptEl.textContent = '';
      this.useClassicRemain(this.currentPrediction);
      return;
    }

    this.predictionPreEl.textContent = '';

    // Use hoverOffset if hovering, otherwise use navigationOffset (clicked position)
    const activeOffset = this.hoverOffset || this.navigationOffset;

    if (activeOffset === 0) {
      // No navigation/hover - show all in remain color
      this.predictionAcceptEl.textContent = '';
      this.renderRemain(this.currentPrediction, true);
    } else {
      // Split into accept (white) and remain (dimmer)
      const acceptPart = this.currentPrediction.slice(0, activeOffset);
      const remainPart = this.currentPrediction.slice(activeOffset);

      this.predictionAcceptEl.textContent = acceptPart;
      this.renderRemain(remainPart, false);
    }
  }

  useClassicRemain(text) {
    this.predictionRemainEl.classList.remove('motion-rise');
    this.predictionRemainEl.textContent = text;
    this.motionRemainText = text;
  }

  renderRemain(text, allowMotion) {
    if (!this.enableRiseMotion || !allowMotion) {
      this.useClassicRemain(text);
      return;
    }

    this.predictionRemainEl.classList.add('motion-rise');
    this.applyRiseMotion(text);
  }

  applyRiseMotion(targetText) {
    const previous = this.motionRemainText || '';

    if (!targetText.startsWith(previous)) {
      this.useClassicRemain(targetText);
      return;
    }

    const newSegment = targetText.slice(previous.length);
    if (!newSegment) return;

    const tokens = newSegment.match(/\S+|\s+/g) || [];
    tokens.forEach((token) => {
      if (/^\s+$/.test(token)) {
        this.predictionRemainEl.appendChild(document.createTextNode(token));
      } else {
        const span = document.createElement('span');
        span.textContent = token;
        span.className = 'word-rise';
        this.predictionRemainEl.appendChild(span);
      }
    });

    this.motionRemainText = targetText;
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

    const textToAccept = this.currentPrediction.slice(startOffset, endOffset);
    this.editor.textContent += textToAccept;
    this.moveCursorToEnd();

    if (endOffset < this.currentPrediction.length) {
      this.currentPrediction = this.currentPrediction.slice(endOffset);
      this.navigationOffset = 0;
      this.hoverOffset = 0;
      this.userTextMirror.textContent = this.editor.textContent;
      this.updatePredictionDisplay();
    } else {
      this.userTextMirror.textContent = this.editor.textContent;
      this.clearPrediction();
      this.onInput();
    }

    selection.removeAllRanges();
  }

  acceptPrediction() {
    if (!this.currentPrediction) return;

    // Use hoverOffset if hovering, otherwise use navigationOffset
    const activeOffset = this.hoverOffset || this.navigationOffset;

    // Determine how much to accept
    const textToAccept = activeOffset > 0
      ? this.currentPrediction.slice(0, activeOffset)
      : this.currentPrediction;

    // Append accepted prediction to editor
    this.editor.textContent += textToAccept;

    // Move cursor to end
    this.moveCursorToEnd();

    // If we accepted partial prediction, keep the rest
    if (activeOffset > 0 && activeOffset < this.currentPrediction.length) {
      const remainingPrediction = this.currentPrediction.slice(activeOffset);
      this.currentPrediction = remainingPrediction;
      this.navigationOffset = 0;
      this.hoverOffset = 0;
      this.userTextMirror.textContent = this.editor.textContent;
      this.updatePredictionDisplay();
    } else {
      // Update mirror and clear prediction
      this.userTextMirror.textContent = this.editor.textContent;
      this.clearPrediction();

      // Trigger a new prediction after acceptance
      this.onInput();
    }
  }

  moveCursorToEnd() {
    const range = document.createRange();
    const selection = window.getSelection();
    range.selectNodeContents(this.editor);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
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

    // Visual feedback
    document.body.classList.add('select-mode-active');
    this.selectModeIndicator.classList.add('active');

    // Clear any hover highlights from normal mode
    this.hoverOffset = 0;
    this.navigationOffset = 0;
    this.updatePredictionDisplay();

    // Update menu button state
    const selectBtn = document.querySelector('.select-menu-btn');
    if (selectBtn) selectBtn.classList.add('active');

    // Change burger button to X
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

    // Clear visual feedback
    document.body.classList.remove('select-mode-active');
    this.selectModeIndicator.classList.remove('active');
    this.selectStartLine.classList.remove('visible');
    this.predictionEl.classList.remove('select-mode-hover');

    // Reset display to normal
    this.hoverOffset = 0;
    this.navigationOffset = 0;
    this.updatePredictionDisplay();

    // Update menu button state
    const selectBtn = document.querySelector('.select-menu-btn');
    if (selectBtn) selectBtn.classList.remove('active');

    // Change burger button back to menu icon
    const burgerIcon = document.querySelector('.burger-btn .material-symbols-outlined');
    if (burgerIcon) burgerIcon.textContent = 'menu';
  }

  handleSelectModeSelection(offset) {
    if (offset === null) return;

    if (this.selectStartOffset === null) {
      // First tap/click - set start point
      this.selectStartOffset = offset;
      this.selectPreviewOffset = this.isMobile ? offset : null;
      this.updatePredictionDisplay();
      this.setSelectionReady(false);

    } else {
      // Update end point and wait for confirmation (same for mobile and desktop)
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

  showStartLineForOffset(offset) {
    if (!this.selectStartLine) return;
    const range = this.getRangeForOffset(offset);
    if (!range) return;
    const predictionRect = this.predictionEl.getBoundingClientRect();
    const rect = range.getBoundingClientRect();
    const leftOffset = rect.left - predictionRect.left;
    const topOffset = rect.top - predictionRect.top;

    this.selectStartLine.style.left = `${leftOffset}px`;
    this.selectStartLine.style.top = `${topOffset}px`;
    this.selectStartLine.classList.add('visible');
  }

  acceptSelectModeRange(startOffset, endOffset) {
    if (!this.currentPrediction) return;

    // Extract the selected text
    const textToAccept = this.currentPrediction.slice(startOffset, endOffset);

    // Append to editor
    this.editor.textContent += textToAccept;
    this.moveCursorToEnd();

    // Keep only the part after selection
    if (endOffset < this.currentPrediction.length) {
      this.currentPrediction = this.currentPrediction.slice(endOffset);
      this.navigationOffset = 0;
      this.hoverOffset = 0;
      this.userTextMirror.textContent = this.editor.textContent;
      this.updatePredictionDisplay();
    } else {
      // Selected to the end - clear everything
      this.userTextMirror.textContent = this.editor.textContent;
      this.clearPrediction();
      this.onInput();
    }
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const predictionManager = new PredictionManager();

  // Modal handling
  const modal = document.getElementById('about-modal');
  const logo = document.querySelector('.logo');
  const modalClose = document.querySelector('.modal-close');

  // Open modal from logo
  const openModal = () => modal.classList.add('visible');
  logo.addEventListener('click', openModal);

  modalClose.addEventListener('click', () => {
    modal.classList.remove('visible');
  });

  // Close modal when clicking outside
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('visible');
    }
  });

  // Close modal with Escape key
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
  const aboutMenuBtn = document.querySelector('.about-menu-btn');
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
      burgerIcon.textContent = 'menu';
    }
  };

  // Open menu or exit SELECT mode
  burgerBtn.addEventListener('click', () => {
    if (predictionManager.selectModeActive) {
      predictionManager.disableSelectMode();
      if (burgerIcon) burgerIcon.textContent = 'menu';
      return;
    }

    if (menuOverlay.classList.contains('visible')) {
      closeMenu();
    } else {
      openMenu();
    }
  });

  // Close menu when clicking overlay background
  menuOverlay.addEventListener('click', (e) => {
    if (e.target === menuOverlay) {
      closeMenu();
    }
  });

  // COPY functionality
  copyMenuBtn.addEventListener('click', async () => {
    const text = editor.textContent;
    if (!text) {
      closeMenu();
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      // Visual feedback
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

  // CLEAR functionality
  clearMenuBtn.addEventListener('click', () => {
    editor.textContent = '';
    editor.focus();
    // Trigger input event to clear any predictions
    editor.dispatchEvent(new Event('input'));
    closeMenu();
  });

  // SELECT mode toggle
  selectMenuBtn.addEventListener('click', () => {
    if (predictionManager.selectModeActive) {
      predictionManager.disableSelectMode();
    } else {
      predictionManager.enableSelectMode();
    }
    closeMenu();
  });

  // ABOUT
  if (aboutMenuBtn) {
    aboutMenuBtn.addEventListener('click', () => {
      closeMenu();
      modal.classList.add('visible');
    });
  }

  // Close menu with Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && menuOverlay.classList.contains('visible')) {
      closeMenu();
    }
  });
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .catch((err) => console.error('Service worker registration failed:', err));
  });
}
