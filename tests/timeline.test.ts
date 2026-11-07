import { describe, expect, it } from 'vitest'
import {
  addMediaClip, addTrack, changeSpeed, cuesToTimeline, deleteClips, duplicateClip, findFreeStart, mergeClips, moveClip, nearestFreeStart,
  rippleDelete, snap, splitClip, trimLeft, trimRight, updateClip,
} from '../src/editor/timeline/ops'
import { interpolate, transitionAt, effectiveTransitions, formatTimecode } from '../src/utils/anim'
import { createProject, projectDuration, type MediaItem, type Project } from '../src/types/project'
import { estimateSizeBytes, outputSize, validateExportOptions, type ExportOptions } from '../src/types/export'
import { atempoChain, buildExportArgs, escapeFilterPath, keyframeExpr } from '../electron/export/buildArgs'
import { parseSrt } from '../electron/ipc/media'

const media = (over: Partial<MediaItem> = {}): MediaItem => ({ id: 'm1', name: 'a.mp4', path: 'C:/a.mp4', kind: 'video', duration: 10, width: 1920, height: 1080, hasAudio: true, size: 1, folderId: null, ...over })
const base = (): Project => ({ ...createProject('t'), media: [media(), media({ id: 'img', kind: 'image', duration: 0, hasAudio: false }), media({ id: 'aud', kind: 'audio', hasAudio: true })] })
const withClip = (p = base(), start = 0) => { const r = addMediaClip(p, p.media[0], { start }); return { p: r.project, id: r.clipId } }

describe('placing clips', () => {
  it('puts video on a video track, images on image track, audio on audio track', () => {
    let p = base()
    p = addMediaClip(p, p.media[0]).project
    p = addMediaClip(p, p.media[1]).project
    p = addMediaClip(p, p.media[2]).project
    const kinds = p.clips.map((c) => p.tracks.find((t) => t.id === c.trackId)!.kind)
    expect(kinds).toEqual(['video', 'image', 'audio'])
  })
  it('never overlaps clips on one track', () => {
    let { p } = withClip()
    p = addMediaClip(p, p.media[0], { start: 3, trackId: p.clips[0].trackId }).project
    expect(p.clips[1].start).toBe(10)
  })
  it('does not place into a locked track', () => {
    let p = base()
    const video = p.tracks.filter((t) => t.kind === 'video')
    p = { ...p, tracks: p.tracks.map((t) => (t.id === video[video.length - 1].id ? { ...t, locked: true } : t)) }
    const r = addMediaClip(p, p.media[0])
    expect(r.project.clips[0].trackId).toBe(video[0].id)
  })
  it('findFreeStart / nearestFreeStart respect neighbours', () => {
    const { p, id } = withClip()
    const t = p.clips[0].trackId
    expect(findFreeStart(p, t, 2, 3)).toBe(10)
    expect(nearestFreeStart(p, t, 10.2, 3, id)).toBeCloseTo(10.2)
    expect(findFreeStart(p, t, 12, 3)).toBe(12)
  })
})

describe('split / trim / move', () => {
  it('splits a clip into two contiguous source ranges', () => {
    const { p, id } = withClip()
    const { project, rightId } = splitClip(p, id, 4)
    const [l, r] = [project.clips.find((c) => c.id === id)!, project.clips.find((c) => c.id === rightId)!]
    expect(l.duration).toBeCloseTo(4); expect(r.start).toBeCloseTo(4); expect(r.inPoint).toBeCloseTo(4); expect(r.duration).toBeCloseTo(6)
  })
  it('ignores a split outside the clip', () => {
    const { p, id } = withClip()
    expect(splitClip(p, id, 20).project).toBe(p)
  })
  it('trims the right edge, limited by the media length', () => {
    let { p, id } = withClip()
    p = updateClip(p, id, { duration: 4 })
    expect(trimRight(p, id, 100).clips[0].duration).toBeCloseTo(10)
    expect(trimRight(p, id, 2).clips[0].duration).toBeCloseTo(2)
  })
  it('trims the left edge and advances the in-point', () => {
    const { p, id } = withClip()
    const c = trimLeft(p, id, 3).clips[0]
    expect(c.start).toBeCloseTo(3); expect(c.inPoint).toBeCloseTo(3); expect(c.duration).toBeCloseTo(7)
  })
  it('cannot trim left beyond the start of the source', () => {
    let { p, id } = withClip(base(), 5)
    expect(trimLeft(p, id, 0).clips[0].start).toBeCloseTo(5)
  })
  it('keeps source continuity when splitting a reversed clip', () => {
    let { p, id } = withClip()
    p = updateClip(p, id, { reverse: true })
    const { project, rightId } = splitClip(p, id, 4)
    const l = project.clips.find((c) => c.id === id)!, r = project.clips.find((c) => c.id === rightId)!
    // reversed playback: first half plays the END of the source (4..10 reversed -> starts at 4)
    expect(l.inPoint).toBeCloseTo(6); expect(r.inPoint).toBeCloseTo(0)
  })
  it('moves clips and refuses to enter locked tracks', () => {
    const { p, id } = withClip()
    expect(moveClip(p, id, 5).clips[0].start).toBe(5)
    const locked = { ...p, tracks: p.tracks.map((t) => (t.id === p.clips[0].trackId ? { ...t, locked: true } : t)) }
    expect(moveClip(locked, id, 5)).toBe(locked)
  })
  it('does not let a clip move onto a track of the wrong kind', () => {
    const { p, id } = withClip()
    const audioTrack = p.tracks.find((t) => t.kind === 'audio')!
    expect(moveClip(p, id, 0, audioTrack.id)).toBe(p)
  })
})

