import crypto from 'crypto';
import { supabase } from '../lib/supabaseClient.js';

export default async (req, res) => {
  // Only allow POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Verify webhook signature
  const signature = req.headers['x-signature'];
  const secret = process.env.LEMON_WEBHOOK_SECRET;

  if (!secret) {
    console.error('LEMON_WEBHOOK_SECRET not configured');
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  // LemonSqueezy sends the raw body, need to verify signature
  const rawBody = JSON.stringify(req.body);
  const hmac = crypto.createHmac('sha256', secret);
  const digest = hmac.update(rawBody).digest('hex');

  if (signature !== digest) {
    console.error('Invalid webhook signature');
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const { meta, data } = req.body;
  const eventName = meta?.event_name;

  console.log(`[LemonSqueezy] Webhook received: ${eventName}`);

  try {
    switch (eventName) {
      case 'subscription_created':
      case 'subscription_updated':
        await handleSubscriptionUpdate(data);
        break;

      case 'subscription_cancelled':
      case 'subscription_expired':
      case 'subscription_paused':
        await handleSubscriptionCancelled(data);
        break;

      case 'order_created':
        await handleOrderCreated(data);
        break;

      default:
        console.log(`[LemonSqueezy] Unhandled event: ${eventName}`);
    }

    res.status(200).json({ received: true });
  } catch (error) {
    console.error('[LemonSqueezy] Webhook error:', error);
    res.status(500).json({ error: 'Webhook processing failed' });
  }
};

async function handleSubscriptionUpdate(data) {
  const email = data.attributes.user_email;
  const customerId = data.attributes.customer_id.toString();
  const subscriptionId = data.id.toString();
  const status = data.attributes.status;
  const renewsAt = data.attributes.renews_at;

  console.log(`[LemonSqueezy] Subscription update for ${email}`);

  // Find user by email
  const { data: users } = await supabase.auth.admin.listUsers();
  const user = users.users.find(u => u.email === email);

  if (!user) {
    console.error(`[LemonSqueezy] User not found for email: ${email}`);
    return;
  }

  // Upsert subscription
  const { error } = await supabase
    .from('user_subscriptions')
    .upsert({
      user_id: user.id,
      tier: 'pro',
      lemon_customer_id: customerId,
      lemon_subscription_id: subscriptionId,
      status: status === 'active' ? 'active' : status === 'cancelled' ? 'cancelled' : status === 'past_due' ? 'past_due' : 'expired',
      current_period_end: renewsAt,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'user_id'
    });

  if (error) {
    console.error('[LemonSqueezy] Error upserting subscription:', error);
  } else {
    console.log(`[LemonSqueezy] Subscription updated for user ${user.id}`);
  }
}

async function handleSubscriptionCancelled(data) {
  const subscriptionId = data.id.toString();
  const status = data.attributes.status;

  console.log(`[LemonSqueezy] Subscription cancelled: ${subscriptionId}`);

  // Update subscription status
  const { error } = await supabase
    .from('user_subscriptions')
    .update({
      status: status === 'cancelled' ? 'cancelled' : 'expired',
      updated_at: new Date().toISOString()
    })
    .eq('lemon_subscription_id', subscriptionId);

  if (error) {
    console.error('[LemonSqueezy] Error updating cancelled subscription:', error);
  }
}

async function handleOrderCreated(data) {
  const email = data.attributes.user_email;
  const orderId = data.id.toString();
  const total = data.attributes.total;
  const variantId = data.attributes.first_order_item?.variant_id?.toString();

  console.log(`[LemonSqueezy] Order created for ${email}, variant: ${variantId}`);

  // Check if this is a credit purchase
  const creditsVariantId = process.env.LEMON_CREDITS_VARIANT_ID;

  if (variantId !== creditsVariantId) {
    console.log('[LemonSqueezy] Not a credits purchase, skipping');
    return;
  }

  // Find user by email
  const { data: users } = await supabase.auth.admin.listUsers();
  const user = users.users.find(u => u.email === email);

  if (!user) {
    console.error(`[LemonSqueezy] User not found for email: ${email}`);
    return;
  }

  // Add 50 credits
  const creditsToAdd = 50;

  // Get current credits or create record
  const { data: existing } = await supabase
    .from('user_credits')
    .select('credits')
    .eq('user_id', user.id)
    .single();

  const newCredits = (existing?.credits || 0) + creditsToAdd;

  // Upsert credits
  const { error: creditsError } = await supabase
    .from('user_credits')
    .upsert({
      user_id: user.id,
      credits: newCredits,
      updated_at: new Date().toISOString()
    }, {
      onConflict: 'user_id'
    });

  if (creditsError) {
    console.error('[LemonSqueezy] Error updating credits:', creditsError);
    return;
  }

  // Record purchase
  const { error: purchaseError } = await supabase
    .from('credit_purchases')
    .insert({
      user_id: user.id,
      credits: creditsToAdd,
      amount_cents: total,
      lemon_order_id: orderId
    });

  if (purchaseError) {
    console.error('[LemonSqueezy] Error recording purchase:', purchaseError);
  } else {
    console.log(`[LemonSqueezy] Added ${creditsToAdd} credits to user ${user.id}`);
  }
}
