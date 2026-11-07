/**
 * Editor commands shared by toolbar buttons, keyboard shortcuts and context actions.
 * Each command reads the current store state, applies a pure op from timeline/ops.ts and records undo.
 */
import { api, errMsg } from '@/services/api'
import { toast } from '@/store/toastStore'
import { useEditor } from '@/store/editorStore'
import { newId, projectDuration, type Clip, type MediaItem, type Project } from '@/types/project'
import { samplesToKeyframes } from '@/utils/tracker'
import {
  addMediaClip, addTextClip, cuesToTimeline, deleteClips, duplicateClip, makeClip, mergeClips, rippleDelete, splitClip, updateClip,
} from './timeline/ops'

const ed = () => useEditor.getState()
const selectedClips = (): Clip[] => { const s = ed(); return s.project.clips.filter((c) => s.selection.includes(c.id)) }

export function splitAtPlayhead(): void {
  const s = ed()
  const t = s.playhead
  // Split the selected clips under the playhead, or every unlocked clip under it if none is selected.
  const targets = s.project.clips.filter((c) => {
    const locked = s.project.tracks.find((tr) => tr.id === c.trackId)?.locked
    const hit = t > c.start && t < c.start + c.duration
    return hit && !locked && (s.selection.length === 0 || s.selection.includes(c.id))
  })
  if (!targets.length) return toast.info('Place the playhead over a clip to split it.')
  s.commit((p) => targets.reduce((acc, c) => splitClip(acc, c.id, t).project, p))
}

export function deleteSelected(): void {
  const s = ed()
  const ids = unlocked(s.selection)
  if (!ids.length) return
  s.commit((p) => deleteClips(p, ids))
  s.select([])
}

export function rippleDeleteSelected(): void {
  const s = ed()
  const ids = unlocked(s.selection)
  if (!ids.length) return
  s.commit((p) => rippleDelete(p, ids))
  s.select([])
}

function unlocked(ids: string[]): string[] {
  const { project } = ed()
  return ids.filter((id) => {
    const c = project.clips.find((x) => x.id === id)
    return c && !project.tracks.find((t) => t.id === c.trackId)?.locked
  })
}

export function duplicateSelected(): void {
  const s = ed()
  const ids = unlocked(s.selection)
  if (!ids.length) return
  const created: string[] = []
  s.commit((p) => ids.reduce((acc, id) => { const r = duplicateClip(acc, id); if (r.clipId) created.push(r.clipId); return r.project }, p))
  s.select(created)
}

export function mergeSelected(): void {
  const s = ed()
  if (s.selection.length !== 2) return toast.info('Select two adjacent clips that were split from the same media to merge them.')
  const before = s.project
  s.commit((p) => mergeClips(p, s.selection[0], s.selection[1]))
  if (ed().project === before) toast.error('These clips cannot be merged: they must be adjacent and continuous in the same source.')
  else s.select([])
}

export function addMarker(): void {
  const s = ed()
  s.commit((p) => ({ ...p, markers: [...p.markers, { id: newId('mk'), time: s.playhead, label: `Marker ${p.markers.length + 1}`, color: '#f5a524' }] }))
}

export function addText(preset: 'title' | 'lower-third' | 'subtitle' = 'title'): void {
  const s = ed()
  let id = ''
  s.commit((p) => { const r = addTextClip(p, s.playhead, preset); id = r.clipId; return r.project })
  s.select([id])
}

export function addMediaToTimeline(media: MediaItem, opts: { trackId?: string; start?: number } = {}): void {
  const s = ed()
  let id = ''
  s.commit((p) => { const r = addMediaClip(p, media, { start: opts.start ?? s.playhead, trackId: opts.trackId }); id = r.clipId; return r.project })
  s.select([id])
}

/** Imports files (paths) into the project's media library; reports corrupted/unsupported files individually. */
export async function importPaths(paths: string[], folderId: string | null = null): Promise<MediaItem[]> {
  if (!paths.length) return []
  try {
    const res = await api().media.import(paths)
    const items = res.items.map((m) => ({ ...m, folderId }))
    if (items.length) ed().commit((p) => ({ ...p, media: [...p.media, ...items] }))
    for (const e of res.errors) toast.error(`Could not import "${e.path.split(/[\\/]/).pop()}": ${e.error}`)
    if (items.length) toast.success(`Imported ${items.length} file${items.length > 1 ? 's' : ''}`)
    return items
  } catch (e) {
    toast.error(errMsg(e))
    return []
  }
}

export async function importViaDialog(folderId: string | null = null): Promise<MediaItem[]> {
  try {
    return await importPaths(await api().media.pick(), folderId)
  } catch (e) {
    toast.error(errMsg(e))
    return []
  }
}

