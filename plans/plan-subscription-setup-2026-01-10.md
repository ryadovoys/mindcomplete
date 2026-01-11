# Subscription System Setup Tasks

Date: 2026-01-10
**Status:** Code Complete ✅ | Manual Setup Pending ⏳

## Overview

The subscription system code is fully implemented and committed. This document outlines the remaining manual setup tasks to make the system operational using LemonSqueezy for payments.

## ✅ Completed - Code Implementation

- API endpoints: `/api/checkout`, `/api/webhooks/lemon`
- Tier service with credit management
- Image generation tier limits (Free: 0, Pro: 30/month + credits)
- Valley save tier limits (Free: 0, Pro: 20 max)
- Frontend checkout flows and billing UI
- Module system consistency (ES6 imports)

---

## ⏳ Remaining Manual Tasks

### 1. Run Database Schema in Supabase

**Time:** ~5 minutes
**Tool:** Supabase SQL Editor
**Status:** Pending

Copy and execute this SQL:

```sql
-- User subscriptions (synced from LemonSqueezy)
CREATE TABLE user_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  tier TEXT DEFAULT 'free' CHECK (tier IN ('free', 'pro')),
  lemon_customer_id TEXT,
  lemon_subscription_id TEXT,
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'cancelled', 'past_due', 'expired')),
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Image credits (purchased separately)
CREATE TABLE user_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  credits INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Credit purchase history
CREATE TABLE credit_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  credits INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  lemon_order_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security
ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_purchases ENABLE ROW LEVEL SECURITY;

-- RLS Policies (users can read their own data)
CREATE POLICY "Users read own subscription" ON user_subscriptions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users read own credits" ON user_credits
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users read own purchases" ON credit_purchases
  FOR SELECT USING (auth.uid() = user_id);
```

**Verification:** Check that all 3 tables appear in Supabase Table Editor with RLS enabled.

---

### 2. Set Up LemonSqueezy Account

**Time:** ~15 minutes
**URL:** https://lemonsqueezy.com
**Status:** Pending

### Steps:

1. **Create Account**
   - Sign up at lemonsqueezy.com
   - Complete email verification

2. **Create Store**
   - Navigate to Stores → Create Store
   - Enter store name (e.g., "Purple Valley")
   - Configure store settings

3. **Create Products**

   **Product 1: Pro Subscription**
   - Name: "Purple Valley Pro"
   - Type: Subscription
   - Price: $5.99/month
   - Billing interval: Monthly
   - Description: "Unlimited text predictions, 30 images/month, 20 saved valleys"
   - Copy the **Variant ID** (needed for env vars)

   **Product 2: Credit Pack**
   - Name: "Image Credits (50 pack)"
   - Type: One-time purchase
   - Price: $2.99
   - Description: "50 additional image generation credits"
   - Copy the **Variant ID** (needed for env vars)

4. **Get API Credentials**
   - Navigate to Settings → API
   - Copy **API Key**
   - Copy **Store ID**

5. **Set Up Webhook**
   - Navigate to Settings → Webhooks
   - Create new webhook
   - URL: `https://purplevalley.co/api/webhooks/lemon` (replace with your domain)
   - Events: Select all subscription and order events
   - Copy **Signing Secret** (LEMON_WEBHOOK_SECRET)

**Save These Values:**
```
LEMON_API_KEY=lemon_api_...
LEMON_WEBHOOK_SECRET=whsec_...
LEMON_STORE_ID=12345
LEMON_PRO_VARIANT_ID=67890
LEMON_CREDITS_VARIANT_ID=67891
```

---

### 3. Add Environment Variables to Vercel

**Time:** ~3 minutes
**Tool:** Vercel Dashboard
**Status:** Pending

### Steps:

1. Go to Vercel Dashboard → Your Project → Settings → Environment Variables
2. Add each variable:
   - `LEMON_API_KEY` → (from LemonSqueezy API settings)
   - `LEMON_WEBHOOK_SECRET` → (from LemonSqueezy webhook settings)
   - `LEMON_STORE_ID` → (from LemonSqueezy store)
   - `LEMON_PRO_VARIANT_ID` → (from Pro subscription product)
   - `LEMON_CREDITS_VARIANT_ID` → (from credit pack product)
3. Apply to: Production, Preview, Development
4. Redeploy the application

---

### 4. Test the System

**Time:** ~20 minutes
**Status:** Pending

### Test Free Tier Limits

1. **Sign In**
   - Create a test account or use existing
   - Verify you're signed in

2. **Test Image Generation Limit**
   - Try to generate an image
   - Should see: "Upgrade to Pro to generate images" prompt
   - Click prompt → should open settings billing tab

