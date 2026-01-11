-- Migration: Create context_anchors table for Unified Context Management
-- Run this in Supabase SQL Editor

-- Create context_anchors table
CREATE TABLE IF NOT EXISTS context_anchors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  items JSONB NOT NULL DEFAULT '[]',
  rules TEXT,
  writing_style TEXT,
  clarifications JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_context_anchors_user_id ON context_anchors(user_id);
CREATE INDEX IF NOT EXISTS idx_context_anchors_created_at ON context_anchors(created_at);

-- Enable Row Level Security
ALTER TABLE context_anchors ENABLE ROW LEVEL SECURITY;

-- Policy: Users can CRUD their own anchors
CREATE POLICY "Users can CRUD own anchors" ON context_anchors
  FOR ALL USING (auth.uid() = user_id);

-- Policy: Anonymous users can create temporary anchors (null user_id)
CREATE POLICY "Anon users can create temp anchors" ON context_anchors
  FOR INSERT WITH CHECK (user_id IS NULL);

-- Policy: Anonymous users can read their own temp anchors (by session - handled by API)
CREATE POLICY "Anon users can read temp anchors" ON context_anchors
  FOR SELECT USING (user_id IS NULL);

-- Policy: Anonymous users can delete temp anchors
CREATE POLICY "Anon users can delete temp anchors" ON context_anchors
  FOR DELETE USING (user_id IS NULL);

-- Comment on table
COMMENT ON TABLE context_anchors IS 'Stores synthesized Context Anchors for the Unified Context Management feature';
COMMENT ON COLUMN context_anchors.summary IS 'The ~200 word Context Anchor summary pinned to prompts';
COMMENT ON COLUMN context_anchors.items IS 'JSON array of context items (files, URLs, images)';
COMMENT ON COLUMN context_anchors.clarifications IS 'User responses to clarification questions';