describe('delete / ripple / duplicate / merge / speed', () => {
  it('ripple delete closes the gap', () => {
    let { p, id } = withClip()
    p = addMediaClip(p, p.media[0], { start: 10, trackId: p.clips[0].trackId }).project
    const out = rippleDelete(p, [id])
    expect(out.clips).toHaveLength(1); expect(out.clips[0].start).toBe(0)
    expect(deleteClips(p, [id]).clips[0].start).toBe(10) // plain delete leaves the gap
  })
  it('duplicates after the original', () => {
    const { p, id } = withClip()
    const r = duplicateClip(p, id)
    expect(r.project.clips).toHaveLength(2); expect(r.project.clips[1].start).toBe(10)
  })
  it('merges split halves back and refuses unrelated clips', () => {
    const { p, id } = withClip()
    const s = splitClip(p, id, 4)
    const merged = mergeClips(s.project, id, s.rightId!)
    expect(merged.clips).toHaveLength(1); expect(merged.clips[0].duration).toBeCloseTo(10)
    const other = addMediaClip(s.project, s.project.media[0], { start: 30, trackId: p.clips[0].trackId })
    expect(mergeClips(other.project, id, other.clipId)).toBe(other.project)
  })
  it('changes speed and keeps the source range (2x halves the duration)', () => {
    const { p, id } = withClip()
    const c = changeSpeed(p, id, 2).clips[0]
    expect(c.duration).toBeCloseTo(5); expect(c.speed).toBe(2)
    expect(changeSpeed(p, id, 0.5).clips[0].duration).toBeCloseTo(20)
    expect(changeSpeed(p, id, 100).clips[0].speed).toBe(8) // clamped
  })
  it('adds tracks above (visual) or below (audio)', () => {
    const p = addTrack(addTrack(base(), 'video'), 'audio')
    expect(p.tracks[0].kind).toBe('video'); expect(p.tracks[p.tracks.length - 1].kind).toBe('audio')
  })
})

describe('snapping & animation helpers', () => {
  it('snaps within threshold only', () => {
    expect(snap(4.95, [0, 5, 10], 0.1)).toEqual({ value: 5, snapped: true })
    expect(snap(4.5, [0, 5, 10], 0.1)).toEqual({ value: 4.5, snapped: false })
  })
  it('interpolates keyframes linearly and clamps', () => {
    const f = [{ time: 0, value: 0 }, { time: 2, value: 10 }]
    expect(interpolate(f, 1)).toBe(5); expect(interpolate(f, -1)).toBe(0); expect(interpolate(f, 9)).toBe(10)
  })
  it('computes transition state at the edges', () => {
    const { p, id } = withClip()
    const c = updateClip(p, id, { transitionIn: { type: 'fade', duration: 1 }, transitionOut: { type: 'slide', duration: 1 } }).clips[0]
    expect(transitionAt(c, 0).opacity).toBe(0); expect(transitionAt(c, 0.5).opacity).toBeCloseTo(0.5); expect(transitionAt(c, 5).opacity).toBe(1)
    expect(transitionAt(c, 9.5).dx).toBeLessThan(0)
  })
  it('maps text animations to implicit transitions', () => {
    const c = { ...withClip().p.clips[0], kind: 'text' as const, text: { animation: 'fade' } as never }
    expect(effectiveTransitions(c).in.type).toBe('fade')
  })
  it('formats timecode', () => { expect(formatTimecode(61.5, 30)).toBe('00:01:01:15') })
  it('project duration is the end of the last clip', () => {
    const { p } = withClip(base(), 3)
    expect(projectDuration(p)).toBe(13)
  })
})

