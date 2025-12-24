const sampleText = `Imagine your thoughts landing on the page with a little personality. Some words float, others drop in like stage lights, and whole lines can fade forward like waves rolling onto the shore. This lab keeps the stream live so you can sense the rhythm before choosing a motion language for Mindcomplete.`;

const words = sampleText.split(/\s+/);
const STREAM_DELAY = 420;

const demoRegistry = [
  createTypewriterDemo('demo-typewriter'),
  createWordDemo('demo-fade-words', 'word-fade'),
  createLineDemo('demo-line-fade'),
  createWordDemo('demo-slide-up', 'word-slide'),
  createWordDemo('demo-pop', 'word-pop'),
  createWordDemo('demo-flip', 'word-flip'),
  createWordDemo('demo-highlight', 'word-highlight'),
  createWordDemo('demo-drop', 'word-drop'),
  createWordDemo('demo-wave', 'word-wave'),
  createWordDemo('demo-glide', 'word-glide'),
];

let streamTimeout = null;

function createTypewriterDemo(id) {
  const el = document.getElementById(id);
  let buffer = [];
  return {
    reset() {
      buffer = [];
      el.textContent = '';
    },
    push(word) {
      buffer.push(word);
      el.textContent = buffer.join(' ') + ' ';
    },
  };
}

function createWordDemo(id, className) {
  const el = document.getElementById(id);
  return {
    reset() {
      el.replaceChildren();
    },
    push(word) {
      const span = document.createElement('span');
      span.textContent = word;
      span.className = `word ${className}`;
      el.appendChild(span);
    }
  };
}

function createLineDemo(id) {
  const el = document.getElementById(id);
  let buffer = [];
  return {
    reset() {
      buffer = [];
      el.replaceChildren();
    },
    push(word) {
      buffer.push(word);
      const shouldFlush = buffer.length >= 6 || /[.!?]$/.test(word);
      if (!shouldFlush) return;
      flushLine();
    },
    finalize() {
      if (buffer.length) {
        flushLine();
      }
    }
  };

  function flushLine() {
    const line = document.createElement('div');
    line.className = 'line line-fade';
    line.textContent = buffer.join(' ');
    el.appendChild(line);
    buffer = [];
  }
}

function resetDemos() {
  demoRegistry.forEach((demo) => demo.reset());
}

function finalizeDemos() {
  demoRegistry.forEach((demo) => {
    if (typeof demo.finalize === 'function') {
      demo.finalize();
    }
  });
}

function startStream() {
  clearTimeout(streamTimeout);
  resetDemos();
  let index = 0;

  function pushNext() {
    if (index >= words.length) {
      finalizeDemos();
      streamTimeout = setTimeout(startStream, 4000);
      return;
    }

    const word = words[index++];
    demoRegistry.forEach((demo) => demo.push(word));
    streamTimeout = setTimeout(pushNext, STREAM_DELAY);
  }

  pushNext();
}

window.addEventListener('DOMContentLoaded', () => {
  const restartButton = document.getElementById('restart-demo');
  restartButton.addEventListener('click', () => {
    startStream();
  });

  startStream();
});
