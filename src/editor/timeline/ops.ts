/**
 * Pure timeline operations. Every function takes a Project and returns a NEW Project
 * (never mutates), which makes undo/redo trivial and the logic unit-testable.
 */
import {
  defaultColor, defaultEffects, defaultText, defaultTransform, newId, noTransition,
  type Clip, type MediaItem, type Project, type TextProps, type Track, type TrackKind,
} from '@/types/project'

export const MIN_CLIP = 0.1
const EPS = 1e-6

export const trackAcceptsClip = (track: Track, clip: Pick<Clip, 'kind'>): boolean => {
  if (track.kind === 'text') return clip.kind === 'text'
  if (track.kind === 'image') return clip.kind === 'image'
  if (track.kind === 'audio') return clip.kind === 'audio'
  return clip.kind === 'video' || clip.kind === 'image' // video tracks accept video + stills
}

export const clipsOnTrack = (p: Project, trackId: string, ignoreId?: string): Clip[] =>
  p.clips.filter((c) => c.trackId === trackId && c.id !== ignoreId).sort((a, b) => a.start - b.start)

/** Earliest start >= `desired` where `duration` fits on the track without overlap. */
export function findFreeStart(p: Project, trackId: string, desired: number, duration: number, ignoreId?: string): number {
  let start = Math.max(0, desired)
  for (const c of clipsOnTrack(p, trackId, ignoreId)) {
    if (c.start + c.duration <= start + EPS) continue
    if (c.start >= start + duration - EPS) break
    start = c.start + c.duration
  }
  return start
}

/** Nearest valid start to `desired` (tries before and after neighbours). */
export function nearestFreeStart(p: Project, trackId: string, desired: number, duration: number, ignoreId?: string): number {
  const after = findFreeStart(p, trackId, desired, duration, ignoreId)
  if (Math.abs(after - desired) < EPS) return after
  // try to fit before: the latest start <= desired that doesn't overlap
  const list = clipsOnTrack(p, trackId, ignoreId)
  let before = Math.max(0, desired)
  for (let i = list.length - 1; i >= 0; i--) {
    const c = list[i]
    if (c.start >= before + duration - EPS) continue
    if (c.start + c.duration <= before + EPS) break
    before = c.start - duration
  }
  if (before >= 0 && !overlaps(p, trackId, before, duration, ignoreId)) {
    return Math.abs(before - desired) <= Math.abs(after - desired) ? before : after
  }
  return after
}

export const overlaps = (p: Project, trackId: string, start: number, duration: number, ignoreId?: string): boolean =>
  clipsOnTrack(p, trackId, ignoreId).some((c) => start < c.start + c.duration - EPS && start + duration > c.start + EPS)

export function makeClip(partial: Partial<Clip> & Pick<Clip, 'trackId' | 'kind' | 'start' | 'duration'>): Clip {
  return {
    id: newId('clp'), inPoint: 0, speed: 1, reverse: false, volume: 1, audioFadeIn: 0, audioFadeOut: 0,
    denoise: false, audioOffset: 0, transform: defaultTransform(), color: defaultColor(), effects: defaultEffects(),
    transitionIn: noTransition(), transitionOut: noTransition(), keyframes: {}, ...partial,
  }
}

/** Default track kind for a media item. */
export const trackKindFor = (m: MediaItem): TrackKind => (m.kind === 'audio' ? 'audio' : m.kind === 'image' ? 'image' : 'video')

