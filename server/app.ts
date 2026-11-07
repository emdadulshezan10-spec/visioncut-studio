import cors from 'cors'
import express, { type Express } from 'express'
import helmet from 'helmet'
import type { PrismaClient } from '@prisma/client'
import { requireAuth, type TokenVerifier } from './middleware/auth'
import { errorHandler, rateLimit } from './middleware/common'
import { apiRouter } from './routes/api'

export interface AppDeps {
  db: PrismaClient
  verify: TokenVerifier
  corsOrigins: string[]
}

export function createApp({ db, verify, corsOrigins }: AppDeps): Express {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 1)
  app.use(helmet())
  app.use(cors({
    // The packaged desktop app sends `Origin: null` (file://). Access is still gated by the bearer token.
    origin: (origin, cb) => cb(null, !origin || origin === 'null' || corsOrigins.includes(origin)),
    methods: ['GET', 'POST', 'PUT', 'DELETE'], allowedHeaders: ['Authorization', 'Content-Type'], maxAge: 600,
  }))
  app.use(express.json({ limit: '10mb' }))

  app.get('/health', (_req, res) => { res.json({ ok: true }) })
  app.use('/api', rateLimit(300, 60_000), requireAuth(verify), apiRouter(db))
  app.use((_req, res) => { res.status(404).json({ error: 'Not found.' }) })
  app.use(errorHandler)
  return app
}