describe('export settings & filter-graph helpers', () => {
  const o: ExportOptions = { format: 'mp4', codec: 'h264', resolution: '1080p', fps: 30, audioBitrateKbps: 128, outputDir: 'C:/out', fileName: 'x' }
  it('rejects invalid container/codec pairs and bad names', () => {
    expect(validateExportOptions({ ...o, format: 'webm' })).toMatch(/cannot be stored/)
    expect(validateExportOptions({ ...o, format: 'avi', codec: 'h265' })).toMatch(/cannot be stored/)
    expect(validateExportOptions({ ...o, fileName: 'a/b' })).toMatch(/invalid/)
    expect(validateExportOptions({ ...o, outputDir: '' })).toMatch(/folder/)
    expect(validateExportOptions({ ...o, videoBitrateKbps: 5 })).toMatch(/bitrate/)
    expect(validateExportOptions(o)).toBeNull()
  })
  it('maps resolutions by the short side and keeps even sizes', () => {
    expect(outputSize(1920, 1080, '720p')).toEqual({ width: 1280, height: 720 })
    expect(outputSize(1080, 1920, '1080p')).toEqual({ width: 1080, height: 1920 })
    expect(outputSize(1920, 1080, '4k')).toEqual({ width: 3840, height: 2160 })
  })
  it('estimates larger files for higher bitrate/duration', () => {
    expect(estimateSizeBytes({ ...o, videoBitrateKbps: 8000 }, 60, 1920, 1080)).toBeGreaterThan(estimateSizeBytes({ ...o, videoBitrateKbps: 2000 }, 60, 1920, 1080))
  })
  it('atempo chain stays within [0.5, 2] per stage', () => {
    expect(atempoChain(1)).toEqual([]); expect(atempoChain(4)).toEqual(['atempo=2', 'atempo=2']); expect(atempoChain(0.25)).toEqual(['atempo=0.5', 'atempo=0.5'])
  })
  it('escapes filter paths', () => { expect(escapeFilterPath("C:\\a b\\it's.cube")).toBe("C\\:/a b/it\\'s.cube") })
  it('builds a keyframe expression', () => {
    expect(keyframeExpr([{ time: 0, value: 0 }, { time: 2, value: 10 }], 't')).toContain('if(lt(t,2)')
  })
  it('skips clips whose media is missing and reports a warning', () => {
    let { p } = withClip()
    p = { ...p, media: [{ ...p.media[0], error: 'gone' }, ...p.media.slice(1)] }
    const r = buildExportArgs({ project: p, options: o, textImages: {}, outputPath: 'o.mp4' })
    expect(r.warnings[0]).toMatch(/skipped/)
  })
})

describe('subtitles', () => {
  it('parses SRT cues, ignoring malformed blocks and tags', () => {
    const cues = parseSrt('1\r\n00:00:01,000 --> 00:00:02,500\r\n<i>Hello</i>\r\nworld\r\n\r\nbroken\r\n\r\n2\r\n00:00:03,000 --> 00:00:04,000\r\nBye')
    expect(cues).toEqual([{ start: 1, end: 2.5, text: 'Hello\nworld' }, { start: 3, end: 4, text: 'Bye' }])
  })
  it('maps transcript cues onto the timeline (clip start, speed, clip end, tiny cues dropped)', () => {
    const cues = [{ start: 0, end: 2, text: ' Hi ' }, { start: 4, end: 6, text: 'Late' }, { start: 9.95, end: 10, text: 'tiny' }]
    // clip placed at 5 s, 2x speed, 4 s long on the timeline
    expect(cuesToTimeline(cues, { start: 5, duration: 4, speed: 2 })).toEqual([{ start: 5, end: 6, text: 'Hi' }, { start: 7, end: 8, text: 'Late' }])
    expect(cuesToTimeline(cues, { start: 0, duration: 5, speed: 1 })).toEqual([{ start: 0, end: 2, text: 'Hi' }, { start: 4, end: 5, text: 'Late' }])
  })
})
