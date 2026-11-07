import type { PrismaClient } from '@prisma/client'
import type { AuthUser } from '../middleware/auth'
import { PLAN_LIMITS, type PlanLimits } from './plans'

/**
 * Makes sure the user's rows exist (users, subscriptions, user_preferences) and refreshes last_login.
 * Normally a DB trigger (docs/supabase.sql) creates them at sign-up; this is the safety net.
 */
export async function ensureUser(db: PrismaClient, u: AuthUser) {
  const user = await db.user.upsert({
    where: { id: u.id },
    update: { lastLogin: new Date() },
    create: { id: u.id, email: u.email, fullName: u.fullName, lastLogin: new Date() },
  })
  const subscription = await db.subscription.upsert({
    where: { userId: u.id }, update: {},
    create: { userId: u.id, plan: user.subscriptionPlan, limits: PLAN_LIMITS[user.subscriptionPlan] as unknown as object },
  })
  const preferences = await db.userPreference.upsert({ where: { userId: u.id }, update: {}, create: { userId: u.id } })
  return { user, subscription, preferences, limits: subscription.limits as unknown as PlanLimits }
}
