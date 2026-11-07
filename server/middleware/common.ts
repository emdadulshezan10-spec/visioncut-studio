import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express'
import { ZodError, type ZodType } from 'zod'

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

/** Parses req.body with a zod schema; responds 400 with readable messages on failure. */
export const validateBody = <T>(schema: ZodType<T>): RequestHandler => (req: Request, _res: Response, next: NextFunction) => {
  const r = schema.safeParse(req.body)
  if (!r.success) throw new HttpError(400, r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; '))
  req.body = r.data
  next()
}

/** Tiny fixed-window in-memory rate limiter (per user id or IP). Enough for a single-instance API. */
export function rateLimit(max: number, windowMs: number): RequestHandler {
  const hits = new Map<string, { n: number; reset: number }>()
  return (req, res, next) => {
    const key = req.user?.id ?? req.ip ?? 'anon'
    const now = Date.now()
    const h = hits.get(key)
    if (!h || h.reset < now) hits.set(key, { n: 1, reset: now + windowMs })
    else if (++h.n > max) { res.status(429).json({ error: 'Too many requests. Slow down.' }); return }
    if (hits.size > 5000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k)
    next()
  }
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof HttpError) { res.status(err.status).json({ error: err.message }); return }
  if (err instanceof ZodError) { res.status(400).json({ error: err.message }); return }
  if ((err as { type?: string }).type === 'entity.too.large') { res.status(413).json({ error: 'Payload too large.' }); return }
  console.error('Unhandled error:', err)
  // Never leak internals (SQL, stack traces) to clients.
  res.status(500).json({ error: 'Internal server error.' })
}
