import { supabase } from './supabaseClient.js';

const CONTEXT_TTL_MS = 30 * 60 * 1000; // 30 minutes

// Fallback in-memory storage (for local dev without Supabase)
const memoryStore = new Map();

export async function setContext(sessionId, contextData) {
  const expiresAt = new Date(Date.now() + CONTEXT_TTL_MS).toISOString();

  if (supabase) {
    const { error } = await supabase
      .from('contexts')
      .upsert({
        session_id: sessionId,
        text: contextData.text,
        char_count: contextData.charCount,
        estimated_tokens: contextData.estimatedTokens,
        files: contextData.files,
        expires_at: expiresAt
      }, {
        onConflict: 'session_id'
      });

    if (error) {
      console.error('Supabase setContext error:', error);
      throw new Error('Failed to save context');
    }
  } else {
    // Fallback to memory
    memoryStore.set(sessionId, {
      ...contextData,
      createdAt: Date.now()
    });
    setTimeout(() => memoryStore.delete(sessionId), CONTEXT_TTL_MS);
  }
}

export async function getContext(sessionId) {
  if (supabase) {
    const { data, error } = await supabase
      .from('contexts')
      .select('text, char_count, estimated_tokens, files, expires_at')
      .eq('session_id', sessionId)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (error || !data) {
      return null;
    }

    return {
      text: data.text,
      charCount: data.char_count,
      estimatedTokens: data.estimated_tokens,
      files: data.files
    };
  } else {
    // Fallback to memory
    const context = memoryStore.get(sessionId);
    if (!context) return null;
    if (Date.now() - context.createdAt > CONTEXT_TTL_MS) {
      memoryStore.delete(sessionId);
      return null;
    }
    return context;
  }
}

export async function deleteContext(sessionId) {
  if (supabase) {
    const { error } = await supabase
      .from('contexts')
      .delete()
      .eq('session_id', sessionId);

    if (error) {
      console.error('Supabase deleteContext error:', error);
    }
  } else {
    memoryStore.delete(sessionId);
  }
}

// Cleanup for memory fallback only (Supabase uses pg_cron)
export function clearExpiredContexts() {
  if (!supabase) {
    const now = Date.now();
    for (const [id, context] of memoryStore) {
      if (now - context.createdAt > CONTEXT_TTL_MS) {
        memoryStore.delete(id);
      }
    }
  }
}

// Run cleanup every 5 minutes (only affects memory fallback)
setInterval(clearExpiredContexts, 5 * 60 * 1000);
