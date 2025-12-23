class PredictionManager {
  constructor(options = {}) {
    this.debounceMs = options.debounceMs || 300;
    this.minTextLength = options.minTextLength || 10;
    this.debounceTimer = null;
    this.abortController = null;
    this.thinkingTimer = null;
    this.currentPrediction = '';
    this.navigationOffset = 0; // How many chars into prediction we've navigated (clicked)
    this.hoverOffset = 0; // Hover position (temporary)

    this.editor = document.querySelector('.editor');
    this.ghostLayer = document.querySelector('.ghost-layer');
    this.userTextMirror = document.querySelector('.user-text-mirror');
    this.thinkingIndicator = document.querySelector('.thinking-indicator');
    this.predictionEl = document.querySelector('.prediction');
    this.predictionAcceptEl = document.querySelector('.prediction-accept');
    this.predictionRemainEl = document.querySelector('.prediction-remain');
    this.hint = document.querySelector('.hint');

    this.init();
  }

  init() {
    // Handle input events
    this.editor.addEventListener('input', () => this.onInput());

    // Handle keydown for TAB acceptance
    this.editor.addEventListener('keydown', (e) => this.onKeyDown(e));

    // Handle clicks on prediction
    this.predictionEl.addEventListener('click', (e) => this.onPredictionClick(e));

    // Handle hover on prediction
    this.predictionEl.addEventListener('mousemove', (e) => this.onPredictionHover(e));
    this.predictionEl.addEventListener('mouseleave', () => this.onPredictionLeave());

    // Focus editor on page load
    this.editor.focus();
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
    const offset = this.getOffsetFromMouseEvent(e);
    if (offset !== null) {
      this.hoverOffset = offset;
      this.updatePredictionDisplay();
    }
  }

  onPredictionLeave() {
    this.hoverOffset = 0;
    this.updatePredictionDisplay();
  }

  onPredictionClick(e) {
    e.preventDefault();
    e.stopPropagation();

    const offset = this.getOffsetFromMouseEvent(e);
    if (offset !== null) {
      // Set the offset and accept immediately
      this.hoverOffset = offset;
      this.navigationOffset = 0;
      this.acceptPrediction();
    }
  }

  getOffsetFromMouseEvent(e) {
    // Get the click/hover position
    const range = document.caretRangeFromPoint(e.clientX, e.clientY);
    if (!range) return null;

    let offset = 0;

    // Check if in accept part
    if (range.startContainer === this.predictionAcceptEl.firstChild ||
        range.startContainer === this.predictionAcceptEl) {
      offset = range.startOffset;
    }
    // Check if in remain part
    else if (range.startContainer === this.predictionRemainEl.firstChild ||
             range.startContainer === this.predictionRemainEl) {
      const acceptLength = this.predictionAcceptEl.textContent.length;
      offset = acceptLength + range.startOffset;
    }
    // Somewhere else in prediction container
    else if (range.startContainer === this.predictionEl) {
      offset = range.startOffset === 0 ? 0 : this.currentPrediction.length;
    }

    if (offset >= 0 && offset <= this.currentPrediction.length) {
      return offset;
    }
    return null;
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
    this.predictionAcceptEl.textContent = '';
    this.predictionRemainEl.textContent = '';
    this.hint.classList.remove('visible');
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
    this.updatePredictionDisplay();
    this.hint.classList.add('visible');
  }

  updatePredictionDisplay() {
    const userText = this.editor.textContent;
    this.userTextMirror.textContent = userText;

    // Use hoverOffset if hovering, otherwise use navigationOffset (clicked position)
    const activeOffset = this.hoverOffset || this.navigationOffset;

    if (activeOffset === 0) {
      // No navigation/hover - show all in remain color
      this.predictionAcceptEl.textContent = '';
      this.predictionRemainEl.textContent = this.currentPrediction;
    } else {
      // Split into accept (white) and remain (dimmer)
      const acceptPart = this.currentPrediction.slice(0, activeOffset);
      const remainPart = this.currentPrediction.slice(activeOffset);

      this.predictionAcceptEl.textContent = acceptPart;
      this.predictionRemainEl.textContent = remainPart;
    }
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
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new PredictionManager();

  // Modal handling
  const modal = document.getElementById('about-modal');
  const aboutBtn = document.querySelector('.about-btn');
  const modalClose = document.querySelector('.modal-close');

  aboutBtn.addEventListener('click', () => {
    modal.classList.add('visible');
  });

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
});
