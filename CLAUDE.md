# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Purple Valley is an AI-powered writing assistant with text prediction and image generation. Users type in an editor and receive inline text completions that appear word-by-word with fade animations.

## Tech Stack

- **Frontend**: Vanilla JS, CSS (no frameworks)
- **Backend**: Node.js/Express (local dev), Vercel serverless (production)
- **Database**: Supabase (contexts, valleys, image_generations tables)
- **AI**: OpenRouter API (xiaomi/mimo-v2-flash for text, prunaai/z-image-turbo for images)

## Commands

```bash
npm run dev       # Start local server on port 4567
```

Note: Local server only serves static files. API endpoints work only in production (Vercel) or require additional setup.

## Architecture

### API Endpoints (Vercel Serverless)

- `api/predict.js` - Text prediction with SSE streaming. Accepts rules, writingStyle, and sessionId for context injection.
- `api/generate-image.js` - Image generation with style presets (anime/realistic/handdrawing). Requires auth, has daily limits (5/day, unlimited for admins).
- `api/context.js` - File upload (multipart/form-data) for reference material. Stores in Supabase with 30min TTL. Only .txt/.md supported in production (no PDF in serverless).
- `api/valleys.js` - CRUD for saved writing sessions. Stores text, rules, writingStyle, and file context.

### Shared Services (`api/lib/`)

- `contextService.js` - Retrieves context from Supabase by sessionId
- `supabaseClient.js` - Supabase client singleton
- `constants.js` - Shared config (CONTEXT_TTL_MS, MAX_CONTEXT_CHARS, DAILY_IMAGE_LIMIT, ADMIN_EMAILS)

### Frontend (`public/`)

- `landing.html` → `/` - Marketing page
- `editor.html` → `/app` - Main writing interface
- `app.js` - Core application logic (~1400 lines): editor state, prediction handling, modal management, auth flow
- `supabaseClient.js` - Browser Supabase client for auth

### Routing

- Vercel: `vercel.json` rewrites `/` → `landing.html`, `/app` → `editor.html`
- Local: Express routes in `server/index.js`

## Environment Variables

- `OPENROUTER_API_KEY` - Required for all AI features
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_KEY` - Supabase service role key (server-side)
- `IMAGE_PROVIDER` - Optional: "openrouter" (default) or "replicate"
- `REPLICATE_API_KEY` - Required if IMAGE_PROVIDER=replicate

### Routing & Development Precautions

- **Dual Routing**: When adding new pages or routes, updates MUST be mirrored in both `server/index.js` (Express) and `vercel.json` (Rewrites).
- **Server Restarts**: Always remind the user to restart the dev server (`npm run dev`) after modifying `server/index.js`, `vercel.json`, or `.env`.
- **Cache Persistence**: The project uses a Service Worker (`sw.js`). If UI changes don't appear, instruct the user to "Empty Cache and Hard Reload" or unregister the Service Worker in DevTools.

## Design Tokens

CSS variables defined in `public/styles.css`:

- Colors: `--background`, `--accent`, `--text`, `--input-background`, `--modal-surface`, etc.
- System supports light/dark mode via `prefers-color-scheme`
- Typography: `--font-body-size` (16px), `--font-body-weight` (300 - light)
- Spacing: `--space-sm` (8px), `--space-md` (12px), `--space-lg` (16px), `--space-xl` (24px)
- Border radius: 32px for modals, 16px for buttons/inputs

When adding new tokens, follow primitive → semantic pattern per global CLAUDE.md.

## Figma Integration

When using Figma MCP, use **Figma Desktop** tools (e.g., `figma-desktop__get_design_context`).
