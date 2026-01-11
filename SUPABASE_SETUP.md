# Supabase Integration Setup

## Status: Code Changes Complete

All code changes have been made. The following files were modified/created:

- `server/supabaseClient.js` - NEW: Supabase client initialization
- `server/contextStore.js` - Refactored for Supabase with memory fallback
- `server/index.js` - Async routes + relaxed MIME type filter for iOS mobile
- `server/fileParser.js` - Extension-first file type detection for mobile
- `public/app.js` - Added localStorage session persistence
- `.env.example` - Added Supabase environment variables
- `package.json` - Added `@supabase/supabase-js` dependency

---

## Remaining Steps (Supabase Plugin Available)

### 1. Create Database Table

Run this SQL in Supabase:

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

CREATE INDEX idx_contexts_session_id ON contexts(session_id);
CREATE INDEX idx_contexts_expires_at ON contexts(expires_at);

ALTER TABLE contexts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow anonymous session access" ON contexts
  FOR ALL USING (user_id IS NULL) WITH CHECK (user_id IS NULL);
```

### 4. Create Image Generations Table

Run this SQL to track daily limits:

```sql
create table image_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  user_email text not null,
  created_at timestamptz default now()
);

-- Index for efficient daily count queries
create index idx_image_generations_user_date
  on image_generations (user_id, created_at);

-- RLS policy
alter table image_generations enable row level security;
create policy "Users can view own generations"
  on image_generations for select
  using (auth.uid() = user_id);
```

### 2. Enable pg_cron Extension and Schedule Cleanup

Enable pg_cron extension, then run:

```sql
SELECT cron.schedule('cleanup-expired-contexts', '*/5 * * * *',
  $$DELETE FROM contexts WHERE expires_at < NOW()$$);
```

### 3. Configure Environment Variables

Add to `.env`:
```
SUPABASE_URL=<project_url_from_supabase>
SUPABASE_SERVICE_KEY=<service_role_key_from_supabase>
```

Add same variables to Vercel dashboard.

---

## Why This Fixes Mobile Upload

The mobile TXT upload was failing because:
1. iPhone Chrome sends `application/octet-stream` MIME type instead of `text/plain`
2. Now we check file extension first (`.txt`, `.md`, `.pdf`) before MIME type
3. We also accept `application/octet-stream` in the allowed MIME types list

## Why Supabase Fixes Vercel Persistence

On Vercel serverless:
- Each request can hit a different server instance
- In-memory storage (Map) is not shared between instances
- Supabase provides persistent database storage accessible from any instance

---

## Testing Checklist

After setup:
- [ ] Test local dev without Supabase credentials (memory fallback works)
- [ ] Test local dev with Supabase credentials (database persistence)
- [ ] Test mobile TXT file upload on iPhone Chrome
- [ ] Test session recovery on page refresh
- [ ] Deploy to Vercel and test context persistence
