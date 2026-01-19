
import { createClient } from '@supabase/supabase-js';


const supabaseUrl = process.env.SUPABASE_URL;
// Use service role key to bypass email verification if possible/needed or just admin privileges
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function createTestUser() {
    const email = 'test@test.com';
    const password = 'test';

    console.log(`Creating user ${email}...`);

    const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true // Auto-confirm the email
    });

    if (error) {
        console.error('Error creating user:', error.message);
    } else {
        console.log('User created successfully:', data.user);
    }
}

createTestUser();
