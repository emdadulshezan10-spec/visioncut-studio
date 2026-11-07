import { create } from 'zustand'
import { supabase, supabaseConfigured, setRememberMe } from '@/services/supabase'
import { api } from '@/services/api'

export type Plan = 'free' | 'pro' | 'premium'

export interface Profile {
  id: string
  email: string
  fullName: string
  avatarUrl: string | null
  plan: Plan
  createdAt: string | null
  lastLogin: string | null
}

interface AuthState {
  status: 'loading' | 'signedOut' | 'signedIn'
  /** True when Supabase is not configured: the app runs in single-user local mode. */
  localMode: boolean
  profile: Profile | null
  accessToken: string | null
  init: () => Promise<void>
  signUp: (email: string, password: string, fullName: string) => Promise<{ needsVerification: boolean }>
  verifySignupCode: (email: string, code: string) => Promise<void>
  signIn: (email: string, password: string, remember: boolean) => Promise<void>
  signInWithGoogle: () => Promise<void>
  completeOAuth: (url: string) => Promise<void>
  signOut: () => Promise<void>
  requestPasswordReset: (email: string) => Promise<void>
  resetPassword: (email: string, code: string, newPassword: string) => Promise<void>
  updateProfile: (patch: { fullName?: string }) => Promise<void>
  uploadAvatar: (file: File) => Promise<void>
  changePassword: (newPassword: string) => Promise<void>
}

const LOCAL_PROFILE: Profile = { id: 'local', email: 'local@this-device', fullName: 'Local user', avatarUrl: null, plan: 'free', createdAt: null, lastLogin: null }

const need = () => { if (!supabase) throw new Error('Supabase is not configured. See docs/supabase.md.'); return supabase }

/** Strong-enough password policy enforced client-side (Supabase enforces its own server-side too). */
export function validatePassword(pw: string): string | null {
  if (pw.length < 8) return 'Password must be at least 8 characters.'
  if (!/[a-z]/.test(pw) || !/[A-Z]/.test(pw) || !/\d/.test(pw)) return 'Use upper-case, lower-case and a number.'
  return null
}
export const validateEmail = (e: string): boolean => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)

async function loadProfile(userId: string, email: string, meta: Record<string, unknown>): Promise<Profile> {
  const sb = need()
  const { data } = await sb.from('users').select('*').eq('id', userId).maybeSingle()
  // Record this login (RLS lets users update only their own row).
  const now = new Date().toISOString()
  void sb.from('users').update({ last_login: now }).eq('id', userId)
  let avatarUrl: string | null = (data?.profile_image as string | null) ?? null
  if (avatarUrl && !/^https?:/.test(avatarUrl)) {
    const { data: signed } = await sb.storage.from('avatars').createSignedUrl(avatarUrl, 3600)
    avatarUrl = signed?.signedUrl ?? null
  }
  return {
    id: userId, email,
    fullName: (data?.full_name as string) || (meta.full_name as string) || email.split('@')[0],
    avatarUrl, plan: ((data?.subscription_plan as Plan) ?? 'free'),
    createdAt: (data?.created_at as string) ?? null, lastLogin: now,
  }
}

export const useAuth = create<AuthState>((set, get) => ({
  status: 'loading',
  localMode: !supabaseConfigured,
  profile: null,
  accessToken: null,

  init: async () => {
    if (!supabase) return set({ status: 'signedIn', profile: LOCAL_PROFILE, localMode: true })
    const { data } = await supabase.auth.getSession()
    const apply = async (session: typeof data.session) => {
      if (!session) return set({ status: 'signedOut', profile: null, accessToken: null })
      const u = session.user
      set({ status: 'signedIn', accessToken: session.access_token, profile: await loadProfile(u.id, u.email ?? '', u.user_metadata ?? {}) })
    }
    await apply(data.session)
    supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED' && session) set({ accessToken: session.access_token })
      else if (event === 'SIGNED_OUT') set({ status: 'signedOut', profile: null, accessToken: null })
      else if (event === 'SIGNED_IN' && !get().profile) void apply(session)
    })
  },

  signUp: async (email, password, fullName) => {
    const sb = need()
    const { data, error } = await sb.auth.signUp({ email, password, options: { data: { full_name: fullName } } })
    if (error) throw error
    // With "Confirm email" enabled Supabase returns a user but no session until the address is verified.
    return { needsVerification: !data.session }
  },
  verifySignupCode: async (email, code) => {
    const { error } = await need().auth.verifyOtp({ email, token: code.trim(), type: 'signup' })
    if (error) throw error
  },
  signIn: async (email, password, remember) => {
    setRememberMe(remember)
    const { error } = await need().auth.signInWithPassword({ email, password })
    if (error) throw error
  },
  signInWithGoogle: async () => {
    const { data, error } = await need().auth.signInWithOAuth({ provider: 'google', options: { redirectTo: 'visioncut://auth-callback', skipBrowserRedirect: true } })
    if (error) throw error
    if (data.url) await api().app.openExternal(data.url)
  },
  completeOAuth: async (url) => {
    const code = new URL(url).searchParams.get('code')
    if (!code) throw new Error('Sign-in was cancelled or failed.')
    const { error } = await need().auth.exchangeCodeForSession(code)
    if (error) throw error
  },
  signOut: async () => { if (supabase) await supabase.auth.signOut(); set({ status: supabase ? 'signedOut' : 'signedIn', profile: supabase ? null : LOCAL_PROFILE, accessToken: null }) },
  requestPasswordReset: async (email) => {
    // The reset email must contain {{ .Token }} (6-digit code); see docs/supabase.md.
    const { error } = await need().auth.resetPasswordForEmail(email)
    if (error) throw error
  },
  resetPassword: async (email, code, newPassword) => {
    const sb = need()
    const { error } = await sb.auth.verifyOtp({ email, token: code.trim(), type: 'recovery' })
    if (error) throw error
    const { error: e2 } = await sb.auth.updateUser({ password: newPassword })
    if (e2) throw e2
    await sb.auth.signOut()
  },
  updateProfile: async ({ fullName }) => {
    const p = get().profile
    if (!p || p.id === 'local') return
    const name = fullName?.trim().slice(0, 80)
    if (!name) throw new Error('Name cannot be empty.')
    const sb = need()
    const { error } = await sb.from('users').update({ full_name: name }).eq('id', p.id)
    if (error) throw error
    await sb.auth.updateUser({ data: { full_name: name } })
    set({ profile: { ...p, fullName: name } })
  },
  uploadAvatar: async (file) => {
    const p = get().profile
    if (!p || p.id === 'local') throw new Error('Sign in to upload a profile picture.')
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Use a PNG, JPEG or WebP image.')
    if (file.size > 2 * 1024 * 1024) throw new Error('Image must be smaller than 2 MB.')
    const sb = need()
    const path = `${p.id}/avatar-${Date.now()}.${file.type.split('/')[1]}`
    const { error } = await sb.storage.from('avatars').upload(path, file, { upsert: true, contentType: file.type })
    if (error) throw error
    const { error: e2 } = await sb.from('users').update({ profile_image: path }).eq('id', p.id)
    if (e2) throw e2
    const { data } = await sb.storage.from('avatars').createSignedUrl(path, 3600)
    set({ profile: { ...p, avatarUrl: data?.signedUrl ?? null } })
  },
  changePassword: async (newPassword) => {
    const { error } = await need().auth.updateUser({ password: newPassword })
    if (error) throw error
  },
}))
