-- User subscriptions (synced from LemonSqueezy)
CREATE TABLE IF NOT EXISTS user_subscriptions (
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
CREATE TABLE IF NOT EXISTS user_credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  credits INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Credit purchase history
CREATE TABLE IF NOT EXISTS credit_purchases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  credits INTEGER NOT NULL,
  amount_cents INTEGER NOT NULL,
  lemon_order_id TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Image generation tracking (if not exists)
CREATE TABLE IF NOT EXISTS image_generations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  user_email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Row Level Security
ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE image_generations ENABLE ROW LEVEL SECURITY;

-- RLS Policies (users can read their own data)
DROP POLICY IF EXISTS "Users read own subscription" ON user_subscriptions;
CREATE POLICY "Users read own subscription" ON user_subscriptions
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users read own credits" ON user_credits;
CREATE POLICY "Users read own credits" ON user_credits
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users read own purchases" ON credit_purchases;
CREATE POLICY "Users read own purchases" ON credit_purchases
  FOR SELECT USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users read own generations" ON image_generations;
CREATE POLICY "Users read own generations" ON image_generations
  FOR SELECT USING (auth.uid() = user_id);

-- Service role needs full access for API operations
DROP POLICY IF EXISTS "Service role full access subscriptions" ON user_subscriptions;
CREATE POLICY "Service role full access subscriptions" ON user_subscriptions
  FOR ALL USING (true);

DROP POLICY IF EXISTS "Service role full access credits" ON user_credits;
CREATE POLICY "Service role full access credits" ON user_credits
  FOR ALL USING (true);

DROP POLICY IF EXISTS "Service role full access purchases" ON credit_purchases;  
CREATE POLICY "Service role full access purchases" ON credit_purchases
  FOR ALL USING (true);

DROP POLICY IF EXISTS "Service role full access generations" ON image_generations;
CREATE POLICY "Service role full access generations" ON image_generations
  FOR ALL USING (true);
