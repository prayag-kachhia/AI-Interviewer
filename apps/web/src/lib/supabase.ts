import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

export const isSupabaseConfigured =
  /^https:\/\/[^/]+\.supabase\.co(?:\/.*)?$/.test(supabaseUrl) &&
  supabaseAnonKey.length > 20 &&
  !supabaseUrl.includes('dummy') &&
  !supabaseAnonKey.includes('dummy');

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
