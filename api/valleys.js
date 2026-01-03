import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

// Initialize Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null;

export default async function handler(req, res) {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (!supabase) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  // Extract ID from URL path for single valley operations
  // URL format: /api/valleys or /api/valleys/[id]
  const urlParts = req.url.split('?')[0].split('/').filter(Boolean);
  const valleyId = urlParts.length > 2 ? urlParts[urlParts.length - 1] : null;

  try {
    // GET /api/valleys - list all valleys
    if (req.method === 'GET' && !valleyId) {
      const { data, error } = await supabase
        .from('valleys')
        .select('id, title, created_at')
        .order('created_at', { ascending: false });

      if (error) throw error;
      return res.status(200).json({ valleys: data || [] });
    }

    // GET /api/valleys/:id - get single valley
    if (req.method === 'GET' && valleyId) {
      const { data, error } = await supabase
        .from('valleys')
        .select('*')
        .eq('id', valleyId)
        .single();

      if (error || !data) {
        return res.status(404).json({ error: 'Valley not found' });
      }
      return res.status(200).json(data);
    }

    // POST /api/valleys - create new valley
    if (req.method === 'POST') {
      const { title, text, rules, contextSessionId } = req.body;

      if (!text) {
        return res.status(400).json({ error: 'Text is required' });
      }

      const id = uuidv4();
      const now = new Date().toISOString();

      const { data, error } = await supabase
        .from('valleys')
        .insert({
          id,
          title: title || 'Untitled',
          text,
          rules: rules || null,
          context_session_id: contextSessionId || null,
          created_at: now,
          updated_at: now
        })
        .select('id, title, created_at')
        .single();

      if (error) throw error;
      return res.status(200).json(data);
    }

    // DELETE /api/valleys/:id - delete valley
    if (req.method === 'DELETE' && valleyId) {
      const { error } = await supabase
        .from('valleys')
        .delete()
        .eq('id', valleyId);

      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Valleys API error:', error);
    return res.status(500).json({ error: error.message });
  }
}
