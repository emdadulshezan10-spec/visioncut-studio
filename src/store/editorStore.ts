import { create } from 'zustand'
import { createProject, projectDuration, type Project } from '@/types/project'

const HISTORY_LIMIT = 100

interface EditorState {
  project: Project
  /** True when there are changes not yet written to disk. */
  dirty: boolean
  lastSavedAt: number | null
  past: Project[]
  future: Project[]
  selection: string[]
  playhead: number
  playing: boolean
  playbackRate: number
  /** Timeline zoom in pixels per second. */
  zoom: number
  snapping: boolean
  previewScale: number // 0.25 | 0.5 | 1  (preview render resolution)
  loop: boolean

  loadProject: (p: Project) => void
  newProject: (name?: string) => void
  /** Apply a change and record an undo step. */
  commit: (fn: (p: Project) => Project) => void
  /** Apply a change without recording history (use inside drags after `checkpoint`). */
  live: (fn: (p: Project) => Project) => void
  /** Record the current state as an undo step (call once at drag start). */
  checkpoint: () => void
  undo: () => void
  redo: () => void
  markSaved: () => void
  select: (ids: string[], additive?: boolean) => void
  setPlayhead: (t: number) => void
  setPlaying: (v: boolean) => void
  setPlaybackRate: (r: number) => void
  setZoom: (z: number) => void
  setSnapping: (v: boolean) => void
  setPreviewScale: (v: number) => void
  setLoop: (v: boolean) => void
}

const touch = (p: Project): Project => ({ ...p, updatedAt: new Date().toISOString() })

export const useEditor = create<EditorState>((set, get) => ({
  project: createProject('Untitled Project'),
  dirty: false,
  lastSavedAt: null,
  past: [],
  future: [],
  selection: [],
  playhead: 0,
  playing: false,
  playbackRate: 1,
  zoom: 80,
  snapping: true,
  previewScale: 1,
  loop: false,

  loadProject: (project) => set({ project, dirty: false, past: [], future: [], selection: [], playhead: 0, playing: false, lastSavedAt: Date.now() }),
  newProject: (name = 'Untitled Project') => get().loadProject(createProject(name)),

  commit: (fn) => {
    const { project, past } = get()
    const next = touch(fn(project))
    if (next === project) return
    set({ project: next, past: [...past, project].slice(-HISTORY_LIMIT), future: [], dirty: true })
  },
  live: (fn) => {
    const { project } = get()
    const next = touch(fn(project))
    if (next !== project) set({ project: next, dirty: true })
  },
  checkpoint: () => {
    const { project, past } = get()
    set({ past: [...past, project].slice(-HISTORY_LIMIT), future: [] })
  },
  undo: () => {
    const { past, project, future } = get()
    if (!past.length) return
    const prev = past[past.length - 1]
    const ids = new Set(prev.clips.map((c) => c.id))
    set({ project: prev, past: past.slice(0, -1), future: [project, ...future], dirty: true, selection: get().selection.filter((i) => ids.has(i)) })
  },
  redo: () => {
    const { past, project, future } = get()
    if (!future.length) return
    set({ project: future[0], past: [...past, project], future: future.slice(1), dirty: true })
  },
  markSaved: () => set({ dirty: false, lastSavedAt: Date.now() }),
  select: (ids, additive) => set((s) => ({ selection: additive ? [...new Set([...s.selection, ...ids])] : ids })),
  setPlayhead: (t) => set({ playhead: Math.max(0, t) }),
  setPlaying: (playing) => set({ playing }),
  setPlaybackRate: (playbackRate) => set({ playbackRate }),
  setZoom: (z) => set({ zoom: Math.min(600, Math.max(8, z)) }),
  setSnapping: (snapping) => set({ snapping }),
  setPreviewScale: (previewScale) => set({ previewScale }),
  setLoop: (loop) => set({ loop }),
}))

export const selectDuration = (s: EditorState): number => projectDuration(s.project)
