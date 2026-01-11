import { supabase } from './lib/supabaseClient.js';

export default async (req, res) => {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Get user from auth token
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);

  if (authError || !user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { product } = req.body;

  if (!product || !['pro', 'credits'].includes(product)) {
    return res.status(400).json({ error: 'Invalid product. Must be "pro" or "credits"' });
  }

  // Check env vars
  const apiKey = process.env.LEMON_API_KEY;
  const storeId = process.env.LEMON_STORE_ID;
  const variantId = product === 'pro'
    ? process.env.LEMON_PRO_VARIANT_ID
    : process.env.LEMON_CREDITS_VARIANT_ID;

  if (!apiKey || !storeId || !variantId) {
    console.error('LemonSqueezy env vars not configured');
    return res.status(500).json({ error: 'Payment system not configured' });
  }

  try {
    // Create checkout session using LemonSqueezy API
    const response = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.api+json',
        'Content-Type': 'application/vnd.api+json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        data: {
          type: 'checkouts',
          attributes: {
            checkout_data: {
              email: user.email,
              custom: {
                user_id: user.id
              }
            }
          },
          relationships: {
            store: {
              data: {
                type: 'stores',
                id: storeId
              }
            },
            variant: {
              data: {
                type: 'variants',
                id: variantId
              }
            }
          }
        }
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('[LemonSqueezy] Checkout creation failed:', errorData);
      return res.status(500).json({ error: 'Failed to create checkout' });
    }

    const data = await response.json();
    const checkoutUrl = data.data.attributes.url;

    res.status(200).json({ checkoutUrl });
  } catch (error) {
    console.error('[LemonSqueezy] Checkout error:', error);
    res.status(500).json({ error: 'Failed to create checkout' });
  }
};
