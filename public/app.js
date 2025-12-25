const ENABLE_RISE_AND_SET = true; // Flip to false to return to classic streaming

class PredictionManager {
  constructor(options = {}) {
    this.debounceMs = options.debounceMs || 1000;
    this.minTextLength = options.minTextLength || 10;
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
    this.touchMoved = false;
    this.isMobile = this.detectMobile();
    this.updateMobileBodyClass();

    this.editor = document.querySelector('.editor');
    this.enableRiseMotion = ENABLE_RISE_AND_SET;
    this.motionRemainText = '';

    // Inline prediction element (will be created dynamically)
    this.inlinePredictionEl = null;

    // SELECT mode DOM elements
    this.selectConfirmBtn = null;

    this.init();
  }

  detectMobile() {
    const userAgent = navigator.userAgent || navigator.vendor || window.opera;
    const isMobileUA = /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(userAgent.toLowerCase());
    const matchesWidth = () => window.matchMedia('(max-width: 768px)').matches;
    const isMobileWidth = matchesWidth();

    window.addEventListener('resize', () => {
      const widthMatch = matchesWidth();
      this.isMobile = isMobileUA || widthMatch;
      this.updateMobileBodyClass();
    });

    return isMobileUA || isMobileWidth;
  }

  getEditorText() {
    // Get only user text (exclude inline prediction)
    const clone = this.editor.cloneNode(true);
    const prediction = clone.querySelector('.inline-prediction');
    if (prediction) {
      prediction.remove();
    }
    let text = clone.innerText || '';
    text = text.replace(/\n+$/, '');
    return text;
  }

  updateMobileBodyClass() {
    if (!document.body) return;
    document.body.classList.toggle('mobile-touch', Boolean(this.isMobile));
  }

