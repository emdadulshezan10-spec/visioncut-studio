import { PrismaClient } from '@prisma/client'
import { createApp } from './app'
import { loadEnv } from './env'
import { supabaseVerifier } from './middleware/auth'

const env = loadEnv()
const db = new PrismaClient()
const app = createApp({
  db,
  verify: supabaseVerifier(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY),
  corsOrigins: env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
})

const server = app.listen(env.SERVER_PORT, () => console.log(`VisionCut API listening on :${env.SERVER_PORT}`))

const shutdown = () => { server.close(() => { void db.$disconnect().finally(() => process.exit(0)) }) }
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
