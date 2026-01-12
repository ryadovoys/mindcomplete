import { supabase } from '../_lib/supabaseClient.js';

export default async function handler(req, res) {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'DELETE') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!supabase) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const token = authHeader.replace('Bearer ', '');

  try {
    // Verify the token and get user
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ error: 'Invalid token' });
    }

    // Delete user's valleys first (cascade should handle this, but be explicit)
    const { error: deleteValleysError } = await supabase
      .from('valleys')
      .delete()
      .eq('user_id', user.id);

    if (deleteValleysError) {
      console.error('Error deleting valleys:', deleteValleysError);
    }

    // Delete the user account (requires service role key)
    const { error } = await supabase.auth.admin.deleteUser(user.id);
    if (error) throw error;

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Delete account error:', error);
    return res.status(500).json({ error: error.message });
  }
}