  init() {
    this.selectConfirmBtn = document.querySelector('.select-confirm-btn');

    // Handle input events
    this.editor.addEventListener('input', (e) => this.onInput(e));

    // Handle keydown for TAB acceptance
    this.editor.addEventListener('keydown', (e) => this.onKeyDown(e));

    // Focus editor on page load
    this.editor.focus();

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

    const text = this.getEditorText();

    // Cancel any pending prediction
    this.cancelPending();

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

      // Add event listeners
      this.inlinePredictionEl.addEventListener('click', (e) => this.onPredictionClick(e));
      this.inlinePredictionEl.addEventListener('pointermove', (e) => this.onPredictionHover(e));
      this.inlinePredictionEl.addEventListener('pointerleave', () => this.onPredictionLeave());
      this.inlinePredictionEl.addEventListener('pointerup', (e) => this.onPredictionMouseUp(e));
      this.inlinePredictionEl.addEventListener('pointerdown', (e) => this.onPredictionMouseDown(e));
      this.inlinePredictionEl.addEventListener('touchstart', (e) => this.onPredictionTouchStart(e), { passive: false });
      this.inlinePredictionEl.addEventListener('touchmove', (e) => this.onPredictionTouchMove(e), { passive: false });
      this.inlinePredictionEl.addEventListener('touchend', (e) => this.onPredictionTouchEnd(e), { passive: false });
    }
    return this.inlinePredictionEl;
  }

  // Insert inline prediction at the end of editor
  insertInlinePrediction() {
    const prediction = this.createInlinePrediction();
    if (!this.editor.contains(prediction)) {
      this.editor.appendChild(prediction);
    }
  }

  // Remove inline prediction from editor
  removeInlinePrediction() {
    if (this.inlinePredictionEl && this.editor.contains(this.inlinePredictionEl)) {
      this.inlinePredictionEl.remove();
    }
    this.currentPrediction = '';
    this.navigationOffset = 0;
    this.hoverOffset = 0;
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

    const range = selection.getRangeAt(0);

    // Check if cursor is right before the inline prediction or at the end
    if (this.inlinePredictionEl && this.editor.contains(this.inlinePredictionEl)) {
      // Cursor should be just before the prediction element
      const predictionIndex = Array.from(this.editor.childNodes).indexOf(this.inlinePredictionEl);
      if (predictionIndex > 0) {
        const prevNode = this.editor.childNodes[predictionIndex - 1];
        if (range.endContainer === prevNode || range.endContainer.parentNode === prevNode) {
          return range.endOffset === (prevNode.textContent || prevNode.innerText || '').length;
        }
      }
    }

    return false;
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

  clearPrediction() {
    this.removeInlinePrediction();
    this.selectPreviewOffset = null;
  }

  async requestPrediction(text) {
    this.abortController = new AbortController();

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
      if (this.enableRiseMotion && !acceptPart && !prePart) {
        // Apply rise motion for streaming
        this.applyRiseMotion(remainPart);
      } else {
        const remainSpan = document.createElement('span');
        remainSpan.className = 'prediction-remain';
        remainSpan.textContent = remainPart;
        this.inlinePredictionEl.appendChild(remainSpan);
      }
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

    // Remove prediction first
    this.removeInlinePrediction();

    // Add accepted text
    this.editor.textContent += textToAccept;
    this.moveCursorToEnd();

    if (endOffset < this.currentPrediction.length) {
      this.currentPrediction = this.currentPrediction.slice(endOffset);
      this.navigationOffset = 0;
      this.hoverOffset = 0;
      this.insertInlinePrediction();
      this.updatePredictionDisplay();
    } else {
      this.currentPrediction = '';
      this.onInput();
    }

    selection.removeAllRanges();
  }

  acceptPrediction() {
    if (!this.currentPrediction) return;

    const activeOffset = this.hoverOffset || this.navigationOffset;

    let textToAccept = activeOffset > 0
      ? this.currentPrediction.slice(0, activeOffset)
      : this.currentPrediction;

    const endsWithPeriod = textToAccept.trimEnd().endsWith('.');

    if (textToAccept && !textToAccept.endsWith(' ') && !endsWithPeriod) {
      textToAccept += ' ';
    }

    // Remove prediction first
    this.removeInlinePrediction();

    // Append accepted prediction to editor
    this.editor.textContent += textToAccept;

    if (endsWithPeriod) {
      this.editor.textContent += '\n';
    }

    this.moveCursorToEnd();

    if (activeOffset > 0 && activeOffset < this.currentPrediction.length) {
      const remainingPrediction = this.currentPrediction.slice(activeOffset);
      this.currentPrediction = remainingPrediction;
      this.navigationOffset = 0;
      this.hoverOffset = 0;
      this.insertInlinePrediction();
      this.updatePredictionDisplay();
    } else {
      this.currentPrediction = '';
      this.onInput();
    }
  }

  moveCursorToEnd() {
    const range = document.createRange();
    const selection = window.getSelection();

    // Find the last text node before prediction (or end of editor)
    let targetNode = this.editor;
    let targetOffset = this.editor.childNodes.length;

    if (this.inlinePredictionEl && this.editor.contains(this.inlinePredictionEl)) {
      const index = Array.from(this.editor.childNodes).indexOf(this.inlinePredictionEl);
      if (index > 0) {
        const prevNode = this.editor.childNodes[index - 1];
        if (prevNode.nodeType === Node.TEXT_NODE) {
          targetNode = prevNode;
          targetOffset = prevNode.textContent.length;
        }
      }
    } else {
      // No prediction, go to end
      const lastChild = this.editor.lastChild;
      if (lastChild && lastChild.nodeType === Node.TEXT_NODE) {
        targetNode = lastChild;
        targetOffset = lastChild.textContent.length;
      }
    }

    try {
      range.setStart(targetNode, targetOffset);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
    } catch (e) {
      // Fallback
      range.selectNodeContents(this.editor);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
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

    let textToAccept = this.currentPrediction.slice(startOffset, endOffset);

    const endsWithPeriod = textToAccept.trimEnd().endsWith('.');

    if (textToAccept && !textToAccept.endsWith(' ') && !endsWithPeriod) {
      textToAccept += ' ';
    }

    // Remove prediction first
    this.removeInlinePrediction();

    this.editor.textContent += textToAccept;

    if (endsWithPeriod) {
      this.editor.textContent += '\n';
    }

    this.moveCursorToEnd();

    if (endOffset < this.currentPrediction.length) {
      this.currentPrediction = this.currentPrediction.slice(endOffset);
      this.navigationOffset = 0;
      this.hoverOffset = 0;
      this.insertInlinePrediction();
      this.updatePredictionDisplay();
    } else {
      this.currentPrediction = '';
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
