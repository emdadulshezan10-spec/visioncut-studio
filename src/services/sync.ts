/**
 * Cloud synchronisation of PROJECT METADATA/TIMELINE JSON to the Express + PostgreSQL backend.
 * - Runs only when the user is signed in (never in local mode).
 * - Media files stay on disk; only the project JSON is sent, with absolute local paths reduced to
 *   file names so private directory structure is not uploaded.
 * - Uploading media files to Supabase Storage is a separate, opt-in action (see uploadMediaToCloud).
 */
import { useAuth } from '@/store/authStore'
import { API_URL, supabase } from './supabase'
import { api } from './api'
import type { Project } from '@/types/project'

export interface CloudProject { id: string; name: string; updatedAt: string; data?: Project }

async function authed(path: string, init: RequestInit = {}): Promise<Response> {
  const token = useAuth.getState().accessToken
  if (!token) throw new Error('Not signed in.')
  const res = await fetch(`${API_URL}${path}`, { ...init, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers ?? {}) } })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? `Server returned ${res.status}`)
  }
  return res
}

const sanitize = (p: Project): Project => ({
  ...p,
  media: p.media.map((m) => ({ ...m, path: m.path.split(/[\\/]/).pop() ?? m.name, thumbnail: undefined, proxyPath: undefined, waveform: undefined })),
})

export const cloudAvailable = (): boolean => useAuth.getState().status === 'signedIn' && !useAuth.getState().localMode

/** Best-effort background push. Failures are non-fatal because the local file is the source of truth. */
export async function syncProject(p: Project): Promise<void> {
  if (!cloudAvailable()) return
  try {
    const prefs = await api().prefs.get()
    if (!prefs.cloudSyncEnabled) return
    await authed(`/api/projects/${p.id}`, { method: 'PUT', body: JSON.stringify({ name: p.name, data: sanitize(p), settings: p.settings }) })
  } catch (e) {
    console.warn('Cloud sync skipped:', e instanceof Error ? e.message : e)
  }
}

export async function listCloudProjects(): Promise<CloudProject[]> {
  return (await (await authed('/api/projects')).json()) as CloudProject[]
}

export async function fetchCloudProject(id: string): Promise<Project> {
  const r = (await (await authed(`/api/projects/${id}`)).json()) as CloudProject
  if (!r.data) throw new Error('Project data missing')
  // Media paths are file names only: mark as needing relink so the UI can ask for the originals.
  return { ...r.data, media: r.data.media.map((m) => ({ ...m, error: 'Original file not on this device — use Relink.' })) }
}

export async function deleteCloudProject(id: string): Promise<void> { await authed(`/api/projects/${id}`, { method: 'DELETE' }) }

export async function recordExport(entry: { projectId: string; format: string; codec: string; resolution: string; fps: number; sizeBytes: number; durationSec: number }): Promise<void> {
  if (!cloudAvailable()) return
  try { await authed('/api/exports', { method: 'POST', body: JSON.stringify(entry) }) } catch { /* history is also stored locally */ }
}

/** Uploads ONE media file to the private `project-media` bucket. Only call after explicit user consent. */
export async function uploadMediaToCloud(userId: string, projectId: string, name: string, file: Blob): Promise<string> {
  if (!supabase) throw new Error('Supabase not configured')
  const prefs = await api().prefs.get()
  if (!prefs.cloudUploadEnabled) throw new Error('Cloud media upload is disabled in Settings.')
  const path = `${userId}/${projectId}/${name}`
  const { error } = await supabase.storage.from('project-media').upload(path, file, { upsert: true })
  if (error) throw error
  return path
}
