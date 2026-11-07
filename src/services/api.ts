import type { VisionCutApi } from '@/types/electron'

/** Typed access to the Electron preload bridge. Throws a readable error when run in a plain browser. */
export function api(): VisionCutApi {
  if (!window.visioncut) throw new Error('This feature needs the VisionCut desktop app (Electron bridge unavailable).')
  return window.visioncut
}

/** URL the sandboxed renderer uses to stream a local media file (served by electron/protocol.ts). */
export const mediaUrl = (absPath: string): string => `vcmedia://local/${encodeURIComponent(absPath)}`

export const errMsg = (e: unknown): string => (e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
