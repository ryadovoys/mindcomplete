/**
 * Mindcomplete Word Animation
 * A looping word-by-word fade-in + slide animation
 */

class WordAnimation {
    constructor() {
        this.textLime = document.getElementById('text-lime');

        // Text to animate (the lime/accent part)
        this.phrase = 'write with you, not for you';
        this.words = this.phrase.split(' ');

        this.currentWordIndex = 0;
        this.isReversing = false;

        // Timing configuration (in ms)
        this.wordDelay = 300;        // Delay between each word appearing
        this.pauseAfterComplete = 2500; // Pause after all words shown
        this.pauseAfterClear = 800;     // Pause after clearing before restart

        this.init();
    }

    init() {
        this.buildWords();
        this.animateIn();
    }

    buildWords() {
        // Clear container
        this.textLime.innerHTML = '';

        // Create span for each word
        this.words.forEach((word, index) => {
            const span = document.createElement('span');
            span.className = 'word';
            span.textContent = word;
            span.style.transitionDelay = `${index * this.wordDelay}ms`;
            this.textLime.appendChild(span);

            // Add line break after "you,"
            if (word === 'you,') {
                const br = document.createElement('br');
                this.textLime.appendChild(br);
            } else if (index < this.words.length - 1) {
                // Add space after word (except last and after "you,")
                const space = document.createTextNode(' ');
                this.textLime.appendChild(space);
            }
        });
    }

    animateIn() {
        // 1 second delay before animation starts
        setTimeout(() => {
            requestAnimationFrame(() => {
                const wordSpans = this.textLime.querySelectorAll('.word');
                wordSpans.forEach(span => {
                    span.classList.add('visible');
                });

                // Calculate total animation time
                const totalAnimTime = this.words.length * this.wordDelay + 400; // +400 for transition duration

                // After all words visible, wait then reset
                setTimeout(() => {
                    this.animateOut();
                }, totalAnimTime + this.pauseAfterComplete);
            });
        }, 1000);
    }

    animateOut() {
        // Instant reset - no fade out animation
        this.textLime.innerHTML = '';

        // Restart immediately
        this.restart();
    }

    restart() {
        this.buildWords();
        this.animateIn();
    }
}

// Initialize animation when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    new WordAnimation();
});
