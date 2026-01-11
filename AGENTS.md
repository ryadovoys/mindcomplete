# Repository Guidelines

## Project Structure & Module Organization
Purple Valley ships a static client in `public/` served by the slim Express stub in `server/index.js`. API logic (predict, context, Valleys, auth, images) lives in `api/` so Vercel can deploy it verbatim, while persistence helpers (`contextStore.js`, `valleysStore.js`, `supabaseClient.js`) fall back to in-memory Maps when Supabase keys are missing. Reference notes stay in `docs/`; `SUPABASE_SETUP.md` and `VALLEYS_STATUS.md` describe outstanding database chores.

## Build, Test, and Development Commands
- `npm install` — install Express, Supabase, and browser dependencies.
- `npm run dev` / `npm start` — serve `/public` at `http://localhost:3000`. **Note**: Restart this whenever you touch `server/index.js` or `vercel.json`.
- `vercel dev` — run when you need the Vercel function environment locally.
- **CRITICAL**: Routing changes must be applied to both `server/index.js` and `vercel.json` to avoid 404s.
- `curl -N http://localhost:3000/api/health` or the CRUD snippets in `VALLEYS_STATUS.md` — low-friction API smoke tests.

## Coding Style & Naming Conventions
Use ES modules, 2-space indentation, single quotes, and trailing semicolons (see `public/app.js`, `api/predict.js`). Stick with descriptive filenames (`*-store.js`, `*-manager.js`) and keep CSS class names in sync with their JS selectors. Prefer classes or tight modules over globals, favor `const`, and stash tunable values inside top-level `CONFIG` objects. Run Prettier with default settings before opening a PR if your editor supports it.

## Testing Guidelines
Automated tests are pending, so rely on the manual loop: exercise the editor, inline prediction flow, and Valleys save/load UI in the browser after each edit; ping `/health` (Express) and `/api/health` (serverless); replay the curl matrix in `VALLEYS_STATUS.md`; and walk through the Supabase checklist at the end of `SUPABASE_SETUP.md` when persistence changes. Capture what you verified in your PR description.

## Commit & Pull Request Guidelines
Follow the existing short, present-tense commit style (`image gen fixed`, `prompt updated`). Keep each commit scoped, and only add context if it clarifies the diff. Pull requests should mention the issue or goal, summarize the change, list new env vars or migrations, and include the manual validation you performed (commands, screenshots, or GIFs). When touching endpoints, paste sample requests/responses so reviewers can replay them.

## Security & Configuration Tips
Keep `.env` out of version control; reference `.env.example` for required keys (`OPENROUTER_API_KEY`, Supabase pair, optional Replicate settings). Use disposable Supabase users when invoking `api/auth/delete-account.js`, and confirm the policies outlined in `SUPABASE_SETUP.md` before altering production data. Recheck Vercel env vars whenever you change models or providers so OpenRouter calls keep valid headers.
