import { createClient } from '@supabase/supabase-js';
import { authStorage, AUTH_STORAGE_KEY } from './authStorage';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured =
  /^https:\/\/[^/]+\.supabase\.co(?:\/.*)?$/.test(supabaseUrl) &&
  supabaseAnonKey.length > 20 &&
  !supabaseUrl.includes('dummy') &&
  !supabaseAnonKey.includes('dummy');

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: authStorage,
    storageKey: AUTH_STORAGE_KEY,
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
