import { supabase } from './supabaseClient.js';
import { v4 as uuidv4 } from 'uuid';
import { getContext } from './contextStore.js';

// Fallback in-memory storage (for local dev without Supabase or when table doesn't exist)
const memoryStore = new Map();

// Track if we should use memory fallback (e.g., when table doesn't exist)
let useMemoryFallback = !supabase;

export async function createValley(valleyData, userId) {
  const id = uuidv4();
  const now = new Date().toISOString();

  // Fetch file content if contextSessionId provided
  let filesData = null;
  if (valleyData.contextSessionId) {
    const context = await getContext(valleyData.contextSessionId);
    if (context) {
      filesData = {
        content: context.text,
        files: context.files,
        estimatedTokens: context.estimatedTokens
      };
    }
  }

  if (supabase && !useMemoryFallback) {
    const { data, error } = await supabase
      .from('valleys')
      .insert({
        id,
        user_id: userId,
        title: valleyData.title,
        text: valleyData.text,
        rules: valleyData.rules || null,
        files: filesData,
        created_at: now,
        updated_at: now
      })
      .select('id, title, created_at')
      .single();

    if (error) {
      // If table doesn't exist, fall back to memory
      if (error.code === 'PGRST205' || error.message?.includes('valleys')) {
        console.warn('Valleys table not found in Supabase, using memory fallback');
        useMemoryFallback = true;
        return createValleyInMemory(id, valleyData, filesData, now, userId);
      }
      console.error('Supabase createValley error:', error);
      throw new Error('Failed to create valley');
    }
    return data;
  } else {
    return createValleyInMemory(id, valleyData, filesData, now, userId);
  }
}

function createValleyInMemory(id, valleyData, filesData, now, userId) {
  const valley = {
    id,
    user_id: userId,
    title: valleyData.title,
    text: valleyData.text,
    rules: valleyData.rules || null,
    files: filesData,
    created_at: now,
    updated_at: now
  };
  memoryStore.set(id, valley);
  return { id, title: valley.title, created_at: valley.created_at };
}

function getValleysFromMemory(userId) {
  return Array.from(memoryStore.values())
    .filter(v => v.user_id === userId)
    .map(v => ({ id: v.id, title: v.title, created_at: v.created_at }))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

export async function getValleys(userId) {
  // If no userId, return empty array (guest mode)
  if (!userId) {
    return [];
  }

  if (supabase && !useMemoryFallback) {
    const { data, error } = await supabase
      .from('valleys')
      .select('id, title, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      // If table doesn't exist, fall back to memory
      if (error.code === 'PGRST205' || error.message?.includes('valleys')) {
        console.warn('Valleys table not found in Supabase, using memory fallback');
        useMemoryFallback = true;
        return getValleysFromMemory(userId);
      }
      console.error('Supabase getValleys error:', error);
      throw new Error('Failed to fetch valleys');
    }
    return data || [];
  } else {
    return getValleysFromMemory(userId);
  }
}

export async function getValley(id, userId) {
  if (supabase && !useMemoryFallback) {
    const { data, error } = await supabase
      .from('valleys')
      .select('*')
      .eq('id', id)
      .eq('user_id', userId)
      .single();

    if (error) {
      // If table doesn't exist, fall back to memory
      if (error.code === 'PGRST205' || error.message?.includes('valleys')) {
        console.warn('Valleys table not found in Supabase, using memory fallback');
        useMemoryFallback = true;
        const valley = memoryStore.get(id);
        return (valley && valley.user_id === userId) ? valley : null;
      }
      return null;
    }
    return data;
  } else {
    const valley = memoryStore.get(id);
    return (valley && valley.user_id === userId) ? valley : null;
  }
}

export async function deleteValley(id, userId) {
  if (supabase && !useMemoryFallback) {
    const { error } = await supabase
      .from('valleys')
      .delete()
      .eq('id', id)
      .eq('user_id', userId);

    if (error) {
      // If table doesn't exist, fall back to memory
      if (error.code === 'PGRST205' || error.message?.includes('valleys')) {
        console.warn('Valleys table not found in Supabase, using memory fallback');
        useMemoryFallback = true;
        const valley = memoryStore.get(id);
        if (valley && valley.user_id === userId) {
          memoryStore.delete(id);
        }
        return;
      }
      console.error('Supabase deleteValley error:', error);
      throw new Error('Failed to delete valley');
    }
  } else {
    const valley = memoryStore.get(id);
    if (valley && valley.user_id === userId) {
      memoryStore.delete(id);
    }
  }
}

export async function deleteUserValleys(userId) {
  if (supabase && !useMemoryFallback) {
    const { error } = await supabase
      .from('valleys')
      .delete()
      .eq('user_id', userId);

    if (error) {
      console.error('Supabase deleteUserValleys error:', error);
    }
  } else {
    // Delete all valleys for user from memory
    for (const [id, valley] of memoryStore.entries()) {
      if (valley.user_id === userId) {
        memoryStore.delete(id);
      }
    }
  }
}
