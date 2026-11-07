import type { NextFunction, Request, Response } from 'express'

export interface AuthUser {
  id: string
  email: string
  fullName: string
}

declare module 'express-serve-static-core' {
  interface Request { user?: AuthUser }
}

/** Verifies a bearer token and returns the user, or null if invalid. Injected so tests don't need Supabase. */
export type TokenVerifier = (token: string) => Promise<AuthUser | null>

/**
 * Verifies tokens by asking Supabase Auth itself (`GET /auth/v1/user`). This works regardless of the
 * project's JWT signing scheme and needs only the PUBLIC anon key, never the service-role key.
 * Successful lookups are cached briefly to avoid a network round trip on every request.
 */
export function supabaseVerifier(supabaseUrl: string, anonKey: string): TokenVerifier {
  const cache = new Map<string, { user: AuthUser; expires: number }>()
  return async (token) => {
    const hit = cache.get(token)
    if (hit && hit.expires > Date.now()) return hit.user
    try {
      const res = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/user`, { headers: { Authorization: `Bearer ${token}`, apikey: anonKey } })
      if (!res.ok) return null
      const u = (await res.json()) as { id?: string; email?: string; user_metadata?: { full_name?: string } }
      if (!u.id || !u.email) return null
      const user: AuthUser = { id: u.id, email: u.email, fullName: u.user_metadata?.full_name ?? u.email.split('@')[0] }
      cache.set(token, { user, expires: Date.now() + 60_000 })
      if (cache.size > 500) cache.delete(cache.keys().next().value as string)
      return user
    } catch {
      return null
    }
  }
}

export function requireAuth(verify: TokenVerifier) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const header = req.headers.authorization
    const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : ''
    if (!token) { res.status(401).json({ error: 'Missing bearer token.' }); return }
    const user = await verify(token)
    if (!user) { res.status(401).json({ error: 'Invalid or expired session.' }); return }
    req.user = user
    next()
  }
}
