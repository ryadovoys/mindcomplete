# Context Upload Issue - Debug Session

## Problem Summary
File upload for context (PDF, TXT, MD) works **locally** but fails on **Vercel** with "Failed to fetch" error.

---

## What Was Done

### 1. Supabase Setup (COMPLETED)
- Created `contexts` table in Supabase project `mbujfejmggcntdzyxvho`
- Enabled `pg_cron` extension and scheduled cleanup job every 5 minutes
- Table schema:
  ```sql
  CREATE TABLE contexts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id UUID NOT NULL UNIQUE,
    text TEXT NOT NULL,
    char_count INTEGER NOT NULL,
    estimated_tokens INTEGER NOT NULL,
    files JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    device_id TEXT
  );
  ```
- RLS policy: `"Allow anonymous session access"` for `user_id IS NULL`

### 2. Environment Variables
- **Local `.env`**: SUPABASE_URL and SUPABASE_SERVICE_KEY are set
- **Vercel**: User confirmed they added the env vars and redeployed

### 3. Vercel Serverless Functions (JUST CREATED)
The root cause was discovered: **Express server doesn't run on Vercel**. Only `api/` folder functions work.

Created/updated these files in commit `39d1c75`:
- **`api/context.js`** (NEW) - Handles multipart file upload, parses files, saves to Supabase
- **`api/predict.js`** (UPDATED) - Now fetches context from Supabase using sessionId

---

## Current Status
- Commit pushed to GitHub
- Vercel should have auto-deployed
- **User reports it still doesn't work** - needs investigation with Vercel plugin

---

## What To Investigate Next

### 1. Check Vercel Deployment Logs
Use the Vercel plugin to:
- Verify the latest deployment succeeded
- Check if `api/context.js` is included in the deployment
- Look for any build errors

### 2. Check Vercel Function Logs
- Look for errors when POST to `/api/context` is made
- Common issues:
  - Missing env vars (SUPABASE_URL, SUPABASE_SERVICE_KEY)
  - Multipart parsing issues
  - PDF parsing issues with `pdf-parse` on serverless

### 3. Potential Issues in `api/context.js`

**Multipart Parsing**: I implemented manual multipart parsing which may have bugs:
```javascript
// In api/context.js - custom multipart parser
async function parseMultipartForm(req) { ... }
```
This might not work correctly on Vercel. Consider using `formidable` or `busboy` instead.

**PDF Parsing**: The import might fail on Vercel:
```javascript
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
```
May need to try: `import pdfParse from 'pdf-parse';`

**Body Parser Config**: Make sure this is being respected:
```javascript
export const config = {
  api: {
    bodyParser: false,
  },
};
```

### 4. Test Endpoints Directly
```bash
# Test if endpoint exists
curl -X POST https://mindcomplete.vercel.app/api/context -F "files=@test.txt"

# Check response
```

---

## Key Files

| File | Purpose |
|------|---------|
| `api/context.js` | Vercel serverless function for file upload |
| `api/predict.js` | Vercel serverless function for predictions |
| `server/index.js` | Express server (LOCAL ONLY) |
| `server/contextStore.js` | Supabase context storage (used by Express) |
| `public/app.js` | Frontend - makes fetch calls to /api/context |

---

## Supabase Details
- **Project ID**: `mbujfejmggcntdzyxvho`
- **Project Name**: Mindcomplete
- **URL**: `https://mbujfejmggcntdzyxvho.supabase.co`
- **Region**: us-west-2

---

## Commands for New Session

Ask Claude to:
1. "Use the Vercel plugin to check deployment status and logs for mindcomplete"
2. "Check the Vercel function logs for /api/context endpoint errors"
3. "If there are errors, fix the api/context.js file"

---

## Frontend Upload Code Reference (in public/app.js)

The frontend sends files like this:
```javascript
const formData = new FormData();
files.forEach(file => formData.append('files', file));

const response = await fetch('/api/context', {
  method: 'POST',
  body: formData
});
```

Make sure the serverless function handles this correctly.

---

## Things That Work
- Local development (Express server)
- Supabase connection (verified via logs)
- `/api/predict` endpoint (was working before)
- pg_cron cleanup job (verified in logs)

## Things That Don't Work
- `/api/context` on Vercel - "Failed to fetch" error
