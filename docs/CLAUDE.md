# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mindcomplete is an AI-powered writing assistant with text prediction and image generation. Users type in an editor and receive inline text completions that appear word-by-word with fade animations. Features subscription tiers (Free/Pro) with LemonSqueezy integration.

## Tech Stack

- **Frontend**: Vanilla JS, CSS (no frameworks)
- **Backend**: Node.js/Express (local dev), Vercel serverless (production)
- **Database**: Supabase (contexts, valleys, image_generations, user_subscriptions, user_credits, credit_purchases)
- **AI**: OpenRouter API (xiaomi/mimo-v2-flash for text, prunaai/z-image-turbo for images)
- **Payments**: LemonSqueezy (subscriptions + one-time credit purchases)

## Commands

```bash
npm run dev       # Start local server on port 4567
npm start         # Start production server
```

**Important:** Local server only serves static files. API endpoints work only in production (Vercel) or require additional setup.

## Architecture

### API Endpoints (Vercel Serverless)

**Core Features:**
- `api/predict.js` - Text prediction with SSE streaming. Accepts rules, writingStyle, and sessionId for context injection. No auth required.
- `api/generate-image.js` - Image generation with style presets (anime/realistic/handdrawing/custom1/custom2). Requires auth. Tier-based limits (Free: 0, Pro: 30/month + credits).
- `api/context.js` - File upload (multipart/form-data) for reference material. Stores in Supabase with 30min TTL. Only .txt/.md supported in production (no PDF in serverless).
- `api/valleys.js` - CRUD for saved writing sessions. Stores text, rules, writingStyle, and file context. Tier-based limits (Free: 0, Pro: 20 max).

**Payments:**
- `api/checkout.js` - Creates LemonSqueezy checkout sessions for Pro subscriptions ($5.99/mo) or credit packs ($2.99 for 50 credits).
- `api/webhooks/lemon.js` - Handles LemonSqueezy webhooks for subscription/credit events. Validates signature with LEMON_WEBHOOK_SECRET.

**Auth:**
- `api/auth/delete-account.js` - Deletes user account and all associated data (valleys, subscriptions).

### Shared Services (`api/lib/`)

- `tierService.js` - Manages user tiers (free/pro), credits, and usage limits. Core functions: getUserTier, getUserCredits, deductCredit, getMonthlyImageCount.
- `contextService.js` - Retrieves context from Supabase by sessionId with TTL expiration check.
- `supabaseClient.js` - Supabase client singleton using service role key.
- `constants.js` - Shared config (CONTEXT_TTL_MS, MAX_CONTEXT_CHARS, ADMIN_EMAILS).

### Frontend (`public/`)

**Pages:**
- `landing.html` → `/` - Marketing page with hero, features, pricing
- `login.html` → `/login` - Dedicated login page
- `editor.html` → `/app` - Main writing interface with editor, sidebar, modals

**Core JavaScript (app.js ~3200 lines):**
- `PredictionManager` - Handles text prediction streaming, debouncing (300ms), inline prediction UI
- `ContextManager` - Manages file uploads, rules, writing style context
- `ValleysManager` - Handles CRUD for saved valleys, auto-save, temp valley creation
- `AuthManager` - Supabase auth (email/password, Google OAuth), subscription info loading
- Image generation flow - Modal-based with guidance/style selection, limit enforcement

**Other Frontend:**
- `supabaseClient.js` - Browser Supabase client (anon key) for auth
- `styles.css` - Design tokens, dark mode support, responsive grid
- `sw.js` - Service worker for offline caching

### Routing

- Vercel: `vercel.json` rewrites `/` → `landing.html`, `/app` → `editor.html`
- Local: Express routes in `server/index.js`

## Subscription System

Mindcomplete uses a hybrid subscription + credits model via LemonSqueezy:

**Tiers:**
- **Free**: Unlimited text predictions, 0 images/month, 0 saved valleys
- **Pro ($5.99/mo)**: Unlimited text predictions, 30 images/month, 20 saved valleys max
- **Credits ($2.99)**: One-time purchase of 50 image generation credits

**Flow:**
1. User clicks "Upgrade to Pro" or "Buy Credits" → calls `/api/checkout`
2. Redirects to LemonSqueezy checkout
3. On purchase → LemonSqueezy sends webhook to `/api/webhooks/lemon`
4. Webhook updates `user_subscriptions` or `user_credits` table in Supabase
5. Next API call checks tier via `tierService.getUserTier(userId)`

