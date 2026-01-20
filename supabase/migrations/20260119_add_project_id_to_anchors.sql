-- Migration: Add project_id to context_anchors
-- This allows context to be isolated per project

ALTER TABLE context_anchors 
ADD COLUMN project_id UUID REFERENCES valleys(id) ON DELETE CASCADE;

-- Create index for project lookups
CREATE INDEX IF NOT EXISTS idx_context_anchors_project_id ON context_anchors(project_id);

-- Update RLS policies to include project_id context if needed
-- (The user_id check is already sufficient for security, but project_id adds isolation)
