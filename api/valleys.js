import { createClient } from '@supabase/supabase-js';
import { v4 as uuidv4 } from 'uuid';

// Initialize Supabase
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
const supabase = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null;

// Helper to get user from JWT token
async function getUserFromToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.replace('Bearer ', '');

  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    if (error) return null;
    return user;
  } catch (e) {
    return null;
  }
}

export default async function handler(req, res) {
  // Handle CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (!supabase) {
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  // Get authenticated user (optional for GET list, required for mutations)
  const user = await getUserFromToken(req.headers.authorization);

  // Extract ID from URL path for single valley operations
  // URL format: /api/valleys or /api/valleys/[id]
  const urlParts = req.url.split('?')[0].split('/').filter(Boolean);
  const valleyId = urlParts.length > 2 ? urlParts[urlParts.length - 1] : null;

  try {
    // GET /api/valleys - list user's valleys
    if (req.method === 'GET' && !valleyId) {
      // If not authenticated, return empty list
      if (!user) {
        return res.status(200).json({ valleys: [] });
      }

      const { data, error } = await supabase
        .from('valleys')
        .select('id, title, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return res.status(200).json({ valleys: data || [] });
    }

    // GET /api/valleys/:id - get single valley (must belong to user)
    if (req.method === 'GET' && valleyId) {
      if (!user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { data, error } = await supabase
        .from('valleys')
        .select('*')
        .eq('id', valleyId)
        .eq('user_id', user.id)
        .single();

      if (error || !data) {
        return res.status(404).json({ error: 'Valley not found' });
      }
      return res.status(200).json(data);
    }

    // POST /api/valleys - create new valley (requires auth)
    if (req.method === 'POST') {
      if (!user) {
        return res.status(401).json({ error: 'Sign in to save valleys' });
      }

      const { title, text, rules, contextSessionId } = req.body;

      if (!text) {
        return res.status(400).json({ error: 'Text is required' });
      }

      // Fetch file content if contextSessionId provided
      let filesData = null;
      if (contextSessionId) {
        const { data: contextData } = await supabase
          .from('contexts')
          .select('text, files, estimated_tokens')
          .eq('session_id', contextSessionId)
          .single();

        if (contextData) {
          filesData = {
            content: contextData.text,
            files: contextData.files,
            estimatedTokens: contextData.estimated_tokens
          };
        }
      }

      const id = uuidv4();
      const now = new Date().toISOString();

      const { data, error } = await supabase
        .from('valleys')
        .insert({
          id,
          user_id: user.id,
          title: title || 'Untitled',
          text,
          rules: rules || null,
          files: filesData,
          created_at: now,
          updated_at: now
        })
        .select('id, title, created_at')
        .single();

      if (error) throw error;
      return res.status(200).json(data);
    }

    // PUT /api/valleys/:id - update existing valley
    if (req.method === 'PUT' && valleyId) {
      if (!user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { title, text, rules, contextSessionId } = req.body;

      if (!text) {
        return res.status(400).json({ error: 'Text is required' });
      }

      // Fetch file content if contextSessionId provided
      let filesData = null;
      if (contextSessionId) {
        const { data: contextData } = await supabase
          .from('contexts')
          .select('text, files, estimated_tokens')
          .eq('session_id', contextSessionId)
          .single();

        if (contextData) {
          filesData = {
            content: contextData.text,
            files: contextData.files,
            estimatedTokens: contextData.estimated_tokens
          };
        }
      }

      const updateData = {
        title: title || 'Untitled',
        text,
        rules: rules || null,
        updated_at: new Date().toISOString()
      };

      if (filesData) {
        updateData.files = filesData;
      }

      const { data, error } = await supabase
        .from('valleys')
        .update(updateData)
        .eq('id', valleyId)
        .eq('user_id', user.id)
        .select('id, title, created_at')
        .single();

      if (error) throw error;
      return res.status(200).json(data);
    }

    // DELETE /api/valleys/:id - delete valley (must belong to user)
    if (req.method === 'DELETE' && valleyId) {
      if (!user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { error } = await supabase
        .from('valleys')
        .delete()
        .eq('id', valleyId)
        .eq('user_id', user.id);

      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Valleys API error:', error);
    return res.status(500).json({ error: error.message });
  }
}