/** Adds a media item to the timeline. Videos with audio keep embedded audio in the same clip. */
export function addMediaClip(p: Project, media: MediaItem, opts: { trackId?: string; start?: number } = {}): { project: Project; clipId: string } {
  const want = trackKindFor(media)
  let track = opts.trackId ? p.tracks.find((t) => t.id === opts.trackId) : undefined
  const probe = { kind: media.kind } as Pick<Clip, 'kind'>
  if (!track || !trackAcceptsClip(track, probe) || track.locked) {
    // Choose the bottom-most unlocked track of the matching kind (video tracks also take images when no image track).
    const exact = p.tracks.filter((t) => !t.locked && t.kind === want)
    const fallback = want === 'image' ? p.tracks.filter((t) => !t.locked && t.kind === 'video') : []
    const candidates = exact.length ? exact : fallback
    track = candidates[candidates.length - 1]
  }
  let tracks = p.tracks
  if (!track) {
    track = { id: newId('trk'), kind: want, name: `${want[0].toUpperCase()}${want.slice(1)} ${p.tracks.filter((t) => t.kind === want).length + 1}`, locked: false, visible: true, muted: false }
    tracks = [...tracks, track]
  }
  const duration = media.kind === 'image' ? 5 : Math.max(MIN_CLIP, media.duration)
  const start = findFreeStart({ ...p, tracks }, track.id, opts.start ?? 0, duration)
  const clip = makeClip({ trackId: track.id, kind: media.kind, mediaId: media.id, start, duration })
  return { project: { ...p, tracks, clips: [...p.clips, clip] }, clipId: clip.id }
}

/** Cue times (seconds from a clip's in-point) -> timeline times, honouring clip start, speed and the clip end. Cues shorter than 0.1 s are dropped. */
export function cuesToTimeline(cues: { start: number; end: number; text: string }[], clip: { start: number; duration: number; speed: number }): { start: number; end: number; text: string }[] {
  const speed = clip.speed || 1
  const out: { start: number; end: number; text: string }[] = []
  for (const c of cues) {
    const start = clip.start + c.start / speed
    const end = Math.min(clip.start + clip.duration, clip.start + c.end / speed)
    if (end - start >= 0.1) out.push({ start, end, text: c.text.trim() })
  }
  return out
}

export function addTextClip(p: Project, start: number, preset: TextProps['preset'] = 'title', content?: string): { project: Project; clipId: string } {
  let track = [...p.tracks].reverse().find((t) => t.kind === 'text' && !t.locked)
  let tracks = p.tracks
  if (!track) {
    track = { id: newId('trk'), kind: 'text', name: `Text ${p.tracks.filter((t) => t.kind === 'text').length + 1}`, locked: false, visible: true, muted: false }
    tracks = [track, ...tracks]
  }
  const text: TextProps = { ...defaultText(), preset }
  if (content) text.content = content
  if (preset === 'lower-third') Object.assign(text, { content: content ?? 'Name Surname\nTitle / Role', fontSize: 56, align: 'left', background: '#000000aa', animation: 'slide-up', bold: true })
  if (preset === 'subtitle') Object.assign(text, { content: content ?? 'Subtitle text', fontSize: 52, bold: false, outlineWidth: 3, shadow: false, animation: 'none' })
  const duration = preset === 'subtitle' ? 2.5 : 4
  const s = findFreeStart({ ...p, tracks }, track.id, start, duration)
  const clip = makeClip({ trackId: track.id, kind: 'text', start: s, duration, text })
  return { project: { ...p, tracks, clips: [...p.clips, clip] }, clipId: clip.id }
}

export const updateClip = (p: Project, id: string, patch: Partial<Clip>): Project =>
  ({ ...p, clips: p.clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) })

export function moveClip(p: Project, id: string, start: number, trackId?: string): Project {
  const clip = p.clips.find((c) => c.id === id)
  if (!clip) return p
  const target = p.tracks.find((t) => t.id === (trackId ?? clip.trackId))
  if (!target || target.locked || !trackAcceptsClip(target, clip)) return p
  const s = nearestFreeStart(p, target.id, Math.max(0, start), clip.duration, id)
  return updateClip(p, id, { start: s, trackId: target.id })
}

/** Max timeline duration a clip can be extended to, given its media length. */
export function maxClipDuration(p: Project, clip: Clip): number {
  if (clip.kind === 'text' || clip.kind === 'image') return Infinity
  const media = p.media.find((m) => m.id === clip.mediaId)
  if (!media) return Infinity
  if (clip.reverse) return Math.max(MIN_CLIP, (clip.inPoint + clip.duration * clip.speed) / clip.speed)
  return Math.max(MIN_CLIP, (media.duration - clip.inPoint) / clip.speed)
}

