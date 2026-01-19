import { v4 as uuidv4 } from 'uuid';
import { supabase } from './_lib/supabaseClient.js';
import { getUserTier } from './_lib/tierService.js';

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

  console.log(`[API Valleys] ${req.method} request received`);

  if (!supabase) {
    console.error('[API Valleys] Supabase client not initialized via global var');
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  // Get authenticated user (optional for GET list, required for mutations)
  const user = await getUserFromToken(req.headers.authorization);
  console.log(`[API Valleys] User authenticated: ${user ? user.id : 'No'}`);

  // Extract ID from query param or URL path
  // URL format: /api/valleys?id=[id] or /api/valleys/[id]
  const urlParts = req.url.split('?')[0].split('/').filter(Boolean);
  const valleyId = req.query.id || (urlParts.length > 2 ? urlParts[urlParts.length - 1] : null);

  try {
    // GET /api/valleys - list user's valleys or get single valley
    if (req.method === 'GET') {
      if (!user) {
        return res.status(200).json(valleyId ? { error: 'Authentication required' } : { valleys: [] });
      }

      if (valleyId) {
        // GET single valley
        const { data, error } = await supabase
          .from('valleys')
          .select('*')
          .eq('id', valleyId)
          .eq('user_id', user.id)
          .single();

        if (error || !data) {
          console.error('[API Valleys] GET single error:', error);
          return res.status(404).json({ error: 'Valley not found' });
        }
        return res.status(200).json(data);
      } else {
        // GET list
        // GET list
        const { data, error } = await supabase
          .from('valleys')
          .select('id, title, created_at, files')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });

        if (error) {
          console.error('[API Valleys] GET list error:', error);
          throw error;
        }

        const valleys = (data || []).map(v => ({
          id: v.id,
          title: v.title,
          emoji: v.files?.emoji || null,
          created_at: v.created_at,
          sources_count: v.files?.files?.length || 0
        }));

        return res.status(200).json({ valleys });
      }
    }

    // POST /api/valleys - create new valley (requires auth)
    if (req.method === 'POST') {
      if (!user) {
        return res.status(401).json({ error: 'Sign in to save valleys' });
      }

      console.log('[API Valleys] POST body:', JSON.stringify(req.body).substring(0, 200) + '...');
      const { title, emoji, text, rules, writingStyle, contextSessionId } = req.body;

      if (!text) {
        return res.status(400).json({ error: 'Text is required' });
      }

      // Check tier limits
      const { tier, limits } = await getUserTier(user.id, user.email);
      console.log(`[API Valleys] User tier: ${tier}, Max valleys: ${limits.max_valleys}`);

      // Free tier: cannot save valleys
      if (tier === 'free') {
        return res.status(403).json({
          error: 'Upgrade to Pro to save valleys',
          tier: 'free',
          upgradeRequired: true
        });
      }

      // Pro tier: check max valleys limit
      const { count, error: countError } = await supabase
        .from('valleys')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id);

      if (countError) {
        console.error('[API Valleys] Count error:', countError);
      }

      const currentCount = count || 0;
      if (currentCount >= limits.max_valleys) {
        return res.status(403).json({
          error: `You've reached the maximum of ${limits.max_valleys} saved valleys`,
          tier: 'pro',
          limit: limits.max_valleys,
          current: currentCount
        });
      }

      // Fetch file content if contextSessionId provided
      let filesData = {};

      if (contextSessionId) {
        const { data: contextData, error: contextError } = await supabase
          .from('contexts')
          .select('text, files, estimated_tokens')
          .eq('session_id', contextSessionId)
          .single();

        if (contextError) {
          console.error('[API Valleys] Context fetch error:', contextError);
        }

        if (contextData) {
          filesData = {
            content: contextData.text,
            files: contextData.files,
            estimatedTokens: contextData.estimated_tokens
          };
        }
      }

      if (emoji) {
        filesData.emoji = emoji;
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
          writing_style: writingStyle || null,
          files: filesData,
          created_at: now,
          updated_at: now
        })
        .select('id, title, created_at, files')
        .single();

      if (error) {
        console.error('[API Valleys] Insert error:', error);
        throw error;
      }

      const responseData = {
        id: data.id,
        title: data.title,
        emoji: data.files?.emoji || null,
        created_at: data.created_at,
        sources_count: data.files?.files?.length || 0
      };

      return res.status(200).json(responseData);
    }

    // PUT /api/valleys - update existing valley
    if (req.method === 'PUT') {
      if (!valleyId) {
        return res.status(400).json({ error: 'Valley ID is required' });
      }
      if (!user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      console.log(`[API Valleys] PUT request for valleyId: ${valleyId}`);

      const { title, emoji, text, rules, writingStyle, contextSessionId } = req.body;

      const updateData = {
        updated_at: new Date().toISOString()
      };

      if (title !== undefined) updateData.title = title || 'Untitled';
      if (text !== undefined) updateData.text = text;
      if (rules !== undefined) updateData.rules = rules || null;
      if (writingStyle !== undefined) updateData.writing_style = writingStyle || null;

      // Handle files/emoji update
      if (contextSessionId || emoji !== undefined) {
        // Fetch current valley to merge files data
        const { data: currentValley, error: fetchError } = await supabase
          .from('valleys')
          .select('files')
          .eq('id', valleyId)
          .single();

        if (fetchError) {
          console.error('[API Valleys] Fetch current valley error:', fetchError);
        }

        let filesData = currentValley?.files || {};

        if (contextSessionId) {
          const { data: contextData, error: contextError } = await supabase
            .from('contexts')
            .select('text, files, estimated_tokens')
            .eq('session_id', contextSessionId)
            .single();

          if (contextError) {
            console.error('[API Valleys] Context fetch error:', contextError);
          }

          if (contextData) {
            filesData = {
              ...filesData,
              content: contextData.text,
              files: contextData.files,
              estimatedTokens: contextData.estimated_tokens
            };
          }
        }

        if (emoji !== undefined) {
          filesData.emoji = emoji;
        }

        updateData.files = filesData;
      }

      const { data, error } = await supabase
        .from('valleys')
        .update(updateData)
        .eq('id', valleyId)
        .eq('user_id', user.id)
        .select('id, title, created_at, files')
        .single();

      if (error) {
        console.error('[API Valleys] Update error:', error);
        throw error;
      }

      const responseData = {
        id: data.id,
        title: data.title,
        emoji: data.files?.emoji || null,
        created_at: data.created_at,
        sources_count: data.files?.files?.length || 0
      };


      return res.status(200).json(responseData);
    }

    // DELETE /api/valleys - delete valley (must belong to user)
    if (req.method === 'DELETE') {
      if (!valleyId) {
        return res.status(400).json({ error: 'Valley ID is required' });
      }
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
    console.error('[API Valleys] Unhandled API error:', error);
    return res.status(500).json({ error: error.message });
  }
}
