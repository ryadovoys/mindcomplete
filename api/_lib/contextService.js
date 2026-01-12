import { supabase } from './supabaseClient.js';

// Get context from Supabase
export async function getContext(sessionId) {
  if (!supabase || !sessionId) return null;

  const { data, error } = await supabase
    .from('contexts')
    .select('text, char_count, estimated_tokens, files, expires_at')
    .eq('session_id', sessionId)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (error || !data) return null;

  return {
    text: data.text,
    charCount: data.char_count,
    estimatedTokens: data.estimated_tokens,
    files: data.files
  };
}