/** Replaces the selected video clip's frame at the playhead with a still, splitting the clip around it. */
export async function freezeFrame(): Promise<void> {
  const s = ed()
  const clip = selectedClips()[0] ?? s.project.clips.find((c) => c.kind === 'video' && s.playhead > c.start && s.playhead < c.start + c.duration)
  const media = clip && s.project.media.find((m) => m.id === clip.mediaId)
  if (!clip || clip.kind !== 'video' || !media) return toast.info('Select a video clip and place the playhead on the frame to freeze.')
  const t = s.playhead
  if (t <= clip.start || t >= clip.start + clip.duration) return toast.info('Move the playhead inside the selected clip.')
  const local = t - clip.start
  const srcT = clip.reverse ? clip.inPoint + (clip.duration - local) * clip.speed : clip.inPoint + local * clip.speed
  try {
    const res = await api().media.freezeFrame(media.path, srcT)
    const still = res.items[0]
    if (!still) throw new Error(res.errors[0]?.error ?? 'Frame extraction failed')
    const HOLD = 2
    s.commit((p) => {
      let out: Project = { ...p, media: [...p.media, still] }
      const { project: split, rightId } = splitClip(out, clip.id, t)
      out = split
      // push everything after the split point on this track to make room for the hold
      out = { ...out, clips: out.clips.map((c) => (c.trackId === clip.trackId && c.start >= t - 1e-6 && c.id !== clip.id ? { ...c, start: c.start + HOLD } : c)) }
      void rightId
      const freeze = makeClip({ trackId: clip.trackId, kind: 'image', mediaId: still.id, start: t, duration: HOLD })
      return { ...out, clips: [...out.clips, freeze] }
    })
    toast.success('Freeze frame added')
  } catch (e) {
    toast.error(errMsg(e))
  }
}

export function importSubtitles(cues: { start: number; end: number; text: string }[]): void {
  ed().commit((p) => {
    let out = p
    for (const cue of cues) {
      const r = addTextClip(out, cue.start, 'subtitle', cue.text)
      out = updateClip(r.project, r.clipId, { start: cue.start, duration: cue.end - cue.start })
    }
    return out
  })
  toast.success(`Added ${cues.length} subtitle clips`)
}

/** Offline speech-to-text for the selected clip's audio -> subtitle text clips on the timeline. */
export async function autoSubtitles(): Promise<void> {
  const clip = selectedClips().find((c) => c.kind === 'video' || c.kind === 'audio')
  const media = clip ? ed().project.media.find((m) => m.id === clip.mediaId) : undefined
  if (!clip || !media) return void toast.info('Select a video or audio clip on the timeline first.')
  if (!media.hasAudio && media.kind !== 'audio') return void toast.error('That clip has no audio track to transcribe.')
  if (media.error) return void toast.error('That clip’s media file is missing. Relink it first.')
  try {
    const cues = await api().subtitles.transcribe(media.path, clip.inPoint, clip.duration * clip.speed)
    const mapped = cuesToTimeline(cues, clip)
    if (!mapped.length) return void toast.info('No speech was detected in that clip.')
    importSubtitles(mapped)
  } catch (e) {
    const msg = errMsg(e)
    if (!/cancel/i.test(msg)) toast.error(msg)
  }
}

/**
 * Motion tracking: follows a point (px, py as 0..1 of the source frame) in the selected video clip and animates the other
 * selected clip (a title, image or overlay) so it stays attached to that point. Needs exactly two clips selected.
 */
export async function trackMotion(px: number, py: number): Promise<void> {
  const s = ed()
  const sel = selectedClips()
  if (sel.length !== 2) return void toast.info('Select two clips: the video to track and the title/overlay that should follow it (Ctrl+click).')
  const order = (c: Clip) => s.project.tracks.findIndex((t) => t.id === c.trackId)
  const videos = sel.filter((c) => c.kind === 'video')
  if (!videos.length) return void toast.info('One of the two selected clips must be the video you want to track.')
  // The footage is the video clip; if both are videos, the one on the lower track is the footage.
  const footage = videos.length === 2 ? (order(videos[0]) > order(videos[1]) ? videos[0] : videos[1]) : videos[0]
  const overlay = sel.find((c) => c.id !== footage.id)!
  if (overlay.kind === 'audio') return void toast.info('The clip that follows the motion must be a title, image or video overlay.')
  const media = s.project.media.find((m) => m.id === footage.mediaId)
  if (!media || media.error || !media.width || !media.height) return void toast.error('The video’s media file is missing or unreadable.')
  try {
    const res = await api().tracking.track(media.path, footage.inPoint, footage.duration * footage.speed, media.width, media.height, { x: px, y: py })
    const kf = samplesToKeyframes(res.samples, {
      canvasW: s.project.settings.width, canvasH: s.project.settings.height, srcW: media.width, srcH: media.height,
      video: { start: footage.start, duration: footage.duration, speed: footage.speed, transform: footage.transform },
      overlay: { start: overlay.start, duration: overlay.duration },
    })
    if (kf.x.length < 2) return void toast.error('The two clips do not overlap in time, so there is nothing to animate.')
    ed().commit((p) => updateClip(p, overlay.id, { keyframes: { ...overlay.keyframes, x: kf.x, y: kf.y } }))
    const tracked = res.samples[res.samples.length - 1].t
    if (res.lostAt !== null) toast.info(`Tracking lost the target after ${tracked.toFixed(1)} s (it moved out of view or changed too much). The overlay follows up to that point; pick a clearer, more textured spot to track further.`)
    else toast.success(`Tracked ${res.samples.length} frames (${kf.x.length} keyframes). Scrub the timeline to check it.`)
  } catch (e) {
    toast.error(errMsg(e))
  }
}

export const timelineDuration = (): number => projectDuration(ed().project)
