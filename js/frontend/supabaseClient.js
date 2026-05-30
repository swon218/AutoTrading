import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://lwvrmqwgtyozdiotgfqp.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_fTpAYKLqassiB-z5OItqqw_mYaoLQ1y';

export const isSupabaseConfigured = Boolean(
    SUPABASE_URL
    && !SUPABASE_URL.includes('YOUR_SUPABASE')
    && SUPABASE_PUBLISHABLE_KEY
    && !SUPABASE_PUBLISHABLE_KEY.includes('PASTE_YOUR')
);

export const supabase = isSupabaseConfigured ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: {
        autoRefreshToken: true,
        detectSessionInUrl: true,
        persistSession: true,
    },
}) : null;

function assertSupabaseConfigured() {
    if (!supabase) {
        throw new Error('Supabase publishable key is not configured in js/frontend/supabaseClient.js.');
    }
}

export async function getCurrentUser() {
    assertSupabaseConfigured();
    const { data, error } = await supabase.auth.getUser();
    if (error) return null;
    return data.user;
}

export async function getAccessToken() {
    assertSupabaseConfigured();
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session?.access_token || '';
}

export async function signUpWithProfile({ email, password, nickname }) {
    assertSupabaseConfigured();
    const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
            data: {
                nickname,
            },
        },
    });

    if (error) throw error;
    return data;
}

export async function signInWithEmail({ email, password }) {
    assertSupabaseConfigured();
    const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
    });

    if (error) throw error;
    return data;
}

export async function signOut() {
    assertSupabaseConfigured();
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
}
