# Valley Save Behavior Fix Plan

## Problem

User (admin: ryadovoys@gmail.com) reports that creating a new valley and typing content doesn't save. The temp valley stays in the UI but never gets promoted to a real saved valley.

**Expected behavior:**
1. Click "New Valley" → temp valley appears ✓
2. Type content → auto-save triggers after 2s → temp valley promoted to real valley ✗ NOT WORKING
3. Empty valleys → not saved, disappear when switching ✓
4. Valleys with content → remain after switching ✗ NOT WORKING

## Root Cause

User is signed in as **admin** but has a **Free tier** account. The valley save flow fails because:

1. User creates temp valley → types content → auto-save triggers ✓
2. Backend `POST /api/valleys` checks tier via `getUserTier(user.id)`
3. Returns `tier: 'free'` → Backend rejects with 403 "Upgrade to Pro" ❌
4. Frontend auto-save silently fails (no user feedback for auto-save errors) ❌
5. Temp valley never promotes to real valley ❌

**The issue:** System has `ADMIN_EMAILS` array in `api/lib/constants.js` but **doesn't use it** to bypass tier restrictions.

### Code Analysis

**Current flow:**
```
api/valleys.js (line 90)
  → getUserTier(user.id)  // Only passes userId, not email
    → api/lib/tierService.js (line 16-34)
      → Checks user_subscriptions table
      → No admin bypass logic
      → Returns tier: 'free' for admin user
```

**Files with getUserTier calls:**
- `api/valleys.js` line 90 (POST handler - creates valley)
- `api/generate-image.js` line ~268 (image generation)

## Solution

Add admin bypass to `getUserTier()` function:
- Pass user email to `getUserTier(userId, userEmail)`
- Check if email in `ADMIN_EMAILS` array
- Return Pro tier for admins regardless of subscription status

**Benefits:**
- ✅ Simple, centralized fix (one function)
- ✅ Applies to all features (valleys, images)
- ✅ No database changes needed
- ✅ Backwards compatible (userEmail optional)
- ✅ Secure (server-side check)

## Implementation

### File 1: `api/lib/tierService.js`

**Add import:**
```javascript
import { ADMIN_EMAILS } from './constants.js';
```

**Update function signature (line 16):**
```javascript
export async function getUserTier(userId, userEmail = null) {
```

**Add admin check (after line 17, before subscription check):**
```javascript
// Admin bypass: grant Pro tier to admin users
if (userEmail && ADMIN_EMAILS.includes(userEmail)) {
  return { tier: 'pro', limits: TIER_LIMITS.pro, isAdmin: true };
}
```

**Complete updated function:**
```javascript
export async function getUserTier(userId, userEmail = null) {
  if (!userId) return { tier: 'free', limits: TIER_LIMITS.free };

  // Admin bypass: grant Pro tier to admin users
  if (userEmail && ADMIN_EMAILS.includes(userEmail)) {
    return { tier: 'pro', limits: TIER_LIMITS.pro, isAdmin: true };
  }

  const { data } = await supabase
    .from('user_subscriptions')
    .select('tier, status, current_period_end')
    .eq('user_id', userId)
    .single();

  // Check if subscription is active
  if (data?.status === 'active' && data?.tier === 'pro') {
    const isExpired = new Date(data.current_period_end) < new Date();
    if (!isExpired) {
      return { tier: 'pro', limits: TIER_LIMITS.pro };
    }
  }

  return { tier: 'free', limits: TIER_LIMITS.free };
}
```

### File 2: `api/valleys.js`

**Update line 90 (POST handler):**
```javascript
// Before:
const { tier, limits } = await getUserTier(user.id);

// After:
const { tier, limits } = await getUserTier(user.id, user.email);
```

### File 3: `api/generate-image.js`

**Find and update (around line 268):**
```javascript
// Before:
const { tier, limits } = await getUserTier(user.id);

// After:
const { tier, limits } = await getUserTier(user.id, user.email);
```

## Verification

After deploying changes:

### 1. Test Admin User (ryadovoys@gmail.com)

**Valley Save:**
1. Sign in as admin
2. Click "New Valley" → temp valley appears
3. Type content, wait 2+ seconds
4. ✅ Valley saves successfully (no 403 error)
5. ✅ Valley appears in sidebar with generated title
6. ✅ Switching valleys preserves the saved valley

**Image Generation:**
1. Click "Create Image", generate an image
2. ✅ Works (admin has Pro limits: 30/month)

### 2. Test Regular Free User

1. Sign in with non-admin email
2. Create valley, type content
3. ✅ Shows "Upgrade to Pro" error (tier check still works)

### 3. Test Regular Pro User

1. Sign in with Pro subscription
2. Create valley
3. ✅ Works (subscription-based tier check still works)

### 4. Edge Cases

**Empty Valley:**
- Create valley, don't type, switch away
- ✅ Valley disappears (not saved)

**Admin Valley Limit:**
- As admin, create 20+ valleys
- ✅ Should work (admin bypasses limits)
- Note: Clarify if admin should respect max_valleys

### 5. Deploy Instructions

**Vercel (Production):**
```bash
git add api/lib/tierService.js api/valleys.js api/generate-image.js
git commit -m "fix: Add admin bypass to tier service for valley saves"
git push origin main
```

Vercel auto-deploys from main branch.

**Local Testing:**
```bash
# Update .env if needed (ADMIN_EMAILS is in constants.js, not env)
npm run dev
# Test at http://localhost:4567/app
```

Note: API endpoints only work in production (Vercel serverless), so local testing is limited.

## Questions for User

Before implementation:

1. **Should admins bypass max_valleys limit (20)?** Or should they respect the limit but just bypass the free tier restriction?
2. **Any other admin emails to add** to ADMIN_EMAILS array?
