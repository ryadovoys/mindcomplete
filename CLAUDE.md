# Purple Valley (Ideas Autocomplete)

AI-powered writing assistant that completes your thoughts as you type, with image generation capabilities.

## Tech Stack
- **Frontend**: Vanilla JS, CSS (no frameworks)
- **Backend**: Node.js/Express (local), Vercel serverless (production)
- **Database**: Supabase (contexts table for uploaded files)
- **AI**: OpenRouter API (xiaomi/mimo-v2-flash for text, bytedance-seed/seedream-4.5 for images)

## Project Structure
```
/api              - Vercel serverless functions
  predict.js      - Text prediction endpoint
  generate-image.js - Image generation endpoint
  context.js      - File upload/context management
/server           - Local development server
  index.js        - Express server with all endpoints
/public           - Frontend files
  app.js          - Main application logic
  styles.css      - All styles
  index.html      - Main HTML
```

## Key Features
- Inline text predictions with word-by-word fade animation
- Image generation with optional guidance/context
- Context management (rules + file uploads)
- Ghibli-style image generation

## Commands
```bash
npm run dev       # Start local server on port 3000
```

## Environment Variables
- `OPENROUTER_API_KEY` - OpenRouter API key
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_SERVICE_KEY` - Supabase service key

## Data Storage
- **Supabase**: Uploaded file contents (30 min TTL)
- **localStorage**: Rules text, session IDs
- **Not stored**: User's writing, generated images

## Tools
- When using Figma MCP or plugin, use **Figma Desktop** tools (e.g., `figma-desktop__get_design_context`)

## Style Guidelines
- Use CSS variables from `:root` (--dark-purple, --offwhite, --light-purple, etc.)
- Mobile-first with `@media (hover: hover)` for desktop hover states
- Modals: 440px desktop, full-width on mobile (except image guidance modal)
- Border radius: 32px for modals, 16px for buttons/inputs