/** Trim the left edge so the clip begins at `newStart` on the timeline. */
export function trimLeft(p: Project, id: string, newStart: number): Project {
  const c = p.clips.find((x) => x.id === id)
  if (!c) return p
  const end = c.start + c.duration
  const prev = clipsOnTrack(p, c.trackId, id).filter((o) => o.start + o.duration <= c.start + EPS).pop()
  let s = Math.min(newStart, end - MIN_CLIP)
  s = Math.max(s, prev ? prev.start + prev.duration : 0)
  // cannot extend before the start of the source media
  const media = p.media.find((m) => m.id === c.mediaId)
  if (c.kind === 'video' || c.kind === 'audio') {
    if (c.reverse) {
      // reversed clips show the END of the source first: extending left needs source after the current range
      const tail = media ? media.duration - (c.inPoint + c.duration * c.speed) : 0
      s = Math.max(s, c.start - Math.max(0, tail) / c.speed)
    } else s = Math.max(s, c.start - c.inPoint / c.speed)
  }
  const delta = s - c.start
  return updateClip(p, id, { start: s, duration: end - s, inPoint: c.reverse ? c.inPoint : c.inPoint + delta * c.speed })
}

/** Trim the right edge so the clip ends at `newEnd` on the timeline. */
export function trimRight(p: Project, id: string, newEnd: number): Project {
  const c = p.clips.find((x) => x.id === id)
  if (!c) return p
  const next = clipsOnTrack(p, c.trackId, id).find((o) => o.start >= c.start + c.duration - EPS)
  let e = Math.max(newEnd, c.start + MIN_CLIP)
  if (next) e = Math.min(e, next.start)
  e = Math.min(e, c.start + maxClipDuration(p, c))
  const dur = e - c.start
  // Reversed clips play the source backwards, so shortening from the right removes the EARLIER source part.
  return updateClip(p, id, c.reverse ? { duration: dur, inPoint: Math.max(0, c.inPoint + (c.duration - dur) * c.speed) } : { duration: dur })
}

/** Split at timeline time `t`. Returns the project and the id of the new right-hand clip. */
export function splitClip(p: Project, id: string, t: number): { project: Project; rightId?: string } {
  const c = p.clips.find((x) => x.id === id)
  if (!c || t <= c.start + MIN_CLIP / 2 || t >= c.start + c.duration - MIN_CLIP / 2) return { project: p }
  const leftDur = t - c.start
  const right: Clip = {
    ...structuredClone(c), id: newId('clp'), start: t, duration: c.duration - leftDur,
    inPoint: c.reverse ? c.inPoint : c.inPoint + leftDur * c.speed,
    transitionIn: noTransition(), audioFadeIn: 0,
    keyframes: shiftKeyframes(c.keyframes, -leftDur),
  }
  // For reversed clips the source segment order flips: left part plays the *later* source range.
  const left: Clip = { ...c, duration: leftDur, transitionOut: noTransition(), audioFadeOut: 0, inPoint: c.reverse ? c.inPoint + (c.duration - leftDur) * c.speed : c.inPoint }
  return { project: { ...p, clips: p.clips.map((x) => (x.id === id ? left : x)).concat(right) }, rightId: right.id }
}

function shiftKeyframes(k: Clip['keyframes'], dt: number): Clip['keyframes'] {
  const out: Clip['keyframes'] = {}
  for (const [prop, list] of Object.entries(k)) {
    out[prop as keyof Clip['keyframes']] = (list ?? []).map((f) => ({ ...f, time: f.time + dt })).filter((f) => f.time >= 0)
  }
  return out
}

