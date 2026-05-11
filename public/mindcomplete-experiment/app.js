const DEBOUNCE_MS = 400;
const MIN_CHARS = 6;
const API = '/mindcomplete-experiment/api/predict';

const editor = document.getElementById('editor');
const contextToggle = document.getElementById('context-toggle');
const contextPanel = document.getElementById('context-panel');
const contextClose = document.getElementById('context-close');
const contextCount = document.getElementById('context-count');
const contextText = document.getElementById('context-text');
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const filesList = document.getElementById('context-files');
const lengthSlider = document.getElementById('length-slider');
const autocompleteToggleBtn = document.getElementById('autocomplete-toggle');
const autocompleteStateEl = document.getElementById('autocomplete-state');

const state = {
  files: [],
  debounceTimer: null,
  abortCtrl: null,
  suggestionEl: null,
  suggestionText: '',
  isStreaming: false,
  length: 0,
  autocompleteOn: true,
};

function debounce(fn, ms) {
  return (...args) => {
    if (state.debounceTimer) clearTimeout(state.debounceTimer);
    state.debounceTimer = setTimeout(() => fn(...args), ms);
  };
}

function getEditorText() {
  const clone = editor.cloneNode(true);
  // Strip suggestion span if present
  clone.querySelectorAll('.suggestion').forEach((n) => n.remove());
  return clone.innerText.replace(/​/g, '').replace(/\n+$/, '');
}

function clearSuggestion() {
  if (state.suggestionEl && state.suggestionEl.parentNode) {
    state.suggestionEl.parentNode.removeChild(state.suggestionEl);
  }
  state.suggestionEl = null;
  state.suggestionText = '';
}

function abortInflight() {
  if (state.abortCtrl) {
    state.abortCtrl.abort();
    state.abortCtrl = null;
  }
  state.isStreaming = false;
}

function placeCaretAtEnd(node) {
  const range = document.createRange();
  range.selectNodeContents(node);
  range.collapse(false);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function appendSuggestionToEditor(text) {
  if (!state.suggestionEl) {
    state.suggestionEl = document.createElement('span');
    state.suggestionEl.className = 'suggestion';
    state.suggestionEl.contentEditable = 'false';
    state.suggestionEl.addEventListener('mousedown', onSuggestionMouseDown);
    editor.appendChild(state.suggestionEl);
  }
  state.suggestionEl.textContent = text;
  scrollToBottomIfNeeded();
}

function getCaretRect() {
  const sel = window.getSelection();
  if (sel.rangeCount) {
    const range = sel.getRangeAt(0).cloneRange();
    const rect = range.getBoundingClientRect();
    if (rect.top || rect.bottom) return rect;
  }
  const range = document.createRange();
  let target = editor;
  if (state.suggestionEl) {
    target = state.suggestionEl;
  } else if (editor.lastChild) {
    target = editor.lastChild;
  }
  try {
    range.selectNodeContents(target);
    range.collapse(false);
    return range.getBoundingClientRect();
  } catch {
    return editor.getBoundingClientRect();
  }
}

function getSuggestionBottom() {
  if (!state.suggestionEl) return null;
  return state.suggestionEl.getBoundingClientRect().bottom;
}

function scrollToBottomIfNeeded() {
  const stage = document.querySelector('.stage');
  if (!stage) return;

  const caret = getCaretRect();
  const stageRect = stage.getBoundingClientRect();
  const reservedBottom = window.innerHeight * 0.4;
  const visibleTop = stageRect.top;
  const visibleBottom = window.innerHeight - reservedBottom;

  const targetCaretY = visibleTop + (visibleBottom - visibleTop) * 0.5;
  let delta = Math.max(0, caret.top - targetCaretY);

  const suggestionBottom = getSuggestionBottom();
  if (suggestionBottom !== null) {
    const overflow = suggestionBottom - visibleBottom + 32;
    if (overflow > delta) delta = overflow;
  } else {
    const caretOverflow = caret.bottom - visibleBottom + 32;
    if (caretOverflow > delta) delta = caretOverflow;
  }

  if (delta > 4) {
    stage.scrollTop += delta;
  }
}

function caretOffsetFromPoint(x, y) {
  if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(x, y);
    if (pos && state.suggestionEl && state.suggestionEl.contains(pos.offsetNode)) {
      return pos.offset;
    }
  } else if (document.caretRangeFromPoint) {
    const range = document.caretRangeFromPoint(x, y);
    if (range && state.suggestionEl && state.suggestionEl.contains(range.startContainer)) {
      return range.startOffset;
    }
  }
  return null;
}

function onSuggestionMouseDown(e) {
  if (!state.suggestionText) return;
  e.preventDefault();
  const rawOffset = caretOffsetFromPoint(e.clientX, e.clientY);
  if (rawOffset === null) return;
  const offset = extendOffsetToFollowingSpace(state.suggestionText, rawOffset);
  const accepted = ensureTrailingSpace(state.suggestionText.slice(0, offset));
  if (!accepted.trim()) {
    clearSuggestion();
    abortInflight();
    return;
  }
  clearSuggestion();
  abortInflight();
  const textNode = document.createTextNode(accepted);
  editor.appendChild(textNode);
  placeCaretAtEnd(editor);
  editor.focus();
  scrollToBottomIfNeeded();
  debouncedPredict();
}

