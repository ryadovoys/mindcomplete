import { supabase } from './supabaseClient.js';
import { v4 as uuidv4 } from 'uuid';

// Fallback in-memory storage (for local dev without Supabase or when table doesn't exist)
const memoryStore = new Map();

// Track if we should use memory fallback (e.g., when table doesn't exist)
let useMemoryFallback = !supabase;

export async function createValley(valleyData) {
  const id = uuidv4();
  const now = new Date().toISOString();

  if (supabase && !useMemoryFallback) {
    const { data, error } = await supabase
      .from('valleys')
      .insert({
        id,
        title: valleyData.title,
        text: valleyData.text,
        rules: valleyData.rules || null,
        context_session_id: valleyData.contextSessionId || null,
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
        return createValleyInMemory(id, valleyData, now);
      }
      console.error('Supabase createValley error:', error);
      throw new Error('Failed to create valley');
    }
    return data;
  } else {
    return createValleyInMemory(id, valleyData, now);
  }
}

function createValleyInMemory(id, valleyData, now) {
  const valley = {
    id,
    title: valleyData.title,
    text: valleyData.text,
    rules: valleyData.rules || null,
    context_session_id: valleyData.contextSessionId || null,
    created_at: now,
    updated_at: now
  };
  memoryStore.set(id, valley);
  return { id, title: valley.title, created_at: valley.created_at };
}

function getValleysFromMemory() {
  return Array.from(memoryStore.values())
    .map(v => ({ id: v.id, title: v.title, created_at: v.created_at }))
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

export async function getValleys() {
  if (supabase && !useMemoryFallback) {
    const { data, error } = await supabase
      .from('valleys')
      .select('id, title, created_at')
      .order('created_at', { ascending: false });

    if (error) {
      // If table doesn't exist, fall back to memory
      if (error.code === 'PGRST205' || error.message?.includes('valleys')) {
        console.warn('Valleys table not found in Supabase, using memory fallback');
        useMemoryFallback = true;
        return getValleysFromMemory();
      }
      console.error('Supabase getValleys error:', error);
      throw new Error('Failed to fetch valleys');
    }
    return data || [];
  } else {
    return getValleysFromMemory();
  }
}

export async function getValley(id) {
  if (supabase && !useMemoryFallback) {
    const { data, error } = await supabase
      .from('valleys')
      .select('*')
      .eq('id', id)
      .single();

    if (error) {
      // If table doesn't exist, fall back to memory
      if (error.code === 'PGRST205' || error.message?.includes('valleys')) {
        console.warn('Valleys table not found in Supabase, using memory fallback');
        useMemoryFallback = true;
        return memoryStore.get(id) || null;
      }
      return null;
    }
    return data;
  } else {
    return memoryStore.get(id) || null;
  }
}

export async function deleteValley(id) {
  if (supabase && !useMemoryFallback) {
    const { error } = await supabase
      .from('valleys')
      .delete()
      .eq('id', id);

    if (error) {
      // If table doesn't exist, fall back to memory
      if (error.code === 'PGRST205' || error.message?.includes('valleys')) {
        console.warn('Valleys table not found in Supabase, using memory fallback');
        useMemoryFallback = true;
        memoryStore.delete(id);
        return;
      }
      console.error('Supabase deleteValley error:', error);
      throw new Error('Failed to delete valley');
    }
  } else {
    memoryStore.delete(id);
  }
}
