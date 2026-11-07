import { useEditor } from '@/store/editorStore'
import type { AnimatableProp, Clip, Project } from '@/types/project'
import { valueAt } from '@/utils/anim'

let lastAt = 0
let lastKey = ''

/**
 * Applies an edit, coalescing rapid edits to the same field (slider drags, typing)
 * into a single undo step.
 */
export function edit(key: string, fn: (p: Project) => Project): void {
  const s = useEditor.getState()
  const now = Date.now()
  if (key !== lastKey || now - lastAt > 700) s.commit(fn)
  else s.live(fn)
  lastKey = key
  lastAt = now
}

export function editClips(ids: string[], key: string, patch: (c: Clip) => Partial<Clip>): void {
  edit(`${key}:${ids.join(',')}`, (p) => ({ ...p, clips: p.clips.map((c) => (ids.includes(c.id) ? { ...c, ...patch(c) } : c)) }))
}

/** Sets an animatable property. If the property has keyframes, writes a keyframe at the playhead instead. */
export function setAnimatable(clip: Clip, prop: AnimatableProp, value: number, playhead: number): void {
  const frames = clip.keyframes[prop]
  if (frames && frames.length) {
    const t = Math.min(clip.duration, Math.max(0, playhead - clip.start))
    editClips([clip.id], `kf-${prop}`, (c) => {
      const list = (c.keyframes[prop] ?? []).filter((f) => Math.abs(f.time - t) > 1e-3)
      return { keyframes: { ...c.keyframes, [prop]: [...list, { time: t, value }].sort((a, b) => a.time - b.time) } }
    })
  } else {
    editClips([clip.id], `tf-${prop}`, (c) => ({ transform: { ...c.transform, [prop]: value } }))
  }
}

export const currentValue = (clip: Clip, prop: AnimatableProp, playhead: number): number =>
  valueAt(clip, prop, Math.min(clip.duration, Math.max(0, playhead - clip.start)))
