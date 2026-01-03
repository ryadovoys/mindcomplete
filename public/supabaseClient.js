// Frontend Supabase client (uses anon key for auth)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://mbujfejmggcntdzyxvho.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1idWpmZWptZ2djbnRkenl4dmhvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjY5MDIwMzgsImV4cCI6MjA4MjQ3ODAzOH0.OhshYo1-k4oukRKX13Gul4W_eBT37J3Kr2iFDEdjPWk';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Make supabase available globally for non-module scripts
window.supabase = supabase;
