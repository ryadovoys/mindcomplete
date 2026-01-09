# Purple Valley

**AI-powered writing assistant that completes your thoughts in real-time.**

Purple Valley helps you write faster and more fluidly by predicting and suggesting how to continue your paragraphs. Simply pause while typing, and AI will suggest a natural continuation matching your tone and style.

![Purple Valley Demo](https://via.placeholder.com/800x400?text=Purple Valley+Demo)

## Features

- **Real-time thought completion** - AI suggests paragraph continuations as you write
- **Interactive predictions** - Hover or click to see what will be accepted
- **Flexible acceptance** - Press TAB to accept the full suggestion, or click anywhere to accept up to that point
- **Smart debouncing** - Waits for you to pause before suggesting
- **Streaming responses** - See predictions appear character by character
- **Minimal, distraction-free UI** - Black background with centered text
- **Responsive design** - Works on desktop, tablet, and mobile

## How It Works

1. Start typing your thoughts
2. Pause for 300ms - the AI starts thinking
3. A "Continuing..." indicator appears while waiting
4. AI suggestion appears in dimmed text
5. Hover over the suggestion to see what will be accepted (turns white)
6. Click or press TAB to accept
7. Keep writing!

## Tech Stack

- **Frontend**: Vanilla JavaScript, HTML, CSS
- **Backend**: Node.js + Express
- **AI**: OpenRouter API (supports multiple models)
- **Streaming**: Server-Sent Events (SSE)

## Installation

### Prerequisites

- Node.js (v18 or higher)
- OpenRouter API key ([Get one here](https://openrouter.ai/keys))

### Setup

1. Clone the repository:
```bash
git clone https://github.com/yourusername/purple-valley.git
cd purple-valley
```

2. Install dependencies:
```bash
npm install
```

3. Create a `.env` file:
```bash
cp .env.example .env
```

4. Add your OpenRouter API key to `.env`:
```
OPENROUTER_API_KEY=your_api_key_here
PORT=3000
```

5. Start the server:
```bash
npm start
```

6. Open http://localhost:3000 in your browser

## Configuration

### Changing the AI Model

Edit `server/index.js` and change the `model` parameter:

```javascript
model: 'anthropic/claude-haiku-4.5',  // Fast and high quality
// or
model: 'google/gemini-2.0-flash-exp:free',  // Free and fast
```

See [OpenRouter models](https://openrouter.ai/models) for all available options.

### Adjusting Timing

In `public/app.js`, you can adjust:

- **Debounce delay** (default 300ms): How long to wait after you stop typing
- **Thinking indicator delay** (default 200ms): When to show "Continuing..."

```javascript
this.debounceMs = options.debounceMs || 300;
```

## Project Structure

```
purple-valley/
├── server/
│   ├── index.js              # Express server + OpenRouter proxy
│   └── prompts-archive.js    # System prompt history
├── public/
│   ├── index.html            # Main HTML
│   ├── styles.css            # Styling
│   └── app.js                # Frontend logic
├── package.json
├── .env.example
├── .gitignore
└── README.md
```

## Development

Run with auto-reload:
```bash
npm run dev
```

## Deployment

### Option 1: Vercel (Recommended for quick deployment)

1. Install Vercel CLI: `npm i -g vercel`
2. Run: `vercel`
3. Add `OPENROUTER_API_KEY` in Vercel dashboard

### Option 2: Railway

1. Connect your GitHub repo to Railway
2. Add `OPENROUTER_API_KEY` environment variable
3. Deploy!

### Option 3: Any Node.js hosting

Works on Render, Fly.io, DigitalOcean, etc. Just:
1. Set `OPENROUTER_API_KEY` environment variable
2. Run `npm install && npm start`

## Contributing

Contributions are welcome! Feel free to:
- Report bugs
- Suggest features
- Submit pull requests

## License

MIT License - feel free to use this project however you'd like!

## Credits

Built by [Your Name]

Powered by [OpenRouter](https://openrouter.ai)

## Support

If you find this useful, consider:
- Starring the repo ⭐
- Sharing with others
- Contributing improvements
