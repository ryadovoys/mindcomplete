# Repository Guidelines

## Project Structure

```
mindcomplete/
├── api/                    # Vercel serverless functions
│   ├── _lib/               # Shared utilities (stores, Supabase client)
│   ├── auth/               # Authentication endpoints
│   ├── webhooks/           # Stripe webhooks
│   ├── predict.js          # AI prediction endpoint
│   ├── context.js          # Context management
│   ├── context-anchor.js   # Persistent context anchors
│   ├── valleys.js          # Document storage (Valleys)
│   ├── generate-image.js   # AI image generation
│   ├── checkout.js         # Stripe checkout
│   └── process-input.js    # Input processing
├── public/                 # Frontend application
│   ├── app.js              # Main application logic
│   ├── editor.html         # Editor page
│   ├── landing.html        # Landing page
│   ├── login.html          # Auth page
│   └── styles.css          # Global styles
├── docs/                   # Documentation & references
│   ├── screenshots/        # Debug/test screenshots
│   ├── CLAUDE.md           # Claude AI instructions
│   ├── SUPABASE_SETUP.md   # Database setup guide
│   └── VALLEYS_STATUS.md   # Feature status tracking
├── figma-plugin/           # Mindcomplete Figma plugin
├── plans/                  # Implementation plans (archived)
├── sandbox/                # One-off projects (animations, demos, experiments)
├── supabase/               # Database migrations
├── archive/                # Old code backups
├── AGENTS.md               # This file
├── README.md               # Project overview
└── vercel.json             # Vercel deployment config
```

## Development Commands

| Command | Purpose |
|---------|---------|
| `npm install` | Install dependencies |
| `vercel dev` | Run local dev server with Vercel functions |
| `curl http://localhost:3000/api/health` | API health check |

## Coding Style

- ES modules, 2-space indent, single quotes, trailing semicolons
- Descriptive filenames (`*-store.js`, `*-manager.js`)
- Keep CSS selectors in sync with JS
- Favor `const`, use `CONFIG` objects for tunable values
- Run Prettier before commits

## Testing

Manual testing loop:
1. Exercise editor and inline prediction in browser
2. Test Valleys save/load
3. Ping `/api/health`
4. Replay curl commands from `docs/VALLEYS_STATUS.md`

## Commits

Short, present-tense style: `image gen fixed`, `prompt updated`. Keep scope tight. PRs should include sample requests/responses for API changes.

## Security

- Keep `.env` out of git (see `.env.example`)
- Required: `OPENROUTER_API_KEY`, Supabase credentials
- Optional: Replicate settings for image gen