**Limit Enforcement:**
- Image generation checks monthly count vs tier limit, falls back to credits if Pro limit reached
- Valley saves check count vs max_valleys (20 for Pro)
- Free tier shows upgrade prompts with confirm dialogs linking to account settings

## Environment Variables

**Required:**
- `OPENROUTER_API_KEY` - Required for all AI features
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_KEY` - Supabase service role key (server-side)

**LemonSqueezy (for payments):**
- `LEMON_API_KEY` - LemonSqueezy API key for creating checkouts
- `LEMON_WEBHOOK_SECRET` - Webhook signature validation secret
- `LEMON_STORE_ID` - LemonSqueezy store ID
- `LEMON_PRO_VARIANT_ID` - Variant ID for Pro subscription product
- `LEMON_CREDITS_VARIANT_ID` - Variant ID for credits product

**Optional:**
- `IMAGE_PROVIDER` - "openrouter" (default) or "replicate"
- `REPLICATE_API_KEY` - Required if IMAGE_PROVIDER=replicate

## Development Precautions

- **Dual Routing**: When adding new pages or routes, updates MUST be mirrored in both `server/index.js` (Express) and `vercel.json` (Rewrites).
- **Server Restarts**: Always remind the user to restart the dev server (`npm run dev`) after modifying `server/index.js`, `vercel.json`, or `.env`.
- **Cache Persistence**: The project uses a Service Worker (`sw.js`). If UI changes don't appear, instruct the user to "Empty Cache and Hard Reload" or unregister the Service Worker in DevTools.
- **API Testing**: API endpoints only work in production (Vercel). For local testing, you must mock responses or deploy to Vercel preview.
- **Database Changes**: When adding new tables or columns, update RLS policies in Supabase and document in CLAUDE.md.

## Design Tokens

CSS variables defined in `public/styles.css`:

- Colors: `--background`, `--accent`, `--text`, `--input-background`, `--modal-surface`, etc.
- System supports light/dark mode via `prefers-color-scheme`
- Typography: `--font-body-size` (16px), `--font-body-weight` (300 - light)
- Spacing: `--space-sm` (8px), `--space-md` (12px), `--space-lg` (16px), `--space-xl` (24px)
- Border radius: 32px for modals, 16px for buttons/inputs

When adding new tokens, follow primitive → semantic pattern per global CLAUDE.md.

## Key Implementation Patterns

### Authentication Flow
- Frontend uses Supabase client with anon key for auth operations
- Backend validates JWT tokens via `supabase.auth.getUser(token)`
- Access tokens passed in `Authorization: Bearer {token}` header
- Auth state managed by `AuthManager` class, persisted via Supabase session

### Text Prediction Flow
1. User types → debounce 300ms → `PredictionManager.requestPrediction()`
2. Frontend calls `/api/predict` with SSE → streams response word-by-word
3. Prediction rendered as inline `.inline-prediction` element
4. User accepts via TAB (full) or click (partial) → inserted into contenteditable editor

### Image Generation Flow
1. User clicks "Create Image" → modal opens with guidance/style inputs
2. Calls `/api/generate-image` with text, guidance, style
3. Backend: checks tier → generates prompt via xiaomi/mimo → generates image via prunaai/z-image-turbo
4. Returns base64 image → inserted as `.editor-image-container` with remove button
5. Deducts credit if Pro user exceeded monthly limit

### Valley Save Flow
1. User types → auto-save debounce 2s → `ValleysManager.handleAutoSave()`
2. Creates temp valley on first save (optimistic UI)
3. POST `/api/valleys` → returns real valley ID
4. Updates local state, promotes temp → real valley
5. Renders in sidebar with title (auto-generated from first 50 chars)

### Context Injection
1. User uploads file via "Files" modal → multipart/form-data to `/api/context`
2. Stored in `contexts` table with 30min TTL and sessionId
3. On prediction request, sessionId passed → `contextService.getContext()` retrieves
4. Injected into system prompt before text prediction

## Figma Integration

When using Figma MCP, use **Figma Desktop** tools (e.g., `figma-desktop__get_design_context`).
