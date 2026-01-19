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

  console.log(`[API Projects] ${req.method} request received`);

  if (!supabase) {
    console.error('[API Projects] Supabase client not initialized via global var');
    return res.status(500).json({ error: 'Supabase not configured' });
  }

  // Get authenticated user (optional for GET list, required for mutations)
  const user = await getUserFromToken(req.headers.authorization);
  console.log(`[API Projects] User authenticated: ${user ? user.id : 'No'}`);

  // Extract ID from query param or URL path
  // URL format: /api/projects?id=[id] or /api/projects/[id]
  const urlParts = req.url.split('?')[0].split('/').filter(Boolean);
  const projectId = req.query.id || (urlParts.length > 2 ? urlParts[urlParts.length - 1] : null);

  try {
    // GET /api/projects - list user's projects or get single project
    if (req.method === 'GET') {
      if (!user) {
        return res.status(200).json(projectId ? { error: 'Authentication required' } : { projects: [] });
      }

      if (projectId) {
        // GET single project
        const { data, error } = await supabase
          .from('valleys') // DB table name remains 'valleys'
          .select('*')
          .eq('id', projectId)
          .eq('user_id', user.id)
          .single();

        if (error || !data) {
          console.error('[API Projects] GET single error:', error);
          return res.status(404).json({ error: 'Project not found' });
        }
        return res.status(200).json(data);
      } else {
        // GET list
        const { data, error } = await supabase
          .from('valleys') // DB table name remains 'valleys'
          .select('id, title, created_at, files')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });

        if (error) {
          console.error('[API Projects] GET list error:', error);
          throw error;
        }

        const projects = (data || []).map(v => ({
          id: v.id,
          title: v.title,
          emoji: v.files?.emoji || null,
          created_at: v.created_at,
          sources_count: v.files?.files?.length || 0
        }));

        return res.status(200).json({ projects });
      }
    }

    // POST /api/projects - create new project (requires auth)
    if (req.method === 'POST') {
      if (!user) {
        return res.status(401).json({ error: 'Sign in to save projects' });
      }

      console.log('[API Projects] POST body:', JSON.stringify(req.body).substring(0, 200) + '...');
      const { title, emoji, text, rules, writingStyle, contextSessionId } = req.body;

      if (!text) {
        return res.status(400).json({ error: 'Text is required' });
      }

      // Check tier limits - REMOVED per previous instructions, allowing all users to save

      // Fetch file content if contextSessionId provided
      let filesData = {};

      if (contextSessionId) {
        const { data: contextData, error: contextError } = await supabase
          .from('contexts')
          .select('text, files, estimated_tokens')
          .eq('session_id', contextSessionId)
          .single();

        if (contextError) {
          console.error('[API Projects] Context fetch error:', contextError);
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
        .from('valleys') // DB table name remains 'valleys'
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
        console.error('[API Projects] Insert error:', error);
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

    // PUT /api/projects - update existing project
    if (req.method === 'PUT') {
      const projectId = req.query.id || urlParts[urlParts.length - 1]; // Ensure we get ID

      if (!projectId) {
        return res.status(400).json({ error: 'Project ID is required' });
      }
      if (!user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      console.log(`[API Projects] PUT request for projectId: ${projectId}`);

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
        // Fetch current project to merge files data
        const { data: currentProject, error: fetchError } = await supabase
          .from('valleys') // DB table name remains 'valleys'
          .select('files')
          .eq('id', projectId)
          .single();

        if (fetchError) {
          console.error('[API Projects] Fetch current project error:', fetchError);
        }

        let filesData = currentProject?.files || {};

        if (contextSessionId) {
          const { data: contextData, error: contextError } = await supabase
            .from('contexts')
            .select('text, files, estimated_tokens')
            .eq('session_id', contextSessionId)
            .single();

          if (contextError) {
            console.error('[API Projects] Context fetch error:', contextError);
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
        .from('valleys') // DB table name remains 'valleys'
        .update(updateData)
        .eq('id', projectId)
        .eq('user_id', user.id)
        .select('id, title, created_at, files')
        .single();

      if (error) {
        console.error('[API Projects] Update error:', error);
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

    // DELETE /api/projects - delete project (must belong to user)
    if (req.method === 'DELETE') {
      const projectId = req.query.id || urlParts[urlParts.length - 1]; // Ensure we get ID
      if (!projectId) {
        return res.status(400).json({ error: 'Project ID is required' });
      }
      if (!user) {
        return res.status(401).json({ error: 'Authentication required' });
      }

      const { error } = await supabase
        .from('valleys') // DB table name remains 'valleys'
        .delete()
        .eq('id', projectId)
        .eq('user_id', user.id);

      if (error) throw error;
      return res.status(200).json({ success: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('[API Projects] Unhandled API error:', error);
    return res.status(500).json({ error: error.message });
  }
}