3. **Test Valley Save Limit**
   - Write some text in editor
   - Try to save a valley
   - Should see: "Upgrade to Pro to save valleys" prompt
   - Click prompt → should open settings billing tab

4. **Check Settings UI**
   - Open Settings → Billing tab
   - Verify it shows:
     - "Free Plan"
     - $0/month
     - 0 images/month
     - 0 saved valleys
     - "Upgrade to Pro" button visible
     - "Buy Credits" button visible

### Test Upgrade Flow (Test Mode)

1. **Enable LemonSqueezy Test Mode**
   - In LemonSqueezy dashboard: Settings → Enable test mode
   - Use test card: `4242 4242 4242 4242`

2. **Test Pro Upgrade**
   - Click "Upgrade to Pro" in settings
   - Should redirect to LemonSqueezy checkout
   - Complete checkout with test card
   - Return to app

3. **Verify Webhook Received**
   - Check LemonSqueezy dashboard → Webhooks → Recent deliveries
   - Should see `subscription_created` event
   - Verify webhook returned 200 OK

4. **Verify Subscription in Supabase**
   - Open Supabase → Table Editor → `user_subscriptions`
   - Find your user record
   - Verify:
     - `tier` = 'pro'
     - `status` = 'active'
     - `current_period_end` is set

5. **Verify Pro Features Work**
   - Refresh app
   - Open Settings → Billing
   - Should now show "Pro Plan" with $5.99/month
   - Try generating an image → should work
   - Try saving a valley → should work

### Test Credits Purchase (Test Mode)

1. **Exhaust Pro Images**
   - Manually set monthly image count to 30 in Supabase `image_generations` table
   - Or wait until Pro limit is reached

2. **Test Credits Purchase**
   - Try to generate image → should see "Buy credits" prompt
   - Click "Buy Credits" button
   - Complete LemonSqueezy checkout with test card

3. **Verify Credits Added**
   - Check `user_credits` table in Supabase
   - Should see 50 credits added
   - Check `credit_purchases` table for purchase record

4. **Test Credit Deduction**
   - Generate an image
   - Verify credit count decreased by 1

---

### 5. Go Live

**Time:** ~5 minutes
**Status:** Pending

### Steps:

1. **Disable Test Mode in LemonSqueezy**
   - Settings → Disable test mode
   - Verify products are live

2. **Update Webhook URL**
   - If using different domain for production
   - Update webhook URL to production domain

3. **Test with Real Card (Small Amount)**
   - Use your own card to test $2.99 credit purchase
   - Verify entire flow works
   - Immediately refund via LemonSqueezy dashboard

4. **Monitor**
   - Watch Vercel logs for webhook activity
   - Check Supabase for new subscriptions
   - Monitor LemonSqueezy dashboard for orders

---

## Troubleshooting

### Webhook Not Receiving Events
- Check webhook URL is publicly accessible
- Verify LEMON_WEBHOOK_SECRET matches LemonSqueezy
- Check Vercel logs for incoming requests
- Test webhook manually from LemonSqueezy dashboard

### Subscription Not Updating in Supabase
- Check webhook signature validation
- Verify user email in webhook matches Supabase auth.users
- Check Vercel function logs for errors
- Manually trigger webhook from LemonSqueezy

### Checkout Redirect Fails
- Verify LEMON_API_KEY is correct
- Check variant IDs match products
- Look for CORS errors in browser console
- Check Vercel function logs

### Credits Not Deducting
- Verify `user_credits` table has record for user
- Check tierService.js deductCredit function logs
- Ensure image generation completes successfully

---

## Success Checklist

**Code Implementation:**
- ✅ API endpoints created (`/api/checkout`, `/api/webhooks/lemon`)
- ✅ Tier service with limits and credit management
- ✅ Image generation tier enforcement
- ✅ Valley save tier enforcement
- ✅ Frontend checkout flows
- ✅ Module system consistency

**Manual Setup:**
- ⏳ All 3 Supabase tables created with RLS enabled
- ⏳ LemonSqueezy products created and webhook configured
- ⏳ All 5 environment variables added to Vercel
- ⏳ Free tier shows upgrade prompts for images/valleys
- ⏳ Pro upgrade flow completes successfully
- ⏳ Webhook updates Supabase subscription data
- ⏳ Pro users can generate images and save valleys
- ⏳ Credits can be purchased and deducted correctly
- ⏳ Settings UI displays correct tier information

---

## Notes

- Keep test mode enabled until fully verified
- LemonSqueezy handles all tax compliance automatically
- Webhook signature validation prevents unauthorized updates
- RLS policies ensure users only see their own data
- Monthly image count resets automatically at month start
