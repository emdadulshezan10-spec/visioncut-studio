import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim()
const anon = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim()

/** True when real Supabase credentials were provided at build/dev time. */
export const supabaseConfigured = !!url && !!anon && !url.includes('your-project') && /^https:\/\//.test(url)

const REMEMBER_KEY = 'visioncut.rememberMe'

/** "Remember me": session in localStorage (persists across restarts) vs sessionStorage (cleared on quit). */
export const setRememberMe = (v: boolean): void => localStorage.setItem(REMEMBER_KEY, v ? '1' : '0')
export const getRememberMe = (): boolean => localStorage.getItem(REMEMBER_KEY) !== '0'

const storage = {
  getItem: (k: string) => localStorage.getItem(k) ?? sessionStorage.getItem(k),
  setItem: (k: string, v: string) => {
    const target = getRememberMe() ? localStorage : sessionStorage
    const other = getRememberMe() ? sessionStorage : localStorage
    other.removeItem(k)
    target.setItem(k, v)
  },
  removeItem: (k: string) => { localStorage.removeItem(k); sessionStorage.removeItem(k) },
}

/**
 * Only the public ANON key is ever used in the desktop app. Data access is protected by
 * Row Level Security policies (see docs/supabase.sql). The service-role key must never be bundled.
 */
export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url!, anon!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storage, flowType: 'pkce' } })
  : null

export const API_URL = ((import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000').replace(/\/$/, '')