function getContextString() {
  const parts = [];
  if (contextText.value.trim()) parts.push(contextText.value.trim());
  for (const f of state.files) {
    parts.push(`# ${f.name}\n${f.content}`);
  }
  return parts.join('\n\n');
}

function updateContextCount() {
  const count = state.files.length + (contextText.value.trim() ? 1 : 0);
  if (count > 0) {
    contextCount.hidden = false;
    contextCount.textContent = String(count);
  } else {
    contextCount.hidden = true;
  }
}

async function requestPrediction() {
  if (!state.autocompleteOn) return;
  const text = getEditorText();
  if (text.length < MIN_CHARS) return;

  abortInflight();
  state.abortCtrl = new AbortController();
  state.isStreaming = true;

  try {
    const res = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, context: getContextString(), length: state.length }),
      signal: state.abortCtrl.signal,
    });

    if (!res.ok) {
      state.isStreaming = false;
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulated = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6);
        if (data === '[DONE]') continue;
        try {
          const parsed = JSON.parse(data);
          if (parsed.content) {
            accumulated += parsed.content;
            state.suggestionText = accumulated;
            appendSuggestionToEditor(accumulated);
          }
        } catch {
          // skip
        }
      }
    }
  } catch (e) {
    if (e.name !== 'AbortError') console.error('predict error', e);
  } finally {
    state.isStreaming = false;
  }
}

const debouncedPredict = debounce(requestPrediction, DEBOUNCE_MS);

function ensureTrailingSpace(text) {
  if (!text) return text;
  if (/\s$/.test(text)) return text;
  return text + ' ';
}

function extendOffsetToFollowingSpace(text, offset) {
  let end = offset;
  while (end < text.length && /\s/.test(text[end])) {
    end++;
  }
  return end;
}

function acceptSuggestion() {
  if (!state.suggestionText) return false;
  const text = ensureTrailingSpace(state.suggestionText);
  clearSuggestion();
  const textNode = document.createTextNode(text);
  editor.appendChild(textNode);
  placeCaretAtEnd(editor);
  scrollToBottomIfNeeded();
  debouncedPredict();
  return true;
}

editor.addEventListener('input', () => {
  clearSuggestion();
  abortInflight();
  scrollToBottomIfNeeded();
  debouncedPredict();
});

editor.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    if (state.suggestionText) {
      e.preventDefault();
      acceptSuggestion();
      return;
    }
  }
  if (e.key === 'Escape') {
    clearSuggestion();
    abortInflight();
  }
});

contextToggle.addEventListener('click', () => {
  contextPanel.hidden = !contextPanel.hidden;
});
contextClose.addEventListener('click', () => {
  contextPanel.hidden = true;
});

contextText.addEventListener('input', () => {
  updateContextCount();
});

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

async function handleFiles(fileList) {
  for (const file of fileList) {
    if (file.size > 1_000_000) {
      alert(`${file.name} is over 1MB. Skipped.`);
      continue;
    }
    try {
      const content = await readFileAsText(file);
      state.files.push({ name: file.name, size: file.size, content });
    } catch (e) {
      console.error('Failed to read file', file.name, e);
    }
  }
  renderFiles();
  updateContextCount();
}

function renderFiles() {
  while (filesList.firstChild) filesList.removeChild(filesList.firstChild);
  state.files.forEach((f, i) => {
    const row = document.createElement('div');
    row.className = 'context-file';

    const name = document.createElement('span');
    name.className = 'context-file-name';
    name.textContent = f.name;

    const size = document.createElement('span');
    size.className = 'context-file-size';
    size.textContent = formatSize(f.size);

    const remove = document.createElement('button');
    remove.className = 'context-file-remove';
    remove.setAttribute('aria-label', 'Remove');
    remove.textContent = '×';
    remove.addEventListener('click', () => {
      state.files.splice(i, 1);
      renderFiles();
      updateContextCount();
    });

    row.appendChild(name);
    row.appendChild(size);
    row.appendChild(remove);
    filesList.appendChild(row);
  });
}

function formatSize(b) {
  if (b < 1024) return `${b}B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)}KB`;
  return `${(b / 1024 / 1024).toFixed(1)}MB`;
}

dropZone.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', (e) => {
  handleFiles(e.target.files);
  fileInput.value = '';
});

dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('drag-over');
});
dropZone.addEventListener('dragleave', () => {
  dropZone.classList.remove('drag-over');
});
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  if (e.dataTransfer?.files?.length) handleFiles(e.dataTransfer.files);
});

window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  if (e.target.closest('.drop-zone')) return;
  e.preventDefault();
  if (e.dataTransfer?.files?.length) {
    contextPanel.hidden = false;
    handleFiles(e.dataTransfer.files);
  }
});

lengthSlider.addEventListener('input', (e) => {
  state.length = Number(e.target.value);
});

autocompleteToggleBtn.addEventListener('click', () => {
  state.autocompleteOn = !state.autocompleteOn;
  autocompleteToggleBtn.setAttribute('aria-pressed', String(state.autocompleteOn));
  autocompleteStateEl.textContent = state.autocompleteOn ? 'On' : 'Off';
  if (!state.autocompleteOn) {
    clearSuggestion();
    abortInflight();
  }
});

editor.focus();
