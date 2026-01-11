import { supabase } from './supabaseClient.js';

export const TIER_LIMITS = {
  free: {
    predictions_per_day: Infinity, // Unlimited for MVP
    images_per_month: 0,
    max_valleys: 0
  },
  pro: {
    predictions_per_day: Infinity,
    images_per_month: 30,
    max_valleys: 20
  }
};

export async function getUserTier(userId) {
  if (!userId) return { tier: 'free', limits: TIER_LIMITS.free };

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

export async function getUserCredits(userId) {
  if (!userId) return 0;

  const { data } = await supabase
    .from('user_credits')
    .select('credits')
    .eq('user_id', userId)
    .single();

  return data?.credits || 0;
}

export async function deductCredit(userId) {
  // First, ensure the user has a credits record
  const { data: existing } = await supabase
    .from('user_credits')
    .select('credits')
    .eq('user_id', userId)
    .single();

  if (!existing || existing.credits <= 0) {
    return false;
  }

  // Deduct 1 credit
  const { data, error } = await supabase
    .from('user_credits')
    .update({
      credits: existing.credits - 1,
      updated_at: new Date().toISOString()
    })
    .eq('user_id', userId)
    .select()
    .single();

  return !error && data;
}

export async function getMonthlyImageCount(userId) {
  if (!userId) return 0;

  // Get start of current month
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const { count } = await supabase
    .from('image_generations')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .gte('created_at', monthStart.toISOString());

  return count || 0;
}
