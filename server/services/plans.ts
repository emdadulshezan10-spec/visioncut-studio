import type { Plan } from '@prisma/client'

export interface PlanLimits { maxProjects: number; maxStorageMb: number; maxExportHeight: number }

/** Usage limits per plan. Stored per-subscription in the DB so they can be overridden without a deploy. */
export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: { maxProjects: 5, maxStorageMb: 0, maxExportHeight: 1080 },
  pro: { maxProjects: 50, maxStorageMb: 10_240, maxExportHeight: 2160 },
  premium: { maxProjects: 100_000, maxStorageMb: 102_400, maxExportHeight: 2160 },
}