/** Merge two clips that are adjacent on the timeline and contiguous in the same source. */
export function mergeClips(p: Project, aId: string, bId: string): Project {
  let a = p.clips.find((c) => c.id === aId)
  let b = p.clips.find((c) => c.id === bId)
  if (!a || !b) return p
  if (a.start > b.start) [a, b] = [b, a]
  const adjacent = Math.abs(a.start + a.duration - b.start) < 0.02
  const sameSource = a.trackId === b.trackId && a.mediaId === b.mediaId && a.mediaId !== undefined && a.speed === b.speed && a.reverse === b.reverse
  const contiguous = !a.reverse && Math.abs(a.inPoint + a.duration * a.speed - b.inPoint) < 0.05
  if (!adjacent || !sameSource || !contiguous) return p
  const merged: Clip = { ...a, duration: a.duration + b.duration, transitionOut: b.transitionOut, audioFadeOut: b.audioFadeOut }
  return { ...p, clips: p.clips.filter((c) => c.id !== b!.id).map((c) => (c.id === a!.id ? merged : c)) }
}

export function duplicateClip(p: Project, id: string): { project: Project; clipId?: string } {
  const c = p.clips.find((x) => x.id === id)
  if (!c) return { project: p }
  const start = findFreeStart(p, c.trackId, c.start + c.duration, c.duration)
  const copy: Clip = { ...structuredClone(c), id: newId('clp'), start }
  return { project: { ...p, clips: [...p.clips, copy] }, clipId: copy.id }
}

export const deleteClips = (p: Project, ids: string[]): Project => ({ ...p, clips: p.clips.filter((c) => !ids.includes(c.id)) })

/** Delete clips and close the gap by shifting later clips on the same track left. */
export function rippleDelete(p: Project, ids: string[]): Project {
  let out = p
  for (const id of ids) {
    const c = out.clips.find((x) => x.id === id)
    if (!c) continue
    out = {
      ...out,
      clips: out.clips.filter((x) => x.id !== id).map((x) => (x.trackId === c.trackId && x.start >= c.start + c.duration - EPS ? { ...x, start: x.start - c.duration } : x)),
    }
  }
  return out
}

export function changeSpeed(p: Project, id: string, speed: number): Project {
  const c = p.clips.find((x) => x.id === id)
  if (!c || c.kind === 'text' || c.kind === 'image') return p
  const s = Math.min(8, Math.max(0.1, speed))
  const sourceSpan = c.duration * c.speed
  let duration = sourceSpan / s
  const next = clipsOnTrack(p, c.trackId, id).find((o) => o.start >= c.start + c.duration - EPS)
  if (next) duration = Math.min(duration, next.start - c.start)
  return updateClip(p, id, { speed: s, duration: Math.max(MIN_CLIP, duration) })
}

/** All times that clips/markers/playhead can snap to. */
export function snapPoints(p: Project, excludeClipId?: string): number[] {
  const pts = new Set<number>([0])
  for (const c of p.clips) {
    if (c.id === excludeClipId) continue
    pts.add(c.start)
    pts.add(c.start + c.duration)
  }
  for (const m of p.markers) pts.add(m.time)
  return [...pts]
}

export function snap(value: number, points: number[], threshold: number): { value: number; snapped: boolean } {
  let best = value
  let bestD = threshold
  for (const pt of points) {
    const d = Math.abs(pt - value)
    if (d <= bestD) { best = pt; bestD = d }
  }
  return { value: best, snapped: best !== value }
}

export function addTrack(p: Project, kind: TrackKind): Project {
  const n = p.tracks.filter((t) => t.kind === kind).length + 1
  const t: Track = { id: newId('trk'), kind, name: `${kind[0].toUpperCase()}${kind.slice(1)} ${n}`, locked: false, visible: true, muted: false }
  return { ...p, tracks: kind === 'audio' ? [...p.tracks, t] : [t, ...p.tracks] }
}

export function removeTrack(p: Project, trackId: string): Project {
  return { ...p, tracks: p.tracks.filter((t) => t.id !== trackId), clips: p.clips.filter((c) => c.trackId !== trackId) }
}

